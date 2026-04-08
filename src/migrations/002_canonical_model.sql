-- ============================================================
-- Migration 002: Canonical Data Model
-- Database: CALBRIDGE
-- Schema created: CANONICAL
--
-- Purpose:
--   Source-agnostic canonical entity layer. All downstream reporting,
--   recommendation scoring, and dashboards query CANONICAL.* exclusively.
--   RAW_* tables are staging only — never queried for reporting.
--
-- Source-of-truth hierarchy (from architecture doc):
--   1. Amazon Ads API  > derived calculations       (spend, impressions, clicks)
--   2. SP-API retail   > Ads-attributed sales        (actual order revenue)
--   3. Client COGS     > estimated COGS              (margin calculations)
--   4. CANONICAL.*     > RAW_* staging               (all reporting)
--   5. Retail revenue  > Ads-attributed sales        (when they disagree)
--
-- Conventions:
--   - Every row has: id (UUID), account_id, client_id, source_system,
--     created_at TIMESTAMP_NTZ, updated_at TIMESTAMP_NTZ
--   - source_system values: amazon_ads | sp_api | manual | walmart | shopify
--   - Natural source keys preserved alongside internal UUIDs
--   - Lookup/dimension tables (ACCOUNTS, CHANNELS, PRODUCTS) are slowly
--     changing; updated_at tracks last upsert
--
-- Run: node src/migrations/run.js 002
-- ============================================================

-- ============================================================
-- SCHEMA
-- ============================================================

CREATE SCHEMA IF NOT EXISTS CALBRIDGE_PROD.CANONICAL
  COMMENT = 'Source-agnostic canonical entity layer. Ground truth for all reporting and scoring. Never query RAW_* for reporting — use this schema.';


-- ============================================================
-- CANONICAL.ACCOUNTS
-- Client/advertiser accounts — one row per Amazon profile + Calbridge client
-- This is the tenant isolation anchor; every other table FKs to here.
-- ============================================================

CREATE TABLE IF NOT EXISTS CALBRIDGE_PROD.CANONICAL.ACCOUNTS (
  -- Internal identity
  id                                   VARCHAR(36)   NOT NULL DEFAULT UUID_STRING() COMMENT 'Calbridge internal UUID for this account',
  client_id                            VARCHAR(36)   NOT NULL COMMENT 'Calbridge client/org UUID (tenant)',

  -- Source system keys
  amazon_profile_id                    VARCHAR(64)            COMMENT 'Amazon Ads profileId',
  amazon_marketplace_id                VARCHAR(32)            COMMENT 'Amazon marketplace (e.g. ATVPDKIKX0DER)',
  amazon_selling_partner_id            VARCHAR(64)            COMMENT 'SP-API sellingPartnerId',

  -- Source system
  source_system                        VARCHAR(64)   NOT NULL DEFAULT 'amazon_ads' COMMENT 'amazon_ads | sp_api | manual | walmart | shopify',

  -- Account metadata
  name                                 VARCHAR(512)           COMMENT 'Human-readable account name',
  marketplace_country_code             VARCHAR(8)    DEFAULT 'US',
  currency_code                        VARCHAR(8)    DEFAULT 'USD',
  timezone                             VARCHAR(64)   DEFAULT 'America/New_York' COMMENT 'Account reporting timezone — all canonical dates are in UTC; this is for display',
  account_type                         VARCHAR(64)            COMMENT 'vendor | seller | agency',
  is_active                            BOOLEAN       DEFAULT TRUE,

  -- Credential & sync status
  credentials_valid_at                 TIMESTAMP_NTZ          COMMENT 'Last time credentials were verified',
  sync_enabled                         BOOLEAN       DEFAULT TRUE,
  last_sync_at                         TIMESTAMP_NTZ,

  -- Lineage
  created_at                           TIMESTAMP_NTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                           TIMESTAMP_NTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE (client_id, amazon_profile_id)
)
COMMENT = 'Canonical account/advertiser records. Tenant isolation anchor — every other CANONICAL table references client_id from here.';


-- ============================================================
-- CANONICAL.CHANNELS
-- Advertising channel lookup — SP / SB / SD / DSP / Retail / etc.
-- Static reference table; seeded once, rarely changed.
-- ============================================================

