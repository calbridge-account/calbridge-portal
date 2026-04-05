#!/usr/bin/env node
'use strict';

require('dotenv').config();
const { query } = require('./src/services/snowflakeService');

async function main() {
  console.log('ENV: SNOWFLAKE_DATABASE =', process.env.SNOWFLAKE_DATABASE);
  console.log('ENV: SNOWFLAKE_SCHEMA =', process.env.SNOWFLAKE_SCHEMA);

  // Check current context
  const ctx = await query(`SELECT CURRENT_DATABASE(), CURRENT_SCHEMA(), CURRENT_WAREHOUSE()`);
  console.log('\nCurrent context:', JSON.stringify(ctx[0], null, 2));

  // List all schemas in CALBRIDGE_PROD
  console.log('\n--- Schemas in CALBRIDGE_PROD ---');
  const schemas = await query(`SHOW SCHEMAS IN DATABASE CALBRIDGE_PROD`);
  console.log(schemas.map(r => r.name || r.NAME).join(', '));

  // List tables in CALBRIDGE_PROD.APP
  console.log('\n--- Tables in CALBRIDGE_PROD.APP ---');
  const tables = await query(`
    SELECT table_name, row_count
    FROM calbridge_prod.information_schema.tables
    WHERE table_schema = 'APP'
    ORDER BY table_name
  `);
  if (tables.length === 0) {
    console.log('(no tables found in APP schema)');
  } else {
    for (const t of tables) {
      console.log(`  ${t.TABLE_NAME || t.table_name}: ${t.ROW_COUNT || t.row_count} rows`);
    }
  }

  // Check SANDBOX tables
  console.log('\n--- Tables in CALBRIDGE.SANDBOX ---');
  try {
    const sandboxTables = await query(`
      SELECT table_name, row_count
      FROM calbridge.information_schema.tables
      WHERE table_schema = 'SANDBOX'
      ORDER BY table_name
    `);
    if (sandboxTables.length === 0) {
      console.log('(no tables found in CALBRIDGE.SANDBOX)');
    } else {
      for (const t of sandboxTables) {
        console.log(`  ${t.TABLE_NAME || t.table_name}: ${t.ROW_COUNT || t.row_count} rows`);
      }
    }
  } catch (err) {
    console.log('Error accessing CALBRIDGE.SANDBOX:', err.message);
  }

  // Raw dup check with explicit USE
  console.log('\n--- Duplicate column check (CALBRIDGE_PROD.APP) ---');
  const dups = await query(`
    SELECT table_name, column_name, COUNT(*) as cnt
    FROM calbridge_prod.information_schema.columns
    WHERE table_schema = 'APP'
    GROUP BY table_name, column_name
    HAVING COUNT(*) > 1
    ORDER BY table_name, column_name
  `);
  if (dups.length === 0) {
    console.log('No duplicate columns found.');
  } else {
    console.log(`Found ${dups.length} duplicate column entries:`);
    for (const d of dups) {
      console.log(`  ${d.TABLE_NAME || d.table_name}.${d.COLUMN_NAME || d.column_name}: ${d.CNT || d.cnt}`);
    }
  }

  // Also check using SHOW COLUMNS approach
  console.log('\n--- All APP table columns (sample: first 100) ---');
  const cols = await query(`
    SELECT table_name, column_name, ordinal_position
    FROM calbridge_prod.information_schema.columns
    WHERE table_schema = 'APP'
    ORDER BY table_name, ordinal_position
    LIMIT 100
  `);
  if (cols.length === 0) {
    console.log('(no columns found — APP schema may be empty)');
  } else {
    const grouped = {};
    for (const c of cols) {
      const t = c.TABLE_NAME || c.table_name;
      if (!grouped[t]) grouped[t] = [];
      grouped[t].push(c.COLUMN_NAME || c.column_name);
    }
    for (const [t, colList] of Object.entries(grouped)) {
      console.log(`  ${t}: ${colList.join(', ')}`);
    }
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
