/**
 * src/migrations/run.js
 *
 * Reads and executes migration SQL files via snowflakeService.
 *
 * Usage:
 *   node src/migrations/run.js                  # runs all pending migrations
 *   node src/migrations/run.js 001              # runs a specific migration file
 *
 * Each migration file is split into individual statements and executed serially.
 * CREATE SCHEMA and CREATE TABLE IF NOT EXISTS are idempotent — safe to re-run.
 *
 * Note: snowflakeService connects using SNOWFLAKE_DATABASE=CALBRIDGE_PROD and
 * SNOWFLAKE_SCHEMA=APP as defaults. All statements in migration SQL files use
 * fully-qualified three-part names (CALBRIDGE_PROD.<SCHEMA>.<TABLE>), so the
 * default schema doesn't matter for table creation.
 */

'use strict';

require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const { query } = require('../services/snowflakeService');

const MIGRATIONS_DIR = __dirname;

// ─── Statement Splitter ─────────────────────────────────────────────────────
// Snowflake doesn't support multi-statement execution in a single query() call.
// Strategy: strip all line comments first, then split on semicolons that are
// outside of parenthesized blocks and outside of string literals.
//
// This is intentionally simple — our migration files are well-structured SQL,
// not arbitrary user input. The key edge cases are:
//   1. Semicolons in -- comments (strip the whole line first)
//   2. Semicolons in column COMMENT strings (track string literals)
//   3. Semicolons in nested parens should NOT be separators (track depth)
function splitStatements(sql) {
  // Step 1: Strip line comments (-- to end of line)
  // Replace line comment content with whitespace to preserve line numbers for debugging
  const stripped = sql.replace(/--[^\n]*/g, '');

  // Step 2: Split on ';' outside parens and strings
  const statements = [];
  let current = '';
  let depth = 0;
  let inString = false;
  let stringChar = '';
  let inBlockComment = false;

  for (let i = 0; i < stripped.length; i++) {
    const ch  = stripped[i];
    const ch2 = stripped.substring(i, i + 2);

    // Block comments (/* ... */)
    if (!inString && ch2 === '/*') {
      inBlockComment = true;
      i++; // skip both chars
      continue;
    }
    if (inBlockComment) {
      if (ch2 === '*/') { inBlockComment = false; i++; }
      continue;
    }

    // String literals
    if (!inString && (ch === "'" || ch === '"')) {
      inString = true;
      stringChar = ch;
      current += ch;
      continue;
    }
    if (inString) {
      if (ch === stringChar) {
        // Escaped quote: '' or ""
        if (stripped[i + 1] === stringChar) {
          current += ch + stripped[i + 1];
          i++;
        } else {
          inString = false;
          current += ch;
        }
      } else {
        current += ch;
      }
      continue;
    }

    // Paren depth
    if (ch === '(') depth++;
    if (ch === ')') depth--;

    // Statement separator at top level
    if (ch === ';' && depth === 0 && !inString) {
      const stmt = current.trim();
      if (stmt.length > 5) statements.push(stmt);
      current = '';
      continue;
    }

    current += ch;
  }

  // Trailing statement
  const trailing = current.trim();
  if (trailing.length > 10) statements.push(trailing);

  return statements;
}