CREATE TABLE IF NOT EXISTS CALBRIDGE_PROD.CANONICAL.CHANNELS (
  id                                   VARCHAR(36)   NOT NULL DEFAULT UUID_STRING(),
  code                                 VARCHAR(32)   NOT NULL COMMENT 'Short code: SP | SB | SD | DSP | RETAIL | WALMART | META | GOOGLE',
  name                                 VARCHAR(128)  NOT NULL COMMENT 'Display name: Sponsored Products',
  platform                             VARCHAR(64)   NOT NULL COMMENT 'amazon | walmart | meta | google',
  channel_type                         VARCHAR(64)   NOT NULL COMMENT 'paid_search | display | video | retail | organic',
  supports_keyword_targeting           BOOLEAN       DEFAULT FALSE,
  supports_asin_targeting              BOOLEAN       DEFAULT FALSE,
  supports_audience_targeting          BOOLEAN       DEFAULT FALSE,
  is_active                            BOOLEAN       DEFAULT TRUE,
  notes                                VARCHAR(1000),

  created_at                           TIMESTAMP_NTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                           TIMESTAMP_NTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE (code)
)
COMMENT = 'Advertising channel lookup table. Seeded once. All campaign records reference channel_code.';

-- Seed canonical channels
INSERT INTO CALBRIDGE_PROD.CANONICAL.CHANNELS
  (code, name, platform, channel_type, supports_keyword_targeting, supports_asin_targeting, supports_audience_targeting)
SELECT code, name, platform, channel_type, kw, asin, audience FROM (VALUES
  ('SP',      'Sponsored Products', 'amazon',  'paid_search', TRUE,  TRUE,  FALSE),
  ('SB',      'Sponsored Brands',   'amazon',  'paid_search', TRUE,  TRUE,  FALSE),
  ('SD',      'Sponsored Display',  'amazon',  'display',     FALSE, TRUE,  TRUE),
  ('DSP',     'Amazon DSP',         'amazon',  'display',     FALSE, TRUE,  TRUE),
  ('RETAIL',  'Retail / Organic',   'amazon',  'retail',      FALSE, FALSE, FALSE),
  ('WALMART', 'Walmart Connect',    'walmart', 'paid_search', TRUE,  TRUE,  FALSE),
  ('META',    'Meta Ads',           'meta',    'display',     FALSE, FALSE, TRUE),
  ('GOOGLE',  'Google Ads',         'google',  'paid_search', TRUE,  FALSE, TRUE)
) AS t(code, name, platform, channel_type, kw, asin, audience)
WHERE NOT EXISTS (SELECT 1 FROM CALBRIDGE_PROD.CANONICAL.CHANNELS WHERE code = t.code);


-- ============================================================
-- CANONICAL.CAMPAIGNS
-- Normalized campaigns from any source (SP, SB, SD, DSP, Walmart, etc.)
-- One row per campaign, updated on each sync.
-- ============================================================

CREATE TABLE IF NOT EXISTS CALBRIDGE_PROD.CANONICAL.CAMPAIGNS (
  -- Internal identity
  id                                   VARCHAR(36)   NOT NULL DEFAULT UUID_STRING(),
  account_id                           VARCHAR(36)   NOT NULL COMMENT 'FK → CANONICAL.ACCOUNTS.id',
  client_id                            VARCHAR(36)   NOT NULL COMMENT 'Tenant isolation',

  -- Source system keys
  source_system                        VARCHAR(64)   NOT NULL COMMENT 'amazon_ads | sp_api | walmart | manual',
  amazon_campaign_id                   VARCHAR(64)            COMMENT 'Amazon Ads campaignId',
  amazon_portfolio_id                  VARCHAR(64)            COMMENT 'Amazon portfolioId (optional grouping)',
  external_campaign_id                 VARCHAR(128)           COMMENT 'Non-Amazon source campaign ID (Walmart, Google, etc.)',

  -- Channel reference
  channel_code                         VARCHAR(32)   NOT NULL COMMENT 'FK → CANONICAL.CHANNELS.code (SP | SB | SD | DSP | WALMART)',

  -- Campaign metadata
  name                                 VARCHAR(512)  NOT NULL,
  status                               VARCHAR(32)            COMMENT 'ENABLED | PAUSED | ARCHIVED',
  targeting_type                       VARCHAR(32)            COMMENT 'MANUAL | AUTO',
  bidding_strategy                     VARCHAR(64)            COMMENT 'LEGACY_FOR_SALES | AUTO_FOR_SALES | MANUAL',

  -- Budget
  daily_budget                         NUMBER(38,10),
  lifetime_budget                      NUMBER(38,10),
  budget_type                          VARCHAR(32)            COMMENT 'DAILY | LIFETIME',
  currency_code                        VARCHAR(8),

  -- Dates
  start_date                           DATE,
  end_date                             DATE,

  -- Lineage
  source_report_id                     VARCHAR(128)           COMMENT 'Last report that touched this row',
  pipeline_run_id                      VARCHAR(64),
  created_at                           TIMESTAMP_NTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                           TIMESTAMP_NTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE (client_id, source_system, amazon_campaign_id)
)
COMMENT = 'Canonical campaign registry. One row per campaign, all ad types. Updated on each sync via MERGE on (client_id, source_system, amazon_campaign_id).';


