require('dotenv').config();
const { query } = require('../src/services/snowflakeService');

const clientId = '7d88ea17-002b-4a02-97fc-bcab1292d57e';

Promise.all([
  // What's the most recent data by report type in APP tables?
  query(`
    SELECT 'sp_targeting_keyword' AS tbl, MAX(date) AS latest_date FROM CALBRIDGE_PROD.APP.sp_targeting_keyword_report WHERE client_id=?
    UNION ALL
    SELECT 'sp_campaign', MAX(date) FROM CALBRIDGE_PROD.APP.sp_campaign_report WHERE client_id=?
    UNION ALL
    SELECT 'sp_adgroup', MAX(date) FROM CALBRIDGE_PROD.APP.sp_ad_group_report WHERE client_id=?
    UNION ALL
    SELECT 'sp_searchterm', MAX(date) FROM CALBRIDGE_PROD.APP.sp_search_term_report WHERE client_id=?
    UNION ALL
    SELECT 'sb_campaign', MAX(report_date) FROM CALBRIDGE_PROD.APP.sb_campaign_report WHERE client_id=?
    UNION ALL
    SELECT 'sb_keyword', MAX(report_date) FROM CALBRIDGE_PROD.APP.sb_keyword_report WHERE client_id=?
    UNION ALL
    SELECT 'sd_campaign', MAX(date) FROM CALBRIDGE_PROD.APP.sd_campaign_report WHERE client_id=?
    UNION ALL
    SELECT 'sd_target', MAX(date) FROM CALBRIDGE_PROD.APP.sd_target_report WHERE client_id=?
  `, [clientId, clientId, clientId, clientId, clientId, clientId, clientId, clientId]),

  // Today's date in Snowflake
  query(`SELECT CURRENT_DATE() AS today, CURRENT_TIMESTAMP() AS now`, []),

  // What does the ads_report_queue look like for Apr 18-19 specifically?
  query(`
    SELECT report_type, report_date, status, records_written, completed_at, error_message
    FROM CALBRIDGE_PROD.APP.ads_report_queue
    WHERE client_id=? AND report_date >= '2026-04-17'
    ORDER BY report_type, report_date
  `, [clientId]),

  // Are there any stage_raw_data job_runs with actual rows written recently?
  query(`
    SELECT job_type, status, started_at, rows_written, rows_read, date_range_start, date_range_end, error_message
    FROM CALBRIDGE_PROD.PIPELINE.job_runs
    WHERE client_id=?
      AND job_type IN ('stage_raw_data','download_completed_reports','ingest_reports')
      AND started_at >= DATEADD('day',-7,CURRENT_TIMESTAMP())
    ORDER BY started_at DESC
    LIMIT 30
  `, [clientId]),
]).then(([maxDates, now, recentQueue, stageRuns]) => {
  console.log('\n=== Today (Snowflake) ===');
  now.forEach(r => console.log(`  ${r.TODAY} / ${r.NOW}`));

  console.log('\n=== Latest data per table ===');
  maxDates.forEach(r => console.log(`  ${r.TBL}: ${r.LATEST_DATE}`));

  console.log('\n=== Queue items Apr 17+ ===');
  recentQueue.forEach(r => {
    const dt = r.REPORT_DATE?.toISOString?.()?.slice(0,10) || r.REPORT_DATE;
    console.log(`  [${r.STATUS}] ${r.REPORT_TYPE} ${dt} +${r.RECORDS_WRITTEN ?? 0} @ ${r.COMPLETED_AT ?? 'pending'} ${r.ERROR_MESSAGE || ''}`);
  });

  console.log('\n=== Stage/download job runs (last 7 days) ===');
  if (!stageRuns.length) console.log('  NO ROWS for stage_raw_data/download_completed_reports');
  stageRuns.forEach(r => console.log(`  [${r.STATUS}] ${r.JOB_TYPE} ${r.DATE_RANGE_START}→${r.DATE_RANGE_END} read=${r.ROWS_READ} written=${r.ROWS_WRITTEN} @ ${r.STARTED_AT} ${r.ERROR_MESSAGE || ''}`));

  process.exit(0);
}).catch(e => { console.error(e.message); process.exit(1); });
