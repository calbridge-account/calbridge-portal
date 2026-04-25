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

  // Start stale queue watchdog
  startQueueWatchdog();
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

/**
 * Stale queue watchdog — runs every 10 minutes.
 * If any ads_report_queue rows have been in 'ready' status for >30 minutes,
 * the download loop has stalled. Log a loud warning and send an alert email.
 * PM2 will restart us if we crash, but this catches a live-but-stuck state.
 */
function startQueueWatchdog() {
  const STALE_THRESHOLD_MIN = 30;
  const CHECK_INTERVAL_MS   = 10 * 60 * 1000; // every 10 min
  let lastAlertSent = 0;
  const ALERT_COOLDOWN_MS = 60 * 60 * 1000; // max 1 alert/hour

  setInterval(async () => {
    try {
      const { query } = require('./services/snowflakeService');
      const rows = await query(`
        SELECT COUNT(1) as stale_count, MIN(polled_at) as oldest
        FROM CALBRIDGE_PROD.APP.ads_report_queue
        WHERE status = 'ready'
          AND polled_at IS NOT NULL
          AND polled_at <= DATEADD('minute', -${STALE_THRESHOLD_MIN}, CURRENT_TIMESTAMP())
      `);
      const staleCount = Number(rows[0]?.STALE_COUNT || 0);
      if (staleCount === 0) return;

      const oldest = rows[0]?.OLDEST;
      const msg = `[worker] ⚠️ STALE QUEUE DETECTED: ${staleCount} report(s) stuck in 'ready' status for >${STALE_THRESHOLD_MIN}min (oldest: ${oldest}). Auto-triggering download pass.`;
      console.error(msg);

      // Auto-heal: enqueue a download pass immediately with a unique ID so it bypasses dedup
      try {
        const { enqueueJob } = require('./services/jobQueue');
        // Override to light queue via direct BullMQ add (enqueueJob uses dedup for heavy)
        const { lightQueue } = require('./services/jobQueue');
        await lightQueue.add('download_completed_reports',
          { jobId: 'download_completed_reports', triggeredBy: 'watchdog' },
          { jobId: `download_completed_reports-watchdog-${Date.now()}`, removeOnComplete: 10, removeOnFail: 5, attempts: 1 }
        );
        console.log('[worker] Watchdog enqueued emergency download pass');
      } catch (healErr) {
        console.warn('[worker] Watchdog auto-heal failed:', healErr.message);
      }

      // Send alert email (max once/hour)
      const now = Date.now();
      if (now - lastAlertSent > ALERT_COOLDOWN_MS) {
        lastAlertSent = now;
        try {
          const { Resend } = require('resend');
          const resend = new Resend(process.env.RESEND_API_KEY);
          await resend.emails.send({
            from: process.env.EMAIL_FROM || 'ash@teamcalbridge.com',
            to:   process.env.EMAIL_ALERT || 'abe@teamcalbridge.com',
            subject: `⚠️ Calbridge worker stalled — ${staleCount} reports stuck`,
            html: `<p><strong>${staleCount} report(s)</strong> have been stuck in 'ready' status for over ${STALE_THRESHOLD_MIN} minutes.</p><p>Oldest: ${oldest}</p><p>The worker download loop may have stalled. Check <code>pm2 logs calbridge-worker</code> and restart if needed.</p>`,
          });
          console.log('[worker] Stale queue alert email sent to abe@teamcalbridge.com');
        } catch (emailErr) {
          console.warn('[worker] Failed to send stale queue alert email:', emailErr.message);
        }
      }
    } catch (err) {
      console.warn('[worker] Queue watchdog check failed (non-fatal):', err.message);
    }
  }, CHECK_INTERVAL_MS);

  console.log('[worker] Queue watchdog started — checking every 10min, alert threshold: 30min');
}

main().catch(err => {
  console.error('[worker] Fatal startup error:', err);
  process.exit(1);
});
