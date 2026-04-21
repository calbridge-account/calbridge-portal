require('dotenv').config();
const { query } = require('./src/services/snowflakeService');

async function main() {
  // Check what tokens we have for this client
  try {
    const rows = await query(`
      SELECT connection_type, expires_at, SUBSTRING(access_token, 1, 20) as token_preview
      FROM CALBRIDGE_PROD.APP.amazon_connections
      WHERE client_id = '7d88ea17-002b-4a02-97fc-bcab1292d57e'
      ORDER BY connection_type
    `);
    console.log('Connections:', JSON.stringify(rows, null, 2));
  } catch(e) {
    console.log('No amazon_connections table or error:', e.message);
    // Try alternate table name
    const rows2 = await query(`
      SHOW TABLES LIKE '%connection%' IN CALBRIDGE_PROD.APP
    `);
    console.log('Tables:', JSON.stringify(rows2, null, 2));
  }
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
