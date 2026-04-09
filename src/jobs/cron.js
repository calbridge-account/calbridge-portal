/**
 * src/jobs/cron.js
 *
 * Central cron runner for the Calbridge platform.
 * Owned by: Control 🎛️
 *
 * Replaces scheduler.js + the old setInterval-based ad-hoc jobs.
 * Uses node-cron for scheduling — declarative, predictable, testable.
 *
 * Architecture:
 *   - Each cron entry maps directly to a job id in src/config/jobs.js
 *   - Jobs are responsible for their own account iteration and JOB_RUNS tracking
 *   - Overlapping runs are guarded by a simple in-process lock (one run per job at a time)
 *   - Crashes in one job are caught and logged — never crash the whole runner
 *
 * Usage:
 *   // Start all cron jobs (called from server.js or as standalone process)
 *   const { startCron } = require('./jobs/cron');
 *   startCron();
 *
 *   // Run a specific job manually (for testing):
 *   const { runJob } = require('./jobs/cron');
 *   await runJob('check_connector_health');
 */

'use strict';

require('dotenv').config();
const cron = require('node-cron');
const { SCHEDULE_CRONS } = require('../config/jobs');

// ─── Job implementations ──────────────────────────────────────────────────────
// Lazy-loaded so cron.js can be require()'d without triggering Snowflake connections
let _connectorHealth    = null;
let _reportOrchestrator = null;
let _stageRawData       = null;
let _buildCanonical     = null;
let _slaChecker         = null;
let _adsIngestion       = null;
let _vendorIngestion    = null;

function connectorHealth()    { return _connectorHealth    || (_connectorHealth    = require('./connectorHealth')); }
function reportOrchestrator() { return _reportOrchestrator || (_reportOrchestrator = require('./reportOrchestrator')); }
function stageRawData()       { return _stageRawData       || (_stageRawData       = require('./stageRawData')); }
function buildCanonical()     { return _buildCanonical     || (_buildCanonical     = require('./buildCanonicalModels')); }
function slaChecker()         { return _slaChecker         || (_slaChecker         = require('./slaChecker')); }
function adsIngestion()       { return _adsIngestion       || (_adsIngestion       = require('./adsIngestion')); }
function vendorIngestion()    { return _vendorIngestion    || (_vendorIngestion    = require('./vendorIngestion')); }

// ─── In-process run lock ──────────────────────────────────────────────────────
// Prevents a slow job from stacking up if the cron fires again before it finishes.
const runningJobs = new Set();

async function withLock(jobId, fn) {
  if (runningJobs.has(jobId)) {
    console.warn(`[cron] ${jobId} still running from previous cycle — skipping this tick`);
    return;
  }
  runningJobs.add(jobId);
  const start = Date.now();
  try {
    await fn();
  } catch (err) {
    console.error(`[cron] ${jobId} threw uncaught error:`, err.message);
  } finally {
    runningJobs.delete(jobId);
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`[cron] ${jobId} finished in ${elapsed}s`);
  }
}

// ─── Job dispatch table ───────────────────────────────────────────────────────
// Maps canonical job id → async function to execute.
// Each function is responsible for iterating accounts and tracking state in JOB_RUNS.

