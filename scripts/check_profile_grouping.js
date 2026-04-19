require('dotenv').config();
const { query } = require('../src/services/snowflakeService');

const clientId = '7d88ea17-002b-4a02-97fc-bcab1292d57e';

// Test exact SQL used by keyword-targeting endpoint
query(`
  SELECT
    'SP' AS ad_type,
    COALESCE(keyword, targeting) AS keyword,
    COALESCE(match_type, 'AUTO') AS match_type,
    COUNT(DISTINCT campaign_id) AS campaign_count,
    SUM(cost) AS spend
  FROM sp_targeting_keyword_report
  WHERE client_id = ?
    AND date >= DATEADD('day', -30, CURRENT_DATE())
    AND COALESCE(keyword, targeting) IS NOT NULL
    AND UPPER(COALESCE(keyword, targeting)) = 'CYBERPOWER'
  GROUP BY COALESCE(keyword, targeting), COALESCE(match_type, 'AUTO')
  HAVING SUM(cost) > 0
`, [clientId]).then(rows => {
  console.log(`With current SQL grouping (no ad_type): ${rows.length} rows`);
  rows.forEach(r => console.log(`  [${r.MATCH_TYPE}] $${Number(r.SPEND||0).toFixed(0)} spend, ${r.CAMPAIGN_COUNT} campaigns`));
  process.exit(0);
}).catch(e => { console.error(e.message); process.exit(1); });
