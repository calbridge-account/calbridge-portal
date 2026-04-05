#!/usr/bin/env node
'use strict';

require('dotenv').config();
const { query } = require('../src/services/snowflakeService');

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Parse column names from a CREATE TABLE DDL string.
 * Looks for lines inside the CREATE TABLE (...) block that start with a quoted
 * or unquoted identifier followed by a type keyword.
 */
function parseColumnNames(ddl) {
  // Strip everything before the first opening paren of the CREATE TABLE
  const start = ddl.indexOf('(');
  const end   = ddl.lastIndexOf(')');
  if (start === -1 || end === -1) return [];

  const body = ddl.slice(start + 1, end);

  // Split into lines, strip comments, collect identifier names
  const names = [];
  for (const rawLine of body.split('\n')) {
    const line = rawLine.trim().replace(/--.*$/, '').trim();
    if (!line) continue;

    // Match: "COLUMN_NAME" TYPE... or COLUMN_NAME TYPE...
    const m = line.match(/^"?([A-Z0-9_]+)"?\s+\w/i);
    if (m) {
      names.push(m[1].toUpperCase());
    }
  }
  return names;
}

function hasDuplicateColumns(ddl) {
  const names = parseColumnNames(ddl);
  const seen = new Set();
  for (const n of names) {
    if (seen.has(n)) return true;
    seen.add(n);
  }
  return false;
}

async function getDDL(fullyQualifiedTable) {
  const rows = await query(`SELECT GET_DDL('TABLE', '${fullyQualifiedTable}')`);
  return Object.values(rows[0])[0];
}