const JOB_HANDLERS = {
  // ── Every 5 min ──────────────────────────────────────────────────────────
  check_connector_health:    () => connectorHealth().checkConnectorHealth({ triggeredBy: 'cron' }),
  poll_report_status:        () => reportOrchestrator().pollReportStatus({ triggeredBy: 'cron' }),
  retry_transient_failures:  () => connectorHealth().retryTransientFailures({ triggeredBy: 'cron' }),
  portal_uptime_monitor:     () => connectorHealth().portalUptimeMonitor({ triggeredBy: 'cron' }),

  // ── Every 15 min ─────────────────────────────────────────────────────────
  submit_amazon_reports:     () => reportOrchestrator().submitAmazonReports({ triggeredBy: 'cron' }),
  download_completed_reports:() => reportOrchestrator().downloadCompletedReports({ triggeredBy: 'cron' }),
  refresh_queue_status:      () => refreshQueueStatus(),
  sync_job_metadata:         () => syncJobMetadata(),

  // ── Hourly — DSP ingestion ──────────────────────────────────────────────
  // DSP uses the same /reporting/reports endpoint as SP/SB/SD and shares
  // ads_report_queue. Runs hourly to match intra-day refresh cadence.
  // The rolling-refresh 1-hour guard in ingestDsp() prevents redundant re-downloads.
  ingest_dsp:                () => ingestDspAllClients({ triggeredBy: 'cron' }),

  // ── Every 6 hours — Vendor retail ingestion ───────────────────────────────
  // Pulls vendor sales, inventory, traffic, net PPM, and forecasts via SP-API.
  // 3-day data lag on DAY reports; runs 4x/day so data is current within hours of availability.
  ingest_vendor_reports:     () => ingestVendorAllClients({ triggeredBy: 'cron' }),

  // ── Hourly ────────────────────────────────────────────────────────────────
  stage_raw_data:               () => stageRawData().stageRawData({ triggeredBy: 'cron' }),
  run_quality_checks:           () => stageRawData().runQualityChecks({ triggeredBy: 'cron' }),
  compute_freshness:            () => stageRawData().computeFreshness({ triggeredBy: 'cron' }),
  reconcile_missing_partitions: () => stageRawData().reconcileMissingPartitions({ triggeredBy: 'cron' }),

  // ── Daily early ───────────────────────────────────────────────────────────
  build_canonical_models:    () => buildCanonical().buildCanonicalModels({ triggeredBy: 'cron' }),
  compute_core_kpis:         () => buildCanonical().computeCoreKpis({ triggeredBy: 'cron' }),
  detect_anomalies:          () => buildCanonical().detectAnomalies({ triggeredBy: 'cron' }),
  generate_operator_summary: () => buildCanonical().generateOperatorSummary({ triggeredBy: 'cron' }),

  // ── Daily post-models ─────────────────────────────────────────────────────
  // score_opportunities: () => economist().scoreOpportunities({ triggeredBy: 'cron' }),

  // ── Weekly ────────────────────────────────────────────────────────────────
  // deep_reconciliation:       () => pipeline().deepReconciliation({ triggeredBy: 'cron' }),
  // regenerate_benchmarks:     () => economist().regenerateBenchmarks({ triggeredBy: 'cron' }),
  // generate_exec_summary:     () => analyst().generateExecSummary({ triggeredBy: 'cron' }),
  // archive_old_payloads:      () => pipeline().archiveOldPayloads({ triggeredBy: 'cron' }),

  // ── Monthly ───────────────────────────────────────────────────────────────
  // credential_audit:          () => connectorHealth().credentialAudit({ triggeredBy: 'cron' }),
  // warehouse_cleanup:         () => pipeline().warehouseCleanup({ triggeredBy: 'cron' }),
};

// ─── DSP ingestion helper ────────────────────────────────────────────────────
// Runs ingestVendorReports for all active clients with a vendor connection.
async function ingestVendorAllClients({ triggeredBy = 'cron' } = {}) {
  const { query: _q } = require('../services/snowflakeService');
  try {
    const clients = await _q(`SELECT client_id FROM clients WHERE status = 'active' AND linked_client_id IS NULL`);
    const { ingestVendorReports } = vendorIngestion();
    let ran = 0;
    for (const row of (clients || [])) {
      const clientId = row.CLIENT_ID || row.client_id;
      try {
        const { getConnectionStatus } = require('../services/amazonAuthService');
        const conn = await getConnectionStatus(clientId);
        if (!conn?.vendor?.connected) continue;
        console.log(`[cron] ingest_vendor_reports starting for ${clientId}`);
        await ingestVendorReports(clientId);
        ran++;
      } catch (err) {
        console.warn(`[cron] ingest_vendor_reports ${clientId} failed:`, err.message);
      }
    }
    console.log(`[cron] ingest_vendor_reports complete ─ ran for ${ran} client(s)`);
  } catch (err) {
    console.error('[cron] ingestVendorAllClients error:', err.message);
  }
}

// Runs ingestDsp for all active clients that have a DSP connection.

