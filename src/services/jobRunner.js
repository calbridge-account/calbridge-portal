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
 * Called periodically — drains the Redis buffer.
 * SNOWFLAKE WRITES DISABLED: records stay in Redis only.
 * Use archiveJobRuns() for weekly Snowflake archival.
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

  if (!records.length) return { buffered: 0 };

  // Store completed records in Redis hash for fast reads (keyed by runId)
  // No Snowflake writes — use archiveJobRuns() for weekly archival
  const redisW = getRedis();
  if (redisW && redisW.status === 'ready') {
    try {
      const pipeline = redisW.pipeline();
      for (const r of records) {
        // Merge insert + update records into a single hash entry per runId
        const existing = await redisW.hget('job_runs', r.runId).catch(() => null);
        const base = existing ? JSON.parse(existing) : {};
        const merged = { ...base, ...r, _updatedAt: new Date().toISOString() };
        pipeline.hset('job_runs', r.runId, JSON.stringify(merged));
      }
      // TTL on the whole hash: 30 days
      pipeline.expire('job_runs', 30 * 24 * 60 * 60);
      await pipeline.exec();
    } catch (err) {
      console.warn('[jobRunner] Redis job_runs write failed:', err.message?.slice(0, 60));
    }
  }

  return { buffered: records.length };
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

// ─── Weekly archive: flush Redis job_runs → Snowflake ───────────────────────
/**
 * Called weekly to archive job run history from Redis to Snowflake.
 * Keeps Snowflake as the long-term audit trail without burning credits daily.
 */
async function archiveJobRuns({ triggeredBy = 'cron' } = {}) {
  const redis = getRedis();
  if (!redis || redis.status !== 'ready') return { archived: 0 };

  try {
    const all = await redis.hgetall('job_runs');
    if (!all || !Object.keys(all).length) return { archived: 0 };

    const records = Object.values(all).map(v => {
      try { return JSON.parse(v); } catch { return null; }
    }).filter(Boolean);

    // Only archive completed/failed records (not still-running)
    const toArchive = records.filter(r =>
      r._op === 'update' && [STATUS.COMPLETED, STATUS.FAILED, STATUS.SKIPPED].includes(r.status)
    );

    if (!toArchive.length) return { archived: 0 };

    // Batch upsert to Snowflake — do them in chunks of 200
    const CHUNK = 200;
    let archived = 0;
    for (let i = 0; i < toArchive.length; i += CHUNK) {
      const batch = toArchive.slice(i, i + CHUNK);
      try {
        const vals = batch.map(() => '(?,?,?,?,?,?::TIMESTAMP,?::TIMESTAMP,?,?,?,?)').join(',');
        const binds = batch.flatMap(r => [
          r.runId || r._runId,
          r.jobType || 'unknown',
          r.accountId || 'unknown',
          r.clientId || 'unknown',
          r.status,
          r.startedAt || new Date().toISOString(),
          r.completedAt || new Date().toISOString(),
          r.rowsRead || 0,
          r.rowsWritten || 0,
          r.triggeredBy || 'cron',
          (r.errorMessage || '').substring(0, 5000),
        ]);
        await query(
          `INSERT INTO ${JOB_RUNS}
             (job_id, job_type, account_id, client_id, status,
              started_at, completed_at, rows_read, rows_written, triggered_by, error_message)
           SELECT col1,col2,col3,col4,col5,col6,col7,col8,col9,col10,col11
           FROM (VALUES ${vals}) v(col1,col2,col3,col4,col5,col6,col7,col8,col9,col10,col11)
           WHERE col1 NOT IN (SELECT job_id FROM ${JOB_RUNS} WHERE job_id=col1)`,
          binds
        );
        archived += batch.length;
      } catch { /* skip failed batches */ }
    }

    // Clear archived records from Redis (keep only last 7 days)
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const toDelete = records
      .filter(r => new Date(r._updatedAt || 0).getTime() < cutoff)
      .map(r => r.runId || r._runId)
      .filter(Boolean);
    if (toDelete.length) await redis.hdel('job_runs', ...toDelete);

    console.log(`[jobRunner] Archived ${archived} job runs to Snowflake, cleared ${toDelete.length} old Redis entries`);
    return { archived, cleared: toDelete.length };
  } catch (err) {
    console.error('[jobRunner] archiveJobRuns failed:', err.message?.slice(0, 100));
    return { archived: 0 };
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
  archiveJobRuns,
};
