/**
 * Contribution Margin Calculator
 *
 * Formula:
 *   CM1 = Revenue - COGS
 *   CM2 = CM1 - FBA Fees - Referral Fees
 *   CM3 = CM2 - Ad Spend   (= "true profit")
 *   CM%  = (CM3 / Revenue) * 100
 *
 * Ad spend attribution (updated — ASIN-level direct):
 *   Ad spend is attributed directly to the advertised ASIN from the
 *   ad_performance.advertised_asin column populated by the ingestion job.
 *   Rows with advertised_asin = 'UNATTRIBUTED' (brand awareness / no product
 *   targeting) are excluded from per-ASIN attribution — they appear in the
 *   total business TACOS but are NOT spread across ASINs.
 *
 * Reads from: sales, ad_performance, products
 * Writes to:  contribution_margin
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
        -- Daily revenue + units per ASIN
        SELECT
          client_id,
          asin,
          order_date AS calc_date,
          SUM(ordered_revenue) AS revenue,
          SUM(units_ordered)   AS units
        FROM sales
        WHERE client_id = ?
          AND order_date >= DATEADD(day, -?, CURRENT_DATE)
        GROUP BY client_id, asin, order_date
      ),
      asin_ad_spend AS (
        -- Direct ASIN-level ad spend from advertised_asin column.
        -- Only include rows where advertised_asin is a real ASIN (not UNATTRIBUTED).
        -- This is the corrected attribution — no proportional spreading.
        SELECT
          client_id,
          report_date AS calc_date,
          UPPER(TRIM(advertised_asin)) AS asin,
          SUM(spend) AS asin_spend
        FROM ad_performance
        WHERE client_id = ?
          AND report_date >= DATEADD(day, -?, CURRENT_DATE)
          AND advertised_asin IS NOT NULL
          AND advertised_asin != 'UNATTRIBUTED'
          AND TRIM(advertised_asin) != ''
        GROUP BY client_id, report_date, UPPER(TRIM(advertised_asin))
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
        s.units,
        -- Direct ASIN-level attribution — zero if no ads ran for this ASIN
        COALESCE(aas.asin_spend, 0) AS ad_spend,
        COALESCE(p.fba_fees, 0)     AS fba_fees,
        COALESCE(p.cogs, 0)         AS cogs
      FROM sales_data s
      LEFT JOIN asin_ad_spend aas
        ON s.client_id = aas.client_id
        AND s.calc_date = aas.calc_date
        AND UPPER(TRIM(s.asin)) = aas.asin
      LEFT JOIN product_costs p
        ON s.client_id = p.client_id AND s.asin = p.asin
    `, [clientId, daysBack, clientId, daysBack, clientId]);

    if (!rows.length) return { recordsWritten: 0 };

    // Build all computed values in JS, then do a single bulk MERGE
    const computed = rows.map(row => {
      const revenue   = Number(row.REVENUE   || 0);
      const adSpend   = Number(row.AD_SPEND  || 0);
      const fbaFees   = Number(row.FBA_FEES  || 0);
      const cogs      = Number(row.COGS      || 0);
      const units     = Number(row.UNITS     || 0);
      const cm        = revenue - adSpend - fbaFees - cogs;
      const cmPct     = revenue > 0 ? (cm / revenue) * 100 : 0;
      const unitCm    = units > 0 ? cm / units : 0;
      const unitCmPct = units > 0 && revenue > 0 ? (cm / units) / (revenue / units) * 100 : 0;
      const cid  = String(row.CLIENT_ID).replace(/'/g, "''");
      const asin = String(row.ASIN).replace(/'/g, "''");
      // CALC_DATE may come back as a JS Date object — convert to YYYY-MM-DD safely
      const rawDate = row.CALC_DATE?.value || row.CALC_DATE;
      const date = rawDate instanceof Date
        ? rawDate.toISOString().substring(0, 10)
        : String(rawDate).substring(0, 10);
      return `('${cid}','${asin}','${date}',${revenue.toFixed(4)},${adSpend.toFixed(4)},${fbaFees.toFixed(4)},${cogs.toFixed(4)},${cm.toFixed(4)},${cmPct.toFixed(4)},${units},${unitCm.toFixed(4)},${unitCmPct.toFixed(4)})`;
    });

    // Batch MERGE in chunks of 200
    const CHUNK = 200;
    let written = 0;
    for (let i = 0; i < computed.length; i += CHUNK) {
      const vals = computed.slice(i, i + CHUNK).join(',');
      await query(`
        MERGE INTO contribution_margin t
        USING (
          SELECT v.col1 AS client_id, v.col2 AS asin, v.col3::DATE AS calc_date,
                 v.col4 AS revenue, v.col5 AS ad_spend, v.col6 AS fba_fees, v.col7 AS cogs,
                 v.col8 AS contribution_margin, v.col9 AS cm_percent,
                 v.col10 AS units, v.col11 AS unit_cm, v.col12 AS unit_cm_percent
          FROM VALUES ${vals}
            AS v(col1,col2,col3,col4,col5,col6,col7,col8,col9,col10,col11,col12)
        ) s ON t.client_id = s.client_id AND t.asin = s.asin AND t.calc_date = s.calc_date
        WHEN MATCHED THEN UPDATE SET
          revenue=s.revenue, ad_spend=s.ad_spend, fba_fees=s.fba_fees, cogs=s.cogs,
          contribution_margin=s.contribution_margin, cm_percent=s.cm_percent,
          units=s.units, unit_cm=s.unit_cm, unit_cm_percent=s.unit_cm_percent,
          calculated_at=CURRENT_TIMESTAMP
        WHEN NOT MATCHED THEN INSERT
          (client_id,asin,calc_date,revenue,ad_spend,fba_fees,cogs,
           contribution_margin,cm_percent,units,unit_cm,unit_cm_percent,calculated_at)
          VALUES (s.client_id,s.asin,s.calc_date,s.revenue,s.ad_spend,s.fba_fees,s.cogs,
           s.contribution_margin,s.cm_percent,s.units,s.unit_cm,s.unit_cm_percent,CURRENT_TIMESTAMP)
      `);
      written += computed.slice(i, i + CHUNK).length;
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
      cm.asin,
      MAX(p.title) AS product_title,
      MAX(p.sku)   AS sku,
      SUM(cm.revenue)             AS total_revenue,
      SUM(cm.ad_spend)            AS total_ad_spend,
      SUM(cm.fba_fees)            AS total_fba_fees,
      SUM(cm.cogs)                AS total_cogs,
      SUM(cm.contribution_margin) AS total_cm,
      SUM(cm.units)               AS total_units,
      AVG(cm.cm_percent)          AS avg_cm_percent,
      AVG(cm.unit_cm)             AS avg_unit_cm,
      AVG(cm.unit_cm_percent)     AS avg_unit_cm_percent,
      COUNT(*)                    AS days_with_data
    FROM contribution_margin cm
    LEFT JOIN products p
      ON cm.client_id = p.client_id AND cm.asin = p.asin
    WHERE cm.client_id = ?
      AND cm.calc_date >= DATEADD(day, -?, CURRENT_DATE)
    GROUP BY cm.asin
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
