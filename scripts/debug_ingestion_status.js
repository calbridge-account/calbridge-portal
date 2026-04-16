require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { query } = require('../src/services/snowflakeService');

async function main() {
  const clientId = '7d88ea17-002b-4a02-97fc-bcab1292d57e';

  // 1. Queue status — last 3 days grouped by type+status
  const queue = await query(`
    SELECT report_type, status, COUNT(*) AS cnt,
      MAX(requested_at)  AS last_requested,
      MAX(completed_at)  AS last_completed,
      MAX(error_message) AS last_error
    FROM CALBRIDGE_PROD.APP.ads_report_queue
    WHERE client_id = ?
      AND requested_at >= DATEADD('day', -3, CURRENT_TIMESTAMP())
    GROUP BY report_type, status
    ORDER BY report_type, status
  `, [clientId]);
  console.log('=== Queue status (last 3 days) ===');
  queue.forEach(r => console.log(`  ${r.REPORT_TYPE} | ${r.STATUS} | n=${r.CNT} | last_done=${String(r.LAST_COMPLETED||'—').substring(0,19)} | err=${(r.LAST_ERROR||'—').substring(0,60)}`));

  // 2. Last successful completion per report type (all time)
  const lastSuccess = await query(`
    SELECT report_type,
      MAX(completed_at)  AS last_success,
      MAX(report_date)   AS last_data_date
    FROM CALBRIDGE_PROD.APP.ads_report_queue
    WHERE client_id = ? AND status = 'success'
    GROUP BY report_type
    ORDER BY last_success DESC
  `, [clientId]);
  console.log('\n=== Last success per report type ===');
  lastSuccess.forEach(r => console.log(`  ${r.REPORT_TYPE}: completed=${String(r.LAST_SUCCESS||'').substring(0,19)}, data_date=${String(r.LAST_DATA_DATE||'').substring(0,10)}`));

  // 3. Stuck/failed jobs
  const stuck = await query(`
    SELECT report_type, status, requested_at, completed_at, error_message
    FROM CALBRIDGE_PROD.APP.ads_report_queue
    WHERE client_id = ?
      AND status IN ('pending','running','failed')
      AND requested_at >= DATEADD('day', -3, CURRENT_TIMESTAMP())
    ORDER BY requested_at DESC
    LIMIT 20
  `, [clientId]);
  console.log(`\n=== Stuck/failed (last 3 days): ${stuck.length} jobs ===`);
  stuck.slice(0,10).forEach(r => console.log(`  ${r.REPORT_TYPE} | ${r.STATUS} | requested=${String(r.REQUESTED_AT||'').substring(0,19)} | err=${(r.ERROR_MESSAGE||'—').substring(0,80)}`));

  // 4. Max date in raw tables
  const rawTables = [
    ['sp_campaign_report',          'date'],
    ['sb_campaign_report',          'report_date'],
    ['sd_campaign_report',          'date'],
    ['dsp_campaign_report',         'date'],
    ['dsp_line_item_report',        'date'],
    ['sp_advertised_product_report','date'],
    ['sp_search_term_report',       'date'],
    ['sp_targeting_keyword_report', 'date'],
  ];
  console.log('\n=== Max date in raw tables ===');
  for (const [tbl, col] of rawTables) {
    try {
      const r = await query(`SELECT MAX(${col}) AS max_date FROM CALBRIDGE_PROD.APP.${tbl} WHERE client_id = ?`, [clientId]);
      console.log(`  ${tbl}: ${String(r[0].MAX_DATE||'none').substring(0,10)}`);
    } catch(e) { console.log(`  ${tbl}: ERROR ${e.message.substring(0,50)}`); }
  }

  // 5. Most recent queue entries regardless of status
  const recent = await query(`
    SELECT report_type, status, report_date, requested_at, completed_at, records_written
    FROM CALBRIDGE_PROD.APP.ads_report_queue
    WHERE client_id = ?
    ORDER BY requested_at DESC
    LIMIT 10
  `, [clientId]);
  console.log('\n=== Most recent queue entries ===');
  recent.forEach(r => console.log(`  ${r.REPORT_TYPE} | ${r.STATUS} | data=${String(r.REPORT_DATE||'').substring(0,10)} | req=${String(r.REQUESTED_AT||'').substring(0,19)} | done=${String(r.COMPLETED_AT||'—').substring(0,19)} | rows=${r.RECORDS_WRITTEN||0}`));

  // 6. PM2 worker process — check last activity
  const workerLast = await query(`
    SELECT report_type, MAX(completed_at) AS last_run
    FROM CALBRIDGE_PROD.APP.ads_report_queue
    WHERE status = 'success'
    GROUP BY report_type
    ORDER BY last_run DESC
    LIMIT 5
  `);
  console.log('\n=== Most recently completed jobs (all clients) ===');
  workerLast.forEach(r => console.log(`  ${r.REPORT_TYPE}: ${String(r.LAST_RUN||'').substring(0,19)}`));

  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
