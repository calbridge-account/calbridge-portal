// Compare exactly what budget-pacing route sees vs what performance tab sees
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { query } = require('../src/services/snowflakeService');

async function main() {
  const clientId = '7d88ea17-002b-4a02-97fc-bcab1292d57e';
  const now = new Date();
  const dayOfMonth = now.getUTCDate();
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const monthStart = now.toISOString().substring(0, 7) + '-01';

  console.log(`Today: ${now.toISOString().substring(0,10)} | Day ${dayOfMonth}/${daysInMonth} | monthStart: ${monthStart}\n`);

  // 1. Budget pacing route — uses adjusted_campaign_performance directly
  const pacing = await query(`
    SELECT
      r.campaign_id,
      COALESCE(c.campaign_name, MAX(r.campaign_name)) AS campaign_name,
      r.ad_type,
      COALESCE(SUM(r.adjusted_spend), 0) AS mtd_spend
    FROM CALBRIDGE_PROD.APP.adjusted_campaign_performance r
    LEFT JOIN CALBRIDGE_PROD.APP.ad_campaigns c
      ON c.client_id = r.client_id AND c.campaign_id = r.campaign_id
    WHERE r.client_id = ? AND r.date >= ?
    GROUP BY r.campaign_id, r.ad_type, c.campaign_name
    ORDER BY mtd_spend DESC
  `, [clientId, monthStart]);

  const pacingTotal = pacing.reduce((s, r) => s + Number(r.MTD_SPEND || 0), 0);
  console.log(`Budget pacing total (ACP direct): $${pacingTotal.toFixed(2)} across ${pacing.length} campaigns`);

  // 2. Performance tab — uses mart_advertising_daily
  const mart = await query(`
    SELECT ad_type, SUM(spend) AS spend, SUM(sales) AS sales
    FROM CALBRIDGE_PROD.MARTS_MARTS.mart_advertising_daily
    WHERE client_id = ? AND date >= ?
    GROUP BY ad_type ORDER BY spend DESC
  `, [clientId, monthStart]);

  const martTotal = mart.reduce((s, r) => s + Number(r.SPEND || 0), 0);
  console.log(`\nPerformance tab total (mart): $${martTotal.toFixed(2)}`);
  mart.forEach(r => console.log(`  ${r.AD_TYPE}: $${Number(r.SPEND||0).toFixed(2)} spend | $${Number(r.SALES||0).toFixed(2)} sales`));

  // 3. ACP by ad_type for same period
  const acp = await query(`
    SELECT ad_type, SUM(adjusted_spend) AS spend, SUM(sales) AS sales
    FROM CALBRIDGE_PROD.APP.adjusted_campaign_performance
    WHERE client_id = ? AND date >= ?
    GROUP BY ad_type ORDER BY spend DESC
  `, [clientId, monthStart]);

  const acpTotal = acp.reduce((s, r) => s + Number(r.SPEND || 0), 0);
  console.log(`\nACP direct total: $${acpTotal.toFixed(2)}`);
  acp.forEach(r => console.log(`  ${r.AD_TYPE}: $${Number(r.SPEND||0).toFixed(2)} spend | $${Number(r.SALES||0).toFixed(2)} sales`));

  // 4. What dates are in ACP that aren't in mart?
  const missingDates = await query(`
    SELECT p.date, SUM(p.adjusted_spend) AS spend
    FROM CALBRIDGE_PROD.APP.adjusted_campaign_performance p
    WHERE p.client_id = ? AND p.date >= ?
      AND NOT EXISTS (
        SELECT 1 FROM CALBRIDGE_PROD.MARTS_MARTS.mart_advertising_daily m
        WHERE m.client_id = p.client_id AND m.date = p.date
      )
    GROUP BY p.date ORDER BY p.date
  `, [clientId, monthStart]);
  console.log(`\nDates in ACP missing from mart: ${missingDates.length}`);
  missingDates.forEach(r => console.log(`  ${String(r.DATE).substring(0,10)}: $${Number(r.SPEND||0).toFixed(2)}`));

  // 5. Max date in each
  const maxDates = await query(`
    SELECT
      (SELECT MAX(date) FROM CALBRIDGE_PROD.APP.adjusted_campaign_performance WHERE client_id = ?) AS acp_max,
      (SELECT MAX(date) FROM CALBRIDGE_PROD.MARTS_MARTS.mart_advertising_daily WHERE client_id = ?) AS mart_max
  `, [clientId, clientId]);
  console.log(`\nACP max date:  ${String(maxDates[0].ACP_MAX).substring(0,10)}`);
  console.log(`Mart max date: ${String(maxDates[0].MART_MAX).substring(0,10)}`);

  // 6. What does the budget tracker UI actually show?
  // Check CLIENT_BUDGETS and sum what the /budgets route would compute
  const budgets = await query(`
    SELECT budget_id, name, total_amount, period_start, period_end
    FROM CALBRIDGE_PROD.APP.CLIENT_BUDGETS WHERE client_id = ?
  `, [clientId]);
  console.log(`\nActive budgets: ${budgets.length}`);
  budgets.forEach(b => console.log(`  ${b.NAME}: $${Number(b.TOTAL_AMOUNT||0).toFixed(0)} | ${String(b.PERIOD_START).substring(0,10)} → ${String(b.PERIOD_END).substring(0,10)}`));

  // Total spend from budget_campaign_map campaigns in ACP
  const budgetSpend = await query(`
    SELECT SUM(p.adjusted_spend) AS spend
    FROM CALBRIDGE_PROD.APP.adjusted_campaign_performance p
    WHERE p.client_id = ?
      AND p.date >= ?
      AND p.campaign_id IN (
        SELECT campaign_id FROM CALBRIDGE_PROD.APP.BUDGET_CAMPAIGN_MAP WHERE client_id = ?
      )
  `, [clientId, monthStart, clientId]);
  console.log(`\nSpend from budget-mapped campaigns only: $${Number(budgetSpend[0]?.SPEND||0).toFixed(2)}`);
  console.log(`Spend from ALL campaigns (ACP): $${acpTotal.toFixed(2)}`);
  console.log(`Diff (unmapped): $${(acpTotal - Number(budgetSpend[0]?.SPEND||0)).toFixed(2)}`);

  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