-- ============================================================
-- CANONICAL.AD_GROUPS
-- Ad groups / line items — normalized across SP/SB/SD
-- ============================================================

CREATE TABLE IF NOT EXISTS CALBRIDGE_PROD.CANONICAL.AD_GROUPS (
  id                                   VARCHAR(36)   NOT NULL DEFAULT UUID_STRING(),
  account_id                           VARCHAR(36)   NOT NULL COMMENT 'FK → CANONICAL.ACCOUNTS.id',
  client_id                            VARCHAR(36)   NOT NULL,
  campaign_id                          VARCHAR(36)   NOT NULL COMMENT 'FK → CANONICAL.CAMPAIGNS.id',

  -- Source system keys
  source_system                        VARCHAR(64)   NOT NULL,
  amazon_ad_group_id                   VARCHAR(64)            COMMENT 'Amazon Ads adGroupId',
  amazon_campaign_id                   VARCHAR(64)            COMMENT 'Denormalized for JOIN convenience',
  external_ad_group_id                 VARCHAR(128)           COMMENT 'Non-Amazon source ad group ID',

  -- Metadata
  name                                 VARCHAR(512)  NOT NULL,
  status                               VARCHAR(32)            COMMENT 'ENABLED | PAUSED | ARCHIVED',
  default_bid                          NUMBER(38,10),
  currency_code                        VARCHAR(8),

  -- Lineage
  source_report_id                     VARCHAR(128),
  pipeline_run_id                      VARCHAR(64),
  created_at                           TIMESTAMP_NTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                           TIMESTAMP_NTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE (client_id, source_system, amazon_ad_group_id)
)
COMMENT = 'Canonical ad group / line item registry. One row per ad group.';


-- ============================================================
-- CANONICAL.KEYWORD_TARGETS
-- Keywords and targeting expressions from any ad type
-- Covers: SP keywords, SP ASIN targets, SB keywords, SD audiences
-- ============================================================

CREATE TABLE IF NOT EXISTS CALBRIDGE_PROD.CANONICAL.KEYWORD_TARGETS (
  id                                   VARCHAR(36)   NOT NULL DEFAULT UUID_STRING(),
  account_id                           VARCHAR(36)   NOT NULL COMMENT 'FK → CANONICAL.ACCOUNTS.id',
  client_id                            VARCHAR(36)   NOT NULL,
  campaign_id                          VARCHAR(36)   NOT NULL COMMENT 'FK → CANONICAL.CAMPAIGNS.id',
  ad_group_id                          VARCHAR(36)             COMMENT 'FK → CANONICAL.AD_GROUPS.id (nullable for campaign-level targets)',

  -- Source system keys
  source_system                        VARCHAR(64)   NOT NULL,
  amazon_keyword_id                    VARCHAR(64)            COMMENT 'Amazon Ads keywordId',
  amazon_target_id                     VARCHAR(64)            COMMENT 'Amazon Ads targetId (for product/category targeting)',
  amazon_campaign_id                   VARCHAR(64)            COMMENT 'Denormalized for JOIN convenience',
  amazon_ad_group_id                   VARCHAR(64)            COMMENT 'Denormalized for JOIN convenience',

  -- Targeting details
  target_type                          VARCHAR(32)   NOT NULL COMMENT 'KEYWORD | PRODUCT_TARGET | CATEGORY_TARGET | AUDIENCE | AUTO',
  keyword_text                         VARCHAR(512)           COMMENT 'Keyword string (if keyword type)',
  match_type                           VARCHAR(32)            COMMENT 'BROAD | PHRASE | EXACT (keywords only)',
  target_expression                    VARCHAR(1000)          COMMENT 'Raw targeting expression (product/category targets)',
  target_asin                          VARCHAR(32)            COMMENT 'Targeted ASIN (if product targeting)',

  -- Bid
  bid                                  NUMBER(38,10),
  currency_code                        VARCHAR(8),

  -- Status
  status                               VARCHAR(32)            COMMENT 'ENABLED | PAUSED | ARCHIVED',

  -- Lineage
  source_report_id                     VARCHAR(128),
  pipeline_run_id                      VARCHAR(64),
  created_at                           TIMESTAMP_NTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                           TIMESTAMP_NTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE (client_id, source_system, amazon_keyword_id),
  UNIQUE (client_id, source_system, amazon_target_id)
)
COMMENT = 'Canonical keyword and targeting expression registry. Covers SP keywords, ASIN/category targets, SB keywords, SD audiences. target_type distinguishes them.';


