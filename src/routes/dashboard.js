const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/requireAuth');
const { getIngestionStatus } = require('../jobs/ingestionRunner');
const { getTopPerformers, getAsinTrend } = require('../jobs/contributionMargin');
const { syncClient } = require('../jobs/scheduler');
const { getConnectionStatus } = require('../services/amazonAuthService');
const { query } = require('../services/snowflakeService');

// GET /dashboard
// Summary: connection status + ingestion health
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const [connections, ingestion] = await Promise.all([
      getConnectionStatus(req.session.clientId),
      getIngestionStatus(req.session.clientId)
    ]);
    res.json({ connections, ingestion });
  } catch (err) {
    next(err);
  }
});

// GET /dashboard/summary?days=30
// Overview KPIs: total retail sales, ad attributed sales, ad spend, total ROAS
router.get('/summary', requireAuth, async (req, res, next) => {
  try {
    const days = Number(req.query.days) || 30;
    const clientId = req.session.clientId;

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
    let cmBreakdown = null;
    try {
      const cmRows = await query(`
        SELECT
          COALESCE(SUM(revenue), 0)                    AS revenue,
          COALESCE(SUM(cogs), 0)                       AS cogs,
          COALESCE(SUM(fba_fees), 0)                   AS fba_fees,
          COALESCE(SUM(ad_spend), 0)                   AS ad_spend,
          COALESCE(SUM(revenue - cogs), 0)             AS cm1,
          COALESCE(SUM(revenue - cogs - fba_fees), 0)  AS cm2,
          COALESCE(SUM(contribution_margin), 0)        AS cm3
        FROM contribution_margin
        WHERE client_id = ?
          AND calc_date >= DATEADD(day, -?, CURRENT_DATE)
      `, [clientId, days]);

      if (cmRows.length) {
        const cm = cmRows[0];
        cmBreakdown = {
          revenue:  Number(cm.REVENUE  || 0),
          cogs:     Number(cm.COGS     || 0),
          fbaFees:  Number(cm.FBA_FEES || 0),
          adSpend:  Number(cm.AD_SPEND || 0),
          cm1:      Number(cm.CM1      || 0),
          cm2:      Number(cm.CM2      || 0),
          cm3:      Number(cm.CM3      || 0)
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
      days
    });
  } catch (err) { next(err); }
});

// GET /dashboard/performance
// Top/bottom performers by contribution margin
router.get('/performance', requireAuth, async (req, res, next) => {
  try {
    const { days = 30, limit = 10 } = req.query;
    const [topPerformers, bottomPerformers] = await Promise.all([
      getTopPerformers(req.session.clientId, { days: Number(days), limit: Number(limit), order: 'DESC' }),
      getTopPerformers(req.session.clientId, { days: Number(days), limit: Number(limit), order: 'ASC' })
    ]);
    res.json({ topPerformers, bottomPerformers, days: Number(days) });
  } catch (err) {
    next(err);
  }
});

// GET /dashboard/asin/:asin
// Contribution margin trend for a specific ASIN
router.get('/asin/:asin', requireAuth, async (req, res, next) => {
  try {
    const { days = 90 } = req.query;
    const trend = await getAsinTrend(req.session.clientId, req.params.asin, Number(days));
    res.json({ asin: req.params.asin, days: Number(days), trend });
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

module.exports = router;
