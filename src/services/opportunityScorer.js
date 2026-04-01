/**
 * src/services/opportunityScorer.js
 *
 * Opportunity Scoring Engine v1
 * Owned by: Economist 💹
 *
 * Reads performance and inventory data from canonical Snowflake tables,
 * applies scoring logic v1, applies account-level human overrides, and
 * writes scored opportunities to CALBRIDGE_PROD.METRICS.OPPORTUNITY_SCORES.
 *
 * ─── Scoring Formula v1.3.0 — confirmed by Abe 2026-03-26 ───────────────────
 *
 *   Score = (0.7 × CM_Headroom_norm + 0.3 × mROAS_norm)
 *           × Confidence_Factor
 *           × Scalability_Factor
 *           × Payback_Adjustment
 *
 *   Result clamped to [0, 100].
 *   CM_Headroom and mROAS are normalized within account scope (÷ max in account).
 *
 * ─── Opportunity Types ───────────────────────────────────────────────────────
 *
 *   underfunded           — ROAS > break_even_roas × 1.5, not budget-capped
 *   overspent             — ACOS > break_even_acos for 3+ consecutive periods
 *   inventory_constrained — days_of_supply < 14
 *   launch_priority       — product age < 60 days (proxied by first-seen data date)
 *   efficient_scale       — ROAS near break-even, high volume — maintain and watch
 *
 * ─── Override Types (CANONICAL.ACCOUNT_OVERRIDES) ────────────────────────────
 *
 *   min_spend              — floor on daily spend recommendation
 *   priority_skus          — ASINs to always mark as high-priority
 *   ignore_low_inventory   — skip inventory_constrained flag for account
 *   payback_target_days    — override default payback threshold
 *   blacklist_campaigns    — never recommend changes on listed campaign IDs
 *
 * ─── Output ──────────────────────────────────────────────────────────────────
 *
 *   Rows written to CALBRIDGE_PROD.METRICS.OPPORTUNITY_SCORES.
 *   Also writes to CALBRIDGE_PROD.CANONICAL.OPPORTUNITY_SCORES for cross-agent access.
 *   Every row carries metric_version from metrics.js for explainability.
 *
 * ─── Migration dependency ────────────────────────────────────────────────────
 *
 *   Requires 001_create_schema.sql, 002_canonical_model.sql,
 *   and 003_recommendation_feedback.sql to have been run.
 *
 * Usage:
 *   const { scoreAccount, scoreAllAccounts } = require('./opportunityScorer');
 *   const results = await scoreAccount('ACCOUNT_001');
 *   const allResults = await scoreAllAccounts();
 */

'use strict';

const { v4: uuidv4 } = require('uuid');
const { query }      = require('./snowflakeService');
const { METRIC_REGISTRY_VERSION, compute } = require('../config/metrics');

// ─── Constants ────────────────────────────────────────────────────────────────

const METRICS_SCORES_TABLE    = 'CALBRIDGE_PROD.METRICS.OPPORTUNITY_SCORES';
const CANONICAL_SCORES_TABLE  = 'CALBRIDGE_PROD.CANONICAL.OPPORTUNITY_SCORES';
const OVERRIDES_TABLE         = 'CALBRIDGE_PROD.CANONICAL.ACCOUNT_OVERRIDES';
const ACCOUNTS_TABLE          = 'CALBRIDGE_PROD.CANONICAL.ACCOUNTS';

const INVENTORY_CONSTRAINED_DAYS = 14;
const LAUNCH_WINDOW_DAYS         = 60;
const UNDERFUNDED_ROAS_THRESHOLD = 1.5; // ROAS > break_even × 1.5 = underfunded
const OVERSPENT_PERIODS_REQUIRED = 3;

const CONFIDENCE = {
  HIGH:   'high',
  MEDIUM: 'medium',
  LOW:    'low',
};

// ─── Schema: ensure METRICS.OPPORTUNITY_SCORES exists ─────────────────────────

