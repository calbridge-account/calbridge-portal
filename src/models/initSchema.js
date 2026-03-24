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
    const firstLine = stmt.split('\n')[0].substring(0, 80);
    const isAlter = /^ALTER\s+TABLE/i.test(stmt.trim());

    try {
      await query(stmt);
      console.log(`✅ ${firstLine}`);
    } catch (err) {
      const msg = err.message || '';
      // For ALTER TABLE statements, ignore "already exists" / ambiguous column errors
      // (means the migration was already applied — idempotent)
      const isAlreadyApplied =
        msg.includes('already exists') ||
        msg.includes('duplicate') ||
        msg.includes('ambiguous column name') ||
        msg.includes('Column') && msg.includes('already exists');

      if (isAlter && isAlreadyApplied) {
        console.log(`⚠️  Skipped (already applied): ${firstLine}`);
      } else {
        console.error(`❌ Failed: ${firstLine}`);
        console.error(`   Error: ${msg}`);
        process.exit(1);
      }
    }
  }

  console.log('\n✅ Schema initialized successfully');
  process.exit(0);
}

initSchema();
