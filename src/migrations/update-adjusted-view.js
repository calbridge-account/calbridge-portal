'use strict';
require('dotenv').config();
const { query } = require('../services/snowflakeService');

const SQL = `
CREATE OR REPLACE VIEW adjusted_campaign_performance AS
SELECT
  cp.*,
  cp.spend * COALESCE(
    sa_exact.multiplier,      -- exact match: SP, SB, or SD
    sa_sa.multiplier,         -- SA catch-all for SP/SB/SD
    sa_all.multiplier,        -- ALL catch-all
    1.0
  ) AS adjusted_spend
FROM campaign_performance cp
LEFT JOIN spend_adjustments sa_exact
  ON  sa_exact.client_id  = cp.client_id
  AND sa_exact.year_month = TO_VARCHAR(cp.date, 'YYYY-MM')
  AND sa_exact.ad_type    = cp.ad_type
LEFT JOIN spend_adjustments sa_sa
  ON  sa_sa.client_id  = cp.client_id
  AND sa_sa.year_month = TO_VARCHAR(cp.date, 'YYYY-MM')
  AND sa_sa.ad_type    = 'SA'
  AND cp.ad_type IN ('SP', 'SB', 'SD')
LEFT JOIN spend_adjustments sa_all
  ON  sa_all.client_id  = cp.client_id
  AND sa_all.year_month = TO_VARCHAR(cp.date, 'YYYY-MM')
  AND sa_all.ad_type    = 'ALL'
`;

(async () => {
  try {
    console.log('Updating adjusted_campaign_performance view...');
    await query(SQL);
    console.log('✅ View updated successfully.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Failed to update view:', err.message || err);
    process.exit(1);
  }
})();
