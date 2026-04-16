#!/usr/bin/env node
/**
 * One-shot: trigger DSP ingestion for CyberPower client and exit.
 * Run as: node scripts/trigger_dsp_ingest.js
 */
require('dotenv').config();
const { runJob } = require('../src/jobs/cron');

(async () => {
  try {
    console.log('[trigger_dsp_ingest] Starting DSP ingest via cron job runner...');
    await runJob('ingest_dsp', { triggeredBy: 'manual' });
    console.log('[trigger_dsp_ingest] Done.');
    process.exit(0);
  } catch (err) {
    console.error('[trigger_dsp_ingest] Failed:', err.message);
    process.exit(1);
  }
})();
