/**
 * src/jobs/dataSettlement.js
 *
 * Amazon data settlement — 3-tier re-pull strategy.
 * Owned by: Control 🎛️
 *
 * Amazon attribution windows close over time, so recent data is always
 * preliminary. This job resets completed rows in ads_report_queue back to
 * 'pending' so the existing download infrastructure re-fetches the data:
 *
 *   D-0  to  D-2   Preliminary (fraud filtering)   → handled by rolling refresh
 *   D-3  to D-14   Settling (attribution closing)   → settleRecentData()  [daily]
 *   D-15 to D-60   Near-final (rare adjustments)    → finalizeHistoricalData() [weekly]
 *   D-60+          Final                            → no action needed
 *
 * The report_date column stores range keys formatted as 'YYYYMMDD_YYYYMMDD'.
 * For single-day reports the format may be 'YYYYMMDD' (8 chars).
 * Both formats are handled via the CASE expression on LENGTH(report_date).
 *
 * No new infrastructure required — resetting status to 'pending' is enough.
 * The existing poll_report_status / download_completed_reports jobs pick up
 * the reset rows automatically on their next cycle.
 */

'use strict';

const { query }                         = require('../services/snowflakeService');
const { startJob, completeJob, failJob } = require('../services/jobRunner');

// Shared date-extraction expression for Snowflake.
// Handles both 'YYYYMMDD_YYYYMMDD' (17 chars) and 'YYYYMMDD' (8 chars).
const END_DATE_EXPR = `
  CASE
    WHEN LENGTH(report_date) = 17
      THEN TO_DATE(SUBSTR(report_date, 10, 8), 'YYYYMMDD')
    ELSE
      TO_DATE(report_date, 'YYYYMMDD')
  END
`.trim();

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Fetch all root active client IDs (excludes linked/child clients).
 * @returns {Promise<string[]>}
 */
async function getActiveClientIds() {
  const rows = await query(
    `SELECT client_id FROM clients WHERE status = 'active' AND linked_client_id IS NULL`
  );
  return (rows || []).map(r => r.CLIENT_ID || r.client_id).filter(Boolean);
}

/**
 * Reset completed ads_report_queue rows within a date window back to 'pending'.
 * Skips rows written in the last `minAgeHours` hours to avoid thrashing
 * data that was just downloaded.
 *
 * @param {string}  clientId
 * @param {number}  daysBack      Start of window (older bound), e.g. 60
 * @param {number}  daysForward   End of window (newer bound), e.g. 15
 * @param {number}  minAgeHours   Min hours since completed_at before resetting
 * @returns {Promise<number>}     Number of rows reset
 */
async function resetQueueWindow(clientId, daysBack, daysForward, minAgeHours) {
  const result = await query(
    `UPDATE CALBRIDGE_PROD.APP.ads_report_queue
        SET status         = 'pending',
            completed_at   = NULL,
            error_message  = NULL
      WHERE client_id      = ?
        AND status         = 'completed'
        AND ${END_DATE_EXPR}
              BETWEEN DATEADD('day', ?, CURRENT_DATE())
                  AND DATEADD('day', ?, CURRENT_DATE())
        AND (
              completed_at IS NULL
              OR completed_at < DATEADD('hour', ?, CURRENT_TIMESTAMP())
            )`,
    [clientId, -daysBack, -daysForward, -minAgeHours]
  );
  // Snowflake returns [{ 'number of rows updated': N }]
  return Number(result?.[0]?.['number of rows updated'] ?? 0);
}

// ─── Exported jobs ────────────────────────────────────────────────────────────

/**
 * settleRecentData — daily, 01:00 UTC
 *
 * Resets ads_report_queue rows whose report end-date falls in D-3 to D-14
 * so the download infrastructure re-fetches settling attribution data.
 *
 * Guards:
 *  - Only resets rows completed more than 6 hours ago (prevents re-pulling
 *    data that was just written by the last download cycle).
 *  - Iterates clients serially with a short sleep to avoid Snowflake lock storms.
 */
async function settleRecentData({ triggeredBy = 'cron' } = {}) {
  const runId = await startJob('settle_recent_data', 'all_clients', triggeredBy);
  let totalReset = 0;
  let clientCount = 0;

  try {
    const clientIds = await getActiveClientIds();

    for (const clientId of clientIds) {
      try {
        const reset = await resetQueueWindow(
          clientId,
          14,   // daysBack  — window start: D-14
          3,    // daysForward — window end: D-3
          6     // minAgeHours — skip rows written < 6h ago
        );
        if (reset > 0) {
          console.log(`[settlement] settle_recent_data: ${clientId} reset ${reset} row(s) (D-3→D-14)`);
          totalReset += reset;
        }
        clientCount++;
      } catch (clientErr) {
        console.warn(`[settlement] settle_recent_data: ${clientId} failed — ${clientErr.message?.slice(0, 120)}`);
      }

      // Short pause between clients — avoids hammering Snowflake with concurrent UPDATEs
      await new Promise(r => setTimeout(r, 150));
    }

    console.log(
      `[settlement] settle_recent_data: reset ${totalReset} rows for D-3→D-14 across ${clientCount} clients`
    );

    await completeJob(runId, { rowsRead: clientCount, rowsWritten: totalReset });
    return { totalReset, clientCount };

  } catch (err) {
    console.error('[settlement] settle_recent_data: fatal error —', err.message);
    await failJob(runId, err.message);
    throw err;
  }
}

/**
 * finalizeHistoricalData — weekly, Sunday 02:00 UTC
 *
 * Resets ads_report_queue rows whose report end-date falls in D-15 to D-60
 * so the download infrastructure re-fetches near-final data.
 *
 * Guards:
 *  - Only resets rows completed more than 6 days ago (prevents re-pulling
 *    data that was settled this week — avoids churn on the weekly job itself).
 */
async function finalizeHistoricalData({ triggeredBy = 'cron' } = {}) {
  const runId = await startJob('finalize_historical_data', 'all_clients', triggeredBy);
  let totalReset = 0;
  let clientCount = 0;

  try {
    const clientIds = await getActiveClientIds();

    for (const clientId of clientIds) {
      try {
        // minAgeHours = 144 (6 days) — don't re-pull data settled in the last 6 days
        const reset = await resetQueueWindow(
          clientId,
          60,   // daysBack  — window start: D-60
          15,   // daysForward — window end: D-15
          144   // minAgeHours — 6 days × 24h
        );
        if (reset > 0) {
          console.log(`[settlement] finalize_historical_data: ${clientId} reset ${reset} row(s) (D-15→D-60)`);
          totalReset += reset;
        }
        clientCount++;
      } catch (clientErr) {
        console.warn(`[settlement] finalize_historical_data: ${clientId} failed — ${clientErr.message?.slice(0, 120)}`);
      }

      await new Promise(r => setTimeout(r, 150));
    }

    console.log(
      `[settlement] finalize_historical_data: reset ${totalReset} rows for D-15→D-60 across ${clientCount} clients`
    );

    await completeJob(runId, { rowsRead: clientCount, rowsWritten: totalReset });
    return { totalReset, clientCount };

  } catch (err) {
    console.error('[settlement] finalize_historical_data: fatal error —', err.message);
    await failJob(runId, err.message);
    throw err;
  }
}

module.exports = { settleRecentData, finalizeHistoricalData };
