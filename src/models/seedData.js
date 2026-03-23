/**
 * Seed Snowflake SANDBOX with realistic test data
 * Usage: node src/models/seedData.js
 */
require('dotenv').config();
const { v4: uuidv4 } = require('uuid');
const { query } = require('../services/snowflakeService');

const TEST_CLIENT_ID = 'test-client-001';
const TEST_CLIENT_EMAIL = 'demo@example.com';
const TEST_CLIENT_NAME = 'Acme Brands LLC';

const ASINS = [
  { asin: 'B001TEST01', title: 'Premium Bamboo Cutting Board', brand: 'Acme', price: 34.99, fba_fees: 5.50, cogs: 8.00 },
  { asin: 'B001TEST02', title: 'Stainless Steel Water Bottle 32oz', brand: 'Acme', price: 24.99, fba_fees: 4.20, cogs: 5.50 },
  { asin: 'B001TEST03', title: 'Silicone Kitchen Utensil Set', brand: 'Acme', price: 29.99, fba_fees: 4.80, cogs: 7.00 },
  { asin: 'B001TEST04', title: 'Cast Iron Skillet 12-inch', brand: 'Acme', price: 49.99, fba_fees: 8.00, cogs: 18.00 },
  { asin: 'B001TEST05', title: 'Magnetic Knife Strip', brand: 'Acme', price: 19.99, fba_fees: 3.50, cogs: 4.00 },
  { asin: 'B001TEST06', title: 'Organic Cotton Kitchen Towels 6pk', brand: 'Acme', price: 22.99, fba_fees: 3.80, cogs: 5.00 },
  { asin: 'B001TEST07', title: 'Bamboo Dish Drying Rack', brand: 'Acme', price: 39.99, fba_fees: 6.50, cogs: 10.00 },
  { asin: 'B001TEST08', title: 'Glass Food Storage Containers 10pk', brand: 'Acme', price: 44.99, fba_fees: 7.00, cogs: 12.00 },
];

const CAMPAIGNS = [
  { id: 'camp-001', name: 'Cutting Board - SP Auto', type: 'sponsoredProducts', budget: 50 },
  { id: 'camp-002', name: 'Water Bottle - SP Manual', type: 'sponsoredProducts', budget: 75 },
  { id: 'camp-003', name: 'Kitchen Set - SB Brand', type: 'sponsoredBrands', budget: 100 },
  { id: 'camp-004', name: 'Cast Iron - SD Retargeting', type: 'sponsoredDisplay', budget: 40 },
  { id: 'camp-005', name: 'Knife Strip - SP Auto', type: 'sponsoredProducts', budget: 30 },
];

function randomBetween(min, max) {
  return Math.random() * (max - min) + min;
}

function formatDate(d) {
  return d.toISOString().split('T')[0];
}

