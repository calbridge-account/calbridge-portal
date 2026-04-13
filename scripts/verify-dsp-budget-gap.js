/**
 * verify-dsp-budget-gap.js
 * Final verification: show budget pacing spend vs total DSP spend MTD side by side.
 */
'use strict';
require('dotenv').config();
const { query } = require('../src/services/snowflakeService');

const BUDGET_ID = '04415d44-7f38-4c09-a95f-cf9031b3a077';
const CLIENT_ID = '7d88ea17-002b-4a02-97fc-bcab1292d57e';
const SCHEMA    = 'CALBRIDGE_PROD.APP';

async function main() {
  // 1. Total DSP spend MTD from adjusted_campaign_performance (advertising page)
  const advRows = await query(`
    SELECT SUM(adjusted_spend) AS total_adv_spend
    FROM ${SCHEMA}.ADJUSTED_CAMPAIGN_PERFORMANCE
    WHERE client_id = '${CLIENT_ID}'
      AND ad_type   = 'DSP'
      AND date >= DATE_TRUNC('month', CURRENT_DATE())
  `);
  const totalAdvSpend = Number(advRows[0]?.TOTAL_ADV_SPEND || advRows[0]?.total_adv_spend || 0);

  // 2. Mapped DSP spend MTD (budget pacing)
  const budgetRows = await query(`
    SELECT
      SUM(p.adjusted_spend)                                                           AS total_perf_spend,
      SUM(CASE WHEN m.campaign_id IS NOT NULL THEN p.adjusted_spend ELSE 0 END)       AS mapped_spend,
      SUM(CASE WHEN m.campaign_id IS NULL     THEN p.adjusted_spend ELSE 0 END)       AS unmapped_spend
    FROM ${SCHEMA}.ADJUSTED_CAMPAIGN_PERFORMANCE p
    LEFT JOIN ${SCHEMA}.BUDGET_CAMPAIGN_MAP m
      ON  m.campaign_id = p.campaign_id
      AND m.budget_id   = '${BUDGET_ID}'
    WHERE p.client_id = '${CLIENT_ID}'
      AND p.ad_type   = 'DSP'
      AND p.date >= DATE_TRUNC('month', CURRENT_DATE())
  `);
  const b = budgetRows[0];
  const totalPerf    = Number(b.TOTAL_PERF_SPEND || b.total_perf_spend || 0);
  const mappedSpend  = Number(b.MAPPED_SPEND     || b.mapped_spend     || 0);
  const unmappedSpend= Number(b.UNMAPPED_SPEND   || b.unmapped_spend   || 0);

  // 3. Distinct campaign IDs in budget map for this budget
  const mapRows = await query(`
    SELECT COUNT(*) AS map_count
    FROM ${SCHEMA}.BUDGET_CAMPAIGN_MAP
    WHERE budget_id = '${BUDGET_ID}'
      AND ad_type   = 'DSP'
  `);
  const mapCount = Number(mapRows[0]?.MAP_COUNT || mapRows[0]?.map_count || 0);

  console.log('=== CyberPower Budget Pacing Fix — Final Verification ===\n');
  console.log(`  Advertising page (all DSP MTD):   $${totalAdvSpend.toFixed(2)}`);
  console.log(`  Budget pacing (mapped DSP MTD):   $${mappedSpend.toFixed(2)}`);
  console.log(`  Unmapped DSP spend (gap):         $${unmappedSpend.toFixed(2)}`);
  console.log(`  DSP campaigns in budget map:      ${mapCount}`);
  console.log();

  const diff = Math.abs(totalAdvSpend - mappedSpend);
  if (unmappedSpend < 100) {
    console.log('  ✅ SUCCESS: Budget pacing spend ≈ Advertising page spend');
    console.log(`             Difference: $${diff.toFixed(2)} (< $100 threshold)`);
  } else {
    console.log('  ⚠️  WARNING: Gap still exists: $' + unmappedSpend.toFixed(2));
  }

  process.exit(0);
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
