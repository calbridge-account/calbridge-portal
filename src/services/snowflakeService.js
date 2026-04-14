require('dotenv').config();
const snowflake = require('snowflake-sdk');
const fs = require('fs');
const crypto = require('crypto');

snowflake.configure({ logLevel: 'ERROR' });

// ─── Connection Pool ──────────────────────────────────────────────────────────
// Simple pool: up to MAX_POOL_SIZE connections, with health checking.
// Prevents the single-connection hang that occurs under concurrent load.

const MAX_POOL_SIZE  = 24; // increased from 16 — pool exhaustion under portal + worker concurrent load
const QUERY_TIMEOUT  = 60000; // 60s per query
const CONNECT_TIMEOUT = 15000; // 15s to establish connection

const pool = [];       // { conn, inUse, createdAt }
const waitQueue = [];  // resolve fns waiting for a free connection

function loadPrivateKey() {
  const keyPath = process.env.SNOWFLAKE_PRIVATE_KEY_PATH;
  const keyStr  = process.env.SNOWFLAKE_PRIVATE_KEY;
  const raw = keyPath ? fs.readFileSync(keyPath, 'utf8') : keyStr;
  if (!raw) throw new Error('No Snowflake private key configured (SNOWFLAKE_PRIVATE_KEY_PATH or SNOWFLAKE_PRIVATE_KEY)');
  const passphrase = process.env.SNOWFLAKE_PRIVATE_KEY_PASSPHRASE || undefined;
  const keyObj = crypto.createPrivateKey({ key: raw, format: 'pem', passphrase });
  return keyObj.export({ format: 'pem', type: 'pkcs8' });
}

function createConnectionConfig() {
  return {
    account:       process.env.SNOWFLAKE_ACCOUNT,
    username:      process.env.SNOWFLAKE_USER,
    authenticator: 'SNOWFLAKE_JWT',
    privateKey:    loadPrivateKey(),
    warehouse: process.env.SNOWFLAKE_WAREHOUSE,
    database:  process.env.SNOWFLAKE_DATABASE,
    schema:    process.env.SNOWFLAKE_SCHEMA,
    // Force UTC so CURRENT_DATE matches the server/app timezone.
    // Without this, Snowflake uses the account's default TZ (e.g. PDT = UTC-7),
    // causing date range queries to be 1 day behind UTC — data from today
    // appears missing and MTD/rolling windows are off by one day.
    // Note: also enforced via ALTER SESSION after connect (see createConnection).
    sessionParameters: { TIMEZONE: 'UTC' },
    loginTimeout: 15,
    networkTimeout: 30000
  };
}

async function createConnection() {
  const conn = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Snowflake connect timeout')), CONNECT_TIMEOUT);
    const c = snowflake.createConnection(createConnectionConfig());
    c.connect((err, conn) => {
      clearTimeout(timer);
      if (err) return reject(err);
      resolve(conn);
    });
  });

  // Belt-and-suspenders: enforce UTC timezone via ALTER SESSION after connect.
  // The sessionParameters config key handles it at login time; this covers any
  // edge cases where the SDK doesn't propagate it (e.g. reconnects, older SDK versions).
  await new Promise((resolve, reject) => {
    conn.execute({
      sqlText: "ALTER SESSION SET TIMEZONE = 'UTC'",
      complete: (err) => err ? reject(err) : resolve()
    });
  });

  return conn;
}

function isAlive(entry) {
  try { return entry.conn && entry.conn.isUp && entry.conn.isUp(); }
  catch { return false; }
}

async function acquireConnection() {
  // Find a free, healthy connection
  for (const entry of pool) {
    if (!entry.inUse && isAlive(entry)) {
      entry.inUse = true;
      return entry;
    }
  }

  // Create a new one if pool has space
  if (pool.length < MAX_POOL_SIZE) {
    const conn = await createConnection();
    const entry = { conn, inUse: true, createdAt: Date.now() };
    pool.push(entry);
    return entry;
  }

  // Wait for one to become free (max 10s)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const idx = waitQueue.indexOf(resolve);
      if (idx > -1) waitQueue.splice(idx, 1);
      reject(new Error('Snowflake pool exhausted — no free connection after 30s'));
    }, 30000); // increased from 10s to 30s — give burst crons time to finish

    waitQueue.push((entry) => {
      clearTimeout(timer);
      resolve(entry);
    });
  });
}

function releaseConnection(entry) {
  entry.inUse = false;

  // If someone is waiting, hand off immediately
  if (waitQueue.length > 0) {
    const next = waitQueue.shift();
    entry.inUse = true;
    next(entry);
  }
}

function removeConnection(entry) {
  const idx = pool.indexOf(entry);
  if (idx > -1) pool.splice(idx, 1);
  try { entry.conn.destroy(() => {}); } catch {}
}

// ─── Query ────────────────────────────────────────────────────────────────────

async function query(sqlText, binds = []) {
  let entry;
  try {
    entry = await acquireConnection();
  } catch (err) {
    throw new Error(`[Snowflake] Pool error: ${err.message}`);
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      // Connection timed out — remove it from pool and reject
      removeConnection(entry);
      reject(new Error(`[Snowflake] Query timeout (${QUERY_TIMEOUT}ms): ${sqlText.substring(0, 100)}`));
    }, QUERY_TIMEOUT);

    entry.conn.execute({
      sqlText,
      binds,
      complete: (err, stmt, rows) => {
        clearTimeout(timer);
        releaseConnection(entry);

        if (err) {
          // If connection is dead, remove it from pool
          if (!isAlive(entry)) removeConnection(entry);

          // Surface schema errors clearly
          if (err.message?.includes('invalid identifier')) {
            const match = err.message.match(/invalid identifier '([^']+)'/i);
            const col = match ? match[1] : 'unknown';
            console.error(`[Snowflake] ❌ Schema error — column: ${col}`);
            console.error(`[Snowflake] SQL: ${sqlText.substring(0, 200).replace(/\s+/g, ' ')}`);
          }
          return reject(err);
        }
        resolve(rows);
      }
    });
  });
}

