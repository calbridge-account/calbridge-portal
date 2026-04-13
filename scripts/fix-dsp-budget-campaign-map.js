/**
 * fix-dsp-budget-campaign-map.js
 *
 * Part 1 — Immediate data fix:
 *   1. Find all unmapped DSP campaign_ids (order_ids) with spend MTD for CyberPower
 *   2. INSERT missing rows into budget_campaign_map
 *   3. Verify the gap closes
 *
 * Run: node scripts/fix-dsp-budget-campaign-map.js
 */
'use strict';

require('dotenv').config();
const { query } = require('../src/services/snowflakeService');

const BUDGET_ID  = '04415d44-7f38-4c09-a95f-cf9031b3a077';
const CLIENT_ID  = '7d88ea17-002b-4a02-97fc-bcab1292d57e';
const SCHEMA     = 'CALBRIDGE_PROD.APP';

async function main() {
  console.log('=== CyberPower DSP Budget Campaign Map Fix ===\n');

  // ── Step 0: Show current state ──────────────────────────────────────────────
  console.log('Step 0: Current mapped vs unmapped DSP spend MTD...');
  const beforeRows = await query(`
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
  const b = beforeRows[0];
  console.log('  Total DSP spend MTD:    $' + Number(b.TOTAL_PERF_SPEND   || b.total_perf_spend   || 0).toFixed(2));
  console.log('  Mapped spend:           $' + Number(b.MAPPED_SPEND       || b.mapped_spend       || 0).toFixed(2));
  console.log('  Unmapped spend (gap):   $' + Number(b.UNMAPPED_SPEND     || b.unmapped_spend     || 0).toFixed(2));
  console.log();

  // ── Step 1: Find all unmapped DSP campaign IDs with spend MTD ───────────────
  console.log('Step 1: Finding unmapped DSP campaign IDs with spend this month...');
  const unmappedRows = await query(`
    SELECT
      p.campaign_id,
      MAX(p.campaign_name) AS campaign_name,
      SUM(p.adjusted_spend) AS spend
    FROM ${SCHEMA}.ADJUSTED_CAMPAIGN_PERFORMANCE p
    WHERE p.client_id = '${CLIENT_ID}'
      AND p.ad_type   = 'DSP'
      AND p.date >= DATE_TRUNC('month', CURRENT_DATE())
      AND p.campaign_id NOT IN (
        SELECT campaign_id
        FROM ${SCHEMA}.BUDGET_CAMPAIGN_MAP
        WHERE budget_id = '${BUDGET_ID}'
      )
    GROUP BY p.campaign_id
    HAVING SUM(p.adjusted_spend) > 0
    ORDER BY spend DESC
  `);

  if (!unmappedRows.length) {
    console.log('  No unmapped DSP campaigns found! Gap may already be closed.\n');
  } else {
    console.log(`  Found ${unmappedRows.length} unmapped DSP campaign(s):\n`);
    for (const row of unmappedRows) {
      const cid  = row.CAMPAIGN_ID   || row.campaign_id;
      const name = row.CAMPAIGN_NAME || row.campaign_name;
      const sp   = Number(row.SPEND  || 0).toFixed(2);
      console.log(`    campaign_id=${cid}  name="${name}"  spend=$${sp}`);
    }
    console.log();

    // ── Step 2: For each unmapped campaign, look for existing mapped name ──────
    console.log('Step 2: Looking for name matches in budget_campaign_map...');
    const mappedRows = await query(`
      SELECT campaign_id, campaign_name
      FROM ${SCHEMA}.BUDGET_CAMPAIGN_MAP
      WHERE budget_id = '${BUDGET_ID}'
        AND ad_type   = 'DSP'
    `);
    const mappedByName = {};
    for (const m of mappedRows) {
      const name = (m.CAMPAIGN_NAME || m.campaign_name || '').trim().toLowerCase();
      if (name) mappedByName[name] = m.CAMPAIGN_ID || m.campaign_id;
    }

    // ── Step 3: INSERT missing rows ────────────────────────────────────────────
    console.log('Step 3: Inserting missing rows into budget_campaign_map...');
    let inserted = 0;
    for (const row of unmappedRows) {
      const cid  = row.CAMPAIGN_ID   || row.campaign_id;
      const name = row.CAMPAIGN_NAME || row.campaign_name || '';
      const nameKey = name.trim().toLowerCase();

      const matchedMapId = mappedByName[nameKey];
      if (matchedMapId) {
        console.log(`  Name match: "${name}" → budget map has ${matchedMapId}, adding ${cid} as alias`);
      } else {
        console.log(`  No name match for "${name}" (${cid}) — adding as new DSP entry`);
      }

      // Idempotent insert: only insert if not already in map
      const check = await query(`
        SELECT COUNT(*) AS cnt
        FROM ${SCHEMA}.BUDGET_CAMPAIGN_MAP
        WHERE budget_id   = '${BUDGET_ID}'
          AND campaign_id = '${cid}'
      `);
      const cnt = Number(check[0]?.CNT || check[0]?.cnt || 0);
      if (cnt > 0) {
        console.log(`    → Already exists, skipping (${cid})`);
        continue;
      }

      await query(`
        INSERT INTO ${SCHEMA}.BUDGET_CAMPAIGN_MAP
          (budget_id, client_id, campaign_id, campaign_name, ad_type)
        VALUES ('${BUDGET_ID}', '${CLIENT_ID}', '${cid}', ?, 'DSP')
      `, [name]);
      console.log(`    ✅ Inserted: ${cid} ("${name}")`);
      inserted++;
    }
    console.log(`\n  Inserted ${inserted} new row(s).\n`);
  }

  // ── Step 4: Verify gap closes ───────────────────────────────────────────────
  console.log('Step 4: Verifying gap is closed...');
  const afterRows = await query(`
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
  const a = afterRows[0];
  const totalAfter    = Number(a.TOTAL_PERF_SPEND || a.total_perf_spend || 0);
  const mappedAfter   = Number(a.MAPPED_SPEND     || a.mapped_spend     || 0);
  const unmappedAfter = Number(a.UNMAPPED_SPEND   || a.unmapped_spend   || 0);

  console.log('\n=== RESULT ===');
  console.log('  Total DSP spend MTD:    $' + totalAfter.toFixed(2));
  console.log('  Mapped spend:           $' + mappedAfter.toFixed(2));
  console.log('  Unmapped spend (gap):   $' + unmappedAfter.toFixed(2));

  if (unmappedAfter < 100) {
    console.log('\n  ✅ SUCCESS: unmapped spend is < $100 — gap is closed!');
  } else {
    console.log('\n  ⚠️  WARNING: unmapped spend is still $' + unmappedAfter.toFixed(2) + ' — investigate remaining IDs');
  }

  process.exit(0);
}

main().catch(err => {
  console.error('FATAL:', err.message || err);
  process.exit(1);
});
