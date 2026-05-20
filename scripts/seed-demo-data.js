/**
 * seed-demo-data.js
 * 
 * Creates the Apex Pet Supplies demo account and seeds 90 days of realistic
 * advertising + retail data for sales demos at app.calbridge.ai.
 *
 * Demo account:
 *   Email:    demo@calbridge.ai
 *   Password: set via DEMO_PASSWORD env var
 *   Brand:    Apex Pet Supplies
 */

require('dotenv').config();
const { query } = require('../src/services/snowflakeService');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

// ─── Constants ────────────────────────────────────────────────────────────────
const CLIENT_ID     = 'demo-client-001';
const MANAGER_ID    = 'demo-manager-001';
const ADVERTISER_ID = 'demo-advertiser-001';
const USER_ID       = 'demo-user-001';
const PROFILE_ID    = 'demo-profile-001';
const EMAIL         = 'demo@calbridge.ai';
const PASSWORD      = process.env.DEMO_PASSWORD || 'REDACTED_PASSWORD';
const BRAND_NAME    = 'Apex Pet Supplies';
const DAYS_BACK     = 90;

// ─── Product catalogue ───────────────────────────────────────────────────────
// 10 fictional ASINs, each with its own revenue tier
const PRODUCTS = [
  { asin: 'B0DEMO00001', sku: 'APS-DOGBED-L-GRY', name: 'Apex Premium Orthopedic Dog Bed Large', price: 79.99, unitShare: 0.22 },
  { asin: 'B0DEMO00002', sku: 'APS-DOGBED-M-BRN', name: 'Apex Memory Foam Dog Bed Medium',       price: 54.99, unitShare: 0.18 },
  { asin: 'B0DEMO00003', sku: 'APS-CATTOY-FEATH', name: 'Apex Interactive Feather Cat Toy',       price: 14.99, unitShare: 0.15 },
  { asin: 'B0DEMO00004', sku: 'APS-CATTOY-LASER', name: 'Apex Laser Pointer Cat Toy Set',          price: 19.99, unitShare: 0.10 },
  { asin: 'B0DEMO00005', sku: 'APS-GROOM-KIT-5P', name: 'Apex 5-Piece Pet Grooming Kit',          price: 34.99, unitShare: 0.12 },
  { asin: 'B0DEMO00006', sku: 'APS-GROOM-BRUSH',  name: 'Apex Self-Cleaning Slicker Brush',       price: 22.99, unitShare: 0.08 },
  { asin: 'B0DEMO00007', sku: 'APS-PUPPAD-50CT',  name: 'Apex Puppy Training Pads 50-Count',      price: 24.99, unitShare: 0.06 },
  { asin: 'B0DEMO00008', sku: 'APS-PUPPAD-100CT', name: 'Apex Puppy Training Pads 100-Count',     price: 39.99, unitShare: 0.04 },
  { asin: 'B0DEMO00009', sku: 'APS-DOGBED-S-BLU', name: 'Apex Cozy Dog Bed Small Blue',           price: 39.99, unitShare: 0.03 },
  { asin: 'B0DEMO00010', sku: 'APS-CATTOY-WAND',  name: 'Apex Telescoping Wand Cat Toy',          price: 12.99, unitShare: 0.02 },
];

// ─── Campaign definitions ────────────────────────────────────────────────────
const SP_CAMPAIGNS = [
  { id: 'demo-sp-c001', name: 'SP | Auto | Dog Beds | Apex',         strategy: 'auto',   budget: 120, targetAcos: 0.22, adGroupId: 'demo-sp-ag001' },
  { id: 'demo-sp-c002', name: 'SP | Manual | Dog Beds - Exact',      strategy: 'manual', budget: 150, targetAcos: 0.20, adGroupId: 'demo-sp-ag002' },
  { id: 'demo-sp-c003', name: 'SP | Manual | Dog Beds - Broad',      strategy: 'manual', budget: 80,  targetAcos: 0.25, adGroupId: 'demo-sp-ag003' },
  { id: 'demo-sp-c004', name: 'SP | Auto | Cat Toys | Apex',         strategy: 'auto',   budget: 70,  targetAcos: 0.28, adGroupId: 'demo-sp-ag004' },
  { id: 'demo-sp-c005', name: 'SP | Manual | Cat Toys - Exact',      strategy: 'manual', budget: 60,  targetAcos: 0.24, adGroupId: 'demo-sp-ag005' },
  { id: 'demo-sp-c006', name: 'SP | Manual | Grooming Kits - Broad', strategy: 'manual', budget: 80,  targetAcos: 0.26, adGroupId: 'demo-sp-ag006' },
  { id: 'demo-sp-c007', name: 'SP | Auto | Grooming | Apex',         strategy: 'auto',   budget: 50,  targetAcos: 0.30, adGroupId: 'demo-sp-ag007' },
  { id: 'demo-sp-c008', name: 'SP | Manual | Training Pads - Exact', strategy: 'manual', budget: 55,  targetAcos: 0.21, adGroupId: 'demo-sp-ag008' },
  { id: 'demo-sp-c009', name: 'SP | Auto | Training Pads | Apex',    strategy: 'auto',   budget: 40,  targetAcos: 0.27, adGroupId: 'demo-sp-ag009' },
  { id: 'demo-sp-c010', name: 'SP | Manual | Brand Defense',         strategy: 'manual', budget: 35,  targetAcos: 0.12, adGroupId: 'demo-sp-ag010' },
];

const SB_CAMPAIGNS = [
  { id: 'demo-sb-c001', name: 'SB | Dog Beds Collection | Apex Pet',     budget: 80,  targetAcos: 0.30 },
  { id: 'demo-sb-c002', name: 'SB | Cat Toys - Lifestyle | Apex Pet',    budget: 50,  targetAcos: 0.35 },
  { id: 'demo-sb-c003', name: 'SB | Grooming Essentials | Apex Pet',     budget: 40,  targetAcos: 0.32 },
];

const SD_CAMPAIGNS = [
  { id: 'demo-sd-c001', name: 'SD | Retargeting | Dog Bed Viewers',      budget: 60,  targetAcos: 0.38 },
  { id: 'demo-sd-c002', name: 'SD | Contextual | Pet Care Category',     budget: 40,  targetAcos: 0.42 },
];

// ─── Keywords ────────────────────────────────────────────────────────────────
const SP_KEYWORDS = {
  'demo-sp-c002': [
    { kwId: 'kw-d-001', keyword: 'orthopedic dog bed', matchType: 'exact', bid: 1.45 },
    { kwId: 'kw-d-002', keyword: 'large dog bed',      matchType: 'exact', bid: 1.20 },
    { kwId: 'kw-d-003', keyword: 'memory foam dog bed',matchType: 'exact', bid: 1.35 },
  ],
  'demo-sp-c003': [
    { kwId: 'kw-d-004', keyword: 'dog bed',            matchType: 'broad', bid: 0.85 },
    { kwId: 'kw-d-005', keyword: 'dog sleeping mat',   matchType: 'broad', bid: 0.72 },
    { kwId: 'kw-d-006', keyword: 'pet bed large',      matchType: 'phrase',bid: 0.95 },
  ],
  'demo-sp-c005': [
    { kwId: 'kw-d-007', keyword: 'cat toy feather',    matchType: 'exact', bid: 0.78 },
    { kwId: 'kw-d-008', keyword: 'interactive cat toy',matchType: 'exact', bid: 0.92 },
  ],
  'demo-sp-c008': [
    { kwId: 'kw-d-009', keyword: 'puppy training pads',matchType: 'exact', bid: 0.65 },
    { kwId: 'kw-d-010', keyword: 'puppy pads 50 count',matchType: 'exact', bid: 0.58 },
  ],
  'demo-sp-c010': [
    { kwId: 'kw-d-011', keyword: 'apex pet supplies',  matchType: 'exact', bid: 0.42 },
    { kwId: 'kw-d-012', keyword: 'apex dog bed',       matchType: 'exact', bid: 0.38 },
  ],
};

