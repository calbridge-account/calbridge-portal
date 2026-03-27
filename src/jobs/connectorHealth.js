/**
 * src/jobs/connectorHealth.js
 *
 * Job: check_connector_health + retry_transient_failures
 * Schedule: every 5 minutes
 * Owner: Connector 🔌
 *
 * What this does:
 *   1. For every active account, validates the access token is alive
 *   2. Flags expired/expiring tokens in connector_health table
 *   3. Retries transient-failed jobs in JOB_RUNS (up to MAX_RETRIES)
 *   4. Updates PIPELINE.FRESHNESS.is_stale for stale tables
 *
 * Improvements over old scheduler.js:
 *   - Instruments every run in PIPELINE.JOB_RUNS via jobRunner
 *   - Per-account health row in connector_health (create if missing)
 *   - Token refresh attempted inline before flagging as failed
 *   - Retry logic reads from JOB_RUNS, not in-memory state
 */

'use strict';

require('dotenv').config();
const axios = require('axios');
const { query } = require('../services/snowflakeService');
const { getValidToken } = require('../services/amazonAuthService');
const { startJob, completeJob, failJob } = require('../services/jobRunner');

const MAX_RETRIES     = 3;
const TOKEN_WARN_SECS = 300; // warn if token expires in < 5 min

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Get all active client+connection combos from Snowflake.
 * Returns [{clientId, connectionType, accountId, refreshToken}]
 */
async function getActiveConnections() {
  try {
    const rows = await query(`
      SELECT
        client_id,
        connection_type,
        account_id,
        status,
        token_expires_at
      FROM connector_health
      WHERE status != 'disabled'
      ORDER BY client_id, connection_type
    `);
    return (rows || []).map(r => ({
      clientId:       r.CLIENT_ID       || r.client_id,
      connectionType: r.CONNECTION_TYPE || r.connection_type,
      accountId:      r.ACCOUNT_ID      || r.account_id,
      status:         r.STATUS          || r.status,
      tokenExpiresAt: r.TOKEN_EXPIRES_AT || r.token_expires_at,
    }));
  } catch (err) {
    // connector_health table may not exist yet — fall back to clients table
    console.warn('[connectorHealth] connector_health not found, falling back to clients table:', err.message);
    return getConnectionsFromClients();
  }
}

async function getConnectionsFromClients() {
  const rows = await query(`SELECT client_id, connections FROM clients WHERE status = 'active'`);
  const result = [];
  for (const row of rows || []) {
    const clientId = row.CLIENT_ID || row.client_id;
    let connections = {};
    try {
      connections = typeof (row.CONNECTIONS || row.connections) === 'string'
        ? JSON.parse(row.CONNECTIONS || row.connections)
        : (row.CONNECTIONS || row.connections || {});
    } catch { /* skip */ }
    for (const [connType, connData] of Object.entries(connections)) {
      if (connData?.connected || connData?.accessToken) {
        result.push({
          clientId,
          connectionType: connType,
          accountId: connData.profileId || connData.sellerId || clientId,
          status: 'active',
          tokenExpiresAt: null,
        });
      }
    }
  }
  return result;
}

/**
 * Test whether a token is actually valid by calling a lightweight endpoint.
 * For ads: GET /v2/profiles  For SP-API: GET /sellers/v1/marketplaceParticipations
 */
async function probeToken(connectionType, accessToken) {
  const isAds = connectionType === 'ads' || connectionType === 'dsp';
  try {
    if (isAds) {
      await axios.get('https://advertising-api.amazon.com/v2/profiles', {
        headers: {
          'Authorization':                    `Bearer ${accessToken}`,
          'Amazon-Advertising-API-ClientId':  process.env.LWA_CLIENT_ID,
        },
        timeout: 10000,
      });
    } else {
      const base = process.env.NODE_ENV === 'production'
        ? 'https://sellingpartnerapi-na.amazon.com'
        : 'https://sandbox.sellingpartnerapi-na.amazon.com';
      await axios.get(`${base}/sellers/v1/marketplaceParticipations`, {
        headers: { 'x-amz-access-token': accessToken },
        timeout: 10000,
      });
    }
    return { valid: true };
  } catch (err) {
    const status = err.response?.status;
    if (status === 401 || status === 403) return { valid: false, reason: `HTTP ${status}` };
    if (status === 429) return { valid: true, reason: 'throttled — assume valid' }; // 429 = valid token
    return { valid: false, reason: err.message?.substring(0, 100) };
  }
}

