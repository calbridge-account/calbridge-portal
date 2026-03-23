const { query } = require('./snowflakeService');
const { getConnectionStatus } = require('./amazonAuthService');

/**
 * Build a rich text context string from Snowflake data for the AI chat assistant.
 * @param {string} clientId
 * @returns {string} context string for the LLM system prompt
 */
async function buildChatContext(clientId) {
  const lines = [];

  // 1. Connection status
  try {
    const connections = await getConnectionStatus(clientId);
    lines.push('=== Amazon Connection Status ===');
    for (const [key, val] of Object.entries(connections)) {
      lines.push(`${val.label}: ${val.connected ? 'Connected' : 'Not connected'}${val.connectedAt ? ` (since ${val.connectedAt})` : ''}`);
    }
    lines.push('');
  } catch (e) {
    lines.push('Connection status: unavailable');
    lines.push('');
  }

  // 2. CM summary — last 30 days
  try {
    const cmRows = await query(`
      SELECT
        SUM(revenue)              AS total_revenue,
        SUM(ad_spend)             AS total_ad_spend,
        SUM(fba_fees)             AS total_fba_fees,
        SUM(cogs_total)           AS total_cogs,
        SUM(cm3)                  AS total_cm3,
        AVG(acos)                 AS avg_acos,
        AVG(cm3_pct)              AS avg_cm3_pct,
        COUNT(DISTINCT asin)      AS asin_count
      FROM cm_daily
      WHERE client_id = ?
        AND report_date >= DATEADD(day, -30, CURRENT_DATE)
    `, [clientId]);

    if (cmRows && cmRows.length > 0 && cmRows[0].TOTAL_REVENUE != null) {
      const r = cmRows[0];
      lines.push('=== Contribution Margin Summary (Last 30 Days) ===');
      lines.push(`Total Revenue: $${fmt(r.TOTAL_REVENUE)}`);
      lines.push(`Total Ad Spend: $${fmt(r.TOTAL_AD_SPEND)}`);
      lines.push(`Total FBA Fees: $${fmt(r.TOTAL_FBA_FEES)}`);
      lines.push(`Total COGS: $${fmt(r.TOTAL_COGS)}`);
      lines.push(`Total CM3 (Contribution Margin): $${fmt(r.TOTAL_CM3)}`);
      lines.push(`Average ACOS: ${pct(r.AVG_ACOS)}`);
      lines.push(`Average CM3%: ${pct(r.AVG_CM3_PCT)}`);
      lines.push(`ASINs tracked: ${r.ASIN_COUNT}`);
      lines.push('');
    }
  } catch (e) {
    // Table may not exist yet — skip silently
  }

  // 3. Top 5 ASINs by CM
  try {
    const topRows = await query(`
      SELECT
        asin,
        SUM(revenue)  AS revenue,
        SUM(ad_spend) AS ad_spend,
        SUM(cm3)      AS cm3,
        AVG(cm3_pct)  AS cm3_pct
      FROM cm_daily
      WHERE client_id = ?
        AND report_date >= DATEADD(day, -30, CURRENT_DATE)
      GROUP BY asin
      ORDER BY SUM(cm3) DESC
      LIMIT 5
    `, [clientId]);

    if (topRows && topRows.length > 0) {
      lines.push('=== Top 5 ASINs by Contribution Margin (Last 30 Days) ===');
      topRows.forEach((r, i) => {
        lines.push(`${i + 1}. ${r.ASIN} — Revenue: $${fmt(r.REVENUE)}, Ad Spend: $${fmt(r.AD_SPEND)}, CM3: $${fmt(r.CM3)} (${pct(r.CM3_PCT)})`);
      });
      lines.push('');
    }
  } catch (e) { /* skip */ }

  // 4. Bottom 3 ASINs by CM
  try {
    const botRows = await query(`
      SELECT
        asin,
        SUM(revenue)  AS revenue,
        SUM(ad_spend) AS ad_spend,
        SUM(cm3)      AS cm3,
        AVG(cm3_pct)  AS cm3_pct
      FROM cm_daily
      WHERE client_id = ?
        AND report_date >= DATEADD(day, -30, CURRENT_DATE)
      GROUP BY asin
      ORDER BY SUM(cm3) ASC
      LIMIT 3
    `, [clientId]);

    if (botRows && botRows.length > 0) {
      lines.push('=== Bottom 3 ASINs by Contribution Margin (Last 30 Days) ===');
      botRows.forEach((r, i) => {
        lines.push(`${i + 1}. ${r.ASIN} — Revenue: $${fmt(r.REVENUE)}, Ad Spend: $${fmt(r.AD_SPEND)}, CM3: $${fmt(r.CM3)} (${pct(r.CM3_PCT)})`);
      });
      lines.push('');
    }
  } catch (e) { /* skip */ }

  // 5. Ad performance summary
  try {
    const adRows = await query(`
      SELECT
        SUM(impressions)                                                       AS impressions,
        SUM(clicks)                                                            AS clicks,
        SUM(spend)                                                             AS spend,
        SUM(sales)                                                             AS sales,
        SUM(orders)                                                            AS orders,
        CASE WHEN SUM(sales) > 0 THEN SUM(spend) / SUM(sales) ELSE NULL END   AS acos,
        CASE WHEN SUM(spend) > 0 THEN SUM(sales) / SUM(spend) ELSE NULL END   AS roas
      FROM ad_performance
      WHERE client_id = ?
        AND report_date >= DATEADD(day, -30, CURRENT_DATE)
    `, [clientId]);

    if (adRows && adRows.length > 0 && adRows[0].SPEND != null) {
      const r = adRows[0];
      lines.push('=== Ad Performance Summary (Last 30 Days) ===');
      lines.push(`Impressions: ${num(r.IMPRESSIONS)}`);
      lines.push(`Clicks: ${num(r.CLICKS)}`);
      lines.push(`Ad Spend: $${fmt(r.SPEND)}`);
      lines.push(`Ad Sales: $${fmt(r.SALES)}`);
      lines.push(`Orders: ${num(r.ORDERS)}`);
      lines.push(`ACOS: ${pct(r.ACOS)}`);
      lines.push(`ROAS: ${r.ROAS != null ? Number(r.ROAS).toFixed(2) + 'x' : 'N/A'}`);
      lines.push('');
    }
  } catch (e) { /* skip */ }

  // 6. Recent alerts from decision engine
  try {
    const alertRows = await query(`
      SELECT insight_type, severity, title, message, asin
      FROM decision_insights
      WHERE client_id = ?
        AND created_at >= DATEADD(day, -7, CURRENT_TIMESTAMP)
      ORDER BY severity DESC, created_at DESC
      LIMIT 5
    `, [clientId]);

    if (alertRows && alertRows.length > 0) {
      lines.push('=== Recent Alerts (Last 7 Days) ===');
      alertRows.forEach(r => {
        const asinTag = r.ASIN ? ` [${r.ASIN}]` : '';
        lines.push(`[${r.SEVERITY?.toUpperCase()}]${asinTag} ${r.TITLE}: ${r.MESSAGE}`);
      });
      lines.push('');
    }
  } catch (e) { /* skip */ }

  if (lines.length === 0) {
    return 'No performance data is available yet. The client may not have connected their Amazon account or data has not been synced.';
  }

  return lines.join('\n');
}

function fmt(val) {
  if (val == null) return 'N/A';
  return Number(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function pct(val) {
  if (val == null) return 'N/A';
  return (Number(val) * 100).toFixed(1) + '%';
}

function num(val) {
  if (val == null) return 'N/A';
  return Number(val).toLocaleString('en-US');
}

module.exports = { buildChatContext };
