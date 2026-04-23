CREATE SCHEMA IF NOT EXISTS CALBRIDGE_PROD.MARTS;

CREATE TABLE IF NOT EXISTS CALBRIDGE_PROD.MARTS.AD_PERFORMANCE_DAILY (
  client_id VARCHAR NOT NULL,
  date DATE NOT NULL,
  ad_type VARCHAR NOT NULL,
  active_campaigns NUMBER,
  impressions NUMBER,
  clicks NUMBER,
  spend FLOAT,
  sales FLOAT,
  orders FLOAT,
  ntb_orders FLOAT,
  ntb_sales FLOAT,
  viewable_impressions FLOAT,
  detail_page_views FLOAT,
  add_to_cart FLOAT,
  new_to_brand_pct FLOAT,
  rebuilt_at TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
);

CREATE TABLE IF NOT EXISTS CALBRIDGE_PROD.MARTS.CAMPAIGN_PERFORMANCE (
  client_id VARCHAR NOT NULL,
  date DATE NOT NULL,
  ad_type VARCHAR NOT NULL,
  campaign_id VARCHAR NOT NULL,
  campaign_name VARCHAR,
  campaign_status VARCHAR,
  daily_budget FLOAT,
  impressions NUMBER,
  clicks NUMBER,
  spend FLOAT,
  sales FLOAT,
  orders FLOAT,
  sales_7d FLOAT,
  orders_7d FLOAT,
  ntb_purchases FLOAT,
  ntb_sales FLOAT,
  detail_page_views FLOAT,
  add_to_cart FLOAT,
  viewable_impressions FLOAT,
  top_of_search_impression_share FLOAT,
  rebuilt_at TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
);

CREATE TABLE IF NOT EXISTS CALBRIDGE_PROD.MARTS.DSP_LINE_ITEM (
  client_id VARCHAR NOT NULL,
  date DATE NOT NULL,
  order_name VARCHAR NOT NULL,
  advertiser_id VARCHAR,
  order_id VARCHAR,
  order_budget FLOAT,
  order_start_date DATE,
  order_end_date DATE,
  impressions NUMBER,
  clicks NUMBER,
  spend FLOAT,
  sales FLOAT,
  total_sales FLOAT,
  purchases FLOAT,
  total_purchases FLOAT,
  ntb_purchases FLOAT,
  ntb_product_sales FLOAT,
  viewable_impressions FLOAT,
  detail_page_views FLOAT,
  add_to_cart FLOAT,
  rebuilt_at TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
);
