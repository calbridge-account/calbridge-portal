/**
 * Migration v2 — Add billing, password reset, and onboarding columns to clients table
 * Usage: node src/models/migrate-v2.js
 *
 * Safe to run multiple times — uses IF NOT EXISTS logic where possible.
 * Snowflake does not support "ADD COLUMN IF NOT EXISTS", so each ALTER is run
 * individually and errors for "column already exists" are silently ignored.
 */
require('dotenv').config();
const { query } = require('../services/snowflakeService');

const migrations = [
  // Stripe billing columns
  `ALTER TABLE clients ADD COLUMN stripe_customer_id     VARCHAR(50)`,
  `ALTER TABLE clients ADD COLUMN stripe_subscription_id  VARCHAR(50)`,
  `ALTER TABLE clients ADD COLUMN subscription_plan       VARCHAR(20)`,
  `ALTER TABLE clients ADD COLUMN subscription_status     VARCHAR(20)`,
  `ALTER TABLE clients ADD COLUMN trial_ends_at           TIMESTAMP_NTZ`,
  `ALTER TABLE clients ADD COLUMN subscription_ends_at    TIMESTAMP_NTZ`,

  // Password reset columns
  `ALTER TABLE clients ADD COLUMN password_reset_token    VARCHAR(255)`,
  `ALTER TABLE clients ADD COLUMN password_reset_expires  TIMESTAMP_NTZ`,

  // Onboarding column
  `ALTER TABLE clients ADD COLUMN onboarding_completed    BOOLEAN DEFAULT FALSE`
];

async function migrate() {
  console.log('Running CalBridge v2 migrations...\n');
  let applied = 0;
  let skipped = 0;

  for (const stmt of migrations) {
    const col = stmt.match(/ADD COLUMN (\w+)/)?.[1] || '?';
    try {
      await query(stmt);
      console.log(`✅ Added column: ${col}`);
      applied++;
    } catch (err) {
      if (err.message?.toLowerCase().includes('already exists') ||
          err.message?.toLowerCase().includes('duplicate column')) {
        console.log(`⏭️  Column already exists: ${col}`);
        skipped++;
      } else {
        console.error(`❌ Failed to add column ${col}:`, err.message);
        process.exit(1);
      }
    }
  }

  console.log(`\n✅ Migration complete — ${applied} applied, ${skipped} skipped`);
  process.exit(0);
}

migrate();
