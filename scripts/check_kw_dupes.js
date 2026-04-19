require('dotenv').config();
const { query } = require('../src/services/snowflakeService');

// Simulate what the keyword-targeting endpoint actually returns for "battery backup"
const clientId = '7d88ea17-002b-4a02-97fc-bcab1292d57e';
const days = 30;

const spSql = `
  SELECT
    'SP' AS ad_type,
    COALESCE(keyword, targeting) AS keyword,
    COALESCE(match_type, 'AUTO') AS match_type,
    COUNT(DISTINCT campaign_id) AS campaign_count,
    SUM(cost) AS spend, SUM(purchases_30_d) AS orders, SUM(sales_30_d) AS sales
  FROM sp_targeting_keyword_report
  WHERE client_id = ?
    AND date >= DATEADD('day', -${days}, CURRENT_DATE())
    AND COALESCE(keyword, targeting) ILIKE '%battery backup%'
    AND COALESCE(keyword, targeting) IS NOT NULL
  GROUP BY COALESCE(keyword, targeting), COALESCE(match_type, 'AUTO')
  HAVING SUM(cost) > 0
`;

const sbSql = `
  SELECT
    'SB' AS ad_type,
    COALESCE(keyword_text, targeting_text) AS keyword,
    COALESCE(match_type, 'N/A') AS match_type,
    COUNT(DISTINCT campaign_id) AS campaign_count,
    SUM(cost) AS spend, SUM(purchases) AS orders, SUM(sales) AS sales
  FROM sb_keyword_report
  WHERE client_id = ?
    AND report_date >= DATEADD('day', -${days}, CURRENT_DATE())
    AND COALESCE(keyword_text, targeting_text) ILIKE '%battery backup%'
    AND COALESCE(keyword_text, targeting_text) IS NOT NULL
  GROUP BY COALESCE(keyword_text, targeting_text), COALESCE(match_type, 'N/A')
  HAVING SUM(cost) > 0
`;

Promise.all([
  query(spSql, [clientId]),
  query(sbSql, [clientId]),
]).then(([sp, sb]) => {
  const all = [...sp, ...sb].sort((a, b) => Number(b.SPEND||0) - Number(a.SPEND||0));
  console.log(`SP rows for "battery backup": ${sp.length}`);
  console.log(`SB rows for "battery backup": ${sb.length}`);
  console.log('\nAll matches:');
  all.slice(0, 15).forEach(r => {
    console.log(`  [${r.AD_TYPE}] "${r.KEYWORD}" [${r.MATCH_TYPE}] — $${Number(r.SPEND||0).toFixed(0)} spend, ${r.CAMPAIGN_COUNT} campaigns`);
  });
  process.exit(0);
}).catch(e => { console.error(e.message); process.exit(1); });
