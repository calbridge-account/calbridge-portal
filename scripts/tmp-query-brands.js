require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { query } = require('../src/services/snowflakeService');

async function main() {
  try {
    // Check brands table structure
    const cols = await query(`
      SELECT column_name, data_type
      FROM CALBRIDGE_PROD.INFORMATION_SCHEMA.COLUMNS
      WHERE table_schema = 'APP' AND table_name = 'BRANDS'
      ORDER BY ordinal_position
    `);
    console.log('BRANDS table columns:', JSON.stringify(cols, null, 2));
    
    // Fetch CyberPower brands
    const rows = await query(`
      SELECT brand_id, name, marketplace, ads_profile_id, dsp_advertiser_id, sp_seller_id, sp_vendor_id
      FROM CALBRIDGE_PROD.APP.BRANDS
      WHERE client_id = '7d88ea17-002b-4a02-97fc-bcab1292d57e'
      LIMIT 10
    `);
    console.log('CyberPower brands:', JSON.stringify(rows, null, 2));
    process.exit(0);
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
}

main();
