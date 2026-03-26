-- ============================================================
-- Migration 003: Recommendation Feedback Loop
-- Database: CALBRIDGE
-- Schemas affected: METRICS (new), CANONICAL (additive)
--
-- Purpose:
--   1. Create METRICS schema for Economist-owned output tables.
--   2. Create METRICS.OPPORTUNITY_SCORES — the scored-opportunity output of
--      opportunityScorer.js (scored per run, not upserted — append-only).
--   3. Add CANONICAL.RECOMMENDATION_LOG and CANONICAL.RECOMMENDATION_OUTCOMES
--      as idempotent fallback in case migration 002 was not run.
--      (002 already creates these with richer schemas; statements here are
--       a minimal CREATE TABLE IF NOT EXISTS that mirrors the task spec.)
--   4. Create CANONICAL.ACCOUNT_OVERRIDES if not already present.
--
-- ⚠️  Formula weights in opportunityScorer.js (60/40 split) need Abe sign-off
--    before these scores are surfaced to live clients. See MEMORY.md.
--
-- Run: node src/migrations/run.js 003
-- ============================================================

-- ============================================================
-- SCHEMA: METRICS
-- Owned by the Economist agent.
-- Contains computed metrics, opportunity scores, and capital allocation signals.
-- Never query directly from dashboards — use CANONICAL.* for cross-agent reads.
-- ============================================================

CREATE SCHEMA IF NOT EXISTS CALBRIDGE.METRICS
  COMMENT = 'Economist-computed metrics and scored opportunities. Append-only tables — do not upsert. Query CANONICAL.OPPORTUNITY_SCORES for cross-agent access.';


-- ============================================================
-- METRICS.OPPORTUNITY_SCORES
--
-- Primary output of opportunityScorer.js.
-- Written on every scoring run; rows are NEVER updated (append-only).
-- metric_version stamps the exact formula used → required for explainability.
--
-- Schema per task spec. Complements CANONICAL.OPPORTUNITY_SCORES (which has
-- richer relational columns). METRICS version is optimised for bulk reads
-- by the recommendation and budget-allocation engines.
-- ============================================================

CREATE TABLE IF NOT EXISTS CALBRIDGE.METRICS.OPPORTUNITY_SCORES (
  -- Identity
  score_id                VARCHAR          NOT NULL DEFAULT UUID_STRING()
                            COMMENT 'Unique ID for this scored opportunity row',
  account_id              VARCHAR          NOT NULL
                            COMMENT 'FK → CANONICAL.ACCOUNTS.id',
  asin                    VARCHAR
                            COMMENT 'ASIN this opportunity applies to (NULL = account-level)',
  campaign_id             VARCHAR
                            COMMENT 'Campaign this opportunity applies to (NULL = ASIN-level)',

  -- Opportunity classification
  opportunity_type        VARCHAR          NOT NULL
                            COMMENT 'underfunded | overspent | inventory_constrained | launch_priority | efficient_scale',

  -- Score (0–100)
  score                   NUMBER(5,2)      NOT NULL
                            COMMENT 'Composite opportunity score. Formula v1: (cm_headroom/max)*60 + (roas/be_roas-1)*40, clamped 0–100. FORMULA WEIGHTS NEED ABE SIGN-OFF.',

  -- Recommendation
  recommended_action      VARCHAR
                            COMMENT 'increase_budget | decrease_budget | pause_ads | maintain_or_increase | monitor | blocked',
  recommended_delta_usd   NUMBER(10,2)
                            COMMENT 'Absolute USD change recommended. Positive = increase, negative = decrease.',
  expected_marginal_roas  NUMBER(10,4)
                            COMMENT 'Estimated ROAS on the recommended incremental spend. cm_headroom / |delta_usd|.',

  -- Confidence
  confidence              VARCHAR
                            COMMENT 'high (≥14 days data, age <25h) | medium (7-13 days, or age 25-48h) | low (<7 days or age >48h)',

  -- Versioning and lineage
  metric_version          VARCHAR          NOT NULL
                            COMMENT 'METRIC_REGISTRY_VERSION from src/config/metrics.js at time of scoring',
  data_as_of              TIMESTAMP_NTZ
                            COMMENT 'Timestamp of the most recent input data used in scoring',
  scored_at               TIMESTAMP_NTZ    NOT NULL DEFAULT CURRENT_TIMESTAMP
                            COMMENT 'When this opportunity was scored',

  -- Full inputs snapshot (for explainability and model debugging)
  inputs_json             VARCHAR
                            COMMENT 'JSON snapshot of all inputs used: ROAS, ACOS, break-even values, days of supply, data age, formula weights, etc.',

  PRIMARY KEY (score_id)
)
COMMENT = 'Append-only opportunity score output from the Economist scoring engine. Each run appends new rows — never updates. metric_version required for retroactive explainability. Query latest run via MAX(scored_at).';


-- ============================================================
-- CANONICAL.RECOMMENDATION_LOG
--
-- Immutable audit log of every recommendation issued to a client.
-- Created in migration 002 with full relational schema.
-- This statement is a safe fallback (IF NOT EXISTS) matching the task spec.
-- If 002 already ran, this is a no-op.
-- ============================================================

