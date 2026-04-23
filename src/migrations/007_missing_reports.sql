CREATE TABLE IF NOT EXISTS CALBRIDGE_PROD.APP.sp_audience_report (
  client_id VARCHAR NOT NULL,
  profile_id VARCHAR NOT NULL,
  campaign_id VARCHAR NOT NULL,
  campaign_bid_boost_segment VARCHAR,
  date DATE,
  campaign_name VARCHAR,
  impressions NUMBER,
  clicks NUMBER,
  cost FLOAT,
  purchases_30_d FLOAT,
  sales_30_d FLOAT,
  ingested_at TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
);

CREATE TABLE IF NOT EXISTS CALBRIDGE_PROD.APP.sb_audience_report (
  client_id VARCHAR NOT NULL,
  profile_id VARCHAR NOT NULL,
  campaign_id VARCHAR NOT NULL,
  audience_segment_id VARCHAR,
  audience_segment_name VARCHAR,
  date DATE,
  campaign_name VARCHAR,
  impressions NUMBER,
  clicks NUMBER,
  cost FLOAT,
  purchases FLOAT,
  sales FLOAT,
  ingested_at TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
);

CREATE TABLE IF NOT EXISTS CALBRIDGE_PROD.APP.dsp_audience_report (
  client_id VARCHAR NOT NULL,
  profile_id VARCHAR NOT NULL,
  date DATE,
  order_id VARCHAR,
  order_name VARCHAR,
  advertiser_id VARCHAR,
  audience_segment_id VARCHAR,
  audience_segment_name VARCHAR,
  impressions NUMBER,
  clicks NUMBER,
  total_cost FLOAT,
  purchases FLOAT,
  sales FLOAT,
  new_to_brand_purchases FLOAT,
  detail_page_views FLOAT,
  ingested_at TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
);

CREATE TABLE IF NOT EXISTS CALBRIDGE_PROD.APP.dsp_geo_report (
  client_id VARCHAR NOT NULL,
  profile_id VARCHAR NOT NULL,
  date DATE,
  order_name VARCHAR,
  region VARCHAR,
  advertiser_id VARCHAR,
  order_id VARCHAR,
  impressions NUMBER,
  clicks NUMBER,
  total_cost FLOAT,
  purchases FLOAT,
  sales FLOAT,
  detail_page_views FLOAT,
  ingested_at TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
);
