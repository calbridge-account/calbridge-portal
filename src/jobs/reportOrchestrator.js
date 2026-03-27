/**
 * src/jobs/reportOrchestrator.js
 *
 * Jobs: submit_amazon_reports + poll_report_status + download_completed_reports
 * Schedule: every 5 min (poll), every 15 min (submit + download)
 * Owner: Reporter 📋
 *
 * This supersedes the report queue logic scattered across adsIngestion.js and
 * the old scheduler.js. Key improvements:
 *
 *   - All three phases are now named, instrumented jobs in JOB_RUNS
 *   - Submit: date-window aware, skips already-queued windows, rate-limited
 *   - Poll: processes up to POLL_BATCH_SIZE pending reports per run
 *   - Download: streams to Snowflake via the existing WRITE_FNS dispatch table
 *   - Idempotent throughout: MERGE semantics, dedup keys, safe to re-run
 *   - Per-account parallelism with a concurrency cap
 *
 * Architecture note:
 *   ADS_REPORT_QUEUE is the handoff table between submit → poll → download.
 *   Every phase reads/writes status: pending → completed/failed.
 *
 * Dependencies:
 *   - adsIngestion.js: WRITE_FNS, requestV3Report, REPORT_TYPES, adsClient
 *   - jobRunner.js: startJob, completeJob, failJob
 *   - snowflakeService.js: query
 */

'use strict';

require('dotenv').config();
const zlib = require('zlib');
const axios = require('axios');
const { query } = require('../services/snowflakeService');
const { startJob, completeJob, failJob, skipJob } = require('../services/jobRunner');

// Lazy-loaded to avoid circular deps at startup
function getAdsIngestion() {
  return require('./adsIngestion');
}

// ─── Config ──────────────────────────────────────────────────────────────────
const SUBMIT_DAYS_BACK  = Number(process.env.REPORT_DAYS_BACK  || 30);
const POLL_BATCH_SIZE   = Number(process.env.REPORT_POLL_BATCH || 20);
const MAX_RANGE_DAYS    = 31; // Amazon v3 API max date range per request
const REPORT_TIMEOUT_MS = 20 * 60 * 1000; // 20 min — abandon reports older than this

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Shared: get active clients ──────────────────────────────────────────────

async function getActiveAdsClients() {
  try {
    const rows = await query(`
      SELECT client_id
      FROM clients
      WHERE status = 'active'
    `);
    return (rows || []).map(r => r.CLIENT_ID || r.client_id);
  } catch (err) {
    console.error('[reportOrchestrator] getActiveAdsClients failed:', err.message);
    return [];
  }
}

/**
 * Get the account_id (Amazon Ads profile_id) for a client.
 * Falls back to client_id if not found in connector_health.
 */
async function getAccountId(clientId) {
  try {
    const rows = await query(`
      SELECT account_id FROM connector_health
      WHERE client_id = ? AND connection_type = 'ads' AND status = 'healthy'
      LIMIT 1
    `, [clientId]);
    return rows?.[0]?.ACCOUNT_ID || rows?.[0]?.account_id || clientId;
  } catch {
    return clientId;
  }
}

// ─── Date window builder ─────────────────────────────────────────────────────

/**
 * Build non-overlapping date windows of up to MAX_RANGE_DAYS days.
 * Returns [{startIso, endIso, rangeKey}], oldest window first.
 */
function buildDateWindows(daysBack) {
  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  yesterday.setUTCHours(0, 0, 0, 0);

  const windows = [];
  let windowEnd = new Date(yesterday);
  let remaining = daysBack;

  while (remaining > 0) {
    const chunk = Math.min(remaining, MAX_RANGE_DAYS);
    const windowStart = new Date(windowEnd);
    windowStart.setUTCDate(windowStart.getUTCDate() - (chunk - 1));

    const startIso = windowStart.toISOString().split('T')[0];
    const endIso   = windowEnd.toISOString().split('T')[0];
    const rangeKey = startIso.replace(/-/g, '') + '_' + endIso.replace(/-/g, '');

    windows.unshift({ startIso, endIso, rangeKey }); // oldest first

    windowEnd = new Date(windowStart);
    windowEnd.setUTCDate(windowEnd.getUTCDate() - 1);
    remaining -= chunk;
  }

  return windows;
}

