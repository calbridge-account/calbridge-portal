require('dotenv').config();
const { query } = require('./src/services/snowflakeService');
const fs = require('fs');
const path = require('path');

const CLIENT_ID = '7d88ea17-002b-4a02-97fc-bcab1292d57e';

async function main() {
  console.log('Step 1: Checking available tables...');
  const tables = await query(`
    SELECT TABLE_NAME
    FROM CALBRIDGE_PROD.INFORMATION_SCHEMA.TABLES 
    WHERE TABLE_SCHEMA='APP' 
    ORDER BY TABLE_NAME
  `);
  const tableNames = tables.map(t => t.TABLE_NAME);
  console.log('Tables:', tableNames.join(', '));

  // Check if inventory tables exist
  const invTables = tableNames.filter(t => 
    t.toLowerCase().includes('inventor') || 
    t.toLowerCase().includes('stock') ||
    t.toLowerCase().includes('supply')
  );
  console.log('Inventory-related tables:', invTables);

  const adTables = tableNames.filter(t => 
    t.toLowerCase().includes('sp_') || 
    t.toLowerCase().includes('campaign') ||
    t.toLowerCase().includes('advertis') ||
    t.toLowerCase().includes('budget')
  );
  console.log('Ad-related tables:', adTables);

  // Step 2: Get SP advertised product data for April MTD
  console.log('\nStep 2: Fetching SP advertised product data for April MTD...');
  let spData = [];
  try {
    spData = await query(`
      SELECT 
        ASIN,
        SUM(SPEND) as total_spend,
        SUM(SALES_14D) as total_sales,
        SUM(ORDERS_14D) as total_orders,
        SUM(CLICKS) as total_clicks,
        SUM(IMPRESSIONS) as total_impressions,
        COUNT(DISTINCT DATE) as days_active,
        CASE WHEN SUM(SPEND) > 0 THEN SUM(SALES_14D) / SUM(SPEND) ELSE 0 END as roas
      FROM CALBRIDGE_PROD.APP.SP_ADVERTISED_PRODUCT_REPORT
      WHERE CLIENT_ID = '${CLIENT_ID}'
        AND DATE >= '2026-04-01' AND DATE <= '2026-04-14'
        AND ASIN IS NOT NULL AND ASIN != ''
      GROUP BY ASIN
      ORDER BY total_sales DESC
    `);
    console.log(`SP data rows: ${spData.length}`);
  } catch (e) {
    console.error('SP query error:', e.message);
    // Try alternate column names
    try {
      const cols = await query(`
        SELECT COLUMN_NAME FROM CALBRIDGE_PROD.INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA='APP' AND TABLE_NAME='SP_ADVERTISED_PRODUCT_REPORT'
        ORDER BY ORDINAL_POSITION LIMIT 30
      `);
      console.log('SP_ADVERTISED_PRODUCT_REPORT columns:', cols.map(c => c.COLUMN_NAME).join(', '));
    } catch(e2) { console.error('Could not get columns:', e2.message); }
  }

  // Step 3: Check for inventory table columns
  console.log('\nStep 3: Checking inventory tables...');
  let inventoryData = [];
  
  for (const tbl of invTables) {
    try {
      const cols = await query(`
        SELECT COLUMN_NAME FROM CALBRIDGE_PROD.INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA='APP' AND TABLE_NAME='${tbl}'
        ORDER BY ORDINAL_POSITION LIMIT 30
      `);
      console.log(`${tbl} columns:`, cols.map(c => c.COLUMN_NAME).join(', '));
    } catch(e) { console.error(`Error checking ${tbl}:`, e.message); }
  }

  // Also check vendor central / vendor inventory tables
  const vendorTables = tableNames.filter(t => t.toLowerCase().includes('vendor'));
  console.log('Vendor tables:', vendorTables);
  for (const tbl of vendorTables.slice(0,5)) {
    try {
      const cols = await query(`
        SELECT COLUMN_NAME FROM CALBRIDGE_PROD.INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA='APP' AND TABLE_NAME='${tbl}'
        ORDER BY ORDINAL_POSITION LIMIT 20
      `);
      console.log(`${tbl} columns:`, cols.map(c => c.COLUMN_NAME).join(', '));
    } catch(e) { console.error(`Error checking ${tbl}:`, e.message); }
  }

  // Step 4: Check budget tables
  console.log('\nStep 4: Checking budget tables...');
  const budgetTables = tableNames.filter(t => t.toLowerCase().includes('budget'));
  for (const tbl of budgetTables) {
    try {
      const cols = await query(`
        SELECT COLUMN_NAME FROM CALBRIDGE_PROD.INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA='APP' AND TABLE_NAME='${tbl}'
        ORDER BY ORDINAL_POSITION LIMIT 20
      `);
      console.log(`${tbl} columns:`, cols.map(c => c.COLUMN_NAME).join(', '));
    } catch(e) { console.error(`Error checking ${tbl}:`, e.message); }
  }

  console.log('\nSP data sample:', JSON.stringify(spData.slice(0,3), null, 2));
  
  fs.writeFileSync('/tmp/cyberpower-raw-data.json', JSON.stringify({
    tableNames,
    invTables,
    adTables,
    vendorTables,
    budgetTables,
    spData
  }, null, 2));
  console.log('\nRaw data written to /tmp/cyberpower-raw-data.json');
  
  process.exit(0);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
