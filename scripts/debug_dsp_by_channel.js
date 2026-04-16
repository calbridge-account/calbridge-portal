require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { query } = require('../src/services/snowflakeService');

async function main() {
  const clientId = '7d88ea17-002b-4a02-97fc-bcab1292d57e';

  // Simulate exactly what /advertising/by-channel returns (ACP, 30d)
  const byChannel = await query(`
    WITH cp AS (
      SELECT ad_type,
        SUM(impressions) AS impressions,
        SUM(clicks)      AS clicks,
        SUM(adjusted_spend) AS spend,
        SUM(sales)       AS sales,
        SUM(orders)      AS orders
      FROM CALBRIDGE_PROD.APP.adjusted_campaign_performance
      WHERE client_id = ?
        AND date >= DATEADD('day', -30, CURRENT_DATE())
      GROUP BY ad_type
    )
    SELECT ad_type, impressions, clicks, spend, sales, orders,
      CASE WHEN sales > 0 THEN spend/sales ELSE NULL END AS acos,
      CASE WHEN spend > 0 THEN sales/spend ELSE NULL END AS roas
    FROM cp ORDER BY spend DESC
  `, [clientId]);
  console.log('/advertising/by-channel (what DSP card shows, 30d):');
  byChannel.forEach(r => console.log(`  ${r.AD_TYPE}: spend=${Number(r.SPEND||0).toFixed(0)}, sales=${Number(r.SALES||0).toFixed(0)}, roas=${r.ROAS ? Number(r.ROAS).toFixed(2) : '—'}`));

  // Simulate /advertising/summary (mart, 30d)
  const summary = await query(`
    SELECT SUM(spend) AS spend, SUM(sales) AS sales, SUM(orders) AS orders
    FROM CALBRIDGE_PROD.MARTS_MARTS.mart_advertising_daily
    WHERE client_id = ? AND date >= DATEADD('day', -30, CURRENT_DATE())
  `, [clientId]);
  console.log('\n/advertising/summary (header KPIs, 30d):');
  console.log(`  total: spend=${Number(summary[0].SPEND||0).toFixed(0)}, sales=${Number(summary[0].SALES||0).toFixed(0)}`);

  // What does the dsp-summary card show?
  const dspSummary = await query(`
    SELECT SUM(adjusted_spend) AS spend, SUM(sales) AS sales,
      SUM(total_purchases) AS total_purchases, SUM(orders) AS orders,
      SUM(detail_page_views) AS dpv,
      SUM(new_to_brand_purchases) AS ntb_purchases,
      SUM(new_to_brand_sales) AS ntb_sales,
      SUM(viewable_impressions) AS viewable_impressions,
      SUM(impressions) AS impressions
    FROM CALBRIDGE_PROD.APP.adjusted_campaign_performance
    WHERE client_id = ? AND ad_type = 'DSP'
      AND date >= DATEADD('day', -30, CURRENT_DATE())
  `, [clientId]);
  console.log('\n/advertising/dsp-summary (DSP detail card, 30d):');
  Object.entries(dspSummary[0]).forEach(([k,v]) => console.log(`  ${k}: ${Number(v||0).toFixed(2)}`));

  // Check what the DSP dsp-orders route returns for sales
  const dspOrders = await query(`
    SELECT campaign_id, MAX(campaign_name) AS order_name,
      SUM(adjusted_spend) AS spend, SUM(sales) AS sales, SUM(orders) AS purchases
    FROM CALBRIDGE_PROD.APP.adjusted_campaign_performance
    WHERE client_id = ? AND ad_type = 'DSP'
      AND date >= DATEADD('day', -30, CURRENT_DATE())
    GROUP BY campaign_id ORDER BY sales DESC LIMIT 10
  `, [clientId]);
  console.log('\n/advertising/dsp-orders (DSP orders table, 30d):');
  dspOrders.forEach(r => console.log(`  ${r.ORDER_NAME?.substring(0,50)}: spend=${Number(r.SPEND||0).toFixed(0)}, sales=${Number(r.SALES||0).toFixed(0)}`));
  console.log('  TOTAL:', dspOrders.reduce((s,r)=>s+Number(r.SALES||0),0).toFixed(0));

  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
