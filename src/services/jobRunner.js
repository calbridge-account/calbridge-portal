/**
 * src/services/jobRunner.js
 *
 * Job state manager for the Calbridge platform.
 * Owned by: Control 🎛️
 *
 * Writes job lifecycle events to CALBRIDGE.PIPELINE.JOB_RUNS.
 * Every agent that runs a job should call startJob() / completeJob() / failJob()
 * so Control has a complete audit trail and can enforce SLAs.
 *
 * Design principles:
 *   - All writes are non-blocking best-effort — a Snowflake error here must
 *     never crash a job that would otherwise succeed.
 *   - Uses MERGE for completeJob/failJob so re-delivery is safe.
 *   - run_id is a UUID assigned by startJob() and passed back to the caller.
 */

'use strict';

const { v4: uuidv4 } = require('uuid');
const { query } = require('./snowflakeService');

// Fully-qualified table name
const JOB_RUNS = 'CALBRIDGE_PROD.PIPELINE.JOB_RUNS';

// ─── Status constants ────────────────────────────────────────────────────────
const STATUS = {
  PENDING:    'pending',
  RUNNING:    'running',
  COMPLETED:  'completed',
  FAILED:     'failed',
  SKIPPED:    'skipped',
};

// ─── startJob ────────────────────────────────────────────────────────────────
/**
 * Record the start of a job execution.
 *
 * @param {string} jobType     Canonical job id from src/config/jobs.js (e.g. 'stage_raw_data')
 * @param {string} accountId   Amazon Ads profile_id or sellingPartnerId
 * @param {string} [triggeredBy='cron']  How this job was kicked off: cron|manual|dependency|retry
 * @param {object} [opts]
 * @param {string} [opts.clientId]       Calbridge client UUID (if known)
 * @param {string} [opts.pipelineRunId]  Parent pipeline run UUID (if part of a multi-job run)
 * @returns {Promise<string>}  runId — pass this to completeJob() / failJob()
 */
async function startJob(jobType, accountId, triggeredBy = 'cron', opts = {}) {
  const runId         = uuidv4();
  const pipelineRunId = opts.pipelineRunId || uuidv4();
  const clientId      = opts.clientId || 'unknown';

  try {
    await query(
      `INSERT INTO ${JOB_RUNS} (
        job_id, pipeline_run_id, job_type, account_id, client_id,
        started_at, status, retry_count, triggered_by,
        rows_read, rows_written, rows_skipped
      ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP(), ?, 0, ?, 0, 0, 0)`,
      [runId, pipelineRunId, jobType, accountId, clientId, STATUS.RUNNING, triggeredBy]
    );
  } catch (err) {
    // Non-fatal: log but don't crash the job
    console.error(`[jobRunner] startJob failed for ${jobType}/${accountId}:`, err.message);
  }

  return runId;
}

// ─── completeJob ─────────────────────────────────────────────────────────────
/**
 * Mark a job as completed successfully.
 *
 * @param {string} runId  UUID returned by startJob()
 * @param {object} [stats]
 * @param {number} [stats.rowsRead]
 * @param {number} [stats.rowsWritten]
 * @param {number} [stats.rowsSkipped]
 * @param {string} [stats.metricVersion]  For scoring/KPI jobs — which formula version ran
 * @returns {Promise<void>}
 */
async function completeJob(runId, { rowsRead = 0, rowsWritten = 0, rowsSkipped = 0, metricVersion = null } = {}) {
  try {
    await query(
      `UPDATE ${JOB_RUNS}
       SET status           = ?,
           completed_at     = CURRENT_TIMESTAMP(),
           duration_seconds = DATEDIFF('second', started_at, CURRENT_TIMESTAMP()),
           rows_read        = ?,
           rows_written     = ?,
           rows_skipped     = ?,
           metric_version   = ?,
           error_message    = NULL
       WHERE job_id = ?`,
      [STATUS.COMPLETED, rowsRead, rowsWritten, rowsSkipped, metricVersion, runId]
    );
  } catch (err) {
    console.error(`[jobRunner] completeJob failed for run ${runId}:`, err.message);
  }
}

// ─── failJob ─────────────────────────────────────────────────────────────────
/**
 * Mark a job as failed.
 *
 * @param {string} runId         UUID returned by startJob()
 * @param {string} errorMessage  Human-readable error description
 * @param {object} [opts]
 * @param {boolean} [opts.incrementRetry=false]  Whether to increment retry_count
 * @returns {Promise<void>}
 */
async function failJob(runId, errorMessage, { incrementRetry = false } = {}) {
  // Truncate error message to fit VARCHAR(5000)
  const safeError = String(errorMessage || 'Unknown error').substring(0, 5000);

  try {
    const retryClause = incrementRetry ? ', retry_count = retry_count + 1' : '';
    await query(
      `UPDATE ${JOB_RUNS}
       SET status           = ?,
           completed_at     = CURRENT_TIMESTAMP(),
           duration_seconds = DATEDIFF('second', started_at, CURRENT_TIMESTAMP()),
           error_message    = ?
           ${retryClause}
       WHERE job_id = ?`,
      [STATUS.FAILED, safeError, runId]
    );
  } catch (err) {
    console.error(`[jobRunner] failJob failed for run ${runId}:`, err.message);
  }
}

