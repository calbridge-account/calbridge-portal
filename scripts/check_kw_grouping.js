require('dotenv').config();
const { query } = require('../src/services/snowflakeService');

query(`
  SELECT COALESCE(keyword, targeting) AS kw,
         COALESCE(match_type,'AUTO') AS mt,
         COUNT(*) AS row_count,
         COUNT(DISTINCT campaign_id) AS campaign_count,
         COUNT(DISTINCT profile_id) AS profile_count
  FROM CALBRIDGE_PROD.APP.sp_targeting_keyword_report
  WHERE client_id='7d88ea17-002b-4a02-97fc-bcab1292d57e'
    AND date >= DATEADD('day', -30, CURRENT_DATE())
    AND COALESCE(keyword, targeting) ILIKE '%battery backup%'
  GROUP BY 1, 2
  ORDER BY row_count DESC
  LIMIT 10
`).then(rows => {
  console.log('battery backup rows:');
  rows.forEach(r => console.log(`  "${r.KW}" [${r.MT}] — ${r.ROW_COUNT} rows, ${r.CAMPAIGN_COUNT} campaigns, ${r.PROFILE_COUNT} profiles`));
  process.exit(0);
}).catch(e => { console.error(e.message); process.exit(1); });
