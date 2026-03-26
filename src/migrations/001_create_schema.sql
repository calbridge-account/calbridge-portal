-- ============================================================
-- Migration 001: Create Calbridge warehouse schemas
-- Database: CALBRIDGE
-- Schemas created: RAW_AMAZON_ADS, RAW_SP_API, ANALYTICS, PIPELINE
--
-- Schema conventions:
--   RAW_*     → staging, every row has ingested_at, account_id, report_id, pipeline_run_id
--   ANALYTICS → canonical, normalized; every row has source_report_id, transform_version, updated_at
--   PIPELINE  → metadata: freshness, quality, job runs
--
-- Dedup keys for ads: (report_id, account_id, campaign_id, date) — documented as logical keys
-- Types: TIMESTAMP_NTZ (UTC), NUMBER(38,10) for money/metrics, NUMBER(38,0) for counts
-- Run: node src/migrations/run.js
-- ============================================================

-- ============================================================
-- SCHEMA CREATION
-- ============================================================

CREATE SCHEMA IF NOT EXISTS CALBRIDGE.RAW_AMAZON_ADS
  COMMENT = 'Raw staging tables for Amazon Advertising API (SP, SB, SD)';

CREATE SCHEMA IF NOT EXISTS CALBRIDGE.RAW_SP_API
  COMMENT = 'Raw staging tables for Amazon Selling Partner API (listings, inventory, sales)';

CREATE SCHEMA IF NOT EXISTS CALBRIDGE.ANALYTICS
  COMMENT = 'Canonical normalized warehouse tables — all ad types unified';

CREATE SCHEMA IF NOT EXISTS CALBRIDGE.PIPELINE
  COMMENT = 'Pipeline metadata: freshness, quality checks, job run log';


-- ============================================================
-- RAW_AMAZON_ADS.SP_CAMPAIGNS
-- Raw Sponsored Products campaign-level performance rows
-- Logical dedup key: (report_id, account_id, campaign_id, date)
-- ============================================================

CREATE TABLE IF NOT EXISTS CALBRIDGE.RAW_AMAZON_ADS.SP_CAMPAIGNS (
  -- Pipeline metadata (every staging row)
  ingested_at                          TIMESTAMP_NTZ NOT NULL DEFAULT CURRENT_TIMESTAMP  COMMENT 'UTC timestamp this row arrived in Snowflake',
  account_id                           VARCHAR(64)   NOT NULL                             COMMENT 'Amazon Advertising profile_id (acts as account boundary)',
  report_id                            VARCHAR(128)  NOT NULL                             COMMENT 'Amazon v3 reportId this row came from',
  pipeline_run_id                      VARCHAR(64)   NOT NULL                             COMMENT 'Internal pipeline run UUID for lineage',

  -- Natural key
  client_id                            VARCHAR(36)   NOT NULL                             COMMENT 'Calbridge client UUID',
  campaign_id                          VARCHAR(64)   NOT NULL                             COMMENT 'Amazon campaignId',
  date                                 DATE          NOT NULL                             COMMENT 'Report date (YYYY-MM-DD)',

  -- Campaign metadata
  campaign_name                        VARCHAR(512),
  campaign_status                      VARCHAR(32),
  campaign_budget_amount               NUMBER(38,10),
  campaign_budget_type                 VARCHAR(64),
  campaign_budget_currency_code        VARCHAR(8),
  campaign_rule_based_budget_amount    NUMBER(38,10),
  campaign_applicable_budget_rule_id   VARCHAR(128),
  campaign_applicable_budget_rule_name VARCHAR(512),
  campaign_bidding_strategy            VARCHAR(64),
  portfolio_id                         VARCHAR(64),
  top_of_search_impression_share       NUMBER(38,10),

  -- Performance core
  impressions                          NUMBER(38,0),
  clicks                               NUMBER(38,0),
  cost                                 NUMBER(38,10),

  -- Purchases — all attribution windows
  purchases_1_d                        NUMBER(38,0),
  purchases_7_d                        NUMBER(38,0),
  purchases_14_d                       NUMBER(38,0),
  purchases_30_d                       NUMBER(38,0),
  purchases_same_sku_1_d               NUMBER(38,0),
  purchases_same_sku_7_d               NUMBER(38,0),
  purchases_same_sku_14_d              NUMBER(38,0),
  purchases_same_sku_30_d              NUMBER(38,0),

  -- Units sold — all windows
  units_sold_clicks_1_d                NUMBER(38,0),
  units_sold_clicks_7_d                NUMBER(38,0),
  units_sold_clicks_14_d               NUMBER(38,0),
  units_sold_clicks_30_d               NUMBER(38,0),
  units_sold_same_sku_1_d              NUMBER(38,0),
  units_sold_same_sku_7_d              NUMBER(38,0),
  units_sold_same_sku_14_d             NUMBER(38,0),
  units_sold_same_sku_30_d             NUMBER(38,0),

  -- Sales (revenue) — all windows
  sales_1_d                            NUMBER(38,10),
  sales_7_d                            NUMBER(38,10),
  sales_14_d                           NUMBER(38,10),
  sales_30_d                           NUMBER(38,10),
  attributed_sales_same_sku_1_d        NUMBER(38,10),
  attributed_sales_same_sku_7_d        NUMBER(38,10),
  attributed_sales_same_sku_14_d       NUMBER(38,10),
  attributed_sales_same_sku_30_d       NUMBER(38,10),
  sales_other_sku_7_d                  NUMBER(38,10),

  -- Misc
  add_to_list                          NUMBER(38,0),

  PRIMARY KEY (client_id, account_id, campaign_id, date, report_id)
)
COMMENT = 'Raw SP campaign-level performance. Dedup: (report_id, account_id, campaign_id, date). Never modified after insert.';


