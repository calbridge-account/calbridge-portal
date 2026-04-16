require('dotenv').config();
const { query } = require('./src/services/snowflakeService');
const fs = require('fs');

const CLIENT_ID = '7d88ea17-002b-4a02-97fc-bcab1292d57e';

async function main() {
  console.log('=== Part 1: SP Advertised Product Data (April MTD) ===');
  const spAprData = await query(`
    SELECT 
      ADVERTISED_ASIN as asin,
      SUM(COST) as total_spend,
      SUM(SALES_14_D) as total_sales,
      SUM(PURCHASES_14_D) as total_orders,
      SUM(CLICKS) as total_clicks,
      SUM(IMPRESSIONS) as total_impressions,
      COUNT(DISTINCT DATE) as days_active,
      CASE WHEN SUM(COST) > 0 THEN SUM(SALES_14_D) / SUM(COST) ELSE 0 END as roas
    FROM CALBRIDGE_PROD.APP.SP_ADVERTISED_PRODUCT_REPORT
    WHERE CLIENT_ID = '${CLIENT_ID}'
      AND DATE >= '2026-04-01' AND DATE <= '2026-04-14'
      AND ADVERTISED_ASIN IS NOT NULL AND ADVERTISED_ASIN != ''
    GROUP BY ADVERTISED_ASIN
    ORDER BY total_sales DESC
  `);
  console.log(`SP April MTD rows: ${spAprData.length}`);
  console.log('Sample:', JSON.stringify(spAprData.slice(0,3), null, 2));

  console.log('\n=== Part 2: Latest Vendor Inventory ===');
  const invData = await query(`
    WITH latest_inv AS (
      SELECT 
        ASIN,
        SELLABLE_ON_HAND_UNITS,
        SELLABLE_ON_HAND_COST,
        UNSELLABLE_ON_HAND_UNITS,
        SELL_THROUGH_RATE,
        AGED_90_PLUS_UNITS,
        UNHEALTHY_UNITS,
        OPEN_PURCHASE_ORDER_UNITS,
        END_DATE,
        ROW_NUMBER() OVER (PARTITION BY ASIN ORDER BY END_DATE DESC) as rn
      FROM CALBRIDGE_PROD.APP.VENDOR_INVENTORY
      WHERE CLIENT_ID = '${CLIENT_ID}'
        AND SELLABLE_ON_HAND_UNITS > 0
    )
    SELECT * FROM latest_inv WHERE rn = 1
    ORDER BY SELLABLE_ON_HAND_UNITS DESC
  `);
  console.log(`Inventory rows: ${invData.length}`);
  console.log('Sample:', JSON.stringify(invData.slice(0,3), null, 2));

  console.log('\n=== Part 3: Budget Data ===');
  let budgetData = [];
  try {
    budgetData = await query(`
      SELECT 
        b.BUDGET_ID,
        b.NAME as budget_name,
        b.TOTAL_AMOUNT,
        b.CURRENCY,
        b.PERIOD_START,
        b.PERIOD_END,
        b.NOTES
      FROM CALBRIDGE_PROD.APP.CLIENT_BUDGETS b
      WHERE b.CLIENT_ID = '${CLIENT_ID}'
      ORDER BY b.PERIOD_START DESC
      LIMIT 20
    `);
    console.log(`Budget rows: ${budgetData.length}`);
    console.log('Budgets:', JSON.stringify(budgetData, null, 2));
  } catch (e) { console.error('Budget error:', e.message); }

  console.log('\n=== Part 4: Budget Campaign Map ===');
  let budgetCampaigns = [];
  try {
    budgetCampaigns = await query(`
      SELECT 
        bcm.BUDGET_ID,
        bcm.CAMPAIGN_ID,
        bcm.CAMPAIGN_NAME,
        bcm.AD_TYPE
      FROM CALBRIDGE_PROD.APP.BUDGET_CAMPAIGN_MAP bcm
      WHERE bcm.CLIENT_ID = '${CLIENT_ID}'
      LIMIT 50
    `);
    console.log(`Budget campaign map rows: ${budgetCampaigns.length}`);
  } catch (e) { console.error('Budget campaign map error:', e.message); }

  console.log('\n=== Part 5: SP Campaign-level Performance April MTD ===');
  let campaignPerf = [];
  try {
    campaignPerf = await query(`
      SELECT 
        CAMPAIGN_ID,
        CAMPAIGN_NAME,
        SUM(COST) as total_spend,
        SUM(SALES_14_D) as total_sales,
        SUM(PURCHASES_14_D) as total_orders,
        SUM(CLICKS) as total_clicks,
        CASE WHEN SUM(COST) > 0 THEN SUM(SALES_14_D) / SUM(COST) ELSE 0 END as roas,
        CASE WHEN SUM(SALES_14_D) > 0 THEN SUM(COST) / SUM(SALES_14_D) * 100 ELSE NULL END as acos_pct
      FROM CALBRIDGE_PROD.APP.SP_ADVERTISED_PRODUCT_REPORT
      WHERE CLIENT_ID = '${CLIENT_ID}'
        AND DATE >= '2026-04-01' AND DATE <= '2026-04-14'
      GROUP BY CAMPAIGN_ID, CAMPAIGN_NAME
      ORDER BY total_spend DESC
      LIMIT 30
    `);
    console.log(`Campaign perf rows: ${campaignPerf.length}`);
  } catch (e) { console.error('Campaign perf error:', e.message); }

  console.log('\n=== Part 6: Vendor Sales for velocity context ===');
  let vendorSales = [];
  try {
    vendorSales = await query(`
      SELECT COLUMN_NAME FROM CALBRIDGE_PROD.INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA='APP' AND TABLE_NAME='VENDOR_SALES'
      ORDER BY ORDINAL_POSITION LIMIT 20
    `);
    console.log('VENDOR_SALES cols:', vendorSales.map(c => c.COLUMN_NAME).join(', '));
    
    // Get recent vendor sales velocity
    vendorSales = await query(`
      SELECT * FROM CALBRIDGE_PROD.APP.VENDOR_SALES
      WHERE CLIENT_ID = '${CLIENT_ID}'
      ORDER BY END_DATE DESC
      LIMIT 5
    `);
    console.log('Vendor sales sample:', JSON.stringify(vendorSales.slice(0,2), null, 2));
  } catch (e) { console.error('Vendor sales error:', e.message); }

  // Write all raw data
  fs.writeFileSync('/tmp/cp-analysis-data.json', JSON.stringify({
    spAprData,
    invData,
    budgetData,
    budgetCampaigns,
    campaignPerf
  }, null, 2));
  console.log('\nAll data written to /tmp/cp-analysis-data.json');
  
  process.exit(0);
}

main().catch(e => { console.error('Fatal:', e.message, e.stack); process.exit(1); });
