'use strict';

require('dotenv').config();

// Worker process: runs cron scheduler + BullMQ workers only
// No HTTP server — this process is dedicated to background jobs

const { startCron, JOB_HANDLERS } = require('./jobs/cron');
const { startWorkers } = require('./workers/jobWorker');
const { clearStaleRunningJobs } = require('./services/jobRunner');

async function main() {
  console.log('[worker] Calbridge Worker starting...');

  // Clear any zombie 'running'/'pending' JOB_RUNS left by a previous crash/restart
  // Must run before startCron so the in-DB lock state is clean before new runs begin
  try {
    await clearStaleRunningJobs(30);
  } catch (err) {
    console.warn('[worker] clearStaleRunningJobs failed (non-fatal):', err.message);
  }

  // Start BullMQ workers first (so they're ready to process before cron enqueues)
  startWorkers(JOB_HANDLERS);

  // Start cron scheduler (enqueues jobs into BullMQ)
  await startCron({ runImmediately: true });

  // Register weekly email cron
  registerWeeklyEmailCron();

  console.log('[worker] Calbridge Worker running — cron + BullMQ active');
}

/**
 * Register weekly email cron — every Monday at 8:00 AM Pacific time
 */
function registerWeeklyEmailCron() {
  try {
    const cron = require('node-cron');
    const { sendWeeklyReportsToAll } = require('./jobs/weeklyEmailScheduler');

    // '0 8 * * 1' = 8:00 AM every Monday, America/Los_Angeles timezone
    cron.schedule('0 8 * * 1', async () => {
      console.log('[WeeklyEmail] Sending weekly reports...');
      try {
        await sendWeeklyReportsToAll();
      } catch (err) {
        console.error('[WeeklyEmail] Cron job failed:', err.message);
      }
    }, {
      timezone: 'America/Los_Angeles'
    });

    console.log('[WeeklyEmail] Cron registered — every Monday at 8am Pacific');
  } catch (err) {
    console.error('[WeeklyEmail] Failed to register cron:', err.message);
  }
}

main().catch(err => {
  console.error('[worker] Fatal startup error:', err);
  process.exit(1);
});
