'use strict';
require('dotenv').config();

const { query } = require('../services/snowflakeService');

const JOB_NAME = 'anomaly_detection';

// ─── Ensure ANOMALY_ALERTS table exists ──────────────────────────────────────
async function ensureAlertsTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS CALBRIDGE_PROD.OPS.ANOMALY_ALERTS (
      alert_id        VARCHAR        DEFAULT UUID_STRING() PRIMARY KEY,
      client_id       VARCHAR        NOT NULL,
      campaign_id     VARCHAR        NOT NULL,
      campaign_name   VARCHAR,
      ad_product      VARCHAR,
      alert_type      VARCHAR        NOT NULL,
      severity        VARCHAR        NOT NULL,
      metric_value    FLOAT,
      threshold_value FLOAT,
      details         VARCHAR,
      status          VARCHAR        DEFAULT 'open',
      auto_actioned   BOOLEAN        DEFAULT FALSE,
      detected_at     TIMESTAMP_NTZ  DEFAULT CURRENT_TIMESTAMP(),
      resolved_at     TIMESTAMP_NTZ,
      created_at      TIMESTAMP_NTZ  DEFAULT CURRENT_TIMESTAMP()
    )
  `);
}

// ─── Get clients eligible for anomaly detection ───────────────────────────────
// Uses CALBRIDGE_PROD.APP.clients (SUBSCRIPTION_PLAN column).
// anomalyDetection is enabled for plans: pro, agency
async function getEligibleClients() {
  const rows = await query(`
    SELECT client_id
    FROM CALBRIDGE_PROD.APP.clients
    WHERE LOWER(subscription_plan) IN ('pro', 'agency')
      AND (status IS NULL OR LOWER(status) NOT IN ('suspended', 'churned'))
      AND linked_client_id IS NULL
  `);
  return rows.map(r => r.CLIENT_ID || r.client_id);
}

// ─── Signal queries ───────────────────────────────────────────────────────────
// All queries run against CALBRIDGE_PROD.APP.ADJUSTED_CAMPAIGN_PERFORMANCE
// which has: CLIENT_ID, PROFILE_ID, CAMPAIGN_ID, CAMPAIGN_NAME, CAMPAIGN_STATUS,
//   CAMPAIGN_BUDGET_AMOUNT, AD_TYPE, DATE, SPEND, IMPRESSIONS, CLICKS, SALES,
//   ORDERS, TOP_OF_SEARCH_IMPRESSION_SHARE (impression share proxy for SP)

/**
 * Signal 1: RUNAWAY_SPEND
 * Campaign spent > 150% of its average daily spend in today's data.
 * We use today's spend vs 7-day avg daily spend as proxy
 * (intra-day hourly data not available — the data represents the current day's
 *  accumulated spend as of the last sync).
 */
async function detectRunawaySpend(clientId) {
  const rows = await query(`
    WITH today AS (
      SELECT
        campaign_id,
        MAX(campaign_name)           AS campaign_name,
        MAX(ad_type)                 AS ad_product,
        SUM(spend)                   AS spend_today,
        MAX(campaign_budget_amount)  AS daily_budget
      FROM CALBRIDGE_PROD.APP.deduped_campaign_performance
      WHERE client_id = ?
        AND date = CURRENT_DATE()
      GROUP BY campaign_id
    ),
    rolling AS (
      SELECT
        campaign_id,
        AVG(daily_spend)  AS avg_daily_spend
      FROM (
        SELECT campaign_id, date, SUM(spend) AS daily_spend
        FROM CALBRIDGE_PROD.APP.deduped_campaign_performance
        WHERE client_id = ?
          AND date >= DATEADD('day', -7, CURRENT_DATE())
          AND date <  CURRENT_DATE()
        GROUP BY campaign_id, date
      ) d
      GROUP BY campaign_id
    )
    SELECT
      t.campaign_id,
      t.campaign_name,
      t.ad_product,
      t.spend_today,
      t.daily_budget,
      r.avg_daily_spend,
      r.avg_daily_spend * 1.5 AS threshold_value
    FROM today t
    JOIN rolling r ON r.campaign_id = t.campaign_id
    WHERE t.spend_today > r.avg_daily_spend * 1.5
      AND r.avg_daily_spend > 1
  `, [clientId, clientId]);
  return rows.map(r => ({
    campaignId:     r.CAMPAIGN_ID,
    campaignName:   r.CAMPAIGN_NAME,
    adProduct:      r.AD_PRODUCT,
    metricValue:    Number(r.SPEND_TODAY     || 0),
    thresholdValue: Number(r.THRESHOLD_VALUE || 0),
    details: `Campaign spent $${Number(r.SPEND_TODAY || 0).toFixed(2)} today vs avg daily spend of $${Number(r.AVG_DAILY_SPEND || 0).toFixed(2)} (threshold: $${Number(r.THRESHOLD_VALUE || 0).toFixed(2)})`,
  }));
}

/**
 * Signal 2: BUDGET_EXHAUSTED_EARLY
 * Campaign spend today >= daily_budget AND current UTC hour < 14:00.
 */
async function detectBudgetExhaustedEarly(clientId) {
  const utcHour = new Date().getUTCHours();
  if (utcHour >= 14) return []; // After 14:00 UTC — not early

  const rows = await query(`
    SELECT
      campaign_id,
      MAX(campaign_name)           AS campaign_name,
      MAX(ad_type)                 AS ad_product,
      SUM(spend)                   AS spend_today,
      MAX(campaign_budget_amount)  AS daily_budget
    FROM CALBRIDGE_PROD.APP.deduped_campaign_performance
    WHERE client_id = ?
      AND date = CURRENT_DATE()
    GROUP BY campaign_id
    HAVING MAX(campaign_budget_amount) > 0
       AND SUM(spend) >= MAX(campaign_budget_amount)
  `, [clientId]);

  return rows.map(r => ({
    campaignId:     r.CAMPAIGN_ID,
    campaignName:   r.CAMPAIGN_NAME,
    adProduct:      r.AD_PRODUCT,
    metricValue:    Number(r.SPEND_TODAY  || 0),
    thresholdValue: Number(r.DAILY_BUDGET || 0),
    details: `Campaign budget of $${Number(r.DAILY_BUDGET || 0).toFixed(2)} fully consumed before 14:00 UTC (spent $${Number(r.SPEND_TODAY || 0).toFixed(2)})`,
  }));
}

/**
 * Signal 3: ACOS_SPIKE
 * ACoS today > 2× the 7-day rolling average ACoS, and spend today > $10.
 */
async function detectAcosSpike(clientId) {
  const rows = await query(`
    WITH today AS (
      SELECT
        campaign_id,
        MAX(campaign_name)  AS campaign_name,
        MAX(ad_type)        AS ad_product,
        SUM(spend)          AS spend_today,
        SUM(sales)          AS sales_today,
        CASE WHEN SUM(sales) > 0 THEN SUM(spend) / SUM(sales) ELSE NULL END AS acos_today
      FROM CALBRIDGE_PROD.APP.deduped_campaign_performance
      WHERE client_id = ?
        AND date = CURRENT_DATE()
      GROUP BY campaign_id
    ),
    rolling AS (
      SELECT
        campaign_id,
        AVG(daily_acos)  AS acos_7d_avg
      FROM (
        SELECT
          campaign_id,
          date,
          CASE WHEN SUM(sales) > 0 THEN SUM(spend) / SUM(sales) ELSE NULL END AS daily_acos
        FROM CALBRIDGE_PROD.APP.deduped_campaign_performance
        WHERE client_id = ?
          AND date >= DATEADD('day', -7, CURRENT_DATE())
          AND date <  CURRENT_DATE()
        GROUP BY campaign_id, date
      ) d
      GROUP BY campaign_id
    )
    SELECT
      t.campaign_id,
      t.campaign_name,
      t.ad_product,
      t.acos_today,
      t.spend_today,
      r.acos_7d_avg,
      r.acos_7d_avg * 2 AS threshold_value
    FROM today t
    JOIN rolling r ON r.campaign_id = t.campaign_id
    WHERE t.acos_today > r.acos_7d_avg * 2
      AND t.spend_today > 10
      AND t.acos_today IS NOT NULL
      AND r.acos_7d_avg IS NOT NULL
      AND r.acos_7d_avg > 0
  `, [clientId, clientId]);

  return rows.map(r => ({
    campaignId:     r.CAMPAIGN_ID,
    campaignName:   r.CAMPAIGN_NAME,
    adProduct:      r.AD_PRODUCT,
    metricValue:    Number(r.ACOS_TODAY    || 0),
    thresholdValue: Number(r.THRESHOLD_VALUE || 0),
    details: `ACoS today is ${(Number(r.ACOS_TODAY || 0) * 100).toFixed(1)}% vs 7-day avg of ${(Number(r.ACOS_7D_AVG || 0) * 100).toFixed(1)}% (2× threshold: ${(Number(r.THRESHOLD_VALUE || 0) * 100).toFixed(1)}%)`,
  }));
}

/**
 * Signal 4: ZERO_IMPRESSIONS
 * Campaign status ENABLED but 0 impressions today, while 7-day avg > 100/day.
 */
async function detectZeroImpressions(clientId) {
  const rows = await query(`
    WITH today AS (
      SELECT
        campaign_id,
        MAX(campaign_name)       AS campaign_name,
        MAX(ad_type)             AS ad_product,
        MAX(campaign_status)     AS campaign_status,
        SUM(impressions)         AS impressions_today
      FROM CALBRIDGE_PROD.APP.deduped_campaign_performance
      WHERE client_id = ?
        AND date = CURRENT_DATE()
      GROUP BY campaign_id
    ),
    rolling AS (
      SELECT
        campaign_id,
        AVG(daily_impressions)  AS avg_daily_impressions
      FROM (
        SELECT campaign_id, date, SUM(impressions) AS daily_impressions
        FROM CALBRIDGE_PROD.APP.deduped_campaign_performance
        WHERE client_id = ?
          AND date >= DATEADD('day', -7, CURRENT_DATE())
          AND date <  CURRENT_DATE()
        GROUP BY campaign_id, date
      ) d
      GROUP BY campaign_id
    )
    SELECT
      t.campaign_id,
      t.campaign_name,
      t.ad_product,
      t.impressions_today,
      r.avg_daily_impressions
    FROM today t
    JOIN rolling r ON r.campaign_id = t.campaign_id
    WHERE UPPER(COALESCE(t.campaign_status, '')) = 'ENABLED'
      AND t.impressions_today = 0
      AND r.avg_daily_impressions > 100
  `, [clientId, clientId]);

  return rows.map(r => ({
    campaignId:     r.CAMPAIGN_ID,
    campaignName:   r.CAMPAIGN_NAME,
    adProduct:      r.AD_PRODUCT,
    metricValue:    0,
    thresholdValue: Number(r.AVG_DAILY_IMPRESSIONS || 0),
    details: `Campaign is ENABLED but has 0 impressions today (7-day avg: ${Math.round(Number(r.AVG_DAILY_IMPRESSIONS || 0))} impressions/day)`,
  }));
}

/**
 * Signal 5: CTR_COLLAPSE
 * CTR today < 50% of 7-day avg CTR, with today's impressions > 1000.
 */
async function detectCtrCollapse(clientId) {
  const rows = await query(`
    WITH today AS (
      SELECT
        campaign_id,
        MAX(campaign_name)   AS campaign_name,
        MAX(ad_type)         AS ad_product,
        SUM(impressions)     AS impressions_today,
        SUM(clicks)          AS clicks_today,
        CASE WHEN SUM(impressions) > 0 THEN SUM(clicks) / SUM(impressions) ELSE NULL END AS ctr_today
      FROM CALBRIDGE_PROD.APP.deduped_campaign_performance
      WHERE client_id = ?
        AND date = CURRENT_DATE()
      GROUP BY campaign_id
    ),
    rolling AS (
      SELECT
        campaign_id,
        AVG(daily_ctr)  AS ctr_7d_avg
      FROM (
        SELECT
          campaign_id,
          date,
          CASE WHEN SUM(impressions) > 0 THEN SUM(clicks) / SUM(impressions) ELSE NULL END AS daily_ctr
        FROM CALBRIDGE_PROD.APP.deduped_campaign_performance
        WHERE client_id = ?
          AND date >= DATEADD('day', -7, CURRENT_DATE())
          AND date <  CURRENT_DATE()
        GROUP BY campaign_id, date
      ) d
      GROUP BY campaign_id
    )
    SELECT
      t.campaign_id,
      t.campaign_name,
      t.ad_product,
      t.ctr_today,
      t.impressions_today,
      r.ctr_7d_avg,
      r.ctr_7d_avg * 0.5 AS threshold_value
    FROM today t
    JOIN rolling r ON r.campaign_id = t.campaign_id
    WHERE t.impressions_today > 1000
      AND t.ctr_today < r.ctr_7d_avg * 0.5
      AND t.ctr_today IS NOT NULL
      AND r.ctr_7d_avg IS NOT NULL
      AND r.ctr_7d_avg > 0
  `, [clientId, clientId]);

  return rows.map(r => ({
    campaignId:     r.CAMPAIGN_ID,
    campaignName:   r.CAMPAIGN_NAME,
    adProduct:      r.AD_PRODUCT,
    metricValue:    Number(r.CTR_TODAY       || 0),
    thresholdValue: Number(r.THRESHOLD_VALUE || 0),
    details: `CTR today is ${(Number(r.CTR_TODAY || 0) * 100).toFixed(3)}% vs 7-day avg of ${(Number(r.CTR_7D_AVG || 0) * 100).toFixed(3)}% (threshold: 50% of avg = ${(Number(r.THRESHOLD_VALUE || 0) * 100).toFixed(3)}%)`,
  }));
}

/**
 * Signal 6: IMPRESSION_SHARE_COLLAPSE
 * SP campaigns where impression share today < 50% of 7-day avg,
 * but only if 7-day avg impression share > 10%.
 * Uses TOP_OF_SEARCH_IMPRESSION_SHARE from adjusted_campaign_performance.
 */
async function detectImpressionShareCollapse(clientId) {
  const rows = await query(`
    WITH today AS (
      SELECT
        campaign_id,
        MAX(campaign_name)                    AS campaign_name,
        MAX(ad_type)                          AS ad_product,
        AVG(top_of_search_impression_share)   AS impression_share_today
      FROM CALBRIDGE_PROD.APP.deduped_campaign_performance
      WHERE client_id = ?
        AND date = CURRENT_DATE()
        AND UPPER(ad_type) = 'SP'
      GROUP BY campaign_id
    ),
    rolling AS (
      SELECT
        campaign_id,
        AVG(daily_is)  AS is_7d_avg
      FROM (
        SELECT
          campaign_id,
          date,
          AVG(top_of_search_impression_share)  AS daily_is
        FROM CALBRIDGE_PROD.APP.deduped_campaign_performance
        WHERE client_id = ?
          AND date >= DATEADD('day', -7, CURRENT_DATE())
          AND date <  CURRENT_DATE()
          AND UPPER(ad_type) = 'SP'
        GROUP BY campaign_id, date
      ) d
      GROUP BY campaign_id
    )
    SELECT
      t.campaign_id,
      t.campaign_name,
      t.ad_product,
      t.impression_share_today,
      r.is_7d_avg,
      r.is_7d_avg * 0.5 AS threshold_value
    FROM today t
    JOIN rolling r ON r.campaign_id = t.campaign_id
    WHERE t.impression_share_today < r.is_7d_avg * 0.5
      AND r.is_7d_avg > 0.10
      AND t.impression_share_today IS NOT NULL
      AND r.is_7d_avg IS NOT NULL
  `, [clientId, clientId]);

  return rows.map(r => ({
    campaignId:     r.CAMPAIGN_ID,
    campaignName:   r.CAMPAIGN_NAME,
    adProduct:      r.AD_PRODUCT,
    metricValue:    Number(r.IMPRESSION_SHARE_TODAY || 0),
    thresholdValue: Number(r.THRESHOLD_VALUE        || 0),
    details: `SP impression share today is ${(Number(r.IMPRESSION_SHARE_TODAY || 0) * 100).toFixed(1)}% vs 7-day avg of ${(Number(r.IS_7D_AVG || 0) * 100).toFixed(1)}% (threshold: 50% of avg = ${(Number(r.THRESHOLD_VALUE || 0) * 100).toFixed(1)}%)`,
  }));
}

// ─── Write alerts via MERGE (dedup per day) ───────────────────────────────────
async function writeAlerts(alerts) {
  if (!alerts.length) return;

  for (const a of alerts) {
    await query(`
      MERGE INTO CALBRIDGE_PROD.OPS.ANOMALY_ALERTS t
      USING (
        SELECT
          ?                    AS client_id,
          ?                    AS campaign_id,
          ?                    AS campaign_name,
          ?                    AS ad_product,
          ?                    AS alert_type,
          ?                    AS severity,
          ?::FLOAT             AS metric_value,
          ?::FLOAT             AS threshold_value,
          ?                    AS details,
          ?                    AS status,
          ?::BOOLEAN           AS auto_actioned
      ) s
      ON  t.client_id   = s.client_id
      AND t.campaign_id = s.campaign_id
      AND t.alert_type  = s.alert_type
      AND DATE(t.detected_at) = CURRENT_DATE()
      WHEN MATCHED AND t.status = 'open' THEN UPDATE SET
        metric_value    = s.metric_value,
        threshold_value = s.threshold_value,
        details         = s.details,
        auto_actioned   = s.auto_actioned,
        status          = s.status
      WHEN NOT MATCHED THEN INSERT (
        client_id, campaign_id, campaign_name, ad_product,
        alert_type, severity, metric_value, threshold_value, details,
        status, auto_actioned
      ) VALUES (
        s.client_id, s.campaign_id, s.campaign_name, s.ad_product,
        s.alert_type, s.severity, s.metric_value, s.threshold_value, s.details,
        s.status, s.auto_actioned
      )
    `, [
      a.clientId, a.campaignId, a.campaignName || null, a.adProduct || null,
      a.alertType, a.severity,
      a.metricValue != null ? a.metricValue : null,
      a.thresholdValue != null ? a.thresholdValue : null,
      a.details || null,
      a.status || 'open',
      a.autoActioned ? 'TRUE' : 'FALSE',
    ]);
  }
}

// ─── RUNAWAY_SPEND auto-pause via CHANGE_QUEUE ────────────────────────────────
/**
 * Check if this client has campaign_pausing set to 'auto' in CLIENT_AI_ENROLLMENT.
 * account.js creates the table with (client_id, setting_key, enrollment_mode).
 */
async function isAutoPauseEnabled(clientId) {
  try {
    const rows = await query(
      `SELECT enrollment_mode FROM CALBRIDGE_PROD.APP.CLIENT_AI_ENROLLMENT
       WHERE client_id = ? AND setting_key = 'campaign_pausing'`,
      [clientId]
    );
    return (rows[0]?.ENROLLMENT_MODE || '').toLowerCase() === 'auto';
  } catch {
    return false;
  }
}

/**
 * Write a pause action to OPS.CHANGE_QUEUE.
 * CHANGE_QUEUE schema:
 *   change_id (uuid), client_id, platform, marketplace, profile_id,
 *   resource_type, resource_id, resource_name, current_value (VARIANT),
 *   proposed_value (VARIANT), rollback_value (VARIANT), change_reason,
 *   recommendation_id, status (default 'pending_approval'), batch_id,
 *   api_version (default 'v3'), requested_by, approved_by,
 *   requested_at, approved_at, submitted_at, confirmed_at,
 *   amazon_request_id, error_message
 *
 * For auto-pause: status = 'approved' so the executor picks it up immediately.
 */
async function queueCampaignPause(clientId, campaign) {
  await query(`
    INSERT INTO CALBRIDGE_PROD.OPS.CHANGE_QUEUE (
      client_id, platform, marketplace, resource_type, resource_id,
      resource_name, current_value, proposed_value, change_reason,
      status, requested_by, api_version
    ) VALUES (
      ?, 'ads', 'US', 'campaign', ?,
      ?, PARSE_JSON('{"state":"ENABLED"}'), PARSE_JSON('{"state":"PAUSED"}'),
      ?,
      'approved', 'anomaly_detection', 'v3'
    )
  `, [
    clientId,
    campaign.campaignId,
    campaign.campaignName || campaign.campaignId,
    `Auto-pause: RUNAWAY_SPEND — ${campaign.details}`,
  ]);
}

// ─── Main job ─────────────────────────────────────────────────────────────────
async function detectAnomalies(triggeredBy = 'scheduler') {
  console.log(`[${JOB_NAME}] Starting anomaly detection (triggered by: ${triggeredBy})`);

  try {
    await ensureAlertsTable();
  } catch (err) {
    console.warn(`[${JOB_NAME}] Table creation skipped (may already exist):`, err.message);
  }

  let clients;
  try {
    clients = await getEligibleClients();
  } catch (err) {
    console.error(`[${JOB_NAME}] Failed to fetch eligible clients:`, err.message);
    return;
  }

  console.log(`[${JOB_NAME}] Found ${clients.length} eligible client(s)`);

  for (const clientId of clients) {
    console.log(`[${JOB_NAME}] Checking client ${clientId}...`);

    try {
      // Run all 6 signal detectors in parallel
      const [
        runawayRows,
        budgetRows,
        acosRows,
        zeroImpRows,
        ctrRows,
        isRows,
      ] = await Promise.allSettled([
        detectRunawaySpend(clientId),
        detectBudgetExhaustedEarly(clientId),
        detectAcosSpike(clientId),
        detectZeroImpressions(clientId),
        detectCtrCollapse(clientId),
        detectImpressionShareCollapse(clientId),
      ]).then(results => results.map((r, i) => {
        if (r.status === 'rejected') {
          const names = ['RUNAWAY_SPEND','BUDGET_EXHAUSTED_EARLY','ACOS_SPIKE','ZERO_IMPRESSIONS','CTR_COLLAPSE','IMPRESSION_SHARE_COLLAPSE'];
          console.warn(`[${JOB_NAME}] Signal ${names[i]} failed for ${clientId}:`, r.reason?.message);
          return [];
        }
        return r.value;
      }));

      const alerts = [];

      // RUNAWAY_SPEND → critical, check for auto-pause
      const isAutoPause = runawayRows.length > 0 ? await isAutoPauseEnabled(clientId) : false;
      for (const row of runawayRows) {
        const autoActioned = isAutoPause;
        alerts.push({
          clientId,
          campaignId:     row.campaignId,
          campaignName:   row.campaignName,
          adProduct:      row.adProduct,
          alertType:      'RUNAWAY_SPEND',
          severity:       'critical',
          metricValue:    row.metricValue,
          thresholdValue: row.thresholdValue,
          details:        row.details,
          status:         autoActioned ? 'auto_actioned' : 'open',
          autoActioned,
        });
        if (autoActioned) {
          try {
            await queueCampaignPause(clientId, row);
            console.log(`[${JOB_NAME}] AUTO-PAUSE queued for campaign ${row.campaignId} (${row.campaignName})`);
          } catch (err) {
            console.error(`[${JOB_NAME}] Failed to queue pause for ${row.campaignId}:`, err.message);
          }
        }
      }

      // BUDGET_EXHAUSTED_EARLY → warning
      for (const row of budgetRows) {
        alerts.push({
          clientId, ...row,
          alertType: 'BUDGET_EXHAUSTED_EARLY',
          severity:  'warning',
          status:    'open',
          autoActioned: false,
        });
      }

      // ACOS_SPIKE → warning, recommend bid reduction
      for (const row of acosRows) {
        alerts.push({
          clientId, ...row,
          alertType: 'ACOS_SPIKE',
          severity:  'warning',
          status:    'open',
          autoActioned: false,
          details: row.details + '. Recommend reducing bids.',
        });
      }

      // ZERO_IMPRESSIONS → warning
      for (const row of zeroImpRows) {
        alerts.push({
          clientId, ...row,
          alertType: 'ZERO_IMPRESSIONS',
          severity:  'warning',
          status:    'open',
          autoActioned: false,
        });
      }

      // CTR_COLLAPSE → info
      for (const row of ctrRows) {
        alerts.push({
          clientId, ...row,
          alertType: 'CTR_COLLAPSE',
          severity:  'info',
          status:    'open',
          autoActioned: false,
        });
      }

      // IMPRESSION_SHARE_COLLAPSE → warning, recommend bid increase
      for (const row of isRows) {
        alerts.push({
          clientId, ...row,
          alertType: 'IMPRESSION_SHARE_COLLAPSE',
          severity:  'warning',
          status:    'open',
          autoActioned: false,
          details: row.details + '. Recommend increasing bids to recapture impression share.',
        });
      }

      if (alerts.length > 0) {
        await writeAlerts(alerts);
        console.log(`[${JOB_NAME}] ✅ ${clientId}: wrote ${alerts.length} alert(s)`);
      } else {
        console.log(`[${JOB_NAME}] ✅ ${clientId}: no anomalies detected`);
      }

    } catch (err) {
      console.error(`[${JOB_NAME}] Client ${clientId} failed:`, err.message);
    }
  }

  console.log(`[${JOB_NAME}] Anomaly detection complete`);
}

module.exports = { detectAnomalies };