-- ============================================================
-- RAW_AMAZON_ADS.SP_AD_GROUPS
-- Raw Sponsored Products ad group-level performance rows
-- ============================================================

CREATE TABLE IF NOT EXISTS CALBRIDGE.RAW_AMAZON_ADS.SP_AD_GROUPS (
  -- Pipeline metadata
  ingested_at                          TIMESTAMP_NTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  account_id                           VARCHAR(64)   NOT NULL,
  report_id                            VARCHAR(128)  NOT NULL,
  pipeline_run_id                      VARCHAR(64)   NOT NULL,

  -- Natural key
  client_id                            VARCHAR(36)   NOT NULL,
  ad_group_id                          VARCHAR(64)   NOT NULL,
  date                                 DATE          NOT NULL,

  -- Ad group metadata
  ad_group_name                        VARCHAR(512),
  ad_status                            VARCHAR(32),

  -- Campaign context
  campaign_id                          VARCHAR(64),
  campaign_name                        VARCHAR(512),
  campaign_status                      VARCHAR(32),
  campaign_budget_amount               NUMBER(38,10),
  campaign_budget_type                 VARCHAR(64),
  campaign_budget_currency_code        VARCHAR(8),
  campaign_bidding_strategy            VARCHAR(64),
  portfolio_id                         VARCHAR(64),

  -- Performance
  impressions                          NUMBER(38,0),
  clicks                               NUMBER(38,0),
  cost                                 NUMBER(38,10),

  -- Purchases — all windows
  purchases_1_d                        NUMBER(38,0),
  purchases_7_d                        NUMBER(38,0),
  purchases_14_d                       NUMBER(38,0),
  purchases_30_d                       NUMBER(38,0),
  purchases_same_sku_1_d               NUMBER(38,0),
  purchases_same_sku_7_d               NUMBER(38,0),
  purchases_same_sku_14_d              NUMBER(38,0),
  purchases_same_sku_30_d              NUMBER(38,0),

  -- Units sold
  units_sold_clicks_1_d                NUMBER(38,0),
  units_sold_clicks_7_d                NUMBER(38,0),
  units_sold_clicks_14_d               NUMBER(38,0),
  units_sold_clicks_30_d               NUMBER(38,0),
  units_sold_same_sku_1_d              NUMBER(38,0),
  units_sold_same_sku_7_d              NUMBER(38,0),
  units_sold_same_sku_14_d             NUMBER(38,0),
  units_sold_same_sku_30_d             NUMBER(38,0),

  -- Sales
  sales_1_d                            NUMBER(38,10),
  sales_7_d                            NUMBER(38,10),
  sales_14_d                           NUMBER(38,10),
  sales_30_d                           NUMBER(38,10),
  attributed_sales_same_sku_1_d        NUMBER(38,10),
  attributed_sales_same_sku_7_d        NUMBER(38,10),
  attributed_sales_same_sku_14_d       NUMBER(38,10),
  attributed_sales_same_sku_30_d       NUMBER(38,10),

  -- Misc
  add_to_list                          NUMBER(38,0),

  PRIMARY KEY (client_id, account_id, ad_group_id, date, report_id)
)
COMMENT = 'Raw SP ad group-level performance. Dedup: (report_id, account_id, ad_group_id, date).';


-- ============================================================
-- RAW_AMAZON_ADS.SP_ADVERTISED_PRODUCTS
-- Raw Sponsored Products ASIN-level (advertised product) rows
-- ============================================================

