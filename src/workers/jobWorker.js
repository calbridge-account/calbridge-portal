/**
 * src/workers/jobWorker.js
 *
 * BullMQ workers for the Calbridge job scheduling layer.
 *
 * Starts two workers that drain the calbridge:light and calbridge:heavy queues.
 * Workers are passed JOB_HANDLERS from cron.js so they can execute any job
 * without needing to re-import every handler here.
 *
 * Concurrency limits:
 *   calbridge:light  — 4 concurrent (health checks, polls)
 *   calbridge:heavy  — 2 concurrent (protects Snowflake connection pool)
 *
 * lockDuration on heavy worker is set to 5 minutes because vendor ingestion
 * and model builds can run for 3+ minutes.
 */

'use strict';

const { Worker } = require('bullmq');
const { REDIS_CONNECTION } = require('../services/jobQueue');
const { recordJobFailure, recordJobSuccess } = require('../services/jobAlerts');

// Jobs that warrant an email alert on repeated failure
const CRITICAL_JOBS = new Set([
  'ingest_vendor_realtime', 'ingest_vendor_daily', 'ingest_vendor_weekly',
  'ingest_seller_realtime', 'ingest_seller_daily', 'ingest_seller_weekly',
  'submit_amazon_reports', 'download_completed_reports', 'build_canonical_models',
]);

/**
 * Start both BullMQ workers.
 *
 * @param {object} JOB_HANDLERS  Map of jobId → async handler function (from cron.js)
 * @returns {{ lightWorker: Worker, heavyWorker: Worker }}
 */
function startWorkers(JOB_HANDLERS) {
  // ── Light worker — health checks, status polls ─────────────────────────────
  const lightWorker = new Worker(
    'calbridge-light',
    async (job) => {
      const { jobId } = job.data;
      const handler = JOB_HANDLERS[jobId];
      if (!handler) throw new Error(`No handler registered for job: ${jobId}`);

      console.log(`[worker:light] Starting ${jobId}`);
      const start = Date.now();
      await handler();
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`[worker:light] Completed ${jobId} in ${elapsed}s`);
    },
    {
      connection: REDIS_CONNECTION,
      concurrency: 4,
    }
  );

  // ── Heavy worker — ingestion, staging, model builds ────────────────────────
  const heavyWorker = new Worker(
    'calbridge-heavy',
    async (job) => {
      const { jobId } = job.data;
      const handler = JOB_HANDLERS[jobId];
      if (!handler) throw new Error(`No handler registered for job: ${jobId}`);

      console.log(`[worker:heavy] Starting ${jobId}`);
      const start = Date.now();
      await handler();
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`[worker:heavy] Completed ${jobId} in ${elapsed}s`);
    },
    {
      connection: REDIS_CONNECTION,
      concurrency: 2,         // KEY: only 2 heavy jobs run at once — protects Snowflake pool
      lockDuration: 1800000,  // 30 min lock — ingest_seller_reports can take up to 20 min (FBA poll + retries)
      lockRenewTime: 600000,  // Renew every 10 min (well within 30 min window)
      maxStalledCount: 1,     // Auto-fail a job if it stalls (lock not renewed) more than once
      stalledInterval: 60000, // Check for stalled jobs every 60s
    }
  );

  // ── Error handlers ─────────────────────────────────────────────────────────
  lightWorker.on('failed', (job, err) => {
    const jobId = job?.data?.jobId ?? 'unknown';
    console.error(`[worker:light] ${jobId} failed:`, err.message);
    if (CRITICAL_JOBS.has(jobId)) {
      recordJobFailure(jobId, err.message).catch(() => {});
    }
  });

  heavyWorker.on('failed', (job, err) => {
    const jobId = job?.data?.jobId ?? 'unknown';
    console.error(`[worker:heavy] ${jobId} failed:`, err.message);
    if (CRITICAL_JOBS.has(jobId)) {
      recordJobFailure(jobId, err.message).catch(() => {});
    }
  });

  // ── Success handlers (reset failure counters) ──────────────────────────────
  lightWorker.on('completed', (job) => {
    const jobId = job?.data?.jobId;
    if (jobId && CRITICAL_JOBS.has(jobId)) {
      recordJobSuccess(jobId).catch(() => {});
    }
  });

  heavyWorker.on('completed', (job) => {
    const jobId = job?.data?.jobId;
    if (jobId && CRITICAL_JOBS.has(jobId)) {
      recordJobSuccess(jobId).catch(() => {});
    }
  });

  lightWorker.on('error', (err) => {
    console.error('[worker:light] Worker error:', err.message);
  });

  heavyWorker.on('error', (err) => {
    console.error('[worker:heavy] Worker error:', err.message);
  });

  console.log('[worker] BullMQ workers started (light concurrency:4, heavy concurrency:2)');
  return { lightWorker, heavyWorker };
}

module.exports = { startWorkers };