CREATE TABLE IF NOT EXISTS CALBRIDGE.CANONICAL.RECOMMENDATION_LOG (
  recommendation_id       VARCHAR          NOT NULL DEFAULT UUID_STRING()
                            COMMENT 'UUID for this recommendation. FK target from RECOMMENDATION_OUTCOMES.',
  account_id              VARCHAR          NOT NULL
                            COMMENT 'FK → CANONICAL.ACCOUNTS.id',
  asin                    VARCHAR
                            COMMENT 'ASIN this recommendation applies to',
  campaign_id             VARCHAR
                            COMMENT 'Campaign ID (Amazon source ID) this recommendation applies to',
  opportunity_type        VARCHAR          NOT NULL
                            COMMENT 'underfunded | overspent | inventory_constrained | launch_priority | efficient_scale',
  score                   NUMBER(5,2)
                            COMMENT 'Opportunity score at time of recommendation issuance',
  recommended_action      VARCHAR
                            COMMENT 'increase_budget | decrease_budget | pause_ads | maintain_or_increase | monitor',
  recommended_delta_usd   NUMBER(10,2)
                            COMMENT 'USD change magnitude recommended (positive = increase, negative = decrease)',
  expected_marginal_roas  NUMBER(10,4)
                            COMMENT 'Predicted ROAS on incremental spend at time of issuance',
  confidence              VARCHAR
                            COMMENT 'high | medium | low',
  metric_version          VARCHAR          NOT NULL
                            COMMENT 'Formula version used when this recommendation was issued',
  data_as_of              TIMESTAMP_NTZ
                            COMMENT 'Freshness of input data at issuance',
  issued_at               TIMESTAMP_NTZ    NOT NULL DEFAULT CURRENT_TIMESTAMP
                            COMMENT 'When this recommendation was issued',
  issued_by               VARCHAR          NOT NULL DEFAULT 'system'
                            COMMENT 'system = auto-generated | user UUID = manually issued',

  PRIMARY KEY (recommendation_id)
)
COMMENT = 'Immutable recommendation audit log. Every recommendation issued — manual or auto — gets a row here. Never update rows; use RECOMMENDATION_OUTCOMES to track what happened.';


-- ============================================================
-- CANONICAL.RECOMMENDATION_OUTCOMES
--
-- Tracks what actually happened after each recommendation was acted on.
-- Filled by an outcome-tracker job N days after the recommendation was acted on.
-- Created in migration 002. This IF NOT EXISTS is a safe fallback.
-- ============================================================

CREATE TABLE IF NOT EXISTS CALBRIDGE.CANONICAL.RECOMMENDATION_OUTCOMES (
  outcome_id              VARCHAR          NOT NULL DEFAULT UUID_STRING(),
  recommendation_id       VARCHAR          NOT NULL
                            COMMENT 'FK → CANONICAL.RECOMMENDATION_LOG.recommendation_id',
  measured_at             TIMESTAMP_NTZ    NOT NULL DEFAULT CURRENT_TIMESTAMP
                            COMMENT 'When this outcome measurement was taken',
  measurement_window_days NUMBER(10,0)     NOT NULL
                            COMMENT 'Days post-action that this measurement window covers (e.g. 7, 14, 30)',
  realized_roas           NUMBER(10,4)
                            COMMENT 'Actual ROAS observed during the measurement window',
  realized_spend_delta    NUMBER(10,2)
                            COMMENT 'Actual change in spend vs pre-recommendation baseline (USD)',
  realized_revenue_delta  NUMBER(10,2)
                            COMMENT 'Actual change in revenue vs pre-recommendation baseline (USD)',
  prediction_accuracy_pct NUMBER(10,4)
                            COMMENT '(realized / predicted - 1) × 100. Positive = we underestimated. Used for model calibration.',
  outcome_notes           VARCHAR
                            COMMENT 'Free-text notes (e.g. external factors, stockouts, promotions that affected the outcome)',

  PRIMARY KEY (outcome_id),
  UNIQUE (recommendation_id, measurement_window_days)
)
COMMENT = 'Outcome tracking for issued recommendations. Filled N days post-action. prediction_accuracy_pct drives model improvement. Unique on (recommendation_id, measurement_window_days) so each window is measured once.';


-- ============================================================
-- CANONICAL.ACCOUNT_OVERRIDES
--
-- Human override rules applied before scoring.
-- Created in migration 002 with full relational schema.
-- This is a safe fallback (IF NOT EXISTS) matching the task spec.
-- ============================================================

CREATE TABLE IF NOT EXISTS CALBRIDGE.CANONICAL.ACCOUNT_OVERRIDES (
  account_id              VARCHAR          NOT NULL
                            COMMENT 'FK → CANONICAL.ACCOUNTS.id',
  override_type           VARCHAR          NOT NULL
                            COMMENT 'min_spend | priority_skus | ignore_low_inventory | payback_target_days | blacklist_campaigns',
  override_key            VARCHAR
                            COMMENT 'campaign_id, asin, etc. NULL for account-wide rules',
  override_value          VARCHAR          NOT NULL
                            COMMENT 'JSON string for complex values, plain value for simple ones',
  created_at              TIMESTAMP_NTZ    DEFAULT CURRENT_TIMESTAMP,
  created_by              VARCHAR          DEFAULT 'system'
)
COMMENT = 'Minimal account-level override rules. IF NOT EXISTS fallback — migration 002 creates a richer version of this table with full relational schema. If 002 was run, this is a no-op.';
