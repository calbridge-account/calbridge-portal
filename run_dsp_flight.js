/**
 * Manually process the pending dspFlight report for client 7d88ea17
 * and re-trigger ingestDsp for SparkX (929cea98)
 */
require('dotenv').config();
const { processReportQueue, ingestDsp } = require('./src/jobs/adsIngestion');
const { query } = require('./src/services/snowflakeService');

async function main() {
  const clientId = '7d88ea17-002b-4a02-97fc-bcab1292d57e';
  const sparkxId = '929cea98-38a6-49ab-bffc-1d38b1f3cc60';

  console.log('[Step 1] Processing pending dspFlight report for Calbridge client...');
  try {
    const result = await processReportQueue(clientId, 'ads');
    console.log('[Step 1] processReportQueue result:', JSON.stringify(result));
  } catch (err) {
    console.error('[Step 1] ERROR:', err.message);
  }

  console.log('\n[Step 2] Check dsp_line_item_report row count after processing...');
  try {
    const cnt = await query(
      `SELECT COUNT(1) as cnt, MAX(date) as latest_date, SUM(total_cost) as total_cost
       FROM CALBRIDGE_PROD.APP.dsp_line_item_report WHERE client_id = ?`,
      [clientId]
    );
    console.log('[Step 2] Row count:', JSON.stringify(cnt[0]));
  } catch (err) {
    console.error('[Step 2] ERROR:', err.message);
  }

  console.log('\n[Step 3] Re-triggering ingestDsp for SparkX (to queue new dspFlight reports)...');
  try {
    const dspResult = await ingestDsp(sparkxId, 'ads', 30);
    console.log('[Step 3] ingestDsp SparkX result:', JSON.stringify(dspResult));
  } catch (err) {
    console.error('[Step 3] ERROR:', err.message);
  }

  console.log('\n[Step 4] Also triggering ingestDsp for Calbridge client (fresh queue)...');
  try {
    const dspResult2 = await ingestDsp(clientId, 'ads', 30);
    console.log('[Step 4] ingestDsp Calbridge result:', JSON.stringify(dspResult2));
  } catch (err) {
    console.error('[Step 4] ERROR:', err.message);
  }

  process.exit(0);
}
main();
