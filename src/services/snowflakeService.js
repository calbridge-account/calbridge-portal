require('dotenv').config();
const snowflake = require('snowflake-sdk');

snowflake.configure({ logLevel: 'ERROR' });

// ─── Connection Pool ──────────────────────────────────────────────────────────
// Simple pool: up to MAX_POOL_SIZE connections, with health checking.
// Prevents the single-connection hang that occurs under concurrent load.

const MAX_POOL_SIZE  = 4;
const QUERY_TIMEOUT  = 30000; // 30s per query
const CONNECT_TIMEOUT = 15000; // 15s to establish connection

const pool = [];       // { conn, inUse, createdAt }
const waitQueue = [];  // resolve fns waiting for a free connection

function createConnectionConfig() {
  return {
    account:   process.env.SNOWFLAKE_ACCOUNT,
    username:  process.env.SNOWFLAKE_USER,
    password:  process.env.SNOWFLAKE_PASSWORD,
    warehouse: process.env.SNOWFLAKE_WAREHOUSE,
    database:  process.env.SNOWFLAKE_DATABASE,
    schema:    process.env.SNOWFLAKE_SCHEMA,
    loginTimeout: 15,
    networkTimeout: 30000
  };
}

async function createConnection() {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Snowflake connect timeout')), CONNECT_TIMEOUT);
    const conn = snowflake.createConnection(createConnectionConfig());
    conn.connect((err, c) => {
      clearTimeout(timer);
      if (err) return reject(err);
      resolve(c);
    });
  });
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
      reject(new Error('Snowflake pool exhausted — no free connection after 10s'));
    }, 10000);

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

module.exports = { getConnection, query, exec };