-- ============================================================
-- CANONICAL.PRODUCTS
-- ASINs/SKUs with metadata — the product catalog
-- Updated on each SP-API listings sync
-- ============================================================

CREATE TABLE IF NOT EXISTS CALBRIDGE_PROD.CANONICAL.PRODUCTS (
  id                                   VARCHAR(36)   NOT NULL DEFAULT UUID_STRING(),
  account_id                           VARCHAR(36)   NOT NULL COMMENT 'FK → CANONICAL.ACCOUNTS.id',
  client_id                            VARCHAR(36)   NOT NULL,

  -- Source system keys
  source_system                        VARCHAR(64)   NOT NULL DEFAULT 'sp_api',
  asin                                 VARCHAR(32)   NOT NULL COMMENT 'Amazon Standard Identification Number',
  sku                                  VARCHAR(128)           COMMENT 'Merchant SKU (may have multiple SKUs per ASIN)',
  marketplace_id                       VARCHAR(32)   NOT NULL DEFAULT 'ATVPDKIKX0DER',

  -- Product metadata
  item_name                            VARCHAR(1000)          COMMENT 'Product title from SP-API',
  brand                                VARCHAR(255),
  category                             VARCHAR(255)           COMMENT 'Browse node / product category',
  product_type                         VARCHAR(255),
  parent_asin                          VARCHAR(32)            COMMENT 'Parent ASIN for variation relationships',
  variant_attributes                   VARIANT                COMMENT 'JSON: color, size, etc.',

  -- Listing status
  status                               VARCHAR(32)            COMMENT 'Active | Inactive | Incomplete',
  fulfillment_channel                  VARCHAR(32)            COMMENT 'AMAZON_NA (FBA) | DEFAULT (FBM)',
  condition_type                       VARCHAR(32)            DEFAULT 'New',

  -- Pricing (last known)
  price                                NUMBER(38,10),
  sale_price                           NUMBER(38,10),
  currency_code                        VARCHAR(8)    DEFAULT 'USD',

  -- BSR
  sales_rank                           NUMBER(38,0)           COMMENT 'Best Seller Rank at last sync',
  sales_rank_category                  VARCHAR(255),

  -- COGS (client-supplied; drives margin calculations)
  cogs                                 NUMBER(38,10)          COMMENT 'Cost of goods sold per unit — client-supplied or estimated',
  cogs_source                          VARCHAR(32)            COMMENT 'client_supplied | estimated | manual',
  cogs_updated_at                      TIMESTAMP_NTZ          COMMENT 'When COGS was last set',

  -- Lineage
  source_report_id                     VARCHAR(128),
  pipeline_run_id                      VARCHAR(64),
  created_at                           TIMESTAMP_NTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                           TIMESTAMP_NTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE (client_id, asin, marketplace_id)
)
COMMENT = 'Canonical product catalog. One row per ASIN per marketplace. Includes COGS for margin calculations — client_supplied COGS takes precedence over estimates.';


-- ============================================================
-- CANONICAL.INVENTORY_SNAPSHOTS
-- FBA inventory levels by product/date
-- Daily snapshot; used for restock signals and inventory-constrained opportunity scoring
-- ============================================================

