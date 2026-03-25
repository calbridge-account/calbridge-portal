-- Amazon Ads Schema Migration
-- Matches legacy Fivetran schema from ATCURRYMEDIA_DWH_DB.AMAZON_ADS
-- All tables include client_id + profile_id for multi-tenant isolation
-- Run via ensureAdsSchema() in adsIngestion.js

-- ============================================================
-- SPONSORED PRODUCTS — REPORTING TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS sp_campaign_report (
  client_id                           VARCHAR(36)   NOT NULL,
  profile_id                          VARCHAR(36)   NOT NULL,
  campaign_id                         VARCHAR(64)   NOT NULL,
  date                                DATE          NOT NULL,
  campaign_name                       VARCHAR(512),
  campaign_budget_amount              FLOAT,
  campaign_budget_type                VARCHAR(64),
  campaign_budget_currency_code       VARCHAR(8),
  campaign_bidding_strategy           VARCHAR(64),
  top_of_search_impression_share      FLOAT,
  impressions                         NUMBER,
  clicks                              NUMBER,
  cost                                FLOAT,
  purchases_1_d                       NUMBER,
  purchases_7_d                       NUMBER,
  purchases_14_d                      NUMBER,
  purchases_30_d                      NUMBER,
  sales_1_d                           FLOAT,
  sales_7_d                           FLOAT,
  sales_14_d                          FLOAT,
  sales_30_d                          FLOAT,
  units_sold_clicks_1_d               NUMBER,
  units_sold_clicks_7_d               NUMBER,
  units_sold_clicks_14_d              NUMBER,
  units_sold_clicks_30_d              NUMBER,
  synced_at                           TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (client_id, profile_id, campaign_id, date)
);

CREATE TABLE IF NOT EXISTS sp_ad_group_report (
  client_id                           VARCHAR(36)   NOT NULL,
  profile_id                          VARCHAR(36)   NOT NULL,
  ad_group_id                         VARCHAR(64)   NOT NULL,
  date                                DATE          NOT NULL,
  ad_group_name                       VARCHAR(512),
  impressions                         NUMBER,
  clicks                              NUMBER,
  cost                                FLOAT,
  purchases_1_d                       NUMBER,
  purchases_7_d                       NUMBER,
  purchases_14_d                      NUMBER,
  purchases_30_d                      NUMBER,
  sales_1_d                           FLOAT,
  sales_7_d                           FLOAT,
  sales_14_d                          FLOAT,
  sales_30_d                          FLOAT,
  units_sold_clicks_1_d               NUMBER,
  units_sold_clicks_7_d               NUMBER,
  units_sold_clicks_14_d              NUMBER,
  units_sold_clicks_30_d              NUMBER,
  synced_at                           TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (client_id, profile_id, ad_group_id, date)
);

CREATE TABLE IF NOT EXISTS sp_targeting_keyword_report (
  client_id                           VARCHAR(36)   NOT NULL,
  profile_id                          VARCHAR(36)   NOT NULL,
  campaign_id                         VARCHAR(64)   NOT NULL,
  ad_group_id                         VARCHAR(64)   NOT NULL,
  keyword_id                          VARCHAR(64)   NOT NULL,
  date                                DATE          NOT NULL,
  targeting                           VARCHAR(1024),
  match_type                          VARCHAR(32),
  keyword_bid                         FLOAT,
  ad_keyword_status                   VARCHAR(32),
  top_of_search_impression_share      FLOAT,
  impressions                         NUMBER,
  clicks                              NUMBER,
  cost                                FLOAT,
  purchases_1_d                       NUMBER,
  purchases_7_d                       NUMBER,
  purchases_14_d                      NUMBER,
  purchases_30_d                      NUMBER,
  sales_1_d                           FLOAT,
  sales_7_d                           FLOAT,
  sales_14_d                          FLOAT,
  sales_30_d                          FLOAT,
  units_sold_clicks_1_d               NUMBER,
  units_sold_clicks_7_d               NUMBER,
  units_sold_clicks_14_d              NUMBER,
  units_sold_clicks_30_d              NUMBER,
  synced_at                           TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (client_id, profile_id, campaign_id, ad_group_id, keyword_id, date)
);

