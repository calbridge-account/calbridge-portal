/**
 * Seed Snowflake SANDBOX with realistic test data
 * Usage: node src/models/seedData.js
 *
 * CM model (correct):
 *   CM1 = ordered_revenue - FBA fees - referral fees        (seller)
 *        = shipped_cogs                                     (vendor)
 *   CM2 = CM1 - (units × cogs_per_unit)
 *   CM3 = CM2 - ad_spend
 *
 * Seed data tells a realistic story:
 *   - Most ASINs: positive CM3 (profitable to advertise)
 *   - Two ASINs: marginal CM3 (~$0-2/unit)
 *   - One ASIN:  negative CM3 (paying to lose money — needs review)
 *
 * Brand architecture:
 *   test-client-001 is on 'pro' plan with 3 demo brands:
 *     - TechGear US  (primary, linked to existing seed data)
 *     - TechGear UK
 *     - HomeStyle US
 */
require('dotenv').config();
const { query } = require('../services/snowflakeService');

const CLIENT_ID = 'test-client-001';

// Demo brand IDs — fixed so re-runs are idempotent
const BRAND_IDS = {
  techgearUS:  'seed-brand-techgear-us-001',
  techgearUK:  'seed-brand-techgear-uk-001',
  homestyleUS: 'seed-brand-homestyle-us-001',
};

// ASIN catalog with correct fee structure
// referral_fees = ~15% of price (standard Amazon referral rate for most categories)
// fba = FBA fulfillment fee per unit (~$3.50-8 depending on size/weight)
// cogs = brand's internal production + landed cost per unit
//
// CM story per ASIN:
//   B001TEST01: Strong CM3 — low ACOS, healthy margins
//   B001TEST02: Good CM3 — mid-range product, efficient ads
//   B001TEST03: Good CM3 — bundle, decent margin
//   B001TEST04: Marginal CM3 — heavy/expensive to ship, high ACOS
//   B001TEST05: NEGATIVE CM3 — ads eating all profit, needs review
//   B001TEST06: Marginal CM3 — thin margins, borderline profitable
//   B001TEST07: Strong CM3 — premium product, low competition
//   B001TEST08: Good CM3 — glass containers, healthy
const ASINS = [
  // asin, title, sku, price, fba, cogs, referral_fees (per unit)
  { asin: 'B001TEST01', title: 'Premium Bamboo Cutting Board',       sku: 'BCB-001', price: 34.99, fba: 5.50, cogs: 8.00,  referral_fees: 5.25,  adIntensity: 0.08,  story: 'strong'   },
  { asin: 'B001TEST02', title: 'Stainless Steel Water Bottle 32oz',  sku: 'WB-32',  price: 24.99, fba: 4.20, cogs: 5.50,  referral_fees: 3.75,  adIntensity: 0.10,  story: 'good'     },
  { asin: 'B001TEST03', title: 'Silicone Kitchen Utensil Set',        sku: 'KUS-6',  price: 29.99, fba: 4.80, cogs: 7.00,  referral_fees: 4.50,  adIntensity: 0.12,  story: 'good'     },
  { asin: 'B001TEST04', title: 'Cast Iron Skillet 12-inch',           sku: 'CIS-12', price: 49.99, fba: 8.00, cogs: 18.00, referral_fees: 7.50,  adIntensity: 0.22,  story: 'marginal' },
  { asin: 'B001TEST05', title: 'Magnetic Knife Strip',                sku: 'MKS-18', price: 19.99, fba: 3.50, cogs: 7.00,  referral_fees: 3.00,  adIntensity: 0.35,  story: 'negative' },
  { asin: 'B001TEST06', title: 'Organic Cotton Kitchen Towels 6pk',   sku: 'KT-6PK', price: 22.99, fba: 3.80, cogs: 9.00,  referral_fees: 3.45,  adIntensity: 0.18,  story: 'marginal' },
  { asin: 'B001TEST07', title: 'Bamboo Dish Drying Rack',             sku: 'DDR-B',  price: 39.99, fba: 6.50, cogs: 10.00, referral_fees: 6.00,  adIntensity: 0.09,  story: 'strong'   },
  { asin: 'B001TEST08', title: 'Glass Food Storage Containers 10pk',  sku: 'FSC-10', price: 44.99, fba: 7.00, cogs: 12.00, referral_fees: 6.75,  adIntensity: 0.11,  story: 'good'     },
];

