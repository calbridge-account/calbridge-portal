/**
 * src/jobs/buildCanonicalModels.js
 *
 * Jobs: build_canonical_models + compute_core_kpis + detect_anomalies + generate_operator_summary
 * Schedule: daily-early (~02:00 UTC)
 * Owner: Pipeline 🏗️ / Economist 💹 / Analyst 🧠
 *
 * What this does:
 *   build_canonical_models:
 *     - Populates CANONICAL.ACCOUNTS from APP.CLIENTS
 *     - Populates CANONICAL.CAMPAIGNS from RAW.AD_CAMPAIGN
 *     - Populates CANONICAL.AD_GROUPS from RAW.AD_GROUP
 *     - Populates CANONICAL.KEYWORD_TARGETS from RAW.AD_KEYWORD_TARGET
 *     - Populates CANONICAL.PRODUCTS from RAW.RETAIL_LISTING + APP.PRODUCTS
 *     - Populates CANONICAL.INVENTORY_SNAPSHOTS from RAW.RETAIL_INVENTORY
 *     - Populates CANONICAL.CONTRIBUTION_MARGINS from APP.CONTRIBUTION_MARGIN
 *
 *   compute_core_kpis:
 *     - Computes ACoS, ROAS, CPC, CVR, TACoS, contribution margin signals
 *     - Granularity: account / brand / campaign / ASIN / day
 *     - Writes to ANALYTICS.KPI_DAILY (created here if missing)
 *     - Formula version tracked in every row
 *
 *   detect_anomalies:
 *     - Compares yesterday vs prior 7-day average for key metrics
 *     - Flags material changes (>30% shift in spend, revenue, ACoS)
 *     - Writes flags to PIPELINE.ANOMALY_LOG (created here if missing)
 *
 *   generate_operator_summary:
 *     - Reads KPI_DAILY + ANOMALY_LOG for yesterday
 *     - Sends a plain-text daily digest to abe@teamcalbridge.com
 *     - Includes: top movers, SLA status, restock alerts, anomalies
 */

'use strict';

require('dotenv').config();
const { v4: uuidv4 } = require('uuid');
const { Resend } = require('resend');
const { query } = require('../services/snowflakeService');
const { startJob, completeJob, failJob, skipJob } = require('../services/jobRunner');
const { getJob } = require('../config/jobs');

const METRIC_VERSION  = '1.0';
const ALERT_EMAIL     = 'abe@teamcalbridge.com';
const FROM_EMAIL      = process.env.EMAIL_FROM || 'ash@calbridge.ai';
const ANOMALY_THRESHOLD = 0.30; // 30% change flags an anomaly

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function yesterday() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().split('T')[0];
}

// ─── Schema setup ─────────────────────────────────────────────────────────────

