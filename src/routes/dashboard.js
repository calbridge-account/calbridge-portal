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

    const s = salesRow[0] || {};
    const a = adsRow[0] || {};

    const totalRetailSales = Number(s.TOTAL_RETAIL_SALES || 0);
    const totalAdSpend     = Number(a.TOTAL_AD_SPEND    || 0);

    // Total ROAS = Total retail sales / Ad spend (true blended ROAS)
    const totalRoas = totalAdSpend > 0 ? totalRetailSales / totalAdSpend : null;

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
      totalRoas,        // Total retail sales / ad spend — the real blended number
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
