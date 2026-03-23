/**
 * Initialize Snowflake schema — run once per environment (SANDBOX / PROD)
 * Usage: node src/models/initSchema.js
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { query } = require('../services/snowflakeService');

async function initSchema() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');

  // Remove comment lines, split on semicolons, filter empty statements
  const stripped = sql.replace(/--[^\n]*/g, '').replace(/\n{3,}/g, '\n\n');
  const statements = stripped
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 10);

  console.log(`Running ${statements.length} schema statements...`);

  for (const stmt of statements) {
    try {
      await query(stmt);
      // Print first line of each statement for progress
      console.log(`✅ ${stmt.split('\n')[0].substring(0, 80)}`);
    } catch (err) {
      console.error(`❌ Failed: ${stmt.split('\n')[0]}`);
      console.error(`   Error: ${err.message}`);
      process.exit(1);
    }
  }

  console.log('\n✅ Schema initialized successfully');
  process.exit(0);
}

initSchema();
