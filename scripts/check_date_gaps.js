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
  // Check the APP-layer view / materialized tables the dashboard reads from
  query(`
    SELECT table_name, last_altered
    FROM information_schema.tables
    WHERE table_schema = 'APP'
      AND table_type = 'BASE TABLE'
    ORDER BY last_altered DESC NULLS LAST
    LIMIT 15
  `, []),
  // Last successful submit_amazon_reports run
  query(`
    SELECT job_type, status, date_range_start, date_range_end, created_at
    FROM CALBRIDGE_PROD.APP.report_jobs
    WHERE client_id=? AND job_type ILIKE '%sp%campaign%'
    ORDER BY created_at DESC
    LIMIT 10
  `, [clientId]),
]).then(([sp, sb, tables, jobs]) => {
  console.log('\n=== SP date coverage (Apr 12+) ===');
  sp.forEach(r => console.log(`  ${r.D}: ${r.ROW_CNT} rows`));

  console.log('\n=== SB date coverage (Apr 12+) ===');
  sb.forEach(r => console.log(`  ${r.D}: ${r.ROW_CNT} rows`));

  console.log('\n=== APP tables (last altered) ===');
  tables.forEach(r => console.log(`  ${r.TABLE_NAME}: ${r.LAST_ALTERED}`));

  console.log('\n=== Recent SP report jobs ===');
  jobs.forEach(r => console.log(`  [${r.STATUS}] ${r.JOB_TYPE} ${r.DATE_RANGE_START}→${r.DATE_RANGE_END} submitted ${r.CREATED_AT}`));

  process.exit(0);
}).catch(e => { console.error(e.message); process.exit(1); });