// ─── skipJob ─────────────────────────────────────────────────────────────────
/**
 * Mark a job as skipped (e.g. already processed, no new data).
 *
 * @param {string} runId    UUID returned by startJob()
 * @param {string} [reason] Why it was skipped
 * @returns {Promise<void>}
 */
async function skipJob(runId, reason = 'No new data') {
  try {
    await query(
      `UPDATE ${JOB_RUNS}
       SET status           = ?,
           completed_at     = CURRENT_TIMESTAMP(),
           duration_seconds = DATEDIFF('second', started_at, CURRENT_TIMESTAMP()),
           error_message    = ?
       WHERE job_id = ?`,
      [STATUS.SKIPPED, reason.substring(0, 5000), runId]
    );
  } catch (err) {
    console.error(`[jobRunner] skipJob failed for run ${runId}:`, err.message);
  }
}

// ─── lastSuccessful ───────────────────────────────────────────────────────────
/**
 * Check if a job ran successfully within the last N minutes.
 * Used by SLA checker and dependency guards.
 *
 * @param {string} jobType       Canonical job id
 * @param {string} accountId     Amazon account identifier
 * @param {number} withinMinutes Look-back window in minutes
 * @returns {Promise<boolean>}   true if a successful run exists within the window
 */
async function lastSuccessful(jobType, accountId, withinMinutes) {
  try {
    const rows = await query(
      `SELECT COUNT(*) AS cnt
       FROM ${JOB_RUNS}
       WHERE job_type   = ?
         AND account_id = ?
         AND status     = ?
         AND completed_at >= DATEADD('minute', ?, CURRENT_TIMESTAMP())`,
      [jobType, accountId, STATUS.COMPLETED, -withinMinutes]
    );
    const cnt = Number(rows?.[0]?.CNT ?? rows?.[0]?.cnt ?? 0);
    return cnt > 0;
  } catch (err) {
    console.error(`[jobRunner] lastSuccessful query failed for ${jobType}/${accountId}:`, err.message);
    return false; // assume not successful if we can't check — conservative
  }
}

// ─── getLastSuccessfulAt ─────────────────────────────────────────────────────
/**
 * Get the timestamp of the last successful run for a job + account.
 *
 * @param {string} jobType
 * @param {string} accountId
 * @returns {Promise<Date|null>}  Timestamp or null if never ran
 */
async function getLastSuccessfulAt(jobType, accountId) {
  try {
    const rows = await query(
      `SELECT MAX(completed_at) AS last_at
       FROM ${JOB_RUNS}
       WHERE job_type   = ?
         AND account_id = ?
         AND status     = ?`,
      [jobType, accountId, STATUS.COMPLETED]
    );
    const raw = rows?.[0]?.LAST_AT ?? rows?.[0]?.last_at;
    return raw ? new Date(raw) : null;
  } catch (err) {
    console.error(`[jobRunner] getLastSuccessfulAt failed for ${jobType}/${accountId}:`, err.message);
    return null;
  }
}

// ─── getRunningJobs ───────────────────────────────────────────────────────────
/**
 * Get currently running jobs that may be stuck.
 * A job is "stuck" if it's been in RUNNING status longer than expected.
 *
 * @param {number} [olderThanMinutes=30]  Flag jobs running longer than this
 * @returns {Promise<object[]>}  Array of stuck job rows
 */
async function getRunningJobs(olderThanMinutes = 30) {
  try {
    const rows = await query(
      `SELECT
         job_id,
         job_type,
         account_id,
         client_id,
         started_at,
         DATEDIFF('minute', started_at, CURRENT_TIMESTAMP()) AS running_minutes,
         triggered_by
       FROM ${JOB_RUNS}
       WHERE status = ?
         AND started_at <= DATEADD('minute', ?, CURRENT_TIMESTAMP())
       ORDER BY started_at ASC`,
      [STATUS.RUNNING, -olderThanMinutes]
    );
    return rows || [];
  } catch (err) {
    console.error(`[jobRunner] getRunningJobs failed:`, err.message);
    return [];
  }
}

// ─── getActiveAccounts ────────────────────────────────────────────────────────
/**
 * Get distinct accounts that have had job activity in the last N days.
 * Used by SLA checker to know which account+job combos to check.
 *
 * @param {number} [withinDays=7]
 * @returns {Promise<string[]>}  Array of account_ids
 */
async function getActiveAccounts(withinDays = 7) {
  try {
    const rows = await query(
      `SELECT DISTINCT account_id
       FROM ${JOB_RUNS}
       WHERE started_at >= DATEADD('day', ?, CURRENT_TIMESTAMP())
         AND account_id != 'unknown'`,
      [-withinDays]
    );
    return (rows || []).map(r => r.ACCOUNT_ID ?? r.account_id);
  } catch (err) {
    console.error(`[jobRunner] getActiveAccounts failed:`, err.message);
    return [];
  }
}

module.exports = {
  STATUS,
  startJob,
  completeJob,
  failJob,
  skipJob,
  lastSuccessful,
  getLastSuccessfulAt,
  getRunningJobs,
  getActiveAccounts,
};
