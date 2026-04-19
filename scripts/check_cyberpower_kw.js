require('dotenv').config();
const { query } = require('../src/services/snowflakeService');

const clientId = '7d88ea17-002b-4a02-97fc-bcab1292d57e';

Promise.all([
  query(`
    SELECT 'SP' AS ad_type, COALESCE(keyword, targeting) AS keyword,
           COALESCE(match_type,'AUTO') AS match_type,
           COUNT(DISTINCT campaign_id) AS campaign_count,
           SUM(cost) AS spend
    FROM sp_targeting_keyword_report
    WHERE client_id=? AND date >= DATEADD('day',-30,CURRENT_DATE())
      AND UPPER(COALESCE(keyword, targeting)) = 'CYBERPOWER'
    GROUP BY 1,2,3 HAVING SUM(cost)>0
  `, [clientId]),
  query(`
    SELECT 'SB' AS ad_type, COALESCE(keyword_text,targeting_text) AS keyword,
           COALESCE(match_type,'N/A') AS match_type,
           COUNT(DISTINCT campaign_id) AS campaign_count,
           SUM(cost) AS spend
    FROM sb_keyword_report
    WHERE client_id=? AND report_date >= DATEADD('day',-30,CURRENT_DATE())
      AND UPPER(COALESCE(keyword_text,targeting_text)) = 'CYBERPOWER'
    GROUP BY 1,2,3 HAVING SUM(cost)>0
  `, [clientId]),
]).then(([sp, sb]) => {
  const all = [...sp, ...sb];
  console.log('"CyberPower" rows:');
  all.forEach(r => console.log(`  [${r.AD_TYPE}] [${r.MATCH_TYPE}] $${Number(r.SPEND||0).toFixed(0)} spend, ${r.CAMPAIGN_COUNT} campaigns`));
  console.log(`\nTotal rows: ${all.length} — so it appears ${all.length}x in the table`);
  process.exit(0);
}).catch(e => { console.error(e.message); process.exit(1); });
