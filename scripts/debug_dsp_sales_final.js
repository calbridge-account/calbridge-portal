require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { query } = require('../src/services/snowflakeService');

async function main() {
  const clientId = '7d88ea17-002b-4a02-97fc-bcab1292d57e';

  // What does the advertising tab ACTUALLY show?
  // It reads mart for summary, ACP for trend/campaigns
  // Check mart for DSP sales
  const mart = await query(`
    SELECT ad_type, SUM(spend) AS spend, SUM(sales) AS sales
    FROM CALBRIDGE_PROD.MARTS_MARTS.mart_advertising_daily
    WHERE client_id = ? AND date >= DATEADD('day', -30, CURRENT_DATE())
    GROUP BY ad_type ORDER BY spend DESC
  `, [clientId]);
  console.log('MART (last 30d — what performance tab summary shows):');
  mart.forEach(r => console.log(`  ${r.AD_TYPE}: spend=${Number(r.SPEND||0).toFixed(0)}, sales=${Number(r.SALES||0).toFixed(0)}`));

  // ACP directly
  const acp = await query(`
    SELECT ad_type, SUM(adjusted_spend) AS spend, SUM(sales) AS sales
    FROM CALBRIDGE_PROD.APP.adjusted_campaign_performance
    WHERE client_id = ? AND date >= DATEADD('day', -30, CURRENT_DATE())
    GROUP BY ad_type ORDER BY spend DESC
  `, [clientId]);
  console.log('\nACP (last 30d — source of truth):');
  acp.forEach(r => console.log(`  ${r.AD_TYPE}: spend=${Number(r.SPEND||0).toFixed(0)}, sales=${Number(r.SALES||0).toFixed(0)}`));

  // What does the advertising route /advertising/ return?
  // It calls mart for `combined` summary which uses SUM(spend)/SUM(sales)
  // Let's check what mart has for DSP specifically — does sales = total_sales or click-only?
  const dspMart = await query(`
    SELECT date, spend, sales
    FROM CALBRIDGE_PROD.MARTS_MARTS.mart_advertising_daily
    WHERE client_id = ? AND ad_type = 'DSP'
      AND date >= DATEADD('day', -7, CURRENT_DATE())
    ORDER BY date DESC
  `, [clientId]);
  console.log('\nMart DSP last 7 days (daily):');
  dspMart.forEach(r => console.log(`  ${String(r.DATE).substring(0,10)}: spend=${Number(r.SPEND||0).toFixed(0)}, sales=${Number(r.SALES||0).toFixed(0)}`));

  const dspAcp = await query(`
    SELECT date, SUM(adjusted_spend) AS spend, SUM(sales) AS sales
    FROM CALBRIDGE_PROD.APP.adjusted_campaign_performance
    WHERE client_id = ? AND ad_type = 'DSP'
      AND date >= DATEADD('day', -7, CURRENT_DATE())
    GROUP BY date ORDER BY date DESC
  `, [clientId]);
  console.log('\nACP DSP last 7 days (daily):');
  dspAcp.forEach(r => console.log(`  ${String(r.DATE).substring(0,10)}: spend=${Number(r.SPEND||0).toFixed(0)}, sales=${Number(r.SALES||0).toFixed(0)}`));

  // Raw dsp_campaign_report — compare total_sales vs sales per day
  const crDaily = await query(`
    SELECT date,
      SUM(total_cost) AS spend,
      SUM(COALESCE(total_sales, 0)) AS total_sales,
      SUM(COALESCE(sales, 0)) AS sales_click
    FROM CALBRIDGE_PROD.APP.dsp_campaign_report
    WHERE client_id = ? AND date >= DATEADD('day', -7, CURRENT_DATE())
    GROUP BY date ORDER BY date DESC
  `, [clientId]);
  console.log('\ndsp_campaign_report last 7 days (total_sales vs click-only sales):');
  crDaily.forEach(r => console.log(`  ${String(r.DATE).substring(0,10)}: spend=${Number(r.SPEND||0).toFixed(0)}, total_sales=${Number(r.TOTAL_SALES||0).toFixed(0)}, sales_click=${Number(r.SALES_CLICK||0).toFixed(0)}`));

  // What does the CAMPAIGN_PERFORMANCE view emit for DSP sales on same days?
  const cpDsp = await query(`
    SELECT date, SUM(spend) AS spend, SUM(sales) AS sales
    FROM CALBRIDGE_PROD.APP.campaign_performance
    WHERE client_id = ? AND ad_type = 'DSP'
      AND date >= DATEADD('day', -7, CURRENT_DATE())
    GROUP BY date ORDER BY date DESC
  `, [clientId]);
  console.log('\nCAMPAIGN_PERFORMANCE view DSP last 7 days:');
  cpDsp.forEach(r => console.log(`  ${String(r.DATE).substring(0,10)}: spend=${Number(r.SPEND||0).toFixed(0)}, sales=${Number(r.SALES||0).toFixed(0)}`));

  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
