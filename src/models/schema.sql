-- CalBridge Portal — Snowflake Schema
-- Run against CALBRIDGE.SANDBOX (dev) and CALBRIDGE.PROD (production)
-- All tables are partitioned by CLIENT_ID for full multi-tenancy

-- ============================================================
-- CLIENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS clients (
  client_id               VARCHAR(36)   NOT NULL PRIMARY KEY,
  email                   VARCHAR(255)  NOT NULL UNIQUE,
  name                    VARCHAR(255)  NOT NULL,
  created_at              TIMESTAMP_NTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- Auth & account
  password_hash           VARCHAR(255),
  status                  VARCHAR(20)   DEFAULT 'pending',    -- pending | active | suspended
  company_name            VARCHAR(255),
  logo_url                VARCHAR(500),
  connections             VARIANT,                            -- JSON: { ads, dsp, seller, vendor }
  team_members            VARIANT,                           -- JSON: [{ id, email, name, role, status }]

  -- Stripe billing
  stripe_customer_id      VARCHAR(50),
  stripe_subscription_id  VARCHAR(50),
  subscription_plan       VARCHAR(20),                       -- starter | growth | pro
  subscription_status     VARCHAR(20),                       -- active | past_due | cancelled | trialing
  trial_ends_at           TIMESTAMP_NTZ,
  subscription_ends_at    TIMESTAMP_NTZ,

  -- Password reset
  password_reset_token    VARCHAR(255),                      -- SHA-256 hashed token
  password_reset_expires  TIMESTAMP_NTZ,

  -- Onboarding
  onboarding_completed    BOOLEAN       DEFAULT FALSE
);

-- ============================================================
-- AMAZON CONNECTIONS (token store per client per type)
-- ============================================================
CREATE TABLE IF NOT EXISTS amazon_connections (
  client_id         VARCHAR(36)   NOT NULL,
  connection_type   VARCHAR(20)   NOT NULL,  -- ads | dsp | seller | vendor
  access_token      VARCHAR(2000) NOT NULL,
  refresh_token     VARCHAR(2000) NOT NULL,
  expires_at        TIMESTAMP_NTZ NOT NULL,
  selling_partner_id VARCHAR(50),            -- seller/vendor only
  connected_at      TIMESTAMP_NTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP_NTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (client_id, connection_type)
);

-- ============================================================
-- ADVERTISING CAMPAIGNS (Amazon Ads + DSP)
-- ============================================================
CREATE TABLE IF NOT EXISTS ad_campaigns (
  client_id       VARCHAR(36)   NOT NULL,
  connection_type VARCHAR(10)   NOT NULL,  -- ads | dsp
  campaign_id     VARCHAR(100)  NOT NULL,
  campaign_name   VARCHAR(500),
  campaign_type   VARCHAR(50),             -- sponsoredProducts | sponsoredBrands | sponsoredDisplay | video
  status          VARCHAR(20),             -- enabled | paused | archived
  budget          NUMBER(18,2),
  budget_type     VARCHAR(20),             -- daily | lifetime
  start_date      DATE,
  end_date        DATE,
  synced_at       TIMESTAMP_NTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (client_id, connection_type, campaign_id)
);

-- ============================================================
-- CAMPAIGN PERFORMANCE (daily metrics)
-- ============================================================
CREATE TABLE IF NOT EXISTS ad_performance (
  client_id       VARCHAR(36)   NOT NULL,
  connection_type VARCHAR(10)   NOT NULL,
  campaign_id     VARCHAR(100)  NOT NULL,
  report_date     DATE          NOT NULL,
  impressions     NUMBER(18,0)  DEFAULT 0,
  clicks          NUMBER(18,0)  DEFAULT 0,
  spend           NUMBER(18,4)  DEFAULT 0,
  sales           NUMBER(18,4)  DEFAULT 0,
  orders          NUMBER(18,0)  DEFAULT 0,
  units_sold      NUMBER(18,0)  DEFAULT 0,
  acos            NUMBER(10,4),            -- Advertising Cost of Sale (spend/sales)
  roas            NUMBER(10,4),            -- Return on Ad Spend (sales/spend)
  ctr             NUMBER(10,6),            -- Click-through rate
  cpc             NUMBER(10,4),            -- Cost per click
  synced_at       TIMESTAMP_NTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (client_id, connection_type, campaign_id, report_date)
);

-- ============================================================
-- PRODUCTS (from Seller/Vendor Central)
-- ============================================================
CREATE TABLE IF NOT EXISTS products (
  client_id         VARCHAR(36)   NOT NULL,
  connection_type   VARCHAR(10)   NOT NULL,  -- seller | vendor
  asin              VARCHAR(20)   NOT NULL,
  sku               VARCHAR(100),
  title             VARCHAR(1000),
  brand             VARCHAR(255),
  category          VARCHAR(255),
  price             NUMBER(18,2),
  fba_fees          NUMBER(18,2),
  cogs              NUMBER(18,2),           -- Cost of goods sold (client-provided)
  synced_at         TIMESTAMP_NTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (client_id, connection_type, asin)
);

-- ============================================================
-- SALES (from Seller/Vendor Central)
-- ============================================================
CREATE TABLE IF NOT EXISTS sales (
  client_id         VARCHAR(36)   NOT NULL,
  connection_type   VARCHAR(10)   NOT NULL,
  asin              VARCHAR(20)   NOT NULL,
  order_date        DATE          NOT NULL,
  units_ordered     NUMBER(18,0)  DEFAULT 0,
  ordered_revenue   NUMBER(18,4)  DEFAULT 0,
  units_shipped     NUMBER(18,0)  DEFAULT 0,
  shipped_revenue   NUMBER(18,4)  DEFAULT 0,
  synced_at         TIMESTAMP_NTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (client_id, connection_type, asin, order_date)
);

-- ============================================================
-- CONTRIBUTION MARGIN (calculated, per ASIN per day)
-- ============================================================
CREATE TABLE IF NOT EXISTS contribution_margin (
  client_id         VARCHAR(36)   NOT NULL,
  asin              VARCHAR(20)   NOT NULL,
  calc_date         DATE          NOT NULL,
  revenue           NUMBER(18,4)  DEFAULT 0,
  ad_spend          NUMBER(18,4)  DEFAULT 0,
  fba_fees          NUMBER(18,4)  DEFAULT 0,
  cogs              NUMBER(18,4)  DEFAULT 0,
  other_costs       NUMBER(18,4)  DEFAULT 0,
  contribution_margin NUMBER(18,4) DEFAULT 0,  -- revenue - ad_spend - fba_fees - cogs - other_costs
  cm_percent        NUMBER(10,4),              -- contribution_margin / revenue * 100
  calculated_at     TIMESTAMP_NTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (client_id, asin, calc_date)
);

-- ============================================================
-- INGESTION LOG (pipeline monitoring)
-- ============================================================
CREATE TABLE IF NOT EXISTS ingestion_log (
  log_id          VARCHAR(36)   NOT NULL PRIMARY KEY,
  client_id       VARCHAR(36)   NOT NULL,
  connection_type VARCHAR(20)   NOT NULL,
  job_type        VARCHAR(50)   NOT NULL,   -- campaigns | performance | products | sales | contribution_margin
  status          VARCHAR(20)   NOT NULL,   -- running | success | failed
  records_written NUMBER(18,0)  DEFAULT 0,
  error_message   VARCHAR(5000),
  started_at      TIMESTAMP_NTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at    TIMESTAMP_NTZ
);