CREATE TABLE IF NOT EXISTS CALBRIDGE.RAW_AMAZON_ADS.SP_ADVERTISED_PRODUCTS (
  -- Pipeline metadata
  ingested_at                          TIMESTAMP_NTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  account_id                           VARCHAR(64)   NOT NULL,
  report_id                            VARCHAR(128)  NOT NULL,
  pipeline_run_id                      VARCHAR(64)   NOT NULL,

  -- Natural key
  client_id                            VARCHAR(36)   NOT NULL,
  campaign_id                          VARCHAR(64)   NOT NULL,
  ad_group_id                          VARCHAR(64)   NOT NULL,
  ad_id                                VARCHAR(64)   NOT NULL,
  date                                 DATE          NOT NULL,

  -- Product metadata
  advertised_asin                      VARCHAR(32),
  advertised_sku                       VARCHAR(128),

  -- Campaign/ad group context
  campaign_name                        VARCHAR(512),
  campaign_status                      VARCHAR(32),
  campaign_budget_amount               NUMBER(38,10),
  campaign_budget_type                 VARCHAR(64),
  campaign_budget_currency_code        VARCHAR(8),
  portfolio_id                         VARCHAR(64),
  ad_group_name                        VARCHAR(512),

  -- Performance
  impressions                          NUMBER(38,0),
  clicks                               NUMBER(38,0),
  cost                                 NUMBER(38,10),

  -- Purchases — all windows
  purchases_1_d                        NUMBER(38,0),
  purchases_7_d                        NUMBER(38,0),
  purchases_14_d                       NUMBER(38,0),
  purchases_30_d                       NUMBER(38,0),
  purchases_same_sku_1_d               NUMBER(38,0),
  purchases_same_sku_7_d               NUMBER(38,0),
  purchases_same_sku_14_d              NUMBER(38,0),
  purchases_same_sku_30_d              NUMBER(38,0),

  -- Units sold
  units_sold_clicks_1_d                NUMBER(38,0),
  units_sold_clicks_7_d                NUMBER(38,0),
  units_sold_clicks_14_d               NUMBER(38,0),
  units_sold_clicks_30_d               NUMBER(38,0),
  units_sold_same_sku_1_d              NUMBER(38,0),
  units_sold_same_sku_7_d              NUMBER(38,0),
  units_sold_same_sku_14_d             NUMBER(38,0),
  units_sold_same_sku_30_d             NUMBER(38,0),
  units_sold_other_sku_7_d             NUMBER(38,0),

  -- Sales
  sales_1_d                            NUMBER(38,10),
  sales_7_d                            NUMBER(38,10),
  sales_14_d                           NUMBER(38,10),
  sales_30_d                           NUMBER(38,10),
  attributed_sales_same_sku_1_d        NUMBER(38,10),
  attributed_sales_same_sku_7_d        NUMBER(38,10),
  attributed_sales_same_sku_14_d       NUMBER(38,10),
  attributed_sales_same_sku_30_d       NUMBER(38,10),
  sales_other_sku_7_d                  NUMBER(38,10),

  PRIMARY KEY (client_id, account_id, campaign_id, ad_group_id, ad_id, date, report_id)
)
COMMENT = 'Raw SP advertised product (ASIN) performance. Dedup: (report_id, account_id, campaign_id, ad_group_id, ad_id, date).';


-- ============================================================
-- RAW_AMAZON_ADS.SP_SEARCH_TERMS
-- Raw Sponsored Products search term rows
-- ============================================================

CREATE TABLE IF NOT EXISTS CALBRIDGE.RAW_AMAZON_ADS.SP_SEARCH_TERMS (
  -- Pipeline metadata
  ingested_at                          TIMESTAMP_NTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  account_id                           VARCHAR(64)   NOT NULL,
  report_id                            VARCHAR(128)  NOT NULL,
  pipeline_run_id                      VARCHAR(64)   NOT NULL,

  -- Natural key
  client_id                            VARCHAR(36)   NOT NULL,
  campaign_id                          VARCHAR(64)   NOT NULL,
  ad_group_id                          VARCHAR(64)   NOT NULL,
  keyword_id                           VARCHAR(64)   NOT NULL,
  search_term                          VARCHAR(512)  NOT NULL,
  date                                 DATE          NOT NULL,

  -- Keyword/targeting metadata
  keyword                              VARCHAR(512),
  keyword_type                         VARCHAR(64),
  match_type                           VARCHAR(32),
  targeting                            VARCHAR(512),
  ad_keyword_status                    VARCHAR(32),
  keyword_bid                          NUMBER(38,10),

  -- Campaign/ad group context
  campaign_name                        VARCHAR(512),
  campaign_status                      VARCHAR(32),
  campaign_budget_amount               NUMBER(38,10),
  campaign_budget_type                 VARCHAR(64),
  campaign_budget_currency_code        VARCHAR(8),
  portfolio_id                         VARCHAR(64),
  ad_group_name                        VARCHAR(512),

  -- Performance
  impressions                          NUMBER(38,0),
  clicks                               NUMBER(38,0),
  cost                                 NUMBER(38,10),

  -- Purchases
  purchases_1_d                        NUMBER(38,0),
  purchases_7_d                        NUMBER(38,0),
  purchases_14_d                       NUMBER(38,0),
  purchases_30_d                       NUMBER(38,0),
  purchases_same_sku_30_d              NUMBER(38,0),

  -- Units sold
  units_sold_clicks_1_d                NUMBER(38,0),
  units_sold_clicks_7_d                NUMBER(38,0),
  units_sold_clicks_14_d               NUMBER(38,0),
  units_sold_clicks_30_d               NUMBER(38,0),

  -- Sales
  sales_1_d                            NUMBER(38,10),
  sales_7_d                            NUMBER(38,10),
  sales_14_d                           NUMBER(38,10),
  sales_30_d                           NUMBER(38,10),
  attributed_sales_same_sku_30_d       NUMBER(38,10),
  sales_other_sku_7_d                  NUMBER(38,10),

  PRIMARY KEY (client_id, account_id, campaign_id, ad_group_id, keyword_id, search_term, date, report_id)
)
COMMENT = 'Raw SP search term rows. Dedup: (report_id, account_id, campaign_id, ad_group_id, keyword_id, search_term, date).';


-- ============================================================
-- RAW_AMAZON_ADS.SB_CAMPAIGNS
-- Raw Sponsored Brands campaign-level performance rows
-- ============================================================