CREATE TABLE IF NOT EXISTS CALBRIDGE_PROD.CANONICAL.INVENTORY_SNAPSHOTS (
  id                                   VARCHAR(36)   NOT NULL DEFAULT UUID_STRING(),
  account_id                           VARCHAR(36)   NOT NULL COMMENT 'FK → CANONICAL.ACCOUNTS.id',
  client_id                            VARCHAR(36)   NOT NULL,
  product_id                           VARCHAR(36)             COMMENT 'FK → CANONICAL.PRODUCTS.id',

  -- Source system keys
  source_system                        VARCHAR(64)   NOT NULL DEFAULT 'sp_api',
  asin                                 VARCHAR(32)   NOT NULL COMMENT 'Denormalized for query convenience',
  sku                                  VARCHAR(128)  NOT NULL,
  marketplace_id                       VARCHAR(32)   NOT NULL DEFAULT 'ATVPDKIKX0DER',
  snapshot_date                        DATE          NOT NULL COMMENT 'UTC date of this inventory snapshot',

  -- FBA inventory buckets
  fulfillable_quantity                 NUMBER(38,0)  NOT NULL DEFAULT 0 COMMENT 'Units available for sale',
  inbound_quantity                     NUMBER(38,0)  DEFAULT 0 COMMENT 'Units in transit to FC (working + shipped + receiving)',
  inbound_working_quantity             NUMBER(38,0)  DEFAULT 0,
  inbound_shipped_quantity             NUMBER(38,0)  DEFAULT 0,
  inbound_receiving_quantity           NUMBER(38,0)  DEFAULT 0,
  reserved_quantity                    NUMBER(38,0)  DEFAULT 0 COMMENT 'Reserved for pending orders',
  unfulfillable_quantity               NUMBER(38,0)  DEFAULT 0 COMMENT 'Damaged / customer return',
  total_quantity                       NUMBER(38,0)  DEFAULT 0 COMMENT 'Sum of all buckets',

  -- Days of supply (Amazon estimates)
  days_of_supply_30d                   NUMBER(38,0)   COMMENT 'Based on 30-day sales velocity',
  days_of_supply_90d                   NUMBER(38,0)   COMMENT 'Based on 90-day sales velocity',

  -- Restock signal (computed at transform time)
  is_restock_alert                     BOOLEAN       DEFAULT FALSE COMMENT 'TRUE when days_of_supply_30d < 30',
  is_out_of_stock                      BOOLEAN       DEFAULT FALSE COMMENT 'TRUE when fulfillable_quantity = 0',
  is_inventory_constrained             BOOLEAN       DEFAULT FALSE COMMENT 'TRUE when days_of_supply_30d < 14 — used by opportunity scorer',

  -- Pricing context
  your_price                           NUMBER(38,10),

  -- Lineage
  source_report_id                     VARCHAR(128),
  pipeline_run_id                      VARCHAR(64),
  created_at                           TIMESTAMP_NTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                           TIMESTAMP_NTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE (client_id, asin, sku, marketplace_id, snapshot_date)
)
COMMENT = 'Canonical FBA inventory snapshot by ASIN/SKU/date. is_inventory_constrained (< 14 days supply) is used by the opportunity scorer to avoid recommending spend increases on OOS products.';


-- ============================================================
-- CANONICAL.CONTRIBUTION_MARGINS
-- CM per product per period — requires client-supplied COGS
-- Source of truth for margin-aware recommendation scoring
-- ============================================================

CREATE TABLE IF NOT EXISTS CALBRIDGE_PROD.CANONICAL.CONTRIBUTION_MARGINS (
  id                                   VARCHAR(36)   NOT NULL DEFAULT UUID_STRING(),
  account_id                           VARCHAR(36)   NOT NULL COMMENT 'FK → CANONICAL.ACCOUNTS.id',
  client_id                            VARCHAR(36)   NOT NULL,
  product_id                           VARCHAR(36)             COMMENT 'FK → CANONICAL.PRODUCTS.id',

  -- Source system keys
  source_system                        VARCHAR(64)   NOT NULL DEFAULT 'manual' COMMENT 'manual | sp_api | computed',
  asin                                 VARCHAR(32)   NOT NULL COMMENT 'Denormalized',
  sku                                  VARCHAR(128),
  marketplace_id                       VARCHAR(32)   NOT NULL DEFAULT 'ATVPDKIKX0DER',

  -- Period
  period_start                         DATE          NOT NULL COMMENT 'Start of the period this margin applies to',
  period_end                           DATE          NOT NULL COMMENT 'End of the period (inclusive)',
  period_type                          VARCHAR(16)   NOT NULL DEFAULT 'monthly' COMMENT 'daily | weekly | monthly | custom',

  -- Revenue inputs
  gross_revenue                        NUMBER(38,10)          COMMENT 'Total ordered revenue for period (from CANONICAL.RETAIL_PERFORMANCE or ANALYTICS.RETAIL_PERFORMANCE)',
  units_sold                           NUMBER(38,0),

  -- Cost inputs
  cogs_per_unit                        NUMBER(38,10)          COMMENT 'Cost of goods per unit (client-supplied preferred)',
  cogs_total                           NUMBER(38,10)          COMMENT 'cogs_per_unit * units_sold',
  amazon_fees_total                    NUMBER(38,10)          COMMENT 'FBA fees + referral fees for period',
  ad_spend_total                       NUMBER(38,10)          COMMENT 'Total ad spend attributed to this ASIN for period',
  other_costs                          NUMBER(38,10)          COMMENT 'Shipping, returns, misc costs',

  -- Margin outputs (computed at transform time by Economist agent)
  gross_profit                         NUMBER(38,10)          COMMENT 'gross_revenue - cogs_total',
  contribution_margin_1                NUMBER(38,10)          COMMENT 'CM1: gross_revenue - cogs - amazon_fees (before ads)',
  contribution_margin_2                NUMBER(38,10)          COMMENT 'CM2: CM1 - ad_spend (after ads)',
  cm1_pct                              NUMBER(38,10)          COMMENT 'CM1 / gross_revenue * 100',
  cm2_pct                              NUMBER(38,10)          COMMENT 'CM2 / gross_revenue * 100',
  mroas                                NUMBER(38,10)          COMMENT 'Marginal ROAS: (CM1) / ad_spend — higher = more profitable advertising',

  -- Formula versioning (from architecture requirement)
  formula_version                      VARCHAR(32)   NOT NULL DEFAULT '1.0' COMMENT 'Version of the margin formula — changing formula = new version',

  -- Lineage
  pipeline_run_id                      VARCHAR(64),
  created_at                           TIMESTAMP_NTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                           TIMESTAMP_NTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE (client_id, asin, marketplace_id, period_start, period_end, formula_version)
)
COMMENT = 'Contribution margin per product per period. CM1 = before ads, CM2 = after ads. Requires client COGS. Economist agent computes this. formula_version tracks which calculation was used.';