CREATE TABLE IF NOT EXISTS sp_search_term_report (
  client_id                           VARCHAR(36)   NOT NULL,
  profile_id                          VARCHAR(36)   NOT NULL,
  campaign_id                         VARCHAR(64)   NOT NULL,
  ad_group_id                         VARCHAR(64)   NOT NULL,
  keyword_id                          VARCHAR(64)   NOT NULL,
  search_term                         VARCHAR(1024) NOT NULL,
  date                                DATE          NOT NULL,
  targeting                           VARCHAR(1024),
  match_type                          VARCHAR(32),
  impressions                         NUMBER,
  clicks                              NUMBER,
  cost                                FLOAT,
  purchases_1_d                       NUMBER,
  purchases_7_d                       NUMBER,
  purchases_14_d                      NUMBER,
  purchases_30_d                      NUMBER,
  sales_1_d                           FLOAT,
  sales_7_d                           FLOAT,
  sales_14_d                          FLOAT,
  sales_30_d                          FLOAT,
  units_sold_clicks_1_d               NUMBER,
  units_sold_clicks_7_d               NUMBER,
  units_sold_clicks_14_d              NUMBER,
  units_sold_clicks_30_d              NUMBER,
  synced_at                           TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (client_id, profile_id, campaign_id, ad_group_id, keyword_id, search_term, date)
);

CREATE TABLE IF NOT EXISTS sp_advertised_product_report (
  client_id                           VARCHAR(36)   NOT NULL,
  profile_id                          VARCHAR(36)   NOT NULL,
  campaign_id                         VARCHAR(64)   NOT NULL,
  ad_group_id                         VARCHAR(64)   NOT NULL,
  ad_id                               VARCHAR(64)   NOT NULL,
  date                                DATE          NOT NULL,
  advertised_asin                     VARCHAR(20),
  advertised_sku                      VARCHAR(256),
  impressions                         NUMBER,
  clicks                              NUMBER,
  cost                                FLOAT,
  purchases_1_d                       NUMBER,
  purchases_7_d                       NUMBER,
  purchases_14_d                      NUMBER,
  purchases_30_d                      NUMBER,
  sales_1_d                           FLOAT,
  sales_7_d                           FLOAT,
  sales_14_d                          FLOAT,
  sales_30_d                          FLOAT,
  units_sold_clicks_1_d               NUMBER,
  units_sold_clicks_7_d               NUMBER,
  units_sold_clicks_14_d              NUMBER,
  units_sold_clicks_30_d              NUMBER,
  purchases_same_sku_30_d             NUMBER,
  units_sold_same_sku_30_d            NUMBER,
  synced_at                           TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (client_id, profile_id, campaign_id, ad_group_id, ad_id, date)
);

CREATE TABLE IF NOT EXISTS sp_campaign_placement_report (
  client_id                           VARCHAR(36)   NOT NULL,
  profile_id                          VARCHAR(36)   NOT NULL,
  campaign_id                         VARCHAR(64)   NOT NULL,
  placement                           VARCHAR(256)  NOT NULL,
  date                                DATE          NOT NULL,
  impressions                         NUMBER,
  clicks                              NUMBER,
  cost                                FLOAT,
  purchases_30_d                      NUMBER,
  sales_30_d                          FLOAT,
  units_sold_clicks_30_d              NUMBER,
  synced_at                           TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (client_id, profile_id, campaign_id, placement, date)
);

-- ============================================================
-- SPONSORED BRANDS — REPORTING TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS sb_campaign_report (
  client_id                                   VARCHAR(36)   NOT NULL,
  profile_id                                  VARCHAR(36)   NOT NULL,
  campaign_id                                 VARCHAR(64)   NOT NULL,
  report_date                                 DATE          NOT NULL,
  campaign_name                               VARCHAR(512),
  top_of_search_impression_share              FLOAT,
  impressions                                 NUMBER,
  clicks                                      NUMBER,
  cost                                        FLOAT,
  attributed_sales_14_d                       FLOAT,
  attributed_conversions_14_d                 NUMBER,
  attributed_orders_new_to_brand_14_d         NUMBER,
  attributed_sales_new_to_brand_14_d          FLOAT,
  attributed_units_ordered_new_to_brand_14_d  NUMBER,
  video_5_second_views                        NUMBER,
  video_complete_views                        NUMBER,
  viewable_impressions                        NUMBER,
  synced_at                                   TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (client_id, profile_id, campaign_id, report_date)
);

