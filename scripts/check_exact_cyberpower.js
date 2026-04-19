require('dotenv').config();
const { query } = require('../src/services/snowflakeService');

const clientId = '7d88ea17-002b-4a02-97fc-bcab1292d57e';

query(`
  SELECT
    keyword, targeting, match_type, keyword_type,
    profile_id,
    COUNT(*) AS cnt,
    SUM(cost) AS spend
  FROM sp_targeting_keyword_report
  WHERE client_id = ?
    AND date >= DATEADD('day', -30, CURRENT_DATE())
    AND UPPER(COALESCE(keyword, targeting)) = 'CYBERPOWER'
    AND COALESCE(match_type, 'AUTO') = 'EXACT'
  GROUP BY keyword, targeting, match_type, keyword_type, profile_id
  ORDER BY spend DESC
`, [clientId]).then(rows => {
  console.log('EXACT "CyberPower" raw breakdown:');
  rows.forEach(r => console.log(`  keyword="${r.KEYWORD}" targeting="${r.TARGETING}" type=${r.KEYWORD_TYPE} match=${r.MATCH_TYPE} profile=${r.PROFILE_ID} spend=$${Number(r.SPEND||0).toFixed(2)}`));
  process.exit(0);
}).catch(e => { console.error(e.message); process.exit(1); });
