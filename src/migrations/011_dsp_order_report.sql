-- Migration 011: Clean DSP table architecture
-- Replaces fragmented dsp_raw_campaign + dsp_raw_flight with two purpose-built tables.
-- ORDER_ID is VARCHAR (json-bigint storeAsString) — no 64-bit truncation.

-- ── dsp_order_report: order-level grain (replaces dsp_raw_campaign + dsp_raw_flight combined) ──
CREATE TABLE IF NOT EXISTS CALBRIDGE_PROD.APP.dsp_order_report (
  advertiser_id                 VARCHAR,
  profile_id                    VARCHAR       NOT NULL,
  client_id                     VARCHAR       NOT NULL,
  date                          DATE          NOT NULL,
  order_id                      VARCHAR       NOT NULL,
  order_name                    VARCHAR,
  advertiser_name               VARCHAR,
  order_budget                  FLOAT,
  order_start_date              DATE,
  order_end_date                DATE,
  order_currency                VARCHAR,
  entity_id                     VARCHAR,
  impressions                   BIGINT,
  clicks                        BIGINT,
  total_cost                    FLOAT,
  viewable_impressions          FLOAT,
  viewability_rate              FLOAT,
  detail_page_views             FLOAT,
  detail_page_view_clicks       FLOAT,
  add_to_cart                   FLOAT,
  add_to_cart_clicks            FLOAT,
  purchases                     FLOAT,
  purchases_clicks              FLOAT,
  total_purchases               FLOAT,
  total_purchases_clicks        FLOAT,
  sales                         FLOAT,
  total_sales                   FLOAT,
  new_to_brand_purchases        FLOAT,
  new_to_brand_purchases_clicks FLOAT,
  new_to_brand_product_sales    FLOAT,
  video_ad_start                FLOAT,
  video_ad_complete             FLOAT,
  synced_at                     TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
);

-- ── dsp_flight_report: line-item grain (replaces dsp_line_item_report) ──
CREATE TABLE IF NOT EXISTS CALBRIDGE_PROD.APP.dsp_flight_report (
  advertiser_id                 VARCHAR,
  profile_id                    VARCHAR       NOT NULL,
  client_id                     VARCHAR       NOT NULL,
  date                          DATE          NOT NULL,
  order_id                      VARCHAR       NOT NULL,
  order_name                    VARCHAR,
  line_item_id                  VARCHAR       NOT NULL DEFAULT '',
  line_item_name                VARCHAR,
  advertiser_name               VARCHAR,
  impressions                   BIGINT,
  clicks                        BIGINT,
  total_cost                    FLOAT,
  viewable_impressions          FLOAT,
  viewability_rate              FLOAT,
  detail_page_views             FLOAT,
  add_to_cart                   FLOAT,
  purchases                     FLOAT,
  total_purchases               FLOAT,
  sales                         FLOAT,
  total_sales                   FLOAT,
  new_to_brand_purchases        FLOAT,
  new_to_brand_product_sales    FLOAT,
  video_ad_start                FLOAT,
  video_ad_complete             FLOAT,
  synced_at                     TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
);