// ─── Job 1: submit_amazon_reports ────────────────────────────────────────────

/**
 * Submit async report requests to Amazon Ads API for all active clients.
 * Skips windows already queued (pending or completed).
 * Returns after queuing — does not wait for reports to complete.
 *
 * @param {object} [opts]
 * @param {string} [opts.triggeredBy='cron']
 * @param {number} [opts.daysBack]  Override default SUBMIT_DAYS_BACK
 */
async function submitAmazonReports({ triggeredBy = 'cron', daysBack = SUBMIT_DAYS_BACK } = {}) {
  const clientIds = await getActiveAdsClients();
  if (!clientIds.length) {
    console.log('[submitReports] No active ads clients');
    return;
  }

  const { REPORT_TYPES, requestV3Report, adsClient: makeAdsClient } = getAdsIngestion();
  const windows = buildDateWindows(daysBack);
  let totalQueued = 0;

  for (const clientId of clientIds) {
    const accountId = await getAccountId(clientId);
    const runId = await startJob('submit_amazon_reports', accountId, triggeredBy, { clientId });

    try {
      // Fetch profiles for this client
      const { fetchProfiles, getAuthorizedProfiles } = getAdsIngestion();
      const allProfiles = await fetchProfiles(clientId, 'ads');
      const profiles    = await getAuthorizedProfiles(clientId, allProfiles);

      if (!profiles.length) {
        await skipJob(runId, 'No authorized profiles');
        continue;
      }

      let queued = 0;

      for (const profile of profiles) {
        const profileId = String(profile.profileId);

        for (const window of windows) {
          for (const rt of REPORT_TYPES) {
            // Dedup: skip if already pending/completed for this combination
            const existing = await query(`
              SELECT COUNT(*) AS cnt
              FROM ads_report_queue
              WHERE client_id    = ?
                AND profile_id   = ?
                AND report_type  = ?
                AND report_date  = ?
                AND status IN ('pending', 'completed')
            `, [clientId, profileId, rt.key, window.rangeKey]);

            if (Number(existing?.[0]?.CNT || existing?.[0]?.cnt || 0) > 0) continue;

            try {
              await new Promise(r => setImmediate(r)); // yield event loop
              const client   = await makeAdsClient(clientId, 'ads');
              const reportId = await requestV3Report(
                client, profileId,
                window.startIso, rt.reportTypeId, rt.adProduct, rt.groupBy, rt.columns, rt.filters,
                window.endIso
              );

              if (!reportId) continue;

              await query(`
                INSERT INTO ads_report_queue
                  (report_id, client_id, connection_type, profile_id, report_type, report_date, status, requested_at)
                VALUES (?, ?, 'ads', ?, ?, ?, 'pending', CURRENT_TIMESTAMP())
              `, [reportId, clientId, profileId, rt.key, window.rangeKey]);

              queued++;
              totalQueued++;
              await sleep(100);
            } catch (err) {
              // Log but don't abort the entire client run — some report types may be unavailable
              const body = err.response?.data ? JSON.stringify(err.response.data).substring(0, 150) : '';
              console.warn(`[submitReports] ${clientId}/${profileId}/${rt.key} ${window.startIso}→${window.endIso}: ${err.message?.substring(0, 80)} ${body}`);
            }
          } // report types
        } // windows
      } // profiles

      await completeJob(runId, { rowsRead: profiles.length, rowsWritten: queued });
      console.log(`[submitReports] ${clientId}: queued ${queued} reports`);
    } catch (err) {
      await failJob(runId, err.message);
      console.error(`[submitReports] ${clientId} failed:`, err.message);
    }
  } // clients

  console.log(`[submitReports] ✅ Total queued: ${totalQueued}`);
  return { totalQueued };
}

// ─── Job 2: poll_report_status ────────────────────────────────────────────────

/**
 * Poll Amazon for status of pending reports.
 * Only updates the status in ads_report_queue — does NOT download data.
 * Fast and cheap: just GET /reporting/reports/:id for each pending report.
 *
 * @param {object} [opts]
 * @param {string} [opts.triggeredBy='cron']
 */