async function ingestDspAllClients({ triggeredBy = 'cron' } = {}) {
  const { query: _q } = require('../services/snowflakeService');
  try {
    const clients = await _q(`SELECT client_id FROM clients WHERE status = 'active' AND linked_client_id IS NULL`);
    const { ingestDsp } = adsIngestion();
    let ran = 0;
    for (const row of (clients || [])) {
      const clientId = row.CLIENT_ID || row.client_id;
      try {
        const { getConnectionStatus } = require('../services/amazonAuthService');
        const conn = await getConnectionStatus(clientId);
        if (!conn?.dsp?.connected) continue;
        console.log(`[cron] ingest_dsp starting for ${clientId}`);
        await ingestDsp(clientId, 'dsp', 95);
        ran++;
      } catch (err) {
        console.warn(`[cron] ingest_dsp ${clientId} failed:`, err.message);
      }
    }
    console.log(`[cron] ingest_dsp complete ─ ran for ${ran} client(s)`);
  } catch (err) {
    console.error('[cron] ingestDspAllClients error:', err.message);
  }
}

// ─── Lightweight inline jobs ──────────────────────────────────────────────────
// Simple jobs that don't warrant their own file yet.

const { query } = require('../services/snowflakeService');

/**
 * refresh_queue_status: update a summary count of pending/completed/failed reports.
 * Fast read from ads_report_queue — no heavy processing.
 */
async function refreshQueueStatus() {
  try {
    const counts = await query(`
      SELECT status, COUNT(*) AS cnt
      FROM ads_report_queue
      WHERE requested_at >= DATEADD('day', -2, CURRENT_TIMESTAMP())
      GROUP BY status
    `);
    const summary = Object.fromEntries((counts || []).map(r => [
      (r.STATUS || r.status).toLowerCase(),
      Number(r.CNT || r.cnt),
    ]));
    console.log('[queueStatus]', JSON.stringify(summary));
  } catch (err) {
    console.warn('[queueStatus] Failed:', err.message);
  }
}

/**
 * sync_job_metadata: log a brief summary of recent JOB_RUNS status.
 * Placeholder — future version writes to an operational dashboard table.
 */
async function syncJobMetadata() {
  try {
    const rows = await query(`
      SELECT job_type, status, COUNT(*) AS cnt
      FROM CALBRIDGE_PROD.PIPELINE.JOB_RUNS
      WHERE started_at >= DATEADD('hour', -1, CURRENT_TIMESTAMP())
      GROUP BY job_type, status
      ORDER BY cnt DESC
    `);
    if (rows?.length) {
      console.log(`[syncMeta] Last hour: ${rows.length} job types active`);
    }
  } catch (err) {
    console.warn('[syncMeta] Failed:', err.message);
  }
}

// ─── Cron schedule definitions ────────────────────────────────────────────────