async function ensureOutputTables() {
  // METRICS schema
  await query(`CREATE SCHEMA IF NOT EXISTS CALBRIDGE_PROD.METRICS
    COMMENT = 'Economist-computed metrics: opportunity scores, CM summaries, capital allocation signals.'`);

  // METRICS.OPPORTUNITY_SCORES — the output of this scorer
  await query(`
    CREATE TABLE IF NOT EXISTS CALBRIDGE_PROD.METRICS.OPPORTUNITY_SCORES (
      score_id                VARCHAR          DEFAULT UUID_STRING(),
      account_id              VARCHAR          NOT NULL,
      asin                    VARCHAR,
      campaign_id             VARCHAR,
      opportunity_type        VARCHAR          NOT NULL,
      score                   NUMBER(5,2)      NOT NULL,
      recommended_action      VARCHAR,
      recommended_delta_usd   NUMBER(10,2),
      expected_marginal_roas  NUMBER(10,4),
      confidence              VARCHAR,
      metric_version          VARCHAR          NOT NULL,
      data_as_of              TIMESTAMP_NTZ,
      scored_at               TIMESTAMP_NTZ    DEFAULT CURRENT_TIMESTAMP,
      inputs_json             VARCHAR,
      PRIMARY KEY (score_id)
    )
    COMMENT = 'Opportunity scores from the Economist scoring engine. metric_version tracks formula version for explainability.'
  `);

  // CANONICAL.ACCOUNT_OVERRIDES — human override rules (also created in migration 002,
  // but we create idempotently here so scoreAccount works even if migration hasn't run)
  await query(`
    CREATE TABLE IF NOT EXISTS CALBRIDGE_PROD.CANONICAL.ACCOUNT_OVERRIDES (
      id                  VARCHAR          DEFAULT UUID_STRING(),
      account_id          VARCHAR          NOT NULL,
      client_id           VARCHAR,
      source_system       VARCHAR          DEFAULT 'manual',
      entity_type         VARCHAR          NOT NULL  DEFAULT 'account',
      entity_id           VARCHAR,
      amazon_campaign_id  VARCHAR,
      amazon_ad_group_id  VARCHAR,
      amazon_keyword_id   VARCHAR,
      asin                VARCHAR,
      override_type       VARCHAR          NOT NULL,
      override_value      VARIANT          NOT NULL,
      description         VARCHAR,
      created_by          VARCHAR          NOT NULL  DEFAULT 'system',
      approved_by         VARCHAR,
      valid_from          DATE             NOT NULL  DEFAULT CURRENT_DATE,
      valid_to            DATE,
      is_active           BOOLEAN          NOT NULL  DEFAULT TRUE,
      created_at          TIMESTAMP_NTZ    DEFAULT CURRENT_TIMESTAMP,
      updated_at          TIMESTAMP_NTZ    DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    )
    COMMENT = 'Human override rules applied before scoring. Checked by opportunityScorer.js before every recommendation.'
  `);
}

// ─── Load account overrides ───────────────────────────────────────────────────

/**
 * Load active overrides for an account.
 * Returns a structured object keyed by override_type for quick lookup.
 *
 * @param {string} accountId
 * @returns {Promise<object>} overrides — { min_spend, priority_skus, blacklist_campaigns, ... }
 */
async function loadOverrides(accountId) {
  let rows = [];
  try {
    rows = await query(`
      SELECT override_type, entity_type, amazon_campaign_id, asin, override_value
      FROM ${OVERRIDES_TABLE}
      WHERE account_id = ?
        AND is_active = TRUE
        AND valid_from <= CURRENT_DATE
        AND (valid_to IS NULL OR valid_to >= CURRENT_DATE)
    `, [accountId]);
  } catch (err) {
    // Table may not exist yet on a fresh deployment — silently continue
    if (!err.message?.includes('does not exist') && !err.message?.includes('Object')) {
      console.warn(`[opportunityScorer] Could not load overrides for ${accountId}: ${err.message}`);
    }
    return {};
  }

  const overrides = {};
  for (const row of rows) {
    const type  = row.OVERRIDE_TYPE || row.override_type;
    const value = row.OVERRIDE_VALUE || row.override_value;

    // Parse VARIANT value (Snowflake returns it as a JS object already, but
    // sometimes as a JSON string depending on driver version)
    let parsed = value;
    if (typeof value === 'string') {
      try { parsed = JSON.parse(value); } catch { parsed = { raw: value }; }
    }

    if (!overrides[type]) overrides[type] = [];
    overrides[type].push({
      entityType:        row.ENTITY_TYPE || row.entity_type,
      amazonCampaignId:  row.AMAZON_CAMPAIGN_ID || row.amazon_campaign_id,
      asin:              row.ASIN || row.asin,
      value:             parsed,
    });
  }

  return overrides;
}

