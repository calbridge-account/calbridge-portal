/**
 * src/services/jobRunner.js
 *
 * Job state manager for the Calbridge platform.
 * Owned by: Control 🎛️
 *
 * Writes job lifecycle events to CALBRIDGE_PROD.PIPELINE.JOB_RUNS.
 *
 * BATCHING: startJob/completeJob/failJob now buffer in Redis and flush
 * to Snowflake every 5 minutes (see flushJobRunBuffer). This eliminates
 * ~1,300 individual Snowflake writes/6h that were keeping CALBRIDGE_WH warm.
 *
 * Reads (lastSuccessful, getLastSuccessfulAt, etc.) still go to Snowflake
 * since Redis buffer may not have historical data.
 *
 * Buffer key in Redis: job_runs_buffer (list of JSON strings)
 * Flush cron: flush_job_runs (every 5 min via cron.js)
 */

'use strict';

const { v4: uuidv4 } = require('uuid');
const { query } = require('./snowflakeService');

const JOB_RUNS = 'CALBRIDGE_PROD.PIPELINE.JOB_RUNS';
const BUFFER_KEY = 'job_runs_buffer';
const MAX_BUFFER = 500; // cap buffer to avoid unbounded growth

// In-memory fallback if Redis unavailable
const _memBuffer = [];

const STATUS = {
  PENDING:   'pending',
  RUNNING:   'running',
  COMPLETED: 'completed',
  FAILED:    'failed',
  SKIPPED:   'skipped',
};

// ─── Get Redis client (lazy, reuses redisSessionStore client) ─────────────────
function getRedis() {
  try {
    return require('./redisSessionStore').getRedisClient();
  } catch {
    return null;
  }
}

// ─── Buffer write (Redis list, falls back to in-memory) ──────────────────────
async function bufferWrite(record) {
  const json = JSON.stringify(record);
  const redis = getRedis();
  if (redis && redis.status === 'ready') {
    try {
      await redis.rpush(BUFFER_KEY, json);
      // Trim to max buffer size to avoid unbounded growth
      await redis.ltrim(BUFFER_KEY, -MAX_BUFFER, -1);
      return;
    } catch {
      // fall through to in-memory
    }
  }
  // In-memory fallback
  _memBuffer.push(record);
  if (_memBuffer.length > MAX_BUFFER) _memBuffer.splice(0, _memBuffer.length - MAX_BUFFER);
}

// ─── Flush buffer to Snowflake ────────────────────────────────────────────────
/**
 * Called every 5 minutes by the flush_job_runs cron job.
 * Drains the Redis buffer and batch-writes to JOB_RUNS.
 */
async function flushJobRunBuffer({ triggeredBy = 'cron' } = {}) {
  const redis = getRedis();
  let records = [];

  // Drain Redis buffer
  if (redis && redis.status === 'ready') {
    try {
      const len = await redis.llen(BUFFER_KEY);
      if (len > 0) {
        const items = await redis.lrange(BUFFER_KEY, 0, len - 1);
        await redis.del(BUFFER_KEY);
        records = items.map(item => {
          try { return JSON.parse(item); } catch { return null; }
        }).filter(Boolean);
      }
    } catch (err) {
      console.warn('[jobRunner] Redis buffer drain failed, trying in-memory:', err.message?.slice(0, 60));
    }
  }

  // Also drain in-memory fallback
  if (_memBuffer.length) {
    records = [...records, ..._memBuffer.splice(0)];
  }

  if (!records.length) return { flushed: 0 };

  // Separate inserts (startJob) from updates (completeJob/failJob)
  const inserts = records.filter(r => r._op === 'insert');
  const updates = records.filter(r => r._op === 'update');

  let flushed = 0;

  // Batch INSERT — one VALUES tuple per record
  if (inserts.length) {
    try {
      const vals = inserts.map(() =>
        '(?, ?, ?, ?, ?, ?::TIMESTAMP, ?, 0, ?, 0, 0, 0)'
      ).join(',\n');
      const binds = inserts.flatMap(r => [
        r.runId, r.pipelineRunId, r.jobType, r.accountId, r.clientId,
        r.startedAt, STATUS.RUNNING, r.triggeredBy,
      ]);
      await query(
        `INSERT INTO ${JOB_RUNS}
           (job_id, pipeline_run_id, job_type, account_id, client_id,
            started_at, status, retry_count, triggered_by,
            rows_read, rows_written, rows_skipped)
         VALUES ${vals}`,
        binds
      );
      flushed += inserts.length;
    } catch (err) {
      console.error('[jobRunner] Batch INSERT failed, falling back to individual:', err.message?.slice(0, 100));
      // Fallback: individual inserts
      for (const r of inserts) {
        try {
          await query(
            `INSERT INTO ${JOB_RUNS}
               (job_id, pipeline_run_id, job_type, account_id, client_id,
                started_at, status, retry_count, triggered_by,
                rows_read, rows_written, rows_skipped)
             VALUES (?, ?, ?, ?, ?, ?::TIMESTAMP, ?, 0, ?, 0, 0, 0)`,
            [r.runId, r.pipelineRunId, r.jobType, r.accountId, r.clientId,
             r.startedAt, STATUS.RUNNING, r.triggeredBy]
          );
          flushed++;
        } catch { /* skip individual failures */ }
      }
    }
  }

  // Updates: UPDATE per record (hard to batch — use individual with Promise.all)
  if (updates.length) {
    await Promise.all(updates.map(async r => {
      try {
        if (r.status === STATUS.COMPLETED) {
          await query(
            `UPDATE ${JOB_RUNS}
             SET status=?, completed_at=?::TIMESTAMP,
                 duration_seconds=DATEDIFF('second',started_at,?::TIMESTAMP),
                 rows_read=?, rows_written=?, rows_skipped=?, error_message=NULL
             WHERE job_id=?`,
            [STATUS.COMPLETED, r.completedAt, r.completedAt,
             r.rowsRead || 0, r.rowsWritten || 0, r.rowsSkipped || 0, r.runId]
          );
        } else {
          await query(
            `UPDATE ${JOB_RUNS}
             SET status=?, completed_at=?::TIMESTAMP,
                 duration_seconds=DATEDIFF('second',started_at,?::TIMESTAMP),
                 error_message=?
             WHERE job_id=?`,
            [r.status, r.completedAt, r.completedAt,
             (r.errorMessage || '').substring(0, 5000), r.runId]
          );
        }
        flushed++;
      } catch { /* non-fatal */ }
    }));
  }

  if (flushed > 0) {
    console.log(`[jobRunner] Flushed ${flushed} job run records to Snowflake`);
  }
  return { flushed, inserts: inserts.length, updates: updates.length };
}

