require('dotenv').config();
const snowflake = require('snowflake-sdk');
const fs = require('fs');
const crypto = require('crypto');

snowflake.configure({ logLevel: 'ERROR' });

// ─── Connection Pool ──────────────────────────────────────────────────────────
// Simple pool: up to MAX_POOL_SIZE connections, with health checking.
// Prevents the single-connection hang that occurs under concurrent load.

const MAX_POOL_SIZE  = 16; // reduced from 32 — pipeline is now 6h cadence, not continuous; 16 is plenty for burst
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

  // sessionParameters: { TIMEZONE: 'UTC' } in createConnectionConfig() handles TZ at login.
  // No post-connect ALTER SESSION needed — removes ~700 redundant queries/day from warehouse.

  return conn;
}

function isAlive(entry) {
  // conn.isUp() lies for terminated connections in the Snowflake SDK — it returns true
  // even after the server closes the connection. We track termination ourselves via
  // entry.terminated, set whenever a query fails with a terminated-connection error.
  if (entry.terminated) return false;
  try { return entry.conn && entry.conn.isUp && entry.conn.isUp(); }
  catch { return false; }
}

async function acquireConnection() {
  // Find a free, healthy connection
  for (const entry of pool) {
    if (!entry.inUse && isAlive(entry)) {
      entry.inUse = true;
      entry.acquiredAt = Date.now();
      return entry;
    }
  }

  // Create a new one if pool has space
  if (pool.length < MAX_POOL_SIZE) {
    const conn = await createConnection();
    const entry = { conn, inUse: true, createdAt: Date.now(), acquiredAt: Date.now() };
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
      entry.acquiredAt = Date.now();
      resolve(entry);
    });
  });
}

function releaseConnection(entry) {
  entry.inUse = false;
  entry.lastUsedAt = Date.now();

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

// Errors that indicate the connection is dead and we should retry with a fresh one
const TERMINATED_PATTERNS = [
  'terminated connection',
  'connection is terminated',
  'unable to perform operation using terminated connection',
  'network error',
  'connection was closed',
];

function isTerminatedError(err) {
  if (!err || !err.message) return false;
  const msg = err.message.toLowerCase();
  return TERMINATED_PATTERNS.some(p => msg.includes(p));
}

async function _executeQuery(entry, sqlText, binds) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      removeConnection(entry);
      reject(new Error(`[Snowflake] Query timeout (${QUERY_TIMEOUT}ms): ${sqlText.substring(0, 100)}`));
    }, QUERY_TIMEOUT);

    entry.conn.execute({
      sqlText,
      binds,
      complete: (err, stmt, rows) => {
        clearTimeout(timer);
        if (err) {
          // Mark as terminated before evicting so isAlive() catches it going forward
          if (isTerminatedError(err)) entry.terminated = true;
          removeConnection(entry);
          // Surface schema errors clearly
          if (err.message?.includes('invalid identifier')) {
            const match = err.message.match(/invalid identifier '([^']+)'/i);
            const col = match ? match[1] : 'unknown';
            console.error(`[Snowflake] ❌ Schema error — column: ${col}`);
            console.error(`[Snowflake] SQL: ${sqlText.substring(0, 200).replace(/\s+/g, ' ')}`);
          }
          return reject(err);
        }
        releaseConnection(entry);
        resolve(rows);
      }
    });
  });
}

async function query(sqlText, binds = []) {
  let entry;
  try {
    entry = await acquireConnection();
  } catch (err) {
    throw new Error(`[Snowflake] Pool error: ${err.message}`);
  }

  try {
    return await _executeQuery(entry, sqlText, binds);
  } catch (err) {
    // If the connection was terminated, retry once with a fresh connection
    if (isTerminatedError(err)) {
      console.warn('[Snowflake] ⚠️  Terminated connection detected — retrying with fresh connection');
      let retryEntry;
      try {
        retryEntry = await acquireConnection();
      } catch (poolErr) {
        throw new Error(`[Snowflake] Pool error on retry: ${poolErr.message}`);
      }
      return await _executeQuery(retryEntry, sqlText, binds);
    }
    throw err;
  }
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

// ─── Health check: prune dead + leaked connections every 2 min ──────────────────
// Leaked = in-use for >5 min (query timeout should prevent this, but exception
// paths can leave connections permanently stuck, exhausting the pool).
const LEAK_THRESHOLD_MS = 5 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  let pruned = 0, leaked = 0;
  for (let i = pool.length - 1; i >= 0; i--) {
    const entry = pool[i];
    if (!entry.inUse && !isAlive(entry)) {
      pool.splice(i, 1);
      pruned++;
      continue;
    }
    if (entry.inUse && entry.acquiredAt && (now - entry.acquiredAt) > LEAK_THRESHOLD_MS) {
      console.warn(`[Snowflake] ⚠️  Leaked connection (held ${Math.round((now - entry.acquiredAt)/1000)}s) — force releasing`);
      entry.inUse = false;
      entry.acquiredAt = null;
      leaked++;
      if (waitQueue.length > 0) {
        const next = waitQueue.shift();
        entry.inUse = true;
        entry.acquiredAt = Date.now();
        next(entry);
      }
    }
  }
  if (pruned > 0) console.log(`[Snowflake] Pruned ${pruned} dead connection(s)`);
  if (leaked > 0) console.log(`[Snowflake] Force-released ${leaked} leaked connection(s)`);
}, 2 * 60 * 1000);

// ─── Keepalive: ping idle connections to prevent Snowflake idle timeout ──────
// Snowflake drops idle connections after ~4h by default (account setting).
// We only ping connections idle >3.5h — this lets the warehouse auto-suspend
// (60s threshold) between job cycles instead of staying awake 24/7.
// Terminated connections are caught by the prune interval and recreated on demand.
const KEEPALIVE_IDLE_MS  = 3.5 * 60 * 60 * 1000; // 3.5 hours
const KEEPALIVE_CHECK_MS =  30 * 60 * 1000;        // check every 30 min
setInterval(() => {
  const now = Date.now();
  for (const entry of pool) {
    if (entry.inUse || !isAlive(entry)) continue;
    const idleMs = entry.lastUsedAt ? now - entry.lastUsedAt : now - entry.createdAt;
    if (idleMs > KEEPALIVE_IDLE_MS) {
      entry.conn.execute({
        sqlText: 'SELECT 1',
        complete: (err) => {
          if (err) {
            entry.terminated = true;
            removeConnection(entry);
          } else {
            entry.lastUsedAt = Date.now();
          }
        }
      });
    }
  }
}, KEEPALIVE_CHECK_MS);

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

// ─── resetPool: evict all terminated connections, force-fresh on next acquire ──
function resetPool() {
  const terminated = pool.filter(e => e.terminated || e.inUse === false);
  for (const entry of terminated) {
    removeConnection(entry);
  }
  console.log(`[Snowflake] resetPool — evicted ${terminated.length} connections`);
}

module.exports = { getConnection, query, exec, batchMerge, resetPool };