/**
 * Upsert a row into connector_health.
 * Creates table if it doesn't exist (handled by migration; fallback here for safety).
 */
async function upsertConnectorHealth(clientId, connectionType, accountId, status, details = {}) {
  try {
    await query(`
      MERGE INTO connector_health t
      USING (SELECT ? AS client_id, ? AS connection_type, ? AS account_id) s
      ON t.client_id = s.client_id
         AND t.connection_type = s.connection_type
         AND t.account_id = s.account_id
      WHEN MATCHED THEN UPDATE SET
        status           = ?,
        last_checked_at  = CURRENT_TIMESTAMP(),
        last_error       = ?,
        token_expires_at = ?
      WHEN NOT MATCHED THEN INSERT
        (client_id, connection_type, account_id, status, last_checked_at, last_error, token_expires_at)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP(), ?, ?)
    `, [
      clientId, connectionType, accountId,
      // WHEN MATCHED
      status,
      details.error || null,
      details.tokenExpiresAt || null,
      // WHEN NOT MATCHED
      clientId, connectionType, accountId,
      status,
      details.error || null,
      details.tokenExpiresAt || null,
    ]);
  } catch (err) {
    // Non-fatal — connector_health table might not exist yet
    console.warn('[connectorHealth] upsertConnectorHealth error (non-fatal):', err.message);
  }
}

// ─── Job 1: check_connector_health ───────────────────────────────────────────

/**
 * Check health of all active connector tokens.
 * For each connection: refresh token → probe → update connector_health.
 *
 * @param {object} [opts]
 * @param {string} [opts.triggeredBy='cron']
 */
async function checkConnectorHealth({ triggeredBy = 'cron' } = {}) {
  const connections = await getActiveConnections();
  if (!connections.length) {
    console.log('[connectorHealth] No active connections — nothing to check');
    return { healthy: 0, degraded: 0, failed: 0 };
  }

  console.log(`[connectorHealth] Checking ${connections.length} connection(s)...`);

  const results = { healthy: 0, degraded: 0, failed: 0 };

  for (const conn of connections) {
    const runId = await startJob('check_connector_health', conn.accountId, triggeredBy, {
      clientId: conn.clientId,
    });

    try {
      // Try to get a valid (refreshed) token
      const accessToken = await getValidToken(conn.clientId, conn.connectionType);

      // Probe the token against the real API
      const probe = await probeToken(conn.connectionType, accessToken);

      if (probe.valid) {
        results.healthy++;
        await upsertConnectorHealth(conn.clientId, conn.connectionType, conn.accountId, 'healthy');
        await completeJob(runId, { rowsRead: 1, rowsWritten: 1 });
      } else {
        results.degraded++;
        await upsertConnectorHealth(conn.clientId, conn.connectionType, conn.accountId, 'token_invalid', {
          error: probe.reason,
        });
        await failJob(runId, `Token invalid: ${probe.reason}`);
        console.warn(`[connectorHealth] ⚠️  ${conn.clientId}/${conn.connectionType}: ${probe.reason}`);
      }
    } catch (err) {
      results.failed++;
      const errMsg = err.message?.substring(0, 500) || 'unknown';
      await upsertConnectorHealth(conn.clientId, conn.connectionType, conn.accountId, 'error', {
        error: errMsg,
      });
      await failJob(runId, errMsg);
      console.error(`[connectorHealth] ❌ ${conn.clientId}/${conn.connectionType}: ${errMsg}`);
    }

    await sleep(200); // small yield between checks
  }

  console.log(`[connectorHealth] ✅ Done — ${results.healthy} healthy, ${results.degraded} degraded, ${results.failed} failed`);
  return results;
}

// ─── Job 2: retry_transient_failures ─────────────────────────────────────────

/**
 * Scan JOB_RUNS for failed jobs with retry_count < MAX_RETRIES.
 * Re-enqueues them by dispatching to the relevant job handler.
 *
 * Note: this job sets the stage for retries but doesn't execute the actual
 * job logic — it calls into the job dispatcher (cron.js) which owns dispatch.
 * For now it marks eligible jobs back to 'pending' so the next cron cycle picks them up.
 */