// Show expected margins at seed time
function calcExpectedMargins(p) {
  const cm1PerUnit = p.price - p.fba - p.referral_fees;
  const cm2PerUnit = cm1PerUnit - p.cogs;
  // ad_spend per unit approximated from adIntensity × price / units (rough estimate for display only)
  const adPerUnit  = p.price * p.adIntensity;
  const cm3PerUnit = cm2PerUnit - adPerUnit;
  return { cm1PerUnit, cm2PerUnit, cm3PerUnit };
}

// Campaigns — each mapped to specific ASINs so ad spend is realistic per ASIN
const CAMPAIGNS = [
  { id: 'camp-001', name: 'Cutting Board - SP Auto',        type: 'sponsoredProducts', budgetDay: 45,  asins: ['B001TEST01'], channel: 'ads' },
  { id: 'camp-002', name: 'Water Bottle - SP Manual',       type: 'sponsoredProducts', budgetDay: 60,  asins: ['B001TEST02'], channel: 'ads' },
  { id: 'camp-003', name: 'Kitchen Set - SB Brand',         type: 'sponsoredBrands',   budgetDay: 80,  asins: ['B001TEST03','B001TEST06'], channel: 'ads' },
  { id: 'camp-004', name: 'Cast Iron - SD Retargeting',     type: 'sponsoredDisplay',  budgetDay: 35,  asins: ['B001TEST04'], channel: 'ads' },
  { id: 'camp-005', name: 'Knife Strip - SP Auto',          type: 'sponsoredProducts', budgetDay: 25,  asins: ['B001TEST05'], channel: 'ads' },
  { id: 'dsp-001',  name: 'Retargeting - Kitchen Category', type: 'dsp',               budgetDay: 150, asins: ['B001TEST01','B001TEST04','B001TEST07'], channel: 'dsp' },
  { id: 'dsp-002',  name: 'Prospecting - Homeware Audience',type: 'dsp',               budgetDay: 200, asins: ['B001TEST02','B001TEST03','B001TEST08'], channel: 'dsp' },
  { id: 'dsp-003',  name: 'Competitor Conquesting',         type: 'dsp',               budgetDay: 120, asins: ['B001TEST05','B001TEST06'], channel: 'dsp' },
];

function rand(min, max) { return Math.random() * (max - min) + min; }
function fmtDate(d) { return d.toISOString().split('T')[0]; }
function round(n, dp = 4) { return parseFloat(n.toFixed(dp)); }

