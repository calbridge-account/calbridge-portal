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
const { enqueueJob } = require('../services/jobQueue');

// ─── Job implementations ──────────────────────────────────────────────────────
// Lazy-loaded so cron.js can be require()'d without triggering Snowflake connections
let _connectorHealth    = null;
let _reportOrchestrator = null;
let _stageRawData       = null;
let _buildCanonical     = null;
let _slaChecker         = null;
let _adsIngestion       = null;
let _vendorIngestion    = null;
let _sellerIngestion    = null;
let _daypartingEngine   = null;
let _daypartingService  = null;

function daypartingEngine() { return _daypartingEngine || (_daypartingEngine = require('./daypartingEngine')); }
function daypartingService() { return _daypartingService || (_daypartingService = require('../services/daypartingService')); }
function sellerIngestion() { return _sellerIngestion || (_sellerIngestion = require('./sellerIngestion')); }
function connectorHealth()    { return _connectorHealth    || (_connectorHealth    = require('./connectorHealth')); }
function reportOrchestrator() { return _reportOrchestrator || (_reportOrchestrator = require('./reportOrchestrator')); }
function stageRawData()       { return _stageRawData       || (_stageRawData       = require('./stageRawData')); }
function rebuildMart(opts)     { return stageRawData().rebuildMart(opts); }
function buildCanonical()     { return _buildCanonical     || (_buildCanonical     = require('./buildCanonicalModels')); }
function slaChecker()         { return _slaChecker         || (_slaChecker         = require('./slaChecker')); }
function adsIngestion()       { return _adsIngestion       || (_adsIngestion       = require('./adsIngestion')); }
function vendorIngestion()    { return _vendorIngestion    || (_vendorIngestion    = require('./vendorIngestion')); }

// ─── In-process run lock (fallback only) ─────────────────────────────────────
// Used as a fallback when Redis/BullMQ is unavailable. Under normal operation
// concurrency is managed by the BullMQ workers (see src/workers/jobWorker.js).
const runningJobs = new Set();

/**
 * Enqueue a job via BullMQ. Falls back to direct in-process execution if Redis
 * is unavailable, so cron jobs always run even without the queue layer.
 */