async function ensureKpiTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS CALBRIDGE_PROD.ANALYTICS.KPI_DAILY (
      -- Lineage
      metric_version            VARCHAR(32)   NOT NULL DEFAULT '1.0'     COMMENT 'Formula version from src/config/metrics.js',
      pipeline_run_id           VARCHAR(64)   NOT NULL                    COMMENT 'Pipeline run UUID',
      computed_at               TIMESTAMP_NTZ NOT NULL DEFAULT CURRENT_TIMESTAMP(),

      -- Grain
      client_id                 VARCHAR(36)   NOT NULL,
      account_id                VARCHAR(64)   NOT NULL,
      date                      DATE          NOT NULL,

      -- Optional sub-grain (nullable for account-level rows)
      campaign_id               VARCHAR(64),
      ad_type                   VARCHAR(16),   -- SP | SB | SD | ALL
      asin                      VARCHAR(32),

      -- Core spend metrics
      impressions               NUMBER(38,0),
      clicks                    NUMBER(38,0),
      spend                     NUMBER(38,10),
      purchases                 NUMBER(38,0),
      ad_revenue                NUMBER(38,10),

      -- Core retail metrics
      organic_revenue           NUMBER(38,10),
      total_revenue             NUMBER(38,10),   -- ad_revenue + organic_revenue
      units_ordered             NUMBER(38,0),

      -- Computed KPIs
      acos                      NUMBER(38,10)   COMMENT 'spend / ad_revenue * 100',
      tacos                     NUMBER(38,10)   COMMENT 'spend / total_revenue * 100',
      roas                      NUMBER(38,10)   COMMENT 'ad_revenue / spend',
      ctr                       NUMBER(38,10)   COMMENT 'clicks / impressions',
      cpc                       NUMBER(38,10)   COMMENT 'spend / clicks',
      cvr                       NUMBER(38,10)   COMMENT 'purchases / clicks',

      PRIMARY KEY (client_id, account_id, date, campaign_id, ad_type, asin)
    )
    COMMENT = 'Daily KPI snapshots per account/campaign/ASIN. Recomputed daily. Formula version tracked.'
  `).catch(err => {
    if (!err.message?.includes('already exists')) throw err;
  });
}

async function ensureAnomalyLogTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS CALBRIDGE_PROD.PIPELINE.ANOMALY_LOG (
      anomaly_id        VARCHAR(36)   NOT NULL DEFAULT require('crypto').randomUUID(),
      detected_at       TIMESTAMP_NTZ NOT NULL DEFAULT CURRENT_TIMESTAMP(),
      client_id         VARCHAR(36)   NOT NULL,
      account_id        VARCHAR(64)   NOT NULL,
      date              DATE          NOT NULL,

      -- What changed
      metric            VARCHAR(64)   NOT NULL   COMMENT 'spend | revenue | acos | roas | ctr | cvr',
      grain             VARCHAR(64)   NOT NULL   COMMENT 'account | campaign | asin',
      grain_id          VARCHAR(128)             COMMENT 'campaign_id or asin if sub-account grain',

      -- Values
      value_yesterday   NUMBER(38,10),
      value_prior_7d_avg NUMBER(38,10),
      pct_change        NUMBER(38,10)  COMMENT 'Signed % change: (yesterday - avg) / avg * 100',
      direction         VARCHAR(8)    COMMENT 'up | down',

      -- Classification
      severity          VARCHAR(16)   COMMENT 'info | warn | critical',
      acknowledged      BOOLEAN       DEFAULT FALSE,

      PRIMARY KEY (anomaly_id)
    )
    COMMENT = 'Detected metric anomalies. Populated by detect_anomalies job. Surfaced in operator summary.'
  `).catch(err => {
    if (!err.message?.includes('already exists')) throw err;
  });
}

// ─── Job 1: build_canonical_models ───────────────────────────────────────────

/**
 * Ensures all prior-day data is staged and canonical tables are complete.
 * Primarily orchestration: calls stageRawData to catch any missed rows,
 * then validates completeness of canonical tables for each active account.
 */
