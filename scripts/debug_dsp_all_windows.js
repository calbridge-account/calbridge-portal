require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { query } = require('../src/services/snowflakeService');

async function main() {
  const clientId = '7d88ea17-002b-4a02-97fc-bcab1292d57e';

  // Check what the /advertising/dsp-summary route returns (uses ACP directly)
  // vs what /advertising/ returns (uses mart for summary)
  // vs what the advertising tab DSP card shows

  const windows = [7, 14, 30, 60, 90];
  console.log('DSP sales by date window:\n');
  console.log('Window | Mart Sales | ACP Sales | Raw CR total_sales | Raw CR sales(click)');
  for (const days of windows) {
    const [mart, acp, cr] = await Promise.all([
      query(`SELECT SUM(sales) AS s FROM CALBRIDGE_PROD.MARTS_MARTS.mart_advertising_daily WHERE client_id=? AND ad_type='DSP' AND date >= DATEADD('day', -${days}, CURRENT_DATE())`, [clientId]),
      query(`SELECT SUM(sales) AS s FROM CALBRIDGE_PROD.APP.adjusted_campaign_performance WHERE client_id=? AND ad_type='DSP' AND date >= DATEADD('day', -${days}, CURRENT_DATE())`, [clientId]),
      query(`SELECT SUM(COALESCE(total_sales,0)) AS ts, SUM(COALESCE(sales,0)) AS s FROM CALBRIDGE_PROD.APP.dsp_campaign_report WHERE client_id=? AND date >= DATEADD('day', -${days}, CURRENT_DATE())`, [clientId]),
    ]);
    console.log(`  ${days}d   | ${Number(mart[0].S||0).toFixed(0).padStart(10)} | ${Number(acp[0].S||0).toFixed(0).padStart(9)} | ${Number(cr[0].TS||0).toFixed(0).padStart(18)} | ${Number(cr[0].S||0).toFixed(0)}`);
  }

  // Check the dsp-summary route specifically — it uses adjusted_campaign_performance with ad_type=DSP
  // and SUM(sales) — confirm that matches
  const dspSummary = await query(`
    SELECT
      SUM(adjusted_spend) AS spend,
      SUM(sales)          AS sales,
      SUM(total_purchases) AS total_purchases,
      SUM(orders)         AS orders,
      SUM(detail_page_views) AS dpv,
      SUM(new_to_brand_purchases) AS ntb_purchases,
      SUM(new_to_brand_sales) AS ntb_sales
    FROM CALBRIDGE_PROD.APP.adjusted_campaign_performance
    WHERE client_id = ? AND ad_type = 'DSP'
      AND date >= DATEADD('day', -30, CURRENT_DATE())
  `, [clientId]);
  console.log('\nDSP Summary card (what /advertising/dsp-summary returns, 30d):');
  console.log(JSON.stringify(dspSummary[0], null, 2));

  // What does the advertising tab "combined" summary show for all channels?
  const combined = await query(`
    SELECT SUM(spend) AS spend, SUM(sales) AS sales, SUM(orders) AS orders
    FROM CALBRIDGE_PROD.MARTS_MARTS.mart_advertising_daily
    WHERE client_id = ? AND date >= DATEADD('day', -30, CURRENT_DATE())
  `, [clientId]);
  console.log('\nCombined summary (mart, 30d, what performance tab header shows):');
  console.log(`  spend=${Number(combined[0].SPEND||0).toFixed(2)}, sales=${Number(combined[0].SALES||0).toFixed(2)}, orders=${combined[0].ORDERS}`);

  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
