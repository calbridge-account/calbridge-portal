/**
 * src/routes/sellerAnalytics.js
 *
 * Seller Central analytics routes.
 * Data source: CALBRIDGE_PROD.RAW.RETAIL_SALES_TRAFFIC
 *
 * GET /seller-analytics/overview   — KPIs, trend, top ASINs, Buy Box
 * GET /seller-analytics/buybox     — Buy Box trend + ASIN breakdown
 */

'use strict';

const express = require('express');
const router  = express.Router();
const { requireAuth } = require('../middleware/requireAuth');
const { query }       = require('../services/snowflakeService');
const { resolveClientId, resolveMarketplace } = require('../services/advertiserResolver');

const SCHEMA = 'CALBRIDGE_PROD.RAW';

function dateFilter(col, days, startDate, endDate) {
  if (startDate && endDate) return `AND ${col} BETWEEN '${startDate}' AND '${endDate}'`;
  return `AND ${col} >= DATEADD('day', -${days || 30}, CURRENT_DATE())`;
}

function parseRange(req) {
  const days      = parseInt(req.query.days  || '30', 10);
  const startDate = req.query.startDate || null;
  const endDate   = req.query.endDate   || null;
  return { days, startDate, endDate };
}

// ─── GET /seller-analytics/overview ──────────────────────────────────────────
router.get('/overview', requireAuth, async (req, res, next) => {
  try {
    const clientId = await resolveClientId(req);
    const { days, startDate, endDate } = parseRange(req);

    const [kpis, trend, topAsins, prevKpis] = await Promise.all([

      // Current period KPIs (account-level daily totals)
      query(`
        SELECT
          SUM(ordered_units)   AS ordered_units,
          SUM(ordered_revenue) AS ordered_revenue,
          SUM(sessions)        AS sessions,
          SUM(page_views)      AS page_views,
          SUM(sessions * buy_box_pct) / NULLIF(SUM(sessions), 0) AS avg_buy_box_pct,
          SUM(ordered_units) / NULLIF(SUM(sessions), 0) * 100         AS avg_cvr
        FROM ${SCHEMA}.RETAIL_SALES_TRAFFIC
        WHERE client_id = ? AND asin = '__ACCOUNT__'
          ${dateFilter('date', days, startDate, endDate)}
      `, [clientId]),

      // Daily trend (account level)
      query(`
        SELECT date, ordered_units, ordered_revenue, sessions,
               page_views, buy_box_pct, unit_session_pct
        FROM ${SCHEMA}.RETAIL_SALES_TRAFFIC
        WHERE client_id = ? AND asin = '__ACCOUNT__'
          ${dateFilter('date', days, startDate, endDate)}
        ORDER BY date ASC
      `, [clientId]),

      // Top ASINs by ordered revenue (ASIN-level snapshot)
      query(`
        SELECT asin,
          SUM(ordered_units)    AS ordered_units,
          SUM(ordered_revenue)  AS ordered_revenue,
          AVG(buy_box_pct)      AS buy_box_pct,
          AVG(unit_session_pct) AS cvr,
          SUM(sessions)         AS sessions
        FROM ${SCHEMA}.RETAIL_SALES_TRAFFIC
        WHERE client_id = ? AND asin != '__ACCOUNT__'
          ${dateFilter('date', days, startDate, endDate)}
        GROUP BY asin
        ORDER BY ordered_revenue DESC
        LIMIT 25
      `, [clientId]),

      // Previous period for WoW
      query(`
        SELECT
          SUM(ordered_revenue) AS ordered_revenue,
          SUM(sessions)        AS sessions,
          SUM(sessions * buy_box_pct) / NULLIF(SUM(sessions), 0) AS avg_buy_box_pct
        FROM ${SCHEMA}.RETAIL_SALES_TRAFFIC
        WHERE client_id = ? AND asin = '__ACCOUNT__'
          AND date >= DATEADD('day', -(${days || 30} * 2), CURRENT_DATE())
          AND date <  DATEADD('day', -${days || 30}, CURRENT_DATE())
      `, [clientId]),
    ]);

    const k = kpis[0]  || {};
    const p = prevKpis[0] || {};
    const n = (v) => v != null ? Number(v) : null;

    // Buy Box won sessions = sessions × buy_box_pct / 100
    const sessions    = n(k.SESSIONS) || 0;
    const bbPct       = n(k.AVG_BUY_BOX_PCT);
    const bbSessions  = bbPct != null ? Math.round(sessions * bbPct / 100) : null;
    const lostSessions= bbPct != null ? Math.round(sessions * (1 - bbPct / 100)) : null;

    res.json({
      metrics: {
        orderedUnits:     n(k.ORDERED_UNITS),
        orderedRevenue:   n(k.ORDERED_REVENUE),
        sessions,
        pageViews:        n(k.PAGE_VIEWS),
        buyBoxPct:        bbPct,
        cvr:              n(k.AVG_CVR),
        buyBoxSessions:   bbSessions,
        lostSessions,
        // WoW
        prevOrderedRevenue: n(p.ORDERED_REVENUE),
        prevSessions:       n(p.SESSIONS),
        prevBuyBoxPct:      n(p.AVG_BUY_BOX_PCT),
      },
      trend: trend.map(r => ({
        date:         String(r.DATE).slice(0, 10),
        orderedUnits: n(r.ORDERED_UNITS) || 0,
        revenue:      n(r.ORDERED_REVENUE) || 0,
        sessions:     n(r.SESSIONS) || 0,
        buyBoxPct:    n(r.BUY_BOX_PCT),
        cvr:          n(r.UNIT_SESSION_PCT),
      })),
      topAsins: topAsins.map(r => ({
        asin:          r.ASIN,
        orderedUnits:  n(r.ORDERED_UNITS) || 0,
        orderedRevenue:n(r.ORDERED_REVENUE) || 0,
        buyBoxPct:     n(r.BUY_BOX_PCT),
        cvr:           n(r.CVR),
        sessions:      n(r.SESSIONS) || 0,
      })),
    });
  } catch (err) { next(err); }
});

