/**
 * vendorGapFill.js
 *
 * Targeted gap-fill for vendor data using existing backfillVendorReports.
 * Runs traffic + netPPM for the missing date ranges only.
 *
 * Usage: node src/jobs/vendorGapFill.js
 */

'use strict';

require('dotenv').config();

// Traffic gap:  2026-04-12 → 2026-04-23
// NetPPM gap:   2026-03-29 → 2026-04-23
// Use the wider range so both get covered in one run.
const START_DATE = '2026-03-29';
const END_DATE   = '2026-04-23';
const CLIENT_ID  = '7d88ea17-002b-4a02-97fc-bcab1292d57e';

const { backfillVendorReports } = require('./vendorIngestion');

(async () => {
  console.log(`[vendorGapFill] Filling ${START_DATE} → ${END_DATE} for client ${CLIENT_ID}`);
  const result = await backfillVendorReports(CLIENT_ID, START_DATE, END_DATE);
  console.log('[vendorGapFill] ✅ Done:', JSON.stringify(result));
  process.exit(0);
})().catch(e => {
  console.error('[vendorGapFill] FATAL:', e.message);
  process.exit(1);
});
