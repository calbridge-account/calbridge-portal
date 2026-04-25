'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const fs    = require('fs');
const path  = require('path');
const { query } = require('../services/snowflakeService');

async function main() {
  const sql = fs.readFileSync(path.join(__dirname, '010_deduped_campaign_perf_view.sql'), 'utf8');
  console.log('Creating deduped_campaign_performance view...');
  await query(sql);
  console.log('✅ View created successfully.');
  process.exit(0);
}

main().catch(e => { console.error('❌', e.message || e); process.exit(1); });