CREATE TABLE IF NOT EXISTS sb_keyword_report (
  client_id                                   VARCHAR(36)   NOT NULL,
  profile_id                                  VARCHAR(36)   NOT NULL,
  keyword_id                                  VARCHAR(64)   NOT NULL,
  report_date                                 DATE          NOT NULL,
  campaign_id                                 VARCHAR(64),
  ad_group_id                                 VARCHAR(64),
  top_of_search_impression_share              FLOAT,
  search_term_impression_rank                 FLOAT,
  search_term_impression_share                FLOAT,
  impressions                                 NUMBER,
  clicks                                      NUMBER,
  cost                                        FLOAT,
  attributed_sales_14_d                       FLOAT,
  attributed_conversions_14_d                 NUMBER,
  attributed_orders_new_to_brand_14_d         NUMBER,
  attributed_sales_new_to_brand_14_d          FLOAT,
  synced_at                                   TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (client_id, profile_id, keyword_id, report_date)
);

CREATE TABLE IF NOT EXISTS sb_search_term_report (
  client_id                                   VARCHAR(36)   NOT NULL,
  profile_id                                  VARCHAR(36)   NOT NULL,
  keyword_id                                  VARCHAR(64)   NOT NULL,
  query_term                                  VARCHAR(1024) NOT NULL,
  report_date                                 DATE          NOT NULL,
  campaign_id                                 VARCHAR(64),
  ad_group_id                                 VARCHAR(64),
  search_term_impression_rank                 FLOAT,
  search_term_impression_share                FLOAT,
  impressions                                 NUMBER,
  clicks                                      NUMBER,
  cost                                        FLOAT,
  attributed_sales_14_d                       FLOAT,
  attributed_conversions_14_d                 NUMBER,
  synced_at                                   TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (client_id, profile_id, keyword_id, query_term, report_date)
);

CREATE TABLE IF NOT EXISTS sb_target_report (
  client_id                                   VARCHAR(36)   NOT NULL,
  profile_id                                  VARCHAR(36)   NOT NULL,
  target_id                                   VARCHAR(64)   NOT NULL,
  report_date                                 DATE          NOT NULL,
  campaign_id                                 VARCHAR(64),
  ad_group_id                                 VARCHAR(64),
  top_of_search_impression_share              FLOAT,
  impressions                                 NUMBER,
  clicks                                      NUMBER,
  cost                                        FLOAT,
  attributed_sales_14_d                       FLOAT,
  attributed_conversions_14_d                 NUMBER,
  attributed_orders_new_to_brand_14_d         NUMBER,
  attributed_sales_new_to_brand_14_d          FLOAT,
  synced_at                                   TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (client_id, profile_id, target_id, report_date)
);

CREATE TABLE IF NOT EXISTS sb_placement_report (
  client_id                                   VARCHAR(36)   NOT NULL,
  profile_id                                  VARCHAR(36)   NOT NULL,
  campaign_id                                 VARCHAR(64)   NOT NULL,
  placement                                   VARCHAR(256)  NOT NULL,
  report_date                                 DATE          NOT NULL,
  impressions                                 NUMBER,
  clicks                                      NUMBER,
  cost                                        FLOAT,
  attributed_sales_14_d                       FLOAT,
  attributed_conversions_14_d                 NUMBER,
  attributed_orders_new_to_brand_14_d         NUMBER,
  attributed_sales_new_to_brand_14_d          FLOAT,
  synced_at                                   TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (client_id, profile_id, campaign_id, placement, report_date)
);

-- ============================================================
-- SPONSORED DISPLAY — REPORTING TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS sd_campaign_report (
  client_id                           VARCHAR(36)   NOT NULL,
  profile_id                          VARCHAR(36)   NOT NULL,
  campaign_id                         VARCHAR(64)   NOT NULL,
  date                                DATE          NOT NULL,
  campaign_name                       VARCHAR(512),
  impressions                         NUMBER,
  clicks                              NUMBER,
  cost                                FLOAT,
  purchases                           NUMBER,
  purchases_clicks                    NUMBER,
  sales                               FLOAT,
  sales_clicks                        FLOAT,
  detail_page_views                   NUMBER,
  detail_page_views_clicks            NUMBER,
  add_to_cart                         NUMBER,
  add_to_cart_clicks                  NUMBER,
  new_to_brand_purchases              NUMBER,
  new_to_brand_sales                  FLOAT,
  new_to_brand_units_sold             NUMBER,
  branded_searches                    NUMBER,
  viewability_rate                    FLOAT,
  synced_at                           TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (client_id, profile_id, campaign_id, date)
);

