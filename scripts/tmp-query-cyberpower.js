require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { query } = require('../src/services/snowflakeService');

async function main() {
  try {
    // Check what columns exist in the clients table
    const cols = await query(`
      SELECT column_name, data_type
      FROM CALBRIDGE_PROD.INFORMATION_SCHEMA.COLUMNS
      WHERE table_schema = 'APP' AND table_name = 'CLIENTS'
      ORDER BY ordinal_position
    `);
    console.log('CLIENTS table columns:', JSON.stringify(cols, null, 2));
    
    // Fetch the CyberPower client row
    const rows = await query(`
      SELECT * FROM CALBRIDGE_PROD.APP.CLIENTS
      WHERE client_id = '7d88ea17-002b-4a02-97fc-bcab1292d57e'
      LIMIT 1
    `);
    console.log('CyberPower row:', JSON.stringify(rows, null, 2));
    process.exit(0);
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
}

main();