// ─── Execute one migration file ──────────────────────────────────────────────
async function runMigration(filePath) {
  const filename = path.basename(filePath);
  console.log(`\n📦 Running migration: ${filename}`);

  const sql = fs.readFileSync(filePath, 'utf8');
  const statements = splitStatements(sql);

  // Filter to only actionable statements (skip pure comments)
  const actionable = statements.filter(s => {
    const upper = s.toUpperCase().trimStart();
    return (
      upper.startsWith('CREATE') ||
      upper.startsWith('ALTER')  ||
      upper.startsWith('INSERT') ||
      upper.startsWith('MERGE')  ||
      upper.startsWith('UPDATE') ||
      upper.startsWith('DELETE') ||
      upper.startsWith('DROP')   ||
      upper.startsWith('USE')    ||
      upper.startsWith('GRANT')
    );
  });

  console.log(`   Found ${statements.length} statements, ${actionable.length} actionable`);

  let executed = 0;
  let skipped  = 0;
  let errors   = 0;

  for (const stmt of actionable) {
    const preview = stmt.replace(/\s+/g, ' ').substring(0, 80);
    try {
      await query(stmt);
      executed++;
      console.log(`   ✅ ${preview}`);
    } catch (err) {
      // Snowflake error codes:
      //   002002 = Object already exists (CREATE IF NOT EXISTS should prevent this, but just in case)
      //   090105 = Column already exists (ALTER TABLE ADD COLUMN IF NOT EXISTS)
      const msg = err.message || '';
      if (
        msg.includes('already exists') ||
        msg.includes('Object already exists') ||
        (err.code && ['002002', '090105'].includes(String(err.code)))
      ) {
        skipped++;
        console.log(`   ⚠️  Already exists (skipped): ${preview}`);
      } else {
        errors++;
        console.error(`   ❌ ERROR: ${msg}`);
        console.error(`      SQL: ${stmt.substring(0, 300)}`);
        // Don't abort on error — try to run remaining statements
        // (schema creation failures shouldn't block table creation)
      }
    }
  }

  return { executed, skipped, errors };
}