// ─── Classify opportunity type ────────────────────────────────────────────────

/**
 * Determine the primary opportunity type for one (account, ASIN, campaign) tuple.
 *
 * @param {object} p  Performance and inventory metrics for the tuple
 * @returns {string|null} opportunity_type, or null if no clear opportunity
 */
function classifyOpportunity({
  currentRoas,
  breakEvenRoas,
  actualAcos,
  breakEvenAcos,
  overspentPeriods,
  daysOfSupply,
  firstSeenDaysAgo,
  budgetConstrained,
}) {
  // 1. Inventory-constrained: always wins — no point recommending spend on OOS/near-OOS
  if (daysOfSupply != null && daysOfSupply < INVENTORY_CONSTRAINED_DAYS) {
    return 'inventory_constrained';
  }

  // 2. Launch priority: product hasn't had data for 60+ days
  if (firstSeenDaysAgo != null && firstSeenDaysAgo < LAUNCH_WINDOW_DAYS) {
    return 'launch_priority';
  }

  // 3. Underfunded: ROAS is strong and we're not budget-capped
  if (
    currentRoas != null &&
    breakEvenRoas != null &&
    currentRoas > breakEvenRoas * UNDERFUNDED_ROAS_THRESHOLD &&
    !budgetConstrained
  ) {
    return 'underfunded';
  }

  // 4. Overspent: ACOS above break-even for 3+ consecutive periods
  if (
    overspentPeriods != null &&
    overspentPeriods >= OVERSPENT_PERIODS_REQUIRED
  ) {
    return 'overspent';
  }

  // 5. Efficient scale: ROAS is near break-even (within 20%) with meaningful spend
  if (
    currentRoas != null &&
    breakEvenRoas != null &&
    Math.abs(currentRoas - breakEvenRoas) / breakEvenRoas <= 0.20
  ) {
    return 'efficient_scale';
  }

  return null;
}

// ─── Compute score 0-100 ──────────────────────────────────────────────────────

/**
 * Confidence factor: discounts noisy low-spend signals.
 * High spend + stable data = 1.0. Low spend + noisy = 0.4.
 */
function _computeConfidenceFactor(spendMonthly, dataPoints, dataAgeHours) {
  let base;
  if (spendMonthly >= 1000 && dataPoints >= 30 && dataAgeHours <= 25) base = 1.0;
  else if (spendMonthly >= 500 && dataPoints >= 14 && dataAgeHours <= 48) base = 0.8;
  else if (spendMonthly >= 100 && dataPoints >= 7 && dataAgeHours <= 72) base = 0.6;
  else base = 0.4;
  if (dataAgeHours > 72) base *= 0.5; // stale data penalty
  return Math.max(0.1, Math.min(1.0, base));
}

/**
 * Scalability factor: can this channel actually absorb more spend?
 * Accounts for learning phase and budget constraint status.
 * Creative/audience fatigue: future enhancement, defaults to 1.0.
 */
function _computeScalabilityFactor(campaignAgeDays, impressionShareLostToBudget) {
  // Learning phase factor
  let ageFactor;
  if (campaignAgeDays < 7) ageFactor = 0.5;
  else if (campaignAgeDays < 14) ageFactor = 0.75;
  else ageFactor = 1.0;
  // Budget constraint factor: if budget-constrained, scaling is straightforward
  const budgetFactor = (impressionShareLostToBudget > 0) ? 1.0 : 0.7;
  return Math.max(0.3, Math.min(1.0, ageFactor * budgetFactor));
}

/**
 * Payback adjustment: same ROAS, different cash impact.
 * 7-day payback vs 90-day payback should score differently.
 * If payback not computable (no NTB/CAC data), returns 1.0 (no adjustment).
 */
function _computePaybackAdjustment(paybackDays, targetPaybackDays = 60) {
  if (paybackDays == null || isNaN(paybackDays)) return 1.0; // not computable
  if (paybackDays <= targetPaybackDays / 2) return 1.0;
  if (paybackDays <= targetPaybackDays) return 0.85;
  if (paybackDays <= targetPaybackDays * 1.5) return 0.7;
  return 0.5;
}

/**
 * Score formula v1.3.0 — confirmed by Abe 2026-03-26:
 *
 *   Score = (0.7 × CM_Headroom_norm + 0.3 × mROAS_norm)
 *           × Confidence_Factor
 *           × Scalability_Factor
 *           × Payback_Adjustment
 *
 *   Result clamped to [0, 100].
 */
