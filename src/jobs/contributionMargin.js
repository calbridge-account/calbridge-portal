/**
 * Contribution Margin Calculator
 *
 * Corrected CM model (confirmed with Abe):
 *
 *   CM1 = Net cash received from Amazon per ASIN (excludes advertising)
 *     - Seller accounts: ordered_revenue - FBA fees - referral fees
 *     - Vendor accounts: shipped_cogs (what Amazon paid the vendor)
 *       NOTE: Vendor CM1 excludes deductions (damages, co-op, chargebacks).
 *       This is Option A — full remittance data not yet available.
 *       vendor_cm1_is_estimate = true until remittance data is integrated.
 *
 *   CM2 = CM1 - (units_sold × cogs_per_unit)
 *     - "Is this product worth selling?" — profitability before advertising
 *     - If COGS not uploaded, CM2 = null (never show $0)
 *
 *   CM3 = CM2 - ad_spend  (direct ASIN attribution only)
 *     - "Is advertising this product profitable?" — the decision metric
 *     - If CM3 < 0, the brand is paying to lose money
 *     - NEVER use proportional ad spend splitting — only direct advertised_asin attribution
 *     - Rows with advertised_asin = 'UNATTRIBUTED' are excluded from per-ASIN attribution
 *
 * OLD (WRONG) model for reference:
 *   contribution_margin = revenue - adSpend - fbaFees - cogs  (all mixed, no CM1/CM2 split)
 *
 * Reads from: sales, ad_performance, products, amazon_connections
 * Writes to:  contribution_margin
 */
require('dotenv').config();
const { query } = require('../services/snowflakeService');
const { runJob } = require('./ingestionRunner');

/**
 * Calculate and upsert contribution margin for a client.
 * Handles both seller and vendor accounts with correct formulas.
 * Looks back N days, recalculates each day for accuracy.
 *
 * @param {string} clientId
 * @param {number} daysBack
 */