// ─── GET /seller-analytics/buybox ────────────────────────────────────────────
router.get('/buybox', requireAuth, async (req, res, next) => {
  try {
    const clientId = await resolveClientId(req);
    const { days, startDate, endDate } = parseRange(req);

    const [trend, asinBreakdown] = await Promise.all([
      // Daily Buy Box trend
      query(`
        SELECT date, sessions, buy_box_pct,
          sessions * buy_box_pct / 100.0        AS bb_sessions,
          sessions * (1 - buy_box_pct / 100.0)  AS lost_sessions,
          ordered_units, unit_session_pct        AS cvr
        FROM ${SCHEMA}.RETAIL_SALES_TRAFFIC
        WHERE client_id = ? AND asin = '__ACCOUNT__' AND buy_box_pct IS NOT NULL
          ${dateFilter('date', days, startDate, endDate)}
        ORDER BY date ASC
      `, [clientId]),

      // Per-ASIN Buy Box (where we have ASIN-level data)
      query(`
        SELECT asin,
          AVG(buy_box_pct)      AS buy_box_pct,
          SUM(sessions)         AS sessions,
          SUM(ordered_units)    AS ordered_units,
          SUM(ordered_revenue)  AS revenue
        FROM ${SCHEMA}.RETAIL_SALES_TRAFFIC
        WHERE client_id = ? AND asin != '__ACCOUNT__' AND buy_box_pct IS NOT NULL
          ${dateFilter('date', days, startDate, endDate)}
        GROUP BY asin
        ORDER BY sessions DESC
        LIMIT 20
      `, [clientId]),
    ]);

    const n = (v) => v != null ? Number(v) : null;

    res.json({
      trend: trend.map(r => ({
        date:         String(r.DATE).slice(0, 10),
        sessions:     n(r.SESSIONS) || 0,
        buyBoxPct:    n(r.BUY_BOX_PCT),
        bbSessions:   Math.round(n(r.BB_SESSIONS) || 0),
        lostSessions: Math.round(n(r.LOST_SESSIONS) || 0),
        orderedUnits: n(r.ORDERED_UNITS) || 0,
        cvr:          n(r.CVR),
      })),
      asins: asinBreakdown.map(r => ({
        asin:       r.ASIN,
        buyBoxPct:  n(r.BUY_BOX_PCT),
        sessions:   n(r.SESSIONS) || 0,
        orderedUnits: n(r.ORDERED_UNITS) || 0,
        revenue:    n(r.REVENUE) || 0,
      })),
    });
  } catch (err) { next(err); }
});

module.exports = router;
