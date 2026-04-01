#!/usr/bin/env node
/**
 * Create ads tables in CALBRIDGE_PROD.APP
 * Temporarily overrides SNOWFLAKE_DATABASE and SNOWFLAKE_SCHEMA
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

// Override to point at CALBRIDGE_PROD.APP
process.env.SNOWFLAKE_DATABASE = 'CALBRIDGE_PROD';
process.env.SNOWFLAKE_SCHEMA = 'APP';

const { query } = require('../src/services/snowflakeService');
const path = require('path');
const fs = require('fs');

async function main() {
  console.log('=== Creating ads tables in CALBRIDGE_PROD.APP ===\n');

  const sqlPath = path.join(__dirname, '../src/models/migrate-ads-schema.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  // Split into individual CREATE TABLE statements
  const statements = sql
    .split(/(?=CREATE TABLE IF NOT EXISTS )/i)
    .map(s => s.trim())
    .filter(s => s.toUpperCase().startsWith('CREATE'))
    .map(s => {
      // Remove trailing semicolons and whitespace
      return s.replace(/;\s*$/, '').trim();
    })
    .filter(s => s.length > 20);

  console.log(`Found ${statements.length} CREATE TABLE statements\n`);

  let created = 0;
  let skipped = 0;
  for (const stmt of statements) {
    // Extract table name
    const match = stmt.match(/CREATE TABLE IF NOT EXISTS\s+(\S+)/i);
    const tableName = match ? match[1] : 'unknown';
    
    try {
      await query(stmt);
      console.log(`  ✓ ${tableName}`);
      created++;
    } catch (e) {
      if (e.message?.includes('already exists') || e.message?.includes('duplicate')) {
        console.log(`  ⚠ ${tableName} — already exists`);
        skipped++;
      } else {
        console.error(`  ✗ ${tableName}: ${e.message.substring(0, 100)}`);
      }
    }
  }

  console.log(`\nCreated: ${created}, Skipped/existing: ${skipped}`);
  
  // Also check if sb_gross_and_invalid_report, sp_gross_and_invalid_report, sd_gross_and_invalid_report exist
  // (they may be in the schema file or not)
  const extraTables = [
    'sp_gross_and_invalid_report',
    'sb_gross_and_invalid_report', 
    'sd_gross_and_invalid_report'
  ];
  
  for (const t of extraTables) {
    try {
      await query(`CREATE TABLE IF NOT EXISTS ${t} (
        client_id VARCHAR(36) NOT NULL,
        profile_id VARCHAR(36) NOT NULL,
        campaign_id VARCHAR(64) NOT NULL,
        date DATE NOT NULL,
        campaign_name VARCHAR(512),
        campaign_status VARCHAR(32),
        impressions NUMBER,
        gross_impressions NUMBER,
        invalid_impressions NUMBER,
        invalid_impression_rate FLOAT,
        clicks NUMBER,
        gross_click_throughs NUMBER,
        invalid_click_throughs NUMBER,
        invalid_click_through_rate FLOAT,
        synced_at TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
      )`);
      console.log(`  ✓ ${t}`);
    } catch (e) {
      if (e.message?.includes('already exists')) {
        console.log(`  ⚠ ${t} — already exists`);
      } else {
        console.error(`  ✗ ${t}: ${e.message.substring(0, 100)}`);
      }
    }
  }

  console.log('\n=== DONE ===');
  process.exit(0);
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