async function getRowCount(fullyQualifiedTable) {
  const rows = await query(`SELECT COUNT(*) AS CNT FROM ${fullyQualifiedTable}`);
  return Number(rows[0].CNT ?? rows[0].cnt ?? 0);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== Calbridge Duplicate Column Fixer ===\n');

  // 1. Get all BASE TABLES in CALBRIDGE_PROD.APP
  console.log('📋 Fetching table list from CALBRIDGE_PROD.APP...');
  const prodTables = await query(`
    SELECT TABLE_NAME
    FROM CALBRIDGE_PROD.INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = 'APP'
      AND TABLE_TYPE   = 'BASE TABLE'
    ORDER BY TABLE_NAME
  `);
  const prodTableNames = prodTables.map(r => r.TABLE_NAME || r.table_name);
  console.log(`  Found ${prodTableNames.length} base tables: ${prodTableNames.join(', ')}\n`);

  // 2. Get all BASE TABLES in CALBRIDGE.SANDBOX (for safety check)
  console.log('📋 Fetching table list from CALBRIDGE.SANDBOX...');
  const sandboxTables = await query(`
    SELECT TABLE_NAME
    FROM CALBRIDGE.INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = 'SANDBOX'
      AND TABLE_TYPE   = 'BASE TABLE'
    ORDER BY TABLE_NAME
  `);
  const sandboxTableSet = new Set(sandboxTables.map(r => r.TABLE_NAME || r.table_name));
  console.log(`  Found ${sandboxTableSet.size} base tables in SANDBOX\n`);

  // 3. For each PROD table, check for duplicate columns
  const results = {
    skipped_no_sandbox: [],
    no_duplicates: [],
    fixed: [],
    errors: []
  };

  for (const tableName of prodTableNames) {
    const prodFQN    = `CALBRIDGE_PROD.APP.${tableName}`;
    const sandboxFQN = `CALBRIDGE.SANDBOX.${tableName}`;

    // Skip tables not in SANDBOX
    if (!sandboxTableSet.has(tableName)) {
      console.log(`⏭️  ${tableName} — skipping (not in CALBRIDGE.SANDBOX)`);
      results.skipped_no_sandbox.push(tableName);
      continue;
    }

    // Check for duplicate columns via GET_DDL
    let prodDDL;
    try {
      prodDDL = await getDDL(prodFQN);
    } catch (err) {
      console.log(`❌  ${tableName} — failed to get DDL: ${err.message}`);
      results.errors.push({ table: tableName, error: err.message });
      continue;
    }

    if (!hasDuplicateColumns(prodDDL)) {
      console.log(`✅  ${tableName} — no duplicates detected`);
      results.no_duplicates.push(tableName);
      continue;
    }

    console.log(`\n🔧  ${tableName} — DUPLICATES DETECTED, rebuilding...`);

    try {
      // a. Get correct DDL from SANDBOX
      const sandboxDDL = await getDDL(sandboxFQN);

      // b. Replace CALBRIDGE.SANDBOX. with CALBRIDGE_PROD.APP. (case-insensitive)
      const fixedDDL = sandboxDDL
        .replace(/CALBRIDGE\.SANDBOX\./gi, 'CALBRIDGE_PROD.APP.')
        // Also handle quoted forms
        .replace(/"CALBRIDGE"\."SANDBOX"\./gi, '"CALBRIDGE_PROD"."APP".');

      console.log(`     Fixed DDL preview:\n${fixedDDL.slice(0, 300)}...`);

      // Verify fixed DDL has no duplicates itself
      if (hasDuplicateColumns(fixedDDL)) {
        throw new Error('SANDBOX DDL also has duplicates — aborting this table');
      }

      // c. Get pre-rebuild row count from SANDBOX (what we expect to copy)
      const sandboxCount = await getRowCount(sandboxFQN);
      console.log(`     SANDBOX row count: ${sandboxCount}`);

      // d. DROP prod table
      await query(`DROP TABLE IF EXISTS ${prodFQN}`);
      console.log(`     Dropped ${prodFQN}`);

      // e. Execute CREATE TABLE with fixed DDL
      await query(fixedDDL);
      console.log(`     Created ${prodFQN}`);

      // f. INSERT ... SELECT from SANDBOX
      await query(`INSERT INTO ${prodFQN} SELECT * FROM ${sandboxFQN}`);
      console.log(`     Data copied from ${sandboxFQN}`);

      // Special case: SESSIONS table — truncate after rebuild (ephemeral data)
      if (tableName.toUpperCase() === 'SESSIONS') {
        await query(`TRUNCATE TABLE ${prodFQN}`);
        console.log(`     SESSIONS table truncated (ephemeral data)`);
      }

      const prodCountAfter = await getRowCount(prodFQN);
      console.log(`     Final PROD row count: ${prodCountAfter}`);

      results.fixed.push({
        table: tableName,
        sandboxRows: sandboxCount,
        prodRows: prodCountAfter,
        match: sandboxCount === prodCountAfter || tableName.toUpperCase() === 'SESSIONS'
      });

    } catch (err) {
      console.log(`     ❌ FAILED: ${err.message}`);
      results.errors.push({ table: tableName, error: err.message });
    }
  }

  // 4. Spot-check row counts for key tables
  const SPOT_CHECK = ['SP_CAMPAIGN_REPORT', 'SB_CAMPAIGN_REPORT', 'SD_CAMPAIGN_REPORT', 'SP_SEARCH_TERM_REPORT'];
  console.log('\n\n=== Spot-Check Row Counts ===');
  const spotResults = [];
  for (const t of SPOT_CHECK) {
    if (!sandboxTableSet.has(t)) {
      console.log(`  ${t}: not in SANDBOX — skipped`);
      continue;
    }
    try {
      const [sandboxCnt, prodCnt] = await Promise.all([
        getRowCount(`CALBRIDGE.SANDBOX.${t}`),
        getRowCount(`CALBRIDGE_PROD.APP.${t}`)
      ]);
      const match = sandboxCnt === prodCnt ? '✅' : '⚠️ MISMATCH';
      console.log(`  ${t}: SANDBOX=${sandboxCnt} | PROD.APP=${prodCnt} ${match}`);
      spotResults.push({ table: t, sandbox: sandboxCnt, prod: prodCnt, match: sandboxCnt === prodCnt });
    } catch (err) {
      console.log(`  ${t}: ERROR — ${err.message}`);
    }
  }

  // 5. Full summary
  console.log('\n\n=== SUMMARY ===');
  console.log(`Tables scanned:            ${prodTableNames.length}`);
  console.log(`No duplicates (clean):     ${results.no_duplicates.length} → ${results.no_duplicates.join(', ') || 'none'}`);
  console.log(`Skipped (not in SANDBOX):  ${results.skipped_no_sandbox.length} → ${results.skipped_no_sandbox.join(', ') || 'none'}`);
  console.log(`Fixed:                     ${results.fixed.length}`);
  for (const f of results.fixed) {
    const status = f.match ? '✅' : '⚠️  ROW COUNT MISMATCH';
    console.log(`  ${f.table}: ${f.sandboxRows} → ${f.prodRows} ${status}`);
  }
  console.log(`Errors:                    ${results.errors.length}`);
  for (const e of results.errors) {
    console.log(`  ${e.table}: ${e.error}`);
  }

  if (results.errors.length > 0) {
    process.exit(1);
  }

  console.log('\n✅ Done!');
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