const CRON_SCHEDULE = [
  // ── Every 5 min ────────────────────────────────────────────────────────────
  {
    jobId: 'check_connector_health',
    expr:  SCHEDULE_CRONS['every5min'],
  },
  {
    jobId: 'poll_report_status',
    expr:  SCHEDULE_CRONS['every5min'],
  },
  {
    jobId: 'retry_transient_failures',
    expr:  SCHEDULE_CRONS['every5min'],
  },
  {
    jobId: 'portal_uptime_monitor',
    expr:  SCHEDULE_CRONS['every5min'],
  },

  // ── Every 15 min ───────────────────────────────────────────────────────────
  {
    jobId: 'submit_amazon_reports',
    expr:  SCHEDULE_CRONS['every15min'],
  },
  {
    jobId: 'download_completed_reports',
    expr:  SCHEDULE_CRONS['every15min'],
  },
  {
    jobId: 'refresh_queue_status',
    expr:  SCHEDULE_CRONS['every15min'],
  },
  {
    jobId: 'sync_job_metadata',
    expr:  SCHEDULE_CRONS['every15min'],
  },

  // ── Hourly ─────────────────────────────────────────────────────────────────
  {
    jobId: 'stage_raw_data',
    expr:  SCHEDULE_CRONS['hourly'],
  },
  {
    jobId: 'run_quality_checks',
    expr:  '10 * * * *',  // offset 10 min so quality runs after staging completes
  },
  {
    jobId: 'compute_freshness',
    expr:  '20 * * * *',  // 20 min past each hour
  },
  {
    jobId: 'reconcile_missing_partitions',
    expr:  '40 * * * *',  // 40 min past each hour
  },

  // ── Daily (early morning) ──────────────────────────────────────────────────
  {
    jobId: 'build_canonical_models',
    expr:  SCHEDULE_CRONS['daily-early'],      // 02:00 UTC
  },
  {
    jobId: 'compute_core_kpis',
    expr:  '30 2 * * *',    // 02:30 UTC — after build_canonical_models
  },
  {
    jobId: 'detect_anomalies',
    expr:  '0 3 * * *',     // 03:00 UTC — after compute_core_kpis
  },
  {
    jobId: 'generate_operator_summary',
    expr:  '30 3 * * *',    // 03:30 UTC — after detect_anomalies
  },

  // ── Hourly — DSP (separate API, advertiser-scoped auth) ───────────────
  // Increased from every 6h to every 1h to match SP/SB/SD intra-day refresh cadence.
  // DSP uses the same /reporting/reports endpoint and ads_report_queue flow;
  // the rolling-refresh 1-hour guard in ingestDsp() prevents redundant re-downloads.
  {
    jobId: 'ingest_dsp',
    expr:  '0 * * * *',   // every hour at :00
  },

  // Every 6 hours — Vendor retail reports (SP-API, 3-day data lag)
  {
    jobId: 'ingest_vendor_reports',
    expr:  '30 */6 * * *',  // 00:30, 06:30, 12:30, 18:30 UTC (offset from DSP)
  },

  // ── Daily (post-models) ────────────────────────────────────────────────────
  // Uncomment when score_opportunities is implemented:
  // {
  //   jobId: 'score_opportunities',
  //   expr:  SCHEDULE_CRONS['daily-post-models'],   // 04:30 UTC
  // },

  // ── SLA checker ────────────────────────────────────────────────────────────
  // Disabled — not providing value currently
  // {
  //   jobId: '_sla_checker',
  //   expr:  '*/30 * * * *',
  //   handler: () => slaChecker().runSlaCheck(),
  // },
];

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Run a single job by id immediately (bypasses lock check).
 * Useful for manual triggers, testing, and dependency-driven execution.
 *
 * @param {string} jobId  Canonical job id or '_sla_checker'
 * @param {object} [opts]
 * @param {string} [opts.triggeredBy='manual']
 */
async function runJob(jobId, { triggeredBy = 'manual' } = {}) {
  const entry = CRON_SCHEDULE.find(e => e.jobId === jobId);
  const handler = entry?.handler || JOB_HANDLERS[jobId];

  if (!handler) {
    throw new Error(`No handler registered for job: ${jobId}`);
  }

  console.log(`[cron] Running ${jobId} (${triggeredBy})`);
  return handler({ triggeredBy });
}

/**
 * Start all cron jobs.
 * Call once on application startup.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.runImmediately=false]  Run each job once immediately on startup
 */
function startCron({ runImmediately = false } = {}) {
  console.log('[cron] Starting Calbridge job scheduler...');

  let registered = 0;

  for (const entry of CRON_SCHEDULE) {
    const { jobId, expr } = entry;
    const handler = entry.handler || JOB_HANDLERS[jobId];

    if (!handler) {
      console.warn(`[cron] No handler for ${jobId} — skipping`);
      continue;
    }

    if (!cron.validate(expr)) {
      console.error(`[cron] Invalid cron expression for ${jobId}: "${expr}" — skipping`);
      continue;
    }

    cron.schedule(expr, () => withLock(jobId, handler), {
      timezone: 'UTC',
    });

    registered++;
    console.log(`[cron] ✅ Registered ${jobId} — ${expr}`);
  }

  console.log(`[cron] ${registered} jobs registered`);

  if (runImmediately) {
    console.log('[cron] Running startup jobs...');
    // Only run the cheap health checks on startup, not the heavy daily jobs
    const startupJobs = ['check_connector_health', 'poll_report_status', 'refresh_queue_status'];
    for (const jobId of startupJobs) {
      setImmediate(() => withLock(jobId, JOB_HANDLERS[jobId] || (() => {})));
    }
  }

  return { registered };
}

/**
 * Stop all scheduled cron tasks.
 * Useful for tests and graceful shutdown.
 */
function stopCron() {
  const tasks = cron.getTasks();
  if (tasks && typeof tasks.forEach === 'function') {
    tasks.forEach(task => task.stop());
  }
  console.log('[cron] All cron tasks stopped');
}

module.exports = {
  startCron,
  stopCron,
  runJob,
  JOB_HANDLERS,
};