// ─── startJob ─────────────────────────────────────────────────────────────────
async function startJob(jobType, accountId, triggeredBy = 'cron', opts = {}) {
  const runId         = uuidv4();
  const pipelineRunId = opts.pipelineRunId || uuidv4();
  const clientId      = opts.clientId || 'unknown';
  const startedAt     = new Date().toISOString();

  await bufferWrite({
    _op: 'insert',
    runId, pipelineRunId, jobType, accountId, clientId,
    startedAt, triggeredBy,
  }).catch(() => {}); // never crash the job

  return runId;
}

// ─── completeJob ──────────────────────────────────────────────────────────────
async function completeJob(runId, { rowsRead = 0, rowsWritten = 0, rowsSkipped = 0, metricVersion = null } = {}) {
  await bufferWrite({
    _op: 'update',
    runId,
    status:      STATUS.COMPLETED,
    completedAt: new Date().toISOString(),
    rowsRead, rowsWritten, rowsSkipped, metricVersion,
  }).catch(() => {});
}

// ─── failJob ──────────────────────────────────────────────────────────────────
async function failJob(runId, errorMessage, { incrementRetry = false } = {}) {
  await bufferWrite({
    _op: 'update',
    runId,
    status:       STATUS.FAILED,
    completedAt:  new Date().toISOString(),
    errorMessage: String(errorMessage || '').substring(0, 5000),
    incrementRetry,
  }).catch(() => {});
}

// ─── skipJob ──────────────────────────────────────────────────────────────────
async function skipJob(runId, reason = 'No new data') {
  await bufferWrite({
    _op: 'update',
    runId,
    status:       STATUS.SKIPPED,
    completedAt:  new Date().toISOString(),
    errorMessage: reason.substring(0, 5000),
  }).catch(() => {});
}

// ─── Read functions — still go direct to Snowflake ───────────────────────────

async function lastSuccessful(jobType, accountId, withinMinutes) {
  try {
    const rows = await query(
      `SELECT COUNT(*) AS cnt FROM ${JOB_RUNS}
       WHERE job_type=? AND account_id=? AND status=?
         AND completed_at >= DATEADD('minute',?,CURRENT_TIMESTAMP())`,
      [jobType, accountId, STATUS.COMPLETED, -withinMinutes]
    );
    return Number(rows?.[0]?.CNT ?? rows?.[0]?.cnt ?? 0) > 0;
  } catch { return false; }
}

async function getLastSuccessfulAt(jobType, accountId) {
  try {
    const rows = await query(
      `SELECT MAX(completed_at) AS last_at FROM ${JOB_RUNS}
       WHERE job_type=? AND account_id=? AND status=?`,
      [jobType, accountId, STATUS.COMPLETED]
    );
    const raw = rows?.[0]?.LAST_AT ?? rows?.[0]?.last_at;
    return raw ? new Date(raw) : null;
  } catch { return null; }
}

async function getRunningJobs(olderThanMinutes = 30) {
  try {
    return await query(
      `SELECT job_id, job_type, account_id, client_id, started_at,
              DATEDIFF('minute',started_at,CURRENT_TIMESTAMP()) AS running_minutes, triggered_by
       FROM ${JOB_RUNS}
       WHERE status=? AND started_at<=DATEADD('minute',?,CURRENT_TIMESTAMP())
       ORDER BY started_at ASC`,
      [STATUS.RUNNING, -olderThanMinutes]
    ) || [];
  } catch { return []; }
}

async function getActiveAccounts(withinDays = 7) {
  try {
    const rows = await query(
      `SELECT DISTINCT account_id FROM ${JOB_RUNS}
       WHERE started_at>=DATEADD('day',?,CURRENT_TIMESTAMP()) AND account_id!='unknown'`,
      [-withinDays]
    );
    return (rows || []).map(r => r.ACCOUNT_ID ?? r.account_id);
  } catch { return []; }
}

async function clearStaleRunningJobs(olderThanMinutes = 30) {
  try {
    const result = await query(
      `UPDATE ${JOB_RUNS}
       SET status='failed', completed_at=CURRENT_TIMESTAMP(),
           error_message='Process restarted — stale lock cleared on startup'
       WHERE status IN ('running','pending')
         AND started_at<=DATEADD('minute',?,CURRENT_TIMESTAMP())`,
      [-olderThanMinutes]
    );
    const cleared = result?.[0]?.['number of rows updated'] ?? 0;
    if (cleared > 0) console.log(`[jobRunner] Cleared ${cleared} stale running/pending job(s)`);
    return cleared;
  } catch (err) {
    console.error('[jobRunner] clearStaleRunningJobs failed:', err.message);
    return 0;
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
  clearStaleRunningJobs,
  flushJobRunBuffer,
};
