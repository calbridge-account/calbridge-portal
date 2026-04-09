#!/usr/bin/env node
/**
 * Phase 3A — Manager/Advertiser/User schema creation
 *
 * Creates the new 3-tier account model tables in CALBRIDGE_PROD.APP
 * alongside the existing tables. This is purely additive — no drops, no
 * migration of existing data (that happens in Phase 3b+).
 *
 * Tables created:
 *   - manager_accounts
 *   - advertiser_accounts
 *   - users
 *   - user_advertiser_access
 *   - client_migration_map  (bridge: old client_id → new manager/advertiser IDs)
 *
 * Run:
 *   node scripts/phase3-create-schema.js
 *
 * Idempotent: uses CREATE TABLE IF NOT EXISTS throughout.
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { query } = require('../src/services/snowflakeService');
const { v4: uuidv4 } = require('uuid');

// ─── DDL ──────────────────────────────────────────────────────────────────────

const DDL_STATEMENTS = [
  {
    name: 'manager_accounts',
    sql: `
      CREATE TABLE IF NOT EXISTS CALBRIDGE_PROD.APP.manager_accounts (
        manager_id              VARCHAR(36)   NOT NULL PRIMARY KEY,
        name                    VARCHAR(255),
        stripe_customer_id      VARCHAR(255),
        stripe_subscription_id  VARCHAR(255),
        subscription_plan       VARCHAR(20),
        subscription_status     VARCHAR(20),
        created_at              TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
        updated_at              TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
      )
    `
  },
  {
    name: 'advertiser_accounts',
    sql: `
      CREATE TABLE IF NOT EXISTS CALBRIDGE_PROD.APP.advertiser_accounts (
        advertiser_id           VARCHAR(36)   NOT NULL PRIMARY KEY,
        manager_id              VARCHAR(36),
        name                    VARCHAR(255),
        marketplace             VARCHAR(10)   DEFAULT 'US',
        ads_profile_id          VARCHAR(64),
        sp_seller_id            VARCHAR(64),
        sp_vendor_id            VARCHAR(64),
        dsp_advertiser_id       VARCHAR(64),
        connection_types        VARIANT,
        is_active               BOOLEAN       DEFAULT TRUE,
        created_at              TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
        updated_at              TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
      )
    `
  },
  {
    name: 'users',
    sql: `
      CREATE TABLE IF NOT EXISTS CALBRIDGE_PROD.APP.users (
        user_id                 VARCHAR(36)   NOT NULL PRIMARY KEY,
        email                   VARCHAR(255)  UNIQUE,
        password_hash           VARCHAR(255),
        name                    VARCHAR(255),
        created_at              TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
        last_login_at           TIMESTAMP_NTZ
      )
    `
  },
  {
    name: 'user_advertiser_access',
    sql: `
      CREATE TABLE IF NOT EXISTS CALBRIDGE_PROD.APP.user_advertiser_access (
        user_id                 VARCHAR(36)   NOT NULL,
        advertiser_id           VARCHAR(36)   NOT NULL,
        role                    VARCHAR(20),
        granted_at              TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
        granted_by              VARCHAR(36),
        PRIMARY KEY (user_id, advertiser_id)
      )
    `
  },
  {
    name: 'client_migration_map',
    sql: `
      CREATE TABLE IF NOT EXISTS CALBRIDGE_PROD.APP.client_migration_map (
        client_id               VARCHAR(36)   NOT NULL PRIMARY KEY,
        manager_id              VARCHAR(36),
        advertiser_id           VARCHAR(36),
        migrated_at             TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
      )
    `
  }
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function createTables() {
  console.log('\n=== Phase 3A: Creating schema tables ===\n');
  for (const { name, sql } of DDL_STATEMENTS) {
    process.stdout.write(`  Creating ${name}... `);
    await query(sql.trim());
    console.log('✅');
  }
  console.log('');
}

async function verifyTables() {
  console.log('=== Verifying tables (SELECT COUNT(*)) ===\n');
  for (const { name } of DDL_STATEMENTS) {
    const rows = await query(`SELECT COUNT(*) AS cnt FROM CALBRIDGE_PROD.APP.${name}`);
    const count = rows[0]?.CNT ?? rows[0]?.cnt ?? 0;
    console.log(`  ${name}: ${count} row(s) ✅`);
  }
  console.log('');
}

async function seedCyberPower() {
  console.log('=== Seeding CyberPower into new schema ===\n');

  // CyberPower source data (from CALBRIDGE_PROD.APP.CLIENTS + BRANDS)
  const CYBERPOWER_CLIENT_ID   = '7d88ea17-002b-4a02-97fc-bcab1292d57e';
  const CYBERPOWER_ADS_PROFILE = '2115070599068216';
  const CYBERPOWER_VENDOR_ID   = 'amzn1.ads-account.g.ap8yon1iwz0h9l6rda434b6db';

  // Check if already seeded (idempotent)
  const existing = await query(
    `SELECT client_id FROM CALBRIDGE_PROD.APP.client_migration_map WHERE client_id = ?`,
    [CYBERPOWER_CLIENT_ID]
  );
  if (existing.length > 0) {
    console.log('  CyberPower already seeded — skipping ✅\n');
    return;
  }

  // Generate stable UUIDs for the new records
  const managerId    = uuidv4();
  const advertiserId = uuidv4();

  console.log(`  manager_id:    ${managerId}`);
  console.log(`  advertiser_id: ${advertiserId}`);
  console.log('');

  // 1. Insert manager_account
  process.stdout.write('  Inserting manager_accounts row... ');
  await query(`
    INSERT INTO CALBRIDGE_PROD.APP.manager_accounts
      (manager_id, name, created_at, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())
  `, [managerId, 'CyberPower']);
  console.log('✅');

  // 2. Insert advertiser_account
  // Note: VARIANT columns cannot use PARSE_JSON() inside a VALUES clause with binds.
  // Use a SELECT-based INSERT to allow function expressions.
  process.stdout.write('  Inserting advertiser_accounts row... ');
  await query(`
    INSERT INTO CALBRIDGE_PROD.APP.advertiser_accounts
      (advertiser_id, manager_id, name, marketplace, ads_profile_id,
       sp_vendor_id, connection_types, is_active, created_at, updated_at)
    SELECT ?, ?, ?, ?, ?, ?, PARSE_JSON(?), TRUE, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP()
  `, [
    advertiserId,
    managerId,
    'CyberPower',
    'US',
    CYBERPOWER_ADS_PROFILE,
    CYBERPOWER_VENDOR_ID,
    JSON.stringify(['ads', 'vendor'])
  ]);
  console.log('✅');

  // 3. Insert into client_migration_map
  process.stdout.write('  Inserting client_migration_map row... ');
  await query(`
    INSERT INTO CALBRIDGE_PROD.APP.client_migration_map
      (client_id, manager_id, advertiser_id, migrated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP())
  `, [CYBERPOWER_CLIENT_ID, managerId, advertiserId]);
  console.log('✅');

  console.log('\n  CyberPower seeded successfully.');
  console.log(`  Existing client_id ${CYBERPOWER_CLIENT_ID}`);
  console.log(`  → manager_id:    ${managerId}`);
  console.log(`  → advertiser_id: ${advertiserId}\n`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  try {
    await createTables();
    await verifyTables();
    await seedCyberPower();

    // Final verification after seed
    console.log('=== Final row counts ===\n');
    for (const { name } of DDL_STATEMENTS) {
      const rows = await query(`SELECT COUNT(*) AS cnt FROM CALBRIDGE_PROD.APP.${name}`);
      const count = rows[0]?.CNT ?? rows[0]?.cnt ?? 0;
      console.log(`  ${name}: ${count} row(s)`);
    }

    console.log('\n✅ Phase 3A complete.\n');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ Phase 3A failed:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

main();
