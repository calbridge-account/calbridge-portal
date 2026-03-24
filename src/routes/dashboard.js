const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/requireAuth');
const { getIngestionStatus } = require('../jobs/ingestionRunner');
const { getTopPerformers, getAsinTrend } = require('../jobs/contributionMargin');
const { syncClient } = require('../jobs/scheduler');
const { getConnectionStatus } = require('../services/amazonAuthService');
const { query } = require('../services/snowflakeService');
const { getPlanLimits } = require('../middleware/planGate');

// ---------------------------------------------------------------------------
// Brand resolver — resolves brandId for a request.
//
// Priority:
//   1. ?brandId= query param (if supplied and owned by client)
//   2. Client's first active brand
//   3. null (no brands configured)
//
// Returns: { brandId, brand, noBrands }
// ---------------------------------------------------------------------------
async function resolveBrand(clientId, requestedBrandId) {
  try {
    if (requestedBrandId) {
      const rows = await query(
        'SELECT * FROM brands WHERE brand_id = ? AND client_id = ? AND is_active = TRUE',
        [requestedBrandId, clientId]
      );
      if (rows.length) return { brandId: rows[0].BRAND_ID, brand: rows[0], noBrands: false };
    }

    // Fall back to first active brand
    const rows = await query(
      'SELECT * FROM brands WHERE client_id = ? AND is_active = TRUE ORDER BY created_at ASC LIMIT 1',
      [clientId]
    );
    if (rows.length) return { brandId: rows[0].BRAND_ID, brand: rows[0], noBrands: false };

    return { brandId: null, brand: null, noBrands: true };
  } catch {
    // brands table may not exist in older envs — graceful fallback
    return { brandId: null, brand: null, noBrands: false };
  }
}

// GET /dashboard
// Summary: connection status + ingestion health + brand context
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const clientId = req.session.clientId;
    const plan = req.session?.clientPlan || 'starter';
    const planLimits = getPlanLimits(plan);

    const [connections, ingestion, brandCtx] = await Promise.all([
      getConnectionStatus(clientId),
      getIngestionStatus(clientId),
      resolveBrand(clientId, req.query.brandId),
    ]);

    res.json({
      connections,
      ingestion,
      brand: brandCtx.brand ? {
        brandId:     brandCtx.brand.BRAND_ID,
        name:        brandCtx.brand.NAME,
        marketplace: brandCtx.brand.MARKETPLACE,
      } : null,
      noBrands:   brandCtx.noBrands,
      plan,
      planLimits: { brands: planLimits.brands === Infinity ? null : planLimits.brands, dsp: planLimits.dsp },
    });
  } catch (err) {
    next(err);
  }
});