CREATE TABLE IF NOT EXISTS CALBRIDGE.RAW_AMAZON_ADS.SB_CAMPAIGNS (
  -- Pipeline metadata
  ingested_at                          TIMESTAMP_NTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  account_id                           VARCHAR(64)   NOT NULL,
  report_id                            VARCHAR(128)  NOT NULL,
  pipeline_run_id                      VARCHAR(64)   NOT NULL,

  -- Natural key
  client_id                            VARCHAR(36)   NOT NULL,
  campaign_id                          VARCHAR(64)   NOT NULL,
  date                                 DATE          NOT NULL,

  -- Campaign metadata
  campaign_name                        VARCHAR(512),
  campaign_status                      VARCHAR(32),
  campaign_budget_amount               NUMBER(38,10),
  campaign_budget_type                 VARCHAR(64),
  campaign_budget_currency_code        VARCHAR(8),
  cost_type                            VARCHAR(32),

  -- Performance core
  impressions                          NUMBER(38,0),
  clicks                               NUMBER(38,0),
  cost                                 NUMBER(38,10),

  -- Purchases
  purchases                            NUMBER(38,0),
  purchases_clicks                     NUMBER(38,0),
  purchases_promoted                   NUMBER(38,0),

  -- Sales
  sales                                NUMBER(38,10),
  sales_clicks                         NUMBER(38,10),
  sales_promoted                       NUMBER(38,10),

  -- Units
  units_sold                           NUMBER(38,0),
  units_sold_clicks                    NUMBER(38,0),

  -- New to brand
  new_to_brand_purchases               NUMBER(38,0),
  new_to_brand_purchases_clicks        NUMBER(38,0),
  new_to_brand_purchases_percentage    NUMBER(38,10),
  new_to_brand_purchases_rate          NUMBER(38,10),
  new_to_brand_sales                   NUMBER(38,10),
  new_to_brand_sales_clicks            NUMBER(38,10),
  new_to_brand_sales_percentage        NUMBER(38,10),
  new_to_brand_units_sold              NUMBER(38,0),
  new_to_brand_units_sold_clicks       NUMBER(38,0),
  new_to_brand_units_sold_percentage   NUMBER(38,10),
  new_to_brand_detail_page_views       NUMBER(38,0),
  new_to_brand_detail_page_views_clicks NUMBER(38,0),
  new_to_brand_detail_page_view_rate   NUMBER(38,10),
  new_to_brand_e_c_p_detail_page_view  NUMBER(38,10),

  -- Engagement
  detail_page_views                    NUMBER(38,0),
  detail_page_views_clicks             NUMBER(38,0),
  add_to_cart                          NUMBER(38,0),
  add_to_cart_clicks                   NUMBER(38,0),
  add_to_cart_rate                     NUMBER(38,10),
  branded_searches                     NUMBER(38,0),
  branded_searches_clicks              NUMBER(38,0),
  add_to_list                          NUMBER(38,0),
  add_to_list_from_clicks              NUMBER(38,0),
  brand_store_page_view                NUMBER(38,0),
  top_of_search_impression_share       NUMBER(38,10),

  -- Video
  video_5_second_views                 NUMBER(38,0),
  video_5_second_view_rate             NUMBER(38,10),
  video_complete_views                 NUMBER(38,0),
  video_first_quartile_views           NUMBER(38,0),
  video_midpoint_views                 NUMBER(38,0),
  video_third_quartile_views           NUMBER(38,0),
  video_unmutes                        NUMBER(38,0),
  viewability_rate                     NUMBER(38,10),
  viewable_impressions                 NUMBER(38,0),
  view_click_through_rate              NUMBER(38,10),

  PRIMARY KEY (client_id, account_id, campaign_id, date, report_id)
)
COMMENT = 'Raw SB campaign-level performance. Dedup: (report_id, account_id, campaign_id, date).';


-- ============================================================
-- RAW_AMAZON_ADS.SD_CAMPAIGNS
-- Raw Sponsored Display campaign-level performance rows
-- ============================================================

CREATE TABLE IF NOT EXISTS CALBRIDGE.RAW_AMAZON_ADS.SD_CAMPAIGNS (
  -- Pipeline metadata
  ingested_at                          TIMESTAMP_NTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  account_id                           VARCHAR(64)   NOT NULL,
  report_id                            VARCHAR(128)  NOT NULL,
  pipeline_run_id                      VARCHAR(64)   NOT NULL,

  -- Natural key
  client_id                            VARCHAR(36)   NOT NULL,
  campaign_id                          VARCHAR(64)   NOT NULL,
  date                                 DATE          NOT NULL,

  -- Campaign metadata
  campaign_name                        VARCHAR(512),
  campaign_status                      VARCHAR(32),
  campaign_budget_amount               NUMBER(38,10),
  campaign_budget_currency_code        VARCHAR(8),
  cost_type                            VARCHAR(32),

  -- Performance core
  impressions                          NUMBER(38,0),
  impressions_views                    NUMBER(38,0),
  clicks                               NUMBER(38,0),
  cost                                 NUMBER(38,10),

  -- Purchases
  purchases                            NUMBER(38,0),
  purchases_clicks                     NUMBER(38,0),
  purchases_promoted_clicks            NUMBER(38,0),

  -- Sales
  sales                                NUMBER(38,10),
  sales_clicks                         NUMBER(38,10),
  sales_promoted_clicks                NUMBER(38,10),

  -- Units
  units_sold                           NUMBER(38,0),
  units_sold_clicks                    NUMBER(38,0),

  -- Engagement
  detail_page_views                    NUMBER(38,0),
  detail_page_views_clicks             NUMBER(38,0),
  add_to_cart                          NUMBER(38,0),
  add_to_cart_clicks                   NUMBER(38,0),
  add_to_cart_views                    NUMBER(38,0),
  add_to_list                          NUMBER(38,0),
  add_to_list_from_clicks              NUMBER(38,0),
  add_to_list_from_views               NUMBER(38,0),
  branded_searches                     NUMBER(38,0),
  branded_searches_clicks              NUMBER(38,0),
  branded_searches_views               NUMBER(38,0),

  -- New to brand
  new_to_brand_purchases               NUMBER(38,0),
  new_to_brand_purchases_clicks        NUMBER(38,0),
  new_to_brand_sales                   NUMBER(38,10),
  new_to_brand_sales_clicks            NUMBER(38,10),
  new_to_brand_units_sold              NUMBER(38,0),
  new_to_brand_units_sold_clicks       NUMBER(38,0),
  new_to_brand_detail_page_views       NUMBER(38,0),
  new_to_brand_detail_page_view_clicks NUMBER(38,0),
  new_to_brand_detail_page_view_views  NUMBER(38,0),

  -- Reach & frequency
  cumulative_reach                     NUMBER(38,0),
  impressions_frequency_average        NUMBER(38,10),

  -- Video
  video_complete_views                 NUMBER(38,0),
  video_first_quartile_views           NUMBER(38,0),
  video_midpoint_views                 NUMBER(38,0),
  video_third_quartile_views           NUMBER(38,0),
  video_unmutes                        NUMBER(38,0),
  viewability_rate                     NUMBER(38,10),
  long_term_sales                      NUMBER(38,10),

  PRIMARY KEY (client_id, account_id, campaign_id, date, report_id)
)
COMMENT = 'Raw SD campaign-level performance. Dedup: (report_id, account_id, campaign_id, date).';