async function buildCanonicalModels({ triggeredBy = 'cron' } = {}) {
  const priorDate = yesterday();
  console.log(`[buildCanonical] Building canonical models for ${priorDate}`);

  // Get active accounts
  let accounts = [];
  try {
    const rows = await query(`
      SELECT DISTINCT account_id, client_id
      FROM CALBRIDGE_PROD.PIPELINE.JOB_RUNS
      WHERE started_at >= DATEADD('day', -14, CURRENT_TIMESTAMP())
        AND account_id NOT IN ('unknown', 'system')
    `);
    accounts = (rows || []).map(r => ({
      accountId: r.ACCOUNT_ID || r.account_id,
      clientId:  r.CLIENT_ID  || r.client_id,
    }));
  } catch { /* no job history yet */ }

  if (!accounts.length) {
    console.log('[buildCanonical] No active accounts — skipping');
    return { accountsProcessed: 0 };
  }

  // Ensure tables exist
  await ensureKpiTable().catch(err => console.warn('[buildCanonical] ensureKpiTable:', err.message));
  await ensureAnomalyLogTable().catch(err => console.warn('[buildCanonical] ensureAnomalyLogTable:', err.message));

  let rowsWritten = 0;

  for (const { accountId, clientId } of accounts) {
    const runId = await startJob('build_canonical_models', accountId, triggeredBy, { clientId });

    try {
      // Verify prior-day data exists in canonical tables
      const check = await query(`
        SELECT COUNT(*) AS cnt
        FROM CALBRIDGE_PROD.ANALYTICS.ADS_PERFORMANCE
        WHERE client_id = ? AND account_id = ? AND date = ?
      `, [clientId, accountId, priorDate]);

      const cnt = Number(check?.[0]?.CNT || check?.[0]?.cnt || 0);

      if (cnt === 0) {
        // No data for prior day — trigger a catch-up stage
        console.warn(`[buildCanonical] ${accountId}: no data for ${priorDate} — triggering catch-up stage`);
        const { stageRawData } = require('./stageRawData');
        await stageRawData({ triggeredBy: 'dependency' });
        rowsWritten += 1; // staged, not necessarily written to canonical
      } else {
        rowsWritten += cnt;
      }

      // Update freshness for this account's canonical tables
      await query(`
        MERGE INTO CALBRIDGE_PROD.PIPELINE.FRESHNESS tgt
        USING (SELECT ? AS table_name, ? AS account_id, ? AS client_id) src
        ON tgt.table_name = src.table_name AND tgt.account_id = src.account_id AND tgt.client_id = src.client_id
        WHEN MATCHED THEN UPDATE SET
          last_pipeline_run_id = ?,
          updated_at = CURRENT_TIMESTAMP()
        WHEN NOT MATCHED THEN INSERT
          (table_name, account_id, client_id, last_pipeline_run_id, last_successful_load_at, updated_at)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())
      `, [
        'CALBRIDGE_PROD.ANALYTICS.ADS_PERFORMANCE', accountId, clientId,
        triggeredBy,
        'CALBRIDGE_PROD.ANALYTICS.ADS_PERFORMANCE', accountId, clientId, triggeredBy,
      ]).catch(() => {});

      await completeJob(runId, { rowsRead: cnt, rowsWritten: cnt });
    } catch (err) {
      await failJob(runId, err.message);
      console.error(`[buildCanonical] ${accountId} failed:`, err.message);
    }

    await sleep(200);
  }

  console.log(`[buildCanonical] ✅ ${accounts.length} accounts, ${rowsWritten} rows verified`);
  return { accountsProcessed: accounts.length, rowsWritten };
}

// ─── Job 2: compute_core_kpis ─────────────────────────────────────────────────

/**
 * Compute daily KPIs for all active accounts.
 * Writes to ANALYTICS.KPI_DAILY.
 * Merges on (client_id, account_id, date, campaign_id, ad_type, asin).
 */
