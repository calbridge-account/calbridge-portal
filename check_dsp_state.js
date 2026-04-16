require('dotenv').config();
const { query } = require('./src/services/snowflakeService');

async function main() {
  try {
    const clientId = '7d88ea17-002b-4a02-97fc-bcab1292d57e';

    console.log('=== 1. dsp_line_item_report row count for client ===');
    const lineItemCount = await query(
      `SELECT COUNT(*) as cnt, MAX(date) as latest_date FROM CALBRIDGE_PROD.APP.dsp_line_item_report WHERE client_id = ?`,
      [clientId]
    );
    console.log(JSON.stringify(lineItemCount[0]));

    console.log('\n=== 2. dspFlight queue status for client ===');
    const queueStatus = await query(
      `SELECT report_type, status, COUNT(*) as cnt, MAX(completed_at) as last_completed
       FROM CALBRIDGE_PROD.APP.ads_report_queue
       WHERE client_id = ? AND report_type = 'dspFlight'
       GROUP BY report_type, status
       ORDER BY status`,
      [clientId]
    );
    console.log(JSON.stringify(queueStatus));

    console.log('\n=== 3. dspFlight queue across all clients ===');
    const allFlight = await query(
      `SELECT client_id, status, COUNT(*) as cnt, MAX(error_message) as last_error
       FROM CALBRIDGE_PROD.APP.ads_report_queue
       WHERE report_type = 'dspFlight'
       GROUP BY client_id, status
       ORDER BY client_id, status`
    );
    console.log(JSON.stringify(allFlight));

    console.log('\n=== 4. April DSP spend by client (dsp_campaign_report) ===');
    const aprilSpend = await query(
      `SELECT client_id, SUM(total_cost) as total_spend, COUNT(*) as rows
       FROM CALBRIDGE_PROD.APP.dsp_campaign_report
       WHERE date >= '2026-04-01' AND date < '2026-05-01'
       GROUP BY client_id`
    );
    console.log(JSON.stringify(aprilSpend));

    console.log('\n=== 5. April dsp_line_item_report spend by client ===');
    const liApril = await query(
      `SELECT client_id, SUM(total_cost) as total_spend, COUNT(*) as rows
       FROM CALBRIDGE_PROD.APP.dsp_line_item_report
       WHERE date >= '2026-04-01' AND date < '2026-05-01'
       GROUP BY client_id`
    );
    console.log(JSON.stringify(liApril));

    console.log('\n=== 6. Check adjusted_campaign_performance view if exists ===');
    const acp = await query(
      `SELECT client_id, SUM(spend) as total_spend
       FROM CALBRIDGE_PROD.APP.adjusted_campaign_performance
       WHERE date >= '2026-04-01' AND date < '2026-05-01'
       GROUP BY client_id`
    ).catch(e => [{error: e.message}]);
    console.log(JSON.stringify(acp));

    process.exit(0);
  } catch (err) {
    console.error('ERROR:', err.message);
    process.exit(1);
  }
}
main();
