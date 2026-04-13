'use strict';
/**
 * One-time cleanup: mark perpetually-zero ads_report_queue entries as 'skipped'
 * so they don't get re-queued.
 *
 * Run once: node scripts/cleanup-zero-row-reports.js
 * Created: 2026-04-13
 */
require('dotenv').config();
const { query } = require('../src/services/snowflakeService');

async function main() {
  console.log('=== ads_report_queue zero-row cleanup ===\n');

  // 1. Mark all sbTargets entries as skipped — report type removed entirely
  const r1 = await query(`
    UPDATE CALBRIDGE_PROD.APP.ads_report_queue
    SET status = 'skipped',
        error_message = 'sbTargets report type removed 2026-04-13 — uses TARGETING_EXPRESSION filter which returns 0 rows for all current clients'
    WHERE report_type = 'sbTargets'
      AND status != 'skipped'
  `);
  console.log('sbTargets entries marked skipped:', JSON.stringify(r1));

  // 2. Mark Acer SD zero-row completed entries as skipped
  const r2 = await query(`
    UPDATE CALBRIDGE_PROD.APP.ads_report_queue
    SET status = 'skipped',
        error_message = 'Client has no SD campaigns — skipped by capability guard (2026-04-13)'
    WHERE client_id = '929cea98-38a6-49ab-bffc-1d38b1f3cc60'
      AND report_type IN ('sdCampaigns','sdAdGroups','sdAdvertisedProduct','sdTargeting','sdGrossAndInvalids')
      AND status = 'completed'
      AND COALESCE(records_written, 0) = 0
  `);
  console.log('Acer SD zero-row entries marked skipped:', JSON.stringify(r2));

  // Summary counts
  const summary = await query(`
    SELECT report_type, status, COUNT(*) as cnt
    FROM CALBRIDGE_PROD.APP.ads_report_queue
    WHERE report_type IN ('sbTargets','sdCampaigns','sdAdGroups','sdAdvertisedProduct','sdTargeting','sdGrossAndInvalids')
    GROUP BY report_type, status
    ORDER BY report_type, status
  `);
  console.log('\nPost-cleanup summary:');
  for (const row of summary) {
    console.log(`  ${row.REPORT_TYPE || row.report_type} | ${row.STATUS || row.status} | ${row.CNT || row.cnt}`);
  }

  console.log('\nDone.');
  process.exit(0);
}

main().catch(err => {
  console.error('Cleanup failed:', err.message);
  process.exit(1);
});