-- ============================================================
-- CANONICAL.OPPORTUNITY_SCORES
-- Scored opportunities with formula version + inputs
-- The recommendation engine outputs rows here before publishing to RECOMMENDATION_LOG
-- ============================================================

CREATE TABLE IF NOT EXISTS CALBRIDGE_PROD.CANONICAL.OPPORTUNITY_SCORES (
  id                                   VARCHAR(36)   NOT NULL DEFAULT UUID_STRING(),
  account_id                           VARCHAR(36)   NOT NULL COMMENT 'FK → CANONICAL.ACCOUNTS.id',
  client_id                            VARCHAR(36)   NOT NULL,

  -- Scoring run context
  scored_at                            TIMESTAMP_NTZ NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'When this opportunity was scored',
  score_run_id                         VARCHAR(64)   NOT NULL COMMENT 'Groups all opportunities from a single scoring run',
  formula_version                      VARCHAR(32)   NOT NULL DEFAULT '1.0' COMMENT 'Version of the scoring formula — required for explainability',
  data_window_start                    DATE                    COMMENT 'Start of the lookback window used for scoring',
  data_window_end                      DATE                    COMMENT 'End of the lookback window',

  -- What is the opportunity about?
  opportunity_type                     VARCHAR(64)   NOT NULL COMMENT 'underfunded_campaign | overspent_campaign | inventory_constrained | bid_optimization | keyword_gap | new_to_brand | dayparting',
  opportunity_entity                   VARCHAR(32)   NOT NULL COMMENT 'What entity this applies to: campaign | ad_group | keyword | product',

  -- Entity references (at least one populated)
  campaign_id                          VARCHAR(36)             COMMENT 'FK → CANONICAL.CAMPAIGNS.id',
  ad_group_id                          VARCHAR(36)             COMMENT 'FK → CANONICAL.AD_GROUPS.id',
  keyword_target_id                    VARCHAR(36)             COMMENT 'FK → CANONICAL.KEYWORD_TARGETS.id',
  product_id                           VARCHAR(36)             COMMENT 'FK → CANONICAL.PRODUCTS.id',

  -- Denormalized IDs for convenience
  amazon_campaign_id                   VARCHAR(64),
  asin                                 VARCHAR(32),

  -- Score
  score                                NUMBER(10,4)  NOT NULL COMMENT 'Opportunity score (higher = more impactful), normalized 0–100',
  confidence                           NUMBER(10,4)           COMMENT 'Confidence in the score (0–1), based on data completeness',
  estimated_incremental_revenue        NUMBER(38,10)          COMMENT 'Predicted incremental revenue if action is taken',
  estimated_incremental_roas           NUMBER(38,10)          COMMENT 'Predicted ROAS of the incremental spend',
  payback_days                         NUMBER(10,2)           COMMENT 'Estimated days to payback the recommended action',

  -- Inputs snapshot (raw data driving the score)
  inputs                               VARIANT       NOT NULL COMMENT 'JSON snapshot of all inputs used (spend, ROAS, budget, velocity, etc.) — required for explainability',

  -- Action recommendation
  recommended_action                   VARCHAR(64)            COMMENT 'increase_budget | decrease_budget | raise_bid | lower_bid | pause | enable | add_keyword | add_negative',
  recommended_delta                    NUMBER(38,10)          COMMENT 'Magnitude of recommended change (e.g. +$50 budget, +0.15 bid)',
  recommended_value                    NUMBER(38,10)          COMMENT 'Absolute target value (e.g. new budget = $200)',

  -- Override check (was this blocked by an account override?)
  blocked_by_override                  BOOLEAN       DEFAULT FALSE,
  override_reason                      VARCHAR(512),

  -- Status
  status                               VARCHAR(32)   NOT NULL DEFAULT 'pending' COMMENT 'pending | approved | rejected | applied | expired',
  acted_on_at                          TIMESTAMP_NTZ,
  acted_on_by                          VARCHAR(128)           COMMENT 'User or system that acted on this opportunity',

  -- Lineage
  created_at                           TIMESTAMP_NTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                           TIMESTAMP_NTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id)
)
COMMENT = 'Scored opportunities from the recommendation engine. inputs VARIANT stores full scoring context for explainability. formula_version required — changing the formula creates new scores, not overwrites.';