// ─── Verify tables were created ──────────────────────────────────────────────
async function verifyTables() {
  console.log('\n🔍 Verifying table creation...');

  const expectedTables = [
    // APP schema (core portal tables)
    ['CALBRIDGE_PROD', 'APP', 'CLIENTS'],
    ['CALBRIDGE_PROD', 'APP', 'BRANDS'],
    ['CALBRIDGE_PROD', 'APP', 'AMAZON_CONNECTIONS'],
    ['CALBRIDGE_PROD', 'APP', 'AD_PROFILES'],
    ['CALBRIDGE_PROD', 'APP', 'AD_CAMPAIGNS'],
    ['CALBRIDGE_PROD', 'APP', 'AD_PERFORMANCE'],
    ['CALBRIDGE_PROD', 'APP', 'ADS_REPORT_QUEUE'],
    ['CALBRIDGE_PROD', 'APP', 'INGESTION_LOG'],
    ['CALBRIDGE_PROD', 'APP', 'CONTRIBUTION_MARGIN'],
    ['CALBRIDGE_PROD', 'APP', 'PRODUCTS'],
    ['CALBRIDGE_PROD', 'APP', 'DSP_ADVERTISER'],
    ['CALBRIDGE_PROD', 'APP', 'SPEND_ADJUSTMENTS'],
    // RAW schema (per-report-type ingestion tables)
    ['CALBRIDGE_PROD', 'RAW', 'SP_CAMPAIGNS'],
    ['CALBRIDGE_PROD', 'RAW', 'SP_AD_GROUPS'],
    ['CALBRIDGE_PROD', 'RAW', 'SP_ADVERTISED_PRODUCT'],
    ['CALBRIDGE_PROD', 'RAW', 'SP_SEARCH_TERM'],
    ['CALBRIDGE_PROD', 'RAW', 'SP_TARGETING'],
    ['CALBRIDGE_PROD', 'RAW', 'SB_CAMPAIGNS'],
    ['CALBRIDGE_PROD', 'RAW', 'SB_TARGETING'],
    ['CALBRIDGE_PROD', 'RAW', 'SB_SEARCH_TERMS'],
    ['CALBRIDGE_PROD', 'RAW', 'SB_PLACEMENTS'],
    ['CALBRIDGE_PROD', 'RAW', 'SD_CAMPAIGNS'],
    ['CALBRIDGE_PROD', 'RAW', 'SD_AD_GROUPS'],
    ['CALBRIDGE_PROD', 'RAW', 'SD_TARGETING'],
    ['CALBRIDGE_PROD', 'RAW', 'SD_ADVERTISED_PRODUCT'],
    ['CALBRIDGE_PROD', 'RAW', 'DSP_HIERARCHY'],
    ['CALBRIDGE_PROD', 'RAW', 'DSP_AUDIENCE'],
    ['CALBRIDGE_PROD', 'RAW', 'DSP_PRODUCT'],
    ['CALBRIDGE_PROD', 'RAW', 'DSP_GEO'],
    ['CALBRIDGE_PROD', 'RAW', 'AD_CAMPAIGN'],
    // PIPELINE schema
    ['CALBRIDGE_PROD', 'PIPELINE', 'JOB_RUNS'],
    ['CALBRIDGE_PROD', 'PIPELINE', 'FRESHNESS'],
    ['CALBRIDGE_PROD', 'PIPELINE', 'QUALITY_LOG'],
    ['CALBRIDGE_PROD', 'PIPELINE', 'ANOMALY_LOG'],
    // ANALYTICS schema
    ['CALBRIDGE_PROD', 'ANALYTICS', 'KPI_DAILY'],
  ];

  let passed = 0;
  let failed = 0;

  for (const [db, schema, table] of expectedTables) {
    try {
      const rows = await query(`
        SELECT COUNT(*) AS CNT
        FROM ${db}.INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = ?
          AND TABLE_NAME   = ?
          AND TABLE_CATALOG = ?
      `, [schema, table, db]);

      const cnt = Number(rows?.[0]?.CNT ?? rows?.[0]?.cnt ?? 0);
      if (cnt > 0) {
        console.log(`   ✅ ${db}.${schema}.${table}`);
        passed++;
      } else {
        console.log(`   ❌ MISSING: ${db}.${schema}.${table}`);
        failed++;
      }
    } catch (err) {
      // INFORMATION_SCHEMA might not be accessible for new schemas
      // Fall back to SHOW TABLES
      try {
        await query(`SELECT * FROM ${db}.${schema}.${table} LIMIT 0`);
        console.log(`   ✅ ${db}.${schema}.${table} (via SELECT)`);
        passed++;
      } catch (e2) {
        console.log(`   ❌ MISSING: ${db}.${schema}.${table} — ${e2.message?.substring(0, 80)}`);
        failed++;
      }
    }
  }

  return { passed, failed };
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const targetMigration = process.argv[2]; // e.g. "001" or "001_create_schema"

  // Discover migration files
  const allFiles = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort(); // lexicographic = chronological given 001_, 002_ prefix

  const toRun = targetMigration
    ? allFiles.filter(f => f.startsWith(targetMigration))
    : allFiles;

  if (toRun.length === 0) {
    console.error(`No migration files found matching: ${targetMigration || '*.sql'}`);
    console.error(`Files in ${MIGRATIONS_DIR}:`, allFiles);
    process.exit(1);
  }

  console.log(`🏗️  Pipeline schema migration`);
  console.log(`   Database:  ${process.env.SNOWFLAKE_DATABASE}`);
  console.log(`   Account:   ${process.env.SNOWFLAKE_ACCOUNT}`);
  console.log(`   Warehouse: ${process.env.SNOWFLAKE_WAREHOUSE}`);
  console.log(`   Files:     ${toRun.join(', ')}`);

  let totalExecuted = 0;
  let totalSkipped  = 0;
  let totalErrors   = 0;

  for (const file of toRun) {
    const filePath = path.join(MIGRATIONS_DIR, file);
    const result = await runMigration(filePath);
    totalExecuted += result.executed;
    totalSkipped  += result.skipped;
    totalErrors   += result.errors;
  }

  console.log(`\n📊 Migration summary:`);
  console.log(`   Executed: ${totalExecuted}`);
  console.log(`   Skipped (already exist): ${totalSkipped}`);
  console.log(`   Errors:   ${totalErrors}`);

  // Verify all expected tables exist
  const { passed, failed } = await verifyTables();
  console.log(`\n📊 Verification: ${passed} tables confirmed, ${failed} missing`);

  if (failed > 0) {
    console.error('\n⚠️  Some tables were not created. Review errors above.');
    process.exit(1);
  } else {
    console.log('\n✅ All tables verified. Schema is ready.\n');
  }

  // Exit cleanly — snowflake-sdk has a keep-alive interval
  process.exit(0);
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