async function withLock(jobId, fn) {
  try {
    const queueType = await enqueueJob(jobId);
    console.log(`[cron] Enqueued ${jobId} → ${queueType}`);
    return; // worker will execute the job asynchronously
  } catch (queueErr) {
    // Redis unavailable or BullMQ error — fall back to direct execution
    console.warn(`[cron] BullMQ enqueue failed for ${jobId} (${queueErr.message}), running directly`);
  }

  // ── Fallback: run directly with in-process lock ────────────────────────────
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
  download_completed_reports: async () => {
    const result = await reportOrchestrator().downloadCompletedReports({ triggeredBy: 'cron' });
    // Event-driven trigger: if new rows landed, immediately enqueue stage + rebuild
    // rather than waiting for the 8h fallback schedule
    if (result?.rowsWritten > 0) {
      console.log('[cron] New data downloaded — triggering stage_raw_data + rebuild_mart immediately');
      await withLock('stage_raw_data', JOB_HANDLERS.stage_raw_data).catch(e =>
        console.warn('[cron] Event-triggered stage_raw_data failed:', e.message)
      );
      await withLock('rebuild_mart', JOB_HANDLERS.rebuild_mart).catch(e =>
        console.warn('[cron] Event-triggered rebuild_mart failed:', e.message)
      );
    }
    return result;
  },
  refresh_queue_status:      () => refreshQueueStatus(),
  sync_job_metadata:         () => syncJobMetadata(),

  // ── Every 6 hours — Vendor retail ingestion ───────────────────────────────
  // Pulls vendor sales, inventory, traffic, net PPM, and forecasts via SP-API.
  // 3-day data lag on DAY reports; runs 4x/day so data is current within hours of availability.
  ingest_vendor_realtime:    () => ingestVendorRealtimeAllClients({ triggeredBy: 'cron' }),
  ingest_vendor_daily:       () => ingestVendorDailyAllClients({ triggeredBy: 'cron' }),
  ingest_vendor_weekly:      () => ingestVendorWeeklyAllClients({ triggeredBy: 'cron' }),
  ingest_vendor_reports:     () => ingestVendorAllClients({ triggeredBy: 'cron' }),  // legacy/manual

  // ── Hourly ────────────────────────────────────────────────────────────────
  stage_raw_data:               () => stageRawData().stageRawData({ triggeredBy: 'cron' }),
  run_quality_checks:           () => stageRawData().runQualityChecks({ triggeredBy: 'cron' }),
  compute_freshness:            () => stageRawData().computeFreshness({ triggeredBy: 'cron' }),
  reconcile_missing_partitions: () => stageRawData().reconcileMissingPartitions({ triggeredBy: 'cron' }),
  rebuild_mart:                 () => rebuildMart({ triggeredBy: 'cron' }),

  // ── Daily early ───────────────────────────────────────────────────────────
  build_canonical_models:    () => buildCanonical().buildCanonicalModels({ triggeredBy: 'cron' }),
  compute_core_kpis:         () => buildCanonical().computeCoreKpis({ triggeredBy: 'cron' }),
  detect_anomalies:          () => buildCanonical().detectAnomalies({ triggeredBy: 'cron' }),
  generate_operator_summary: () => buildCanonical().generateOperatorSummary({ triggeredBy: 'cron' }),

  // ── Daily cleanup — expire unverified accounts after 48h ────────────────────
  expire_unverified_accounts: () => {
    const { query: _q } = require('../services/snowflakeService');
    return _q(`
      DELETE FROM CALBRIDGE_PROD.APP.clients
      WHERE status = 'pending_verification'
        AND email_verification_expires_at < CURRENT_TIMESTAMP()
        AND created_at < DATEADD('hour', -48, CURRENT_TIMESTAMP())
    `)
    .then(r => console.log('[cleanup] expired unverified accounts:', r[0]?.['number of rows deleted'] ?? 0))
    .catch(e => console.warn('[cleanup] expire_unverified_accounts failed:', e.message));
  },

  // ── Daily cleanup — ads_report_queue TTL (keep 7 days, delete older completed) ─
  cleanup_report_queue:         () => {
    const { query: _q } = require('../services/snowflakeService');
    return Promise.all([
      // Prune old completed/failed queue entries
      _q("DELETE FROM CALBRIDGE_PROD.APP.ads_report_queue WHERE status IN ('completed','skipped','failed') AND requested_at < DATEADD('day',-7,CURRENT_TIMESTAMP())"),
      // Guard: remove null-marketplace rows from MARTS ONLY if a non-null version exists
      // (race condition protection — avoids deleting rows that have no non-null counterpart)
      _q(`DELETE FROM CALBRIDGE_PROD.MARTS.CAMPAIGN_PERFORMANCE t
          WHERE t.marketplace IS NULL
          AND EXISTS (
            SELECT 1 FROM CALBRIDGE_PROD.MARTS.CAMPAIGN_PERFORMANCE m
            WHERE m.client_id=t.client_id AND m.campaign_id=t.campaign_id
              AND m.date=t.date AND m.ad_type=t.ad_type AND m.marketplace IS NOT NULL
          )`),
      _q(`DELETE FROM CALBRIDGE_PROD.MARTS.AD_PERFORMANCE_DAILY t
          WHERE t.marketplace IS NULL
          AND EXISTS (
            SELECT 1 FROM CALBRIDGE_PROD.MARTS.AD_PERFORMANCE_DAILY m
            WHERE m.client_id=t.client_id AND m.date=t.date AND m.ad_type=t.ad_type AND m.marketplace IS NOT NULL
          )`)
    ]).then(([q, cp, apd]) => {
      console.log('[cleanup] report_queue deleted:', q[0]?.['number of rows deleted'] ?? 0);
      const cpDel = cp[0]?.['number of rows deleted'] ?? 0;
      const apdDel = apd[0]?.['number of rows deleted'] ?? 0;
      if (cpDel > 0 || apdDel > 0) console.warn('[cleanup] Removed null-marketplace MARTS rows — CP:', cpDel, 'APD:', apdDel);
    }).catch(() => {});
  },

  // ── Daily cleanup ──────────────────────────────────────────────────────────
  expire_stale_actions:      () => stageRawData().expireStaleActions({ triggeredBy: 'cron' }),

  // ── Every 6 hours — Seller Central ingestion ───────────────────────────────
  ingest_seller_realtime:    () => ingestSellerRealtimeAllClients({ triggeredBy: 'cron' }),
  ingest_seller_daily:       () => ingestSellerDailyAllClients({ triggeredBy: 'cron' }),
  ingest_seller_weekly:      () => ingestSellerWeeklyAllClients({ triggeredBy: 'cron' }),
  ingest_seller_reports:     () => sellerIngestion().ingestSellerAllClients({ triggeredBy: 'cron' }),  // legacy/manual
  seller_backfill:           () => sellerIngestion().sellerBackfill('7d88ea17-002b-4a02-97fc-bcab1292d57e'),

  // ── Every 5 min — flush buffered JOB_RUNS to Snowflake ───────────────────────
  flush_job_runs:               () => require('../services/jobRunner').flushJobRunBuffer({ triggeredBy: 'cron' }),
  archive_job_runs:             () => require('../services/jobRunner').archiveJobRuns({ triggeredBy: 'cron' }),

  // ── Hourly — Dayparting ─────────────────────────────────────────────────────
  execute_dayparting:           () => daypartingEngine().executeDaypartingAllClients({ triggeredBy: 'cron' }),
  apply_daypart_schedules:      () => daypartingService().applyDaypartSchedulesAllClients({ triggeredBy: 'cron' }),

  // ── Daily recommendations ──────────────────────────────────────────────────
  // Run decision engine analysis for all active clients at 06:00 UTC.
  generate_recommendations:  () => generateRecommendationsAllClients({ triggeredBy: 'cron' }),

  // ── Daily Marginal ROAS scoring ────────────────────────────────────────────
  // Score all campaigns for efficiency and write to CAMPAIGN_MARGINAL_ROAS.
  score_marginal_roas: () => require('../services/marginalRoasService').scoreAllClients(),

  // ── Daily data freshness report ───────────────────────────────────────────
  // Email abe@teamcalbridge.com a table showing MAX(ingested_at) per client per source.
  data_freshness_report: () => require('../services/dataFreshnessReport').sendFreshnessReport(),

  // ── Data settlement — Amazon attribution windows ───────────────────────────
  // D-3→D-14: daily re-pull (attribution still closing)
  settle_recent_data:      () => require('./dataSettlement').settleRecentData({ triggeredBy: 'cron' }),
  // D-15→D-60: weekly re-pull (near-final, rare adjustments)
  finalize_historical_data: () => require('./dataSettlement').finalizeHistoricalData({ triggeredBy: 'cron' }),


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
// Helper: get all active clients with a vendor connection
async function getVendorClients() {
  const { query: _q } = require('../services/snowflakeService');
  const { getConnectionStatus } = require('../services/amazonAuthService');
  const clients = await _q(`SELECT client_id FROM clients WHERE status = 'active' AND linked_client_id IS NULL`);
  const connected = [];
  for (const row of (clients || [])) {
    const clientId = row.CLIENT_ID || row.client_id;
    try {
      const conn = await getConnectionStatus(clientId);
      if (conn?.vendor?.connected) connected.push(clientId);
    } catch (_) {}
  }
  return connected;
}

// Every 6h — RT only
async function ingestVendorRealtimeAllClients({ triggeredBy = 'cron' } = {}) {
  try {
    const clients = await getVendorClients();
    const { ingestVendorRealtimeReports } = vendorIngestion();
    let ran = 0;
    for (const clientId of clients) {
      try { await ingestVendorRealtimeReports(clientId); ran++; }
      catch (err) { console.warn(`[cron] ingest_vendor_realtime ${clientId} failed:`, err.message); }
    }
    console.log(`[cron] ingest_vendor_realtime complete ─ ran for ${ran} client(s)`);
  } catch (err) { console.error('[cron] ingestVendorRealtimeAllClients error:', err.message); }
}

// Daily — sales, inventory, traffic, netPPM
async function ingestVendorDailyAllClients({ triggeredBy = 'cron' } = {}) {
  try {
    const clients = await getVendorClients();
    const { ingestVendorDailyReports } = vendorIngestion();
    let ran = 0;
    for (const clientId of clients) {
      try { await ingestVendorDailyReports(clientId); ran++; }
      catch (err) { console.warn(`[cron] ingest_vendor_daily ${clientId} failed:`, err.message); }
    }
    console.log(`[cron] ingest_vendor_daily complete ─ ran for ${ran} client(s)`);
  } catch (err) { console.error('[cron] ingestVendorDailyAllClients error:', err.message); }
}

// Weekly (Monday) — forecasts only
async function ingestVendorWeeklyAllClients({ triggeredBy = 'cron' } = {}) {
  try {
    const clients = await getVendorClients();
    const { ingestVendorWeeklyReports } = vendorIngestion();
    let ran = 0;
    for (const clientId of clients) {
      try { await ingestVendorWeeklyReports(clientId); ran++; }
      catch (err) { console.warn(`[cron] ingest_vendor_weekly ${clientId} failed:`, err.message); }
    }
    console.log(`[cron] ingest_vendor_weekly complete ─ ran for ${ran} client(s)`);
  } catch (err) { console.error('[cron] ingestVendorWeeklyAllClients error:', err.message); }
}

// ─── Seller ingestion helpers ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

// Every 6h — order metrics only
async function ingestSellerRealtimeAllClients({ triggeredBy = 'cron' } = {}) {
  try {
    const { query: _q } = require('../services/snowflakeService');
    const { getConnectionStatus } = require('../services/amazonAuthService');
    const clients = await _q(`SELECT client_id FROM clients WHERE status = 'active' AND linked_client_id IS NULL`);
    const { ingestSellerRealtimeReports } = sellerIngestion();
    let ran = 0;
    for (let i = 0; i < (clients || []).length; i++) {
      const clientId = clients[i].CLIENT_ID || clients[i].client_id;
      if (i > 0) await new Promise(r => setTimeout(r, 90000));
      try {
        const conn = await getConnectionStatus(clientId);
        if (!conn?.seller?.connected) continue;
        await ingestSellerRealtimeReports(clientId);
        ran++;
      } catch (err) { console.warn(`[cron] ingest_seller_realtime ${clientId} failed:`, err.message); }
    }
    console.log(`[cron] ingest_seller_realtime complete — ran for ${ran} client(s)`);
  } catch (err) { console.error('[cron] ingestSellerRealtimeAllClients error:', err.message); }
}

// Daily — sales traffic, FBA inventory, restock, returns, shipments
async function ingestSellerDailyAllClients({ triggeredBy = 'cron' } = {}) {
  try {
    const { query: _q } = require('../services/snowflakeService');
    const { getConnectionStatus } = require('../services/amazonAuthService');
    const clients = await _q(`SELECT client_id FROM clients WHERE status = 'active' AND linked_client_id IS NULL`);
    const { ingestSellerDailyReports } = sellerIngestion();
    let ran = 0;
    for (let i = 0; i < (clients || []).length; i++) {
      const clientId = clients[i].CLIENT_ID || clients[i].client_id;
      if (i > 0) await new Promise(r => setTimeout(r, 90000));
      try {
        const conn = await getConnectionStatus(clientId);
        if (!conn?.seller?.connected) continue;
        await ingestSellerDailyReports(clientId);
        ran++;
      } catch (err) { console.warn(`[cron] ingest_seller_daily ${clientId} failed:`, err.message); }
    }
    console.log(`[cron] ingest_seller_daily complete — ran for ${ran} client(s)`);
  } catch (err) { console.error('[cron] ingestSellerDailyAllClients error:', err.message); }
}

// Weekly (Sunday) — FBA fees + listing snapshot
async function ingestSellerWeeklyAllClients({ triggeredBy = 'cron' } = {}) {
  try {
    const { query: _q } = require('../services/snowflakeService');
    const { getConnectionStatus } = require('../services/amazonAuthService');
    const clients = await _q(`SELECT client_id FROM clients WHERE status = 'active' AND linked_client_id IS NULL`);
    const { ingestSellerWeeklyReports } = sellerIngestion();
    let ran = 0;
    for (let i = 0; i < (clients || []).length; i++) {
      const clientId = clients[i].CLIENT_ID || clients[i].client_id;
      if (i > 0) await new Promise(r => setTimeout(r, 90000));
      try {
        const conn = await getConnectionStatus(clientId);
        if (!conn?.seller?.connected) continue;
        await ingestSellerWeeklyReports(clientId);
        ran++;
      } catch (err) { console.warn(`[cron] ingest_seller_weekly ${clientId} failed:`, err.message); }
    }
    console.log(`[cron] ingest_seller_weekly complete — ran for ${ran} client(s)`);
  } catch (err) { console.error('[cron] ingestSellerWeeklyAllClients error:', err.message); }
}

// Legacy — kept for manual triggers and backward compat
async function ingestVendorAllClients({ triggeredBy = 'cron' } = {}) {
  try {
    const clients = await getVendorClients();
    const { ingestVendorReports } = vendorIngestion();
    let ran = 0;
    for (const clientId of clients) {
      try { console.log(`[cron] ingest_vendor_reports starting for ${clientId}`); await ingestVendorReports(clientId); ran++; }
      catch (err) { console.warn(`[cron] ingest_vendor_reports ${clientId} failed:`, err.message); }
    }
    console.log(`[cron] ingest_vendor_reports complete ─ ran for ${ran} client(s)`);
  } catch (err) { console.error('[cron] ingestVendorAllClients error:', err.message); }
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
        // Use 'ads' connection type for DSP reports — the ads OAuth token has the
        // correct scope for Amazon DSP Reporting API. The 'dsp' token returns 401
        // because it lacks the advertising::campaign_management scope needed for
        // the DSP reporting endpoint. Fall back to 'dsp' token only if no ads conn.
        const dspConnType = conn?.ads?.connected ? 'ads' : 'dsp';
        if (!conn?.dsp?.connected && !conn?.ads?.connected) continue;
        console.log(`[cron] ingest_dsp starting for ${clientId} (token: ${dspConnType})`);
        await ingestDsp(clientId, dspConnType, 95);
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


// ─── Daily recommendations ────────────────────────────────────────────────────
async function generateRecommendationsAllClients({ triggeredBy = 'cron' } = {}) {
  const { query: _q } = require('../services/snowflakeService');
  try {
    const clients = await _q(`SELECT client_id FROM clients WHERE status = 'active' AND linked_client_id IS NULL`);
    const { analyze, pruneStaleActions } = require('../services/decisionEngine');
    let ran = 0;
    for (const row of (clients || [])) {
      const clientId = row.CLIENT_ID || row.client_id;
      try {
        // Step 1: prune pending actions that no longer apply
        const pruned = await pruneStaleActions(clientId, 30);
        console.log(`[cron] generate_recommendations ${clientId}: pruned=${pruned?.pruned ?? 0} stale actions`);

        // Step 2: generate fresh recommendations
        console.log(`[cron] generate_recommendations starting for ${clientId}`);
        const result = await analyze(clientId, 30);
        console.log(`[cron] generate_recommendations ${clientId}: generated=${result?.generated ?? 0} pending=${result?.total_pending ?? 0}`);
        ran++;
      } catch (err) {
        console.warn(`[cron] generate_recommendations ${clientId} failed:`, err.message);
      }
    }
    console.log(`[cron] generate_recommendations complete — ran for ${ran} client(s)`);
  } catch (err) {
    console.error('[cron] generateRecommendationsAllClients error:', err.message);
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
    expr:  '*/30 * * * *',  // reduced from every5min — saves ~400 Snowflake writes/day
  },
  {
    jobId: 'flush_job_runs',
    expr:  '*/15 * * * *',  // reduced from every5min — 15min flush is fine, saves ~200 Snowflake writes/day
  },
  {
    jobId: 'poll_report_status',
    expr:  '*/30 * * * *',  // every 30 min — reports take 10-60+ min to generate anyway
  },
  {
    jobId: 'retry_transient_failures',
    expr:  '*/30 * * * *',  // reduced from every5min — saves ~400 Snowflake queries/day
  },
  {
    jobId: 'portal_uptime_monitor',
    expr:  '*/15 * * * *',  // reduced from every5min
  },

  // ── Every 15 min ───────────────────────────────────────────────────────────
  {
    jobId: 'submit_amazon_reports',
    expr:  '0 3,11,19 * * *',  // 3am, 11am, 7pm PST/PDT — auto-handles DST via America/Los_Angeles
    tz:    'America/Los_Angeles',
  },
  {
    jobId: 'download_completed_reports',
    expr:  '*/30 * * * *',  // every 30 min — sets pending_stage flag when new rows land
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
    expr:  '0 */8 * * *',  // 8h fallback — event-triggered via pending_stage flag when new data lands
  },
  {
    jobId: 'rebuild_mart',
    expr:  '30 */8 * * *', // 8h fallback — 30 min after stage_raw_data, also event-triggered
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
  {
    jobId: 'archive_job_runs',
    expr:  '0 2 * * 0',   // weekly Sunday 02:00 UTC — archive Redis job_runs to Snowflake
  },
  {
    jobId: 'cleanup_report_queue',
    expr:  '30 3 * * *',  // 03:30 UTC daily
  },
  {
    jobId: 'expire_unverified_accounts',
    expr:  '0 3 * * *',   // daily 03:00 UTC
  },
  {
    jobId: 'expire_stale_actions',
    expr:  '0 4 * * *',     // 04:00 UTC daily — expire decisions older than 14 days
  },
  {
    jobId: 'generate_recommendations',
    expr:  '0 6 * * *',     // 06:00 UTC daily — prune stale + generate fresh recommendations
  },
  {
    jobId: 'score_marginal_roas',
    expr:  '30 6 * * *',    // 06:30 UTC daily — score campaign marginal ROAS after recommendations
  },

  // ── Data settlement — Amazon attribution windows ───────────────────────────
  {
    jobId: 'settle_recent_data',
    expr:  '0 1 * * *',     // daily 01:00 UTC — reset D-3→D-14 rows for settling attribution
  },
  {
    jobId: 'finalize_historical_data',
    expr:  '0 2 * * 0',     // weekly Sunday 02:00 UTC — reset D-15→D-60 rows for near-final pass
  },

  // Every 6 hours — Vendor retail reports (SP-API, 3-day data lag)
  // Note: DSP reports are now handled by submit_amazon_reports (every 15 min).
  {
    jobId: 'execute_dayparting',
    expr:  '0 * * * *',    // every hour at :00 — check dayparting rules
  },
  {
    jobId: 'apply_daypart_schedules',
    expr:  '0 * * * *',    // every hour at :00 — apply 24h multiplier schedules
  },
  // { jobId: 'ingest_seller_reports', expr: '15 */6 * * *' },  // disabled — replaced by cadence-split jobs below (keep handler for manual use)
  { jobId: 'ingest_seller_realtime', expr: '45 */6 * * *' },  // every 6h at :45 — order metrics
  { jobId: 'ingest_seller_daily',    expr: '0 7 * * *' },     // daily 07:00 UTC — sales, inventory, restock, returns, shipments
  { jobId: 'ingest_seller_weekly',   expr: '0 7 * * 0' },     // weekly Sunday 07:00 UTC — FBA fees + listing snapshot
  // Vendor cadence-split (2026-04-27)
  {
    jobId: 'ingest_vendor_realtime',
    expr:  '30 */6 * * *',  // every 6h at :30 — RT sales + RT inventory
  },
  {
    jobId: 'ingest_vendor_daily',
    expr:  '30 6 * * *',    // daily 06:30 UTC — sales, inventory, traffic, netPPM
  },
  {
    jobId: 'ingest_vendor_weekly',
    expr:  '0 8 * * 1',     // weekly Monday 08:00 UTC — forecasts (48h after Amazon Sat SLA)
  },
  {
    jobId: 'data_freshness_report',
    expr:  '0 8 * * *',     // daily 08:00 UTC — data freshness email to abe@teamcalbridge.com
  },
  // ingest_vendor_reports kept disabled (legacy/manual trigger only)


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

  // Route through BullMQ for consistent concurrency control, even for manual triggers.
  // Falls back to direct execution if Redis is unavailable.
  try {
    const queueType = await enqueueJob(jobId, { triggeredBy });
    console.log(`[cron] Enqueued ${jobId} (${triggeredBy}) → ${queueType}`);
    return;
  } catch (queueErr) {
    console.warn(`[cron] BullMQ enqueue failed for ${jobId} (${queueErr.message}), running directly`);
  }

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

    const tz = entry.tz || 'UTC';
    cron.schedule(expr, () => withLock(jobId, handler), {
      timezone: tz,
    });

    registered++;
    console.log(`[cron] ✅ Registered ${jobId} — ${expr} (${tz})`);
  }

  console.log(`[cron] ${registered} jobs registered`);

  if (runImmediately) {
    console.log('[cron] Running startup jobs...');
    // Only run the cheap health checks on startup, not the heavy daily jobs
    // Also run ingest jobs on startup so missed runs self-heal after worker restarts
    const startupJobs = ['check_connector_health', 'poll_report_status', 'refresh_queue_status', 'ingest_vendor_reports', 'ingest_seller_reports'];
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
  // JOB_HANDLERS exported so jobWorker.js can resolve handler functions by jobId
};
