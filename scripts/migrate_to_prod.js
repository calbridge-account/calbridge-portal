#!/usr/bin/env node
/**
 * Migration script: CALBRIDGE.SANDBOX → CALBRIDGE_PROD
 * 
 * Run with: node scripts/migrate_to_prod.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { query } = require('../src/services/snowflakeService');

async function getTableSchema(db, schema, table) {
  const rows = await query(`
    SELECT column_name, data_type, character_maximum_length, numeric_precision, numeric_scale, is_nullable, column_default
    FROM ${db}.INFORMATION_SCHEMA.COLUMNS
    WHERE table_schema = '${schema}' AND table_name = '${table}'
    ORDER BY ordinal_position
  `);
  return rows;
}

function snowflakeTypeDDL(col) {
  const dt = col.DATA_TYPE || col.data_type;
  const nullable = (col.IS_NULLABLE || col.is_nullable) === 'YES' ? '' : ' NOT NULL';
  const def = col.COLUMN_DEFAULT || col.column_default;
  const defClause = def ? ` DEFAULT ${def}` : '';
  
  let typeStr = dt;
  const maxLen = col.CHARACTER_MAXIMUM_LENGTH || col.character_maximum_length;
  const numPrec = col.NUMERIC_PRECISION || col.numeric_precision;
  const numScale = col.NUMERIC_SCALE || col.numeric_scale;
  
  if (maxLen && dt.includes('TEXT')) {
    typeStr = `VARCHAR(${maxLen})`;
  } else if (dt === 'TEXT') {
    typeStr = 'TEXT';
  } else if (dt === 'NUMBER' && numPrec !== null && numScale !== null) {
    typeStr = `NUMBER(${numPrec}, ${numScale})`;
  } else if (dt === 'FIXED') {
    typeStr = numScale !== null && numScale > 0 ? `NUMBER(${numPrec || 38}, ${numScale})` : `NUMBER`;
  } else if (dt === 'REAL') {
    typeStr = 'FLOAT';
  }
  
  return `  ${(col.COLUMN_NAME || col.column_name)} ${typeStr}${defClause}${nullable}`;
}

async function main() {
  console.log('=== CALBRIDGE SANDBOX → CALBRIDGE_PROD MIGRATION ===\n');

  // ── Step 1: Get SANDBOX schemas ────────────────────────────────────────────
  const sandboxTables = [
    'CLIENTS', 'ADMIN_USERS', 'AMAZON_CONNECTIONS', 'SESSIONS', 'BRANDS',
    'AD_PROFILES', 'SPEND_ADJUSTMENTS', 'ADMIN_CONFIG', 'ADS_REPORT_QUEUE',
    'INGESTION_LOG', 'AD_CAMPAIGNS', 'DSP_ADVERTISER', 'DSP_ADVERTISER_CLIENT_MAP',
    'CONTRIBUTION_MARGIN', 'PRODUCTS'
  ];

  const schemas = {};
  console.log('── Step 1: Reading SANDBOX schemas ──');
  for (const table of sandboxTables) {
    try {
      const cols = await getTableSchema('CALBRIDGE', 'SANDBOX', table);
      schemas[table] = cols;
      console.log(`  ✓ ${table}: ${cols.length} columns`);
    } catch (e) {
      console.log(`  ✗ ${table}: ${e.message}`);
      schemas[table] = null;
    }
  }

  // ── Step 2: Check PROD existing tables ────────────────────────────────────
  console.log('\n── Step 2: Checking existing PROD tables ──');
  const prodChecks = [
    { db: 'CALBRIDGE_PROD', schema: 'APP', table: 'CLIENTS' },
    { db: 'CALBRIDGE_PROD', schema: 'APP', table: 'CLIENT_COGS' },
    { db: 'CALBRIDGE_PROD', schema: 'OPS', table: 'INGESTION_LOG' },
    { db: 'CALBRIDGE_PROD', schema: 'OPS', table: 'REPORT_QUEUE' },
  ];

  const prodSchemas = {};
  for (const { db, schema, table } of prodChecks) {
    try {
      const cols = await getTableSchema(db, schema, table);
      prodSchemas[`${schema}.${table}`] = cols;
      console.log(`  ✓ CALBRIDGE_PROD.${schema}.${table}: ${cols.length} columns`);
      cols.forEach(c => console.log(`      ${(c.COLUMN_NAME||c.column_name)} ${(c.DATA_TYPE||c.data_type)}`));
    } catch (e) {
      console.log(`  ✗ CALBRIDGE_PROD.${schema}.${table}: ${e.message}`);
      prodSchemas[`${schema}.${table}`] = null;
    }
  }

  // Print all sandbox schemas for reference
  console.log('\n── SANDBOX Schema Details ──');
  for (const [table, cols] of Object.entries(schemas)) {
    if (!cols) { console.log(`  ${table}: (failed)`); continue; }
    console.log(`\n  ${table}:`);
    cols.forEach(c => console.log(`    ${(c.COLUMN_NAME||c.column_name)} ${(c.DATA_TYPE||c.data_type)} ${(c.CHARACTER_MAXIMUM_LENGTH||c.character_maximum_length) ? '('+c.CHARACTER_MAXIMUM_LENGTH+')' : ''} ${(c.IS_NULLABLE||c.is_nullable)==='YES'?'NULL':'NOT NULL'} ${(c.COLUMN_DEFAULT||c.column_default)?'DEFAULT '+(c.COLUMN_DEFAULT||c.column_default):''}`));
  }

  // ── Get view DDLs ──────────────────────────────────────────────────────────
  console.log('\n── Step 1b: Reading SANDBOX view DDLs ──');
  const views = ['CAMPAIGN_PERFORMANCE', 'ADJUSTED_CAMPAIGN_PERFORMANCE', 'ADJUSTED_DSP_CAMPAIGN_REPORT'];
  const viewDDLs = {};
  for (const v of views) {
    try {
      const rows = await query(`SELECT GET_DDL('VIEW', 'CALBRIDGE.SANDBOX.${v}') AS ddl`);
      viewDDLs[v] = rows[0]?.DDL || rows[0]?.ddl;
      console.log(`  ✓ ${v}: got DDL`);
    } catch (e) {
      console.log(`  ✗ ${v}: ${e.message}`);
      viewDDLs[v] = null;
    }
  }
  
  // Print view DDLs
  for (const [v, ddl] of Object.entries(viewDDLs)) {
    console.log(`\n=== VIEW: ${v} ===`);
    console.log(ddl || '(none)');
  }

  // ── Also check ADJUSTED_AD_CAMPAIGN view in PROD.RAW ──────────────────────
  try {
    const rows = await query(`SELECT GET_DDL('VIEW', 'CALBRIDGE_PROD.RAW.ADJUSTED_AD_CAMPAIGN') AS ddl`);
    console.log('\n=== VIEW: CALBRIDGE_PROD.RAW.ADJUSTED_AD_CAMPAIGN ===');
    console.log(rows[0]?.DDL || rows[0]?.ddl);
  } catch (e) {
    console.log(`\n✗ CALBRIDGE_PROD.RAW.ADJUSTED_AD_CAMPAIGN: ${e.message}`);
  }

  // ── Check what tables exist in CALBRIDGE_PROD.RAW ──────────────────────────
  try {
    const rows = await query(`SELECT table_name FROM CALBRIDGE_PROD.INFORMATION_SCHEMA.TABLES WHERE table_schema = 'RAW' ORDER BY table_name`);
    console.log('\n── Tables in CALBRIDGE_PROD.RAW ──');
    rows.forEach(r => console.log(`  ${r.TABLE_NAME || r.table_name}`));
  } catch (e) {
    console.log(`✗ Could not list RAW tables: ${e.message}`);
  }

  // ── Check what tables exist in CALBRIDGE_PROD.APP ──────────────────────────
  try {
    const rows = await query(`SELECT table_name, table_type FROM CALBRIDGE_PROD.INFORMATION_SCHEMA.TABLES WHERE table_schema = 'APP' ORDER BY table_name`);
    console.log('\n── Tables/Views in CALBRIDGE_PROD.APP ──');
    rows.forEach(r => console.log(`  ${(r.TABLE_NAME||r.table_name)} (${(r.TABLE_TYPE||r.table_type)})`));
  } catch (e) {
    console.log(`✗ Could not list APP tables: ${e.message}`);
  }

  // ── Check what tables exist in CALBRIDGE_PROD.OPS ──────────────────────────
  try {
    const rows = await query(`SELECT table_name FROM CALBRIDGE_PROD.INFORMATION_SCHEMA.TABLES WHERE table_schema = 'OPS' ORDER BY table_name`);
    console.log('\n── Tables in CALBRIDGE_PROD.OPS ──');
    rows.forEach(r => console.log(`  ${r.TABLE_NAME || r.table_name}`));
  } catch (e) {
    console.log(`✗ Could not list OPS tables: ${e.message}`);
  }

  console.log('\n=== SCHEMA DISCOVERY COMPLETE ===');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