async function pollReportStatus({ triggeredBy = 'cron' } = {}) {
  const runId = await startJob('poll_report_status', 'system', triggeredBy);

  try {
    // Fetch all pending reports across all clients, oldest first
    const pending = await query(`
      SELECT report_id, client_id, connection_type, profile_id, requested_at
      FROM ads_report_queue
      WHERE status = 'pending'
        AND requested_at >= DATEADD('hour', -4, CURRENT_TIMESTAMP())
      ORDER BY requested_at ASC
      LIMIT ?
    `, [POLL_BATCH_SIZE]);

    if (!pending?.length) {
      await completeJob(runId, { rowsRead: 0 });
      return { polled: 0, completed: 0, failed: 0 };
    }

    console.log(`[pollStatus] Polling ${pending.length} pending reports`);

    const { getValidToken } = require('../services/amazonAuthService');
    const tokenCache = new Map(); // clientId+connType → {token, fetchedAt}
    const counts = { polled: 0, completed: 0, failed: 0, processing: 0 };

    async function getToken(clientId, connectionType) {
      const key = `${clientId}:${connectionType}`;
      const cached = tokenCache.get(key);
      if (cached && Date.now() - cached.fetchedAt < 45 * 60 * 1000) return cached.token;
      const token = await getValidToken(clientId, connectionType);
      tokenCache.set(key, { token, fetchedAt: Date.now() });
      return token;
    }

    for (const row of pending) {
      const reportId      = row.REPORT_ID      || row.report_id;
      const clientId      = row.CLIENT_ID      || row.client_id;
      const connectionType = row.CONNECTION_TYPE || row.connection_type;
      const rawProfileId  = row.PROFILE_ID     || row.profile_id;
      const profileId     = rawProfileId?.includes('|') ? rawProfileId.split('|')[1] : rawProfileId;

      try {
        const token = await getToken(clientId, connectionType);
        const res   = await axios.get(
          `https://advertising-api.amazon.com/reporting/reports/${reportId}`,
          {
            headers: {
              'Authorization':                    `Bearer ${token}`,
              'Amazon-Advertising-API-ClientId':  process.env.LWA_CLIENT_ID,
              'Amazon-Advertising-API-Scope':     profileId,
            },
            timeout: 10000,
          }
        );

        const { status, failureReason } = res.data;
        counts.polled++;

        if (status === 'COMPLETED') {
          // Store the download URL so download_completed_reports can use it
          await query(`
            UPDATE ads_report_queue
            SET status = 'ready', download_url = ?, polled_at = CURRENT_TIMESTAMP()
            WHERE report_id = ?
          `, [res.data.url || null, reportId]);
          counts.completed++;
        } else if (status === 'FAILURE') {
          await query(`
            UPDATE ads_report_queue
            SET status = 'failed', error_message = ?, completed_at = CURRENT_TIMESTAMP()
            WHERE report_id = ?
          `, [failureReason || 'FAILURE from Amazon', reportId]);
          counts.failed++;
        } else {
          // PENDING or PROCESSING — leave as-is
          counts.processing++;
        }

        await sleep(50); // light throttle between polls
      } catch (err) {
        // Don't fail the whole job for one bad poll
        const status = err.response?.status;
        if (status === 404) {
          // Report expired or doesn't exist — mark as failed
          await query(`
            UPDATE ads_report_queue SET status='failed', error_message='404 Not Found' WHERE report_id=?
          `, [reportId]).catch(() => {});
          counts.failed++;
        } else {
          console.warn(`[pollStatus] ${reportId}: ${err.message?.substring(0, 100)}`);
        }
      }
    }

    await completeJob(runId, { rowsRead: pending.length, rowsWritten: counts.completed });
    console.log(`[pollStatus] ✅ ${counts.polled} polled, ${counts.completed} ready, ${counts.failed} failed, ${counts.processing} processing`);
    return counts;
  } catch (err) {
    await failJob(runId, err.message);
    throw err;
  }
}

// ─── Job 3: download_completed_reports ───────────────────────────────────────

/**
 * Download and stage reports that are in 'ready' status (COMPLETED by Amazon).
 * Dispatches to WRITE_FNS for each report type.
 * Idempotent: MERGE semantics prevent duplicate rows.
 *
 * @param {object} [opts]
 * @param {string} [opts.triggeredBy='cron']
 */
