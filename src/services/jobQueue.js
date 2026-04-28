/**
 * src/services/jobQueue.js
 *
 * BullMQ queue definitions for the Calbridge job scheduling layer.
 *
 * Purpose: prevent Snowflake connection pool exhaustion by limiting how many
 * heavy jobs run concurrently. At cron boundaries (e.g. 18:30 UTC) many jobs
 * fire simultaneously — this queuing layer serializes them safely.
 *
 * Two queues:
 *   calbridge-light  — health checks, status polls (concurrency 4)
 *   calbridge-heavy  — ingestion, staging, model builds (concurrency 2)
 *
 * Critical paths (session reads, auth) are NOT routed through queues.
 */

'use strict';

const { Queue } = require('bullmq');

const REDIS_CONNECTION = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
};

const QUEUE_DEFAULTS = {
  defaultJobOptions: {
    removeOnComplete: 100,  // keep last 100 completed job records
    removeOnFail: 50,       // keep last 50 failed job records
    attempts: 2,
    backoff: { type: 'exponential', delay: 5000 },
  },
};

// Per-job timeout overrides for heavy jobs that have known long runtimes
// Jobs exceeding their timeout are killed and marked failed (freeing the worker slot)
const JOB_TIMEOUTS = {
  ingest_vendor_reports:        15 * 60 * 1000,  // 15 min max
  ingest_dsp:                   20 * 60 * 1000,  // 20 min max
  ingest_seller_reports:        20 * 60 * 1000,  // 20 min max (FBA poll + retries)
  ingest_seller_realtime:        5 * 60 * 1000,  //  5 min max (order metrics only)
  ingest_seller_daily:          20 * 60 * 1000,  // 20 min max
  ingest_seller_weekly:         15 * 60 * 1000,  // 15 min max
  stage_raw_data:               10 * 60 * 1000,  // 10 min max
  download_completed_reports:   10 * 60 * 1000,  // 10 min max
  submit_amazon_reports:        10 * 60 * 1000,  // 10 min max
  build_canonical_models:       30 * 60 * 1000,  // 30 min max
};

const lightQueue = new Queue('calbridge-light', {
  connection: REDIS_CONNECTION,
  ...QUEUE_DEFAULTS,
});

const heavyQueue = new Queue('calbridge-heavy', {
  connection: REDIS_CONNECTION,
  ...QUEUE_DEFAULTS,
});

// ─── Job → queue routing ──────────────────────────────────────────────────────
// Determines which queue (and thus concurrency limit) each job is subject to.

const JOB_QUEUE_MAP = {
  // Light: health checks, status polls — fast, cheap, high concurrency OK
  check_connector_health:       'light',
  poll_report_status:           'light',
  retry_transient_failures:     'light',
  portal_uptime_monitor:        'light',
  refresh_queue_status:         'light',
  sync_job_metadata:            'light',

  // Light: daily reporting emails — fast queries + email, no heavy Snowflake holding
  data_freshness_report:        'light',

  // Heavy: ingestion, staging, model builds — hold Snowflake connections, must be serialized
  submit_amazon_reports:        'heavy',
  download_completed_reports:   'light',  // moved from heavy — must never be blocked by long vendor/DSP jobs
  stage_raw_data:               'heavy',
  run_quality_checks:           'heavy',
  compute_freshness:            'heavy',
  reconcile_missing_partitions: 'heavy',
  build_canonical_models:       'heavy',
  compute_core_kpis:            'heavy',
  detect_anomalies:             'heavy',
  generate_operator_summary:    'heavy',
  ingest_dsp:                   'heavy',
  ingest_vendor_realtime:        'heavy',
  ingest_vendor_daily:           'heavy',
  ingest_vendor_weekly:          'heavy',
  ingest_vendor_reports:         'heavy',  // legacy
  ingest_seller_reports:         'heavy',
  seller_backfill:              'heavy',  // legacy/manual — full cadence
  ingest_seller_realtime:        'heavy',
  ingest_seller_daily:           'heavy',
  ingest_seller_weekly:          'heavy',
};

/**
 * Enqueue a job by id. The job will be processed by the appropriate worker
 * with the correct concurrency limit applied.
 *
 * Uses a timestamp-scoped jobId so each cron tick produces a distinct job
 * (no unintentional deduplication across ticks). BullMQ's worker concurrency
 * handles the actual rate-limiting.
 *
 * @param {string} jobId  Canonical job id from JOB_HANDLERS
 * @param {object} [data] Optional extra data to pass to the worker
 * @returns {Promise<string>} Queue type: 'light' | 'heavy'
 */
async function enqueueJob(jobId, data = {}) {
  const queueType = JOB_QUEUE_MAP[jobId] || 'light';
  const queue = queueType === 'heavy' ? heavyQueue : lightQueue;

  // For heavy jobs: use a daily-scoped key (YYYY-MM-DD) so BullMQ deduplicates
  // within a single day (prevents pile-up) but never blocks the next day's run.
  // A fixed jobId (no timestamp) caused a permanent dedup deadlock — once a job
  // completed, BullMQ refused to re-enqueue it until the Redis key was manually deleted.
  // For light jobs: use unique key so all ticks execute.
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD UTC
  const jobKey = queueType === 'heavy'
    ? `${jobId}-${today}`  // deduplicated per day, re-runs each UTC day
    : `${jobId}-${Date.now()}`;  // unique per tick

  const opts = { jobId: jobKey };
  if (JOB_TIMEOUTS[jobId]) opts.timeout = JOB_TIMEOUTS[jobId];
  await queue.add(jobId, { jobId, ...data }, opts);
  return queueType;
}

module.exports = {
  lightQueue,
  heavyQueue,
  enqueueJob,
  JOB_QUEUE_MAP,
  REDIS_CONNECTION,
};