async function seed() {
  console.log('🌱 Seeding test data into Snowflake SANDBOX...\n');

  // 1. Insert test client
  console.log('1. Creating test client...');
  await query(`
    MERGE INTO clients t USING (SELECT ? AS client_id) s ON t.client_id = s.client_id
    WHEN NOT MATCHED THEN INSERT (client_id, email, name, created_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
  `, [TEST_CLIENT_ID, TEST_CLIENT_ID, TEST_CLIENT_EMAIL, TEST_CLIENT_NAME]);
  console.log(`   ✅ Client: ${TEST_CLIENT_NAME} (${TEST_CLIENT_ID})`);

  // 2. Insert products
  console.log('\n2. Inserting products...');
  for (const p of ASINS) {
    await query(`
      MERGE INTO products t
      USING (SELECT ? AS client_id, ? AS connection_type, ? AS asin) s
      ON t.client_id = s.client_id AND t.connection_type = s.connection_type AND t.asin = s.asin
      WHEN MATCHED THEN UPDATE SET title=?, brand=?, price=?, fba_fees=?, cogs=?, synced_at=CURRENT_TIMESTAMP
      WHEN NOT MATCHED THEN INSERT (client_id, connection_type, asin, title, brand, price, fba_fees, cogs, synced_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `, [
      TEST_CLIENT_ID, 'seller', p.asin,
      p.title, p.brand, p.price, p.fba_fees, p.cogs,
      TEST_CLIENT_ID, 'seller', p.asin, p.title, p.brand, p.price, p.fba_fees, p.cogs
    ]);
    console.log(`   ✅ ${p.asin}: ${p.title}`);
  }

  // 3. Insert campaigns
  console.log('\n3. Inserting campaigns...');
  for (const c of CAMPAIGNS) {
    await query(`
      MERGE INTO ad_campaigns t
      USING (SELECT ? AS client_id, ? AS connection_type, ? AS campaign_id) s
      ON t.client_id = s.client_id AND t.connection_type = s.connection_type AND t.campaign_id = s.campaign_id
      WHEN MATCHED THEN UPDATE SET campaign_name=?, campaign_type=?, status='enabled', budget=?, synced_at=CURRENT_TIMESTAMP
      WHEN NOT MATCHED THEN INSERT (client_id, connection_type, campaign_id, campaign_name, campaign_type, status, budget, budget_type, synced_at)
      VALUES (?, ?, ?, ?, ?, 'enabled', ?, 'daily', CURRENT_TIMESTAMP)
    `, [
      TEST_CLIENT_ID, 'ads', c.id,
      c.name, c.type, c.budget,
      TEST_CLIENT_ID, 'ads', c.id, c.name, c.type, c.budget
    ]);
    console.log(`   ✅ ${c.id}: ${c.name}`);
  }

  // 4. Insert 90 days of performance + sales data (batch inserts)
  console.log('\n4. Inserting 90 days of performance + sales data (batch)...');
  const today = new Date();
  const perfValues = [];
  const salesValues = [];

  for (let d = 90; d >= 1; d--) {
    const date = new Date(today);
    date.setDate(date.getDate() - d);
    const dateStr = formatDate(date);

    for (const c of CAMPAIGNS) {
      const impressions = Math.round(randomBetween(1000, 8000));
      const clicks = Math.round(impressions * randomBetween(0.003, 0.012));
      const spend = parseFloat((clicks * randomBetween(0.45, 1.80)).toFixed(4));
      const orders = Math.round(clicks * randomBetween(0.05, 0.18));
      const sales = parseFloat((orders * randomBetween(20, 50)).toFixed(4));
      const acos = sales > 0 ? parseFloat((spend / sales).toFixed(4)) : null;
      const roas = spend > 0 ? parseFloat((sales / spend).toFixed(4)) : null;
      const ctr = impressions > 0 ? parseFloat((clicks / impressions).toFixed(6)) : null;
      const cpc = clicks > 0 ? parseFloat((spend / clicks).toFixed(4)) : null;
      perfValues.push(`('${TEST_CLIENT_ID}','ads','${c.id}','${dateStr}',${impressions},${clicks},${spend},${sales},${orders},${orders},${acos ?? 'NULL'},${roas ?? 'NULL'},${ctr ?? 'NULL'},${cpc ?? 'NULL'},CURRENT_TIMESTAMP)`);
    }

    for (const p of ASINS) {
      const units = Math.round(randomBetween(1, 15));
      const revenue = parseFloat((units * p.price).toFixed(4));
      salesValues.push(`('${TEST_CLIENT_ID}','seller','${p.asin}','${dateStr}',${units},${revenue},CURRENT_TIMESTAMP)`);
    }
  }

  // Batch insert performance (chunks of 100)
  const CHUNK = 100;
  for (let i = 0; i < perfValues.length; i += CHUNK) {
    const chunk = perfValues.slice(i, i + CHUNK).join(',');
    await query(`INSERT INTO ad_performance (client_id,connection_type,campaign_id,report_date,impressions,clicks,spend,sales,orders,units_sold,acos,roas,ctr,cpc,synced_at) VALUES ${chunk}`);
  }
  console.log(`   ✅ ${perfValues.length} performance rows`);

  // Batch insert sales
  for (let i = 0; i < salesValues.length; i += CHUNK) {
    const chunk = salesValues.slice(i, i + CHUNK).join(',');
    await query(`INSERT INTO sales (client_id,connection_type,asin,order_date,units_ordered,ordered_revenue,synced_at) VALUES ${chunk}`);
  }
  console.log(`   ✅ ${salesValues.length} sales rows`);

  // 5. Calculate contribution margin
  console.log('\n5. Calculating contribution margin...');
  const { calculateContributionMargin } = require('../jobs/contributionMargin');
  const result = await calculateContributionMargin(TEST_CLIENT_ID, 90);
  console.log(`   ✅ ${result.recordsWritten} contribution margin records`);

  console.log('\n✅ Seed complete! Test client ID:', TEST_CLIENT_ID);
  console.log('   Use this client_id to test dashboard queries.');
  process.exit(0);
}

seed().catch(err => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
