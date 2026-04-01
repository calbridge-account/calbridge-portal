-- Migration 005: Amazon Marketing Stream hourly data tables
-- Receives intraday advertising data pushed by Amazon via SQS.
-- Key use case: budget exhaustion detection — know when campaigns run dry during the day.
--
-- batchMerge convention: every table needs a synced_at column (updated by batchMerge MERGE statement).

-- SP hourly traffic (impressions + clicks by campaign/ad group)
CREATE TABLE IF NOT EXISTS stream_sp_traffic (
  client_id     VARCHAR(36)   NOT NULL,
  profile_id    VARCHAR(50)   NOT NULL,
  event_time    TIMESTAMP_NTZ NOT NULL,   -- hour bucket (Amazon pushes at the top of each hour)
  campaign_id   VARCHAR(100),
  campaign_name VARCHAR(500),
  ad_group_id   VARCHAR(100),
  impressions   NUMBER,
  clicks        NUMBER,
  synced_at     TIMESTAMP_NTZ NOT NULL DEFAULT CURRENT_TIMESTAMP(),
  received_at   TIMESTAMP_NTZ NOT NULL DEFAULT CURRENT_TIMESTAMP(),
  PRIMARY KEY (client_id, profile_id, event_time, campaign_id, ad_group_id)
);

-- SP hourly conversions (purchases + sales by attribution window)
CREATE TABLE IF NOT EXISTS stream_sp_conversion (
  client_id     VARCHAR(36)   NOT NULL,
  profile_id    VARCHAR(50)   NOT NULL,
  event_time    TIMESTAMP_NTZ NOT NULL,
  campaign_id   VARCHAR(100),
  ad_group_id   VARCHAR(100),
  purchases_1d  NUMBER,
  purchases_7d  NUMBER,
  purchases_14d NUMBER,
  purchases_30d NUMBER,
  sales_1d      FLOAT,
  sales_7d      FLOAT,
  sales_14d     FLOAT,
  sales_30d     FLOAT,
  synced_at     TIMESTAMP_NTZ NOT NULL DEFAULT CURRENT_TIMESTAMP(),
  received_at   TIMESTAMP_NTZ NOT NULL DEFAULT CURRENT_TIMESTAMP(),
  PRIMARY KEY (client_id, profile_id, event_time, campaign_id, ad_group_id)
);

-- Budget usage — THE key table for daily exhaustion alerts
-- Amazon pushes this hourly; budget_exhausted flips true when a campaign hits its daily cap.
CREATE TABLE IF NOT EXISTS stream_budget_usage (
  client_id        VARCHAR(36)   NOT NULL,
  profile_id       VARCHAR(50)   NOT NULL,
  event_time       TIMESTAMP_NTZ NOT NULL,
  campaign_id      VARCHAR(100),
  campaign_name    VARCHAR(500),
  ad_type          VARCHAR(10),   -- SP | SB | SD
  budget_amount    FLOAT,         -- daily budget cap
  budget_used      FLOAT,         -- cumulative spend so far today
  budget_remaining FLOAT,         -- budget_amount - budget_used
  budget_pct_used  FLOAT,         -- 0.0 to 1.0
  budget_exhausted BOOLEAN,       -- true when remaining hits 0
  synced_at        TIMESTAMP_NTZ NOT NULL DEFAULT CURRENT_TIMESTAMP(),
  received_at      TIMESTAMP_NTZ NOT NULL DEFAULT CURRENT_TIMESTAMP(),
  PRIMARY KEY (client_id, profile_id, event_time, campaign_id)
);

-- SB hourly traffic (Sponsored Brands impressions + clicks)
CREATE TABLE IF NOT EXISTS stream_sb_traffic (
  client_id     VARCHAR(36)   NOT NULL,
  profile_id    VARCHAR(50)   NOT NULL,
  event_time    TIMESTAMP_NTZ NOT NULL,
  campaign_id   VARCHAR(100),
  campaign_name VARCHAR(500),
  impressions   NUMBER,
  clicks        NUMBER,
  synced_at     TIMESTAMP_NTZ NOT NULL DEFAULT CURRENT_TIMESTAMP(),
  received_at   TIMESTAMP_NTZ NOT NULL DEFAULT CURRENT_TIMESTAMP(),
  PRIMARY KEY (client_id, profile_id, event_time, campaign_id)
);

-- Stream subscription registry
-- Tracks which Amazon dataset → SQS queue mapping is active per client/profile.
-- Populated by POST /admin/stream/subscribe.
CREATE TABLE IF NOT EXISTS stream_subscriptions (
  id              NUMBER AUTOINCREMENT PRIMARY KEY,
  client_id       VARCHAR(36)   NOT NULL,
  profile_id      VARCHAR(50)   NOT NULL,
  dataset         VARCHAR(50)   NOT NULL,   -- sp-traffic | sp-conversion | budget-usage | sb-traffic
  subscription_id VARCHAR(200),             -- Amazon-assigned subscription ID (from Ads API response)
  sqs_queue_url   VARCHAR(500)  NOT NULL,
  sqs_queue_arn   VARCHAR(500)  NOT NULL,
  status          VARCHAR(20)   DEFAULT 'active',   -- active | paused | error
  created_at      TIMESTAMP_NTZ NOT NULL DEFAULT CURRENT_TIMESTAMP(),
  UNIQUE (client_id, profile_id, dataset)
);