// ─── Legacy compatibility ─────────────────────────────────────────────────────

async function getConnection() {
  // Legacy: return first live connection or create one
  const entry = await acquireConnection();
  releaseConnection(entry);
  return entry.conn;
}

async function exec(sqlText) {
  return query(sqlText);
}

// ─── Health check: prune dead connections every 5 min ─────────────────────────
setInterval(() => {
  for (let i = pool.length - 1; i >= 0; i--) {
    if (!pool[i].inUse && !isAlive(pool[i])) {
      console.log('[Snowflake] Pruning dead connection');
      pool.splice(i, 1);
    }
  }
}, 5 * 60 * 1000);

// ─── Batch Merge Helper ───────────────────────────────────────────────────────
//
// Replaces the row-by-row MERGE loop pattern that causes timeout on large reports.
//
// BEFORE (slow): for (const r of rows) { await query(MERGE ...) }  — 1 round-trip per row
//   3,364 rows × 165ms = 554s — way over the 150s job timeout
//
// AFTER (fast): chunked multi-row VALUES MERGE — 1 round-trip per 2,000 rows
//   3,364 rows → 2 queries × ~5s = ~10s total
//
// Usage:
//   await batchMerge({
//     table:      'sp_campaign_report',
//     keyColumns: ['client_id', 'profile_id', 'campaign_id', 'date'],
//     dataColumns: ['campaign_name', 'impressions', 'clicks', 'cost', ...],
//     dateColumns: ['date'],   // columns that need ::DATE cast in USING
//     rows,                    // array of plain objects with all col keys present
//     chunkSize: 2000          // optional, default 2000
//   });
//
// Row objects must have keys matching exactly the snake_case column names.
// Include ALL columns (key + data). batchMerge handles dedup via keyColumns.
//
// Pipeline conventions:
//   - Every row must carry: ingested_at, account_id (=client_id), report_id, pipeline_run_id
//   - Dedup on keyColumns — never duplicate, never silently drop
//
async function batchMerge({ table, keyColumns, dataColumns, dateColumns = [], rows, chunkSize = 2000 }) {
  if (!rows || rows.length === 0) return 0;

  // Deduplicate source rows by keyColumns — Snowflake MERGE throws "Duplicate row detected"
  // if the source USING clause contains multiple rows matching the same key.
  {
    const seen = new Map();
    for (const row of rows) {
      const key = keyColumns.map(c => row[c]).join('\x00');
      seen.set(key, row); // last row wins
    }
    rows = Array.from(seen.values());
  }

  const allColumns  = [...keyColumns, ...dataColumns]; // order matters for VALUES
  const dateSet     = new Set(dateColumns);
  let totalWritten  = 0;

  // Split into chunks to keep bind param count reasonable (2000 rows × 26 cols = 52,000 binds)
  // SDK triggers stage-based binding at 100,000 which requires different handling — stay under it
  for (let offset = 0; offset < rows.length; offset += chunkSize) {
    const chunk = rows.slice(offset, offset + chunkSize);
    if (!chunk.length) continue;

    // Build the VALUES placeholder list: (?, ?, ...) per row
    const valuePlaceholders = chunk.map(() =>
      '(' + allColumns.map(() => '?').join(', ') + ')'
    ).join(',\n    ');

    // Build the SELECT column list for the USING clause with optional ::DATE casts
    const selectCols = allColumns.map(col =>
      dateSet.has(col)
        ? `column${allColumns.indexOf(col) + 1}::DATE AS ${col}`
        : `column${allColumns.indexOf(col) + 1} AS ${col}`
    ).join(', ');

    // Build the ON match condition
    const onClause = keyColumns.map(col => `t.${col} = s.${col}`).join(' AND ');

    // Build the UPDATE SET clause (only data columns, not key columns)
    const updateClause = dataColumns.map(col => `${col} = s.${col}`).join(',\n        ');

    // Build the INSERT columns and VALUES
    const insertCols = allColumns.join(', ') + ', synced_at';
    const insertVals = allColumns.map(col => `s.${col}`).join(', ') + ', CURRENT_TIMESTAMP';

    const sql = `
      MERGE INTO ${table} t
      USING (
        SELECT ${selectCols}
        FROM VALUES
          ${valuePlaceholders}
      ) s
      ON ${onClause}
      WHEN MATCHED THEN UPDATE SET
        ${updateClause},
        synced_at = CURRENT_TIMESTAMP
      WHEN NOT MATCHED THEN INSERT (${insertCols})
        VALUES (${insertVals})
    `;

    // Flatten all column values from all rows into a single binds array
    const binds = [];
    for (const row of chunk) {
      for (const col of allColumns) {
        const val = row[col];
        binds.push(val === undefined ? null : val);
      }
    }

    const result = await query(sql, binds);
    // Snowflake MERGE result: [{ "number of rows inserted": N, "number of rows updated": M }]
    const inserted = result?.[0]?.['number of rows inserted'] ?? 0;
    const updated  = result?.[0]?.['number of rows updated']  ?? 0;
    totalWritten += inserted + updated;
  }

  return totalWritten;
}

module.exports = { getConnection, query, exec, batchMerge };
