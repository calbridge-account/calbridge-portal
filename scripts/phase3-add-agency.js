#!/usr/bin/env node
/**
 * Phase 3E — Add agency_accounts table and wire 4-tier hierarchy
 *
 * This script is IDEMPOTENT — safe to run multiple times.
 *
 * What it does:
 *   1. Creates agency_accounts table
 *   2. Adds agency_id column to manager_accounts, users, client_migration_map
 *   3. Seeds Calbridge as the top-level agency
 *   4. Creates Acer manager_account + advertiser_account
 *   5. Links CyberPower and Acer manager rows to Calbridge agency
 *   6. Updates client_migration_map with agency_id for both clients
 *   7. Upserts abe@teamcalbridge.com as agency_admin
 *
 * IDs created (stable across re-runs — idempotency checked before insert):
 *   CALBRIDGE_AGENCY_ID:   c4lb-r1dg-e000-0000-ca1br1dge001  (generated below)
 *   ACER_MANAGER_ID:       (generated, stored in client_migration_map)
 *   ACER_ADVERTISER_ID:    (generated, stored in client_migration_map)
 *
 * Run:
 *   node scripts/phase3-add-agency.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { query } = require('../src/services/snowflakeService');
const { v4: uuidv4 } = require('uuid');

// ─── Constants ────────────────────────────────────────────────────────────────

// Pre-existing IDs (from prior phases)
const CYBERPOWER_CLIENT_ID  = '7d88ea17-002b-4a02-97fc-bcab1292d57e';
const CYBERPOWER_MANAGER_ID = '0e5b83c9-5321-4317-abf5-dc9a79e5e733';
const ACER_CLIENT_ID        = '929cea98-38a6-49ab-bffc-1d38b1f3cc60';

// Stable IDs for Calbridge agency — deterministic so re-runs stay consistent.
// Generated once and hardcoded here for idempotency across runs.
// Must be exactly 36 chars (UUID format: 8-4-4-4-12).
const CALBRIDGE_AGENCY_ID = 'ca1br1dg-e000-4000-a000-000ca1bridge0';

const ABE_EMAIL = 'abe@teamcalbridge.com';

// ─── Step 1: DDL — Create agency_accounts, add agency_id columns ──────────────

async function step1_ddl() {
  console.log('\n=== Step 1: DDL ===\n');

  const ddlStatements = [
    {
      desc: 'Create agency_accounts table',
      sql: `
        CREATE TABLE IF NOT EXISTS CALBRIDGE_PROD.APP.agency_accounts (
          agency_id              VARCHAR(36)   NOT NULL PRIMARY KEY,
          name                   VARCHAR(255),
          stripe_customer_id     VARCHAR(255),
          stripe_subscription_id VARCHAR(255),
          subscription_plan      VARCHAR(20),
          subscription_status    VARCHAR(20),
          created_at             TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
          updated_at             TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
        )
      `
    },
    {
      desc: 'Add agency_id to manager_accounts',
      sql: `ALTER TABLE CALBRIDGE_PROD.APP.manager_accounts ADD COLUMN IF NOT EXISTS agency_id VARCHAR(36)`
    },
    {
      desc: 'Add agency_id to users',
      sql: `ALTER TABLE CALBRIDGE_PROD.APP.users ADD COLUMN IF NOT EXISTS agency_id VARCHAR(36)`
    },
    {
      desc: 'Add agency_id to client_migration_map',
      sql: `ALTER TABLE CALBRIDGE_PROD.APP.client_migration_map ADD COLUMN IF NOT EXISTS agency_id VARCHAR(36)`
    }
  ];

  for (const { desc, sql } of ddlStatements) {
    process.stdout.write(`  ${desc}... `);
    try {
      await query(sql.trim());
      console.log('✅');
    } catch (err) {
      // Snowflake returns error if ADD COLUMN fails for reasons other than IF NOT EXISTS
      console.log(`⚠️  ${err.message}`);
    }
  }
}

// ─── Step 2: Seed Calbridge agency ────────────────────────────────────────────

async function step2_seedAgency() {
  console.log('\n=== Step 2: Seed Calbridge agency ===\n');

  const existing = await query(
    `SELECT agency_id FROM CALBRIDGE_PROD.APP.agency_accounts WHERE agency_id = ?`,
    [CALBRIDGE_AGENCY_ID]
  );

  if (existing.length) {
    console.log(`  Calbridge agency already exists (${CALBRIDGE_AGENCY_ID}) — skipping insert ✅`);
  } else {
    process.stdout.write(`  Inserting Calbridge agency (${CALBRIDGE_AGENCY_ID})... `);
    await query(
      `INSERT INTO CALBRIDGE_PROD.APP.agency_accounts
         (agency_id, name, subscription_plan, subscription_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())`,
      [CALBRIDGE_AGENCY_ID, 'Calbridge', 'enterprise', 'active']
    );
    console.log('✅');
  }
}

// ─── Step 3: Create Acer manager + advertiser accounts ───────────────────────

async function step3_seedAcer() {
  console.log('\n=== Step 3: Seed Acer manager account ===\n');

  // Check if Acer is already in client_migration_map
  const existing = await query(
    `SELECT manager_id, advertiser_id FROM CALBRIDGE_PROD.APP.client_migration_map WHERE client_id = ?`,
    [ACER_CLIENT_ID]
  );

  let acerManagerId, acerAdvertiserId;

  if (existing.length) {
    acerManagerId    = existing[0].MANAGER_ID;
    acerAdvertiserId = existing[0].ADVERTISER_ID;
    console.log(`  Acer already in migration map — manager_id: ${acerManagerId}`);
    console.log(`  advertiser_id: ${acerAdvertiserId}`);

    // Verify the manager_account row exists
    const managerRow = await query(
      `SELECT manager_id FROM CALBRIDGE_PROD.APP.manager_accounts WHERE manager_id = ?`,
      [acerManagerId]
    );
    if (!managerRow.length) {
      process.stdout.write(`  manager_accounts row missing — inserting... `);
      await query(
        `INSERT INTO CALBRIDGE_PROD.APP.manager_accounts
           (manager_id, name, agency_id, created_at, updated_at)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())`,
        [acerManagerId, 'Acer', CALBRIDGE_AGENCY_ID]
      );
      console.log('✅');
    } else {
      console.log('  manager_accounts row exists ✅');
    }

    // Verify advertiser_account row exists
    const advertiserRow = await query(
      `SELECT advertiser_id FROM CALBRIDGE_PROD.APP.advertiser_accounts WHERE advertiser_id = ?`,
      [acerAdvertiserId]
    );
    if (!advertiserRow.length) {
      process.stdout.write(`  advertiser_accounts row missing — inserting... `);
      await query(
        `INSERT INTO CALBRIDGE_PROD.APP.advertiser_accounts
           (advertiser_id, manager_id, name, marketplace, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, TRUE, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())`,
        [acerAdvertiserId, acerManagerId, 'Acer', 'US']
      );
      console.log('✅');
    } else {
      console.log('  advertiser_accounts row exists ✅');
    }
  } else {
    // Create fresh Acer records
    acerManagerId    = uuidv4();
    acerAdvertiserId = uuidv4();

    console.log(`  New Acer manager_id:    ${acerManagerId}`);
    console.log(`  New Acer advertiser_id: ${acerAdvertiserId}`);

    process.stdout.write('  Inserting Acer manager_accounts row... ');
    await query(
      `INSERT INTO CALBRIDGE_PROD.APP.manager_accounts
         (manager_id, name, agency_id, created_at, updated_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())`,
      [acerManagerId, 'Acer', CALBRIDGE_AGENCY_ID]
    );
    console.log('✅');

    process.stdout.write('  Inserting Acer advertiser_accounts row... ');
    await query(
      `INSERT INTO CALBRIDGE_PROD.APP.advertiser_accounts
         (advertiser_id, manager_id, name, marketplace, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, TRUE, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())`,
      [acerAdvertiserId, acerManagerId, 'Acer', 'US']
    );
    console.log('✅');

    process.stdout.write('  Inserting Acer into client_migration_map... ');
    await query(
      `INSERT INTO CALBRIDGE_PROD.APP.client_migration_map
         (client_id, manager_id, advertiser_id, agency_id, migrated_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP())`,
      [ACER_CLIENT_ID, acerManagerId, acerAdvertiserId, CALBRIDGE_AGENCY_ID]
    );
    console.log('✅');
  }

  return { acerManagerId, acerAdvertiserId };
}

// ─── Step 4: Link CyberPower manager to Calbridge agency ──────────────────────

async function step4_linkCyberPower() {
  console.log('\n=== Step 4: Link CyberPower to Calbridge agency ===\n');

  // Update manager_accounts.agency_id for CyberPower (the correct Phase 3A row)
  const result = await query(
    `UPDATE CALBRIDGE_PROD.APP.manager_accounts
     SET agency_id = ?, updated_at = CURRENT_TIMESTAMP()
     WHERE manager_id = ? AND (agency_id IS NULL OR agency_id != ?)`,
    [CALBRIDGE_AGENCY_ID, CYBERPOWER_MANAGER_ID, CALBRIDGE_AGENCY_ID]
  );
  console.log(`  Updated CyberPower manager_accounts.agency_id ✅`);

  // Update client_migration_map.agency_id for CyberPower
  const mapResult = await query(
    `UPDATE CALBRIDGE_PROD.APP.client_migration_map
     SET agency_id = ?
     WHERE client_id = ? AND (agency_id IS NULL OR agency_id != ?)`,
    [CALBRIDGE_AGENCY_ID, CYBERPOWER_CLIENT_ID, CALBRIDGE_AGENCY_ID]
  );
  console.log(`  Updated CyberPower client_migration_map.agency_id ✅`);
}

// ─── Step 5: Update Acer client_migration_map agency_id ──────────────────────

async function step5_updateAcerMap() {
  console.log('\n=== Step 5: Ensure Acer migration map has agency_id ===\n');

  await query(
    `UPDATE CALBRIDGE_PROD.APP.client_migration_map
     SET agency_id = ?
     WHERE client_id = ? AND (agency_id IS NULL OR agency_id != ?)`,
    [CALBRIDGE_AGENCY_ID, ACER_CLIENT_ID, CALBRIDGE_AGENCY_ID]
  );
  console.log('  Acer client_migration_map.agency_id set ✅');
}

// ─── Step 6: Upsert abe@teamcalbridge.com as agency_admin ────────────────────

async function step6_upsertAbe() {
  console.log('\n=== Step 6: Upsert abe@teamcalbridge.com as agency_admin ===\n');

  const existing = await query(
    `SELECT user_id, role, agency_id FROM CALBRIDGE_PROD.APP.users WHERE email = ?`,
    [ABE_EMAIL]
  );

  if (existing.length) {
    const abeRow = existing[0];
    const needsUpdate = abeRow.AGENCY_ID !== CALBRIDGE_AGENCY_ID || abeRow.ROLE !== 'agency_admin';
    if (needsUpdate) {
      process.stdout.write(`  Updating Abe's row (user_id: ${abeRow.USER_ID})... `);
      await query(
        `UPDATE CALBRIDGE_PROD.APP.users
         SET agency_id = ?, role = ?
         WHERE email = ?`,
        [CALBRIDGE_AGENCY_ID, 'agency_admin', ABE_EMAIL]
      );
      console.log('✅');
    } else {
      console.log(`  Abe already set as agency_admin (${abeRow.USER_ID}) ✅`);
    }
  } else {
    const abeUserId = uuidv4();
    process.stdout.write(`  Creating Abe's user row (user_id: ${abeUserId})... `);
    await query(
      `INSERT INTO CALBRIDGE_PROD.APP.users
         (user_id, client_id, email, name, role, agency_id, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, TRUE, CURRENT_TIMESTAMP())`,
      [abeUserId, abeUserId, ABE_EMAIL, 'Abe Curry', 'agency_admin', CALBRIDGE_AGENCY_ID]
    );
    console.log('✅');
    console.log(`  Abe's user_id: ${abeUserId}`);
  }
}

// ─── Step 7: Verify final state ───────────────────────────────────────────────

async function step7_verify() {
  console.log('\n=== Step 7: Verification ===\n');

  const agency = await query(
    `SELECT * FROM CALBRIDGE_PROD.APP.agency_accounts WHERE agency_id = ?`,
    [CALBRIDGE_AGENCY_ID]
  );
  console.log('  agency_accounts (Calbridge):');
  console.log('   ', JSON.stringify(agency[0], null, 4).replace(/\n/g, '\n    '));

  const managers = await query(
    `SELECT manager_id, name, agency_id FROM CALBRIDGE_PROD.APP.manager_accounts WHERE agency_id = ?`,
    [CALBRIDGE_AGENCY_ID]
  );
  console.log(`\n  manager_accounts under Calbridge agency (${managers.length} rows):`);
  managers.forEach(m => console.log(`    - ${m.NAME} (${m.MANAGER_ID})`));

  const map = await query(
    `SELECT client_id, manager_id, advertiser_id, agency_id FROM CALBRIDGE_PROD.APP.client_migration_map`
  );
  console.log(`\n  client_migration_map (${map.length} rows):`);
  map.forEach(r => console.log(`    client: ${r.CLIENT_ID} → manager: ${r.MANAGER_ID} / agency: ${r.AGENCY_ID}`));

  const abe = await query(
    `SELECT user_id, email, role, agency_id FROM CALBRIDGE_PROD.APP.users WHERE email = ?`,
    [ABE_EMAIL]
  );
  console.log(`\n  abe@teamcalbridge.com: ${abe.length ? JSON.stringify(abe[0]) : 'NOT FOUND'}`);

  console.log('');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('==========================================');
  console.log('  Phase 3E — Agency Accounts Migration   ');
  console.log('==========================================');
  console.log(`  CALBRIDGE_AGENCY_ID: ${CALBRIDGE_AGENCY_ID}`);
  console.log(`  CYBERPOWER_MANAGER_ID: ${CYBERPOWER_MANAGER_ID}`);
  console.log(`  ACER_CLIENT_ID: ${ACER_CLIENT_ID}`);

  try {
    await step1_ddl();
    await step2_seedAgency();
    const { acerManagerId, acerAdvertiserId } = await step3_seedAcer();
    await step4_linkCyberPower();
    await step5_updateAcerMap();
    await step6_upsertAbe();
    await step7_verify();

    console.log('==========================================');
    console.log('  ✅ Phase 3E complete.                  ');
    console.log('==========================================');
    console.log('\n  Summary of stable IDs:');
    console.log(`    CALBRIDGE_AGENCY_ID:    ${CALBRIDGE_AGENCY_ID}`);
    console.log(`    CYBERPOWER_MANAGER_ID:  ${CYBERPOWER_MANAGER_ID}`);
    console.log(`    ACER_CLIENT_ID:         ${ACER_CLIENT_ID}`);
    console.log(`    ACER_MANAGER_ID:        ${acerManagerId}`);
    console.log(`    ACER_ADVERTISER_ID:     ${acerAdvertiserId}`);
    console.log('');

    process.exit(0);
  } catch (err) {
    console.error('\n❌ Phase 3E failed:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

main();