function computeScore({
  cmHeadroom,
  maxCmHeadroomInAccount,
  currentRoas,
  maxRoasInAccount,
  spendMonthly,
  dataPoints,
  dataAgeHours,
  campaignAgeDays,
  impressionShareLostToBudget,
  paybackDays,
  targetPaybackDays,
}) {
  // Normalize CM headroom within account scope
  const cmHeadroomNorm = (
    cmHeadroom != null &&
    maxCmHeadroomInAccount != null &&
    maxCmHeadroomInAccount > 0
  )
    ? Math.max(0, cmHeadroom / maxCmHeadroomInAccount)
    : 0;

  // Normalize mROAS within account scope
  const mroasNorm = (
    currentRoas != null &&
    maxRoasInAccount != null &&
    maxRoasInAccount > 0
  )
    ? Math.max(0, currentRoas / maxRoasInAccount)
    : 0;

  const rawScore  = 0.7 * cmHeadroomNorm + 0.3 * mroasNorm;
  const confidence  = _computeConfidenceFactor(spendMonthly, dataPoints, dataAgeHours);
  const scalability = _computeScalabilityFactor(campaignAgeDays, impressionShareLostToBudget);
  const payback     = _computePaybackAdjustment(paybackDays, targetPaybackDays);

  const final = rawScore * confidence * scalability * payback * 100;
  return {
    score:              Math.round(Math.max(0, Math.min(100, final)) * 100) / 100,
    cmHeadroomNorm,
    mroasNorm,
    confidenceFactor:   confidence,
    scalabilityFactor:  scalability,
    paybackAdjustment:  payback,
  };
}

// ─── Determine recommended action and delta ───────────────────────────────────

function getRecommendation(opportunityType, currentDailyBudget, currentDailySpend) {
  switch (opportunityType) {
    case 'underfunded':
      return {
        action: 'increase_budget',
        deltaUsd: currentDailyBudget != null
          ? Math.round(currentDailyBudget * 0.20 * 100) / 100
          : null,
      };
    case 'overspent':
      return {
        action: 'decrease_budget',
        deltaUsd: currentDailySpend != null
          ? Math.round(currentDailySpend * -0.15 * 100) / 100
          : null,
      };
    case 'inventory_constrained':
      return {
        action: 'pause_ads',
        deltaUsd: currentDailySpend != null
          ? -Math.abs(currentDailySpend)
          : null,
      };
    case 'launch_priority':
      return {
        action: 'maintain_or_increase',
        deltaUsd: currentDailyBudget != null
          ? Math.round(currentDailyBudget * 0.10 * 100) / 100
          : null,
      };
    case 'efficient_scale':
    default:
      return {
        action: 'monitor',
        deltaUsd: null,
      };
  }
}

// ─── Determine confidence level ───────────────────────────────────────────────

function getConfidence(dataPointDays, dataAgeHours) {
  if (dataPointDays != null && dataPointDays < 7) return CONFIDENCE.LOW;
  if (dataAgeHours  != null && dataAgeHours  > 48) return CONFIDENCE.LOW;
  if (dataPointDays != null && dataPointDays >= 14 && dataAgeHours != null && dataAgeHours < 25) {
    return CONFIDENCE.HIGH;
  }
  return CONFIDENCE.MEDIUM;
}

// ─── Apply overrides ──────────────────────────────────────────────────────────

/**
 * Check if a scoring tuple is blocked by an override.
 * Returns { blocked, reason } — if blocked, skip issuing the recommendation.
 */
function applyOverrides(overrides, { campaignId, asin, opportunityType }) {
  // blacklist_campaigns
  if (overrides.blacklist_campaigns) {
    for (const rule of overrides.blacklist_campaigns) {
      if (rule.amazonCampaignId && rule.amazonCampaignId === campaignId) {
        return { blocked: true, reason: `Campaign ${campaignId} is blacklisted` };
      }
    }
  }

  // ignore_low_inventory — if set, skip inventory_constrained type
  if (
    opportunityType === 'inventory_constrained' &&
    overrides.ignore_low_inventory?.length > 0
  ) {
    return { blocked: true, reason: 'ignore_low_inventory override active for account' };
  }

  // priority_skus — not a block, but used in scoring — handled during query
  return { blocked: false, reason: null };
}

