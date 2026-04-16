require('dotenv').config();
const { query } = require('./src/services/snowflakeService');
const fs = require('fs');

const CLIENT_ID = '7d88ea17-002b-4a02-97fc-bcab1292d57e';

async function main() {
  // Check why SALES_14_D is null -- look at a raw row
  console.log('=== Raw SP row sample ===');
  const rawRow = await query(`
    SELECT *
    FROM CALBRIDGE_PROD.APP.SP_ADVERTISED_PRODUCT_REPORT
    WHERE CLIENT_ID = '${CLIENT_ID}'
      AND DATE >= '2026-04-01' AND DATE <= '2026-04-14'
    LIMIT 3
  `);
  console.log('Raw row:', JSON.stringify(rawRow[0], null, 2));

  // SP with SALES_1_D instead (more likely populated)
  console.log('\n=== SP April MTD with all sales windows ===');
  const spData = await query(`
    SELECT 
      ADVERTISED_ASIN as asin,
      SUM(COST) as total_spend,
      SUM(SALES_1_D) as sales_1d,
      SUM(SALES_7_D) as sales_7d,
      SUM(SALES_14_D) as sales_14d,
      SUM(SALES_30_D) as sales_30d,
      SUM(PURCHASES_1_D) as orders_1d,
      SUM(PURCHASES_7_D) as orders_7d,
      SUM(PURCHASES_14_D) as orders_14d,
      SUM(CLICKS) as clicks,
      SUM(IMPRESSIONS) as impressions,
      COUNT(DISTINCT DATE) as days
    FROM CALBRIDGE_PROD.APP.SP_ADVERTISED_PRODUCT_REPORT
    WHERE CLIENT_ID = '${CLIENT_ID}'
      AND DATE >= '2026-04-01' AND DATE <= '2026-04-14'
      AND ADVERTISED_ASIN IS NOT NULL
    GROUP BY ADVERTISED_ASIN
    ORDER BY total_spend DESC
    LIMIT 40
  `);
  console.log('SP data rows:', spData.length);
  console.log('Top 5:', JSON.stringify(spData.slice(0,5), null, 2));

  // Budget campaign map with SP spend join
  console.log('\n=== Campaign-level SP April ===');
  const campaignData = await query(`
    SELECT 
      sp.CAMPAIGN_ID,
      sp.CAMPAIGN_NAME,
      SUM(sp.COST) as spend,
      SUM(sp.SALES_14_D) as sales_14d,
      SUM(sp.SALES_7_D) as sales_7d,
      SUM(sp.PURCHASES_14_D) as orders,
      SUM(sp.CLICKS) as clicks,
      CASE WHEN SUM(sp.COST) > 0 THEN SUM(sp.SALES_14_D) / SUM(sp.COST) ELSE 0 END as roas_14d,
      CASE WHEN SUM(sp.COST) > 0 THEN SUM(sp.SALES_7_D) / SUM(sp.COST) ELSE 0 END as roas_7d
    FROM CALBRIDGE_PROD.APP.SP_ADVERTISED_PRODUCT_REPORT sp
    WHERE sp.CLIENT_ID = '${CLIENT_ID}'
      AND sp.DATE >= '2026-04-01' AND sp.DATE <= '2026-04-14'
    GROUP BY sp.CAMPAIGN_ID, sp.CAMPAIGN_NAME
    ORDER BY spend DESC
    LIMIT 30
  `);
  console.log('Campaign rows:', campaignData.length);
  console.log('All campaigns:', JSON.stringify(campaignData, null, 2));

  // Budget campaign map
  console.log('\n=== Budget Campaign Map ===');
  const bcmData = await query(`
    SELECT BUDGET_ID, CAMPAIGN_ID, CAMPAIGN_NAME, AD_TYPE
    FROM CALBRIDGE_PROD.APP.BUDGET_CAMPAIGN_MAP
    WHERE CLIENT_ID = '${CLIENT_ID}'
    LIMIT 60
  `);
  console.log('BCM rows:', bcmData.length);
  console.log('BCM sample:', JSON.stringify(bcmData.slice(0,10), null, 2));

  // Vendor sales April MTD aggregated by ASIN
  console.log('\n=== Vendor Sales April MTD ===');
  const vendorSalesApr = await query(`
    SELECT 
      ASIN,
      SUM(ORDERED_UNITS) as ordered_units,
      SUM(ORDERED_REVENUE) as ordered_revenue,
      SUM(SHIPPED_UNITS) as shipped_units,
      SUM(SHIPPED_REVENUE) as shipped_revenue
    FROM CALBRIDGE_PROD.APP.VENDOR_SALES
    WHERE CLIENT_ID = '${CLIENT_ID}'
      AND START_DATE >= '2026-04-01' AND END_DATE <= '2026-04-14'
    GROUP BY ASIN
    ORDER BY ordered_revenue DESC
    LIMIT 50
  `);
  console.log('Vendor sales April rows:', vendorSalesApr.length);
  console.log('Top 5:', JSON.stringify(vendorSalesApr.slice(0,5), null, 2));

  // Latest inventory - top 30 by on-hand units
  console.log('\n=== Latest Inventory (top 30 by units) ===');
  const invTop = await query(`
    WITH latest_inv AS (
      SELECT 
        ASIN,
        SELLABLE_ON_HAND_UNITS,
        SELLABLE_ON_HAND_COST,
        SELL_THROUGH_RATE,
        AGED_90_PLUS_UNITS,
        UNHEALTHY_UNITS,
        OPEN_PURCHASE_ORDER_UNITS,
        END_DATE,
        ROW_NUMBER() OVER (PARTITION BY ASIN ORDER BY END_DATE DESC) as rn
      FROM CALBRIDGE_PROD.APP.VENDOR_INVENTORY
      WHERE CLIENT_ID = '${CLIENT_ID}'
    )
    SELECT * EXCLUDE(rn)
    FROM latest_inv 
    WHERE rn = 1
    ORDER BY SELLABLE_ON_HAND_UNITS DESC
    LIMIT 30
  `);
  console.log('Top inventory:', JSON.stringify(invTop, null, 2));

  fs.writeFileSync('/tmp/cp-analysis-full.json', JSON.stringify({
    spData,
    campaignData,
    bcmData,
    vendorSalesApr,
    invTop,
    rawSpRow: rawRow[0]
  }, null, 2));
  console.log('\nFull data written.');
  process.exit(0);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
