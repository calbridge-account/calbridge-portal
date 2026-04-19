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
  // SD coverage
  query(`
    SELECT date AS d, COUNT(*) AS row_cnt
    FROM CALBRIDGE_PROD.APP.sd_campaigns_report
    WHERE client_id=? AND date >= '2026-04-12'
    GROUP BY date ORDER BY date
  `, [clientId]),
  // What tables exist in APP schema
  query(`
    SELECT table_name, row_count
    FROM information_schema.tables
    WHERE table_schema = 'APP'
      AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `, []),
]).then(([sp, sb, sd, tables]) => {
  console.log('\n=== SP date coverage (Apr 12+) ===');
  if (sp.length === 0) console.log('  NO ROWS FOUND');
  sp.forEach(r => console.log(`  ${r.D}: ${r.ROW_CNT} rows`));

  console.log('\n=== SB date coverage (Apr 12+) ===');
  if (sb.length === 0) console.log('  NO ROWS FOUND');
  sb.forEach(r => console.log(`  ${r.D}: ${r.ROW_CNT} rows`));

  console.log('\n=== SD date coverage (Apr 12+) ===');
  if (sd.length === 0) console.log('  NO ROWS FOUND');
  sd.forEach(r => console.log(`  ${r.D}: ${r.ROW_CNT} rows`));

  console.log('\n=== APP tables ===');
  tables.forEach(r => console.log(`  ${r.TABLE_NAME} (${r.ROW_COUNT} rows)`));

  process.exit(0);
}).catch(e => { console.error(e.message); process.exit(1); });
