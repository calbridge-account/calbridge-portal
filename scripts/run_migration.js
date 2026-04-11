#!/usr/bin/env node
/**
 * Full migration script: CALBRIDGE.SANDBOX → CALBRIDGE_PROD
 * 
 * Run with: node scripts/run_migration.js
 * 
 * Steps:
 * 1. Create missing tables in CALBRIDGE_PROD.APP
 * 2. Migrate data from CALBRIDGE.SANDBOX to CALBRIDGE_PROD.APP
 * 3. Recreate views in CALBRIDGE_PROD.APP
 * 4. Update ADJUSTED_AD_CAMPAIGN view to point to CALBRIDGE_PROD.APP.SPEND_ADJUSTMENTS
 * 5. Create connector_health table in CALBRIDGE_PROD.APP
 * 6. Create ads report queue tables (APP.ADS_REPORT_QUEUE, APP.INGESTION_LOG)
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { query } = require('../src/services/snowflakeService');

async function run(label, sql, binds = []) {
  console.log(`  → ${label}`);
  try {
    const result = await query(sql, binds);
    return result;
  } catch (e) {
    if (e.message?.includes('already exists') || e.message?.includes('duplicate')) {
      console.log(`    ⚠ Already exists — skipping`);
      return null;
    }
    throw e;
  }
}

async function countRows(db, schema, table) {
  try {
    const rows = await query(`SELECT COUNT(*) AS CNT FROM ${db}.${schema}.${table}`);
    return Number(rows[0]?.CNT || 0);
  } catch (e) {
    return -1;
  }
}

async function main() {
  console.log('\n=== CALBRIDGE SANDBOX → CALBRIDGE_PROD MIGRATION ===\n');

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 1: Check CALBRIDGE_PROD.APP.CLIENTS schema vs SANDBOX
  // SANDBOX.CLIENTS has 24 cols, PROD.APP.CLIENTS has 13 cols
  // The PROD.CLIENTS is missing many columns — we need to add them or handle mapping
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('── Step 1: Expand CALBRIDGE_PROD.APP.CLIENTS schema ──');

  // Add missing columns to CALBRIDGE_PROD.APP.CLIENTS
  const missingClientCols = [
    `ALTER TABLE CALBRIDGE_PROD.APP.CLIENTS ADD COLUMN IF NOT EXISTS EMAIL VARCHAR(255)`,
    `ALTER TABLE CALBRIDGE_PROD.APP.CLIENTS ADD COLUMN IF NOT EXISTS NAME VARCHAR(255)`,
    `ALTER TABLE CALBRIDGE_PROD.APP.CLIENTS ADD COLUMN IF NOT EXISTS PASSWORD_HASH VARCHAR(255)`,
    `ALTER TABLE CALBRIDGE_PROD.APP.CLIENTS ADD COLUMN IF NOT EXISTS CONNECTIONS VARIANT`,
    `ALTER TABLE CALBRIDGE_PROD.APP.CLIENTS ADD COLUMN IF NOT EXISTS LOGO_URL VARCHAR(500)`,
    `ALTER TABLE CALBRIDGE_PROD.APP.CLIENTS ADD COLUMN IF NOT EXISTS COMPANY_NAME VARCHAR(255)`,
    `ALTER TABLE CALBRIDGE_PROD.APP.CLIENTS ADD COLUMN IF NOT EXISTS TEAM_MEMBERS VARIANT`,
    // STATUS already exists in PROD.APP.CLIENTS — skip (ambiguous column name if added again)
    `ALTER TABLE CALBRIDGE_PROD.APP.CLIENTS ADD COLUMN IF NOT EXISTS APPROVED_AT TIMESTAMP_NTZ`,
    `ALTER TABLE CALBRIDGE_PROD.APP.CLIENTS ADD COLUMN IF NOT EXISTS STRIPE_SUBSCRIPTION_ID VARCHAR(50)`,
    `ALTER TABLE CALBRIDGE_PROD.APP.CLIENTS ADD COLUMN IF NOT EXISTS SUBSCRIPTION_PLAN VARCHAR(20)`,
    `ALTER TABLE CALBRIDGE_PROD.APP.CLIENTS ADD COLUMN IF NOT EXISTS SUBSCRIPTION_STATUS VARCHAR(20)`,
    `ALTER TABLE CALBRIDGE_PROD.APP.CLIENTS ADD COLUMN IF NOT EXISTS TRIAL_ENDS_AT TIMESTAMP_NTZ`,
    `ALTER TABLE CALBRIDGE_PROD.APP.CLIENTS ADD COLUMN IF NOT EXISTS SUBSCRIPTION_ENDS_AT TIMESTAMP_NTZ`,
    `ALTER TABLE CALBRIDGE_PROD.APP.CLIENTS ADD COLUMN IF NOT EXISTS PASSWORD_RESET_TOKEN VARCHAR(255)`,
    `ALTER TABLE CALBRIDGE_PROD.APP.CLIENTS ADD COLUMN IF NOT EXISTS PASSWORD_RESET_EXPIRES TIMESTAMP_NTZ`,
    `ALTER TABLE CALBRIDGE_PROD.APP.CLIENTS ADD COLUMN IF NOT EXISTS ONBOARDING_COMPLETED BOOLEAN DEFAULT FALSE`,
    `ALTER TABLE CALBRIDGE_PROD.APP.CLIENTS ADD COLUMN IF NOT EXISTS WEEKLY_REPORT_ENABLED BOOLEAN DEFAULT TRUE`,
    `ALTER TABLE CALBRIDGE_PROD.APP.CLIENTS ADD COLUMN IF NOT EXISTS LINKED_CLIENT_ID VARCHAR(36)`,
    `ALTER TABLE CALBRIDGE_PROD.APP.CLIENTS ADD COLUMN IF NOT EXISTS LAST_LOGIN_AT TIMESTAMP_NTZ`,
  ];

  for (const sql of missingClientCols) {
    const colName = sql.match(/ADD COLUMN IF NOT EXISTS (\w+)/)?.[1];
    try {
      await query(sql);
      console.log(`  ✓ clients.${colName}`);
    } catch(e) {
      if (e.message?.includes('already exists') || e.message?.includes('duplicate')) {
        console.log(`  ⚠ clients.${colName} — already exists`);
      } else {
        console.error(`  ✗ clients.${colName}: ${e.message}`);
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 2: Create missing tables in CALBRIDGE_PROD.APP
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n── Step 2: Create missing tables in CALBRIDGE_PROD.APP ──');

  // ADMIN_USERS
  await run('Create APP.ADMIN_USERS', `
    CREATE TABLE IF NOT EXISTS CALBRIDGE_PROD.APP.ADMIN_USERS (
      ADMIN_ID       VARCHAR(36)   NOT NULL,
      EMAIL          VARCHAR(255)  NOT NULL,
      NAME           VARCHAR(255)  NOT NULL,
      PASSWORD_HASH  VARCHAR(255)  NOT NULL,
      ROLE           VARCHAR(20)   NOT NULL DEFAULT 'admin',
      CREATED_AT     TIMESTAMP_NTZ NOT NULL DEFAULT CURRENT_TIMESTAMP(),
      LAST_LOGIN     TIMESTAMP_NTZ
    )
  `);

  // AMAZON_CONNECTIONS
  await run('Create APP.AMAZON_CONNECTIONS', `
    CREATE TABLE IF NOT EXISTS CALBRIDGE_PROD.APP.AMAZON_CONNECTIONS (
      CLIENT_ID         VARCHAR(36)    NOT NULL,
      CONNECTION_TYPE   VARCHAR(20)    NOT NULL,
      ACCESS_TOKEN      VARCHAR(2000)  NOT NULL,
      REFRESH_TOKEN     VARCHAR(2000)  NOT NULL,
      EXPIRES_AT        TIMESTAMP_NTZ  NOT NULL,
      SELLING_PARTNER_ID VARCHAR(50),
      CONNECTED_AT      TIMESTAMP_NTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP(),
      UPDATED_AT        TIMESTAMP_NTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP()
    )
  `);

  // SESSIONS
  await run('Create APP.SESSIONS', `
    CREATE TABLE IF NOT EXISTS CALBRIDGE_PROD.APP.SESSIONS (
      SID        TEXT          NOT NULL,
      SESS       VARIANT       NOT NULL,
      EXPIRED_AT TIMESTAMP_NTZ NOT NULL
    )
  `);

  // BRANDS
  await run('Create APP.BRANDS', `
    CREATE TABLE IF NOT EXISTS CALBRIDGE_PROD.APP.BRANDS (
      BRAND_ID         TEXT NOT NULL,
      CLIENT_ID        TEXT NOT NULL,
      NAME             TEXT NOT NULL,
      MARKETPLACE      TEXT DEFAULT 'US',
      ADS_PROFILE_ID   TEXT,
      DSP_ADVERTISER_ID TEXT,
      SP_SELLER_ID     TEXT,
      SP_VENDOR_ID     TEXT,
      IS_ACTIVE        BOOLEAN DEFAULT TRUE,
      CREATED_AT       TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
      UPDATED_AT       TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
    )
  `);

  // AD_PROFILES
  await run('Create APP.AD_PROFILES', `
    CREATE TABLE IF NOT EXISTS CALBRIDGE_PROD.APP.AD_PROFILES (
      PROFILE_ID    TEXT NOT NULL,
      CLIENT_ID     TEXT NOT NULL,
      NAME          TEXT,
      TYPE          TEXT,
      SUB_TYPE      TEXT,
      MARKETPLACE   TEXT,
      CURRENCY_CODE TEXT,
      TIMEZONE      TEXT,
      ACCOUNT_ID    TEXT,
      DAILY_BUDGET  NUMBER,
      CREATED_AT    TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
    )
  `);

  // SPEND_ADJUSTMENTS
  await run('Create APP.SPEND_ADJUSTMENTS', `
    CREATE TABLE IF NOT EXISTS CALBRIDGE_PROD.APP.SPEND_ADJUSTMENTS (
      ID         NUMBER NOT NULL,
      CLIENT_ID  VARCHAR(36) NOT NULL,
      YEAR_MONTH VARCHAR(7)  NOT NULL,
      AD_TYPE    VARCHAR(10) NOT NULL,
      MULTIPLIER FLOAT       NOT NULL,
      NOTE       VARCHAR(500),
      CREATED_BY VARCHAR(255),
      CREATED_AT TIMESTAMP_NTZ NOT NULL DEFAULT CURRENT_TIMESTAMP(),
      UPDATED_AT TIMESTAMP_NTZ NOT NULL DEFAULT CURRENT_TIMESTAMP()
    )
  `);

  // ADMIN_CONFIG
  await run('Create APP.ADMIN_CONFIG', `
    CREATE TABLE IF NOT EXISTS CALBRIDGE_PROD.APP.ADMIN_CONFIG (
      KEY   TEXT NOT NULL,
      VALUE TEXT
    )
  `);

  // ADS_REPORT_QUEUE — SANDBOX.ADS_REPORT_QUEUE schema (different from OPS.REPORT_QUEUE)
  await run('Create APP.ADS_REPORT_QUEUE', `
    CREATE TABLE IF NOT EXISTS CALBRIDGE_PROD.APP.ADS_REPORT_QUEUE (
      REPORT_ID        VARCHAR(36)    NOT NULL,
      CLIENT_ID        VARCHAR(36)    NOT NULL,
      CONNECTION_TYPE  VARCHAR(20)    NOT NULL,
      PROFILE_ID       VARCHAR(36)    NOT NULL,
      REPORT_TYPE      VARCHAR(50)    NOT NULL,
      REPORT_DATE      VARCHAR(20)    NOT NULL,
      STATUS           VARCHAR(20)    DEFAULT 'pending',
      REQUESTED_AT     TIMESTAMP_NTZ  DEFAULT CURRENT_TIMESTAMP(),
      COMPLETED_AT     TIMESTAMP_NTZ,
      RECORDS_WRITTEN  NUMBER         DEFAULT 0,
      ERROR_MESSAGE    VARCHAR(1000),
      DOWNLOAD_URL     TEXT,
      POLLED_AT        TIMESTAMP_NTZ,
      OWNER_CLIENT_ID  VARCHAR(36)
    )
  `);

  // INGESTION_LOG — SANDBOX schema (different from OPS.INGESTION_LOG)
  await run('Create APP.INGESTION_LOG', `
    CREATE TABLE IF NOT EXISTS CALBRIDGE_PROD.APP.INGESTION_LOG (
      LOG_ID          VARCHAR(36)   NOT NULL,
      CLIENT_ID       VARCHAR(36)   NOT NULL,
      CONNECTION_TYPE VARCHAR(20)   NOT NULL,
      JOB_TYPE        VARCHAR(50)   NOT NULL,
      STATUS          VARCHAR(20)   NOT NULL,
      RECORDS_WRITTEN NUMBER        DEFAULT 0,
      ERROR_MESSAGE   VARCHAR(5000),
      STARTED_AT      TIMESTAMP_NTZ NOT NULL DEFAULT CURRENT_TIMESTAMP(),
      COMPLETED_AT    TIMESTAMP_NTZ
    )
  `);

  // AD_CAMPAIGNS
  await run('Create APP.AD_CAMPAIGNS', `
    CREATE TABLE IF NOT EXISTS CALBRIDGE_PROD.APP.AD_CAMPAIGNS (
      CLIENT_ID       VARCHAR(36)   NOT NULL,
      CONNECTION_TYPE VARCHAR(10)   NOT NULL,
      CAMPAIGN_ID     VARCHAR(100)  NOT NULL,
      CAMPAIGN_NAME   VARCHAR(500),
      CAMPAIGN_TYPE   VARCHAR(50),
      STATUS          VARCHAR(20),
      BUDGET          NUMBER,
      BUDGET_TYPE     VARCHAR(20),
      START_DATE      DATE,
      END_DATE        DATE,
      SYNCED_AT       TIMESTAMP_NTZ NOT NULL DEFAULT CURRENT_TIMESTAMP()
    )
  `);

  // DSP_ADVERTISER
  await run('Create APP.DSP_ADVERTISER', `
    CREATE TABLE IF NOT EXISTS CALBRIDGE_PROD.APP.DSP_ADVERTISER (
      ADVERTISER_ID VARCHAR(64)   NOT NULL,
      PROFILE_ID    VARCHAR(36)   NOT NULL,
      NAME          VARCHAR(512),
      CLIENT_ID     VARCHAR(36),
      ENTITY_ID     VARCHAR(128),
      CURRENCY_CODE VARCHAR(8),
      TIMEZONE      VARCHAR(64),
      IS_ACTIVE     BOOLEAN DEFAULT TRUE,
      SYNCED_AT     TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
    )
  `);

  // DSP_ADVERTISER_CLIENT_MAP
  await run('Create APP.DSP_ADVERTISER_CLIENT_MAP', `
    CREATE TABLE IF NOT EXISTS CALBRIDGE_PROD.APP.DSP_ADVERTISER_CLIENT_MAP (
      ADVERTISER_ID VARCHAR(64)   NOT NULL,
      CLIENT_ID     VARCHAR(36)   NOT NULL,
      PROFILE_ID    VARCHAR(64)   NOT NULL,
      NAME          VARCHAR(255),
      IS_ACTIVE     BOOLEAN DEFAULT TRUE,
      CREATED_AT    TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
    )
  `);

  // CONTRIBUTION_MARGIN
  await run('Create APP.CONTRIBUTION_MARGIN', `
    CREATE TABLE IF NOT EXISTS CALBRIDGE_PROD.APP.CONTRIBUTION_MARGIN (
      CLIENT_ID            VARCHAR(36) NOT NULL,
      ASIN                 VARCHAR(20) NOT NULL,
      CALC_DATE            DATE        NOT NULL,
      REVENUE              NUMBER DEFAULT 0,
      AD_SPEND             NUMBER DEFAULT 0,
      FBA_FEES             NUMBER DEFAULT 0,
      COGS                 NUMBER DEFAULT 0,
      OTHER_COSTS          NUMBER DEFAULT 0,
      CONTRIBUTION_MARGIN  NUMBER DEFAULT 0,
      CM_PERCENT           NUMBER,
      CALCULATED_AT        TIMESTAMP_NTZ NOT NULL DEFAULT CURRENT_TIMESTAMP(),
      UNITS                NUMBER DEFAULT 0,
      UNIT_CM              NUMBER,
      UNIT_CM_PERCENT      NUMBER,
      REFERRAL_FEES        NUMBER DEFAULT 0,
      AMAZON_FEES          NUMBER DEFAULT 0,
      CM1                  NUMBER,
      CM2                  NUMBER,
      CM3                  NUMBER,
      CM1_PER_UNIT         NUMBER,
      CM2_PER_UNIT         NUMBER,
      CM3_PER_UNIT         NUMBER,
      VENDOR_CM1_IS_ESTIMATE BOOLEAN DEFAULT FALSE
    )
  `);

  // PRODUCTS
  await run('Create APP.PRODUCTS', `
    CREATE TABLE IF NOT EXISTS CALBRIDGE_PROD.APP.PRODUCTS (
      CLIENT_ID       VARCHAR(36)    NOT NULL,
      CONNECTION_TYPE VARCHAR(10)    NOT NULL,
      ASIN            VARCHAR(20)    NOT NULL,
      SKU             VARCHAR(100),
      TITLE           VARCHAR(1000),
      BRAND           VARCHAR(255),
      CATEGORY        VARCHAR(255),
      PRICE           NUMBER,
      FBA_FEES        NUMBER,
      COGS            NUMBER,
      SYNCED_AT       TIMESTAMP_NTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP(),
      REFERRAL_FEES   NUMBER DEFAULT 0
    )
  `);

  // CONNECTOR_HEALTH (used by connectorHealth.js but not in SANDBOX)
  await run('Create APP.CONNECTOR_HEALTH', `
    CREATE TABLE IF NOT EXISTS CALBRIDGE_PROD.APP.CONNECTOR_HEALTH (
      CLIENT_ID        VARCHAR(36)   NOT NULL,
      CONNECTION_TYPE  VARCHAR(20)   NOT NULL,
      ACCOUNT_ID       VARCHAR(100),
      STATUS           VARCHAR(20)   DEFAULT 'unknown',
      TOKEN_EXPIRES_AT TIMESTAMP_NTZ,
      LAST_PROBE_AT    TIMESTAMP_NTZ,
      LAST_SUCCESS_AT  TIMESTAMP_NTZ,
      ERROR_MESSAGE    VARCHAR(1000),
      PROBE_HTTP_STATUS NUMBER,
      CREATED_AT       TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
      UPDATED_AT       TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
    )
  `);

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 3: Migrate data
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n── Step 3: Migrate data from CALBRIDGE.SANDBOX ──');

  // CLIENTS — check existing prod rows first
  const prodClientCount = await countRows('CALBRIDGE_PROD', 'APP', 'CLIENTS');
  console.log(`  CALBRIDGE_PROD.APP.CLIENTS currently has ${prodClientCount} rows`);

  // PROD.APP.CLIENTS has CLIENT_NAME NOT NULL and CLIENT_TYPE NOT NULL (different from SANDBOX schema)
  // SANDBOX has NAME (mapped to CLIENT_NAME) and no CLIENT_TYPE (use 'client' default)
  // Use MERGE so it's idempotent (handles both 0 rows and existing rows)
  await run('Upsert CLIENTS from SANDBOX (with schema mapping)', `
    MERGE INTO CALBRIDGE_PROD.APP.CLIENTS t
    USING (
      SELECT 
        CLIENT_ID,
        COALESCE(COMPANY_NAME, NAME, 'Unknown') AS CLIENT_NAME,
        'client'   AS CLIENT_TYPE,
        NULL       AS PARENT_CLIENT_ID,
        STATUS,
        PLAN,
        EMAIL      AS BILLING_EMAIL,
        STRIPE_CUSTOMER_ID,
        NULL::TIMESTAMP_NTZ AS GRACE_PERIOD_STARTED_AT,
        NULL::TIMESTAMP_NTZ AS SUSPENDED_AT,
        NULL::TIMESTAMP_NTZ AS CHURNED_AT,
        CREATED_AT,
        CURRENT_TIMESTAMP() AS UPDATED_AT,
        EMAIL, NAME, PASSWORD_HASH, CONNECTIONS, LOGO_URL, COMPANY_NAME,
        TEAM_MEMBERS, APPROVED_AT, STRIPE_SUBSCRIPTION_ID,
        SUBSCRIPTION_PLAN, SUBSCRIPTION_STATUS, TRIAL_ENDS_AT, SUBSCRIPTION_ENDS_AT,
        PASSWORD_RESET_TOKEN, PASSWORD_RESET_EXPIRES, ONBOARDING_COMPLETED, WEEKLY_REPORT_ENABLED,
        LINKED_CLIENT_ID, LAST_LOGIN_AT
      FROM CALBRIDGE.SANDBOX.CLIENTS
    ) s
    ON t.CLIENT_ID = s.CLIENT_ID
    WHEN MATCHED THEN UPDATE SET
      CLIENT_NAME = s.CLIENT_NAME, CLIENT_TYPE = s.CLIENT_TYPE,
      STATUS = s.STATUS, PLAN = s.PLAN, BILLING_EMAIL = s.BILLING_EMAIL,
      STRIPE_CUSTOMER_ID = s.STRIPE_CUSTOMER_ID,
      EMAIL = s.EMAIL, NAME = s.NAME, PASSWORD_HASH = s.PASSWORD_HASH,
      CONNECTIONS = s.CONNECTIONS, LOGO_URL = s.LOGO_URL, COMPANY_NAME = s.COMPANY_NAME,
      TEAM_MEMBERS = s.TEAM_MEMBERS, APPROVED_AT = s.APPROVED_AT,
      STRIPE_SUBSCRIPTION_ID = s.STRIPE_SUBSCRIPTION_ID,
      SUBSCRIPTION_PLAN = s.SUBSCRIPTION_PLAN, SUBSCRIPTION_STATUS = s.SUBSCRIPTION_STATUS,
      TRIAL_ENDS_AT = s.TRIAL_ENDS_AT, SUBSCRIPTION_ENDS_AT = s.SUBSCRIPTION_ENDS_AT,
      PASSWORD_RESET_TOKEN = s.PASSWORD_RESET_TOKEN, PASSWORD_RESET_EXPIRES = s.PASSWORD_RESET_EXPIRES,
      ONBOARDING_COMPLETED = s.ONBOARDING_COMPLETED, WEEKLY_REPORT_ENABLED = s.WEEKLY_REPORT_ENABLED,
      LINKED_CLIENT_ID = s.LINKED_CLIENT_ID, LAST_LOGIN_AT = s.LAST_LOGIN_AT,
      UPDATED_AT = CURRENT_TIMESTAMP()
    WHEN NOT MATCHED THEN INSERT
      (CLIENT_ID, CLIENT_NAME, CLIENT_TYPE, PARENT_CLIENT_ID, STATUS, PLAN, BILLING_EMAIL,
       STRIPE_CUSTOMER_ID, GRACE_PERIOD_STARTED_AT, SUSPENDED_AT, CHURNED_AT, CREATED_AT, UPDATED_AT,
       EMAIL, NAME, PASSWORD_HASH, CONNECTIONS, LOGO_URL, COMPANY_NAME, TEAM_MEMBERS,
       APPROVED_AT, STRIPE_SUBSCRIPTION_ID, SUBSCRIPTION_PLAN, SUBSCRIPTION_STATUS,
       TRIAL_ENDS_AT, SUBSCRIPTION_ENDS_AT, PASSWORD_RESET_TOKEN, PASSWORD_RESET_EXPIRES,
       ONBOARDING_COMPLETED, WEEKLY_REPORT_ENABLED, LINKED_CLIENT_ID, LAST_LOGIN_AT)
    VALUES
      (s.CLIENT_ID, s.CLIENT_NAME, s.CLIENT_TYPE, s.PARENT_CLIENT_ID, s.STATUS, s.PLAN, s.BILLING_EMAIL,
       s.STRIPE_CUSTOMER_ID, s.GRACE_PERIOD_STARTED_AT, s.SUSPENDED_AT, s.CHURNED_AT, s.CREATED_AT, s.UPDATED_AT,
       s.EMAIL, s.NAME, s.PASSWORD_HASH, s.CONNECTIONS, s.LOGO_URL, s.COMPANY_NAME, s.TEAM_MEMBERS,
       s.APPROVED_AT, s.STRIPE_SUBSCRIPTION_ID, s.SUBSCRIPTION_PLAN, s.SUBSCRIPTION_STATUS,
       s.TRIAL_ENDS_AT, s.SUBSCRIPTION_ENDS_AT, s.PASSWORD_RESET_TOKEN, s.PASSWORD_RESET_EXPIRES,
       s.ONBOARDING_COMPLETED, s.WEEKLY_REPORT_ENABLED, s.LINKED_CLIENT_ID, s.LAST_LOGIN_AT)
  `);

  // ADMIN_USERS
  await run('Migrate ADMIN_USERS (1 row)', `
    INSERT INTO CALBRIDGE_PROD.APP.ADMIN_USERS
    SELECT * FROM CALBRIDGE.SANDBOX.ADMIN_USERS
    WHERE ADMIN_ID NOT IN (SELECT ADMIN_ID FROM CALBRIDGE_PROD.APP.ADMIN_USERS)
  `);

  // AMAZON_CONNECTIONS
  await run('Migrate AMAZON_CONNECTIONS (1 row)', `
    INSERT INTO CALBRIDGE_PROD.APP.AMAZON_CONNECTIONS
    SELECT * FROM CALBRIDGE.SANDBOX.AMAZON_CONNECTIONS
    WHERE (CLIENT_ID, CONNECTION_TYPE) NOT IN (
      SELECT CLIENT_ID, CONNECTION_TYPE FROM CALBRIDGE_PROD.APP.AMAZON_CONNECTIONS
    )
  `);

  // SESSIONS (16 rows — these are short-lived, OK to migrate all)
  await run('Migrate SESSIONS (16 rows)', `
    INSERT INTO CALBRIDGE_PROD.APP.SESSIONS
    SELECT * FROM CALBRIDGE.SANDBOX.SESSIONS
    WHERE SID NOT IN (SELECT SID FROM CALBRIDGE_PROD.APP.SESSIONS)
    AND EXPIRED_AT > CURRENT_TIMESTAMP()
  `);

  // BRANDS
  await run('Migrate BRANDS (5 rows)', `
    INSERT INTO CALBRIDGE_PROD.APP.BRANDS
    SELECT * FROM CALBRIDGE.SANDBOX.BRANDS
    WHERE BRAND_ID NOT IN (SELECT BRAND_ID FROM CALBRIDGE_PROD.APP.BRANDS)
  `);

  // AD_PROFILES
  await run('Migrate AD_PROFILES (1 row)', `
    INSERT INTO CALBRIDGE_PROD.APP.AD_PROFILES
    SELECT * FROM CALBRIDGE.SANDBOX.AD_PROFILES
    WHERE PROFILE_ID NOT IN (SELECT PROFILE_ID FROM CALBRIDGE_PROD.APP.AD_PROFILES)
  `);

  // SPEND_ADJUSTMENTS
  await run('Migrate SPEND_ADJUSTMENTS (15 rows)', `
    INSERT INTO CALBRIDGE_PROD.APP.SPEND_ADJUSTMENTS
    SELECT * FROM CALBRIDGE.SANDBOX.SPEND_ADJUSTMENTS
    WHERE ID NOT IN (SELECT ID FROM CALBRIDGE_PROD.APP.SPEND_ADJUSTMENTS)
  `);

  // ADMIN_CONFIG
  await run('Migrate ADMIN_CONFIG (1 row)', `
    INSERT INTO CALBRIDGE_PROD.APP.ADMIN_CONFIG
    SELECT * FROM CALBRIDGE.SANDBOX.ADMIN_CONFIG
    WHERE KEY NOT IN (SELECT KEY FROM CALBRIDGE_PROD.APP.ADMIN_CONFIG)
  `);

  // ADS_REPORT_QUEUE (786 rows — these are historical, migrate them)
  await run('Migrate ADS_REPORT_QUEUE (786 rows)', `
    INSERT INTO CALBRIDGE_PROD.APP.ADS_REPORT_QUEUE
    SELECT * FROM CALBRIDGE.SANDBOX.ADS_REPORT_QUEUE
    WHERE REPORT_ID NOT IN (SELECT REPORT_ID FROM CALBRIDGE_PROD.APP.ADS_REPORT_QUEUE)
  `);

  // INGESTION_LOG (895 rows)
  await run('Migrate INGESTION_LOG (895 rows)', `
    INSERT INTO CALBRIDGE_PROD.APP.INGESTION_LOG
    SELECT * FROM CALBRIDGE.SANDBOX.INGESTION_LOG
    WHERE LOG_ID NOT IN (SELECT LOG_ID FROM CALBRIDGE_PROD.APP.INGESTION_LOG)
  `);

  // AD_CAMPAIGNS (406 rows)
  await run('Migrate AD_CAMPAIGNS (406 rows)', `
    INSERT INTO CALBRIDGE_PROD.APP.AD_CAMPAIGNS
    SELECT * FROM CALBRIDGE.SANDBOX.AD_CAMPAIGNS
    WHERE (CLIENT_ID, CONNECTION_TYPE, CAMPAIGN_ID) NOT IN (
      SELECT CLIENT_ID, CONNECTION_TYPE, CAMPAIGN_ID FROM CALBRIDGE_PROD.APP.AD_CAMPAIGNS
    )
  `);

  // DSP_ADVERTISER (16 rows)
  await run('Migrate DSP_ADVERTISER (16 rows)', `
    INSERT INTO CALBRIDGE_PROD.APP.DSP_ADVERTISER
    SELECT * FROM CALBRIDGE.SANDBOX.DSP_ADVERTISER
    WHERE ADVERTISER_ID NOT IN (SELECT ADVERTISER_ID FROM CALBRIDGE_PROD.APP.DSP_ADVERTISER)
  `);

  // DSP_ADVERTISER_CLIENT_MAP (8 rows)
  await run('Migrate DSP_ADVERTISER_CLIENT_MAP (8 rows)', `
    INSERT INTO CALBRIDGE_PROD.APP.DSP_ADVERTISER_CLIENT_MAP
    SELECT * FROM CALBRIDGE.SANDBOX.DSP_ADVERTISER_CLIENT_MAP
    WHERE (ADVERTISER_ID, CLIENT_ID) NOT IN (
      SELECT ADVERTISER_ID, CLIENT_ID FROM CALBRIDGE_PROD.APP.DSP_ADVERTISER_CLIENT_MAP
    )
  `);

  // CONTRIBUTION_MARGIN (720 rows)
  await run('Migrate CONTRIBUTION_MARGIN (720 rows)', `
    INSERT INTO CALBRIDGE_PROD.APP.CONTRIBUTION_MARGIN
    SELECT * FROM CALBRIDGE.SANDBOX.CONTRIBUTION_MARGIN
    WHERE (CLIENT_ID, ASIN, CALC_DATE) NOT IN (
      SELECT CLIENT_ID, ASIN, CALC_DATE FROM CALBRIDGE_PROD.APP.CONTRIBUTION_MARGIN
    )
  `);

  // PRODUCTS (281 rows)
  await run('Migrate PRODUCTS (281 rows)', `
    INSERT INTO CALBRIDGE_PROD.APP.PRODUCTS
    SELECT * FROM CALBRIDGE.SANDBOX.PRODUCTS
    WHERE (CLIENT_ID, CONNECTION_TYPE, ASIN) NOT IN (
      SELECT CLIENT_ID, CONNECTION_TYPE, ASIN FROM CALBRIDGE_PROD.APP.PRODUCTS
    )
  `);

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 4: Verify row counts
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n── Step 4: Verify migration row counts ──');
  const tables = [
    ['APP', 'CLIENTS'],
    ['APP', 'ADMIN_USERS'],
    ['APP', 'AMAZON_CONNECTIONS'],
    ['APP', 'SESSIONS'],
    ['APP', 'BRANDS'],
    ['APP', 'AD_PROFILES'],
    ['APP', 'SPEND_ADJUSTMENTS'],
    ['APP', 'ADMIN_CONFIG'],
    ['APP', 'ADS_REPORT_QUEUE'],
    ['APP', 'INGESTION_LOG'],
    ['APP', 'AD_CAMPAIGNS'],
    ['APP', 'DSP_ADVERTISER'],
    ['APP', 'DSP_ADVERTISER_CLIENT_MAP'],
    ['APP', 'CONTRIBUTION_MARGIN'],
    ['APP', 'PRODUCTS'],
  ];

  for (const [schema, table] of tables) {
    const prodCount = await countRows('CALBRIDGE_PROD', schema, table);
    const sandboxCount = await countRows('CALBRIDGE', 'SANDBOX', table);
    const status = prodCount === sandboxCount ? '✅' : (prodCount > 0 ? '⚠' : '❌');
    console.log(`  ${status} CALBRIDGE_PROD.${schema}.${table}: ${prodCount} rows (sandbox had ${sandboxCount})`);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 5: Recreate views in CALBRIDGE_PROD.APP
  // The views reference sp_campaign_report etc. which are in CALBRIDGE_PROD.APP after .env flip
  // So we reference them as just table names (unqualified, resolved by session database+schema)
  // BUT since we're creating the views in CALBRIDGE_PROD, we need to fully qualify them
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n── Step 5: Recreate views in CALBRIDGE_PROD.APP ──');

  // campaign_performance — references sp/sb/sd/dsp_campaign_report tables
  // After .env flip these tables are in CALBRIDGE_PROD.APP
  // We create the view in CALBRIDGE_PROD.APP and reference the tables fully qualified
  await run('Create APP.CAMPAIGN_PERFORMANCE view', `
    CREATE OR REPLACE VIEW CALBRIDGE_PROD.APP.CAMPAIGN_PERFORMANCE AS
    -- SP
    SELECT client_id, profile_id, campaign_id, campaign_name, campaign_status,
      campaign_budget_amount, campaign_budget_currency_code, 'SP' AS ad_type, date,
      cost AS spend, impressions, clicks,
      sales_30_d AS sales, purchases_30_d AS orders, units_sold_clicks_30_d AS units_sold,
      sales_7_d, purchases_7_d AS orders_7d,
      top_of_search_impression_share,
      NULL::FLOAT AS new_to_brand_purchases, NULL::FLOAT AS new_to_brand_sales,
      NULL::FLOAT AS new_to_brand_units_sold,
      NULL::FLOAT AS detail_page_views, NULL::FLOAT AS add_to_cart,
      NULL::FLOAT AS viewability_rate, NULL::FLOAT AS roas_direct
    FROM CALBRIDGE_PROD.APP.sp_campaign_report

    UNION ALL

    -- SB
    SELECT client_id, profile_id, campaign_id, campaign_name, campaign_status,
      campaign_budget_amount, campaign_budget_currency_code, 'SB' AS ad_type, report_date AS date,
      cost AS spend, impressions, clicks,
      sales AS sales, purchases AS orders, units_sold,
      NULL::FLOAT AS sales_7d, NULL::FLOAT AS orders_7d,
      top_of_search_impression_share,
      new_to_brand_purchases::FLOAT, new_to_brand_sales,
      new_to_brand_units_sold::FLOAT, detail_page_views::FLOAT,
      add_to_cart::FLOAT, viewability_rate, NULL::FLOAT AS roas_direct
    FROM CALBRIDGE_PROD.APP.sb_campaign_report

    UNION ALL

    -- SD
    SELECT client_id, profile_id, campaign_id, campaign_name, campaign_status,
      campaign_budget_amount, campaign_budget_currency_code, 'SD' AS ad_type, date,
      cost AS spend, impressions, clicks,
      sales, purchases AS orders, units_sold,
      NULL::FLOAT AS sales_7d, NULL::FLOAT AS orders_7d,
      NULL::FLOAT AS top_of_search_impression_share,
      new_to_brand_purchases::FLOAT, new_to_brand_sales,
      new_to_brand_units_sold::FLOAT, detail_page_views::FLOAT,
      add_to_cart::FLOAT, viewability_rate, NULL::FLOAT AS roas_direct
    FROM CALBRIDGE_PROD.APP.sd_campaign_report

    UNION ALL

    -- DSP
    SELECT client_id, profile_id,
      order_id AS campaign_id, order_name AS campaign_name,
      'ACTIVE' AS campaign_status, NULL::FLOAT AS campaign_budget_amount,
      NULL::VARCHAR AS campaign_budget_currency_code, 'DSP' AS ad_type, date,
      total_cost AS spend, impressions, clicks,
      COALESCE(total_sales, sales) AS sales,
      COALESCE(total_purchases, purchases) AS orders,
      NULL::FLOAT AS units_sold,
      NULL::FLOAT AS sales_7d, NULL::FLOAT AS orders_7d,
      NULL::FLOAT AS top_of_search_impression_share,
      new_to_brand_purchases::FLOAT, new_to_brand_product_sales AS new_to_brand_sales,
      NULL::FLOAT AS new_to_brand_units_sold, detail_page_views::FLOAT,
      add_to_cart::FLOAT, viewability_rate, NULL::FLOAT AS roas_direct
    FROM CALBRIDGE_PROD.APP.dsp_campaign_report
  `);

  // adjusted_campaign_performance — references campaign_performance + spend_adjustments
  await run('Create APP.ADJUSTED_CAMPAIGN_PERFORMANCE view', `
    CREATE OR REPLACE VIEW CALBRIDGE_PROD.APP.ADJUSTED_CAMPAIGN_PERFORMANCE AS
    SELECT
      cp.*,
      cp.spend * COALESCE(
        sa_exact.multiplier,
        sa_sa.multiplier,
        sa_all.multiplier,
        1.0
      ) AS adjusted_spend
    FROM CALBRIDGE_PROD.APP.CAMPAIGN_PERFORMANCE cp
    LEFT JOIN CALBRIDGE_PROD.APP.SPEND_ADJUSTMENTS sa_exact
      ON  sa_exact.client_id  = cp.client_id
      AND sa_exact.year_month = TO_VARCHAR(cp.date, 'YYYY-MM')
      AND sa_exact.ad_type    = cp.ad_type
    LEFT JOIN CALBRIDGE_PROD.APP.SPEND_ADJUSTMENTS sa_sa
      ON  sa_sa.client_id  = cp.client_id
      AND sa_sa.year_month = TO_VARCHAR(cp.date, 'YYYY-MM')
      AND sa_sa.ad_type    = 'SA'
      AND cp.ad_type IN ('SP', 'SB', 'SD')
    LEFT JOIN CALBRIDGE_PROD.APP.SPEND_ADJUSTMENTS sa_all
      ON  sa_all.client_id  = cp.client_id
      AND sa_all.year_month = TO_VARCHAR(cp.date, 'YYYY-MM')
      AND sa_all.ad_type    = 'ALL'
  `);

  // adjusted_dsp_campaign_report — references dsp_campaign_report + spend_adjustments
  await run('Create APP.ADJUSTED_DSP_CAMPAIGN_REPORT view', `
    CREATE OR REPLACE VIEW CALBRIDGE_PROD.APP.ADJUSTED_DSP_CAMPAIGN_REPORT AS
    SELECT
      d.*,
      d.total_cost * COALESCE(
        sa_exact.multiplier,
        sa_all.multiplier,
        1.0
      ) AS adjusted_cost
    FROM CALBRIDGE_PROD.APP.dsp_campaign_report d
    LEFT JOIN CALBRIDGE_PROD.APP.SPEND_ADJUSTMENTS sa_exact
      ON  sa_exact.client_id  = d.client_id
      AND sa_exact.year_month = TO_VARCHAR(d.date, 'YYYY-MM')
      AND sa_exact.ad_type    = 'DSP'
    LEFT JOIN CALBRIDGE_PROD.APP.SPEND_ADJUSTMENTS sa_all
      ON  sa_all.client_id  = d.client_id
      AND sa_all.year_month = TO_VARCHAR(d.date, 'YYYY-MM')
      AND sa_all.ad_type    = 'ALL'
  `);

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 6: Update ADJUSTED_AD_CAMPAIGN view to use CALBRIDGE_PROD.APP.SPEND_ADJUSTMENTS
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n── Step 6: Update CALBRIDGE_PROD.RAW.ADJUSTED_AD_CAMPAIGN view ──');

  await run('Update RAW.ADJUSTED_AD_CAMPAIGN view', `
    CREATE OR REPLACE VIEW CALBRIDGE_PROD.RAW.ADJUSTED_AD_CAMPAIGN AS
    SELECT
      ac.*,
      ac.cost * COALESCE(
        sa_exact.multiplier,
        sa_sa.multiplier,
        sa_all.multiplier,
        1.0
      ) AS adjusted_cost
    FROM CALBRIDGE_PROD.RAW.AD_CAMPAIGN ac
    LEFT JOIN CALBRIDGE_PROD.APP.SPEND_ADJUSTMENTS sa_exact
      ON  sa_exact.client_id  = ac.client_id
      AND sa_exact.year_month = TO_VARCHAR(ac.date, 'YYYY-MM')
      AND sa_exact.ad_type    = CASE ac.ad_product
            WHEN 'SPONSORED_PRODUCTS' THEN 'SP'
            WHEN 'SPONSORED_BRANDS'   THEN 'SB'
            WHEN 'SPONSORED_DISPLAY'  THEN 'SD'
            WHEN 'DSP'                THEN 'DSP'
            ELSE ac.ad_product END
    LEFT JOIN CALBRIDGE_PROD.APP.SPEND_ADJUSTMENTS sa_sa
      ON  sa_sa.client_id  = ac.client_id
      AND sa_sa.year_month = TO_VARCHAR(ac.date, 'YYYY-MM')
      AND sa_sa.ad_type    = 'SA'
      AND ac.ad_product IN ('SPONSORED_PRODUCTS','SPONSORED_BRANDS','SPONSORED_DISPLAY')
    LEFT JOIN CALBRIDGE_PROD.APP.SPEND_ADJUSTMENTS sa_all
      ON  sa_all.client_id  = ac.client_id
      AND sa_all.year_month = TO_VARCHAR(ac.date, 'YYYY-MM')
      AND sa_all.ad_type    = 'ALL'
  `);

  console.log('\n=== MIGRATION COMPLETE ===');
  process.exit(0);
}

main().catch(e => {
  console.error('\n❌ Migration failed:', e.message);
  console.error(e);
  process.exit(1);
});