// GET /dashboard/summary?days=30&brandId=<optional>
// Overview KPIs: total retail sales, ad attributed sales, ad spend, total ROAS
// brandId: optional — if omitted, uses client's first active brand
router.get('/summary', requireAuth, async (req, res, next) => {
  try {
    const days = Number(req.query.days) || 30;
    const clientId = req.session.clientId;

    // Resolve brand context — attach to response so frontend can show brand name/switcher
    const brandCtx = await resolveBrand(clientId, req.query.brandId);
    if (brandCtx.noBrands) {
      return res.json({
        noBrands: true,
        message:  'No brands configured. Set up your first brand to see data.',
        days,
      });
    }

    const [salesRow, adsRow] = await Promise.all([
      // Total retail sales = Seller ordered revenue + Vendor shipped revenue
      query(`
        SELECT
          COALESCE(SUM(ordered_revenue), 0)  AS seller_revenue,
          COALESCE(SUM(shipped_revenue), 0)  AS vendor_revenue,
          COALESCE(SUM(ordered_revenue + shipped_revenue), 0) AS total_retail_sales,
          COALESCE(SUM(units_ordered), 0)    AS total_units
        FROM sales
        WHERE client_id = ?
          AND order_date >= DATEADD(day, -?, CURRENT_DATE)
      `, [clientId, days]),

      // Ad attributed sales + spend
      query(`
        SELECT
          COALESCE(SUM(spend), 0)  AS total_ad_spend,
          COALESCE(SUM(sales), 0)  AS total_ad_sales,
          COALESCE(SUM(orders), 0) AS total_ad_orders,
          CASE WHEN SUM(spend) > 0 THEN SUM(sales) / SUM(spend) ELSE NULL END AS ad_roas,
          CASE WHEN SUM(sales) > 0 THEN SUM(spend) / SUM(sales) ELSE NULL END AS acos
        FROM ad_performance
        WHERE client_id = ?
          AND report_date >= DATEADD(day, -?, CURRENT_DATE)
      `, [clientId, days])
    ]);

    const [s, a] = [salesRow[0] || {}, adsRow[0] || {}];

    const totalRetailSales = Number(s.TOTAL_RETAIL_SALES || 0);
    const totalAdSpend     = Number(a.TOTAL_AD_SPEND    || 0);

    // Total ROAS = Total retail sales / Ad spend (true blended ROAS)
    const totalRoas = totalAdSpend > 0 ? totalRetailSales / totalAdSpend : null;

    // CM Breakdown from contribution_margin table
    // Uses correct CM1/CM2/CM3 model:
    //   CM1 = Net Amazon Proceeds (revenue - Amazon fees; or shipped_cogs for vendor)
    //   CM2 = Gross Profit (CM1 - brand COGS)
    //   CM3 = True Profitability (CM2 - ad spend)
    let cmBreakdown = null;
    try {
      const cmRows = await query(`
        SELECT
          COALESCE(SUM(revenue), 0)                             AS revenue,
          COALESCE(SUM(amazon_fees), 0)                         AS amazon_fees,
          COALESCE(SUM(fba_fees), 0)                            AS fba_fees,
          COALESCE(SUM(referral_fees), 0)                       AS referral_fees,
          COALESCE(SUM(cogs), 0)                                AS cogs,
          COALESCE(SUM(ad_spend), 0)                            AS ad_spend,
          -- Use pre-computed cm1/cm2/cm3 columns; fall back gracefully if not yet populated
          COALESCE(SUM(cm1), SUM(revenue - fba_fees - referral_fees)) AS cm1,
          SUM(cm2)                                               AS cm2,
          SUM(cm3)                                               AS cm3,
          BOOLOR_AGG(vendor_cm1_is_estimate)                    AS vendor_cm1_is_estimate
        FROM contribution_margin
        WHERE client_id = ?
          AND calc_date >= DATEADD(day, -?, CURRENT_DATE)
      `, [clientId, days]);

      if (cmRows.length) {
        const cm = cmRows[0];
        const cm1 = Number(cm.CM1 || 0);
        const cm2 = cm.CM2 != null ? Number(cm.CM2) : null;
        const cm3 = cm.CM3 != null ? Number(cm.CM3) : null;
        cmBreakdown = {
          revenue:    Number(cm.REVENUE     || 0),
          amazonFees: Number(cm.AMAZON_FEES || 0),
          fbaFees:    Number(cm.FBA_FEES    || 0),
          referralFees: Number(cm.REFERRAL_FEES || 0),
          cogs:       Number(cm.COGS        || 0),
          adSpend:    Number(cm.AD_SPEND    || 0),
          cm1,
          cm2,
          cm3,
          // Human-readable labels
          labels: {
            cm1: 'Net Amazon Proceeds',
            cm2: 'Gross Profit',
            cm3: 'True Profitability',
          },
          tooltips: {
            cm1: 'Revenue after all Amazon fees, before your product costs',
            cm2: 'Net Amazon proceeds minus your cost of goods',
            cm3: 'Gross profit minus advertising spend',
          },
          // Vendor caveat flag
          vendorCm1IsEstimate: Boolean(cm.VENDOR_CM1_IS_ESTIMATE),
          vendorCm1Caveat: Boolean(cm.VENDOR_CM1_IS_ESTIMATE)
            ? 'Excludes Amazon deductions (damages, co-op, chargebacks). Full remittance data coming soon.'
            : null,
          // Profitability flag
          profitable: cm3 != null ? cm3 >= 0 : null,
        };
      }
    } catch { /* CM data not available yet */ }

    res.json({
      totalRetailSales,
      sellerRevenue:    Number(s.SELLER_REVENUE  || 0),
      vendorRevenue:    Number(s.VENDOR_REVENUE  || 0),
      totalUnits:       Number(s.TOTAL_UNITS     || 0),
      totalAdSales:     Number(a.TOTAL_AD_SALES  || 0),
      totalAdSpend,
      totalAdOrders:    Number(a.TOTAL_AD_ORDERS || 0),
      adRoas:           a.AD_ROAS  ? Number(a.AD_ROAS)  : null,
      acos:             a.ACOS     ? Number(a.ACOS)      : null,
      totalRoas,
      cmBreakdown,
      days,
      // Brand context — frontend uses this to show brand name in header / switcher
      brand: brandCtx.brand ? {
        brandId:     brandCtx.brand.BRAND_ID,
        name:        brandCtx.brand.NAME,
        marketplace: brandCtx.brand.MARKETPLACE,
      } : null,
      noBrands: brandCtx.noBrands,
    });
  } catch (err) { next(err); }
});

