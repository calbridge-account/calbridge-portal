#!/usr/bin/env node
/**
 * Phase 3I — Migrate Stripe billing from clients → manager_accounts
 *
 * What this script does:
 *   1. Ensures manager_accounts has the required billing columns
 *      (trial_ends_at, subscription_ends_at — others were added in Phase 3A).
 *   2. For every client_id in client_migration_map, copies billing fields
 *      from clients → manager_accounts if the manager row is empty.
 *   3. Idempotent: safe to run multiple times. Only copies when
 *      manager_accounts.stripe_customer_id IS NULL.
 *
 * Usage:
 *   node scripts/phase3-migrate-billing.js
 *   node scripts/phase3-migrate-billing.js --dry-run
 *
 * Run BEFORE enabling Phase 3I billing reads in production.
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { query } = require('../src/services/snowflakeService');

const DRY_RUN = process.argv.includes('--dry-run');

if (DRY_RUN) {
  console.log('\n⚠️  DRY RUN — no changes will be committed\n');
}

// ─── Step 1: Ensure billing columns exist on manager_accounts ─────────────────

async function step1_ensureColumns() {
  console.log('=== Step 1: Ensure billing columns on manager_accounts ===\n');

  const alterStatements = [
    {
      desc: 'trial_ends_at',
      sql:  'ALTER TABLE CALBRIDGE_PROD.APP.manager_accounts ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMP_NTZ'
    },
    {
      desc: 'subscription_ends_at',
      sql:  'ALTER TABLE CALBRIDGE_PROD.APP.manager_accounts ADD COLUMN IF NOT EXISTS subscription_ends_at TIMESTAMP_NTZ'
    }
  ];

  for (const { desc, sql } of alterStatements) {
    process.stdout.write(`  Adding column ${desc}... `);
    if (!DRY_RUN) {
      await query(sql);
    }
    console.log(DRY_RUN ? '(skipped — dry run)' : '✅');
  }

  // Verify final column list
  const cols = await query('DESCRIBE TABLE CALBRIDGE_PROD.APP.manager_accounts');
  const colNames = cols.map(c => c.name);
  console.log(`\n  Columns on manager_accounts: ${colNames.join(', ')}\n`);
}

// ─── Step 2: Migrate billing data from clients → manager_accounts ─────────────

async function step2_migrateBilling() {
  console.log('=== Step 2: Migrate billing data from clients → manager_accounts ===\n');

  // Fetch all client_migration_map entries
  const mapRows = await query(
    'SELECT client_id, manager_id FROM CALBRIDGE_PROD.APP.client_migration_map'
  );

  if (!mapRows.length) {
    console.log('  No entries in client_migration_map — nothing to migrate.\n');
    return;
  }

  console.log(`  Found ${mapRows.length} client mapping(s).\n`);

  let migrated = 0;
  let skipped  = 0;

  for (const row of mapRows) {
    const clientId  = row.CLIENT_ID  || row.client_id;
    const managerId = row.MANAGER_ID || row.manager_id;

    // Check if manager_accounts already has billing data
    const mgrRows = await query(
      `SELECT stripe_customer_id, stripe_subscription_id, subscription_plan, subscription_status
       FROM CALBRIDGE_PROD.APP.manager_accounts WHERE manager_id = ?`,
      [managerId]
    );

    if (!mgrRows.length) {
      console.log(`  ⚠️  manager_id ${managerId} not found in manager_accounts — skipping`);
      skipped++;
      continue;
    }

    const mgr = mgrRows[0];
    const alreadyHasBilling = !!(
      mgr.STRIPE_CUSTOMER_ID ||
      mgr.STRIPE_SUBSCRIPTION_ID ||
      mgr.SUBSCRIPTION_PLAN
    );

    if (alreadyHasBilling) {
      console.log(`  ⏭️  manager_id ${managerId} already has billing data — skipping`);
      skipped++;
      continue;
    }

    // Fetch billing data from clients
    const clientRows = await query(
      `SELECT stripe_customer_id, stripe_subscription_id, subscription_plan,
              subscription_status, trial_ends_at, subscription_ends_at
       FROM CALBRIDGE_PROD.APP.clients WHERE client_id = ?`,
      [clientId]
    );

    if (!clientRows.length) {
      console.log(`  ⚠️  client_id ${clientId} not found in clients table — skipping`);
      skipped++;
      continue;
    }

    const c = clientRows[0];
    const hasData = !!(
      c.STRIPE_CUSTOMER_ID ||
      c.STRIPE_SUBSCRIPTION_ID ||
      c.SUBSCRIPTION_PLAN
    );

    if (!hasData) {
      console.log(`  ○  client_id ${clientId} has no billing data to migrate`);
      skipped++;
      continue;
    }

    // Copy billing fields to manager_accounts
    console.log(`  → Migrating client_id ${clientId} → manager_id ${managerId}`);
    console.log(`    stripe_customer_id:     ${c.STRIPE_CUSTOMER_ID}`);
    console.log(`    stripe_subscription_id: ${c.STRIPE_SUBSCRIPTION_ID}`);
    console.log(`    subscription_plan:      ${c.SUBSCRIPTION_PLAN}`);
    console.log(`    subscription_status:    ${c.SUBSCRIPTION_STATUS}`);
    console.log(`    trial_ends_at:          ${c.TRIAL_ENDS_AT}`);
    console.log(`    subscription_ends_at:   ${c.SUBSCRIPTION_ENDS_AT}`);

    if (!DRY_RUN) {
      await query(`
        UPDATE CALBRIDGE_PROD.APP.manager_accounts
        SET stripe_customer_id      = ?,
            stripe_subscription_id  = ?,
            subscription_plan       = ?,
            subscription_status     = ?,
            trial_ends_at           = ?,
            subscription_ends_at    = ?
        WHERE manager_id = ?
      `, [
        c.STRIPE_CUSTOMER_ID      || null,
        c.STRIPE_SUBSCRIPTION_ID  || null,
        c.SUBSCRIPTION_PLAN       || null,
        c.SUBSCRIPTION_STATUS     || null,
        c.TRIAL_ENDS_AT           || null,
        c.SUBSCRIPTION_ENDS_AT    || null,
        managerId
      ]);
    }

    console.log(DRY_RUN ? '    (skipped — dry run) ✅\n' : '    ✅ Copied\n');
    migrated++;
  }

  console.log(`\n  Summary: ${migrated} migrated, ${skipped} skipped\n`);
}

// ─── Step 3: Verify migration ─────────────────────────────────────────────────

async function step3_verify() {
  console.log('=== Step 3: Verify manager_accounts billing state ===\n');

  const rows = await query(
    `SELECT manager_id, name, stripe_customer_id, stripe_subscription_id,
            subscription_plan, subscription_status, trial_ends_at, subscription_ends_at
     FROM CALBRIDGE_PROD.APP.manager_accounts
     ORDER BY name`
  );

  if (!rows.length) {
    console.log('  No manager accounts found.\n');
    return;
  }

  for (const r of rows) {
    console.log(`  Manager: ${r.NAME || '(unnamed)'} [${r.MANAGER_ID}]`);
    console.log(`    stripe_customer_id:     ${r.STRIPE_CUSTOMER_ID     || '(none)'}`);
    console.log(`    stripe_subscription_id: ${r.STRIPE_SUBSCRIPTION_ID || '(none)'}`);
    console.log(`    subscription_plan:      ${r.SUBSCRIPTION_PLAN      || '(none)'}`);
    console.log(`    subscription_status:    ${r.SUBSCRIPTION_STATUS    || '(none)'}`);
    console.log(`    trial_ends_at:          ${r.TRIAL_ENDS_AT          || '(none)'}`);
    console.log(`    subscription_ends_at:   ${r.SUBSCRIPTION_ENDS_AT   || '(none)'}`);
    console.log('');
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║   Phase 3I — Billing migration: clients → manager_accounts ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  await step1_ensureColumns();
  await step2_migrateBilling();
  await step3_verify();

  console.log('✅ Phase 3I billing migration complete.\n');
  process.exit(0);
}

main().catch(err => {
  console.error('\n❌ Migration failed:', err.message);
  console.error(err.stack);
  process.exit(1);
});