// ─── Search terms ────────────────────────────────────────────────────────────
const SEARCH_TERMS_BY_CAMPAIGN = {
  'demo-sp-c001': ['dog bed large', 'big dog bed', 'orthopedic pet bed', 'washable dog bed', 'dog sofa bed'],
  'demo-sp-c002': ['orthopedic dog bed', 'large orthopedic dog bed', 'memory foam dog bed large'],
  'demo-sp-c003': ['dog bed', 'dog sleeping pad', 'dog mat large', 'cozy dog bed', 'fluffy dog bed'],
  'demo-sp-c004': ['cat toy', 'interactive cat toy', 'feather toy for cats', 'cat wand toy'],
  'demo-sp-c005': ['cat toy feather', 'feather cat wand', 'interactive feather toy'],
  'demo-sp-c006': ['pet grooming kit', 'dog grooming brush', 'cat grooming set', 'pet hair brush'],
  'demo-sp-c007': ['grooming kit dog', 'pet brush set', 'slicker brush dog', 'dog deshedding tool'],
  'demo-sp-c008': ['puppy pads', 'training pads for dogs', 'wee wee pads 50 count', 'puppy training mats'],
  'demo-sp-c009': ['puppy training pads', 'dog pads disposable', 'house training pads dogs'],
  'demo-sp-c010': ['apex pet', 'apex dog bed', 'apex pet supplies'],
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function rand(min, max) {
  return Math.random() * (max - min) + min;
}

function randInt(min, max) {
  return Math.floor(rand(min, max + 1));
}

/**
 * Seasonal + weekend multiplier.
 * Pet supplies are slightly higher mid-week, slightly down on weekends.
 * Add gentle upward trend over 90 days (more recent = slightly better).
 */
function dayMultiplier(date, daysFromStart) {
  const dow = date.getDay(); // 0=Sun, 6=Sat
  const weekendFactor = (dow === 0 || dow === 6) ? rand(0.82, 0.94) : rand(0.95, 1.08);
  const trendFactor   = 1 + (daysFromStart / 90) * 0.12; // +12% growth over 90 days
  const noiseFactor   = rand(0.88, 1.12);
  return weekendFactor * trendFactor * noiseFactor;
}

function dateStr(d) {
  return d.toISOString().slice(0, 10);
}

/**
 * Generate daily dates from -90 days to -1 day (yesterday)
 */
function getDates(daysBack = DAYS_BACK) {
  const dates = [];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  for (let i = daysBack; i >= 1; i--) {
    const d = new Date(today);
    d.setUTCDate(today.getUTCDate() - i);
    dates.push(d);
  }
  return dates;
}

/**
 * Build SP campaign metrics for a given day
 */
function spMetrics(campaign, mult) {
  const dailyBudgetSpend = Math.min(campaign.budget, campaign.budget * rand(0.72, 0.97)) * mult;
  const impressions  = Math.round(rand(3000, 15000) * mult);
  const ctr          = rand(0.003, 0.008);
  const clicks       = Math.max(1, Math.round(impressions * ctr));
  const cpc          = rand(0.65, 2.10);
  const cost         = Math.min(dailyBudgetSpend, clicks * cpc);
  const cvr          = rand(0.08, 0.18);
  const purchases7d  = Math.max(0, Math.round(clicks * cvr));
  const avgOrderVal  = rand(28, 72);
  const sales7d      = purchases7d * avgOrderVal;
  const topShare     = rand(0.04, 0.22);
  return {
    impressions,
    clicks,
    cost: +cost.toFixed(2),
    purchases7d,
    sales7d: +sales7d.toFixed(2),
    topShare: +topShare.toFixed(4),
  };
}

/**
 * Build SB campaign metrics for a given day
 */
function sbMetrics(campaign, mult) {
  const impressions  = Math.round(rand(8000, 45000) * mult);
  const ctr          = rand(0.0025, 0.006);
  const clicks       = Math.max(1, Math.round(impressions * ctr));
  const cpc          = rand(0.75, 1.80);
  const cost         = Math.min(campaign.budget * rand(0.7, 0.95) * mult, clicks * cpc);
  const cvr          = rand(0.05, 0.14);
  const purchases    = Math.max(0, Math.round(clicks * cvr));
  const avgOrderVal  = rand(35, 80);
  const sales        = purchases * avgOrderVal;
  const ntb          = Math.round(purchases * rand(0.28, 0.45));
  const ntbSales     = ntb * avgOrderVal;
  return {
    impressions,
    clicks,
    cost: +cost.toFixed(2),
    purchases,
    sales: +sales.toFixed(2),
    ntb,
    ntbSales: +ntbSales.toFixed(2),
    dpv: Math.round(clicks * rand(1.4, 2.2)),
    atc: Math.max(0, Math.round(clicks * rand(0.12, 0.25))),
  };
}

/**
 * Build SD campaign metrics for a given day
 */
function sdMetrics(campaign, mult) {
  const impressions  = Math.round(rand(12000, 60000) * mult);
  const clicks       = Math.max(1, Math.round(impressions * rand(0.0015, 0.004)));
  const cost         = Math.min(campaign.budget * rand(0.6, 0.9) * mult, clicks * rand(0.55, 1.40));
  const purchases    = Math.max(0, Math.round(clicks * rand(0.04, 0.10)));
  const sales        = purchases * rand(22, 65);
  const dpv          = Math.round(impressions * rand(0.003, 0.008));
  return {
    impressions,
    clicks,
    cost: +cost.toFixed(2),
    purchases,
    sales: +sales.toFixed(2),
    dpv,
    atc: Math.round(clicks * rand(0.08, 0.18)),
  };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function run() {
  console.log('🚀 Seeding Apex Pet Supplies demo account...\n');

  // ── 1. Hash password ──────────────────────────────────────────────────────
  const passwordHash = await bcrypt.hash(PASSWORD, 12);

  // ── 2. Create client account ──────────────────────────────────────────────
  console.log('📋 Creating client account...');

  // Remove existing demo data first (idempotent)
  await query(`DELETE FROM CALBRIDGE_PROD.APP.CLIENTS WHERE client_id = ?`, [CLIENT_ID]).catch(() => {});
  await query(`DELETE FROM CALBRIDGE_PROD.APP.MANAGER_ACCOUNTS WHERE manager_id = ?`, [MANAGER_ID]).catch(() => {});
  await query(`DELETE FROM CALBRIDGE_PROD.APP.ADVERTISER_ACCOUNTS WHERE advertiser_id = ?`, [ADVERTISER_ID]).catch(() => {});
  await query(`DELETE FROM CALBRIDGE_PROD.APP.USERS WHERE client_id = ?`, [CLIENT_ID]).catch(() => {});
  await query(`DELETE FROM CALBRIDGE_PROD.APP.CLIENT_MIGRATION_MAP WHERE client_id = ?`, [CLIENT_ID]).catch(() => {});
  await query(`DELETE FROM CALBRIDGE_PROD.APP.USER_ADVERTISER_ACCESS WHERE user_id = ?`, [USER_ID]).catch(() => {});
  console.log('  ✓ Cleared any previous demo data');

  // Insert client
  await query(`
    INSERT INTO CALBRIDGE_PROD.APP.CLIENTS
      (client_id, email, name, client_name, client_type, company_name, password_hash, status,
       account_type, subscription_plan, subscription_status, onboarding_completed,
       email_verified_at, approved_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'client', ?, ?, 'active', 'brand', 'growth', 'active',
            TRUE, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())
  `, [CLIENT_ID, EMAIL, 'Demo User', BRAND_NAME, BRAND_NAME, passwordHash]);
  console.log(`  ✓ Client: ${EMAIL} / ${PASSWORD}`);

  // Insert manager_account
  await query(`
    INSERT INTO CALBRIDGE_PROD.APP.MANAGER_ACCOUNTS
      (manager_id, name, subscription_plan, subscription_status, billing_exempt, created_at)
    VALUES (?, ?, 'growth', 'active', TRUE, CURRENT_TIMESTAMP())
  `, [MANAGER_ID, BRAND_NAME]);
  console.log(`  ✓ Manager account: ${MANAGER_ID}`);

  // Insert advertiser_account
  await query(`
    INSERT INTO CALBRIDGE_PROD.APP.ADVERTISER_ACCOUNTS
      (advertiser_id, manager_id, name, marketplace, is_active, created_at)
    VALUES (?, ?, ?, 'US', TRUE, CURRENT_TIMESTAMP())
  `, [ADVERTISER_ID, MANAGER_ID, `${BRAND_NAME} · US`]);
  console.log(`  ✓ Advertiser: ${ADVERTISER_ID}`);

  // Insert user
  await query(`
    INSERT INTO CALBRIDGE_PROD.APP.USERS
      (user_id, client_id, email, name, role, is_active, created_at)
    VALUES (?, ?, ?, ?, 'manager_owner', TRUE, CURRENT_TIMESTAMP())
  `, [USER_ID, CLIENT_ID, EMAIL, 'Demo User']);
  console.log(`  ✓ User row: ${USER_ID}`);

  // Insert user_advertiser_access
  await query(`
    INSERT INTO CALBRIDGE_PROD.APP.USER_ADVERTISER_ACCESS
      (user_id, advertiser_id, role)
    VALUES (?, ?, 'manager_owner')
  `, [USER_ID, ADVERTISER_ID]);
  console.log(`  ✓ User advertiser access`);

  // Insert migration map
  await query(`
    INSERT INTO CALBRIDGE_PROD.APP.CLIENT_MIGRATION_MAP
      (client_id, manager_id, advertiser_id, agency_id, migrated_at)
    VALUES (?, ?, ?, NULL, CURRENT_TIMESTAMP())
  `, [CLIENT_ID, MANAGER_ID, ADVERTISER_ID]);
  console.log(`  ✓ Migration map\n`);

  // ── 3. Generate date range ─────────────────────────────────────────────────
  const dates = getDates(DAYS_BACK);
  console.log(`📅 Seeding ${dates.length} days: ${dateStr(dates[0])} → ${dateStr(dates[dates.length - 1])}\n`);

  // ── 4. SP Campaign Report ──────────────────────────────────────────────────
  console.log('📊 Inserting SP_CAMPAIGN_REPORT data...');
  // Delete existing
  await query(`DELETE FROM CALBRIDGE_PROD.APP.SP_CAMPAIGN_REPORT WHERE client_id = ?`, [CLIENT_ID]).catch(() => {});

  let spTotalSpend = 0, spTotalSales = 0;
  const spRows = [];
  for (const [di, d] of dates.entries()) {
    const mult = dayMultiplier(d, di);
    for (const c of SP_CAMPAIGNS) {
      const m = spMetrics(c, mult);
      spTotalSpend += m.cost;
      spTotalSales += m.sales7d;
      spRows.push([
        CLIENT_ID, PROFILE_ID, c.id, dateStr(d),
        c.name, 'ENABLED', c.budget, 'DAILY_BUDGET', 'USD', null, null, null,
        c.strategy === 'auto' ? 'legacyForSales' : 'manual',
        'demo-portfolio-001', m.topShare,
        m.impressions, m.clicks, m.cost,
        Math.round(m.purchases7d * 0.6), m.purchases7d, m.purchases7d, m.purchases7d,
        Math.round(m.purchases7d * 0.5), Math.round(m.purchases7d * 0.5), Math.round(m.purchases7d * 0.5), Math.round(m.purchases7d * 0.5),
        m.purchases7d, m.purchases7d, m.purchases7d, m.purchases7d,
        Math.round(m.purchases7d * 0.5), Math.round(m.purchases7d * 0.5), Math.round(m.purchases7d * 0.5), Math.round(m.purchases7d * 0.5),
        +(m.sales7d * 0.6).toFixed(2), m.sales7d, m.sales7d, m.sales7d,
        +(m.sales7d * 0.5).toFixed(2), +(m.sales7d * 0.5).toFixed(2), +(m.sales7d * 0.5).toFixed(2), +(m.sales7d * 0.5).toFixed(2),
        0, 0.0, 0, 0, 0,
      ]);
    }
  }

  // Batch insert in chunks of 500
  for (let i = 0; i < spRows.length; i += 500) {
    const batch = spRows.slice(i, i + 500);
    const placeholders = batch.map(() =>
      `(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP())`
    ).join(',');
    const flat = batch.flat();
    await query(`
      INSERT INTO CALBRIDGE_PROD.APP.SP_CAMPAIGN_REPORT
        (client_id,profile_id,campaign_id,date,campaign_name,campaign_status,
         campaign_budget_amount,campaign_budget_type,campaign_budget_currency_code,
         campaign_rule_based_budget_amount,campaign_applicable_budget_rule_id,
         campaign_applicable_budget_rule_name,campaign_bidding_strategy,portfolio_id,
         top_of_search_impression_share,
         impressions,clicks,cost,
         purchases_1_d,purchases_7_d,purchases_14_d,purchases_30_d,
         purchases_same_sku_1_d,purchases_same_sku_7_d,purchases_same_sku_14_d,purchases_same_sku_30_d,
         units_sold_clicks_1_d,units_sold_clicks_7_d,units_sold_clicks_14_d,units_sold_clicks_30_d,
         units_sold_same_sku_1_d,units_sold_same_sku_7_d,units_sold_same_sku_14_d,units_sold_same_sku_30_d,
         sales_1_d,sales_7_d,sales_14_d,sales_30_d,
         attributed_sales_same_sku_1_d,attributed_sales_same_sku_7_d,
         attributed_sales_same_sku_14_d,attributed_sales_same_sku_30_d,
         kindle_edition_normalized_pages_read_14_d,kindle_edition_normalized_pages_royalties_14_d,
         add_to_list,qualified_borrows,royalty_qualified_borrows,
         synced_at)
      VALUES ${placeholders}
    `, flat);
    process.stdout.write(`\r  Inserted ${Math.min(i + 500, spRows.length)}/${spRows.length} SP campaign rows`);
  }
  console.log(`\n  ✓ SP campaigns: ${spRows.length} rows | Spend: $${spTotalSpend.toFixed(0)} | Sales: $${spTotalSales.toFixed(0)}\n`);

  // ── 5. SP Ad Group Report ──────────────────────────────────────────────────
  console.log('📊 Inserting SP_AD_GROUP_REPORT data...');
  await query(`DELETE FROM CALBRIDGE_PROD.APP.SP_AD_GROUP_REPORT WHERE client_id = ?`, [CLIENT_ID]).catch(() => {});

  const spAgRows = [];
  for (const [di, d] of dates.entries()) {
    const mult = dayMultiplier(d, di);
    for (const c of SP_CAMPAIGNS) {
      const m = spMetrics(c, mult);
      spAgRows.push([
        CLIENT_ID, PROFILE_ID, c.adGroupId, dateStr(d),
        c.name + ' | Ad Group', 'ENABLED',
        c.id, c.name, 'ENABLED',
        c.budget, 'DAILY_BUDGET', 'USD', c.strategy === 'auto' ? 'legacyForSales' : 'manual',
        'demo-portfolio-001',
        m.impressions, m.clicks, m.cost,
        Math.round(m.purchases7d * 0.6), m.purchases7d, m.purchases7d, m.purchases7d,
        Math.round(m.purchases7d * 0.5), Math.round(m.purchases7d * 0.5), Math.round(m.purchases7d * 0.5), Math.round(m.purchases7d * 0.5),
        m.purchases7d, m.purchases7d, m.purchases7d, m.purchases7d,
        Math.round(m.purchases7d * 0.5), Math.round(m.purchases7d * 0.5), Math.round(m.purchases7d * 0.5), Math.round(m.purchases7d * 0.5),
        +(m.sales7d * 0.6).toFixed(2), m.sales7d, m.sales7d, m.sales7d,
        +(m.sales7d * 0.5).toFixed(2), +(m.sales7d * 0.5).toFixed(2), +(m.sales7d * 0.5).toFixed(2), +(m.sales7d * 0.5).toFixed(2),
      ]);
    }
  }

  for (let i = 0; i < spAgRows.length; i += 500) {
    const batch = spAgRows.slice(i, i + 500);
    const placeholders = batch.map(() =>
      `(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP())`
    ).join(',');
    await query(`
      INSERT INTO CALBRIDGE_PROD.APP.SP_AD_GROUP_REPORT
        (client_id,profile_id,ad_group_id,date,
         ad_group_name,ad_status,
         campaign_id,campaign_name,campaign_status,
         campaign_budget_amount,campaign_budget_type,campaign_budget_currency_code,
         campaign_bidding_strategy,portfolio_id,
         impressions,clicks,cost,
         purchases_1_d,purchases_7_d,purchases_14_d,purchases_30_d,
         purchases_same_sku_1_d,purchases_same_sku_7_d,purchases_same_sku_14_d,purchases_same_sku_30_d,
         units_sold_clicks_1_d,units_sold_clicks_7_d,units_sold_clicks_14_d,units_sold_clicks_30_d,
         units_sold_same_sku_1_d,units_sold_same_sku_7_d,units_sold_same_sku_14_d,units_sold_same_sku_30_d,
         sales_1_d,sales_7_d,sales_14_d,sales_30_d,
         attributed_sales_same_sku_1_d,attributed_sales_same_sku_7_d,
         attributed_sales_same_sku_14_d,attributed_sales_same_sku_30_d,
         synced_at)
      VALUES ${placeholders}
    `, batch.flat());
    process.stdout.write(`\r  Inserted ${Math.min(i + 500, spAgRows.length)}/${spAgRows.length} SP ad group rows`);
  }
  console.log(`\n  ✓ SP ad groups: ${spAgRows.length} rows\n`);

  // ── 6. SP Advertised Product Report ───────────────────────────────────────
  console.log('📊 Inserting SP_ADVERTISED_PRODUCT_REPORT data...');
  await query(`DELETE FROM CALBRIDGE_PROD.APP.SP_ADVERTISED_PRODUCT_REPORT WHERE client_id = ?`, [CLIENT_ID]).catch(() => {});

  const spApRows = [];
  const campaignProductMap = {
    'demo-sp-c001': ['B0DEMO00001', 'B0DEMO00002', 'B0DEMO00009'],
    'demo-sp-c002': ['B0DEMO00001', 'B0DEMO00002'],
    'demo-sp-c003': ['B0DEMO00001', 'B0DEMO00002', 'B0DEMO00009'],
    'demo-sp-c004': ['B0DEMO00003', 'B0DEMO00004', 'B0DEMO00010'],
    'demo-sp-c005': ['B0DEMO00003', 'B0DEMO00004'],
    'demo-sp-c006': ['B0DEMO00005', 'B0DEMO00006'],
    'demo-sp-c007': ['B0DEMO00005', 'B0DEMO00006'],
    'demo-sp-c008': ['B0DEMO00007', 'B0DEMO00008'],
    'demo-sp-c009': ['B0DEMO00007', 'B0DEMO00008'],
    'demo-sp-c010': ['B0DEMO00001', 'B0DEMO00003', 'B0DEMO00005'],
  };

  for (const [di, d] of dates.entries()) {
    const mult = dayMultiplier(d, di);
    for (const c of SP_CAMPAIGNS) {
      const asins = campaignProductMap[c.id] || ['B0DEMO00001'];
      const totalM = spMetrics(c, mult);
      const share = 1 / asins.length;
      for (const asin of asins) {
        const prod = PRODUCTS.find(p => p.asin === asin);
        const adId = `demo-ad-${c.id.slice(-4)}-${asin.slice(-4)}`;
        const impr = Math.round(totalM.impressions * share * rand(0.7, 1.3));
        const clks = Math.max(0, Math.round(impr * rand(0.003, 0.008)));
        const cost = +(clks * rand(0.65, 2.10)).toFixed(2);
        const purch = Math.max(0, Math.round(clks * rand(0.06, 0.16)));
        const salesV = +(purch * (prod ? prod.price : 45)).toFixed(2);
        spApRows.push([
          CLIENT_ID, PROFILE_ID, c.id, c.adGroupId, adId, dateStr(d),
          asin, prod ? prod.sku : 'APS-UNKNOWN',
          c.name, 'ENABLED', c.budget, 'DAILY_BUDGET', 'USD',
          c.strategy === 'auto' ? 'legacyForSales' : 'manual',
          'demo-portfolio-001', c.name + ' | Ad Group',
          impr, clks, cost,
          Math.round(purch * 0.6), purch, purch, purch,
          Math.round(purch * 0.5), Math.round(purch * 0.5), Math.round(purch * 0.5), Math.round(purch * 0.5),
          purch, purch, purch, purch,
          Math.round(purch * 0.5), Math.round(purch * 0.5), Math.round(purch * 0.5), Math.round(purch * 0.5),
          0, // units_sold_other_sku_7_d
          +(salesV * 0.6).toFixed(2), salesV, salesV, salesV,
          +(salesV * 0.5).toFixed(2), +(salesV * 0.5).toFixed(2), +(salesV * 0.5).toFixed(2), +(salesV * 0.5).toFixed(2),
          0, // sales_other_sku_7_d
        ]);
      }
    }
  }

  for (let i = 0; i < spApRows.length; i += 400) {
    const batch = spApRows.slice(i, i + 400);
    const placeholders = batch.map(() =>
      `(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP())`
    ).join(',');
    await query(`
      INSERT INTO CALBRIDGE_PROD.APP.SP_ADVERTISED_PRODUCT_REPORT
        (client_id,profile_id,campaign_id,ad_group_id,ad_id,date,
         advertised_asin,advertised_sku,
         campaign_name,campaign_status,campaign_budget_amount,campaign_budget_type,
         campaign_budget_currency_code,campaign_bidding_strategy,portfolio_id,ad_group_name,
         impressions,clicks,cost,
         purchases_1_d,purchases_7_d,purchases_14_d,purchases_30_d,
         purchases_same_sku_1_d,purchases_same_sku_7_d,purchases_same_sku_14_d,purchases_same_sku_30_d,
         units_sold_clicks_1_d,units_sold_clicks_7_d,units_sold_clicks_14_d,units_sold_clicks_30_d,
         units_sold_same_sku_1_d,units_sold_same_sku_7_d,units_sold_same_sku_14_d,units_sold_same_sku_30_d,
         units_sold_other_sku_7_d,
         sales_1_d,sales_7_d,sales_14_d,sales_30_d,
         attributed_sales_same_sku_1_d,attributed_sales_same_sku_7_d,
         attributed_sales_same_sku_14_d,attributed_sales_same_sku_30_d,
         sales_other_sku_7_d,
         synced_at)
      VALUES ${placeholders}
    `, batch.flat());
    process.stdout.write(`\r  Inserted ${Math.min(i + 400, spApRows.length)}/${spApRows.length} SP advertised product rows`);
  }
  console.log(`\n  ✓ SP advertised products: ${spApRows.length} rows\n`);

  // ── 7. SP Targeting Keyword Report ────────────────────────────────────────
  console.log('📊 Inserting SP_TARGETING_KEYWORD_REPORT data...');
  await query(`DELETE FROM CALBRIDGE_PROD.APP.SP_TARGETING_KEYWORD_REPORT WHERE client_id = ?`, [CLIENT_ID]).catch(() => {});

  const spKwRows = [];
  for (const [di, d] of dates.entries()) {
    const mult = dayMultiplier(d, di);
    for (const [campaignId, keywords] of Object.entries(SP_KEYWORDS)) {
      const c = SP_CAMPAIGNS.find(x => x.id === campaignId);
      if (!c) continue;
      for (const kw of keywords) {
        const impr = Math.round(rand(500, 4000) * mult);
        const clks = Math.max(0, Math.round(impr * rand(0.004, 0.012)));
        const cost = +(clks * kw.bid * rand(0.85, 1.15)).toFixed(2);
        const purch = Math.max(0, Math.round(clks * rand(0.07, 0.18)));
        const salesV = +(purch * rand(25, 70)).toFixed(2);
        spKwRows.push([
          CLIENT_ID, PROFILE_ID, c.id, c.adGroupId, kw.kwId, dateStr(d),
          kw.keyword, 'KEYWORD', kw.matchType,
          `keyword:"${kw.keyword}":matchType:${kw.matchType}`,
          'ENABLED', kw.bid,
          c.name, 'ENABLED', c.budget, 'DAILY_BUDGET', 'USD', c.strategy === 'auto' ? 'legacyForSales' : 'manual',
          'demo-portfolio-001', rand(0.02, 0.20).toFixed(4),
          c.name + ' | Ad Group',
          impr, clks, cost,
          Math.round(purch * 0.6), purch, purch, purch,
          Math.round(purch * 0.5), Math.round(purch * 0.5), Math.round(purch * 0.5), Math.round(purch * 0.5),
          purch, purch, purch, purch,
          Math.round(purch * 0.5), Math.round(purch * 0.5), Math.round(purch * 0.5), Math.round(purch * 0.5),
          +(salesV * 0.6).toFixed(2), salesV, salesV, salesV,
          +(salesV * 0.5).toFixed(2), +(salesV * 0.5).toFixed(2), +(salesV * 0.5).toFixed(2), +(salesV * 0.5).toFixed(2),
          0, // sales_other_sku_7_d
          0, // units_sold_other_sku_7_d
        ]);
      }
    }
  }

  for (let i = 0; i < spKwRows.length; i += 300) {
    const batch = spKwRows.slice(i, i + 300);
    const placeholders = batch.map(() =>
      `(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP())`
    ).join(',');
    await query(`
      INSERT INTO CALBRIDGE_PROD.APP.SP_TARGETING_KEYWORD_REPORT
        (client_id,profile_id,campaign_id,ad_group_id,keyword_id,date,
         keyword,keyword_type,match_type,targeting,ad_keyword_status,keyword_bid,
         campaign_name,campaign_status,campaign_budget_amount,campaign_budget_type,
         campaign_budget_currency_code,campaign_bidding_strategy,portfolio_id,
         top_of_search_impression_share,ad_group_name,
         impressions,clicks,cost,
         purchases_1_d,purchases_7_d,purchases_14_d,purchases_30_d,
         purchases_same_sku_1_d,purchases_same_sku_7_d,purchases_same_sku_14_d,purchases_same_sku_30_d,
         units_sold_clicks_1_d,units_sold_clicks_7_d,units_sold_clicks_14_d,units_sold_clicks_30_d,
         units_sold_same_sku_1_d,units_sold_same_sku_7_d,units_sold_same_sku_14_d,units_sold_same_sku_30_d,
         sales_1_d,sales_7_d,sales_14_d,sales_30_d,
         attributed_sales_same_sku_1_d,attributed_sales_same_sku_7_d,
         attributed_sales_same_sku_14_d,attributed_sales_same_sku_30_d,
         sales_other_sku_7_d,units_sold_other_sku_7_d,
         synced_at)
      VALUES ${placeholders}
    `, batch.flat());
    process.stdout.write(`\r  Inserted ${Math.min(i + 300, spKwRows.length)}/${spKwRows.length} SP keyword rows`);
  }
  console.log(`\n  ✓ SP keywords: ${spKwRows.length} rows\n`);

  // ── 8. SP Search Term Report ───────────────────────────────────────────────
  console.log('📊 Inserting SP_SEARCH_TERM_REPORT data...');
  await query(`DELETE FROM CALBRIDGE_PROD.APP.SP_SEARCH_TERM_REPORT WHERE client_id = ?`, [CLIENT_ID]).catch(() => {});

  const stRows = [];
  for (const [di, d] of dates.entries()) {
    const mult = dayMultiplier(d, di);
    for (const [campaignId, terms] of Object.entries(SEARCH_TERMS_BY_CAMPAIGN)) {
      const c = SP_CAMPAIGNS.find(x => x.id === campaignId);
      if (!c) continue;
      const kwsForCampaign = SP_KEYWORDS[campaignId] || [{ kwId: `kw-auto-${campaignId}`, keyword: terms[0], matchType: 'auto', bid: 0.75 }];
      for (const term of terms) {
        const kw = kwsForCampaign[0];
        const impr = Math.round(rand(200, 3000) * mult);
        const clks = Math.max(0, Math.round(impr * rand(0.003, 0.010)));
        const cost = +(clks * rand(0.55, 1.85)).toFixed(2);
        const purch = Math.max(0, Math.round(clks * rand(0.05, 0.16)));
        const salesV = +(purch * rand(22, 68)).toFixed(2);
        // SP_SEARCH_TERM_REPORT has 44 data columns (no units_sold_same_sku_* cols)
        stRows.push([
          CLIENT_ID, PROFILE_ID, c.id, c.adGroupId, kw.kwId, term, dateStr(d),
          kw.keyword, 'KEYWORD', kw.matchType,
          `keyword:"${kw.keyword}":matchType:${kw.matchType}`,
          'ENABLED', kw.bid,
          c.name, 'ENABLED', c.budget, 'DAILY_BUDGET', 'USD',
          'demo-portfolio-001', c.name + ' | Ad Group',
          impr, clks, cost,
          Math.round(purch * 0.6), purch, purch, purch,
          Math.round(purch * 0.5), Math.round(purch * 0.5), Math.round(purch * 0.5), Math.round(purch * 0.5),
          purch, purch, purch, purch,
          +(salesV * 0.6).toFixed(2), salesV, salesV, salesV,
          +(salesV * 0.5).toFixed(2), +(salesV * 0.5).toFixed(2), +(salesV * 0.5).toFixed(2), +(salesV * 0.5).toFixed(2),
          0, // sales_other_sku_7_d
        ]);
      }
    }
  }

  for (let i = 0; i < stRows.length; i += 300) {
    const batch = stRows.slice(i, i + 300);
    const placeholders = batch.map(() =>
      `(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP())`
    ).join(',');
    await query(`
      INSERT INTO CALBRIDGE_PROD.APP.SP_SEARCH_TERM_REPORT
        (client_id,profile_id,campaign_id,ad_group_id,keyword_id,search_term,date,
         keyword,keyword_type,match_type,targeting,ad_keyword_status,keyword_bid,
         campaign_name,campaign_status,campaign_budget_amount,campaign_budget_type,
         campaign_budget_currency_code,portfolio_id,ad_group_name,
         impressions,clicks,cost,
         purchases_1_d,purchases_7_d,purchases_14_d,purchases_30_d,
         purchases_same_sku_1_d,purchases_same_sku_7_d,purchases_same_sku_14_d,purchases_same_sku_30_d,
         units_sold_clicks_1_d,units_sold_clicks_7_d,units_sold_clicks_14_d,units_sold_clicks_30_d,
         sales_1_d,sales_7_d,sales_14_d,sales_30_d,
         attributed_sales_same_sku_1_d,attributed_sales_same_sku_7_d,
         attributed_sales_same_sku_14_d,attributed_sales_same_sku_30_d,
         sales_other_sku_7_d,
         synced_at)
      VALUES ${placeholders}
    `, batch.flat());
    process.stdout.write(`\r  Inserted ${Math.min(i + 300, stRows.length)}/${stRows.length} search term rows`);
  }
  console.log(`\n  ✓ Search terms: ${stRows.length} rows\n`);

  // ── 9. SP Campaign Placement Report ───────────────────────────────────────
  console.log('📊 Inserting SP_CAMPAIGN_PLACEMENT_REPORT data...');
  await query(`DELETE FROM CALBRIDGE_PROD.APP.SP_CAMPAIGN_PLACEMENT_REPORT WHERE client_id = ?`, [CLIENT_ID]).catch(() => {});

  const placementTypes = ['Top of Search (Impressions)', 'Rest of Search', 'Product Pages'];
  const spPlacRows = [];
  for (const [di, d] of dates.entries()) {
    const mult = dayMultiplier(d, di);
    for (const c of SP_CAMPAIGNS) {
      for (const placement of placementTypes) {
        const placMult = placement === 'Top of Search (Impressions)' ? rand(0.35, 0.55)
                        : placement === 'Rest of Search' ? rand(0.25, 0.40) : rand(0.10, 0.25);
        const impr = Math.round(rand(800, 6000) * mult * placMult);
        const clks = Math.max(0, Math.round(impr * rand(0.003, 0.009)));
        const cost = +(clks * rand(0.70, 2.00)).toFixed(2);
        const topShare = rand(0.04, 0.22);
        const purch = Math.max(0, Math.round(clks * rand(0.06, 0.16)));
        const salesV = +(purch * rand(25, 65)).toFixed(2);
        spPlacRows.push([
          // PK cols: client_id, profile_id, campaign_id, placement, date
          CLIENT_ID, PROFILE_ID, c.id, placement, dateStr(d),
          c.name, 'ENABLED', c.budget, 'DAILY_BUDGET', 'USD',
          topShare, null, // placement_classification
          impr, clks, cost,
          Math.round(purch * 0.6), purch, purch, purch,
          purch, purch, purch, purch,
          +(salesV * 0.6).toFixed(2), salesV, salesV, salesV,
        ]);
      }
    }
  }

  for (let i = 0; i < spPlacRows.length; i += 300) {
    const batch = spPlacRows.slice(i, i + 300);
    const placeholders = batch.map(() =>
      `(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP())`
    ).join(',');
    await query(`
      INSERT INTO CALBRIDGE_PROD.APP.SP_CAMPAIGN_PLACEMENT_REPORT
        (client_id,profile_id,campaign_id,placement,date,
         campaign_name,campaign_status,campaign_budget_amount,campaign_budget_type,
         campaign_budget_currency_code,
         top_of_search_impression_share,placement_classification,
         impressions,clicks,cost,
         purchases_1_d,purchases_7_d,purchases_14_d,purchases_30_d,
         units_sold_clicks_1_d,units_sold_clicks_7_d,units_sold_clicks_14_d,units_sold_clicks_30_d,
         sales_1_d,sales_7_d,sales_14_d,sales_30_d,
         synced_at)
      VALUES ${placeholders}
    `, batch.flat());
    process.stdout.write(`\r  Inserted ${Math.min(i + 300, spPlacRows.length)}/${spPlacRows.length} SP placement rows`);
  }
  console.log(`\n  ✓ SP placement: ${spPlacRows.length} rows\n`);

  // ── 10. SB Campaign Report ─────────────────────────────────────────────────
  console.log('📊 Inserting SB_CAMPAIGN_REPORT data...');
  await query(`DELETE FROM CALBRIDGE_PROD.APP.SB_CAMPAIGN_REPORT WHERE client_id = ?`, [CLIENT_ID]).catch(() => {});

  let sbTotalSpend = 0, sbTotalSales = 0;
  const sbRows = [];
  const safeNum = (v, def = 0) => (isFinite(v) && v !== null && v !== undefined) ? v : def;
  for (const [di, d] of dates.entries()) {
    const mult = dayMultiplier(d, di);
    for (const c of SB_CAMPAIGNS) {
      const m = sbMetrics(c, mult);
      sbTotalSpend += m.cost;
      sbTotalSales += m.sales;
      sbRows.push([
        CLIENT_ID, PROFILE_ID, c.id, dateStr(d),
        c.name, 'ENABLED', c.budget, 'DAILY_BUDGET', 'USD',
        'cpc',
        m.impressions, m.clicks, m.cost,
        m.purchases, m.purchases, Math.round(m.purchases * 0.7),
        m.sales, m.sales, +(m.sales * 0.7).toFixed(2),
        Math.round(m.purchases * 1.1), Math.round(m.purchases * 1.1),
        m.ntb, m.ntb, rand(0.28, 0.44),
        rand(0.006, 0.015),
        m.ntbSales, m.ntbSales, rand(0.25, 0.42),
        Math.round(m.ntb * 1.1), Math.round(m.ntb * 1.1), rand(0.26, 0.43),
        m.dpv, m.dpv,         // detail_page_views, detail_page_views_clicks
        m.atc, m.atc,           // add_to_cart, add_to_cart_clicks
        safeNum(+(m.atc / Math.max(m.clicks, 1)).toFixed(4)), // add_to_cart_rate
        Math.round(m.clicks * rand(0.02, 0.08)),  // branded_searches
        Math.round(m.clicks * rand(0.02, 0.08)),  // branded_searches_clicks
        Math.round(m.impressions * rand(0.001, 0.004)), // brand_store_page_view
        safeNum(+rand(0.04, 0.18).toFixed(4)),    // top_of_search_impression_share
        safeNum(+rand(0.20, 0.55).toFixed(4)),    // video_5_second_view_rate
        Math.round(m.clicks * rand(0.25, 0.60)),  // video_5_second_views
        Math.round(m.clicks * rand(0.40, 0.70)),  // video_complete_views
        Math.round(m.clicks * rand(0.50, 0.75)),  // video_first_quartile_views
        Math.round(m.clicks * rand(0.55, 0.80)),  // video_midpoint_views
        Math.round(m.clicks * rand(0.60, 0.85)),  // video_third_quartile_views
        Math.round(m.clicks * rand(0.10, 0.25)),  // video_unmutes
        safeNum(+rand(0.55, 0.78).toFixed(4)),    // viewability_rate
        Math.round(m.impressions * rand(0.50, 0.85)), // viewable_impressions
        safeNum(+rand(0.004, 0.018).toFixed(5)),  // view_click_through_rate
        Math.round(m.dpv * rand(0.20, 0.40)),     // new_to_brand_detail_page_views
        Math.round(m.dpv * rand(0.15, 0.35)),     // new_to_brand_detail_page_views_clicks
        safeNum(+rand(0.020, 0.060).toFixed(4)),  // new_to_brand_detail_page_view_rate
        0.0,                                       // new_to_brand_e_c_p_detail_page_view
        0, 0.0,                                    // kindle cols
      ]);
    }
  }

  for (let i = 0; i < sbRows.length; i += 200) {
    const batch = sbRows.slice(i, i + 200);
    const placeholders = batch.map(() =>
      `(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP())`
    ).join(',');
    await query(`
      INSERT INTO CALBRIDGE_PROD.APP.SB_CAMPAIGN_REPORT
        (client_id,profile_id,campaign_id,report_date,
         campaign_name,campaign_status,campaign_budget_amount,campaign_budget_type,campaign_budget_currency_code,
         cost_type,
         impressions,clicks,cost,
         purchases,purchases_clicks,purchases_promoted,
         sales,sales_clicks,sales_promoted,
         units_sold,units_sold_clicks,
         new_to_brand_purchases,new_to_brand_purchases_clicks,new_to_brand_purchases_percentage,new_to_brand_purchases_rate,
         new_to_brand_sales,new_to_brand_sales_clicks,new_to_brand_sales_percentage,
         new_to_brand_units_sold,new_to_brand_units_sold_clicks,new_to_brand_units_sold_percentage,
         detail_page_views,detail_page_views_clicks,
         add_to_cart,add_to_cart_clicks,add_to_cart_rate,
         branded_searches,branded_searches_clicks,
         brand_store_page_view,
         top_of_search_impression_share,
         video_5_second_view_rate,
         video_5_second_views,video_complete_views,video_first_quartile_views,
         video_midpoint_views,video_third_quartile_views,video_unmutes,
         viewability_rate,viewable_impressions,view_click_through_rate,
         new_to_brand_detail_page_views,new_to_brand_detail_page_views_clicks,
         new_to_brand_detail_page_view_rate,new_to_brand_e_c_p_detail_page_view,
         kindle_edition_normalized_pages_read_14_d,kindle_edition_normalized_pages_royalties_14_d,
         synced_at)
      VALUES ${placeholders}
    `, batch.flat());
    process.stdout.write(`\r  Inserted ${Math.min(i + 200, sbRows.length)}/${sbRows.length} SB campaign rows`);
  }
  console.log(`\n  ✓ SB campaigns: ${sbRows.length} rows | Spend: $${sbTotalSpend.toFixed(0)} | Sales: $${sbTotalSales.toFixed(0)}\n`);

  // ── 11. SB Keyword Report ──────────────────────────────────────────────────
  console.log('📊 Inserting SB_KEYWORD_REPORT data...');
  await query(`DELETE FROM CALBRIDGE_PROD.APP.SB_KEYWORD_REPORT WHERE client_id = ?`, [CLIENT_ID]).catch(() => {});

  const sbKwTerms = {
    'demo-sb-c001': ['dog bed large', 'orthopedic dog bed', 'premium dog bed', 'memory foam dog bed'],
    'demo-sb-c002': ['cat toy interactive', 'feather cat toy', 'best cat toys', 'cat wand toy'],
    'demo-sb-c003': ['pet grooming kit', 'dog grooming tools', 'cat grooming brush'],
  };

  // SB_KEYWORD_REPORT: keyword_id is PK col 3, then report_date, campaign_id, etc.
  const sbKwRows = [];
  for (const [di, d] of dates.entries()) {
    const mult = dayMultiplier(d, di);
    for (const c of SB_CAMPAIGNS) {
      const terms = sbKwTerms[c.id] || [];
      for (const [ki, kw] of terms.entries()) {
        const kwId = `demo-sb-kw-${c.id.slice(-4)}-${ki}`;
        const agId = `demo-sb-ag-${c.id.slice(-4)}`;
        const impr = Math.round(rand(1000, 8000) * mult);
        const clks = Math.max(0, Math.round(impr * rand(0.003, 0.008)));
        const cost = +(clks * rand(0.75, 1.80)).toFixed(2);
        const purch = Math.max(0, Math.round(clks * rand(0.05, 0.14)));
        const salesV = +(purch * rand(30, 75)).toFixed(2);
        const ntb = Math.round(purch * rand(0.25, 0.45));
        const ntbSales = +(salesV * ntb / Math.max(purch, 1)).toFixed(2);
        const dpv = Math.round(clks * rand(1.2, 1.8));
        const atc = Math.round(clks * rand(0.10, 0.20));
        const branded = Math.round(clks * rand(0.02, 0.06));
        const topShare = rand(0.04, 0.20);
        sbKwRows.push([
          CLIENT_ID, PROFILE_ID, kwId, dateStr(d),
          c.id, c.name, 'ENABLED', c.budget, 'DAILY_BUDGET', 'USD',
          agId, c.name + ' | Ad Group',
          kw, 'KEYWORD', 'broad',
          rand(0.80, 1.80).toFixed(2), 'ENABLED',
          null, null, null, null, // targeting cols
          topShare,
          impr, clks, cost, 'cpc',
          purch, Math.round(purch * 0.8), Math.round(purch * 0.7),
          salesV, +(salesV * 0.8).toFixed(2), +(salesV * 0.7).toFixed(2),
          Math.round(purch * 1.1),
          ntb, ntb,
          rand(0.25, 0.45), rand(0.005, 0.015),
          ntbSales, ntbSales,
          rand(0.23, 0.42),
          Math.round(ntb * 1.1), Math.round(ntb * 1.1),
          rand(0.22, 0.40),
          Math.round(ntb * rand(0.8, 1.2)),
          Math.round(ntb * rand(0.7, 1.0)),
          rand(0.020, 0.060),
          0.0,
          dpv, Math.round(dpv * 0.8),
          atc, atc,
          branded, branded,
        ]);
      }
    }
  }

  for (let i = 0; i < sbKwRows.length; i += 200) {
    const batch = sbKwRows.slice(i, i + 200);
    const placeholders = batch.map(() =>
      `(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP())`
    ).join(',');
    await query(`
      INSERT INTO CALBRIDGE_PROD.APP.SB_KEYWORD_REPORT
        (client_id,profile_id,keyword_id,report_date,
         campaign_id,campaign_name,campaign_status,
         campaign_budget_amount,campaign_budget_type,campaign_budget_currency_code,
         ad_group_id,ad_group_name,
         keyword_text,keyword_type,match_type,
         keyword_bid,ad_keyword_status,
         targeting_expression,targeting_id,targeting_text,targeting_type,
         top_of_search_impression_share,
         impressions,clicks,cost,cost_type,
         purchases,purchases_clicks,purchases_promoted,
         sales,sales_clicks,sales_promoted,
         units_sold,
         new_to_brand_purchases,new_to_brand_purchases_clicks,
         new_to_brand_purchases_percentage,new_to_brand_purchases_rate,
         new_to_brand_sales,new_to_brand_sales_clicks,
         new_to_brand_sales_percentage,
         new_to_brand_units_sold,new_to_brand_units_sold_clicks,
         new_to_brand_units_sold_percentage,
         new_to_brand_detail_page_views,new_to_brand_detail_page_views_clicks,
         new_to_brand_detail_page_view_rate,
         new_to_brand_e_c_p_detail_page_view,
         detail_page_views,detail_page_views_clicks,
         add_to_cart,add_to_cart_clicks,
         branded_searches,branded_searches_clicks,
         synced_at)
      VALUES ${placeholders}
    `, batch.flat());
    process.stdout.write(`\r  Inserted ${Math.min(i + 200, sbKwRows.length)}/${sbKwRows.length} SB keyword rows`);
  }
  console.log(`\n  ✓ SB keywords: ${sbKwRows.length} rows\n`);

  // ── 12. SD Campaign Report ─────────────────────────────────────────────────
  console.log('📊 Inserting SD_CAMPAIGN_REPORT data...');
  await query(`DELETE FROM CALBRIDGE_PROD.APP.SD_CAMPAIGN_REPORT WHERE client_id = ?`, [CLIENT_ID]).catch(() => {});

  let sdTotalSpend = 0, sdTotalSales = 0;
  const sdRows = [];
  for (const [di, d] of dates.entries()) {
    const mult = dayMultiplier(d, di);
    for (const c of SD_CAMPAIGNS) {
      const m = sdMetrics(c, mult);
      sdTotalSpend += m.cost;
      sdTotalSales += m.sales;
      sdRows.push([
        CLIENT_ID, PROFILE_ID, c.id, dateStr(d),
        c.name, 'ENABLED', c.budget, 'USD', 'cpc',
        m.impressions, Math.round(m.impressions * rand(0.6, 0.9)),
        m.clicks, m.cost,
        m.purchases, m.purchases, Math.round(m.purchases * 0.7),
        m.sales, m.sales, +(m.sales * 0.7).toFixed(2),
        Math.round(m.purchases * 1.1), Math.round(m.purchases * 1.1),
        m.dpv, m.dpv,
        m.atc, m.atc, Math.round(m.atc * rand(0.2, 0.4)),
        +(m.atc / Math.max(m.clicks, 1)).toFixed(4),
        Math.round(m.clicks * rand(0.01, 0.04)), Math.round(m.clicks * rand(0.01, 0.04)), 0,
        rand(0.003, 0.010),
        Math.round(m.purchases * rand(0.25, 0.45)),
        Math.round(m.purchases * rand(0.25, 0.45)),
        +(m.sales * rand(0.25, 0.45)).toFixed(2),
        +(m.sales * rand(0.25, 0.45)).toFixed(2),
        Math.round(m.purchases * rand(0.25, 0.45)),
        Math.round(m.purchases * rand(0.25, 0.45)),
        Math.round(m.dpv * rand(0.25, 0.40)),
        Math.round(m.dpv * rand(0.20, 0.35)),
        rand(0.003, 0.010), rand(0.20, 0.50),
        Math.round(m.impressions * rand(0.003, 0.008)),
        rand(0.010, 0.025),
        Math.round(m.impressions * rand(0.010, 0.025)),
        Math.round(m.clicks * rand(0.35, 0.60)),
        Math.round(m.clicks * rand(0.50, 0.72)),
        Math.round(m.clicks * rand(0.60, 0.80)),
        Math.round(m.clicks * rand(0.05, 0.15)),
        rand(0.50, 0.80),
        rand(0.005, 0.018),
        rand(0.60, 0.85),
        rand(0.004, 0.012),
        0.0, 0.0,
      ]);
    }
  }

  for (let i = 0; i < sdRows.length; i += 200) {
    const batch = sdRows.slice(i, i + 200);
    const placeholders = batch.map(() =>
      `(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP())`
    ).join(',');
    await query(`
      INSERT INTO CALBRIDGE_PROD.APP.SD_CAMPAIGN_REPORT
        (client_id,profile_id,campaign_id,date,
         campaign_name,campaign_status,campaign_budget_amount,campaign_budget_currency_code,cost_type,
         impressions,impressions_views,clicks,cost,
         purchases,purchases_clicks,purchases_promoted_clicks,
         sales,sales_clicks,sales_promoted_clicks,
         units_sold,units_sold_clicks,
         detail_page_views,detail_page_views_clicks,
         add_to_cart,add_to_cart_clicks,add_to_cart_views,add_to_cart_rate,
         branded_searches,branded_searches_clicks,branded_searches_views,branded_search_rate,
         new_to_brand_purchases,new_to_brand_purchases_clicks,
         new_to_brand_sales,new_to_brand_sales_clicks,
         new_to_brand_units_sold,new_to_brand_units_sold_clicks,
         new_to_brand_detail_page_views,new_to_brand_detail_page_view_clicks,
         new_to_brand_detail_page_view_rate,new_to_brand_detail_page_view_views,
         cumulative_reach,impressions_frequency_average,
         video_complete_views,video_first_quartile_views,video_midpoint_views,
         video_third_quartile_views,video_unmutes,
         viewability_rate,view_click_through_rate,
         e_c_p_brand_search,new_to_brand_e_c_p_detail_page_view,
         long_term_sales,long_term_r_o_a_s,
         synced_at)
      VALUES ${placeholders}
    `, batch.flat());
    process.stdout.write(`\r  Inserted ${Math.min(i + 200, sdRows.length)}/${sdRows.length} SD campaign rows`);
  }
  console.log(`\n  ✓ SD campaigns: ${sdRows.length} rows | Spend: $${sdTotalSpend.toFixed(0)} | Sales: $${sdTotalSales.toFixed(0)}\n`);

  // ── 13. Vendor Sales (Retail Data) ─────────────────────────────────────────
  console.log('📊 Inserting VENDOR_SALES data...');
  await query(`DELETE FROM CALBRIDGE_PROD.APP.VENDOR_SALES WHERE client_id = ?`, [CLIENT_ID]).catch(() => {});

  let totalRevenue = 0, totalUnits = 0;
  const vsRows = [];
  for (const [di, d] of dates.entries()) {
    const mult = dayMultiplier(d, di);
    for (const prod of PRODUCTS) {
      const baseUnits = Math.round(rand(8, 40) * prod.unitShare * 10 * mult);
      const units = Math.max(1, baseUnits);
      const revenue = +(units * prod.price * rand(0.95, 1.05)).toFixed(2);
      const shippedUnits = Math.max(0, units - randInt(0, 2));
      const shippedRev = +(shippedUnits * prod.price * rand(0.95, 1.05)).toFixed(2);
      const cogs = +(shippedRev * rand(0.30, 0.42)).toFixed(2);
      const returns = Math.random() < 0.04 ? 1 : 0;
      totalRevenue += revenue;
      totalUnits += units;
      vsRows.push([
        CLIENT_ID, prod.asin, dateStr(d), dateStr(d),
        units, revenue, 'USD',
        shippedUnits, shippedRev, cogs, 'USD',
        returns,
      ]);
    }
  }

  for (let i = 0; i < vsRows.length; i += 500) {
    const batch = vsRows.slice(i, i + 500);
    const placeholders = batch.map(() =>
      `(?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP())`
    ).join(',');
    await query(`
      INSERT INTO CALBRIDGE_PROD.APP.VENDOR_SALES
        (client_id,asin,start_date,end_date,
         ordered_units,ordered_revenue,ordered_currency,
         shipped_units,shipped_revenue,shipped_cogs,shipped_currency,
         customer_returns,synced_at)
      VALUES ${placeholders}
    `, batch.flat());
    process.stdout.write(`\r  Inserted ${Math.min(i + 500, vsRows.length)}/${vsRows.length} vendor sales rows`);
  }
  console.log(`\n  ✓ Vendor sales: ${vsRows.length} rows | Revenue: $${totalRevenue.toFixed(0)} | Units: ${totalUnits}\n`);

  // ── 14. SP Purchased Product Report ───────────────────────────────────────
  console.log('📊 Inserting SP_PURCHASED_PRODUCT_REPORT data...');
  await query(`DELETE FROM CALBRIDGE_PROD.APP.SP_PURCHASED_PRODUCT_REPORT WHERE client_id = ?`, [CLIENT_ID]).catch(() => {});

  // Build insert rows for purchased product report
  // SP_PURCHASED_PRODUCT_REPORT schema:
  // PK: client_id, profile_id, campaign_id, ad_group_id, keyword_id, advertised_asin, purchased_asin, date
  const ppRows = [];
  for (const [di, d] of dates.entries()) {
    const mult = dayMultiplier(d, di);
    for (const c of SP_CAMPAIGNS.slice(0, 5)) { // top 5 campaigns
      const kwsForC = SP_KEYWORDS[c.id] || [{ kwId: `kw-auto-${c.id.slice(-4)}`, keyword: 'auto', matchType: 'auto' }];
      for (const prod of PRODUCTS.slice(0, 5)) {
        const purch7d = Math.max(0, Math.round(rand(0, 8) * mult));
        if (purch7d === 0) continue;
        const purch1d = Math.round(purch7d * 0.6);
        const sales1d = +(purch1d * prod.price).toFixed(2);
        const sales7d = +(purch7d * prod.price).toFixed(2);
        const kw = kwsForC[0];
        ppRows.push([
          CLIENT_ID, PROFILE_ID, c.id, c.adGroupId, kw.kwId,
          prod.asin, prod.asin, dateStr(d), // purchased = advertised for simplicity
          prod.sku, 'KEYWORD', kw.keyword, kw.matchType || 'exact',
          'USD',
          purch1d, purch7d, purch7d, purch7d,
          0, 0, 0, 0, // other sku purchases
          purch1d, purch7d, purch7d, purch7d,
          0, 0, 0, 0, // other sku units
          sales1d, sales7d, sales7d, sales7d,
          0, 0, 0, 0, // other sku sales
        ]);
      }
    }
  }

  for (let i = 0; i < ppRows.length; i += 400) {
    const batch = ppRows.slice(i, i + 400);
    const placeholders = batch.map(() =>
      `(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP())`
    ).join(',');
    await query(`
      INSERT INTO CALBRIDGE_PROD.APP.SP_PURCHASED_PRODUCT_REPORT
        (client_id,profile_id,campaign_id,ad_group_id,keyword_id,
         advertised_asin,purchased_asin,date,
         advertised_sku,keyword_type,keyword,match_type,
         campaign_budget_currency_code,
         purchases_1_d,purchases_7_d,purchases_14_d,purchases_30_d,
         purchases_other_sku_1_d,purchases_other_sku_7_d,purchases_other_sku_14_d,purchases_other_sku_30_d,
         units_sold_clicks_1_d,units_sold_clicks_7_d,units_sold_clicks_14_d,units_sold_clicks_30_d,
         units_sold_other_sku_1_d,units_sold_other_sku_7_d,units_sold_other_sku_14_d,units_sold_other_sku_30_d,
         sales_1_d,sales_7_d,sales_14_d,sales_30_d,
         sales_other_sku_1_d,sales_other_sku_7_d,sales_other_sku_14_d,sales_other_sku_30_d,
         synced_at)
      VALUES ${placeholders}
    `, batch.flat()).catch(err => {
      console.warn('\n  ⚠ SP purchased product insert warning (non-fatal):', err.message.slice(0, 120));
    });
    process.stdout.write(`\r  Inserted ${Math.min(i + 400, ppRows.length)}/${ppRows.length} purchased product rows`);
  }
  console.log(`\n  ✓ SP purchased products: ${ppRows.length} rows\n`);

  // ── 15. Summary ────────────────────────────────────────────────────────────
  const totalSpend = spTotalSpend + sbTotalSpend + sdTotalSpend;
  const totalAdSales = spTotalSales + sbTotalSales + sdTotalSales;
  const blendedAcos = (totalSpend / totalAdSales * 100).toFixed(1);

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('✅ DEMO ACCOUNT SEEDING COMPLETE');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`\n🔐 Credentials:`);
  console.log(`   Email:    ${EMAIL}`);
  console.log(`   Password: ${PASSWORD}`);
  console.log(`   Login:    https://app.calbridge.ai`);
  console.log(`\n📦 Brand: ${BRAND_NAME}`);
  console.log(`   Client ID:     ${CLIENT_ID}`);
  console.log(`   Advertiser ID: ${ADVERTISER_ID}`);
  console.log(`\n📅 Data range: ${dateStr(dates[0])} → ${dateStr(dates[dates.length - 1])} (${DAYS_BACK} days)`);
  console.log(`\n📊 Advertising Summary:`);
  console.log(`   SP: ${SP_CAMPAIGNS.length} campaigns | Spend: $${spTotalSpend.toFixed(0)} | Sales: $${spTotalSales.toFixed(0)} | ACoS: ${(spTotalSpend / spTotalSales * 100).toFixed(1)}%`);
  console.log(`   SB: ${SB_CAMPAIGNS.length} campaigns | Spend: $${sbTotalSpend.toFixed(0)} | Sales: $${sbTotalSales.toFixed(0)} | ACoS: ${(sbTotalSpend / sbTotalSales * 100).toFixed(1)}%`);
  console.log(`   SD: ${SD_CAMPAIGNS.length} campaigns | Spend: $${sdTotalSpend.toFixed(0)} | Sales: $${sdTotalSales.toFixed(0)} | ACoS: ${(sdTotalSpend / sdTotalSales * 100).toFixed(1)}%`);
  console.log(`   Total Spend: $${totalSpend.toFixed(0)} | Total Ad Sales: $${totalAdSales.toFixed(0)} | Blended ACoS: ${blendedAcos}%`);
  console.log(`\n🛍 Retail Summary:`);
  console.log(`   Revenue: $${totalRevenue.toFixed(0)} | Units: ${totalUnits} | Products: ${PRODUCTS.length} ASINs`);
  console.log('\n');

  process.exit(0);
}

run().catch(err => {
  console.error('\n❌ Seed failed:', err.message);
  console.error(err.stack);
  process.exit(1);
});