-- ============================================================
-- RAW_SP_API.LISTINGS
-- Raw merchant listings from SP-API catalog
-- ============================================================

CREATE TABLE IF NOT EXISTS CALBRIDGE.RAW_SP_API.LISTINGS (
  -- Pipeline metadata
  ingested_at                          TIMESTAMP_NTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  account_id                           VARCHAR(64)   NOT NULL  COMMENT 'sellingPartnerId',
  report_id                            VARCHAR(128)  NOT NULL  COMMENT 'Logical batch ID for this sync',
  pipeline_run_id                      VARCHAR(64)   NOT NULL,

  -- Natural key
  client_id                            VARCHAR(36)   NOT NULL,
  asin                                 VARCHAR(32)   NOT NULL,
  sku                                  VARCHAR(128),
  marketplace_id                       VARCHAR(32)   NOT NULL  DEFAULT 'ATVPDKIKX0DER',

  -- Listing data
  item_name                            VARCHAR(1000),
  brand                                VARCHAR(255),
  category                             VARCHAR(255),
  product_type                         VARCHAR(255),
  status                               VARCHAR(32),            -- Active | Inactive | Incomplete
  fulfillment_channel                  VARCHAR(32),            -- AMAZON_NA (FBA) | DEFAULT (FBM)

  -- Pricing
  price                                NUMBER(38,10),
  currency                             VARCHAR(8),

  -- BSR
  sales_rank                           NUMBER(38,0),
  sales_rank_category                  VARCHAR(255),

  -- Raw JSON blob (full API response for future use)
  raw_payload                          VARIANT,

  PRIMARY KEY (client_id, account_id, asin, marketplace_id, report_id)
)
COMMENT = 'Raw SP-API catalog/listings snapshot. One row per ASIN per sync batch.';


-- ============================================================
-- RAW_SP_API.FBA_INVENTORY
-- Raw FBA inventory levels from SP-API
-- ============================================================

CREATE TABLE IF NOT EXISTS CALBRIDGE.RAW_SP_API.FBA_INVENTORY (
  -- Pipeline metadata
  ingested_at                          TIMESTAMP_NTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  account_id                           VARCHAR(64)   NOT NULL,
  report_id                            VARCHAR(128)  NOT NULL,
  pipeline_run_id                      VARCHAR(64)   NOT NULL,

  -- Natural key
  client_id                            VARCHAR(36)   NOT NULL,
  asin                                 VARCHAR(32)   NOT NULL,
  sku                                  VARCHAR(128)  NOT NULL,
  marketplace_id                       VARCHAR(32)   NOT NULL  DEFAULT 'ATVPDKIKX0DER',
  snapshot_date                        DATE          NOT NULL  COMMENT 'Date of inventory snapshot',

  -- Inventory levels
  fn_sku                               VARCHAR(64),
  condition                            VARCHAR(32),
  fulfillable_quantity                 NUMBER(38,0),
  inbound_working_quantity             NUMBER(38,0),
  inbound_shipped_quantity             NUMBER(38,0),
  inbound_receiving_quantity           NUMBER(38,0),
  reserved_quantity_total              NUMBER(38,0),
  reserved_quantity_pending_customer   NUMBER(38,0),
  reserved_quantity_fc_processing      NUMBER(38,0),
  unfulfillable_quantity               NUMBER(38,0),
  researching_quantity_total           NUMBER(38,0),
  total_quantity                       NUMBER(38,0),

  -- Pricing
  your_price                           NUMBER(38,10),
  sales_price                          NUMBER(38,10),

  -- Days of supply (Amazon estimates)
  estimated_days_of_supply_30          NUMBER(38,0),
  estimated_days_of_supply_90          NUMBER(38,0),

  -- Raw JSON blob
  raw_payload                          VARIANT,

  PRIMARY KEY (client_id, account_id, asin, sku, marketplace_id, snapshot_date, report_id)
)
COMMENT = 'Raw FBA inventory snapshot. One row per SKU per snapshot date.';


