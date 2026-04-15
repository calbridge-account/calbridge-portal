// Full mart rebuild after view fix — INSERT OVERWRITE to replace all rows
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { query } = require('../src/services/snowflakeService');

async function main() {
  console.log('Rebuilding mart_advertising_daily (full overwrite)...');
  await query(`
    INSERT OVERWRITE INTO CALBRIDGE_PROD.MARTS_MARTS.mart_advertising_daily
    SELECT
      client_id, date, ad_type,
      COUNT(DISTINCT campaign_id) AS active_campaigns,
      SUM(adjusted_spend)         AS spend,
      SUM(sales)                  AS sales,
      SUM(orders)                 AS orders,
      SUM(clicks)                 AS clicks,
      SUM(impressions)            AS impressions,
      CASE WHEN SUM(sales) > 0 THEN SUM(adjusted_spend) / SUM(sales) ELSE NULL END AS acos,
      CASE WHEN SUM(adjusted_spend) > 0 THEN SUM(sales) / SUM(adjusted_spend) ELSE NULL END AS roas,
      CASE WHEN SUM(impressions) > 0 THEN SUM(clicks) / SUM(impressions) ELSE NULL END AS ctr
    FROM CALBRIDGE_PROD.APP.adjusted_campaign_performance
    GROUP BY client_id, date, ad_type
  `);
  console.log('Done.');

  // Verify final numbers
  const clientId = '7d88ea17-002b-4a02-97fc-bcab1292d57e';
  const acp = await query(`
    SELECT ad_type, SUM(adjusted_spend) AS spend, SUM(sales) AS sales
    FROM CALBRIDGE_PROD.APP.adjusted_campaign_performance
    WHERE client_id = ? AND date >= DATEADD('day', -30, CURRENT_DATE())
    GROUP BY ad_type ORDER BY spend DESC
  `, [clientId]);
  const mart = await query(`
    SELECT ad_type, SUM(spend) AS spend, SUM(sales) AS sales
    FROM CALBRIDGE_PROD.MARTS_MARTS.mart_advertising_daily
    WHERE client_id = ? AND date >= DATEADD('day', -30, CURRENT_DATE())
    GROUP BY ad_type ORDER BY spend DESC
  `, [clientId]);

  console.log('\nACP (last 30d):');
  let acpTotal = 0, acpSales = 0;
  acp.forEach(r => { acpTotal += Number(r.SPEND||0); acpSales += Number(r.SALES||0); console.log(' ', r.AD_TYPE, '| spend:', Number(r.SPEND||0).toFixed(2), '| sales:', Number(r.SALES||0).toFixed(2)); });
  console.log('  TOTAL spend:', acpTotal.toFixed(2), '| sales:', acpSales.toFixed(2));

  console.log('\nMart (last 30d):');
  let martTotal = 0, martSales = 0;
  mart.forEach(r => { martTotal += Number(r.SPEND||0); martSales += Number(r.SALES||0); console.log(' ', r.AD_TYPE, '| spend:', Number(r.SPEND||0).toFixed(2), '| sales:', Number(r.SALES||0).toFixed(2)); });
  console.log('  TOTAL spend:', martTotal.toFixed(2), '| sales:', martSales.toFixed(2));
  console.log('\nMatch:', Math.abs(acpTotal - martTotal) < 0.01 && Math.abs(acpSales - martSales) < 0.01 ? '✅ PERFECT' : '❌ MISMATCH');

  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
