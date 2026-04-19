require('dotenv').config();
const { query } = require('../src/services/snowflakeService');

const clientId = '7d88ea17-002b-4a02-97fc-bcab1292d57e';

Promise.all([
  // SP coverage
  query(`
    SELECT date AS d, COUNT(*) AS row_cnt
    FROM CALBRIDGE_PROD.APP.sp_targeting_keyword_report
    WHERE client_id=? AND date >= '2026-04-12'
    GROUP BY date ORDER BY date
  `, [clientId]),
  // SB coverage
  query(`
    SELECT report_date AS d, COUNT(*) AS row_cnt
    FROM CALBRIDGE_PROD.APP.sb_keyword_report
    WHERE client_id=? AND report_date >= '2026-04-12'
    GROUP BY report_date ORDER BY report_date
  `, [clientId]),
  // SP campaign report date coverage
  query(`
    SELECT date AS d, COUNT(*) AS row_cnt
    FROM CALBRIDGE_PROD.APP.sp_campaign_report
    WHERE client_id=? AND date >= '2026-04-12'
    GROUP BY date ORDER BY date
  `, [clientId]),
  // Ingestion log — what jobs ran recently
  query(`
    SELECT job_type, status, records_inserted, date_processed, created_at
    FROM CALBRIDGE_PROD.APP.ingestion_log
    WHERE client_id=? AND created_at >= DATEADD('day',-4,CURRENT_TIMESTAMP())
    ORDER BY created_at DESC
    LIMIT 30
  `, [clientId]),
  // ADS_REPORT_QUEUE — recent activity
  query(`
    SELECT report_type, status, report_date, records_written, completed_at, error_message
    FROM CALBRIDGE_PROD.APP.ads_report_queue
    WHERE client_id=? AND report_date >= '2026-04-15'
    ORDER BY report_date DESC, completed_at DESC NULLS LAST
    LIMIT 40
  `, [clientId]),
  // PIPELINE.JOB_RUNS — last few runs
  query(`
    SELECT job_type, status, started_at, finished_at, records_processed, error
    FROM CALBRIDGE_PROD.PIPELINE.job_runs
    WHERE started_at >= DATEADD('day',-3,CURRENT_TIMESTAMP())
    ORDER BY started_at DESC
    LIMIT 20
  `, []),
]).then(([sp, sb, spcampaign, inglog, queue, piperuns]) => {
  console.log('\n=== SP targeting_keyword_report (Apr 12+) ===');
  if (!sp.length) console.log('  NO ROWS');
  sp.forEach(r => console.log(`  ${r.D}: ${r.ROW_CNT} rows`));

  console.log('\n=== SB keyword_report (Apr 12+) ===');
  if (!sb.length) console.log('  NO ROWS');
  sb.forEach(r => console.log(`  ${r.D}: ${r.ROW_CNT} rows`));

  console.log('\n=== SP campaign_report (Apr 12+) ===');
  if (!spcampaign.length) console.log('  NO ROWS');
  spcampaign.forEach(r => console.log(`  ${r.D}: ${r.ROW_CNT} rows`));

  console.log('\n=== Ingestion log (last 4 days) ===');
  if (!inglog.length) console.log('  NO ROWS');
  inglog.forEach(r => console.log(`  [${r.STATUS}] ${r.JOB_TYPE} date=${r.DATE_PROCESSED} +${r.RECORDS_INSERTED} @ ${r.CREATED_AT}`));

  console.log('\n=== ADS_REPORT_QUEUE (Apr 15+) ===');
  if (!queue.length) console.log('  NO ROWS');
  queue.slice(0, 20).forEach(r => console.log(`  [${r.STATUS}] ${r.REPORT_TYPE} ${r.REPORT_DATE} +${r.RECORDS_WRITTEN} @ ${r.COMPLETED_AT} ${r.ERROR_MESSAGE ? '⚠️  ' + r.ERROR_MESSAGE.slice(0,80) : ''}`));

  console.log('\n=== PIPELINE.JOB_RUNS (last 3 days) ===');
  if (!piperuns.length) console.log('  NO ROWS');
  piperuns.forEach(r => console.log(`  [${r.STATUS}] ${r.JOB_TYPE} started=${r.STARTED_AT} ${r.RECORDS_PROCESSED ?? ''} ${r.ERROR ?? ''}`));

  process.exit(0);
}).catch(e => { console.error(e.message); process.exit(1); });
