/**
 * src/services/jobAlerts.js
 *
 * Job failure alerting for the Calbridge platform.
 *
 * Tracks consecutive failures per jobId in Redis and sends an email alert
 * via Resend when a critical job fails 2+ times in a row.
 *
 * Alert rules:
 *   - Threshold:  2 consecutive failures before alerting
 *   - Cooldown:   1 hour minimum between alerts for the same jobId
 *   - On success: failure counter is reset
 *   - Redis TTL:  7 days on alert state keys
 *
 * Graceful degradation: if Redis or Resend is unavailable, errors are logged
 * but never thrown — the worker must never crash because of alerting.
 */

'use strict';

const ALERT_THRESHOLD = 2;          // consecutive failures before alerting
const ALERT_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour
const ALERT_KEY_TTL_S  = 7 * 24 * 60 * 60; // 7 days

const FROM_EMAIL = 'ash@teamcalbridge.com';
const TO_EMAIL   = 'abe@teamcalbridge.com';

// ─── Redis ────────────────────────────────────────────────────────────────────
function getRedis() {
  try {
    const client = require('./redisSessionStore').getRedisClient();
    return client && client.status === 'ready' ? client : null;
  } catch {
    return null;
  }
}

// ─── Resend ───────────────────────────────────────────────────────────────────
function getResend() {
  try {
    const { Resend } = require('resend');
    const key = process.env.RESEND_API_KEY;
    if (!key) return null;
    return new Resend(key);
  } catch {
    return null;
  }
}

// ─── sendJobAlert ─────────────────────────────────────────────────────────────
/**
 * Send an email alert via Resend.
 * Swallows all errors — alerting failures must never crash the worker.
 */
async function sendJobAlert(jobId, errorMessage, failureCount) {
  const resend = getResend();
  if (!resend) {
    console.warn(`[jobAlerts] Resend unavailable — cannot send alert for ${jobId}`);
    return;
  }

  const timestamp = new Date().toISOString();
  const subject   = `⚠️ Calbridge job failure: ${jobId} (${failureCount}x)`;
  const body = [
    `Job failure alert from Calbridge`,
    ``,
    `Job ID:         ${jobId}`,
    `Failure count:  ${failureCount} consecutive`,
    `Last error:     ${errorMessage || '(no message)'}`,
    `Timestamp:      ${timestamp}`,
    ``,
    `Check pm2 logs for details:`,
    `  pm2 logs calbridge-worker --lines 100`,
    ``,
    `This alert fires after ${ALERT_THRESHOLD} consecutive failures.`,
    `It will not repeat for at least 1 hour.`,
  ].join('\n');

  try {
    const result = await resend.emails.send({
      from:    FROM_EMAIL,
      to:      TO_EMAIL,
      subject,
      text:    body,
    });
    console.log(`[jobAlerts] Alert sent for ${jobId} (${failureCount}x) — id: ${result?.data?.id ?? 'unknown'}`);
  } catch (err) {
    console.error(`[jobAlerts] Failed to send alert for ${jobId}:`, err.message?.slice(0, 120));
  }
}

// ─── recordJobFailure ─────────────────────────────────────────────────────────
/**
 * Record a job failure. If the job has hit the alert threshold and the
 * cooldown has passed, fire an email alert.
 *
 * @param {string} jobId        - The job identifier (e.g. 'ingest_vendor_daily')
 * @param {string} errorMessage - The error message from the failure
 */
async function recordJobFailure(jobId, errorMessage) {
  const redis = getRedis();
  if (!redis) {
    // No Redis — still try to alert on every failure as a fallback
    console.warn(`[jobAlerts] Redis unavailable — sending unconditional alert for ${jobId}`);
    await sendJobAlert(jobId, errorMessage, 1);
    return;
  }

  const alertKey = `job_alert:${jobId}`;

  try {
    // Atomically increment the failure counter
    const newCount = await redis.hincrby(alertKey, 'count', 1);

    // Store latest error and timestamp for debugging
    await redis.hset(alertKey, 'lastError', String(errorMessage || '').slice(0, 1000));
    await redis.expire(alertKey, ALERT_KEY_TTL_S);

    // Check if we should alert
    if (newCount < ALERT_THRESHOLD) {
      console.log(`[jobAlerts] ${jobId} failure #${newCount} (threshold: ${ALERT_THRESHOLD}) — no alert yet`);
      return;
    }

    // Check cooldown
    const lastAlertedAt = await redis.hget(alertKey, 'lastAlertedAt');
    if (lastAlertedAt) {
      const elapsed = Date.now() - new Date(lastAlertedAt).getTime();
      if (elapsed < ALERT_COOLDOWN_MS) {
        const remainingMin = Math.ceil((ALERT_COOLDOWN_MS - elapsed) / 60000);
        console.log(`[jobAlerts] ${jobId} alert suppressed — cooldown active (${remainingMin}m remaining)`);
        return;
      }
    }

    // Send alert and record the time
    await sendJobAlert(jobId, errorMessage, newCount);
    await redis.hset(alertKey, 'lastAlertedAt', new Date().toISOString());
    await redis.expire(alertKey, ALERT_KEY_TTL_S);

  } catch (err) {
    console.error(`[jobAlerts] recordJobFailure error for ${jobId}:`, err.message?.slice(0, 120));
    // Best-effort fallback: still try to alert
    try {
      await sendJobAlert(jobId, errorMessage, -1);
    } catch { /* swallow */ }
  }
}

// ─── recordJobSuccess ─────────────────────────────────────────────────────────
/**
 * Record a job success — resets the consecutive failure counter.
 *
 * @param {string} jobId - The job identifier
 */
async function recordJobSuccess(jobId) {
  const redis = getRedis();
  if (!redis) return; // nothing to reset

  const alertKey = `job_alert:${jobId}`;

  try {
    const prev = await redis.hget(alertKey, 'count');
    if (prev && Number(prev) > 0) {
      await redis.hset(alertKey, 'count', 0);
      console.log(`[jobAlerts] ${jobId} succeeded — failure counter reset (was ${prev})`);
    }
  } catch (err) {
    // Never crash — alerting state reset failure is non-critical
    console.error(`[jobAlerts] recordJobSuccess error for ${jobId}:`, err.message?.slice(0, 120));
  }
}

module.exports = { recordJobFailure, recordJobSuccess, sendJobAlert };
