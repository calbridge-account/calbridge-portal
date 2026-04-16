require('dotenv').config();
const { query } = require('./src/services/snowflakeService');

async function main() {
  const clientId = '7d88ea17-002b-4a02-97fc-bcab1292d57e'; // Calbridge
  const sparkxId = '929cea98-38a6-49ab-bffc-1d38b1f3cc60'; // SparkX

  console.log('=== April DSP spend verification ===');

  // dsp_campaign_report (source truth for DSP spend)
  const dspByClient = await query(
    `SELECT client_id, SUM(total_cost) as dsp_spend
     FROM CALBRIDGE_PROD.APP.dsp_campaign_report
     WHERE date >= '2026-04-01' AND date < '2026-05-01'
     GROUP BY client_id`
  );
  console.log('dsp_campaign_report April spend:', JSON.stringify(dspByClient));

  // dsp_line_item_report
  const liByClient = await query(
    `SELECT client_id, SUM(total_cost) as dsp_spend, COUNT(1) as row_count
     FROM CALBRIDGE_PROD.APP.dsp_line_item_report
     WHERE date >= '2026-04-01' AND date < '2026-05-01'
     GROUP BY client_id`
  );
  console.log('dsp_line_item_report April spend:', JSON.stringify(liByClient));

  // adjusted_campaign_performance (final rolled-up view)
  const acp = await query(
    `SELECT client_id, SUM(spend) as total_spend
     FROM CALBRIDGE_PROD.APP.adjusted_campaign_performance
     WHERE date >= '2026-04-01' AND date < '2026-05-01'
     GROUP BY client_id`
  ).catch(e => [{error: e.message}]);
  console.log('adjusted_campaign_performance April spend:', JSON.stringify(acp));

  // mart_advertising_daily (dbt mart)
  const mart = await query(
    `SELECT client_id, SUM(spend) as total_spend, SUM(dsp_spend) as dsp_spend
     FROM CALBRIDGE_PROD.MARTS_MARTS.mart_advertising_daily
     WHERE date >= '2026-04-01' AND date < '2026-05-01'
     GROUP BY client_id`
  ).catch(e => [{error: e.message}]);
  console.log('mart_advertising_daily April spend:', JSON.stringify(mart));

  // dspFlight queue current state
  const flightQ = await query(
    `SELECT client_id, status, COUNT(1) as cnt, MAX(completed_at) as last_done
     FROM CALBRIDGE_PROD.APP.ads_report_queue
     WHERE report_type = 'dspFlight'
     GROUP BY client_id, status
     ORDER BY client_id, status`
  );
  console.log('\ndspFlight queue state:', JSON.stringify(flightQ, null, 2));

  process.exit(0);
}
main();