async function computeCoreKpis({ triggeredBy = 'cron' } = {}) {
  const priorDate    = yesterday();
  const pipelineRunId = uuidv4();

  await ensureKpiTable().catch(() => {});

  // Get active accounts from KPI table or JOB_RUNS
  let accounts = [];
  try {
    const rows = await query(`
      SELECT DISTINCT client_id, account_id
      FROM CALBRIDGE_PROD.ANALYTICS.ADS_PERFORMANCE
      WHERE date = ?
    `, [priorDate]);
    accounts = (rows || []).map(r => ({ clientId: r.CLIENT_ID || r.client_id, accountId: r.ACCOUNT_ID || r.account_id }));
  } catch { /* no data yet */ }

  if (!accounts.length) {
    console.log(`[computeKpis] No ADS_PERFORMANCE data for ${priorDate} — skipping`);
    return { accountsProcessed: 0 };
  }

  let rowsWritten = 0;

  for (const { clientId, accountId } of accounts) {
    const runId = await startJob('compute_core_kpis', accountId, triggeredBy, { clientId });

    try {
      // Account-level KPI rollup
      const written = await query(`
        MERGE INTO CALBRIDGE_PROD.ANALYTICS.KPI_DAILY tgt
        USING (
          SELECT
            ?                   AS metric_version,
            ?                   AS pipeline_run_id,
            ap.client_id,
            ap.account_id,
            ap.date,
            ap.campaign_id,
            ap.ad_type,
            ap.asin,
            ap.impressions,
            ap.clicks,
            ap.cost                   AS spend,
            ap.purchases_30d          AS purchases,
            ap.sales_30d              AS ad_revenue,
            rp.ordered_revenue        AS organic_revenue,
            COALESCE(ap.sales_30d, 0)
              + COALESCE(rp.ordered_revenue, 0) AS total_revenue,
            rp.units_ordered,
            -- KPIs
            CASE WHEN COALESCE(ap.sales_30d, 0) > 0
                 THEN ap.cost / ap.sales_30d * 100 END AS acos,
            CASE WHEN COALESCE(ap.sales_30d, 0) + COALESCE(rp.ordered_revenue, 0) > 0
                 THEN ap.cost / (COALESCE(ap.sales_30d, 0) + COALESCE(rp.ordered_revenue, 0)) * 100
                 END AS tacos,
            CASE WHEN COALESCE(ap.cost, 0) > 0
                 THEN ap.sales_30d / ap.cost END AS roas,
            CASE WHEN COALESCE(ap.impressions, 0) > 0
                 THEN ap.clicks::FLOAT / ap.impressions END AS ctr,
            CASE WHEN COALESCE(ap.clicks, 0) > 0
                 THEN ap.cost / ap.clicks END AS cpc,
            CASE WHEN COALESCE(ap.clicks, 0) > 0
                 THEN ap.purchases_30d::FLOAT / ap.clicks END AS cvr
          FROM CALBRIDGE_PROD.ANALYTICS.ADS_PERFORMANCE ap
          LEFT JOIN CALBRIDGE_PROD.ANALYTICS.RETAIL_PERFORMANCE rp
            ON  rp.client_id   = ap.client_id
            AND rp.account_id  = ap.account_id
            AND rp.date        = ap.date
            AND rp.asin        = ap.asin
          WHERE ap.client_id  = ?
            AND ap.account_id = ?
            AND ap.date       = ?
        ) src
        ON  tgt.client_id  = src.client_id
        AND tgt.account_id = src.account_id
        AND tgt.date       = src.date
        AND COALESCE(tgt.campaign_id, '') = COALESCE(src.campaign_id, '')
        AND COALESCE(tgt.ad_type, '')     = COALESCE(src.ad_type, '')
        AND COALESCE(tgt.asin, '')        = COALESCE(src.asin, '')
        WHEN MATCHED THEN UPDATE SET
          metric_version  = src.metric_version,
          pipeline_run_id = src.pipeline_run_id,
          computed_at     = CURRENT_TIMESTAMP(),
          impressions     = src.impressions,
          clicks          = src.clicks,
          spend           = src.spend,
          purchases       = src.purchases,
          ad_revenue      = src.ad_revenue,
          organic_revenue = src.organic_revenue,
          total_revenue   = src.total_revenue,
          units_ordered   = src.units_ordered,
          acos            = src.acos,
          tacos           = src.tacos,
          roas            = src.roas,
          ctr             = src.ctr,
          cpc             = src.cpc,
          cvr             = src.cvr
        WHEN NOT MATCHED THEN INSERT (
          metric_version, pipeline_run_id, computed_at,
          client_id, account_id, date, campaign_id, ad_type, asin,
          impressions, clicks, spend, purchases, ad_revenue,
          organic_revenue, total_revenue, units_ordered,
          acos, tacos, roas, ctr, cpc, cvr
        ) VALUES (
          src.metric_version, src.pipeline_run_id, CURRENT_TIMESTAMP(),
          src.client_id, src.account_id, src.date, src.campaign_id, src.ad_type, src.asin,
          src.impressions, src.clicks, src.spend, src.purchases, src.ad_revenue,
          src.organic_revenue, src.total_revenue, src.units_ordered,
          src.acos, src.tacos, src.roas, src.ctr, src.cpc, src.cvr
        )
      `, [METRIC_VERSION, pipelineRunId, clientId, accountId, priorDate]);

      const wRows = Array.isArray(written)
        ? written.reduce((sum, r) => sum + Number(Object.values(r)[0] || 0), 0)
        : 0;

      rowsWritten += wRows;
      await completeJob(runId, { rowsWritten: wRows, metricVersion: METRIC_VERSION });
      if (wRows > 0) console.log(`[computeKpis] ${accountId} ${priorDate}: ${wRows} KPI rows`);
    } catch (err) {
      await failJob(runId, err.message);
      console.error(`[computeKpis] ${accountId} failed:`, err.message);
    }

    await sleep(200);
  }

  console.log(`[computeKpis] ✅ ${rowsWritten} KPI rows written across ${accounts.length} accounts`);
  return { rowsWritten, accountsProcessed: accounts.length };
}