-- ============================================================
-- CANONICAL.RECOMMENDATION_LOG
-- Every recommendation issued — immutable audit trail
-- Never update rows here; insert new ones.
-- ============================================================

CREATE TABLE IF NOT EXISTS CALBRIDGE_PROD.CANONICAL.RECOMMENDATION_LOG (
  id                                   VARCHAR(36)   NOT NULL DEFAULT UUID_STRING(),
  account_id                           VARCHAR(36)   NOT NULL COMMENT 'FK → CANONICAL.ACCOUNTS.id',
  client_id                            VARCHAR(36)   NOT NULL,

  -- Source opportunity
  opportunity_score_id                 VARCHAR(36)             COMMENT 'FK → CANONICAL.OPPORTUNITY_SCORES.id',
  score_run_id                         VARCHAR(64)             COMMENT 'Scoring run that generated this recommendation',

  -- Source system / formula versioning
  source_system                        VARCHAR(64)   NOT NULL DEFAULT 'calbridge' COMMENT 'calbridge | manual',
  formula_version                      VARCHAR(32)   NOT NULL COMMENT 'Formula version at time of issuance',

  -- What was recommended (immutable at issuance)
  issued_at                            TIMESTAMP_NTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  recommendation_type                  VARCHAR(64)   NOT NULL COMMENT 'increase_budget | decrease_budget | raise_bid | lower_bid | pause | enable | add_keyword | add_negative | restock',
  recommendation_text                  VARCHAR(2000) NOT NULL COMMENT 'Human-readable recommendation narrative',

  -- Entity the recommendation applies to
  entity_type                          VARCHAR(32)   NOT NULL COMMENT 'campaign | ad_group | keyword | product | account',
  entity_id                            VARCHAR(36)             COMMENT 'CANONICAL internal UUID of the entity',
  amazon_campaign_id                   VARCHAR(64),
  amazon_ad_group_id                   VARCHAR(64),
  amazon_keyword_id                    VARCHAR(64),
  asin                                 VARCHAR(32),

  -- Current state (snapshot at issuance — for comparison in outcome tracking)
  current_value_snapshot               VARIANT                COMMENT 'JSON: current budget, bid, spend, etc. at time of recommendation',

  -- Recommended action (snapshot at issuance)
  recommended_action                   VARCHAR(64),
  recommended_delta                    NUMBER(38,10),
  recommended_value                    NUMBER(38,10),

  -- Predicted outcome (snapshot at issuance)
  predicted_incremental_revenue        NUMBER(38,10),
  predicted_incremental_roas           NUMBER(38,10),
  predicted_payback_days               NUMBER(10,2),

  -- Decision
  decision                             VARCHAR(32)            COMMENT 'pending | approved | rejected | auto_applied',
  decided_at                           TIMESTAMP_NTZ,
  decided_by                           VARCHAR(128)           COMMENT 'User email or "system" for auto-applied',
  rejection_reason                     VARCHAR(512),

  -- Lineage
  created_at                           TIMESTAMP_NTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id)
)
COMMENT = 'Immutable audit log of every recommendation issued. Never update rows — insert new versions. current_value_snapshot and predicted_* captured at issuance for outcome comparison.';


-- ============================================================
-- CANONICAL.RECOMMENDATION_OUTCOMES
-- What happened after the recommendation was acted on
-- Links back to RECOMMENDATION_LOG; filled N days post-action
-- ============================================================