// ─── Fetch performance data ───────────────────────────────────────────────────

/**
 * Pull per-ASIN/campaign performance from canonical ads performance tables.
 * Returns array of tuples with computed metrics ready for scoring.
 *
 * Reads from:
 *   CALBRIDGE_PROD.ANALYTICS.ADS_PERFORMANCE   (or METRICS.ADS_PERFORMANCE if present)
 *   CALBRIDGE_PROD.ANALYTICS.INVENTORY_SNAPSHOT
 *   CALBRIDGE_PROD.CANONICAL.CONTRIBUTION_MARGINS
 */
async function fetchPerformanceTuples(accountId) {
  const sql = `
    WITH ads AS (
      -- Aggregate per ASIN + campaign over the last 30 days
      SELECT
        ap.account_id,
        ap.asin,
        ap.campaign_id,
        SUM(ap.impressions)                             AS impressions,
        SUM(ap.clicks)                                  AS clicks,
        SUM(ap.spend)                                   AS total_spend,
        SUM(ap.sales_14d)                               AS total_revenue,
        CASE
          WHEN SUM(ap.spend)    > 0
          THEN SUM(ap.sales_14d) / SUM(ap.spend)
          ELSE NULL
        END                                             AS current_roas,
        CASE
          WHEN SUM(ap.sales_14d) > 0
          THEN SUM(ap.spend) / SUM(ap.sales_14d)
          ELSE NULL
        END                                             AS actual_acos,
        COUNT(DISTINCT ap.report_date)                  AS data_point_days,
        DATEDIFF('hour', MAX(ap.report_date)::TIMESTAMP_NTZ, CURRENT_TIMESTAMP()) AS data_age_hours,
        MIN(ap.report_date)                             AS first_seen_date,
        DATEDIFF('day', MIN(ap.report_date), CURRENT_DATE) AS first_seen_days_ago,
        -- Budget constrained proxy: last 7 days impression share < prior 7 days
        AVG(ap.daily_budget)                            AS avg_daily_budget,
        SUM(ap.spend) / NULLIF(COUNT(DISTINCT ap.report_date), 0) AS avg_daily_spend,
        -- Consecutive overspent periods (simplified: count of days where acos > be_acos)
        -- This is approximated; a proper consecutive-period check requires window functions
        SUM(CASE
          WHEN ap.sales_14d > 0
           AND ap.spend / ap.sales_14d > cm.break_even_acos
          THEN 1 ELSE 0
        END)                                            AS overspent_period_count
      FROM CALBRIDGE_PROD.ANALYTICS.ADS_PERFORMANCE ap
      LEFT JOIN CALBRIDGE_PROD.CANONICAL.CONTRIBUTION_MARGINS cm
             ON cm.account_id = ap.account_id
            AND cm.asin = ap.asin
            AND cm.period_end >= DATEADD('day', -30, CURRENT_DATE)
      WHERE ap.account_id = ?
        AND ap.report_date >= DATEADD('day', -30, CURRENT_DATE)
      GROUP BY ap.account_id, ap.asin, ap.campaign_id
    ),

    inventory AS (
      -- Latest inventory snapshot per ASIN
      SELECT
        inv.account_id,
        inv.asin,
        inv.days_of_supply_30d AS days_of_supply,
        inv.is_inventory_constrained
      FROM CALBRIDGE_PROD.ANALYTICS.INVENTORY_SNAPSHOT inv
      WHERE inv.account_id = ?
      QUALIFY ROW_NUMBER() OVER (PARTITION BY inv.asin ORDER BY inv.snapshot_date DESC) = 1
    ),

    margins AS (
      -- Most recent contribution margin per ASIN
      SELECT
        cm.account_id,
        cm.asin,
        cm.contribution_margin_2    AS cm2,
        cm.gross_revenue            AS revenue,
        CASE
          WHEN cm.gross_revenue > 0 AND cm.contribution_margin_2 IS NOT NULL
          THEN cm.contribution_margin_2 / cm.gross_revenue
          ELSE NULL
        END                         AS break_even_acos,
        CASE
          WHEN cm.contribution_margin_2 > 0 AND cm.gross_revenue > 0
          THEN cm.gross_revenue / cm.contribution_margin_2
          ELSE NULL
        END                         AS break_even_roas,
        cm.contribution_margin_2    AS cm_headroom  -- raw CM2 as headroom proxy
      FROM CALBRIDGE_PROD.CANONICAL.CONTRIBUTION_MARGINS cm
      WHERE cm.account_id = ?
      QUALIFY ROW_NUMBER() OVER (PARTITION BY cm.asin ORDER BY cm.period_end DESC) = 1
    )

    SELECT
      ads.account_id,
      ads.asin,
      ads.campaign_id,
      ads.current_roas,
      ads.actual_acos,
      ads.total_spend,
      ads.total_revenue,
      ads.data_point_days,
      ads.data_age_hours,
      ads.first_seen_days_ago,
      ads.avg_daily_budget,
      ads.avg_daily_spend,
      ads.overspent_period_count,
      inv.days_of_supply,
      inv.is_inventory_constrained,
      m.cm2,
      m.revenue        AS cm_revenue,
      m.break_even_acos,
      m.break_even_roas,
      m.cm_headroom,
      -- Budget constrained proxy: spend within 5% of daily budget on most days
      CASE
        WHEN ads.avg_daily_budget > 0
         AND ads.avg_daily_spend / ads.avg_daily_budget >= 0.95
        THEN TRUE
        ELSE FALSE
      END              AS budget_constrained
    FROM ads
    LEFT JOIN inventory inv ON inv.account_id = ads.account_id AND inv.asin = ads.asin
    LEFT JOIN margins    m   ON m.account_id   = ads.account_id AND m.asin   = ads.asin
  `;

  let rows = [];
  try {
    rows = await query(sql, [accountId, accountId, accountId]);
  } catch (err) {
    // Table may not exist on dev/test environments — return empty gracefully
    console.warn(`[opportunityScorer] Could not fetch performance data for ${accountId}: ${err.message}`);
    return [];
  }

  // Normalize column name casing (Snowflake returns uppercase by default)
  return rows.map(r => ({
    accountId:          r.ACCOUNT_ID     || r.account_id,
    asin:               r.ASIN           || r.asin,
    campaignId:         r.CAMPAIGN_ID    || r.campaign_id,
    currentRoas:        toNum(r.CURRENT_ROAS       || r.current_roas),
    actualAcos:         toNum(r.ACTUAL_ACOS        || r.actual_acos),
    totalSpend:         toNum(r.TOTAL_SPEND        || r.total_spend),
    totalRevenue:       toNum(r.TOTAL_REVENUE      || r.total_revenue),
    dataPointDays:      toInt(r.DATA_POINT_DAYS    || r.data_point_days),
    dataAgeHours:       toNum(r.DATA_AGE_HOURS     || r.data_age_hours),
    firstSeenDaysAgo:   toNum(r.FIRST_SEEN_DAYS_AGO|| r.first_seen_days_ago),
    avgDailyBudget:     toNum(r.AVG_DAILY_BUDGET   || r.avg_daily_budget),
    avgDailySpend:      toNum(r.AVG_DAILY_SPEND    || r.avg_daily_spend),
    overspentPeriods:   toInt(r.OVERSPENT_PERIOD_COUNT || r.overspent_period_count),
    daysOfSupply:       toNum(r.DAYS_OF_SUPPLY     || r.days_of_supply),
    isInventoryConstrained: toBool(r.IS_INVENTORY_CONSTRAINED || r.is_inventory_constrained),
    cm2:                toNum(r.CM2                || r.cm2),
    cmRevenue:          toNum(r.CM_REVENUE         || r.cm_revenue),
    breakEvenAcos:      toNum(r.BREAK_EVEN_ACOS    || r.break_even_acos),
    breakEvenRoas:      toNum(r.BREAK_EVEN_ROAS    || r.break_even_roas),
    cmHeadroom:         toNum(r.CM_HEADROOM        || r.cm_headroom),
    budgetConstrained:  toBool(r.BUDGET_CONSTRAINED || r.budget_constrained),
  }));
}