CREATE TABLE IF NOT EXISTS sd_ad_group_report (
  client_id                           VARCHAR(36)   NOT NULL,
  profile_id                          VARCHAR(36)   NOT NULL,
  ad_group_id                         VARCHAR(64)   NOT NULL,
  campaign_id                         VARCHAR(64),
  date                                DATE          NOT NULL,
  impressions                         NUMBER,
  clicks                              NUMBER,
  cost                                FLOAT,
  purchases                           NUMBER,
  purchases_clicks                    NUMBER,
  sales                               FLOAT,
  sales_clicks                        FLOAT,
  detail_page_views                   NUMBER,
  add_to_cart                         NUMBER,
  new_to_brand_purchases              NUMBER,
  new_to_brand_sales                  FLOAT,
  new_to_brand_units_sold             NUMBER,
  synced_at                           TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (client_id, profile_id, ad_group_id, date)
);

CREATE TABLE IF NOT EXISTS sd_target_report (
  client_id                           VARCHAR(36)   NOT NULL,
  profile_id                          VARCHAR(36)   NOT NULL,
  ad_group_id                         VARCHAR(64)   NOT NULL,
  campaign_id                         VARCHAR(64)   NOT NULL,
  targeting_id                        VARCHAR(64)   NOT NULL,
  date                                DATE          NOT NULL,
  impressions                         NUMBER,
  clicks                              NUMBER,
  cost                                FLOAT,
  purchases                           NUMBER,
  purchases_clicks                    NUMBER,
  sales                               FLOAT,
  sales_clicks                        FLOAT,
  detail_page_views                   NUMBER,
  add_to_cart                         NUMBER,
  new_to_brand_purchases              NUMBER,
  new_to_brand_sales                  FLOAT,
  new_to_brand_units_sold             NUMBER,
  synced_at                           TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (client_id, profile_id, ad_group_id, campaign_id, targeting_id, date)
);

CREATE TABLE IF NOT EXISTS sd_product_ad_report (
  client_id                           VARCHAR(36)   NOT NULL,
  profile_id                          VARCHAR(36)   NOT NULL,
  ad_id                               VARCHAR(64)   NOT NULL,
  ad_group_id                         VARCHAR(64),
  campaign_id                         VARCHAR(64),
  date                                DATE          NOT NULL,
  impressions                         NUMBER,
  clicks                              NUMBER,
  cost                                FLOAT,
  purchases                           NUMBER,
  purchases_clicks                    NUMBER,
  sales                               FLOAT,
  sales_clicks                        FLOAT,
  detail_page_views                   NUMBER,
  add_to_cart                         NUMBER,
  new_to_brand_purchases              NUMBER,
  new_to_brand_sales                  FLOAT,
  new_to_brand_units_sold             NUMBER,
  synced_at                           TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (client_id, profile_id, ad_id, date)
);

-- ============================================================
-- ENTITY HISTORY TABLES (SP)
-- ============================================================

CREATE TABLE IF NOT EXISTS sp_campaign_history (
  client_id                           VARCHAR(36)   NOT NULL,
  profile_id                          VARCHAR(36),
  campaign_id                         VARCHAR(64)   NOT NULL,
  campaign_name                       VARCHAR(512),
  campaign_type                       VARCHAR(64),
  targeting_type                      VARCHAR(64),
  state                               VARCHAR(32),
  budget                              FLOAT,
  budget_type                         VARCHAR(64),
  start_date                          DATE,
  end_date                            DATE,
  premium_bid_adjustment              BOOLEAN,
  bidding_strategy                    VARCHAR(64),
  portfolio_id                        VARCHAR(64),
  creation_date                       TIMESTAMP_NTZ,
  last_updated_date                   TIMESTAMP_NTZ,
  serving_status                      VARCHAR(64),
  synced_at                           TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (client_id, campaign_id, last_updated_date)
);

CREATE TABLE IF NOT EXISTS sp_ad_group_history (
  client_id                           VARCHAR(36)   NOT NULL,
  profile_id                          VARCHAR(36),
  ad_group_id                         VARCHAR(64)   NOT NULL,
  campaign_id                         VARCHAR(64),
  ad_group_name                       VARCHAR(512),
  default_bid                         FLOAT,
  state                               VARCHAR(32),
  creation_date                       TIMESTAMP_NTZ,
  last_updated_date                   TIMESTAMP_NTZ,
  serving_status                      VARCHAR(64),
  synced_at                           TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (client_id, ad_group_id, last_updated_date)
);

