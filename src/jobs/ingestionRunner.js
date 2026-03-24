/**
 * Ingestion Runner — base job executor
 * Handles retry logic, logging to Snowflake, and error alerting
 */
require('dotenv').config();
const { v4: uuidv4 } = require('uuid');
const { query } = require('../services/snowflakeService');

const MAX_RETRIES = 3;
const RETRY_DELAYS = [5000, 15000, 45000]; // exponential backoff ms

/**
 * Run an ingestion job with retry + logging
 * @param {string} clientId
 * @param {string} connectionType - ads | dsp | seller | vendor
 * @param {string} jobType - campaigns | performance | products | sales | contribution_margin
 * @param {Function} jobFn - async function that returns { recordsWritten }
 */
async function runJob(clientId, connectionType, jobType, jobFn) {
  const logId = uuidv4();
  const startedAt = new Date().toISOString();

  // Log job start
  await query(`
    INSERT INTO ingestion_log (log_id, client_id, connection_type, job_type, status, started_at)
    VALUES (?, ?, ?, ?, 'running', CURRENT_TIMESTAMP)
  `, [logId, clientId, connectionType, jobType]);

  let lastError = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        const delay = RETRY_DELAYS[attempt - 1] || 60000;
        console.log(`[${jobType}] Client ${clientId} — retry ${attempt}/${MAX_RETRIES} in ${delay/1000}s`);
        await sleep(delay);
      }

      const { recordsWritten } = await jobFn();

      // Log success
      await query(`
        UPDATE ingestion_log
        SET status = 'success', records_written = ?, completed_at = CURRENT_TIMESTAMP
        WHERE log_id = ?
      `, [recordsWritten, logId]);

      console.log(`[${jobType}] ✅ Client ${clientId} — ${recordsWritten} records written`);
      return { success: true, recordsWritten };

    } catch (err) {
      lastError = err;
      console.error(`[${jobType}] ❌ Client ${clientId} attempt ${attempt + 1}: ${err.message}`);
    }
  }

  // All retries exhausted — log failure and alert
  await query(`
    UPDATE ingestion_log
    SET status = 'failed', error_message = ?, completed_at = CURRENT_TIMESTAMP
    WHERE log_id = ?
  `, [lastError?.message?.substring(0, 4999) || 'Unknown error', logId]);

  // Skip alert emails for test/demo accounts — failures are expected
  const isTestClient = clientId.startsWith('test-') || clientId.startsWith('demo-');
  if (!isTestClient) {
    await sendFailureAlert({ clientId, connectionType, jobType, error: lastError });
  }
  return { success: false, error: lastError };
}

/**
 * Send failure alert email via Resend
 */
async function sendFailureAlert({ clientId, connectionType, jobType, error }) {
  try {
    const { Resend } = require('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: `Ash <${process.env.EMAIL_FROM}>`,
      to: [process.env.EMAIL_CC],
      subject: `⚠️ Ingestion failure: ${jobType} / ${connectionType} / client ${clientId}`,
      text: `Ingestion job failed after ${MAX_RETRIES} retries.\n\nDetails:\n- Client: ${clientId}\n- Connection: ${connectionType}\n- Job: ${jobType}\n- Error: ${error?.message}\n\nCheck ingestion_log in Snowflake for full details.`
    });
  } catch (emailErr) {
    console.error('[Alert] Failed to send failure email:', emailErr.message);
  }
}

/**
 * Get ingestion status for a client
 */
async function getIngestionStatus(clientId) {
  const rows = await query(`
    SELECT
      connection_type,
      job_type,
      status,
      records_written,
      error_message,
      started_at,
      completed_at
    FROM ingestion_log
    WHERE client_id = ?
    QUALIFY ROW_NUMBER() OVER (PARTITION BY connection_type, job_type ORDER BY started_at DESC) = 1
    ORDER BY started_at DESC
  `, [clientId]);
  return rows;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { runJob, getIngestionStatus };