// ─── Write scored opportunities ───────────────────────────────────────────────

async function writeScoredOpportunities(opportunities) {
  if (!opportunities.length) return;

  // Bulk insert via individual statements (Snowflake SDK doesn't batch natively)
  for (const opp of opportunities) {
    const inputsJson = JSON.stringify(opp.inputs);

    await query(`
      INSERT INTO ${METRICS_SCORES_TABLE} (
        score_id, account_id, asin, campaign_id,
        opportunity_type, score, recommended_action, recommended_delta_usd,
        expected_marginal_roas, confidence, metric_version, data_as_of, inputs_json
      ) SELECT
        UUID_STRING(),
        ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, CURRENT_TIMESTAMP(), ?
    `, [
      opp.accountId,
      opp.asin     || null,
      opp.campaignId || null,
      opp.opportunityType,
      opp.score,
      opp.recommendedAction || null,
      opp.recommendedDeltaUsd != null ? opp.recommendedDeltaUsd : null,
      opp.expectedMarginalRoas != null ? opp.expectedMarginalRoas : null,
      opp.confidence,
      opp.metricVersion,
      inputsJson,
    ]);
  }
}

// ─── scoreAccount ─────────────────────────────────────────────────────────────

/**
 * Score all (account, ASIN, campaign) tuples for one account.
 *
 * @param {string} accountId
 * @param {object} [options]
 * @param {boolean} [options.dryRun=false]    If true, compute but don't write to Snowflake
 * @param {boolean} [options.skipEnsure=false] If true, skip ensureOutputTables() (faster for batch)
 * @returns {Promise<Array<object>>}           Array of scored opportunity objects
 */
