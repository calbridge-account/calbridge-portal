/**
 * src/config/jobs.js
 *
 * Canonical job type registry for the Calbridge platform.
 * Owned by: Control 🎛️
 *
 * This is the single source of truth for:
 *   - Every job type the platform runs
 *   - Which agent owns it
 *   - When it runs (schedule bucket)
 *   - SLA thresholds
 *   - Dependency ordering
 *
 * Schedules are buckets, not cron expressions. The actual cron wiring
 * lives in ecosystem.config.js or node-cron setup. These buckets map to:
 *   every5min     → every 5 minutes
 *   every15min    → every 15 minutes
 *   hourly        → every 60 minutes
 *   daily-early   → ~02:00 UTC (after Amazon data is settled)
 *   daily-post-models → after build_canonical_models + compute_core_kpis complete
 *   weekly        → Sunday 03:00 UTC
 *   monthly       → 1st of month, 04:00 UTC
 */

'use strict';

const JOBS = [

  // ─────────────────────────────────────────────────────────────────────────────
  // EVERY 5 MINUTES — Connector 🔌 & Dashboard 📊
  // Fast health and polling loops. These must be cheap and non-blocking.
  // ─────────────────────────────────────────────────────────────────────────────

  {
    id:               'check_connector_health',
    name:             'Connector Health Check',
    owner:            'connector',
    schedule:         'every5min',
    timeout_seconds:  30,
    sla_minutes:      10,             // Must run at least every 10 min or alert
    idempotent:       true,
    dependencies:     [],
    description:      'Verify all connector tokens are valid and not expired. Flag stale or broken connections.',
  },

  {
    id:               'poll_report_status',
    name:             'Poll Amazon Report Status',
    owner:            'reporter',
    schedule:         'every5min',
    timeout_seconds:  60,
    sla_minutes:      15,
    idempotent:       true,
    dependencies:     [],
    description:      'Poll SP-API and Ads API for async report completion. Update ads_report_queue status.',
  },

  {
    id:               'retry_transient_failures',
    name:             'Retry Transient Failures',
    owner:            'connector',
    schedule:         'every5min',
    timeout_seconds:  120,
    sla_minutes:      15,
    idempotent:       true,
    dependencies:     [],
    description:      'Scan JOB_RUNS for failed jobs with retry_count < 3. Re-queue eligible jobs.',
  },

  {
    id:               'portal_uptime_monitor',
    name:             'Portal Uptime Monitor',
    owner:            'dashboard',
    schedule:         'every5min',
    timeout_seconds:  15,
    sla_minutes:      15,
    idempotent:       true,
    dependencies:     [],
    description:      'HTTP health check against the portal. Alert if non-200 or response > 3s.',
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // EVERY 15 MINUTES — Reporter 📋 & Control 🎛️
  // Report ingestion and queue management.
  // ─────────────────────────────────────────────────────────────────────────────

  {
    id:               'submit_amazon_reports',
    name:             'Submit Amazon Report Requests',
    owner:            'reporter',
    schedule:         'every15min',
    timeout_seconds:  120,
    sla_minutes:      30,
    idempotent:       true,
    dependencies:     ['check_connector_health'],
    description:      'Submit async report requests to Amazon Ads API for newly available windows.',
  },

  {
    id:               'download_completed_reports',
    name:             'Download Completed Reports',
    owner:            'reporter',
    schedule:         'every15min',
    timeout_seconds:  300,
    sla_minutes:      30,
    idempotent:       true,
    dependencies:     ['poll_report_status'],
    description:      'Download and stage completed report exports from Amazon. Write to RAW_* tables.',
  },

  {
    id:               'refresh_queue_status',
    name:             'Refresh Queue Status Tables',
    owner:            'pipeline',
    schedule:         'every15min',
    timeout_seconds:  60,
    sla_minutes:      30,
    idempotent:       true,
    dependencies:     [],
    description:      'Refresh queue depth, pending job counts, and queue age metrics into operational tables.',
  },

  {
    id:               'sync_job_metadata',
    name:             'Sync Job Metadata',
    owner:            'pipeline',
    schedule:         'every15min',
    timeout_seconds:  60,
    sla_minutes:      30,
    idempotent:       true,
    dependencies:     [],
    description:      'Sync JOB_RUNS metadata and FRESHNESS summaries into operational dashboard tables.',
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // HOURLY — Pipeline 🏗️
  // Lightweight staging, quality, and completeness checks.
  // ─────────────────────────────────────────────────────────────────────────────

  {
    id:               'stage_raw_data',
    name:             'Stage Raw Data',
    owner:            'pipeline',
    schedule:         'hourly',
    timeout_seconds:  600,
    sla_minutes:      90,
    idempotent:       true,
    dependencies:     ['download_completed_reports'],
    description:      'Normalize newly ingested raw rows into staging-layer tables. MERGE semantics, idempotent.',
  },

  {
    id:               'run_quality_checks',
    name:             'Run Quality Checks',
    owner:            'pipeline',
    schedule:         'hourly',
    timeout_seconds:  300,
    sla_minutes:      120,
    idempotent:       true,
    dependencies:     ['stage_raw_data'],
    description:      'Lightweight data quality assertions (null checks, range checks, row counts). Write to PIPELINE.QUALITY_LOG.',
  },

  {
    id:               'compute_freshness',
    name:             'Compute Data Freshness',
    owner:            'pipeline',
    schedule:         'hourly',
    timeout_seconds:  120,
    sla_minutes:      120,
    idempotent:       true,
    dependencies:     ['stage_raw_data'],
    description:      'Recompute PIPELINE.FRESHNESS entries for all active accounts. Sets is_stale flags.',
  },

  {
    id:               'reconcile_missing_partitions',
    name:             'Reconcile Missing Partitions',
    owner:            'pipeline',
    schedule:         'hourly',
    timeout_seconds:  300,
    sla_minutes:      180,
    idempotent:       true,
    dependencies:     ['stage_raw_data'],
    description:      'Detect date gaps in canonical tables and flag missing partitions for backfill.',
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // DAILY (EARLY MORNING) — Pipeline 🏗️ → Economist 💹 → Analyst 🧠
  // Heavy model builds on prior-day settled data. Run after ~02:00 UTC.
  // ─────────────────────────────────────────────────────────────────────────────

  {
    id:               'build_canonical_models',
    name:             'Build Canonical Data Models',
    owner:            'pipeline',
    schedule:         'daily-early',
    timeout_seconds:  3600,
    sla_minutes:      120,
    idempotent:       true,
    dependencies:     ['run_quality_checks', 'reconcile_missing_partitions'],
    description:      'Full prior-day canonical model builds: ADS_PERFORMANCE, RETAIL_PERFORMANCE, INVENTORY_SNAPSHOT. MERGE semantics.',
  },

  {
    id:               'compute_core_kpis',
    name:             'Compute Core KPIs',
    owner:            'economist',
    schedule:         'daily-early',
    timeout_seconds:  1800,
    sla_minutes:      180,
    idempotent:       true,
    dependencies:     ['build_canonical_models'],
    description:      'Compute KPIs (ACoS, ROAS, CPC, CVR, CM, tacos) by account / brand / campaign / ASIN for prior day.',
  },

  {
    id:               'detect_anomalies',
    name:             'Detect Anomalies',
    owner:            'analyst',
    schedule:         'daily-early',
    timeout_seconds:  1800,
    sla_minutes:      240,
    idempotent:       true,
    dependencies:     ['compute_core_kpis'],
    description:      'Detect anomalies and material metric changes vs prior period. Flag for operator review.',
  },

  {
    id:               'generate_operator_summary',
    name:             'Generate Operator Daily Summary',
    owner:            'analyst',
    schedule:         'daily-early',
    timeout_seconds:  600,
    sla_minutes:      300,
    idempotent:       true,
    dependencies:     ['detect_anomalies'],
    description:      'Generate daily operator summary email with highlights, anomalies, and SLA status.',
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // DAILY (AFTER MODELS COMPLETE) — Economist 💹
  // Depends on build_canonical_models + compute_core_kpis finishing.
  // ─────────────────────────────────────────────────────────────────────────────

  {
    id:               'score_opportunities',
    name:             'Score Opportunities',
    owner:            'economist',
    schedule:         'daily-post-models',
    timeout_seconds:  3600,
    sla_minutes:      360,
    idempotent:       true,
    dependencies:     ['compute_core_kpis'],
    description:      'Run recommendation engine: underfunded opportunities, overspent campaigns, inventory-constrained ASINs, marginal return ranking.',
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // WEEKLY — Pipeline 🏗️ → Economist 💹 → Analyst 🧠
  // Heavy reconciliation and benchmark work. Sunday 03:00 UTC.
  // ─────────────────────────────────────────────────────────────────────────────

  {
    id:               'deep_reconciliation',
    name:             'Deep Reconciliation',
    owner:            'pipeline',
    schedule:         'weekly',
    timeout_seconds:  7200,
    sla_minutes:      480,
    idempotent:       true,
    dependencies:     ['build_canonical_models'],
    description:      'Reconcile and backfill missed windows over the trailing 4 weeks. Repair partition gaps.',
  },

  {
    id:               'regenerate_benchmarks',
    name:             'Regenerate Benchmarks',
    owner:            'economist',
    schedule:         'weekly',
    timeout_seconds:  3600,
    sla_minutes:      600,
    idempotent:       true,
    dependencies:     ['deep_reconciliation'],
    description:      'Recompute trailing 8–12 week performance benchmarks for all accounts. Used by opportunity scorer.',
  },

  {
    id:               'generate_exec_summary',
    name:             'Generate Executive Summary',
    owner:            'analyst',
    schedule:         'weekly',
    timeout_seconds:  1800,
    sla_minutes:      720,
    idempotent:       true,
    dependencies:     ['regenerate_benchmarks', 'score_opportunities'],
    description:      'Produce weekly executive summary per account. Covers performance, recommendations, anomalies.',
  },

  {
    id:               'archive_old_payloads',
    name:             'Archive Old Raw Payloads',
    owner:            'pipeline',
    schedule:         'weekly',
    timeout_seconds:  3600,
    sla_minutes:      720,
    idempotent:       true,
    dependencies:     [],
    description:      'Move raw API payloads older than 90 days to cold storage or drop from hot tables.',
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // MONTHLY — Connector 🔌 → Pipeline 🏗️
  // Maintenance and audits. 1st of month, 04:00 UTC.
  // ─────────────────────────────────────────────────────────────────────────────

  {
    id:               'credential_audit',
    name:             'Credential Audit',
    owner:            'connector',
    schedule:         'monthly',
    timeout_seconds:  300,
    sla_minutes:      1440,           // 24h window for monthly jobs
    idempotent:       true,
    dependencies:     [],
    description:      'Verify all API credentials (tokens, OAuth, SP-API) are valid and will not expire soon. Alert on anything expiring in < 30 days.',
  },

  {
    id:               'cost_performance_audit',
    name:             'Pipeline Cost & Performance Audit',
    owner:            'pipeline',
    schedule:         'monthly',
    timeout_seconds:  600,
    sla_minutes:      1440,
    idempotent:       true,
    dependencies:     [],
    description:      'Audit Snowflake query costs, warehouse utilization, and per-job runtime trends.',
  },

  {
    id:               'warehouse_cleanup',
    name:             'Warehouse Cleanup',
    owner:            'pipeline',
    schedule:         'monthly',
    timeout_seconds:  3600,
    sla_minutes:      1440,
    idempotent:       true,
    dependencies:     ['archive_old_payloads'],
    description:      'Table maintenance: drop stale data, reclaim storage, update table statistics.',
  },

  {
    id:               'evaluate_report_coverage',
    name:             'Evaluate Report Coverage',
    owner:            'reporter',
    schedule:         'monthly',
    timeout_seconds:  300,
    sla_minutes:      1440,
    idempotent:       true,
    dependencies:     [],
    description:      'Assess report type coverage, identify unused report types, surface gaps in data collection.',
  },

];

// ─── Lookup helpers ──────────────────────────────────────────────────────────

/** Map of job id → job definition (O(1) lookup) */
const JOB_MAP = Object.fromEntries(JOBS.map(j => [j.id, j]));

/**
 * Get job definition by id.
 * @param {string} jobId
 * @returns {object|undefined}
 */
function getJob(jobId) {
  return JOB_MAP[jobId];
}

/**
 * Get all jobs for a given schedule bucket.
 * @param {string} schedule  e.g. 'every5min' | 'daily-early' | ...
 * @returns {object[]}
 */
function getJobsBySchedule(schedule) {
  return JOBS.filter(j => j.schedule === schedule);
}

/**
 * Get all jobs owned by an agent.
 * @param {string} owner  e.g. 'connector' | 'pipeline' | ...
 * @returns {object[]}
 */
function getJobsByOwner(owner) {
  return JOBS.filter(j => j.owner === owner);
}

/**
 * Schedule bucket → cron expression mapping.
 * Use these when wiring up the actual cron runner.
 */
const SCHEDULE_CRONS = {
  'every5min':        '*/5 * * * *',
  'every15min':       '*/15 * * * *',
  'hourly':           '0 * * * *',
  'daily-early':      '0 2 * * *',       // 02:00 UTC
  'daily-post-models':'30 4 * * *',      // 04:30 UTC (after daily-early has had time to finish)
  'weekly':           '0 3 * * 0',       // Sunday 03:00 UTC
  'monthly':          '0 4 1 * *',       // 1st of month 04:00 UTC
};

module.exports = {
  JOBS,
  JOB_MAP,
  SCHEDULE_CRONS,
  getJob,
  getJobsBySchedule,
  getJobsByOwner,
};
