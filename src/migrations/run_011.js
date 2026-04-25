'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const fs   = require('fs');
const path = require('path');
const { query } = require('../services/snowflakeService');

async function run() {
  const sql = fs.readFileSync(path.join(__dirname, '011_dsp_order_report.sql'), 'utf8');
  // Remove comment lines, then split on semicolons
  const cleaned = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
  const statements = cleaned
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0);

  for (const stmt of statements) {
    console.log('Running:', stmt.substring(0, 80) + '...');
    await query(stmt);
    console.log('  ✅ done');
  }
  console.log('Migration 011 complete.');
}

run().catch(e => { console.error(e); process.exit(1); }).finally(() => process.exit(0));
