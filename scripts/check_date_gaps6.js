require('dotenv').config();
const { query } = require('../src/services/snowflakeService');

const clientId = '7d88ea17-002b-4a02-97fc-bcab1292d57e';

Promise.all([
  // SP targeting keyword report date coverage
  query(`
    SELECT date AS d, COUNT(*) AS row_cnt
    FROM CALBRIDGE_PROD.APP.sp_targeting_keyword_report
    WHERE client_id=? AND date >= '2026-04-12'
    GROUP BY date ORDER BY date
  `, [clientId]),

  // SP campaign report date coverage
  query(`
    SELECT date AS d, COUNT(*) AS row_cnt
    FROM CALBRIDGE_PROD.APP.sp_campaign_report
    WHERE client_id=? AND date >= '2026-04-12'
    GROUP BY date ORDER BY date
  `, [clientId]),

  // Ingestion log — recent
  query(`
    SELECT job_type, status, records_written, error_message, started_at, completed_at
    FROM CALBRIDGE_PROD.APP.ingestion_log
    WHERE client_id=? AND started_at >= DATEADD('day',-4,CURRENT_TIMESTAMP())
    ORDER BY started_at DESC
    LIMIT 30
  `, [clientId]),

  // ADS_REPORT_QUEUE — what dates are completed vs pending
  query(`
    SELECT report_type, status, report_date, records_written, completed_at, error_message
    FROM CALBRIDGE_PROD.APP.ads_report_queue
    WHERE client_id=? AND report_date >= '2026-04-15'
    ORDER BY report_date DESC, completed_at DESC NULLS LAST
    LIMIT 50
  `, [clientId]),

  // PIPELINE.FRESHNESS
  query(`
    SELECT table_name, client_id, last_successful_load_at, last_successful_report_date, is_stale
    FROM CALBRIDGE_PROD.PIPELINE.freshness
    WHERE client_id=?
    ORDER BY last_successful_load_at DESC NULLS LAST
  `, [clientId]),

  // PIPELINE.JOB_RUNS recent
  query(`
    SELECT job_type, status, started_at, completed_at, rows_written, error_message, date_range_start, date_range_end
    FROM CALBRIDGE_PROD.PIPELINE.job_runs
    WHERE client_id=? AND started_at >= DATEADD('day',-3,CURRENT_TIMESTAMP())
    ORDER BY started_at DESC
    LIMIT 20
  `, [clientId]),
]).then(([sp, spcampaign, inglog, queue, freshness, piperuns]) => {
  console.log('\n=== SP targeting_keyword_report dates (Apr 12+) ===');
  if (!sp.length) console.log('  NO ROWS');
  sp.forEach(r => console.log(`  ${r.D}: ${r.ROW_CNT} rows`));

  console.log('\n=== SP campaign_report dates (Apr 12+) ===');
  if (!spcampaign.length) console.log('  NO ROWS');
  spcampaign.forEach(r => console.log(`  ${r.D}: ${r.ROW_CNT} rows`));

  console.log('\n=== Ingestion log (last 4 days) ===');
  if (!inglog.length) console.log('  NO ROWS');
  inglog.forEach(r => console.log(`  [${r.STATUS}] ${r.JOB_TYPE} +${r.RECORDS_WRITTEN} @ ${r.STARTED_AT} ${r.ERROR_MESSAGE ? '⚠️ '+r.ERROR_MESSAGE.slice(0,100) : ''}`));

  console.log('\n=== ADS_REPORT_QUEUE (Apr 15+) ===');
  if (!queue.length) console.log('  NO ROWS');
  const grouped = {};
  queue.forEach(r => {
    const key = r.REPORT_TYPE;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(r);
  });
  Object.entries(grouped).forEach(([type, rows]) => {
    const statuses = rows.map(r => `${r.REPORT_DATE?.toISOString?.()?.slice(0,10) || r.REPORT_DATE}:${r.STATUS}`);
    console.log(`  ${type}: ${statuses.join(', ')}`);
  });

  console.log('\n=== PIPELINE.FRESHNESS ===');
  if (!freshness.length) console.log('  NO ROWS');
  freshness.forEach(r => console.log(`  ${r.TABLE_NAME}: last_load=${r.LAST_SUCCESSFUL_LOAD_AT} last_date=${r.LAST_SUCCESSFUL_REPORT_DATE} stale=${r.IS_STALE}`));

  console.log('\n=== PIPELINE.JOB_RUNS (last 3 days) ===');
  if (!piperuns.length) console.log('  NO ROWS');
  piperuns.forEach(r => console.log(`  [${r.STATUS}] ${r.JOB_TYPE} ${r.DATE_RANGE_START}→${r.DATE_RANGE_END} +${r.ROWS_WRITTEN} rows @ ${r.STARTED_AT} ${r.ERROR_MESSAGE ? '⚠️ ' + r.ERROR_MESSAGE.slice(0,80) : ''}`));

  process.exit(0);
}).catch(e => { console.error(e.message); process.exit(1); });
