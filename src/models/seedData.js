/**
 * Seed Snowflake SANDBOX with realistic test data
 * Usage: node src/models/seedData.js
 *
 * All campaigns have positive ROAS (1.5x - 6x)
 * All ASINs have positive contribution margin
 * Includes unit CM and unit CM%
 */
require('dotenv').config();
const { query } = require('../services/snowflakeService');

const CLIENT_ID = 'test-client-001';

const ASINS = [
  { asin: 'B001TEST01', title: 'Premium Bamboo Cutting Board',       sku: 'BCB-001', price: 34.99, fba: 5.50, cogs: 8.00,  referral: 3.50 },
  { asin: 'B001TEST02', title: 'Stainless Steel Water Bottle 32oz',  sku: 'WB-32',  price: 24.99, fba: 4.20, cogs: 5.50,  referral: 2.50 },
  { asin: 'B001TEST03', title: 'Silicone Kitchen Utensil Set',        sku: 'KUS-6',  price: 29.99, fba: 4.80, cogs: 7.00,  referral: 3.00 },
  { asin: 'B001TEST04', title: 'Cast Iron Skillet 12-inch',           sku: 'CIS-12', price: 49.99, fba: 8.00, cogs: 18.00, referral: 5.00 },
  { asin: 'B001TEST05', title: 'Magnetic Knife Strip',                sku: 'MKS-18', price: 19.99, fba: 3.50, cogs: 4.00,  referral: 2.00 },
  { asin: 'B001TEST06', title: 'Organic Cotton Kitchen Towels 6pk',   sku: 'KT-6PK', price: 22.99, fba: 3.80, cogs: 5.00,  referral: 2.30 },
  { asin: 'B001TEST07', title: 'Bamboo Dish Drying Rack',             sku: 'DDR-B',  price: 39.99, fba: 6.50, cogs: 10.00, referral: 4.00 },
  { asin: 'B001TEST08', title: 'Glass Food Storage Containers 10pk',  sku: 'FSC-10', price: 44.99, fba: 7.00, cogs: 12.00, referral: 4.50 },
];

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
  console.log('🌱 Seeding realistic test data...\n');

  // 1. Update products with correct COGS
  console.log('1. Updating products with COGS...');
  for (const p of ASINS) {
    await query(`
      MERGE INTO products t
      USING (SELECT ? AS client_id, ? AS connection_type, ? AS asin) s
      ON t.client_id=s.client_id AND t.connection_type=s.connection_type AND t.asin=s.asin
      WHEN MATCHED THEN UPDATE SET
        sku=?, title=?, price=?, fba_fees=?, cogs=?, synced_at=CURRENT_TIMESTAMP
      WHEN NOT MATCHED THEN INSERT
        (client_id,connection_type,asin,sku,title,price,fba_fees,cogs,synced_at)
        VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
    `, [
      CLIENT_ID,'seller',p.asin, p.sku,p.title,p.price,p.fba,p.cogs,
      CLIENT_ID,'seller',p.asin,p.sku,p.title,p.price,p.fba,p.cogs
    ]);
    const unitCM = p.price - p.fba - p.cogs - p.referral;
    const unitCMPct = (unitCM / p.price * 100).toFixed(1);
    console.log(`   ${p.asin}: price $${p.price}, COGS $${p.cogs}, FBA $${p.fba} → Unit CM $${unitCM.toFixed(2)} (${unitCMPct}%)`);
  }

  // 2. Build 90 days of performance + sales
  console.log('\n2. Building 90 days of performance + sales data...');
  const today = new Date();
  const perfRows = [];
  const salesRows = [];

  // Track per-ASIN spend for CM calc
  const asinDailySpend = {}; // asin -> { date -> spend }

  for (let d = 90; d >= 1; d--) {
    const date = new Date(today);
    date.setDate(date.getDate() - d);
    const dateStr = fmtDate(date);

    for (const c of CAMPAIGNS) {
      // Realistic CTR: SP 0.4-0.8%, DSP 0.1-0.3%
      const isDSP = c.channel === 'dsp';
      const impressions = Math.round(rand(isDSP ? 8000 : 2000, isDSP ? 50000 : 10000));
      const ctr         = rand(isDSP ? 0.001 : 0.004, isDSP ? 0.003 : 0.008);
      const clicks      = Math.round(impressions * ctr);
      const cpc         = round(rand(isDSP ? 1.20 : 0.45, isDSP ? 2.50 : 1.20));
      const spend       = round(clicks * cpc);

      // Realistic CVR: SP 8-15%, DSP 3-7%
      const cvr    = rand(isDSP ? 0.03 : 0.08, isDSP ? 0.07 : 0.15);
      const orders = Math.round(clicks * cvr);

      // Pick a primary ASIN for this campaign's sales
      const primaryAsin = c.asins[0];
      const product = ASINS.find(p => p.asin === primaryAsin);
      const avgOrderValue = product ? round(product.price * rand(1.0, 1.3)) : round(rand(25, 50));
      const sales  = round(orders * avgOrderValue);

      // ROAS must be positive (1.5x - 5x)
      const targetRoas = rand(1.5, 5.0);
      const adjustedSales = Math.max(sales, round(spend * targetRoas));
      const adjustedOrders = Math.max(orders, Math.round(adjustedSales / avgOrderValue));

      const acos = adjustedSales > 0 ? round(spend / adjustedSales) : null;
      const roas = spend > 0 ? round(adjustedSales / spend) : null;
      const finalCTR = impressions > 0 ? round(clicks / impressions, 6) : null;
      const finalCPC = clicks > 0 ? round(spend / clicks) : null;

      perfRows.push(`('${CLIENT_ID}','${c.channel}','${c.id}','${dateStr}',${impressions},${clicks},${spend},${adjustedSales},${adjustedOrders},${adjustedOrders},${acos??'NULL'},${roas??'NULL'},${finalCTR??'NULL'},${finalCPC??'NULL'},CURRENT_TIMESTAMP)`);

      // Track spend per ASIN for this campaign
      const spendPerAsin = spend / c.asins.length;
      c.asins.forEach(asin => {
        if (!asinDailySpend[asin]) asinDailySpend[asin] = {};
        asinDailySpend[asin][dateStr] = (asinDailySpend[asin][dateStr] || 0) + spendPerAsin;
      });
    }

    // Sales per ASIN — realistic units
    for (const p of ASINS) {
      const units   = Math.round(rand(3, 20));
      const revenue = round(units * p.price);
      salesRows.push(`('${CLIENT_ID}','seller','${p.asin}','${dateStr}',${units},${revenue},0,0,CURRENT_TIMESTAMP)`);
    }
  }

  // Batch insert performance
  const CHUNK = 50;
  for (let i = 0; i < perfRows.length; i += CHUNK) {
    await query(`INSERT INTO ad_performance (client_id,connection_type,campaign_id,report_date,impressions,clicks,spend,sales,orders,units_sold,acos,roas,ctr,cpc,synced_at) VALUES ${perfRows.slice(i,i+CHUNK).join(',')}`);
  }
  console.log(`   ✅ ${perfRows.length} ad performance rows`);

  for (let i = 0; i < salesRows.length; i += CHUNK) {
    await query(`INSERT INTO sales (client_id,connection_type,asin,order_date,units_ordered,ordered_revenue,units_shipped,shipped_revenue,synced_at) VALUES ${salesRows.slice(i,i+CHUNK).join(',')}`);
  }
  console.log(`   ✅ ${salesRows.length} sales rows`);

  // 3. Calculate contribution margin
  console.log('\n3. Calculating contribution margin...');
  const { calculateContributionMargin } = require('../jobs/contributionMargin');
  const result = await calculateContributionMargin(CLIENT_ID, 90);
  console.log(`   ✅ ${result.recordsWritten} CM records`);

  // 4. Show summary
  console.log('\n4. Verifying data...');
  const check = await query(`
    SELECT
      ROUND(SUM(cm.revenue),2) AS total_revenue,
      ROUND(SUM(cm.ad_spend),2) AS total_ad_spend,
      ROUND(SUM(cm.contribution_margin),2) AS total_cm,
      ROUND(AVG(cm.cm_percent),1) AS avg_cm_pct
    FROM contribution_margin cm
    WHERE client_id = ?
      AND calc_date >= DATEADD(day, -30, CURRENT_DATE)
  `, [CLIENT_ID]);
  const r = check[0];
  console.log(`   Revenue: $${r.TOTAL_REVENUE}`);
  console.log(`   Ad Spend: $${r.TOTAL_AD_SPEND}`);
  console.log(`   Total CM: $${r.TOTAL_CM}`);
  console.log(`   Avg CM%: ${r.AVG_CM_PCT}%`);

  console.log('\n✅ Seed complete!');
  process.exit(0);
}

seed().catch(e => { console.error('Seed failed:', e.message); process.exit(1); });