-- ============================================================
-- RAW_SP_API.SALES_TRAFFIC
-- Raw sales and traffic data by ASIN from SP-API
-- ============================================================

CREATE TABLE IF NOT EXISTS CALBRIDGE.RAW_SP_API.SALES_TRAFFIC (
  -- Pipeline metadata
  ingested_at                          TIMESTAMP_NTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  account_id                           VARCHAR(64)   NOT NULL,
  report_id                            VARCHAR(128)  NOT NULL,
  pipeline_run_id                      VARCHAR(64)   NOT NULL,

  -- Natural key
  client_id                            VARCHAR(36)   NOT NULL,
  asin                                 VARCHAR(32)   NOT NULL,
  date                                 DATE          NOT NULL,
  marketplace_id                       VARCHAR(32)   NOT NULL  DEFAULT 'ATVPDKIKX0DER',

  -- Sales metrics
  ordered_product_sales                NUMBER(38,10),
  ordered_product_sales_b2b            NUMBER(38,10),
  total_order_items                    NUMBER(38,0),
  total_order_items_b2b                NUMBER(38,0),
  units_ordered                        NUMBER(38,0),
  units_ordered_b2b                    NUMBER(38,0),
  units_refunded                       NUMBER(38,0),
  units_shipped                        NUMBER(38,0),

  -- Traffic metrics
  browser_sessions                     NUMBER(38,0),
  browser_sessions_b2b                 NUMBER(38,0),
  mobile_app_sessions                  NUMBER(38,0),
  mobile_app_sessions_b2b              NUMBER(38,0),
  sessions                             NUMBER(38,0),
  sessions_b2b                         NUMBER(38,0),
  browser_page_views                   NUMBER(38,0),
  browser_page_views_b2b               NUMBER(38,0),
  mobile_app_page_views                NUMBER(38,0),
  mobile_app_page_views_b2b            NUMBER(38,0),
  page_views                           NUMBER(38,0),
  page_views_b2b                       NUMBER(38,0),

  -- Conversion rates
  buy_box_percentage                   NUMBER(38,10),
  buy_box_percentage_b2b               NUMBER(38,10),
  unit_session_percentage              NUMBER(38,10),
  unit_session_percentage_b2b          NUMBER(38,10),

  -- Feedback
  feedback_received                    NUMBER(38,0),
  negative_feedback_received           NUMBER(38,0),
  return_dissatisfied_count            NUMBER(38,0),

  -- Raw JSON blob
  raw_payload                          VARIANT,

  PRIMARY KEY (client_id, account_id, asin, date, marketplace_id, report_id)
)
COMMENT = 'Raw SP-API sales and traffic report by ASIN and date.';


-- ============================================================
-- ANALYTICS.ADS_PERFORMANCE
-- Canonical ads metrics — all ad types (SP, SB, SD) unified
-- Updated via MERGE; supports late-arriving data
-- ============================================================

CREATE TABLE IF NOT EXISTS CALBRIDGE.ANALYTICS.ADS_PERFORMANCE (
  -- Lineage
  source_report_id                     VARCHAR(128)  NOT NULL  COMMENT 'report_id from source staging row',
  transform_version                    VARCHAR(32)   NOT NULL  DEFAULT '1.0' COMMENT 'Version of the transform that created this row',
  updated_at                           TIMESTAMP_NTZ NOT NULL  DEFAULT CURRENT_TIMESTAMP COMMENT 'Last time this row was written/updated',

  -- Grain
  client_id                            VARCHAR(36)   NOT NULL,
  account_id                           VARCHAR(64)   NOT NULL  COMMENT 'Amazon Ads profile_id',
  ad_type                              VARCHAR(32)   NOT NULL  COMMENT 'SP | SB | SD',
  campaign_id                          VARCHAR(64)   NOT NULL,
  date                                 DATE          NOT NULL,

  -- Optional sub-grain (nullable for campaign-level rows)
  ad_group_id                          VARCHAR(64),
  asin                                 VARCHAR(32),

  -- Campaign metadata
  campaign_name                        VARCHAR(512),
  campaign_status                      VARCHAR(32),
  campaign_budget_amount               NUMBER(38,10),
  campaign_budget_currency_code        VARCHAR(8),

  -- Core performance
  impressions                          NUMBER(38,0)  NOT NULL DEFAULT 0,
  clicks                               NUMBER(38,0)  NOT NULL DEFAULT 0,
  cost                                 NUMBER(38,10) NOT NULL DEFAULT 0  COMMENT 'Ad spend in local currency',

  -- Conversions (30-day window, unified across ad types)
  purchases_30d                        NUMBER(38,0),
  sales_30d                            NUMBER(38,10),
  units_sold_30d                       NUMBER(38,0),

  -- New to brand (SB/SD only)
  new_to_brand_purchases               NUMBER(38,0),
  new_to_brand_sales                   NUMBER(38,10),

  -- Engagement (SB/SD)
  detail_page_views                    NUMBER(38,0),
  add_to_cart                          NUMBER(38,0),

  -- Derived (calculated at transform time — not source data)
  acos                                 NUMBER(38,10) COMMENT 'cost / sales_30d * 100',
  roas                                 NUMBER(38,10) COMMENT 'sales_30d / cost',
  ctr                                  NUMBER(38,10) COMMENT 'clicks / impressions',
  cpc                                  NUMBER(38,10) COMMENT 'cost / clicks',
  cvr                                  NUMBER(38,10) COMMENT 'purchases_30d / clicks',

  -- Pipeline context
  pipeline_run_id                      VARCHAR(64)   NOT NULL,

  PRIMARY KEY (client_id, account_id, ad_type, campaign_id, date)
)
COMMENT = 'Canonical ads performance — SP/SB/SD unified at campaign grain. Supports late data via MERGE. Derived metrics (ACoS, ROAS) computed at transform time.';


