#!/usr/bin/env node
'use strict';

require('dotenv').config();
const { query } = require('./src/services/snowflakeService');
const fs = require('fs');
const path = require('path');

async function main() {
  console.log('🔍 Scanning CALBRIDGE_PROD.APP for tables with duplicate column names...\n');

  // Step 1: Find tables with duplicate columns
  const dupRows = await query(`
    SELECT table_name, column_name, COUNT(*) as cnt
    FROM calbridge_prod.information_schema.columns
    WHERE table_schema = 'APP'
    GROUP BY table_name, column_name
    HAVING COUNT(*) > 1
    ORDER BY table_name, column_name
  `);

  if (dupRows.length === 0) {
    console.log('✅ No tables with duplicate columns found. Nothing to fix.');
    process.exit(0);
  }

  // Group by table
  const tableMap = {};
  for (const row of dupRows) {
    const t = row.TABLE_NAME || row.table_name;
    const c = row.COLUMN_NAME || row.column_name;
    if (!tableMap[t]) tableMap[t] = [];
    tableMap[t].push(c);
  }

  const affectedTables = Object.keys(tableMap);
  console.log(`⚠️  Found ${affectedTables.length} table(s) with duplicate columns:`);
  for (const [t, cols] of Object.entries(tableMap)) {
    console.log(`   - ${t}: duplicated columns: ${[...new Set(cols)].join(', ')}`);
  }
  console.log('');

  // Check which tables exist in CALBRIDGE.SANDBOX
  const sandboxTables = await query(`
    SELECT table_name
    FROM calbridge.information_schema.tables
    WHERE table_schema = 'SANDBOX'
  `);
  const sandboxSet = new Set(sandboxTables.map(r => (r.TABLE_NAME || r.table_name).toUpperCase()));

  const summary = [];

  for (const tableName of affectedTables) {
    const upperTable = tableName.toUpperCase();
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`📋 Fixing table: CALBRIDGE_PROD.APP.${upperTable}`);

    let ddl;

    if (sandboxSet.has(upperTable)) {
      // Get DDL from CALBRIDGE.SANDBOX
      console.log(`   Source: CALBRIDGE.SANDBOX.${upperTable}`);
      try {
        const ddlRows = await query(`SELECT GET_DDL('TABLE', 'CALBRIDGE.SANDBOX.${upperTable}') as ddl`);
        const rawDdl = ddlRows[0].DDL || ddlRows[0].ddl;
        // Replace schema references
        ddl = rawDdl
          .replace(/CALBRIDGE\.SANDBOX\./gi, 'CALBRIDGE_PROD.APP.')
          .replace(/calbridge\.sandbox\./gi, 'CALBRIDGE_PROD.APP.');
        console.log(`   ✓ Got DDL from SANDBOX (${ddl.length} chars)`);
      } catch (err) {
        console.error(`   ❌ Failed to get DDL from SANDBOX: ${err.message}`);
        console.log(`   Falling back to migrations folder...`);
        ddl = getDdlFromMigrations(upperTable);
      }
    } else {
      console.log(`   ⚠️  Table not found in CALBRIDGE.SANDBOX — checking migrations folder...`);
      ddl = getDdlFromMigrations(upperTable);
    }

    if (!ddl) {
      console.error(`   ❌ Could not find DDL for ${upperTable}. Skipping.`);
      summary.push({ table: upperTable, status: 'SKIPPED', reason: 'No DDL source found', rowsCopied: 0 });
      continue;
    }

    // Get row count in CALBRIDGE_PROD.APP before drop
    let prodRowsBefore = 0;
    try {
      const cntRows = await query(`SELECT COUNT(*) as cnt FROM CALBRIDGE_PROD.APP.${upperTable}`);
      prodRowsBefore = Number(cntRows[0].CNT || cntRows[0].cnt || 0);
      console.log(`   Rows in PROD before fix: ${prodRowsBefore}`);
    } catch (err) {
      console.log(`   Could not count PROD rows (table may be broken): ${err.message}`);
    }

    // Get source row count
    let sourceRows = 0;
    let hasSource = false;
    if (sandboxSet.has(upperTable)) {
      try {
        const srcCnt = await query(`SELECT COUNT(*) as cnt FROM CALBRIDGE.SANDBOX.${upperTable}`);
        sourceRows = Number(srcCnt[0].CNT || srcCnt[0].cnt || 0);
        hasSource = true;
        console.log(`   Rows in SANDBOX source: ${sourceRows}`);
      } catch (err) {
        console.log(`   Could not count SANDBOX rows: ${err.message}`);
      }
    }

    // Step a-b: Already have DDL with replaced schema reference
    // Step c: DROP TABLE
    console.log(`   🗑️  Dropping CALBRIDGE_PROD.APP.${upperTable}...`);
    await query(`DROP TABLE IF EXISTS CALBRIDGE_PROD.APP.${upperTable}`);
    console.log(`   ✓ Dropped.`);

    // Step d: CREATE TABLE
    console.log(`   🏗️  Creating CALBRIDGE_PROD.APP.${upperTable}...`);
    await query(ddl);
    console.log(`   ✓ Created.`);

    // Step e: Copy data if source exists
    let rowsCopied = 0;
    if (hasSource && sandboxSet.has(upperTable)) {
      console.log(`   📥 Copying data from CALBRIDGE.SANDBOX.${upperTable}...`);
      try {
        await query(`INSERT INTO CALBRIDGE_PROD.APP.${upperTable} SELECT * FROM CALBRIDGE.SANDBOX.${upperTable}`);
        // Verify
        const verifyCnt = await query(`SELECT COUNT(*) as cnt FROM CALBRIDGE_PROD.APP.${upperTable}`);
        rowsCopied = Number(verifyCnt[0].CNT || verifyCnt[0].cnt || 0);
        console.log(`   ✓ Copied ${rowsCopied} rows.`);
        if (rowsCopied !== sourceRows) {
          console.warn(`   ⚠️  Row count mismatch! Source: ${sourceRows}, Copied: ${rowsCopied}`);
        } else {
          console.log(`   ✅ Row counts match (${rowsCopied}).`);
        }
      } catch (err) {
        console.error(`   ❌ Failed to copy data: ${err.message}`);
        summary.push({ table: upperTable, status: 'PARTIALLY_FIXED', reason: `Recreated but data copy failed: ${err.message}`, rowsCopied: 0 });
        continue;
      }
    } else {
      console.log(`   ℹ️  No SANDBOX source — table recreated empty (migrations-based DDL).`);
    }

    summary.push({
      table: upperTable,
      status: 'FIXED',
      prodRowsBefore,
      sourceRows,
      rowsCopied,
      reason: ''
    });
  }

  // Summary
  console.log(`\n${'═'.repeat(50)}`);
  console.log('📊 SUMMARY\n');
  console.log(`Tables affected: ${affectedTables.length}`);
  console.log(`Tables fixed: ${summary.filter(s => s.status === 'FIXED').length}`);
  console.log(`Tables skipped/failed: ${summary.filter(s => s.status !== 'FIXED').length}`);
  console.log('');
  console.log('Details:');
  for (const s of summary) {
    if (s.status === 'FIXED') {
      console.log(`  ✅ ${s.table}: ${s.rowsCopied} rows copied (source: ${s.sourceRows})`);
    } else if (s.status === 'PARTIALLY_FIXED') {
      console.log(`  ⚠️  ${s.table}: Table recreated but data not copied — ${s.reason}`);
    } else {
      console.log(`  ❌ ${s.table}: SKIPPED — ${s.reason}`);
    }
  }
  console.log('');
}

function getDdlFromMigrations(tableName) {
  const migrationsDir = path.join(__dirname, 'src', 'migrations');
  const sqlFiles = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();

  for (const file of sqlFiles) {
    const content = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    // Look for CREATE TABLE statements matching this table name
    // Pattern: CREATE TABLE IF NOT EXISTS or CREATE TABLE followed by (schema.)TABLENAME
    const regex = new RegExp(
      `(CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?\\S*${tableName}\\s*\\([^;]+;)`,
      'si'
    );
    const match = content.match(regex);
    if (match) {
      let ddl = match[1].trim();
      // Normalize schema to CALBRIDGE_PROD.APP
      ddl = ddl
        .replace(/CALBRIDGE\.[A-Z_]+\./gi, 'CALBRIDGE_PROD.APP.')
        .replace(/calbridge\.[a-z_]+\./gi, 'CALBRIDGE_PROD.APP.');
      // Strip IF NOT EXISTS since we already dropped it
      ddl = ddl.replace(/IF\s+NOT\s+EXISTS\s+/gi, '');
      console.log(`   ✓ Found DDL in migration file: ${file}`);
      return ddl;
    }
  }
  return null;
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
