require('dotenv').config();
const { query } = require('./src/services/snowflakeService');

async function main() {
  const clientId = '7d88ea17-002b-4a02-97fc-bcab1292d57e';

  console.log('=== Check dspFlight report status ===');
  const flightQ = await query(
    `SELECT report_id, status, records_written, error_message, completed_at, requested_at
     FROM CALBRIDGE_PROD.APP.ads_report_queue
     WHERE client_id = ? AND report_type = 'dspFlight'
     ORDER BY requested_at DESC LIMIT 10`,
    [clientId]
  );
  console.log(JSON.stringify(flightQ, null, 2));

  console.log('\n=== All newly queued dspFlight reports ===');
  const newFlight = await query(
    `SELECT client_id, report_id, status, records_written, requested_at
     FROM CALBRIDGE_PROD.APP.ads_report_queue
     WHERE report_type = 'dspFlight'
     ORDER BY requested_at DESC LIMIT 15`
  );
  console.log(JSON.stringify(newFlight, null, 2));

  console.log('\n=== April dsp_campaign_report spend (calbridge + sparkx) ===');
  const aprilCampaign = await query(
    `SELECT client_id, SUM(total_cost) as total_spend, COUNT(1) as row_count
     FROM CALBRIDGE_PROD.APP.dsp_campaign_report
     WHERE date >= '2026-04-01' AND date < '2026-05-01'
     GROUP BY client_id`
  );
  console.log(JSON.stringify(aprilCampaign, null, 2));

  console.log('\n=== adjusted_campaign_performance April spend ===');
  const acp = await query(
    `SELECT client_id, SUM(spend) as total_spend
     FROM CALBRIDGE_PROD.APP.adjusted_campaign_performance
     WHERE date >= '2026-04-01' AND date < '2026-05-01'
     GROUP BY client_id`
  ).catch(e => [{error: e.message}]);
  console.log(JSON.stringify(acp, null, 2));

  process.exit(0);
}
main();