async function seed() {
  console.log('🌱 Seeding realistic test data with correct CM1/CM2/CM3 formulas...\n');

  // 0. Set test-client-001 to 'pro' plan and seed demo brands
  console.log('0. Setting up plan and brands...');

  await query(
    `UPDATE clients SET plan = 'pro' WHERE client_id = ?`,
    [CLIENT_ID]
  ).catch(err => console.warn('   Could not update plan (column may not exist yet):', err.message));

  const demoBrands = [
    { brandId: BRAND_IDS.techgearUS,  name: 'TechGear US',  marketplace: 'US' },
    { brandId: BRAND_IDS.techgearUK,  name: 'TechGear UK',  marketplace: 'UK' },
    { brandId: BRAND_IDS.homestyleUS, name: 'HomeStyle US', marketplace: 'US' },
  ];

  for (const b of demoBrands) {
    await query(`
      MERGE INTO brands t
      USING (SELECT ? AS brand_id) s ON t.brand_id = s.brand_id
      WHEN MATCHED THEN UPDATE SET
        name = ?, marketplace = ?, updated_at = CURRENT_TIMESTAMP
      WHEN NOT MATCHED THEN INSERT
        (brand_id, client_id, name, marketplace, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `, [b.brandId, b.name, b.marketplace, b.brandId, CLIENT_ID, b.name, b.marketplace])
      .catch(err => console.warn(`   Could not upsert brand ${b.name}:`, err.message));
    console.log(`   ✅ Brand: ${b.name} (${b.marketplace})`);
  }

  // 1. Update products with correct COGS + referral_fees
  console.log('\n1. Updating products with COGS, FBA fees, and referral fees...');
  console.log('   Expected CM margins per unit:');
  for (const p of ASINS) {
    await query(`
      MERGE INTO products t
      USING (SELECT ? AS client_id, ? AS connection_type, ? AS asin) s
      ON t.client_id=s.client_id AND t.connection_type=s.connection_type AND t.asin=s.asin
      WHEN MATCHED THEN UPDATE SET
        sku=?, title=?, price=?, fba_fees=?, cogs=?, referral_fees=?, synced_at=CURRENT_TIMESTAMP
      WHEN NOT MATCHED THEN INSERT
        (client_id,connection_type,asin,sku,title,price,fba_fees,cogs,referral_fees,synced_at)
        VALUES (?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
    `, [
      CLIENT_ID,'seller',p.asin,
      p.sku,p.title,p.price,p.fba,p.cogs,p.referral_fees,
      CLIENT_ID,'seller',p.asin,p.sku,p.title,p.price,p.fba,p.cogs,p.referral_fees
    ]);

    const { cm1PerUnit, cm2PerUnit, cm3PerUnit } = calcExpectedMargins(p);
    const cm3Color = cm3PerUnit < 0 ? '🔴' : cm3PerUnit < 2 ? '🟡' : '🟢';
    console.log(`   ${p.asin} (${p.story}): CM1/unit $${cm1PerUnit.toFixed(2)} → CM2/unit $${cm2PerUnit.toFixed(2)} → CM3/unit $${cm3PerUnit.toFixed(2)} ${cm3Color}`);
  }

  // 2. Build 90 days of performance + sales
  console.log('\n2. Building 90 days of performance + sales data...');
  const today = new Date();
  const perfRows = [];
  const salesRows = [];

  // Track per-ASIN spend per day for CM calc (for logging only)
  const asinDailySpend = {}; // asin -> { date -> spend }

  for (let d = 90; d >= 1; d--) {
    const date = new Date(today);
    date.setDate(date.getDate() - d);
    const dateStr = fmtDate(date);

    for (const c of CAMPAIGNS) {
      const isDSP = c.channel === 'dsp';
      const impressions = Math.round(rand(isDSP ? 8000 : 2000, isDSP ? 50000 : 10000));
      const ctr         = rand(isDSP ? 0.001 : 0.004, isDSP ? 0.003 : 0.008);
      const clicks      = Math.round(impressions * ctr);
      const cpc         = round(rand(isDSP ? 1.20 : 0.45, isDSP ? 2.50 : 1.20));
      const spend       = round(clicks * cpc);

      // CVR varies by campaign
      const cvr    = rand(isDSP ? 0.03 : 0.08, isDSP ? 0.07 : 0.15);
      const orders = Math.round(clicks * cvr);

      const primaryAsin   = c.asins[0];
      const product       = ASINS.find(p => p.asin === primaryAsin);
      const avgOrderValue = product ? round(product.price * rand(1.0, 1.3)) : round(rand(25, 50));
      const sales         = round(orders * avgOrderValue);

      // Positive ROAS (1.5x-5x)
      const targetRoas     = rand(1.5, 5.0);
      const adjustedSales  = Math.max(sales, round(spend * targetRoas));
      const adjustedOrders = Math.max(orders, Math.round(adjustedSales / avgOrderValue));

      const acos     = adjustedSales > 0 ? round(spend / adjustedSales) : null;
      const roas     = spend > 0 ? round(adjustedSales / spend) : null;
      const finalCTR = impressions > 0 ? round(clicks / impressions, 6) : null;
      const finalCPC = clicks > 0 ? round(spend / clicks) : null;

      // advertised_asin — use primaryAsin for direct attribution
      const advertisedAsin = primaryAsin;

      perfRows.push(`('${CLIENT_ID}','${c.channel}','${c.id}','${dateStr}',${impressions},${clicks},${spend},${adjustedSales},${adjustedOrders},${adjustedOrders},${acos??'NULL'},${roas??'NULL'},${finalCTR??'NULL'},${finalCPC??'NULL'},'${advertisedAsin}',CURRENT_TIMESTAMP)`);

      // Track spend per ASIN for this campaign (even split)
      const spendPerAsin = spend / c.asins.length;
      c.asins.forEach(asin => {
        if (!asinDailySpend[asin]) asinDailySpend[asin] = {};
        asinDailySpend[asin][dateStr] = (asinDailySpend[asin][dateStr] || 0) + spendPerAsin;
      });
    }

    // Sales per ASIN — realistic units
    // Units vary by ASIN velocity (higher-priced items sell fewer units)
    for (const p of ASINS) {
      const baseUnits = p.price > 40 ? rand(2, 10) : p.price > 25 ? rand(4, 15) : rand(6, 22);
      const units     = Math.round(baseUnits);
      const revenue   = round(units * p.price);
      // referral_fees are per-unit applied on ordered_revenue
      // FBA fees are per-unit
      // NOTE: we store units_ordered and ordered_revenue (seller path)
      // shipped_cogs is 0 for seller accounts
      salesRows.push(`('${CLIENT_ID}','seller','${p.asin}','${dateStr}',${units},${revenue},0,0,0,CURRENT_TIMESTAMP)`);
    }
  }

  // Check if advertised_asin column exists; add graceful fallback
  const perfColCheck = await query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='AD_PERFORMANCE' AND COLUMN_NAME='ADVERTISED_ASIN'`
  ).catch(() => []);
  const hasAdvertisedAsin = perfColCheck.length > 0;

  // Batch insert performance
  const CHUNK = 50;
  if (hasAdvertisedAsin) {
    for (let i = 0; i < perfRows.length; i += CHUNK) {
      await query(`INSERT INTO ad_performance (client_id,connection_type,campaign_id,report_date,impressions,clicks,spend,sales,orders,units_sold,acos,roas,ctr,cpc,advertised_asin,synced_at) VALUES ${perfRows.slice(i,i+CHUNK).join(',')}`);
    }
  } else {
    // Fallback: insert without advertised_asin
    const perfRowsFallback = perfRows.map(r => r.replace(/,'[^']*',CURRENT_TIMESTAMP\)$/, ',CURRENT_TIMESTAMP)'));
    for (let i = 0; i < perfRowsFallback.length; i += CHUNK) {
      await query(`INSERT INTO ad_performance (client_id,connection_type,campaign_id,report_date,impressions,clicks,spend,sales,orders,units_sold,acos,roas,ctr,cpc,synced_at) VALUES ${perfRowsFallback.slice(i,i+CHUNK).join(',')}`);
    }
  }
  console.log(`   ✅ ${perfRows.length} ad performance rows (advertised_asin: ${hasAdvertisedAsin ? 'yes' : 'no — column not yet added'})`);

  // Check if shipped_cogs column exists in sales
  const salesColCheck = await query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='SALES' AND COLUMN_NAME='SHIPPED_COGS'`
  ).catch(() => []);
  const hasShippedCogs = salesColCheck.length > 0;

  if (hasShippedCogs) {
    for (let i = 0; i < salesRows.length; i += CHUNK) {
      await query(`INSERT INTO vendor_purchase_orders (client_id,connection_type,asin,order_date,units_ordered,ordered_revenue,units_received,shipped_revenue,shipped_cogs,synced_at) VALUES ${salesRows.slice(i,i+CHUNK).join(',')}`);
    }
  } else {
    // shipped_cogs column not yet added — strip it from the values
    // salesRows format: ('cid','seller','asin','date',units,rev,0,0,0,CURRENT_TIMESTAMP)
    //                                                                ^^ strip this 0
    const fallbackRows = salesRows.map(r => r.replace(/,0,CURRENT_TIMESTAMP\)$/, ',CURRENT_TIMESTAMP)'));
    for (let i = 0; i < fallbackRows.length; i += CHUNK) {
      await query(`INSERT INTO vendor_purchase_orders (client_id,connection_type,asin,order_date,units_ordered,ordered_revenue,units_received,shipped_revenue,synced_at) VALUES ${fallbackRows.slice(i,i+CHUNK).join(',')}`);
    }
  }
  console.log(`   ✅ ${salesRows.length} sales rows (shipped_cogs: ${hasShippedCogs ? 'yes' : 'no — column not yet added'})`);

  // 3. Calculate contribution margin using correct formulas
  console.log('\n3. Calculating contribution margin (correct CM1/CM2/CM3 formulas)...');
  const { calculateContributionMargin } = require('../jobs/contributionMargin');
  const result = await calculateContributionMargin(CLIENT_ID, 90);
  console.log(`   ✅ ${result.recordsWritten} CM records`);

  // 4. Verification summary
  console.log('\n4. Verifying data with new CM model...');
  const check = await query(`
    SELECT
      cm.asin,
      MAX(p.title)                                  AS title,
      ROUND(SUM(cm.revenue), 2)                     AS total_revenue,
      ROUND(SUM(cm.fba_fees + cm.referral_fees), 2) AS total_amazon_fees,
      ROUND(SUM(cm.cm1), 2)                         AS total_cm1,
      ROUND(SUM(cm.cogs), 2)                        AS total_cogs,
      ROUND(SUM(cm.cm2), 2)                         AS total_cm2,
      ROUND(SUM(cm.ad_spend), 2)                    AS total_ad_spend,
      ROUND(SUM(cm.cm3), 2)                         AS total_cm3,
      ROUND(AVG(cm.cm3_per_unit), 2)                AS avg_cm3_per_unit
    FROM contribution_margin cm
    LEFT JOIN products p ON cm.client_id = p.client_id AND cm.asin = p.asin
    WHERE cm.client_id = ?
      AND cm.calc_date >= DATEADD(day, -30, CURRENT_DATE)
    GROUP BY cm.asin
    ORDER BY total_cm3 DESC
  `, [CLIENT_ID]).catch(async () => {
    // Fallback query without CTE
    return query(`
      SELECT
        cm.asin,
        ROUND(SUM(cm.revenue), 2)        AS total_revenue,
        ROUND(SUM(cm.cm1), 2)            AS total_cm1,
        ROUND(SUM(cm.cm2), 2)            AS total_cm2,
        ROUND(SUM(cm.cm3), 2)            AS total_cm3,
        ROUND(AVG(cm.cm3_per_unit), 2)   AS avg_cm3_per_unit
      FROM contribution_margin cm
      WHERE client_id = ?
        AND calc_date >= DATEADD(day, -30, CURRENT_DATE)
      GROUP BY cm.asin
      ORDER BY total_cm3 DESC
    `, [CLIENT_ID]);
  });

  console.log('\n   Per-ASIN CM3 (last 30 days):');
  check.forEach(r => {
    const cm3 = Number(r.TOTAL_CM3 || 0);
    const icon = cm3 < 0 ? '🔴 NEGATIVE' : cm3 < 50 ? '🟡 marginal' : '🟢 profitable';
    console.log(`   ${r.ASIN}: Rev $${r.TOTAL_REVENUE} | CM1 $${r.TOTAL_CM1} | CM2 $${r.TOTAL_CM2} | CM3 $${r.TOTAL_CM3}/unit avg $${r.AVG_CM3_PER_UNIT} ${icon}`);
  });

  const totals = await query(`
    SELECT
      ROUND(SUM(revenue), 2)   AS total_revenue,
      ROUND(SUM(cm1), 2)       AS total_cm1,
      ROUND(SUM(cm2), 2)       AS total_cm2,
      ROUND(SUM(cm3), 2)       AS total_cm3,
      ROUND(SUM(ad_spend), 2)  AS total_ad_spend
    FROM contribution_margin
    WHERE client_id = ?
      AND calc_date >= DATEADD(day, -30, CURRENT_DATE)
  `, [CLIENT_ID]);

  const t = totals[0] || {};
  console.log(`\n   30-day totals:`);
  console.log(`   Revenue:     $${t.TOTAL_REVENUE}`);
  console.log(`   CM1 (net proceeds):  $${t.TOTAL_CM1}`);
  console.log(`   CM2 (gross profit):  $${t.TOTAL_CM2}`);
  console.log(`   Ad Spend:    $${t.TOTAL_AD_SPEND}`);
  console.log(`   CM3 (true profit):   $${t.TOTAL_CM3}`);

  console.log('\n✅ Seed complete!');
  process.exit(0);
}

seed().catch(e => { console.error('Seed failed:', e.message); process.exit(1); });
