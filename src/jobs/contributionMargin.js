/**
 * Contribution Margin Calculator
 *
 * Formula: CM = Revenue - Ad Spend - FBA Fees - COGS - Other Costs
 * CM% = (CM / Revenue) * 100
 *
 * Reads from: sales, ad_performance, products
 * Writes to: contribution_margin
 */
require('dotenv').config();
const { query } = require('../services/snowflakeService');
const { runJob } = require('./ingestionRunner');

/**
 * Calculate and upsert contribution margin for a client
 * Looks back N days, recalculates each day for accuracy
 */
async function calculateContributionMargin(clientId, daysBack = 30) {
  return runJob(clientId, 'all', 'contribution_margin', async () => {
    const rows = await query(`
      WITH sales_data AS (
        SELECT
          client_id,
          asin,
          order_date AS calc_date,
          SUM(ordered_revenue) AS revenue,
          SUM(units_ordered) AS units
        FROM sales
        WHERE client_id = ?
          AND order_date >= DATEADD(day, -?, CURRENT_DATE)
        GROUP BY client_id, asin, order_date
      ),
      ad_data AS (
        SELECT
          p.client_id,
          -- Join ad spend to ASIN via campaign (best effort — campaigns may cover multiple ASINs)
          -- Using total daily spend distributed here; will refine when keyword-level data is available
          ap.report_date AS calc_date,
          SUM(ap.spend) AS total_ad_spend
        FROM ad_performance ap
        JOIN ad_campaigns p ON ap.client_id = p.client_id AND ap.campaign_id = p.campaign_id
        WHERE ap.client_id = ?
          AND ap.report_date >= DATEADD(day, -?, CURRENT_DATE)
        GROUP BY p.client_id, ap.report_date
      ),
      product_costs AS (
        SELECT client_id, asin, fba_fees, cogs
        FROM products
        WHERE client_id = ?
      )
      SELECT
        s.client_id,
        s.asin,
        s.calc_date,
        s.revenue,
        COALESCE(a.total_ad_spend, 0) AS ad_spend,
        COALESCE(p.fba_fees, 0) AS fba_fees,
        COALESCE(p.cogs, 0) AS cogs,
        s.units
      FROM sales_data s
      LEFT JOIN ad_data a ON s.client_id = a.client_id AND s.calc_date = a.calc_date
      LEFT JOIN product_costs p ON s.client_id = p.client_id AND s.asin = p.asin
    `, [clientId, daysBack, clientId, daysBack, clientId]);

    if (!rows.length) return { recordsWritten: 0 };

    let written = 0;
    for (const row of rows) {
      const revenue = Number(row.REVENUE || 0);
      const adSpend = Number(row.AD_SPEND || 0);
      const fbaFees = Number(row.FBA_FEES || 0);
      const cogs = Number(row.COGS || 0);
      const cm = revenue - adSpend - fbaFees - cogs;
      const cmPercent = revenue > 0 ? (cm / revenue) * 100 : null;

      await query(`
        MERGE INTO contribution_margin t
        USING (SELECT ? AS client_id, ? AS asin, ? AS calc_date) s
        ON t.client_id = s.client_id AND t.asin = s.asin AND t.calc_date = s.calc_date
        WHEN MATCHED THEN UPDATE SET
          revenue = ?, ad_spend = ?, fba_fees = ?, cogs = ?,
          contribution_margin = ?, cm_percent = ?,
          calculated_at = CURRENT_TIMESTAMP
        WHEN NOT MATCHED THEN INSERT
          (client_id, asin, calc_date, revenue, ad_spend, fba_fees, cogs,
           contribution_margin, cm_percent, calculated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, [
        row.CLIENT_ID, row.ASIN, row.CALC_DATE,
        revenue, adSpend, fbaFees, cogs, cm, cmPercent,
        row.CLIENT_ID, row.ASIN, row.CALC_DATE,
        revenue, adSpend, fbaFees, cogs, cm, cmPercent
      ]);
      written++;
    }

    return { recordsWritten: written };
  });
}

/**
 * Get top/bottom performers by contribution margin for a client
 */
async function getTopPerformers(clientId, { days = 30, limit = 10, order = 'DESC' } = {}) {
  return query(`
    SELECT
      asin,
      SUM(revenue) AS total_revenue,
      SUM(ad_spend) AS total_ad_spend,
      SUM(fba_fees) AS total_fba_fees,
      SUM(cogs) AS total_cogs,
      SUM(contribution_margin) AS total_cm,
      AVG(cm_percent) AS avg_cm_percent,
      COUNT(*) AS days_with_data
    FROM contribution_margin
    WHERE client_id = ?
      AND calc_date >= DATEADD(day, -?, CURRENT_DATE)
    GROUP BY asin
    ORDER BY total_cm ${order === 'ASC' ? 'ASC' : 'DESC'}
    LIMIT ?
  `, [clientId, days, limit]);
}

/**
 * Get CM trend for a specific ASIN
 */
async function getAsinTrend(clientId, asin, days = 90) {
  return query(`
    SELECT
      calc_date,
      revenue,
      ad_spend,
      fba_fees,
      cogs,
      contribution_margin,
      cm_percent
    FROM contribution_margin
    WHERE client_id = ?
      AND asin = ?
      AND calc_date >= DATEADD(day, -?, CURRENT_DATE)
    ORDER BY calc_date ASC
  `, [clientId, asin, days]);
}

module.exports = { calculateContributionMargin, getTopPerformers, getAsinTrend };