CREATE TABLE IF NOT EXISTS sp_keyword_history (
  client_id                           VARCHAR(36)   NOT NULL,
  profile_id                          VARCHAR(36),
  keyword_id                          VARCHAR(64)   NOT NULL,
  campaign_id                         VARCHAR(64),
  ad_group_id                         VARCHAR(64),
  keyword_text                        VARCHAR(1024),
  match_type                          VARCHAR(32),
  bid                                 FLOAT,
  state                               VARCHAR(32),
  creation_date                       TIMESTAMP_NTZ,
  last_updated_date                   TIMESTAMP_NTZ,
  serving_status                      VARCHAR(64),
  synced_at                           TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (client_id, keyword_id, last_updated_date)
);

CREATE TABLE IF NOT EXISTS sp_product_ad_history (
  client_id                           VARCHAR(36)   NOT NULL,
  profile_id                          VARCHAR(36),
  ad_id                               VARCHAR(64)   NOT NULL,
  campaign_id                         VARCHAR(64),
  ad_group_id                         VARCHAR(64),
  asin                                VARCHAR(20),
  sku                                 VARCHAR(256),
  state                               VARCHAR(32),
  creation_date                       TIMESTAMP_NTZ,
  last_updated_date                   TIMESTAMP_NTZ,
  serving_status                      VARCHAR(64),
  synced_at                           TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (client_id, ad_id, last_updated_date)
);

CREATE TABLE IF NOT EXISTS sp_portfolio_history (
  client_id                           VARCHAR(36)   NOT NULL,
  profile_id                          VARCHAR(36),
  portfolio_id                        VARCHAR(64)   NOT NULL,
  portfolio_name                      VARCHAR(512),
  state                               VARCHAR(32),
  budget_amount                       FLOAT,
  budget_currency_code                VARCHAR(8),
  budget_policy                       VARCHAR(32),
  budget_start_date                   DATE,
  budget_end_date                     DATE,
  in_budget                           BOOLEAN,
  creation_date                       TIMESTAMP_NTZ,
  last_updated_date                   TIMESTAMP_NTZ,
  synced_at                           TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (client_id, portfolio_id, last_updated_date)
);

-- ============================================================
-- ENTITY HISTORY TABLES (SB)
-- ============================================================

CREATE TABLE IF NOT EXISTS sb_campaign_history (
  client_id                           VARCHAR(36)   NOT NULL,
  profile_id                          VARCHAR(36),
  campaign_id                         VARCHAR(64)   NOT NULL,
  campaign_name                       VARCHAR(512),
  campaign_type                       VARCHAR(64),
  targeting_type                      VARCHAR(64),
  state                               VARCHAR(32),
  budget                              FLOAT,
  budget_type                         VARCHAR(64),
  start_date                          DATE,
  end_date                            DATE,
  serving_status                      VARCHAR(64),
  creation_date                       TIMESTAMP_NTZ,
  last_updated_date                   TIMESTAMP_NTZ,
  synced_at                           TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (client_id, campaign_id, last_updated_date)
);

CREATE TABLE IF NOT EXISTS sb_keyword (
  client_id                           VARCHAR(36)   NOT NULL,
  profile_id                          VARCHAR(36),
  keyword_id                          VARCHAR(64)   NOT NULL,
  campaign_id                         VARCHAR(64),
  ad_group_id                         VARCHAR(64),
  keyword_text                        VARCHAR(1024),
  match_type                          VARCHAR(32),
  bid                                 FLOAT,
  state                               VARCHAR(32),
  serving_status                      VARCHAR(64),
  creation_date                       TIMESTAMP_NTZ,
  last_updated_date                   TIMESTAMP_NTZ,
  synced_at                           TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (client_id, keyword_id)
);

-- ============================================================
-- ENTITY HISTORY TABLES (SD)
-- ============================================================

CREATE TABLE IF NOT EXISTS sd_campaign_history (
  client_id                           VARCHAR(36)   NOT NULL,
  profile_id                          VARCHAR(36),
  campaign_id                         VARCHAR(64)   NOT NULL,
  campaign_name                       VARCHAR(512),
  campaign_type                       VARCHAR(64),
  targeting_type                      VARCHAR(64),
  state                               VARCHAR(32),
  budget                              FLOAT,
  budget_type                         VARCHAR(64),
  start_date                          DATE,
  end_date                            DATE,
  cost_type                           VARCHAR(64),
  delivery_profile                    VARCHAR(64),
  serving_status                      VARCHAR(64),
  creation_date                       TIMESTAMP_NTZ,
  last_updated_date                   TIMESTAMP_NTZ,
  synced_at                           TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (client_id, campaign_id, last_updated_date)
);
