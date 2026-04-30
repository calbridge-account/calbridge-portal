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
const SUBMIT_DAYS_BACK  = Number(process.env.REPORT_DAYS_BACK  || 30);  // reduced from 60 — cuts dedup query volume in half; 30d covers full attribution settlement
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
        AND linked_client_id IS NULL
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
  // Use today in PST/PDT as the end date — Amazon's ad day closes at midnight Pacific,
  // so "today" should match the Pacific calendar date, not UTC.
  // e.g. at 3 AM UTC (8 PM PST the prior day) we want yesterday's PST date, not UTC today.
  const pstDateStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }); // YYYY-MM-DD
  const today = new Date(pstDateStr + 'T00:00:00Z'); // treat as UTC midnight for arithmetic

  const windows = [];
  let windowEnd = new Date(today);
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

  const { REPORT_TYPES, DSP_REPORT_TYPES, requestV3Report, requestDspReport, adsClient: makeAdsClient } = getAdsIngestion();
  const windows = buildDateWindows(daysBack);

  // Rolling refresh: reset the most recent window back to pending so every run
  // re-fetches fresh same-day data from Amazon.
  // Only resets entries completed >1 hour ago to avoid re-downloading data
  // that was just written in the current cycle.
  const latestWindow = windows[windows.length - 1]; // most recent (today)
  try {
    const resetCount = await query(`
      UPDATE ads_report_queue
      SET status = 'pending', completed_at = NULL, error_message = NULL
      WHERE report_date = ?
        AND status = 'completed'
        AND report_type IN (
          'spCampaigns','sbCampaigns','sdCampaigns','spTargeting',
          'dspCampaign','dspOrder','dspLineItem','dspAudience','dspProduct'
        )
        AND (completed_at IS NULL OR completed_at < DATEADD('hour', -1, CURRENT_TIMESTAMP()))
    `, [latestWindow.rangeKey]);
    const n = resetCount?.[0]?.['number of rows updated'] || 0;
    if (n > 0) console.log(`[submitReports] Rolling refresh: reset ${n} completed reports for window ${latestWindow.rangeKey}`);
  } catch (err) {
    console.warn('[submitReports] Rolling refresh reset failed (non-fatal):', err.message);
  }
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

      // Prefetch all existing queue entries for this client into a Set.
      // Replaces per-combination COUNT(*) queries — one query per client instead of
      // one per profile×reportType×window (was ~480 queries/run at 2 clients).
      // Key format: `${profileId}|${reportType}|${rangeKey}`
      const existingSet = new Set();
      try {
        const existingRows = await query(`
          SELECT profile_id, report_type, report_date
          FROM ads_report_queue
          WHERE client_id = ?
            AND (
              status IN ('pending', 'ready', 'completed')
              OR (status = 'failed' AND requested_at >= DATEADD('hour', -24, CURRENT_TIMESTAMP()))
            )
            AND requested_at >= DATEADD('day', -30, CURRENT_TIMESTAMP())
        `, [clientId]);
        for (const r of (existingRows || [])) {
          existingSet.add(`${r.PROFILE_ID||r.profile_id}|${r.REPORT_TYPE||r.report_type}|${r.REPORT_DATE||r.report_date}`);
        }
      } catch (err) {
        console.warn(`[submitReports] dedup prefetch failed for ${clientId} (non-fatal):`, err.message);
      }

      // Phase 2b: build profileId → account_id lookup from client_accounts
      let profileAccountMap = {};
      try {
        const caRows = await query(`
          SELECT platform_profile_id, account_id
          FROM client_accounts
          WHERE client_id = ? AND channel = 'sponsored_ads'
            AND is_active = TRUE
            AND (valid_from IS NULL OR valid_from <= CURRENT_DATE())
            AND (valid_to   IS NULL OR valid_to   >  CURRENT_DATE())
        `, [clientId]);
        for (const r of caRows) {
          profileAccountMap[String(r.PLATFORM_PROFILE_ID || r.platform_profile_id)] = r.ACCOUNT_ID || r.account_id;
        }
      } catch (err) {
        // Non-fatal — account_id will be NULL for this run
        console.warn(`[submitReports] client_accounts account_id lookup failed for ${clientId} (non-fatal):`, err.message);
      }

      for (const profile of profiles) {
        const profileId = String(profile.profileId);
        const accountId = profileAccountMap[profileId] || null;

        for (const window of windows) {
          for (const rt of REPORT_TYPES) {
            // Dedup: check in-memory Set (prefetched above — one query per client)
            if (existingSet.has(`${profileId}|${rt.key}|${window.rangeKey}`)) continue;

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
                  (report_id, client_id, connection_type, profile_id, report_type, report_date, status, account_id, requested_at)
                VALUES (?, ?, 'ads', ?, ?, ?, 'pending', ?, CURRENT_TIMESTAMP())
              `, [reportId, clientId, profileId, rt.key, window.rangeKey, accountId]);
              existingSet.add(`${profileId}|${rt.key}|${window.rangeKey}`);
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

      // ── DSP reports (advertiser-scoped, same token) ──────────────────────────
      let dspAdvertisers = [];
      try {
        const caRows = await query(`
          SELECT platform_profile_id AS advertiser_id, agency_profile_id AS profile_id,
                 account_name, account_id
          FROM client_accounts
          WHERE client_id = ? AND channel = 'dsp' AND is_active = TRUE
            AND (valid_from IS NULL OR valid_from <= CURRENT_DATE())
            AND (valid_to IS NULL OR valid_to > CURRENT_DATE())
        `, [clientId]);
        dspAdvertisers = caRows || [];
      } catch (e) {
        console.warn('[submitReports] DSP advertiser lookup failed (non-fatal):', e.message);
      }

      for (const adv of dspAdvertisers) {
        const advertiserId   = String(adv.ADVERTISER_ID || adv.advertiser_id);
        const dspProfileId   = String(adv.PROFILE_ID    || adv.profile_id);
        const advAccountId   = adv.ACCOUNT_ID || adv.account_id || null;
        const queueProfileId = advertiserId + '|' + dspProfileId;

        for (const window of windows) {
          for (const rt of DSP_REPORT_TYPES) {
            // Dedup: check in-memory Set (same prefetch as SP/SB/SD above)
            if (existingSet.has(`${queueProfileId}|${rt.key}|${window.rangeKey}`)) continue;

            try {
              await new Promise(r => setImmediate(r));
              const client   = await makeAdsClient(clientId, 'ads');
              const reportId = await requestDspReport(
                client, dspProfileId, advertiserId,
                rt.reportTypeId, rt.groupBy, rt.columns,
                window.startIso, window.endIso
              );
              if (!reportId) continue;

              await query(`
                INSERT INTO ads_report_queue
                  (report_id, client_id, connection_type, profile_id, report_type, report_date, status, account_id, owner_client_id, requested_at)
                VALUES (?, ?, 'ads', ?, ?, ?, 'pending', ?, ?, CURRENT_TIMESTAMP())
              `, [reportId, clientId, queueProfileId, rt.key, window.rangeKey, advAccountId, clientId]);
              existingSet.add(`${queueProfileId}|${rt.key}|${window.rangeKey}`);
              queued++;
              totalQueued++;
              await sleep(100);
            } catch (e) {
              console.warn(`[submitReports] DSP ${advertiserId} ${window.rangeKey} ${rt.key}:`, e.message?.substring(0, 80));
            }
          } // DSP report types
        } // windows
      } // DSP advertisers

      await completeJob(runId, { rowsRead: profiles.length, rowsWritten: queued });
      console.log(`[submitReports] ${clientId}: queued ${queued} reports (incl. DSP)`);
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
    // Fetch all pending reports across all clients, oldest first.
    // Window is 30 days to match SUBMIT_DAYS_BACK — cover all submitted windows.
    const pending = await query(`
      SELECT report_id, client_id, connection_type, profile_id, requested_at,
             COALESCE(owner_client_id, client_id) AS token_client_id
      FROM ads_report_queue
      WHERE status = 'pending'
        AND requested_at >= DATEADD('day', -30, CURRENT_TIMESTAMP())
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
        const tokenClientId = row.TOKEN_CLIENT_ID || row.token_client_id || clientId;
        const token = await getToken(tokenClientId, connectionType);
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
      SELECT report_id, client_id, profile_id, report_type, report_date, download_url,
             COALESCE(owner_client_id, client_id) AS token_client_id
      FROM ads_report_queue
      WHERE status = 'ready'
      ORDER BY requested_at ASC
      LIMIT 100
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
        // Resolve the download URL. Pre-signed S3 URLs expire after ~1 hour,
        // so always re-poll Amazon for a fresh URL rather than relying on the stored one.
        let url = null;
        {
          const { getValidToken } = require('../services/amazonAuthService');
          const tokenClientId = row.TOKEN_CLIENT_ID || row.token_client_id || clientId;
          const connType = (row.CONNECTION_TYPE || row.connection_type || 'ads');
          const token = await getValidToken(tokenClientId, connType);
          const pollRes = await axios.get(
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
          const { status: reportStatus, failureReason } = pollRes.data;
          if (reportStatus === 'COMPLETED') {
            url = pollRes.data.url;
          } else if (reportStatus === 'FAILURE') {
            // Amazon says it failed — mark as failed permanently
            await query(`
              UPDATE ads_report_queue
              SET status='failed', error_message=?, completed_at=CURRENT_TIMESTAMP()
              WHERE report_id=?
            `, [failureReason || 'FAILURE from Amazon', reportId]);
            console.warn(`[downloadReports] ${reportId} (${reportType}): Amazon FAILURE — ${failureReason}`);
            continue;
          } else {
            // Still PENDING/PROCESSING — reset to pending so poll_report_status picks it up
            await query(`
              UPDATE ads_report_queue SET status='pending', download_url=NULL WHERE report_id=?
            `, [reportId]);
            continue;
          }
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

        // Feature flag: route campaign-level reports directly to RAW.AD_CAMPAIGN
        // when PIPELINE_DIRECT_RAW_WRITE=true. Other report types always use APP tables.
        // Flag starts false — zero-impact deploy. Flip to true to cut over.
        const DIRECT_RAW_TYPES = new Set(['spCampaigns', 'sbCampaigns', 'sdCampaigns', 'dspCampaign']);
        const useDirectRaw = process.env.PIPELINE_DIRECT_RAW_WRITE === 'true';
        let actualWriteFn = writeFn;
        if (useDirectRaw && DIRECT_RAW_TYPES.has(reportType)) {
          const { writeSpCampaignToRaw, writeSbCampaignToRaw, writeSdCampaignToRaw, writeDspCampaignToRaw } = getAdsIngestion();
          const RAW_WRITE_FNS = {
            spCampaigns: writeSpCampaignToRaw,
            sbCampaigns: writeSbCampaignToRaw,
            sdCampaigns: writeSdCampaignToRaw,
            dspCampaign: writeDspCampaignToRaw,
          };
          actualWriteFn = RAW_WRITE_FNS[reportType] || writeFn;
          console.log(`[downloadReports] PIPELINE_DIRECT_RAW_WRITE: routing ${reportType} → RAW.AD_CAMPAIGN`);
        }

        const written = await actualWriteFn(clientId, profileId, reportDate, rows);
        totalRows += written;
        downloaded++;

        await query(`
          UPDATE ads_report_queue
          SET status='completed', records_written=?, completed_at=CURRENT_TIMESTAMP(), download_url=NULL
          WHERE report_id=?
        `, [written, reportId]);

        console.log(`[downloadReports] ✅ ${reportId} (${reportType} ${reportDate}): ${written} rows`);
        await sleep(200);
      } catch (err) {
        const httpStatus = err.response?.status;
        const msg = err.message?.substring(0, 500) || 'unknown';
        console.error(`[downloadReports] ❌ ${reportId} (${reportType}): ${msg}`);

        if (httpStatus === 403 || httpStatus === 410) {
          // Pre-signed URL expired or gone — reset to pending so it gets re-polled
          await query(`
            UPDATE ads_report_queue
            SET status='pending', download_url=NULL, error_message=?
            WHERE report_id=?
          `, [`URL expired (${httpStatus}) — reset for re-poll`, reportId]).catch(() => {});
        } else {
          // Other error — leave error_message but don't change status
          await query(`
            UPDATE ads_report_queue SET error_message=? WHERE report_id=?
          `, [msg, reportId]).catch(() => {});
        }
      }
    }

    await completeJob(runId, { rowsRead: ready.length, rowsWritten: totalRows });
    console.log(`[downloadReports] ✅ ${downloaded}/${ready.length} downloaded, ${totalRows} total rows written`);

    // Signal stage + rebuild to run — only when new data actually landed
    if (totalRows > 0) {
      try {
        const { getRedisClient } = require('../services/redisSessionStore');
        const redis = getRedisClient();
        if (redis && redis.status === 'ready') {
          await redis.set('pending_stage', '1', 'EX', 3600); // expire after 1h as safety net
          console.log('[downloadReports] 🚩 pending_stage flag set');
        }
      } catch (flagErr) {
        console.warn('[downloadReports] Could not set pending_stage flag (non-fatal):', flagErr.message?.slice(0, 60));
      }
    }

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