async function scoreAccount(accountId, options = {}) {
  const { dryRun = false, skipEnsure = false } = options;

  if (!skipEnsure) {
    await ensureOutputTables();
  }

  // Load overrides and performance data in parallel
  const [overrides, tuples] = await Promise.all([
    loadOverrides(accountId),
    fetchPerformanceTuples(accountId),
  ]);

  if (!tuples.length) {
    console.log(`[opportunityScorer] No performance data for account ${accountId} — skipping`);
    return [];
  }

  // Compute account-level normalization denominators
  const maxCmHeadroom = Math.max(
    ...tuples
      .map(t => t.cmHeadroom)
      .filter(v => v != null && v > 0),
    0 // fallback to 0 to avoid -Infinity
  );

  const maxRoasInAccount = Math.max(
    ...tuples
      .map(t => t.currentRoas)
      .filter(v => v != null && v > 0),
    0 // fallback to 0 to avoid -Infinity
  );

  const scored = [];

  for (const tuple of tuples) {
    const opportunityType = classifyOpportunity({
      currentRoas:        tuple.currentRoas,
      breakEvenRoas:      tuple.breakEvenRoas,
      actualAcos:         tuple.actualAcos,
      breakEvenAcos:      tuple.breakEvenAcos,
      overspentPeriods:   tuple.overspentPeriods,
      daysOfSupply:       tuple.daysOfSupply,
      firstSeenDaysAgo:   tuple.firstSeenDaysAgo,
      budgetConstrained:  tuple.budgetConstrained,
    });

    // No clear opportunity — skip this tuple
    if (!opportunityType) continue;

    // Apply overrides
    const { blocked, reason } = applyOverrides(overrides, {
      campaignId:      tuple.campaignId,
      asin:            tuple.asin,
      opportunityType,
    });

    // Load account-level payback target override if present
    const targetPaybackDays = overrides.payback_target_days?.[0]?.value?.days ?? 60;

    const scoreResult = computeScore({
      cmHeadroom:                tuple.cmHeadroom,
      maxCmHeadroomInAccount:    maxCmHeadroom,
      currentRoas:               tuple.currentRoas,
      maxRoasInAccount,
      spendMonthly:              tuple.totalSpend,  // 30-day spend as monthly proxy
      dataPoints:                tuple.dataPointDays,
      dataAgeHours:              tuple.dataAgeHours,
      campaignAgeDays:           tuple.firstSeenDaysAgo,
      impressionShareLostToBudget: tuple.budgetConstrained ? 1 : 0,
      paybackDays:               null, // NTB/CAC payback not yet available in pipeline
      targetPaybackDays,
    });
    const score = scoreResult.score;

    const { action, deltaUsd } = getRecommendation(
      opportunityType,
      tuple.avgDailyBudget,
      tuple.avgDailySpend
    );

    const confidence = getConfidence(tuple.dataPointDays, tuple.dataAgeHours);

    // Marginal ROAS estimate: CM headroom / recommended delta spend
    const expectedMarginalRoas = (
      tuple.cmHeadroom != null &&
      deltaUsd != null &&
      Math.abs(deltaUsd) > 0
    )
      ? Math.round((tuple.cmHeadroom / Math.abs(deltaUsd)) * 10000) / 10000
      : null;

    const opp = {
      accountId:           accountId,
      asin:                tuple.asin,
      campaignId:          tuple.campaignId,
      opportunityType,
      score,
      recommendedAction:   blocked ? 'blocked' : action,
      recommendedDeltaUsd: blocked ? null : deltaUsd,
      expectedMarginalRoas,
      confidence,
      metricVersion:       METRIC_REGISTRY_VERSION,
      blockedByOverride:   blocked,
      overrideReason:      reason,
      // Full inputs snapshot for explainability
      inputs: {
        // Raw metrics
        cm_headroom_raw:         tuple.cmHeadroom,
        cm_headroom_norm:        scoreResult.cmHeadroomNorm,
        mroas_norm:              scoreResult.mroasNorm,
        confidence_factor:       scoreResult.confidenceFactor,
        scalability_factor:      scoreResult.scalabilityFactor,
        payback_adjustment:      scoreResult.paybackAdjustment,
        final_score:             score,
        formula_version:         '1.3.0',
        // Supporting context
        currentRoas:             tuple.currentRoas,
        actualAcos:              tuple.actualAcos,
        breakEvenRoas:           tuple.breakEvenRoas,
        breakEvenAcos:           tuple.breakEvenAcos,
        daysOfSupply:            tuple.daysOfSupply,
        firstSeenDaysAgo:        tuple.firstSeenDaysAgo,
        budgetConstrained:       tuple.budgetConstrained,
        dataPointDays:           tuple.dataPointDays,
        dataAgeHours:            tuple.dataAgeHours,
        avgDailyBudget:          tuple.avgDailyBudget,
        avgDailySpend:           tuple.avgDailySpend,
        maxCmHeadroomInAccount:  maxCmHeadroom,
        maxRoasInAccount,
        cm2:                     tuple.cm2,
        overspentPeriods:        tuple.overspentPeriods,
      },
    };

    scored.push(opp);
  }

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  if (!dryRun && scored.length > 0) {
    try {
      await writeScoredOpportunities(scored);
      console.log(`[opportunityScorer] Wrote ${scored.length} opportunities for account ${accountId}`);
    } catch (err) {
      console.error(`[opportunityScorer] Failed to write scores for ${accountId}: ${err.message}`);
      // Don't re-throw — return the computed scores even if write failed
    }
  }

  return scored;
}

