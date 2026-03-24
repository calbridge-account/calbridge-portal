/**
 * Migration: add weekly_report_enabled to clients table
 * Run once: node src/models/migrate-weekly-report.js
 */
require('dotenv').config();
const { query } = require('../services/snowflakeService');

async function migrate() {
  console.log('[Migrate] Adding weekly_report_enabled to clients...');
  try {
    await query(`
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS weekly_report_enabled BOOLEAN DEFAULT TRUE
    `);
    console.log('[Migrate] ✅ weekly_report_enabled column added (or already exists)');
  } catch (err) {
    console.error('[Migrate] ❌ Failed:', err.message);
    process.exit(1);
  }
  process.exit(0);
}

migrate();