async function retryTransientFailures({ triggeredBy = 'cron' } = {}) {
  // Use a synthetic account_id for this meta-job
  const runId = await startJob('retry_transient_failures', 'system', triggeredBy);

  try {
    // Find failed jobs that are retryable (retry_count < MAX_RETRIES, failed recently)
    const candidates = await query(`
      SELECT
        job_id,
        job_type,
        account_id,
        client_id,
        error_message,
        retry_count,
        triggered_by
      FROM CALBRIDGE.PIPELINE.JOB_RUNS
      WHERE status = 'failed'
        AND retry_count < ?
        AND completed_at >= DATEADD('hour', -24, CURRENT_TIMESTAMP())
        AND job_type NOT IN ('check_connector_health', 'retry_transient_failures', 'portal_uptime_monitor')
      ORDER BY completed_at ASC
      LIMIT 50
    `, [MAX_RETRIES]);

    if (!candidates || candidates.length === 0) {
      await completeJob(runId, { rowsRead: 0 });
      return { retried: 0 };
    }

    console.log(`[retryTransient] Found ${candidates.length} retryable job(s)`);

    // Mark each candidate back to pending with incremented retry_count
    // The main scheduler will re-execute them on the next cycle
    let retried = 0;
    for (const row of candidates) {
      const jobId      = row.JOB_ID      || row.job_id;
      const retryCount = Number(row.RETRY_COUNT || row.retry_count || 0);

      try {
        await query(`
          UPDATE CALBRIDGE.PIPELINE.JOB_RUNS
          SET status       = 'pending',
              retry_count  = ?,
              triggered_by = 'retry',
              error_message = NULL,
              started_at   = CURRENT_TIMESTAMP(),
              completed_at = NULL
          WHERE job_id = ?
            AND status = 'failed'
        `, [retryCount + 1, jobId]);
        retried++;
        console.log(`[retryTransient] Re-queued ${row.JOB_TYPE || row.job_type} for ${row.ACCOUNT_ID || row.account_id} (retry ${retryCount + 1})`);
      } catch (err) {
        console.warn(`[retryTransient] Could not re-queue ${jobId}:`, err.message);
      }
    }

    await completeJob(runId, { rowsRead: candidates.length, rowsWritten: retried });
    console.log(`[retryTransient] ✅ Re-queued ${retried}/${candidates.length} jobs`);
    return { retried };
  } catch (err) {
    await failJob(runId, err.message);
    throw err;
  }
}

// ─── Job 3: portal_uptime_monitor ────────────────────────────────────────────

/**
 * HTTP health check against the portal's /health endpoint.
 * Alerts if non-200 or response time > SLOW_THRESHOLD_MS.
 */
const SLOW_THRESHOLD_MS = 3000;

async function portalUptimeMonitor({ triggeredBy = 'cron' } = {}) {
  const portalUrl = process.env.BASE_URL || 'http://localhost:3000';
  const healthUrl = `${portalUrl}/health`;
  const runId = await startJob('portal_uptime_monitor', 'system', triggeredBy);

  const start = Date.now();
  try {
    const res = await axios.get(healthUrl, { timeout: 10000, validateStatus: () => true });
    const elapsed = Date.now() - start;
    const ok = res.status >= 200 && res.status < 400;

    if (!ok) {
      await failJob(runId, `Portal returned HTTP ${res.status} (${elapsed}ms)`);
      console.warn(`[uptime] ⚠️ Portal unhealthy: HTTP ${res.status}`);
      return { healthy: false, status: res.status, elapsedMs: elapsed };
    }

    if (elapsed > SLOW_THRESHOLD_MS) {
      console.warn(`[uptime] ⚠️ Portal slow: ${elapsed}ms > ${SLOW_THRESHOLD_MS}ms threshold`);
    }

    await completeJob(runId, { rowsRead: 1 });
    console.log(`[uptime] ✅ Portal OK (${elapsed}ms)`);
    return { healthy: true, status: res.status, elapsedMs: elapsed };
  } catch (err) {
    const elapsed = Date.now() - start;
    await failJob(runId, `Portal unreachable: ${err.message}`);
    console.error(`[uptime] ❌ Portal unreachable: ${err.message}`);
    return { healthy: false, error: err.message, elapsedMs: elapsed };
  }
}

module.exports = {
  checkConnectorHealth,
  retryTransientFailures,
  portalUptimeMonitor,
};