CREATE TABLE IF NOT EXISTS CALBRIDGE_PROD.CANONICAL.RECOMMENDATION_OUTCOMES (
  id                                   VARCHAR(36)   NOT NULL DEFAULT UUID_STRING(),
  recommendation_id                    VARCHAR(36)   NOT NULL COMMENT 'FK → CANONICAL.RECOMMENDATION_LOG.id',
  account_id                           VARCHAR(36)   NOT NULL COMMENT 'FK → CANONICAL.ACCOUNTS.id',
  client_id                            VARCHAR(36)   NOT NULL,
  source_system                        VARCHAR(64)   NOT NULL DEFAULT 'calbridge',

  -- Measurement window
  measurement_start_date               DATE          NOT NULL COMMENT 'First date of the post-action measurement window',
  measurement_end_date                 DATE          NOT NULL COMMENT 'Last date of the measurement window',
  measurement_days                     NUMBER(10,0)  NOT NULL COMMENT 'Number of days in the window (typically 7, 14, or 30)',

  -- Actuals (filled from CANONICAL reporting tables)
  actual_spend                         NUMBER(38,10),
  actual_revenue                       NUMBER(38,10),
  actual_roas                          NUMBER(38,10),
  actual_purchases                     NUMBER(38,0),
  actual_impressions                   NUMBER(38,0),
  actual_clicks                        NUMBER(38,0),

  -- Pre-action baseline (for comparison — from recommendation_log.current_value_snapshot)
  baseline_spend                       NUMBER(38,10),
  baseline_revenue                     NUMBER(38,10),
  baseline_roas                        NUMBER(38,10),

  -- Prediction accuracy
  predicted_revenue                    NUMBER(38,10)          COMMENT 'What the model predicted (from recommendation_log)',
  predicted_roas                       NUMBER(38,10),
  revenue_accuracy_pct                 NUMBER(38,10)          COMMENT '(actual / predicted - 1) * 100 — positive means we underestimated',
  roas_accuracy_pct                    NUMBER(38,10),
  outcome_verdict                      VARCHAR(32)            COMMENT 'outperformed | met_target | underperformed | inconclusive',

  -- Incremental lift (actual vs what would have happened without action — requires counterfactual)
  incremental_revenue_estimate         NUMBER(38,10)          COMMENT 'Estimated incremental revenue vs counterfactual (if available)',
  incremental_roas_estimate            NUMBER(38,10),

  -- Model feedback signal
  requires_model_review                BOOLEAN       DEFAULT FALSE COMMENT 'TRUE when |revenue_accuracy_pct| > 30% — flag for Economist review',

  -- Lineage
  created_at                           TIMESTAMP_NTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                           TIMESTAMP_NTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE (recommendation_id, measurement_days)
)
COMMENT = 'Actual outcomes after recommendations. Filled N days post-action by the outcome tracker job. revenue_accuracy_pct and requires_model_review drive model improvement.';


-- ============================================================
-- CANONICAL.ACCOUNT_OVERRIDES
-- Human override rules per account — applied before scoring
-- The recommendation engine checks this table before issuing any recommendation
-- ============================================================

CREATE TABLE IF NOT EXISTS CALBRIDGE_PROD.CANONICAL.ACCOUNT_OVERRIDES (
  id                                   VARCHAR(36)   NOT NULL DEFAULT UUID_STRING(),
  account_id                           VARCHAR(36)   NOT NULL COMMENT 'FK → CANONICAL.ACCOUNTS.id',
  client_id                            VARCHAR(36)   NOT NULL,
  source_system                        VARCHAR(64)   NOT NULL DEFAULT 'manual',

  -- What entity does this override apply to?
  entity_type                          VARCHAR(32)   NOT NULL COMMENT 'account | campaign | ad_group | keyword | product — "account" means applies globally',
  entity_id                            VARCHAR(36)             COMMENT 'CANONICAL UUID of the entity (NULL = applies to all of that type)',

  -- Denormalized source IDs (for matching before internal IDs are resolved)
  amazon_campaign_id                   VARCHAR(64),
  amazon_ad_group_id                   VARCHAR(64),
  amazon_keyword_id                    VARCHAR(64),
  asin                                 VARCHAR(32),

  -- Override type and rule
  override_type                        VARCHAR(64)   NOT NULL COMMENT 'min_spend | max_spend | priority_sku | ignore_low_inventory | payback_target_days | blacklist | budget_floor | budget_cap | bid_floor | bid_cap',
  override_value                       VARIANT       NOT NULL COMMENT 'JSON: the override value (number, bool, list, or object)',

  -- Example override_value structures:
  --   min_spend:             { "floor": 500, "currency": "USD" }
  --   priority_sku:          { "asins": ["B0123", "B0456"] }
  --   payback_target_days:   { "max_days": 45 }
  --   blacklist:             { "reason": "seasonal pause" }
  --   budget_floor:          { "floor": 100 }

  -- Description and approver
  description                          VARCHAR(1000) COMMENT 'Human-readable explanation of why this override exists',
  created_by                           VARCHAR(128)  NOT NULL COMMENT 'User email who created the override',
  approved_by                          VARCHAR(128)            COMMENT 'User email who approved (for high-impact overrides)',

  -- Validity window
  valid_from                           DATE          NOT NULL DEFAULT CURRENT_DATE,
  valid_to                             DATE                    COMMENT 'NULL = no expiry',
  is_active                            BOOLEAN       NOT NULL DEFAULT TRUE,

  -- Lineage
  created_at                           TIMESTAMP_NTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                           TIMESTAMP_NTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id)
)
COMMENT = 'Human override rules. Applied by the recommendation engine before scoring. override_value is VARIANT to support diverse rule structures. is_active + valid_from/valid_to control applicability.';