-- ============================================================
-- ANALYTICS.RETAIL_PERFORMANCE
-- Canonical retail/sales metrics — normalized from SP-API sales_traffic
-- ============================================================

CREATE TABLE IF NOT EXISTS CALBRIDGE.ANALYTICS.RETAIL_PERFORMANCE (
  -- Lineage
  source_report_id                     VARCHAR(128)  NOT NULL,
  transform_version                    VARCHAR(32)   NOT NULL  DEFAULT '1.0',
  updated_at                           TIMESTAMP_NTZ NOT NULL  DEFAULT CURRENT_TIMESTAMP,

  -- Grain
  client_id                            VARCHAR(36)   NOT NULL,
  account_id                           VARCHAR(64)   NOT NULL  COMMENT 'sellingPartnerId',
  asin                                 VARCHAR(32)   NOT NULL,
  date                                 DATE          NOT NULL,
  marketplace_id                       VARCHAR(32)   NOT NULL  DEFAULT 'ATVPDKIKX0DER',

  -- Sales
  ordered_revenue                      NUMBER(38,10),
  units_ordered                        NUMBER(38,0),
  total_order_items                    NUMBER(38,0),
  units_refunded                       NUMBER(38,0),
  units_shipped                        NUMBER(38,0),

  -- Traffic
  sessions                             NUMBER(38,0),
  page_views                           NUMBER(38,0),
  buy_box_percentage                   NUMBER(38,10),
  unit_session_percentage              NUMBER(38,10) COMMENT 'Conversion rate (organic)',

  -- B2B breakdown
  ordered_revenue_b2b                  NUMBER(38,10),
  units_ordered_b2b                    NUMBER(38,0),
  sessions_b2b                         NUMBER(38,0),

  -- Pipeline context
  pipeline_run_id                      VARCHAR(64)   NOT NULL,

  PRIMARY KEY (client_id, account_id, asin, date, marketplace_id)
)
COMMENT = 'Canonical retail performance (orders, revenue, traffic) from SP-API. One row per ASIN per day.';


-- ============================================================
-- ANALYTICS.INVENTORY_SNAPSHOT
-- Canonical FBA inventory levels — latest snapshot per ASIN
-- ============================================================

CREATE TABLE IF NOT EXISTS CALBRIDGE.ANALYTICS.INVENTORY_SNAPSHOT (
  -- Lineage
  source_report_id                     VARCHAR(128)  NOT NULL,
  transform_version                    VARCHAR(32)   NOT NULL  DEFAULT '1.0',
  updated_at                           TIMESTAMP_NTZ NOT NULL  DEFAULT CURRENT_TIMESTAMP,

  -- Grain
  client_id                            VARCHAR(36)   NOT NULL,
  account_id                           VARCHAR(64)   NOT NULL,
  asin                                 VARCHAR(32)   NOT NULL,
  sku                                  VARCHAR(128)  NOT NULL,
  marketplace_id                       VARCHAR(32)   NOT NULL  DEFAULT 'ATVPDKIKX0DER',
  snapshot_date                        DATE          NOT NULL,

  -- Inventory levels
  fulfillable_quantity                 NUMBER(38,0),
  inbound_quantity                     NUMBER(38,0)  COMMENT 'inbound_working + inbound_shipped + inbound_receiving',
  reserved_quantity                    NUMBER(38,0),
  unfulfillable_quantity               NUMBER(38,0),
  total_quantity                       NUMBER(38,0),

  -- Restock signals
  estimated_days_of_supply_30          NUMBER(38,0)  COMMENT 'Amazon estimate: days of supply based on 30-day sales rate',
  estimated_days_of_supply_90          NUMBER(38,0)  COMMENT 'Amazon estimate: days of supply based on 90-day sales rate',
  restock_alert                        BOOLEAN       DEFAULT FALSE COMMENT 'TRUE if days_of_supply_30 < 30',

  -- Pricing context
  your_price                           NUMBER(38,10),

  -- Pipeline context
  pipeline_run_id                      VARCHAR(64)   NOT NULL,

  PRIMARY KEY (client_id, account_id, asin, sku, marketplace_id, snapshot_date)
)
COMMENT = 'Canonical FBA inventory snapshot. One row per SKU per snapshot date. restock_alert flags < 30 days supply.';


-- ============================================================
-- PIPELINE.FRESHNESS
-- Per-table, per-account last successful load timestamp
-- Queried by orchestrator and dashboard to show data freshness
-- ============================================================