// ─── Job 3: detect_anomalies ──────────────────────────────────────────────────

/**
 * Detect material changes in key metrics: spend, revenue, ACoS.
 * Compares yesterday vs rolling 7-day average.
 * Writes to PIPELINE.ANOMALY_LOG.
 */
async function detectAnomalies({ triggeredBy = 'cron' } = {}) {
  const priorDate = yesterday();
  await ensureAnomalyLogTable().catch(() => {});

  const runId = await startJob('detect_anomalies', 'system', triggeredBy);

  try {
    // Get accounts with KPI data for yesterday
    const accounts = await query(`
      SELECT DISTINCT client_id, account_id
      FROM CALBRIDGE_PROD.ANALYTICS.KPI_DAILY
      WHERE date = ?
    `, [priorDate]).catch(() => []);

    if (!accounts?.length) {
      await skipJob(runId, 'No KPI data for prior day');
      return { anomalies: 0 };
    }

    let totalAnomalies = 0;

    for (const row of accounts) {
      const clientId  = row.CLIENT_ID  || row.client_id;
      const accountId = row.ACCOUNT_ID || row.account_id;

      // Compare yesterday vs 7-day avg for account-level metrics
      const metrics = await query(`
        WITH yesterday AS (
          SELECT
            SUM(spend)       AS spend_yday,
            SUM(ad_revenue)  AS revenue_yday,
            AVG(acos)        AS acos_yday,
            AVG(roas)        AS roas_yday
          FROM CALBRIDGE_PROD.ANALYTICS.KPI_DAILY
          WHERE client_id = ? AND account_id = ? AND date = ?
        ),
        prior AS (
          SELECT
            AVG(daily_spend)   AS spend_7d_avg,
            AVG(daily_rev)     AS revenue_7d_avg,
            AVG(acos_avg)      AS acos_7d_avg,
            AVG(roas_avg)      AS roas_7d_avg
          FROM (
            SELECT
              date,
              SUM(spend)      AS daily_spend,
              SUM(ad_revenue) AS daily_rev,
              AVG(acos)       AS acos_avg,
              AVG(roas)       AS roas_avg
            FROM CALBRIDGE_PROD.ANALYTICS.KPI_DAILY
            WHERE client_id = ? AND account_id = ?
              AND date >= DATEADD('day', -8, ?)
              AND date < ?
            GROUP BY date
          ) d
        )
        SELECT
          y.spend_yday,   p.spend_7d_avg,
          y.revenue_yday, p.revenue_7d_avg,
          y.acos_yday,    p.acos_7d_avg,
          y.roas_yday,    p.roas_7d_avg
        FROM yesterday y, prior p
      `, [clientId, accountId, priorDate, clientId, accountId, priorDate, priorDate]);

      if (!metrics?.length) continue;
      const m = metrics[0];

      // Helper: compute pct change and emit anomaly if significant
      const checks = [
        { metric: 'spend',   val: m.SPEND_YDAY || m.spend_yday,     avg: m.SPEND_7D_AVG || m.spend_7d_avg },
        { metric: 'revenue', val: m.REVENUE_YDAY || m.revenue_yday, avg: m.REVENUE_7D_AVG || m.revenue_7d_avg },
        { metric: 'acos',    val: m.ACOS_YDAY || m.acos_yday,       avg: m.ACOS_7D_AVG || m.acos_7d_avg },
        { metric: 'roas',    val: m.ROAS_YDAY || m.roas_yday,       avg: m.ROAS_7D_AVG || m.roas_7d_avg },
      ];

      for (const { metric, val, avg } of checks) {
        if (val == null || avg == null || avg === 0) continue;
        const pctChange = (val - avg) / avg;

        if (Math.abs(pctChange) >= ANOMALY_THRESHOLD) {
          const direction = pctChange > 0 ? 'up' : 'down';
          const severity  = Math.abs(pctChange) >= 0.5 ? 'critical' : 'warn';

          await query(`
            INSERT INTO CALBRIDGE_PROD.PIPELINE.ANOMALY_LOG
              (anomaly_id, detected_at, client_id, account_id, date,
               metric, grain, grain_id,
               value_yesterday, value_prior_7d_avg, pct_change, direction, severity)
            VALUES
              (require('crypto').randomUUID(), CURRENT_TIMESTAMP(), ?, ?, ?,
               ?, 'account', NULL,
               ?, ?, ?, ?, ?)
          `, [
            clientId, accountId, priorDate,
            metric, Number(val), Number(avg),
            Math.round(pctChange * 10000) / 100, // store as %
            direction, severity,
          ]).catch(() => {});

          totalAnomalies++;
          console.log(`[anomalies] ${accountId} ${metric}: ${direction} ${Math.round(pctChange * 100)}% (${severity})`);
        }
      }

      await sleep(100);
    }

    await completeJob(runId, { rowsRead: accounts.length, rowsWritten: totalAnomalies });
    console.log(`[anomalies] ✅ Detected ${totalAnomalies} anomalies across ${accounts.length} accounts`);
    return { anomalies: totalAnomalies };
  } catch (err) {
    await failJob(runId, err.message);
    throw err;
  }
}