async function calculateContributionMargin(clientId, daysBack = 30) {
  return runJob(clientId, 'all', 'contribution_margin', async () => {

    // Determine connection types for this client
    // We need to know if this client has seller, vendor, or both accounts
    let connectionTypes = [];
    try {
      const connRows = await query(
        `SELECT DISTINCT connection_type FROM amazon_connections WHERE client_id = ?`,
        [clientId]
      );
      connectionTypes = connRows.map(r => String(r.CONNECTION_TYPE).toLowerCase());
    } catch {
      // Fallback: assume seller (safe default)
      connectionTypes = ['seller'];
    }

    const isVendor = connectionTypes.includes('vendor');
    const isSeller = connectionTypes.includes('seller') || (!isVendor);

    let allRows = [];

    // ----------------------------------------------------------------
    // SELLER path: CM1 = ordered_revenue - FBA fees - referral fees
    // ----------------------------------------------------------------
    if (isSeller) {
      const sellerRows = await query(`
        WITH sales_data AS (
          SELECT
            s.client_id,
            s.asin,
            s.order_date             AS calc_date,
            SUM(s.ordered_revenue)   AS revenue,
            SUM(s.units_ordered)     AS units
          FROM vendor_purchase_orders s
          WHERE s.client_id = ?
            AND s.connection_type = 'seller'
            AND s.order_date >= DATEADD(day, -?, CURRENT_DATE)
          GROUP BY s.client_id, s.asin, s.order_date
        ),
        asin_ad_spend AS (
          -- Direct ASIN-level ad spend from advertised_asin column.
          -- Only rows with a real ASIN — UNATTRIBUTED excluded from per-ASIN.
          SELECT
            client_id,
            report_date              AS calc_date,
            UPPER(TRIM(advertised_asin)) AS asin,
            SUM(spend)               AS asin_spend
          FROM ad_performance
          WHERE client_id = ?
            AND report_date >= DATEADD(day, -?, CURRENT_DATE)
            AND advertised_asin IS NOT NULL
            AND advertised_asin != 'UNATTRIBUTED'
            AND TRIM(advertised_asin) != ''
          GROUP BY client_id, report_date, UPPER(TRIM(advertised_asin))
        ),
        product_costs AS (
          SELECT
            client_id,
            asin,
            COALESCE(fba_fees, 0)      AS fba_fees,
            COALESCE(referral_fees, 0) AS referral_fees,
            cogs                        -- NULL if not uploaded — intentional
          FROM products
          WHERE client_id = ?
            AND connection_type = 'seller'
        )
        SELECT
          s.client_id,
          s.asin,
          s.calc_date,
          'seller'                               AS account_type,
          s.revenue,
          s.units,
          COALESCE(aas.asin_spend, 0)            AS ad_spend,
          COALESCE(p.fba_fees, 0)                AS fba_fees,
          COALESCE(p.referral_fees, 0)           AS referral_fees,
          p.cogs                                  -- may be NULL — that's correct
        FROM sales_data s
        LEFT JOIN asin_ad_spend aas
          ON s.client_id = aas.client_id
          AND s.calc_date = aas.calc_date
          AND UPPER(TRIM(s.asin)) = aas.asin
        LEFT JOIN product_costs p
          ON s.client_id = p.client_id
          AND UPPER(TRIM(s.asin)) = UPPER(TRIM(p.asin))
      `, [clientId, daysBack, clientId, daysBack, clientId]);
      allRows = allRows.concat(sellerRows);
    }

    // ----------------------------------------------------------------
    // VENDOR path: CM1 = shipped_cogs (what Amazon paid the vendor)
    // NOTE: Vendor Option A — excludes deductions (damages, co-op, chargebacks)
    // vendor_cm1_is_estimate = true until remittance data is available
    // ----------------------------------------------------------------
    if (isVendor) {
      const vendorRows = await query(`
        WITH vendor_sales AS (
          SELECT
            s.client_id,
            s.asin,
            s.order_date             AS calc_date,
            SUM(s.shipped_revenue)   AS revenue,       -- gross reference value
            SUM(s.shipped_cogs)      AS shipped_cogs,  -- what Amazon actually paid
            SUM(s.units_received)     AS units
          FROM vendor_purchase_orders s
          WHERE s.client_id = ?
            AND s.connection_type = 'vendor'
            AND s.order_date >= DATEADD(day, -?, CURRENT_DATE)
          GROUP BY s.client_id, s.asin, s.order_date
        ),
        asin_ad_spend AS (
          SELECT
            client_id,
            report_date              AS calc_date,
            UPPER(TRIM(advertised_asin)) AS asin,
            SUM(spend)               AS asin_spend
          FROM ad_performance
          WHERE client_id = ?
            AND report_date >= DATEADD(day, -?, CURRENT_DATE)
            AND advertised_asin IS NOT NULL
            AND advertised_asin != 'UNATTRIBUTED'
            AND TRIM(advertised_asin) != ''
          GROUP BY client_id, report_date, UPPER(TRIM(advertised_asin))
        ),
        product_costs AS (
          SELECT
            client_id,
            asin,
            cogs  -- NULL if not uploaded — intentional
          FROM products
          WHERE client_id = ?
            AND connection_type = 'vendor'
        )
        SELECT
          v.client_id,
          v.asin,
          v.calc_date,
          'vendor'                               AS account_type,
          v.revenue,
          v.units,
          COALESCE(aas.asin_spend, 0)            AS ad_spend,
          0                                      AS fba_fees,       -- vendor doesn't pay FBA
          0                                      AS referral_fees,  -- vendor doesn't pay referral fees
          COALESCE(v.shipped_cogs, 0)            AS shipped_cogs,
          p.cogs                                  -- brand's internal COGS, may be NULL
        FROM vendor_sales v
        LEFT JOIN asin_ad_spend aas
          ON v.client_id = aas.client_id
          AND v.calc_date = aas.calc_date
          AND UPPER(TRIM(v.asin)) = aas.asin
        LEFT JOIN product_costs p
          ON v.client_id = p.client_id
          AND UPPER(TRIM(v.asin)) = UPPER(TRIM(p.asin))
      `, [clientId, daysBack, clientId, daysBack, clientId]);
      allRows = allRows.concat(vendorRows);
    }

    if (!allRows.length) return { recordsWritten: 0 };

    // ----------------------------------------------------------------
    // Compute CM1 / CM2 / CM3 in JS, then bulk MERGE
    // ----------------------------------------------------------------
    const computed = allRows.map(row => {
      const accountType   = String(row.ACCOUNT_TYPE || 'seller');
      const isVendorRow   = accountType === 'vendor';

      const revenue       = Number(row.REVENUE       || 0);
      const units         = Number(row.UNITS         || 0);
      const adSpend       = Number(row.AD_SPEND      || 0);
      const fbaFees       = Number(row.FBA_FEES      || 0);
      const referralFees  = Number(row.REFERRAL_FEES || 0);
      const amazonFees    = fbaFees + referralFees;  // 0 for vendor Option A

      // CM1: Net cash from Amazon
      let cm1;
      if (isVendorRow) {
        // Vendor: shipped_cogs is what Amazon paid — that IS CM1 (pre-brand-COGS)
        cm1 = Number(row.SHIPPED_COGS || 0);
      } else {
        // Seller: ordered_revenue minus Amazon's take
        cm1 = revenue - fbaFees - referralFees;
      }

      // CM2: cm1 - brand's internal COGS
      // If COGS is NULL (not uploaded), CM2 is NULL — never show $0
      const cogsPerUnit = row.COGS != null ? Number(row.COGS) : null;
      const totalCogs   = cogsPerUnit != null && units > 0 ? cogsPerUnit * units : (cogsPerUnit != null ? cogsPerUnit : null);
      const cm2         = totalCogs != null ? cm1 - totalCogs : null;

      // CM3: cm2 - ad_spend
      // NULL if CM2 is NULL
      const cm3 = cm2 != null ? cm2 - adSpend : null;

      // Per-unit metrics
      const cm1PerUnit = units > 0 ? cm1 / units : 0;
      const cm2PerUnit = cm2 != null && units > 0 ? cm2 / units : null;
      const cm3PerUnit = cm3 != null && units > 0 ? cm3 / units : null;

      // Legacy field: keep contribution_margin = cm3 if available, else cm1
      // (for backward compatibility with old dashboard queries)
      const legacyCm  = cm3 ?? cm1;
      const cmPct     = revenue > 0 ? (legacyCm / revenue) * 100 : 0;
      const unitCm    = units > 0 ? legacyCm / units : 0;
      const unitCmPct = units > 0 && revenue > 0 ? (legacyCm / units) / (revenue / units) * 100 : 0;

      const vendorEstimate = isVendorRow ? 'TRUE' : 'FALSE';

      const cid  = String(row.CLIENT_ID).replace(/'/g, "''");
      const asin = String(row.ASIN).replace(/'/g, "''");
      const rawDate = row.CALC_DATE?.value || row.CALC_DATE;
      const date = rawDate instanceof Date
        ? rawDate.toISOString().substring(0, 10)
        : String(rawDate).substring(0, 10);

      const cogsVal        = totalCogs != null    ? totalCogs.toFixed(4)    : 'NULL';
      const cm2Val         = cm2       != null    ? cm2.toFixed(4)          : 'NULL';
      const cm3Val         = cm3       != null    ? cm3.toFixed(4)          : 'NULL';
      const cm2UnitVal     = cm2PerUnit != null   ? cm2PerUnit.toFixed(4)   : 'NULL';
      const cm3UnitVal     = cm3PerUnit != null   ? cm3PerUnit.toFixed(4)   : 'NULL';

      return {
        row: `('${cid}','${asin}','${date}',` +
          // revenue, ad_spend, fba_fees, cogs (legacy)
          `${revenue.toFixed(4)},${adSpend.toFixed(4)},${fbaFees.toFixed(4)},${cogsVal},` +
          // legacy contribution_margin, cm_percent, units, unit_cm, unit_cm_percent
          `${legacyCm.toFixed(4)},${cmPct.toFixed(4)},${units},${unitCm.toFixed(4)},${unitCmPct.toFixed(4)},` +
          // NEW fields: referral_fees, amazon_fees, cm1, cm2, cm3, cm1_per_unit, cm2_per_unit, cm3_per_unit, vendor_cm1_is_estimate
          `${referralFees.toFixed(4)},${amazonFees.toFixed(4)},${cm1.toFixed(4)},${cm2Val},${cm3Val},` +
          `${cm1PerUnit.toFixed(4)},${cm2UnitVal},${cm3UnitVal},${vendorEstimate}` +
          `)`,
      };
    });

    // Batch MERGE in chunks of 200
    const CHUNK = 200;
    let written = 0;
    for (let i = 0; i < computed.length; i += CHUNK) {
      const chunk = computed.slice(i, i + CHUNK);
      const vals  = chunk.map(c => c.row).join(',');

      await query(`
        MERGE INTO contribution_margin t
        USING (
          SELECT
            v.col1  AS client_id,
            v.col2  AS asin,
            v.col3::DATE AS calc_date,
            v.col4  AS revenue,
            v.col5  AS ad_spend,
            v.col6  AS fba_fees,
            v.col7  AS cogs,
            v.col8  AS contribution_margin,
            v.col9  AS cm_percent,
            v.col10 AS units,
            v.col11 AS unit_cm,
            v.col12 AS unit_cm_percent,
            v.col13 AS referral_fees,
            v.col14 AS amazon_fees,
            v.col15 AS cm1,
            v.col16 AS cm2,
            v.col17 AS cm3,
            v.col18 AS cm1_per_unit,
            v.col19 AS cm2_per_unit,
            v.col20 AS cm3_per_unit,
            v.col21::BOOLEAN AS vendor_cm1_is_estimate
          FROM VALUES ${vals}
            AS v(col1,col2,col3,col4,col5,col6,col7,col8,col9,col10,
                 col11,col12,col13,col14,col15,col16,col17,col18,col19,col20,col21)
        ) s ON t.client_id = s.client_id AND t.asin = s.asin AND t.calc_date = s.calc_date
        WHEN MATCHED THEN UPDATE SET
          revenue=s.revenue, ad_spend=s.ad_spend, fba_fees=s.fba_fees, cogs=s.cogs,
          contribution_margin=s.contribution_margin, cm_percent=s.cm_percent,
          units=s.units, unit_cm=s.unit_cm, unit_cm_percent=s.unit_cm_percent,
          referral_fees=s.referral_fees, amazon_fees=s.amazon_fees,
          cm1=s.cm1, cm2=s.cm2, cm3=s.cm3,
          cm1_per_unit=s.cm1_per_unit, cm2_per_unit=s.cm2_per_unit, cm3_per_unit=s.cm3_per_unit,
          vendor_cm1_is_estimate=s.vendor_cm1_is_estimate,
          calculated_at=CURRENT_TIMESTAMP
        WHEN NOT MATCHED THEN INSERT
          (client_id, asin, calc_date, revenue, ad_spend, fba_fees, cogs,
           contribution_margin, cm_percent, units, unit_cm, unit_cm_percent,
           referral_fees, amazon_fees, cm1, cm2, cm3,
           cm1_per_unit, cm2_per_unit, cm3_per_unit,
           vendor_cm1_is_estimate, calculated_at)
          VALUES
          (s.client_id, s.asin, s.calc_date, s.revenue, s.ad_spend, s.fba_fees, s.cogs,
           s.contribution_margin, s.cm_percent, s.units, s.unit_cm, s.unit_cm_percent,
           s.referral_fees, s.amazon_fees, s.cm1, s.cm2, s.cm3,
           s.cm1_per_unit, s.cm2_per_unit, s.cm3_per_unit,
           s.vendor_cm1_is_estimate, CURRENT_TIMESTAMP)
      `);
      written += chunk.length;
    }

    return { recordsWritten: written };
  });
}

/**
 * Get top/bottom performers by CM3 (true profitability) for a client.
 * Falls back to CM1 if CM3 is null (COGS not uploaded yet).
 */
async function getTopPerformers(clientId, { days = 30, limit = 10, order = 'DESC' } = {}) {
  return query(`
    SELECT
      cm.asin,
      MAX(p.title)                    AS product_title,
      MAX(p.sku)                      AS sku,
      SUM(cm.revenue)                 AS total_revenue,
      SUM(cm.ad_spend)                AS total_ad_spend,
      SUM(cm.fba_fees)                AS total_fba_fees,
      SUM(cm.referral_fees)           AS total_referral_fees,
      SUM(cm.amazon_fees)             AS total_amazon_fees,
      SUM(cm.cogs)                    AS total_cogs,
      SUM(cm.cm1)                     AS total_cm1,
      SUM(cm.cm2)                     AS total_cm2,
      SUM(cm.cm3)                     AS total_cm3,
      -- Legacy field for backward compat
      SUM(cm.contribution_margin)     AS total_cm,
      SUM(cm.units)                   AS total_units,
      AVG(cm.cm_percent)              AS avg_cm_percent,
      AVG(cm.unit_cm)                 AS avg_unit_cm,
      AVG(cm.unit_cm_percent)         AS avg_unit_cm_percent,
      AVG(cm.cm1_per_unit)            AS avg_cm1_per_unit,
      AVG(cm.cm2_per_unit)            AS avg_cm2_per_unit,
      AVG(cm.cm3_per_unit)            AS avg_cm3_per_unit,
      BOOLOR_AGG(cm.vendor_cm1_is_estimate) AS vendor_cm1_is_estimate,
      COUNT(*)                        AS days_with_data
    FROM contribution_margin cm
    LEFT JOIN products p
      ON cm.client_id = p.client_id AND cm.asin = p.asin
    WHERE cm.client_id = ?
      AND cm.calc_date >= DATEADD(day, -?, CURRENT_DATE)
    GROUP BY cm.asin
    ORDER BY COALESCE(total_cm3, total_cm1) ${order === 'ASC' ? 'ASC' : 'DESC'}
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
      referral_fees,
      amazon_fees,
      cogs,
      cm1,
      cm2,
      cm3,
      cm1_per_unit,
      cm2_per_unit,
      cm3_per_unit,
      vendor_cm1_is_estimate,
      -- legacy
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
