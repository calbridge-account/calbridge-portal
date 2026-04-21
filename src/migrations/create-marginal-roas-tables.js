'use strict';
/**
 * Migration: Create ASIN_ECONOMICS and CAMPAIGN_MARGINAL_ROAS tables.
 * Run once: node src/migrations/create-marginal-roas-tables.js
 */
require('dotenv').config();
const { query } = require('../services/snowflakeService');

async function run() {
  console.log('[migration] Creating ASIN_ECONOMICS...');
  await query(`
    CREATE TABLE IF NOT EXISTS CALBRIDGE_PROD.APP.ASIN_ECONOMICS (
      client_id             VARCHAR(255)  NOT NULL,
      asin                  VARCHAR(20)   NOT NULL,
      marketplace           VARCHAR(20)   DEFAULT 'ATVPDKIKX0DER',
      cogs                  DECIMAL(10,2),
      fba_fee               DECIMAL(10,2),
      referral_fee_pct      DECIMAL(5,4)  DEFAULT 0.15,
      avg_selling_price     DECIMAL(10,2),
      contribution_margin   DECIMAL(10,2),
      break_even_acos       DECIMAL(5,4),
      data_source           VARCHAR(20)   DEFAULT 'manual',
      updated_at            TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
      PRIMARY KEY (client_id, asin, marketplace)
    )
  `);
  console.log('[migration] ✅ ASIN_ECONOMICS created (or already exists)');

  console.log('[migration] Creating CAMPAIGN_MARGINAL_ROAS...');
  await query(`
    CREATE TABLE IF NOT EXISTS CALBRIDGE_PROD.APP.CAMPAIGN_MARGINAL_ROAS (
      client_id                   VARCHAR(255)  NOT NULL,
      campaign_id                 VARCHAR(255)  NOT NULL,
      marketplace                 VARCHAR(20)   DEFAULT 'ATVPDKIKX0DER',
      ad_type                     VARCHAR(10),
      scored_at                   DATE          NOT NULL,
      avg_daily_spend             DECIMAL(10,2),
      avg_daily_sales             DECIMAL(10,2),
      blended_roas                DECIMAL(8,4),
      marginal_roas               DECIMAL(8,4),
      weighted_break_even_acos    DECIMAL(5,4),
      contribution_margin_at_spend DECIMAL(10,2),
      efficiency_score            DECIMAL(5,2),
      recommendation              VARCHAR(30),
      confidence                  VARCHAR(10),
      PRIMARY KEY (client_id, campaign_id, marketplace, scored_at)
    )
  `);
  console.log('[migration] ✅ CAMPAIGN_MARGINAL_ROAS created (or already exists)');

  console.log('[migration] Done.');
  process.exit(0);
}

run().catch(err => {
  console.error('[migration] ❌ Error:', err.message);
  process.exit(1);
});