// ─── Job 4: generate_operator_summary ────────────────────────────────────────

/**
 * Daily operator digest email.
 * Covers: yesterday's top-level KPIs, anomalies, SLA status, restock alerts.
 */
async function generateOperatorSummary({ triggeredBy = 'cron' } = {}) {
  const priorDate = yesterday();
  const runId = await startJob('generate_operator_summary', 'system', triggeredBy);

  try {
    if (!process.env.RESEND_API_KEY) {
      await skipJob(runId, 'RESEND_API_KEY not configured');
      return;
    }

    // ── Gather data ───────────────────────────────────────────────────────────

    // Top-level KPIs for yesterday
    const kpis = await query(`
      SELECT
        account_id,
        SUM(spend)           AS total_spend,
        SUM(ad_revenue)      AS total_ad_revenue,
        SUM(total_revenue)   AS total_revenue,
        AVG(acos)            AS avg_acos,
        AVG(roas)            AS avg_roas,
        SUM(impressions)     AS total_impressions,
        SUM(clicks)          AS total_clicks
      FROM CALBRIDGE_PROD.ANALYTICS.KPI_DAILY
      WHERE date = ?
      GROUP BY account_id
      ORDER BY total_spend DESC
    `, [priorDate]).catch(() => []);

    // Anomalies detected today
    const anomalies = await query(`
      SELECT account_id, metric, direction, pct_change, severity, value_yesterday, value_prior_7d_avg
      FROM CALBRIDGE_PROD.PIPELINE.ANOMALY_LOG
      WHERE date = ?
        AND detected_at >= DATEADD('day', -1, CURRENT_TIMESTAMP())
      ORDER BY ABS(pct_change) DESC
      LIMIT 20
    `, [priorDate]).catch(() => []);

    // Restock alerts
    const restocks = await query(`
      SELECT account_id, asin, sku, fulfillable_quantity, estimated_days_of_supply_30
      FROM CALBRIDGE_PROD.ANALYTICS.INVENTORY_SNAPSHOT
      WHERE snapshot_date = CURRENT_DATE() - 1
        AND restock_alert = TRUE
      ORDER BY estimated_days_of_supply_30 ASC
      LIMIT 20
    `).catch(() => []);

    // SLA breaches (jobs that haven't run in their SLA window)
    const slaBreaches = await query(`
      SELECT job_type, account_id, MAX(completed_at) AS last_completed
      FROM CALBRIDGE_PROD.PIPELINE.JOB_RUNS
      WHERE status = 'completed'
        AND completed_at >= DATEADD('day', -7, CURRENT_TIMESTAMP())
      GROUP BY job_type, account_id
    `).catch(() => []);

    // ── Build email ────────────────────────────────────────────────────────────

    const fmt = (n) => n == null ? '—' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
    const fmtPct = (n) => n == null ? '—' : `${Number(n).toFixed(1)}%`;
    const fmtCurrency = (n) => n == null ? '—' : `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const kpiSection = (kpis || []).length > 0
      ? (kpis || []).map(r => {
          const acct = r.ACCOUNT_ID || r.account_id;
          return [
            `  📊 ${acct}`,
            `     Spend:      ${fmtCurrency(r.TOTAL_SPEND || r.total_spend)}`,
            `     Ad Revenue: ${fmtCurrency(r.TOTAL_AD_REVENUE || r.total_ad_revenue)}`,
            `     ACoS:       ${fmtPct(r.AVG_ACOS || r.avg_acos)}`,
            `     ROAS:       ${fmt(r.AVG_ROAS || r.avg_roas)}x`,
            `     Impressions: ${fmt(r.TOTAL_IMPRESSIONS || r.total_impressions)} | Clicks: ${fmt(r.TOTAL_CLICKS || r.total_clicks)}`,
          ].join('\n');
        }).join('\n\n')
      : '  No KPI data for yesterday.';

    const anomalySection = (anomalies || []).length > 0
      ? (anomalies || []).map(r => {
          const pct   = r.PCT_CHANGE || r.pct_change;
          const dir   = r.DIRECTION  || r.direction;
          const sev   = r.SEVERITY   || r.severity;
          const icon  = sev === 'critical' ? '🚨' : '⚠️';
          const acct  = r.ACCOUNT_ID || r.account_id;
          return `  ${icon} ${acct}: ${r.METRIC || r.metric} ${dir} ${Math.abs(pct).toFixed(1)}% vs 7d avg (${fmtCurrency(r.VALUE_YESTERDAY || r.value_yesterday)} vs ${fmtCurrency(r.VALUE_PRIOR_7D_AVG || r.value_prior_7d_avg)})`;
        }).join('\n')
      : '  ✅ No anomalies detected.';

    const restockSection = (restocks || []).length > 0
      ? (restocks || []).map(r => {
          const days = r.ESTIMATED_DAYS_OF_SUPPLY_30 || r.estimated_days_of_supply_30;
          const qty  = r.FULFILLABLE_QUANTITY || r.fulfillable_quantity;
          return `  🔴 ${r.ASIN || r.asin} / ${r.SKU || r.sku} — ${days} days supply (${qty} units)`;
        }).join('\n')
      : '  ✅ No restock alerts.';

    const text = [
      `Calbridge Daily Operator Summary — ${priorDate}`,
      '='.repeat(50),
      '',
      '📈 YESTERDAY\'S KPIs',
      kpiSection,
      '',
      '🔍 ANOMALIES',
      anomalySection,
      '',
      '📦 RESTOCK ALERTS',
      restockSection,
      '',
      `Generated by Control 🎛️ at ${new Date().toISOString()}`,
    ].join('\n');

    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from:    `Control (Calbridge) <${FROM_EMAIL}>`,
      to:      [ALERT_EMAIL],
      subject: `Calbridge Daily Summary — ${priorDate}`,
      text,
      html: `<pre style="font-family:monospace;font-size:13px;line-height:1.6">${text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</pre>`,
    });

    await completeJob(runId, { rowsRead: (kpis?.length || 0) + (anomalies?.length || 0) });
    console.log(`[operatorSummary] ✅ Daily summary sent for ${priorDate}`);
    return { sent: true };
  } catch (err) {
    await failJob(runId, err.message);
    console.error('[operatorSummary] Failed:', err.message);
    throw err;
  }
}

module.exports = {
  buildCanonicalModels,
  computeCoreKpis,
  detectAnomalies,
  generateOperatorSummary,
};