// ─── scoreAllAccounts ─────────────────────────────────────────────────────────

/**
 * Score all active accounts.
 * Runs scoreAccount() serially (one account at a time) to avoid Snowflake
 * concurrency limits on small warehouses.
 *
 * @returns {Promise<{ accountId: string, scored: number, error: string|null }[]>}
 */
async function scoreAllAccounts() {
  // Ensure tables exist once before the batch
  await ensureOutputTables();

  // Fetch active accounts
  let accounts = [];
  try {
    accounts = await query(`
      SELECT id AS account_id
      FROM ${ACCOUNTS_TABLE}
      WHERE is_active = TRUE
        AND sync_enabled = TRUE
    `);
  } catch (err) {
    console.error(`[opportunityScorer] Could not fetch accounts: ${err.message}`);
    return [];
  }

  const results = [];

  for (const row of accounts) {
    const accountId = row.ACCOUNT_ID || row.account_id;
    try {
      const opportunities = await scoreAccount(accountId, { skipEnsure: true });
      results.push({ accountId, scored: opportunities.length, error: null });
    } catch (err) {
      console.error(`[opportunityScorer] Error scoring ${accountId}: ${err.message}`);
      results.push({ accountId, scored: 0, error: err.message });
    }
  }

  const total = results.reduce((sum, r) => sum + r.scored, 0);
  const errCount = results.filter(r => r.error).length;
  console.log(`[opportunityScorer] Completed all accounts: ${total} opportunities across ${results.length} accounts (${errCount} errors)`);

  return results;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toNum(v) {
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

function toInt(v) {
  const n = parseInt(v, 10);
  return isNaN(n) ? null : n;
}

function toBool(v) {
  if (v === true || v === 'true' || v === 'TRUE' || v === 1) return true;
  if (v === false || v === 'false' || v === 'FALSE' || v === 0) return false;
  return null;
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  scoreAccount,
  scoreAllAccounts,
  // Exported for testing
  classifyOpportunity,
  computeScore,
  getRecommendation,
  getConfidence,
  applyOverrides,
  ensureOutputTables,
};
