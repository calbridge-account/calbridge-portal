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
  // SP campaign report
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
  // ADS_REPORT_QUEUE — what's in flight
  query(`
    SELECT report_type, status, date_range_start, date_range_end, updated_at
    FROM CALBRIDGE_PROD.APP.ads_report_queue
    WHERE client_id=?
    ORDER BY updated_at DESC
    LIMIT 20
  `, [clientId]),
  // PIPELINE.FRESHNESS — what the pipeline says is fresh
  query(`
    SELECT table_name, last_loaded_at, rows_loaded
    FROM CALBRIDGE_PROD.PIPELINE.freshness
    ORDER BY last_loaded_at DESC NULLS LAST
  `, []),
]).then(([sp, sb, spcampaign, inglog, queue, freshness]) => {
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
  inglog.forEach(r => console.log(`  [${r.STATUS}] ${r.JOB_TYPE} date=${r.DATE_PROCESSED} +${r.RECORDS_INSERTED} rows @ ${r.CREATED_AT}`));

  console.log('\n=== ADS_REPORT_QUEUE (recent) ===');
  queue.forEach(r => console.log(`  [${r.STATUS}] ${r.REPORT_TYPE} ${r.DATE_RANGE_START}→${r.DATE_RANGE_END} updated ${r.UPDATED_AT}`));

  console.log('\n=== PIPELINE.FRESHNESS ===');
  freshness.forEach(r => console.log(`  ${r.TABLE_NAME}: loaded ${r.LAST_LOADED_AT} (${r.ROWS_LOADED} rows)`));

  process.exit(0);
}).catch(e => { console.error(e.message); process.exit(1); });