CREATE TABLE IF NOT EXISTS CALBRIDGE.PIPELINE.FRESHNESS (
  table_name                           VARCHAR(255)  NOT NULL  COMMENT 'Fully-qualified table name e.g. CALBRIDGE.RAW_AMAZON_ADS.SP_CAMPAIGNS',
  account_id                           VARCHAR(64)   NOT NULL  COMMENT 'Amazon account (profile_id or sellingPartnerId)',
  client_id                            VARCHAR(36)   NOT NULL,

  -- Freshness tracking
  last_successful_load_at              TIMESTAMP_NTZ NOT NULL  COMMENT 'UTC timestamp of last successful pipeline run for this table+account',
  last_successful_report_date          DATE                    COMMENT 'Latest report date successfully loaded',
  last_pipeline_run_id                 VARCHAR(64)             COMMENT 'pipeline_run_id of the run that set this freshness entry',
  row_count_last_run                   NUMBER(38,0)            COMMENT 'Rows written in the last successful run',

  -- Staleness tracking
  staleness_threshold_hours            NUMBER(10,2)  DEFAULT 25  COMMENT 'Alert if last_successful_load_at is older than this',
  is_stale                             BOOLEAN       DEFAULT FALSE COMMENT 'Recomputed by pipeline health check',

  updated_at                           TIMESTAMP_NTZ NOT NULL  DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (table_name, account_id, client_id)
)
COMMENT = 'Data freshness registry — one row per (table, account, client). Orchestrator and dashboard query this to show staleness.';


-- ============================================================
-- PIPELINE.QUALITY_LOG
-- Quality check results per pipeline run
-- ============================================================

CREATE TABLE IF NOT EXISTS CALBRIDGE.PIPELINE.QUALITY_LOG (
  log_id                               VARCHAR(36)   NOT NULL  DEFAULT UUID_STRING()  COMMENT 'UUID for this quality check result',
  run_id                               VARCHAR(64)   NOT NULL  COMMENT 'pipeline_run_id this check belongs to',
  checked_at                           TIMESTAMP_NTZ NOT NULL  DEFAULT CURRENT_TIMESTAMP,

  -- Check scope
  table_name                           VARCHAR(255)  NOT NULL,
  account_id                           VARCHAR(64)   NOT NULL,
  client_id                            VARCHAR(36)   NOT NULL,

  -- Check identity
  assertion                            VARCHAR(512)  NOT NULL  COMMENT 'Short description e.g. "no_null_campaign_id", "spend_not_negative", "row_count_gt_0"',
  check_type                           VARCHAR(64)   NOT NULL  COMMENT 'null_check | range_check | row_count | anomaly | referential',
  report_date                          DATE,

  -- Result
  status                               VARCHAR(16)   NOT NULL  COMMENT 'PASS | FAIL | WARN',
  rows_checked                         NUMBER(38,0),
  rows_failed                          NUMBER(38,0),
  failure_detail                       VARCHAR(2000) COMMENT 'Human-readable detail for FAIL/WARN',

  PRIMARY KEY (log_id)
)
COMMENT = 'Quality check log. Every post-load assertion result is recorded here. FAIL status surfaces to orchestrator.';


-- ============================================================
-- PIPELINE.JOB_RUNS
-- Job execution log — full audit trail of all pipeline runs
-- ============================================================

CREATE TABLE IF NOT EXISTS CALBRIDGE.PIPELINE.JOB_RUNS (
  job_id                               VARCHAR(36)   NOT NULL  DEFAULT UUID_STRING()  COMMENT 'UUID for this job execution',
  pipeline_run_id                      VARCHAR(64)   NOT NULL  COMMENT 'Parent pipeline run (may span multiple job_ids)',

  -- Job identity
  job_type                             VARCHAR(64)   NOT NULL  COMMENT 'ingest_sp_campaigns | ingest_sp_search_terms | transform_ads_performance | etc.',
  account_id                           VARCHAR(64)   NOT NULL,
  client_id                            VARCHAR(36)   NOT NULL,

  -- Timing
  started_at                           TIMESTAMP_NTZ NOT NULL  DEFAULT CURRENT_TIMESTAMP,
  completed_at                         TIMESTAMP_NTZ,
  duration_seconds                     NUMBER(10,2)  COMMENT 'Computed: completed_at - started_at',

  -- Outcome
  status                               VARCHAR(16)   NOT NULL  DEFAULT 'RUNNING'  COMMENT 'RUNNING | SUCCESS | FAILED | RETRYING | SKIPPED',
  error_message                        VARCHAR(5000),
  retry_count                          NUMBER(10,0)  NOT NULL  DEFAULT 0,

  -- Volume
  rows_read                            NUMBER(38,0)  DEFAULT 0 COMMENT 'Source rows read / API records fetched',
  rows_written                         NUMBER(38,0)  DEFAULT 0 COMMENT 'Rows written to target table',
  rows_skipped                         NUMBER(38,0)  DEFAULT 0 COMMENT 'Rows skipped (dedup, filter)',

  -- Context
  source_table                         VARCHAR(255)  COMMENT 'Source staging table if this is a transform job',
  target_table                         VARCHAR(255)  COMMENT 'Target table written to',
  date_range_start                     DATE          COMMENT 'Report date range covered by this run',
  date_range_end                       DATE,

  PRIMARY KEY (job_id)
)
COMMENT = 'Full job execution audit log. Every pipeline job (ingest + transform) writes a row here. Supports retry tracking and SLA monitoring.';


-- ============================================================
-- ADS_REPORT_QUEUE (in default SANDBOX schema — already in codebase)
-- Referenced here for completeness; not recreated since it exists.
-- Table: CALBRIDGE.SANDBOX.ADS_REPORT_QUEUE
-- ============================================================