// GET /dashboard/performance
// Top/bottom performers by contribution margin (CM3, or CM1 fallback)
router.get('/performance', requireAuth, async (req, res, next) => {
  try {
    const { days = 30, limit = 10 } = req.query;
    const [topPerformers, bottomPerformers] = await Promise.all([
      getTopPerformers(req.session.clientId, { days: Number(days), limit: Number(limit), order: 'DESC' }),
      getTopPerformers(req.session.clientId, { days: Number(days), limit: Number(limit), order: 'ASC' })
    ]);

    // Enrich rows with CM labels and profitability flags
    function enrichPerformer(r) {
      const cm1     = r.TOTAL_CM1 != null ? Number(r.TOTAL_CM1) : null;
      const cm2     = r.TOTAL_CM2 != null ? Number(r.TOTAL_CM2) : null;
      const cm3     = r.TOTAL_CM3 != null ? Number(r.TOTAL_CM3) : null;
      const cm1Unit = r.AVG_CM1_PER_UNIT != null ? Number(r.AVG_CM1_PER_UNIT) : null;
      const cm2Unit = r.AVG_CM2_PER_UNIT != null ? Number(r.AVG_CM2_PER_UNIT) : null;
      const cm3Unit = r.AVG_CM3_PER_UNIT != null ? Number(r.AVG_CM3_PER_UNIT) : null;
      return {
        ...r,
        // Structured CM breakdown
        cm1, cm2, cm3,
        cm1PerUnit: cm1Unit,
        cm2PerUnit: cm2Unit,
        cm3PerUnit: cm3Unit,
        // Labels
        cm1Label: 'Net Amazon Proceeds',
        cm2Label: 'Gross Profit',
        cm3Label: 'True Profitability',
        // Profitability flag — if CM3 < 0, brand is paying to lose money
        profitable: cm3 != null ? cm3 >= 0 : null,
        cogsSet:    cm2 != null,  // false means COGS not uploaded yet
        vendorCm1IsEstimate: Boolean(r.VENDOR_CM1_IS_ESTIMATE),
      };
    }

    res.json({
      topPerformers:    topPerformers.map(enrichPerformer),
      bottomPerformers: bottomPerformers.map(enrichPerformer),
      days: Number(days),
      labels: {
        cm1: 'Net Amazon Proceeds',
        cm2: 'Gross Profit',
        cm3: 'True Profitability',
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /dashboard/asin/:asin
// Contribution margin trend for a specific ASIN (CM1/CM2/CM3 per day)
router.get('/asin/:asin', requireAuth, async (req, res, next) => {
  try {
    const { days = 90 } = req.query;
    const rows = await getAsinTrend(req.session.clientId, req.params.asin, Number(days));

    const trend = rows.map(r => ({
      calcDate:    r.CALC_DATE?.value
        ? (r.CALC_DATE.value instanceof Date ? r.CALC_DATE.value.toISOString().substring(0, 10) : String(r.CALC_DATE.value).substring(0, 10))
        : (r.CALC_DATE instanceof Date ? r.CALC_DATE.toISOString().substring(0, 10) : String(r.CALC_DATE).substring(0, 10)),
      revenue:     Number(r.REVENUE    || 0),
      adSpend:     Number(r.AD_SPEND   || 0),
      fbaFees:     Number(r.FBA_FEES   || 0),
      referralFees: Number(r.REFERRAL_FEES || 0),
      amazonFees:  Number(r.AMAZON_FEES || 0),
      cogs:        r.COGS != null ? Number(r.COGS) : null,
      cm1:         r.CM1 != null ? Number(r.CM1) : null,
      cm2:         r.CM2 != null ? Number(r.CM2) : null,
      cm3:         r.CM3 != null ? Number(r.CM3) : null,
      cm1PerUnit:  r.CM1_PER_UNIT != null ? Number(r.CM1_PER_UNIT) : null,
      cm2PerUnit:  r.CM2_PER_UNIT != null ? Number(r.CM2_PER_UNIT) : null,
      cm3PerUnit:  r.CM3_PER_UNIT != null ? Number(r.CM3_PER_UNIT) : null,
      vendorCm1IsEstimate: Boolean(r.VENDOR_CM1_IS_ESTIMATE),
      // Legacy
      contributionMargin: Number(r.CONTRIBUTION_MARGIN || 0),
      cmPercent:   Number(r.CM_PERCENT || 0),
    }));

    // Profitability summary for this ASIN over the period
    const hasData      = trend.length > 0;
    const latestCm3    = hasData ? trend[trend.length - 1].cm3 : null;
    const totalCm3     = hasData ? trend.reduce((s, d) => d.cm3 != null ? s + d.cm3 : s, 0) : null;
    const cm3Days      = hasData ? trend.filter(d => d.cm3 != null).length : 0;
    const profitableDays = hasData ? trend.filter(d => d.cm3 != null && d.cm3 >= 0).length : 0;

    res.json({
      asin: req.params.asin,
      days: Number(days),
      trend,
      summary: hasData ? {
        totalCm3,
        cm3Days,
        profitableDays,
        profitable: totalCm3 != null ? totalCm3 >= 0 : null,
        vendorCm1IsEstimate: trend.some(d => d.vendorCm1IsEstimate),
        vendorCm1Caveat: trend.some(d => d.vendorCm1IsEstimate)
          ? 'Excludes Amazon deductions (damages, co-op, chargebacks). Full remittance data coming soon.'
          : null,
      } : null,
      labels: {
        cm1: 'Net Amazon Proceeds',
        cm2: 'Gross Profit',
        cm3: 'True Profitability',
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /dashboard/sales-performance?days=30
// Top ASINs by revenue, daily sales trend, channel split
router.get('/sales-performance', requireAuth, async (req, res, next) => {
  try {
    const days = Number(req.query.days) || 30;
    const clientId = req.session.clientId;

    const [topAsins, dailyTrend, channelSplit] = await Promise.all([
      // Top 10 ASINs by revenue
      query(`
        SELECT
          s.asin,
          MAX(p.title) AS product_name,
          SUM(s.units_ordered)  AS units,
          SUM(s.ordered_revenue + COALESCE(s.shipped_revenue, 0)) AS revenue,
          COUNT(DISTINCT s.order_date) AS active_days
        FROM sales s
        LEFT JOIN products p ON s.client_id = p.client_id AND s.asin = p.asin
        WHERE s.client_id = ?
          AND s.order_date >= DATEADD(day, -?, CURRENT_DATE)
        GROUP BY s.asin
        ORDER BY revenue DESC
        LIMIT 10
      `, [clientId, days]),

      // Daily revenue trend
      query(`
        SELECT
          order_date,
          SUM(ordered_revenue + COALESCE(shipped_revenue, 0)) AS daily_revenue,
          SUM(units_ordered) AS daily_units
        FROM sales
        WHERE client_id = ?
          AND order_date >= DATEADD(day, -?, CURRENT_DATE)
        GROUP BY order_date
        ORDER BY order_date ASC
      `, [clientId, days]),

      // Channel split: Seller vs Vendor
      query(`
        SELECT
          connection_type,
          SUM(ordered_revenue + COALESCE(shipped_revenue, 0)) AS channel_revenue,
          SUM(units_ordered) AS channel_units
        FROM sales
        WHERE client_id = ?
          AND order_date >= DATEADD(day, -?, CURRENT_DATE)
        GROUP BY connection_type
      `, [clientId, days])
    ]);

    res.json({
      topAsins: topAsins.map(r => ({
        asin:        r.ASIN,
        productName: r.PRODUCT_NAME || r.ASIN,
        units:       Number(r.UNITS || 0),
        revenue:     Number(r.REVENUE || 0),
        activeDays:  Number(r.ACTIVE_DAYS || 0)
      })),
      dailyTrend: dailyTrend.map(r => ({
        date:    r.ORDER_DATE instanceof Date
          ? r.ORDER_DATE.toISOString().substring(0, 10)
          : String(r.ORDER_DATE).substring(0, 10),
        revenue: Number(r.DAILY_REVENUE || 0),
        units:   Number(r.DAILY_UNITS   || 0)
      })),
      channelSplit: channelSplit.map(r => ({
        channel: r.CONNECTION_TYPE,
        revenue: Number(r.CHANNEL_REVENUE || 0),
        units:   Number(r.CHANNEL_UNITS   || 0)
      })),
      days
    });
  } catch (err) { next(err); }
});

// POST /dashboard/sync
// Manually trigger a sync for the logged-in client
router.post('/sync', requireAuth, async (req, res, next) => {
  try {
    const connections = await getConnectionStatus(req.session.clientId);
    // Fire sync in background — don't await
    syncClient(req.session.clientId, connections).catch(err =>
      console.error(`[Manual sync] Client ${req.session.clientId}:`, err.message)
    );
    res.json({ message: 'Sync started', clientId: req.session.clientId });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /dashboard/tacos?days=30
// TACOS = Total Ad Spend / Total Ordered Revenue
// Unlike ACOS (which uses only ad-attributed revenue), TACOS uses ALL revenue.
// This is the truest measure of advertising efficiency for the whole business.
// ---------------------------------------------------------------------------
router.get('/tacos', requireAuth, async (req, res, next) => {
  try {
    const days = Number(req.query.days) || 30;
    const clientId = req.session.clientId;

    const [salesRow, adsRow] = await Promise.all([
      query(`
        SELECT COALESCE(SUM(ordered_revenue + COALESCE(shipped_revenue, 0)), 0) AS total_revenue
        FROM sales
        WHERE client_id = ?
          AND order_date >= DATEADD(day, -?, CURRENT_DATE)
      `, [clientId, days]),

      query(`
        SELECT COALESCE(SUM(spend), 0) AS total_spend
        FROM ad_performance
        WHERE client_id = ?
          AND report_date >= DATEADD(day, -?, CURRENT_DATE)
      `, [clientId, days])
    ]);

    const totalRevenue = Number(salesRow[0]?.TOTAL_REVENUE || 0);
    const totalSpend   = Number(adsRow[0]?.TOTAL_SPEND     || 0);
    const tacos        = totalRevenue > 0 ? totalSpend / totalRevenue : null;

    // Also break out TACOS by campaign type (SP / SB / SD / DSP)
    let byType = [];
    try {
      const typeRows = await query(`
        SELECT
          c.campaign_type,
          ap.connection_type,
          SUM(ap.spend) AS spend
        FROM ad_performance ap
        LEFT JOIN ad_campaigns c
          ON ap.client_id = c.client_id
          AND ap.campaign_id = c.campaign_id
          AND ap.connection_type = c.connection_type
        WHERE ap.client_id = ?
          AND ap.report_date >= DATEADD(day, -?, CURRENT_DATE)
        GROUP BY c.campaign_type, ap.connection_type
        ORDER BY spend DESC
      `, [clientId, days]);

      byType = typeRows.map(r => ({
        campaignType:   r.CAMPAIGN_TYPE || r.CONNECTION_TYPE,
        connectionType: r.CONNECTION_TYPE,
        spend:          Number(r.SPEND || 0),
        tacos:          totalRevenue > 0 ? Number(r.SPEND || 0) / totalRevenue : null
      }));
    } catch { /* campaign type join is optional */ }

    res.json({
      totalRevenue,
      totalSpend,
      tacos,          // e.g. 0.12 = 12%
      tacosPercent:   tacos != null ? tacos * 100 : null,
      byType,
      days
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /dashboard/forecast?days=90
// Revenue forecasting based on last N days of daily sales data.
// Returns:
//   - 7-day rolling average
//   - 30-day linear regression slope (trend)
//   - Projected monthly revenue (current month run-rate)
//   - Projected annual revenue (annualized from trend)
// ---------------------------------------------------------------------------
router.get('/forecast', requireAuth, async (req, res, next) => {
  try {
    const days = Number(req.query.days) || 90;
    const clientId = req.session.clientId;

    const dailyRows = await query(`
      SELECT
        order_date,
        SUM(ordered_revenue + COALESCE(shipped_revenue, 0)) AS daily_revenue
      FROM sales
      WHERE client_id = ?
        AND order_date >= DATEADD(day, -?, CURRENT_DATE)
      GROUP BY order_date
      ORDER BY order_date ASC
    `, [clientId, days]);

    if (!dailyRows.length) {
      return res.json({ available: false, reason: 'No sales data', days });
    }

    // Parse daily data
    const data = dailyRows.map(r => ({
      date:    r.ORDER_DATE instanceof Date
        ? r.ORDER_DATE.toISOString().substring(0, 10)
        : String(r.ORDER_DATE?.value || r.ORDER_DATE).substring(0, 10),
      revenue: Number(r.DAILY_REVENUE || 0)
    }));

    // 7-day rolling average (last 7 days)
    const last7 = data.slice(-7);
    const avg7  = last7.length > 0 ? last7.reduce((s, d) => s + d.revenue, 0) / last7.length : 0;

    // 30-day linear regression (slope in $/day)
    const last30 = data.slice(-30);
    let slope30 = 0;
    if (last30.length >= 2) {
      const n    = last30.length;
      const xArr = last30.map((_, i) => i);
      const yArr = last30.map(d => d.revenue);
      const xMean = xArr.reduce((s, x) => s + x, 0) / n;
      const yMean = yArr.reduce((s, y) => s + y, 0) / n;
      const num   = xArr.reduce((s, x, i) => s + (x - xMean) * (yArr[i] - yMean), 0);
      const den   = xArr.reduce((s, x) => s + (x - xMean) ** 2, 0);
      slope30 = den !== 0 ? num / den : 0;
    }

    // Current month run-rate: avg of all days this month × days in month
    const now           = new Date();
    const daysInMonth   = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const dayOfMonth    = now.getDate();
    const thisMonthData = data.filter(d => d.date.startsWith(now.toISOString().substring(0, 7)));
    const mtdAvg        = thisMonthData.length > 0
      ? thisMonthData.reduce((s, d) => s + d.revenue, 0) / thisMonthData.length
      : avg7;
    const projectedMonthly = mtdAvg * daysInMonth;

    // Annualized: use 30-day trend slope to project forward 365 days
    const baseDaily      = last30.length > 0 ? last30.reduce((s, d) => s + d.revenue, 0) / last30.length : avg7;
    const projectedAnnual = (baseDaily + slope30 * 182.5) * 365; // midpoint projection

    res.json({
      available: true,
      days,
      rollingAvg7d:     avg7,
      trend30dSlope:    slope30,   // $/day change
      trendDirection:   slope30 > 0 ? 'up' : slope30 < 0 ? 'down' : 'flat',
      projectedMonthly,
      projectedAnnual,
      dayOfMonth,
      daysInMonth,
      mtdRevenue:       thisMonthData.reduce((s, d) => s + d.revenue, 0),
      dailySeries:      data   // full series for charting
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /dashboard/budget-pacing
// Per-campaign budget pacing: daily budget × days in month = monthly budget.
// Actual spend-to-date vs expected spend-to-date.
// Flag over-pacing (>110%) and under-pacing (<70%).
// ---------------------------------------------------------------------------
router.get('/budget-pacing', requireAuth, async (req, res, next) => {
  try {
    const clientId = req.session.clientId;
    const now         = new Date();
    const dayOfMonth  = now.getDate();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const monthStart  = now.toISOString().substring(0, 7) + '-01';

    const rows = await query(`
      SELECT
        c.campaign_id,
        c.campaign_name,
        c.campaign_type,
        c.connection_type,
        c.status,
        c.budget                                    AS daily_budget,
        c.budget_type,
        COALESCE(SUM(ap.spend), 0)                  AS mtd_spend,
        COUNT(DISTINCT ap.report_date)              AS days_with_data,
        -- Monthly budget = daily_budget * days in month
        c.budget * ?                                AS monthly_budget,
        -- Expected MTD spend = monthly_budget * (days elapsed / days in month)
        (c.budget * ?) * (? / ?)                    AS expected_mtd_spend
      FROM ad_campaigns c
      LEFT JOIN ad_performance ap
        ON c.client_id     = ap.client_id
        AND c.campaign_id  = ap.campaign_id
        AND c.connection_type = ap.connection_type
        AND ap.report_date >= ?
      WHERE c.client_id = ?
        AND c.budget IS NOT NULL
        AND c.budget > 0
      GROUP BY
        c.campaign_id, c.campaign_name, c.campaign_type,
        c.connection_type, c.status, c.budget, c.budget_type
      ORDER BY mtd_spend DESC
    `, [
      daysInMonth,                              // monthly_budget multiplier
      daysInMonth,                              // expected: monthly_budget
      dayOfMonth,                               // expected: days elapsed
      daysInMonth,                              // expected: days in month
      monthStart,                               // MTD start date
      clientId
    ]);

    const campaigns = rows.map(r => {
      const mtdSpend       = Number(r.MTD_SPEND          || 0);
      const monthlyBudget  = Number(r.MONTHLY_BUDGET      || 0);
      const expectedMtd    = Number(r.EXPECTED_MTD_SPEND  || 0);
      const pacingRatio    = expectedMtd > 0 ? mtdSpend / expectedMtd : null;
      const monthlyPacingRatio = monthlyBudget > 0 ? mtdSpend / monthlyBudget : null;

      let pacingStatus = 'on_track';
      if (pacingRatio !== null) {
        if (pacingRatio > 1.1)  pacingStatus = 'over_pacing';
        else if (pacingRatio < 0.7) pacingStatus = 'under_pacing';
      }

      return {
        campaignId:          String(r.CAMPAIGN_ID),
        campaignName:        r.CAMPAIGN_NAME,
        campaignType:        r.CAMPAIGN_TYPE,
        connectionType:      r.CONNECTION_TYPE,
        status:              r.STATUS,
        dailyBudget:         Number(r.DAILY_BUDGET      || 0),
        monthlyBudget,
        mtdSpend,
        expectedMtdSpend:    expectedMtd,
        pacingRatio,
        monthlyPacingRatio,
        pacingStatus,        // 'over_pacing' | 'under_pacing' | 'on_track'
        daysWithData:        Number(r.DAYS_WITH_DATA || 0),
        projectedMonthly:    expectedMtd > 0 && dayOfMonth > 0
          ? mtdSpend / dayOfMonth * daysInMonth
          : null
      };
    });

    const overPacing   = campaigns.filter(c => c.pacingStatus === 'over_pacing');
    const underPacing  = campaigns.filter(c => c.pacingStatus === 'under_pacing');
    const onTrack      = campaigns.filter(c => c.pacingStatus === 'on_track');
    const totalMtdSpend     = campaigns.reduce((s, c) => s + c.mtdSpend, 0);
    const totalMonthlyBudget = campaigns.reduce((s, c) => s + c.monthlyBudget, 0);

    res.json({
      dayOfMonth,
      daysInMonth,
      monthStart,
      campaigns,
      summary: {
        total: campaigns.length,
        overPacing:  overPacing.length,
        underPacing: underPacing.length,
        onTrack:     onTrack.length,
        totalMtdSpend,
        totalMonthlyBudget,
        overallPacingRatio: totalMonthlyBudget > 0 ? totalMtdSpend / (totalMonthlyBudget * dayOfMonth / daysInMonth) : null
      }
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /dashboard/ntb?days=30
// New-to-Brand metrics from Sponsored Brands reports.
// NTB data comes from the ntb_orders / ntb_sales columns in ad_performance
// (populated by the updated SB ingestion report).
// ---------------------------------------------------------------------------
router.get('/ntb', requireAuth, async (req, res, next) => {
  try {
    const days = Number(req.query.days) || 30;
    const clientId = req.session.clientId;

    const rows = await query(`
      SELECT
        COALESCE(SUM(orders), 0)                    AS total_orders,
        COALESCE(SUM(sales), 0)                     AS total_sales,
        COALESCE(SUM(spend), 0)                     AS total_spend,
        COALESCE(SUM(ntb_orders), 0)                AS ntb_orders,
        COALESCE(SUM(ntb_sales), 0)                 AS ntb_sales,
        COALESCE(SUM(ntb_units), 0)                 AS ntb_units,
        CASE WHEN SUM(orders) > 0
          THEN SUM(ntb_orders) / SUM(orders) ELSE NULL END AS ntb_order_rate,
        CASE WHEN SUM(sales) > 0
          THEN SUM(ntb_sales) / SUM(sales) ELSE NULL END   AS ntb_revenue_rate,
        CASE WHEN SUM(ntb_sales) > 0
          THEN SUM(spend) / SUM(ntb_sales) ELSE NULL END   AS ntb_acos,
        CASE WHEN SUM(spend) > 0
          THEN SUM(ntb_sales) / SUM(spend) ELSE NULL END   AS ntb_roas
      FROM ad_performance
      WHERE client_id = ?
        AND report_date >= DATEADD(day, -?, CURRENT_DATE)
        AND ntb_orders IS NOT NULL
    `, [clientId, days]);

    const r = rows[0] || {};

    // Also get NTB by campaign
    let byCampaign = [];
    try {
      const campRows = await query(`
        SELECT
          ap.campaign_id,
          c.campaign_name,
          c.campaign_type,
          SUM(ap.orders)     AS total_orders,
          SUM(ap.sales)      AS total_sales,
          SUM(ap.spend)      AS total_spend,
          SUM(ap.ntb_orders) AS ntb_orders,
          SUM(ap.ntb_sales)  AS ntb_sales,
          CASE WHEN SUM(ap.orders) > 0
            THEN SUM(ap.ntb_orders) / SUM(ap.orders) ELSE NULL END AS ntb_order_rate,
          CASE WHEN SUM(ap.spend) > 0
            THEN SUM(ap.ntb_sales) / SUM(ap.spend) ELSE NULL END   AS ntb_roas
        FROM ad_performance ap
        LEFT JOIN ad_campaigns c
          ON ap.client_id = c.client_id
          AND ap.campaign_id = c.campaign_id
          AND ap.connection_type = c.connection_type
        WHERE ap.client_id = ?
          AND ap.report_date >= DATEADD(day, -?, CURRENT_DATE)
          AND ap.ntb_orders IS NOT NULL
          AND ap.ntb_orders > 0
        GROUP BY ap.campaign_id, c.campaign_name, c.campaign_type
        ORDER BY ntb_orders DESC
        LIMIT 20
      `, [clientId, days]);

      byCampaign = campRows.map(row => ({
        campaignId:    String(row.CAMPAIGN_ID),
        campaignName:  row.CAMPAIGN_NAME,
        campaignType:  row.CAMPAIGN_TYPE,
        totalOrders:   Number(row.TOTAL_ORDERS || 0),
        totalSales:    Number(row.TOTAL_SALES  || 0),
        totalSpend:    Number(row.TOTAL_SPEND  || 0),
        ntbOrders:     Number(row.NTB_ORDERS   || 0),
        ntbSales:      Number(row.NTB_SALES    || 0),
        ntbOrderRate:  row.NTB_ORDER_RATE != null ? Number(row.NTB_ORDER_RATE) : null,
        ntbRoas:       row.NTB_ROAS       != null ? Number(row.NTB_ROAS)       : null
      }));
    } catch { /* campaign breakdown optional */ }

    const hasData = Number(r.NTB_ORDERS || 0) > 0;

    res.json({
      available:    hasData,
      note: hasData ? null : 'NTB data requires Sponsored Brands campaigns. If you run SB campaigns, data will appear after next sync.',
      days,
      totalOrders:   Number(r.TOTAL_ORDERS    || 0),
      totalSales:    Number(r.TOTAL_SALES     || 0),
      totalSpend:    Number(r.TOTAL_SPEND     || 0),
      ntbOrders:     Number(r.NTB_ORDERS      || 0),
      ntbSales:      Number(r.NTB_SALES       || 0),
      ntbUnits:      Number(r.NTB_UNITS       || 0),
      ntbOrderRate:  r.NTB_ORDER_RATE  != null ? Number(r.NTB_ORDER_RATE)  : null,
      ntbRevenueRate:r.NTB_REVENUE_RATE!= null ? Number(r.NTB_REVENUE_RATE): null,
      ntbAcos:       r.NTB_ACOS        != null ? Number(r.NTB_ACOS)        : null,
      ntbRoas:       r.NTB_ROAS        != null ? Number(r.NTB_ROAS)        : null,
      byCampaign
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /dashboard/asin-ad-spend?days=30
// Per-ASIN ad spend using direct attribution (advertised_asin column).
// Replaces the old proportional split — shows actual spend per ASIN.
// Includes 'UNATTRIBUTED' bucket for brand awareness spend.
// ---------------------------------------------------------------------------
router.get('/asin-ad-spend', requireAuth, async (req, res, next) => {
  try {
    const days = Number(req.query.days) || 30;
    const clientId = req.session.clientId;

    const rows = await query(`
      SELECT
        COALESCE(ap.advertised_asin, 'UNATTRIBUTED') AS asin,
        MAX(p.title)   AS product_title,
        SUM(ap.spend)  AS total_spend,
        SUM(ap.sales)  AS total_sales,
        SUM(ap.orders) AS total_orders,
        SUM(ap.clicks) AS total_clicks,
        CASE WHEN SUM(ap.sales) > 0
          THEN SUM(ap.spend) / SUM(ap.sales) ELSE NULL END AS acos,
        CASE WHEN SUM(ap.spend) > 0
          THEN SUM(ap.sales) / SUM(ap.spend) ELSE NULL END AS roas
      FROM ad_performance ap
      LEFT JOIN products p
        ON ap.client_id = p.client_id
        AND UPPER(TRIM(ap.advertised_asin)) = UPPER(TRIM(p.asin))
      WHERE ap.client_id = ?
        AND ap.report_date >= DATEADD(day, -?, CURRENT_DATE)
      GROUP BY COALESCE(ap.advertised_asin, 'UNATTRIBUTED')
      ORDER BY total_spend DESC
      LIMIT 50
    `, [clientId, days]);

    const totalSpend = rows.reduce((s, r) => s + Number(r.TOTAL_SPEND || 0), 0);
    const unattributed = rows.find(r => r.ASIN === 'UNATTRIBUTED');
    const attributed   = rows.filter(r => r.ASIN !== 'UNATTRIBUTED');

    res.json({
      days,
      totalSpend,
      unattributedSpend:  Number(unattributed?.TOTAL_SPEND || 0),
      attributedSpend:    totalSpend - Number(unattributed?.TOTAL_SPEND || 0),
      byAsin: rows.map(r => ({
        asin:         r.ASIN,
        productTitle: r.PRODUCT_TITLE || null,
        spend:        Number(r.TOTAL_SPEND  || 0),
        sales:        Number(r.TOTAL_SALES  || 0),
        orders:       Number(r.TOTAL_ORDERS || 0),
        clicks:       Number(r.TOTAL_CLICKS || 0),
        acos:         r.ACOS != null ? Number(r.ACOS) : null,
        roas:         r.ROAS != null ? Number(r.ROAS) : null,
        spendShare:   totalSpend > 0 ? Number(r.TOTAL_SPEND || 0) / totalSpend : 0
      }))
    });
  } catch (err) { next(err); }
});

module.exports = router;
