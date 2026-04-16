require('dotenv').config();
const { query } = require('./src/services/snowflakeService');
const fs = require('fs');

const CLIENT_ID = '7d88ea17-002b-4a02-97fc-bcab1292d57e';

async function main() {
  // First, get all SP_ADVERTISED_PRODUCT_REPORT columns
  console.log('Getting full SP column list...');
  const spCols = await query(`
    SELECT COLUMN_NAME FROM CALBRIDGE_PROD.INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA='APP' AND TABLE_NAME='SP_ADVERTISED_PRODUCT_REPORT'
    ORDER BY ORDINAL_POSITION
  `);
  console.log('All SP columns:', spCols.map(c => c.COLUMN_NAME).join(', '));

  // Check if there's any CyberPower data at all
  console.log('\nChecking CyberPower SP data existence...');
  const spCheck = await query(`
    SELECT COUNT(*) as cnt, MIN(DATE) as min_date, MAX(DATE) as max_date
    FROM CALBRIDGE_PROD.APP.SP_ADVERTISED_PRODUCT_REPORT
    WHERE CLIENT_ID = '${CLIENT_ID}'
  `);
  console.log('SP data check:', JSON.stringify(spCheck[0]));

  // Check vendor inventory for CyberPower
  console.log('\nChecking CyberPower vendor inventory...');
  const invCheck = await query(`
    SELECT COUNT(*) as cnt, MIN(START_DATE) as min_date, MAX(END_DATE) as max_date
    FROM CALBRIDGE_PROD.APP.VENDOR_INVENTORY
    WHERE CLIENT_ID = '${CLIENT_ID}'
  `);
  console.log('Inventory check:', JSON.stringify(invCheck[0]));

  process.exit(0);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
