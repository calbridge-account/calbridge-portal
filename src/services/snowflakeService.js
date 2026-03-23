require('dotenv').config();
const snowflake = require('snowflake-sdk');

// Suppress verbose SDK logs in production
snowflake.configure({ logLevel: process.env.NODE_ENV === 'development' ? 'WARN' : 'ERROR' });

let _connection = null;

/**
 * Get (or create) a persistent Snowflake connection
 */
async function getConnection() {
  if (_connection && _connection.isUp()) return _connection;

  return new Promise((resolve, reject) => {
    const conn = snowflake.createConnection({
      account:   process.env.SNOWFLAKE_ACCOUNT,
      username:  process.env.SNOWFLAKE_USER,
      password:  process.env.SNOWFLAKE_PASSWORD,
      warehouse: process.env.SNOWFLAKE_WAREHOUSE,
      database:  process.env.SNOWFLAKE_DATABASE,
      schema:    process.env.SNOWFLAKE_SCHEMA
    });

    conn.connect((err, c) => {
      if (err) return reject(err);
      _connection = c;
      console.log('[Snowflake] Connected');
      resolve(c);
    });
  });
}

/**
 * Execute a SQL query with optional binds.
 * Catches invalid column errors and logs them clearly for debugging.
 */
async function query(sqlText, binds = []) {
  const conn = await getConnection();
  return new Promise((resolve, reject) => {
    conn.execute({
      sqlText,
      binds,
      complete: (err, stmt, rows) => {
        if (err) {
          // Surface schema errors clearly
          if (err.message && err.message.includes('invalid identifier')) {
            const match = err.message.match(/invalid identifier '([^']+)'/i);
            const col = match ? match[1] : 'unknown';
            console.error(`[Snowflake] ❌ Schema error — unknown column: ${col}`);
            console.error(`[Snowflake] SQL: ${sqlText.substring(0, 200).replace(/\s+/g, ' ')}`);
          }
          return reject(err);
        }
        resolve(rows);
      }
    });
  });
}

/**
 * Execute multiple statements (schema setup, etc.)
 */
async function exec(sqlText) {
  return query(sqlText);
}

module.exports = { getConnection, query, exec };
