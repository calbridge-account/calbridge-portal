require('dotenv').config();
const { query } = require('./src/services/snowflakeService');

async function main() {
  try {
    const clientId = '7d88ea17-002b-4a02-97fc-bcab1292d57e';
    // SparkX client_id (the second one from queue results)
    const sparkxClientId = '929cea98-38a6-49ab-bffc-1d38b1f3cc60';

    console.log('=== 4. April DSP spend by client (dsp_campaign_report) ===');
    const aprilSpend = await query(
      `SELECT client_id, SUM(total_cost) as total_spend, COUNT(1) as row_count
       FROM CALBRIDGE_PROD.APP.dsp_campaign_report
       WHERE date >= '2026-04-01' AND date < '2026-05-01'
       GROUP BY client_id`
    );
    console.log(JSON.stringify(aprilSpend));

    console.log('\n=== 5. April dsp_line_item_report spend by client ===');
    const liApril = await query(
      `SELECT client_id, SUM(total_cost) as total_spend, COUNT(1) as row_count
       FROM CALBRIDGE_PROD.APP.dsp_line_item_report
       WHERE date >= '2026-04-01' AND date < '2026-05-01'
       GROUP BY client_id`
    );
    console.log(JSON.stringify(liApril));

    console.log('\n=== 6. Check adjusted_campaign_performance view ===');
    const acp = await query(
      `SELECT client_id, SUM(spend) as total_spend
       FROM CALBRIDGE_PROD.APP.adjusted_campaign_performance
       WHERE date >= '2026-04-01' AND date < '2026-05-01'
       GROUP BY client_id`
    ).catch(e => [{error: e.message}]);
    console.log(JSON.stringify(acp));

    console.log('\n=== 7. Get the pending dspFlight report_id for main client ===');
    const pendingReport = await query(
      `SELECT report_id, profile_id, report_date, status, requested_at
       FROM CALBRIDGE_PROD.APP.ads_report_queue
       WHERE client_id = ? AND report_type = 'dspFlight' AND status = 'pending'
       ORDER BY requested_at DESC LIMIT 5`,
      [clientId]
    );
    console.log(JSON.stringify(pendingReport));

    process.exit(0);
  } catch (err) {
    console.error('ERROR:', err.message);
    process.exit(1);
  }
}
main();