async function downloadCompletedReports({ triggeredBy = 'cron' } = {}) {
  const runId = await startJob('download_completed_reports', 'system', triggeredBy);

  try {
    const ready = await query(`
      SELECT report_id, client_id, profile_id, report_type, report_date, download_url
      FROM ads_report_queue
      WHERE status = 'ready'
        AND requested_at >= DATEADD('hour', -6, CURRENT_TIMESTAMP())
      ORDER BY requested_at ASC
      LIMIT 30
    `);

    if (!ready?.length) {
      await completeJob(runId, { rowsRead: 0 });
      return { downloaded: 0, rowsWritten: 0 };
    }

    console.log(`[downloadReports] Downloading ${ready.length} ready reports`);

    const { WRITE_FNS } = getAdsIngestion();
    let totalRows = 0;
    let downloaded = 0;

    for (const row of ready) {
      const reportId   = row.REPORT_ID   || row.report_id;
      const clientId   = row.CLIENT_ID   || row.client_id;
      const rawProfile = row.PROFILE_ID  || row.profile_id;
      const reportType = row.REPORT_TYPE || row.report_type;
      const reportDate = String(row.REPORT_DATE || row.report_date);
      const downloadUrl = row.DOWNLOAD_URL || row.download_url;

      const profileId = rawProfile?.includes('|') ? rawProfile.split('|')[1] : rawProfile;

      try {
        // If we have a cached URL, use it — otherwise re-fetch from Amazon
        let url = downloadUrl;
        if (!url) {
          // URL wasn't stored — re-poll to get it
          const { getValidToken } = require('../services/amazonAuthService');
          const token = await getValidToken(clientId, 'ads');
          const res = await axios.get(
            `https://advertising-api.amazon.com/reporting/reports/${reportId}`,
            {
              headers: {
                'Authorization':                   `Bearer ${token}`,
                'Amazon-Advertising-API-ClientId': process.env.LWA_CLIENT_ID,
                'Amazon-Advertising-API-Scope':    profileId,
              },
              timeout: 10000,
            }
          );
          if (res.data.status !== 'COMPLETED') {
            console.warn(`[downloadReports] ${reportId} not COMPLETED (${res.data.status}) — skipping`);
            continue;
          }
          url = res.data.url;
        }

        // Download and decompress
        const dlRes = await axios.get(url, { responseType: 'arraybuffer', timeout: 120000 });
        const json  = JSON.parse(zlib.gunzipSync(Buffer.from(dlRes.data)).toString('utf8'));
        const rows  = Array.isArray(json) ? json : [];

        // Dispatch to the correct write function
        const writeFn = WRITE_FNS[reportType];
        if (!writeFn) {
          await query(`
            UPDATE ads_report_queue
            SET status='failed', error_message=?, completed_at=CURRENT_TIMESTAMP()
            WHERE report_id=?
          `, [`No write function for report type: ${reportType}`, reportId]);
          continue;
        }

        const written = await writeFn(clientId, profileId, reportDate, rows);
        totalRows += written;
        downloaded++;

        await query(`
          UPDATE ads_report_queue
          SET status='completed', records_written=?, completed_at=CURRENT_TIMESTAMP()
          WHERE report_id=?
        `, [written, reportId]);

        console.log(`[downloadReports] ✅ ${reportId} (${reportType} ${reportDate}): ${written} rows`);
        await sleep(100);
      } catch (err) {
        const msg = err.message?.substring(0, 500) || 'unknown';
        console.error(`[downloadReports] ❌ ${reportId} (${reportType}): ${msg}`);
        await query(`
          UPDATE ads_report_queue
          SET error_message=? WHERE report_id=?
        `, [msg, reportId]).catch(() => {});
      }
    }

    await completeJob(runId, { rowsRead: ready.length, rowsWritten: totalRows });
    console.log(`[downloadReports] ✅ ${downloaded}/${ready.length} downloaded, ${totalRows} total rows written`);
    return { downloaded, rowsWritten: totalRows };
  } catch (err) {
    await failJob(runId, err.message);
    throw err;
  }
}

module.exports = {
  submitAmazonReports,
  pollReportStatus,
  downloadCompletedReports,
};
