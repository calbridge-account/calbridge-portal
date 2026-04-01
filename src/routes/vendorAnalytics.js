/**
 * Calbridge Analytics Dashboard API
 * Serves the React calbridge-dash frontend.
 * All routes are scoped to CyberPower's client_id.
 *
 * Routes:
 *   GET /vendor-analytics/overview       — KPIs + weekly trends + top ASINs + forecast table
 *   GET /vendor-analytics/vendor         — inventory health + sell-through KPIs + weekly trend
 *   GET /vendor-analytics/vendor/asins   — ASIN-level inventory detail table
 *   GET /vendor-analytics/advertising    — combined + per-type ad metrics (SP/SB/SD/DSP)
 *   GET /vendor-analytics/forecasting    — all ASINs forecast table + top 20 bar data
 */

const express = require('express');
const router = express.Router();
const { query } = require('../services/snowflakeService');
const { requireAuth } = require('../middleware/requireAuth');

// Production database
const SCHEMA = 'CALBRIDGE_PROD.RAW';

/**
 * Resolve client ID — session takes priority, falls back to CyberPower for
 * backwards compatibility while we finish portal wiring.
 */
function getClientId(req) {
  return req.session?.clientId || '7d88ea17-002b-4a02-97fc-bcab1292d57e';
}

/**
 * Parse date range from query params.
 * Supports:
 *   ?range=4w | 8w | 12w | 26w | 52w      (rolling weeks)
 *   ?range=ytd                              (Jan 1 to today)
 *   ?range=custom&start=YYYY-MM-DD&end=YYYY-MM-DD
 * Default: 12 weeks rolling
 */
function parseDateRange(req) {
  const range = req.query.range || '12w';
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  if (range === 'ytd') {
    const start = new Date(today.getUTCFullYear(), 0, 1);
    return { start: start.toISOString().split('T')[0], end: today.toISOString().split('T')[0], label: 'YTD' };
  }

  if (range === 'custom') {
    const start = req.query.start || new Date(today - 84 * 86400000).toISOString().split('T')[0];
    const end   = req.query.end   || today.toISOString().split('T')[0];
    return { start, end, label: 'Custom' };
  }

  // Rolling weeks: 4w, 8w, 12w, 26w, 52w
  const weeks = parseInt(range) || 12;
  const start = new Date(today - weeks * 7 * 86400000);
  return {
    start: start.toISOString().split('T')[0],
    end: today.toISOString().split('T')[0],
    label: `${weeks}W`
  };
}

function dateStr(d) {
  if (!d) return null;
  if (d instanceof Date) return d.toISOString().substring(0, 10);
  const s = String(d?.value ?? d);
  return s.substring(0, 10);
}

function n(v) {
  return v == null ? null : Number(v);
}

/**
 * Compute the week-start cutoff date (Sunday-based ISO weeks).
 * weeks=12 → 12 complete weeks ago from current week start.
 */
function weekCutoff(weeks) {
  const now = new Date();
  // Roll back to Sunday of current week
  const day = now.getUTCDay(); // 0=Sun
  const sun = new Date(now);
  sun.setUTCDate(now.getUTCDate() - day - (weeks * 7));
  return sun.toISOString().substring(0, 10);
}

// ─── GET /vendor-analytics/overview ──────────────────────────────────────────
router.get('/overview', async (req, res, next) => {
  try {
    const CLIENT_ID = getClientId(req);
    const { start: cutoff, end: rangeEnd, label: rangeLabel } = parseDateRange(req);
    // Previous period cutoff = 7 days before the start of the range
    const prevCutoffDate = new Date(cutoff); prevCutoffDate.setDate(prevCutoffDate.getDate() - 7);
    const prevCutoff = prevCutoffDate.toISOString().split('T')[0];
    const weeks = req.query.weeks || 12;

    // One week back from cutoff for WoW prior period comparison
    const prevPeriodStart = new Date(cutoff); prevPeriodStart.setDate(prevPeriodStart.getDate() - 7);
    const prevPeriodStartStr = prevPeriodStart.toISOString().split('T')[0];

    const [salesAgg, prevSalesAgg, trafficAgg, prevTrafficAgg, ppmAgg, prevPpmAgg,
           adSpendAgg, prevAdSpendAgg,
           weeklyTrend, topAsins, forecastTable,
           growthRevCur, growthRevPrv, growthGVCur, growthGVPrv,
           stockoutRisk, adEffCur, adEffPrv] = await Promise.all([

      // Current period aggregates
      query(`
        SELECT
          SUM(shipped_revenue) AS shipped_revenue,
          SUM(shipped_cogs)    AS shipped_cogs,
          SUM(shipped_units)   AS shipped_units,
          SUM(ordered_revenue) AS ordered_revenue,
          SUM(ordered_units)   AS ordered_units
        FROM ${SCHEMA}.RETAIL_SALES_TRAFFIC
        WHERE client_id = ? AND date BETWEEN ? AND ?
      `, [CLIENT_ID, cutoff, rangeEnd]),

      // Previous week only (for WoW)
      query(`
        SELECT
          SUM(shipped_revenue) AS shipped_revenue,
          SUM(shipped_cogs)    AS shipped_cogs
        FROM ${SCHEMA}.RETAIL_SALES_TRAFFIC
        WHERE client_id = ? AND date >= ? AND date < ?
      `, [CLIENT_ID, prevCutoff, cutoff]),

      // Current glance views
      query(`
        SELECT SUM(glance_views) AS glance_views
        FROM ${SCHEMA}.RETAIL_TRAFFIC
        WHERE client_id = ? AND date BETWEEN ? AND ?
      `, [CLIENT_ID, cutoff, rangeEnd]),

      // Previous glance views
      query(`
        SELECT SUM(glance_views) AS glance_views
        FROM ${SCHEMA}.RETAIL_TRAFFIC
        WHERE client_id = ? AND date >= ? AND date < ?
      `, [CLIENT_ID, prevCutoff, cutoff]),

      // Net PPM — avg of weekly values
      query(`
        SELECT AVG(net_pure_product_margin) AS net_ppm
        FROM ${SCHEMA}.RETAIL_NET_PPM
        WHERE client_id = ? AND date BETWEEN ? AND ?
      `, [CLIENT_ID, cutoff, rangeEnd]),

      // Previous net PPM
      query(`
        SELECT AVG(net_pure_product_margin) AS net_ppm
        FROM ${SCHEMA}.RETAIL_NET_PPM
        WHERE client_id = ? AND date >= ? AND date < ?
      `, [CLIENT_ID, prevCutoff, cutoff]),

      // Current period total ad spend (all ad types)
      query(`
        SELECT SUM(cost) AS total_ad_spend
        FROM CALBRIDGE_PROD.RAW.AD_CAMPAIGN
        WHERE client_id = ? AND date BETWEEN ? AND ?
      `, [CLIENT_ID, cutoff, rangeEnd]),

      // Previous period total ad spend (for WoW on proceeds_after_ads)
      query(`
        SELECT SUM(cost) AS total_ad_spend
        FROM CALBRIDGE_PROD.RAW.AD_CAMPAIGN
        WHERE client_id = ? AND date >= ? AND date < ?
      `, [CLIENT_ID, prevCutoff, cutoff]),

      // Weekly trend: shipped + ordered revenue by week
      query(`
        SELECT
          TO_VARCHAR(date, 'YYYY-MM-DD') AS week,
          date,
          SUM(shipped_revenue) AS shipped_revenue,
          SUM(ordered_revenue) AS ordered_revenue,
          SUM(shipped_units)   AS shipped_units
        FROM ${SCHEMA}.RETAIL_SALES_TRAFFIC
        WHERE client_id = ? AND date BETWEEN ? AND ?
        GROUP BY date
        ORDER BY date ASC
      `, [CLIENT_ID, cutoff, rangeEnd]),

      // Top 10 ASINs by shipped revenue (last 4 weeks) + their ad spend
      query(`
        SELECT
          s.asin,
          MAX(p.title)           AS title,
          SUM(s.shipped_revenue) AS shipped_revenue,
          SUM(s.shipped_units)   AS shipped_units,
          SUM(s.shipped_cogs)    AS shipped_cogs
        FROM ${SCHEMA}.RETAIL_SALES_TRAFFIC s
        LEFT JOIN ${SCHEMA}.RETAIL_LISTING p
          ON p.client_id = s.client_id AND p.asin = s.asin
        WHERE s.client_id = ? AND s.date >= DATEADD('week', -4, CURRENT_DATE)
        GROUP BY s.asin
        ORDER BY shipped_revenue DESC NULLS LAST
        LIMIT 10
      `, [CLIENT_ID]),

      // Demand forecast table: top 20 ASINs by mean forecast (next 4 weeks summed)
      query(`
        WITH next4 AS (
          SELECT
            f.asin,
            MAX(p.title)                AS title,
            SUM(f.mean_forecast_units)  AS mean_forecast,
            SUM(f.p70_forecast_units)   AS p70,
            SUM(f.p80_forecast_units)   AS p80,
            SUM(f.p90_forecast_units)   AS p90
          FROM ${SCHEMA}.RETAIL_FORECAST f
          LEFT JOIN ${SCHEMA}.RETAIL_LISTING p
            ON p.client_id = f.client_id AND p.asin = f.asin
          WHERE f.client_id = ?
            AND f.start_date >= CURRENT_DATE
            AND f.start_date <= DATEADD('week', 4, CURRENT_DATE)
          GROUP BY f.asin
        )
        SELECT * FROM next4
        ORDER BY mean_forecast DESC NULLS LAST
        LIMIT 20
      `, [CLIENT_ID]),

      // Growth: current week revenue (last 7 days)
      query(`
        SELECT SUM(shipped_revenue) AS revenue
        FROM ${SCHEMA}.RETAIL_SALES_TRAFFIC
        WHERE client_id = ? AND date >= DATEADD('day', -7, CURRENT_DATE)
      `, [CLIENT_ID]),

      // Growth: prior week revenue (7-14 days ago)
      query(`
        SELECT SUM(shipped_revenue) AS revenue
        FROM ${SCHEMA}.RETAIL_SALES_TRAFFIC
        WHERE client_id = ? AND date >= DATEADD('day', -14, CURRENT_DATE) AND date < DATEADD('day', -7, CURRENT_DATE)
      `, [CLIENT_ID]),

      // Growth: current week glance views
      query(`
        SELECT SUM(glance_views) AS glance_views
        FROM ${SCHEMA}.RETAIL_TRAFFIC
        WHERE client_id = ? AND date >= DATEADD('day', -7, CURRENT_DATE)
      `, [CLIENT_ID]),

      // Growth: prior week glance views
      query(`
        SELECT SUM(glance_views) AS glance_views
        FROM ${SCHEMA}.RETAIL_TRAFFIC
        WHERE client_id = ? AND date >= DATEADD('day', -14, CURRENT_DATE) AND date < DATEADD('day', -7, CURRENT_DATE)
      `, [CLIENT_ID]),

      // Stockout risk: ASINs where sellable_on_hand < 2x weekly forecast
      query(`
        WITH latest_inv AS (
          SELECT asin, SUM(sellable_on_hand_units) AS sellable_on_hand
          FROM ${SCHEMA}.RETAIL_INVENTORY
          WHERE client_id = ?
            AND date = (SELECT MAX(date) FROM ${SCHEMA}.RETAIL_INVENTORY WHERE client_id = ?)
          GROUP BY asin
        ),
        next2w_forecast AS (
          SELECT asin, SUM(mean_forecast_units) / 2.0 AS weekly_mean_forecast
          FROM ${SCHEMA}.RETAIL_FORECAST
          WHERE client_id = ?
            AND start_date >= CURRENT_DATE
            AND start_date <= DATEADD('week', 2, CURRENT_DATE)
          GROUP BY asin
        )
        SELECT COUNT(*) AS at_risk_count
        FROM latest_inv i
        JOIN next2w_forecast f ON f.asin = i.asin
        WHERE i.sellable_on_hand < (f.weekly_mean_forecast * 2)
      `, [CLIENT_ID, CLIENT_ID, CLIENT_ID]),

      // Ad efficiency: current period ACoS (SP only, last 7 days)
      query(`
        SELECT
          SUM(cost) AS spend,
          SUM(sales_14d) AS sales
        FROM CALBRIDGE_PROD.RAW.AD_CAMPAIGN
        WHERE client_id = ? AND ad_product = 'SPONSORED_PRODUCTS'
          AND date >= DATEADD('day', -7, CURRENT_DATE)
      `, [CLIENT_ID]),

      // Ad efficiency: prior period ACoS (SP only, 7-14 days ago)
      query(`
        SELECT
          SUM(cost) AS spend,
          SUM(sales_14d) AS sales
        FROM CALBRIDGE_PROD.RAW.AD_CAMPAIGN
        WHERE client_id = ? AND ad_product = 'SPONSORED_PRODUCTS'
          AND date >= DATEADD('day', -14, CURRENT_DATE) AND date < DATEADD('day', -7, CURRENT_DATE)
      `, [CLIENT_ID]),
    ]);

    // Note: AD_CAMPAIGN is campaign-level (no ASIN column), so per-ASIN ad spend
    // is not available. We use shipped_cogs as the proceeds_after_ads proxy for top ASINs.
    // Total-level proceeds_after_ads uses the campaign-level total ad spend.
    const asinAdSpendMap = {}; // empty — no ASIN-level ad data available

    const curShippedCogs  = n(salesAgg[0]?.SHIPPED_COGS) || 0;
    const curAdSpend      = n(adSpendAgg[0]?.TOTAL_AD_SPEND) || 0;
    const prevShippedCogs = n(prevSalesAgg[0]?.SHIPPED_COGS) || 0;
    const prevAdSpend     = n(prevAdSpendAgg[0]?.TOTAL_AD_SPEND) || 0;
    const proceedsAfterAds     = curShippedCogs - curAdSpend;
    const prevProceedsAfterAds = prevShippedCogs - prevAdSpend;

    // Growth signals computation
    const curRevWoW  = n(growthRevCur[0]?.REVENUE);
    const prvRevWoW  = n(growthRevPrv[0]?.REVENUE);
    const curGVWoW   = n(growthGVCur[0]?.GLANCE_VIEWS);
    const prvGVWoW   = n(growthGVPrv[0]?.GLANCE_VIEWS);
    const stockoutCount = n(stockoutRisk[0]?.AT_RISK_COUNT) || 0;
    const curAdEff   = { spend: n(adEffCur[0]?.SPEND) || 0, sales: n(adEffCur[0]?.SALES) || 0 };
    const prvAdEff   = { spend: n(adEffPrv[0]?.SPEND) || 0, sales: n(adEffPrv[0]?.SALES) || 0 };
    const curAcos    = curAdEff.sales > 0 ? curAdEff.spend / curAdEff.sales : null;
    const prvAcos    = prvAdEff.sales > 0 ? prvAdEff.spend / prvAdEff.sales : null;

    res.json({
      metrics: {
        shippedRevenue:       n(salesAgg[0]?.SHIPPED_REVENUE),
        shippedCogs:          curShippedCogs,
        shippedUnits:         n(salesAgg[0]?.SHIPPED_UNITS),
        orderedRevenue:       n(salesAgg[0]?.ORDERED_REVENUE),
        orderedUnits:         n(salesAgg[0]?.ORDERED_UNITS),
        glanceViews:          n(trafficAgg[0]?.GLANCE_VIEWS),
        netPpm:               n(ppmAgg[0]?.NET_PPM),
        // Proceeds after Ads
        proceedsAfterAds,
        prevProceedsAfterAds,
        totalAdSpend:         curAdSpend,
        // Previous period (for WoW badge)
        prevShippedRevenue:   n(prevSalesAgg[0]?.SHIPPED_REVENUE),
        prevShippedCogs:      prevShippedCogs,
        prevGlanceViews:      n(prevTrafficAgg[0]?.GLANCE_VIEWS),
        prevNetPpm:           n(prevPpmAgg[0]?.NET_PPM),
      },
      weeklyTrend: weeklyTrend.map(r => ({
        week:            r.WEEK,
        startDate: dateStr(r.DATE),
        shippedRevenue:  n(r.SHIPPED_REVENUE),
        orderedRevenue:  n(r.ORDERED_REVENUE),
        shippedUnits:    n(r.SHIPPED_UNITS),
      })),
      topAsins: topAsins.map(r => {
        const adSpend = asinAdSpendMap[r.ASIN] || 0;
        const cogs    = n(r.SHIPPED_COGS) || 0;
        return {
          asin:             r.ASIN,
          model:            r.MODEL_NUMBER || r.TITLE || r.ASIN,
          title:            r.TITLE || r.ASIN,
          shippedRevenue:   n(r.SHIPPED_REVENUE),
          shippedUnits:     n(r.SHIPPED_UNITS),
          proceedsAfterAds: cogs - adSpend,
        };
      }),
      growthSignals: {
        revenueGrowthWoW: {
          current:   curRevWoW,
          previous:  prvRevWoW,
          pctChange: prvRevWoW && prvRevWoW !== 0
            ? ((curRevWoW - prvRevWoW) / Math.abs(prvRevWoW)) * 100
            : null,
        },
        glanceViewGrowthWoW: {
          current:   curGVWoW,
          previous:  prvGVWoW,
          pctChange: prvGVWoW && prvGVWoW !== 0
            ? ((curGVWoW - prvGVWoW) / Math.abs(prvGVWoW)) * 100
            : null,
        },
        stockoutRisk: {
          atRiskCount: stockoutCount,
        },
        adEfficiencyTrend: {
          currentAcos:  curAcos,
          previousAcos: prvAcos,
          improving:    curAcos != null && prvAcos != null ? curAcos < prvAcos : null,
        },
      },
      forecastTable: forecastTable.map(r => ({
        asin:         r.ASIN,
        model:        r.MODEL_NUMBER || r.TITLE,
        title:        r.TITLE,
        meanForecast: n(r.MEAN_FORECAST),
        p70:          n(r.P70),
        p80:          n(r.P80),
        p90:          n(r.P90),
      })),
      weeks: req.query.weeks || 12,
      range: { start: cutoff, end: rangeEnd, label: rangeLabel },
    });
  } catch (err) { next(err); }
});

// ─── GET /vendor-analytics/vendor ────────────────────────────────────────────
router.get('/vendor', async (req, res, next) => {
  try {
    const CLIENT_ID = getClientId(req);
    const { start: cutoff, end: rangeEnd, label: rangeLabel } = parseDateRange(req);
    const weeks = req.query.weeks || 12;

    const [invAgg, weeklyInv, weeklyUnits] = await Promise.all([

      // Aggregate inventory KPIs
      query(`
        SELECT
          AVG(sell_through_rate)          AS avg_sell_through,
          AVG(vendor_confirmation_rate)   AS avg_conf_rate,
          AVG(receive_fill_rate)          AS avg_fill_rate,
          AVG(avg_vendor_lead_time_days)  AS avg_lead_time,
          SUM(sellable_on_hand_units)     AS total_sellable,
          SUM(aged_90_plus_units)         AS total_aged_90,
          SUM(unhealthy_units)            AS total_unhealthy,
          SUM(unfilled_customer_ordered_units) AS total_oos
        FROM ${SCHEMA}.RETAIL_INVENTORY
        WHERE client_id = ? AND date BETWEEN ? AND ?
      `, [CLIENT_ID, cutoff, rangeEnd]),

      // Weekly sell-through rate trend
      query(`
        SELECT
          TO_VARCHAR(date, 'YYYY-MM-DD') AS week,
          date,
          AVG(sell_through_rate)          AS sell_through_rate,
          AVG(vendor_confirmation_rate)   AS conf_rate,
          AVG(receive_fill_rate)          AS fill_rate
        FROM ${SCHEMA}.RETAIL_INVENTORY
        WHERE client_id = ? AND date BETWEEN ? AND ?
        GROUP BY date
        ORDER BY date ASC
      `, [CLIENT_ID, cutoff, rangeEnd]),

      // Weekly ordered vs shipped units
      query(`
        SELECT
          TO_VARCHAR(date, 'YYYY-MM-DD') AS week,
          date,
          SUM(ordered_units)  AS ordered_units,
          SUM(shipped_units)  AS shipped_units
        FROM ${SCHEMA}.RETAIL_SALES_TRAFFIC
        WHERE client_id = ? AND date BETWEEN ? AND ?
        GROUP BY date
        ORDER BY date ASC
      `, [CLIENT_ID, cutoff, rangeEnd]),
    ]);

    res.json({
      metrics: {
        avgSellThrough:       n(invAgg[0]?.AVG_SELL_THROUGH),
        avgConfRate:          n(invAgg[0]?.AVG_CONF_RATE),
        avgFillRate:          n(invAgg[0]?.AVG_FILL_RATE),
        avgLeadTime:          n(invAgg[0]?.AVG_LEAD_TIME),
        totalSellable:        n(invAgg[0]?.TOTAL_SELLABLE),
        totalAged90:          n(invAgg[0]?.TOTAL_AGED_90),
        totalUnhealthy:       n(invAgg[0]?.TOTAL_UNHEALTHY),
        totalOos:             n(invAgg[0]?.TOTAL_OOS),
      },
      weeklyInventoryTrend: weeklyInv.map(r => ({
        week:          r.WEEK,
        startDate:     dateStr(r.START_DATE),
        sellThrough:   n(r.SELL_THROUGH_RATE),
        confRate:      n(r.CONF_RATE),
        fillRate:      n(r.FILL_RATE),
      })),
      weeklyUnits: weeklyUnits.map(r => ({
        week:         r.WEEK,
        startDate:    dateStr(r.START_DATE),
        orderedUnits: n(r.ORDERED_UNITS),
        shippedUnits: n(r.SHIPPED_UNITS),
      })),
      weeks: req.query.weeks || 12,
      range: { start: cutoff, end: rangeEnd, label: rangeLabel },
    });
  } catch (err) { next(err); }
});

// ─── GET /vendor-analytics/vendor/asins ──────────────────────────────────────
router.get('/vendor/asins', async (req, res, next) => {
  try {
    const CLIENT_ID = getClientId(req);
    const { start: cutoff, end: rangeEnd, label: rangeLabel } = parseDateRange(req);
    const weeks = req.query.weeks || 12;

    const [rows, shippedCogsByAsin] = await Promise.all([
      query(`
        SELECT
          i.asin,
          MAX(p.title)                        AS title,
          MAX(p.model_number)                 AS model_number,
          SUM(i.sellable_on_hand_units)       AS sellable_on_hand,
          SUM(i.aged_90_plus_units)           AS aged_90_plus,
          SUM(i.unhealthy_units)              AS unhealthy,
          SUM(i.unfilled_customer_ordered_units) AS oos_units,
          AVG(i.sell_through_rate)            AS sell_through,
          AVG(i.vendor_confirmation_rate)     AS conf_rate,
          AVG(i.receive_fill_rate)            AS fill_rate,
          AVG(i.avg_vendor_lead_time_days)    AS lead_time
        FROM ${SCHEMA}.RETAIL_INVENTORY i
        LEFT JOIN ${SCHEMA}.RETAIL_LISTING p
          ON p.client_id = i.client_id AND p.asin = i.asin
        WHERE i.client_id = ? AND i.date >= ?
        GROUP BY i.asin
        ORDER BY sellable_on_hand DESC NULLS LAST
      `, [CLIENT_ID, cutoff, rangeEnd]),

      // Per-ASIN shipped_cogs (AD_CAMPAIGN has no ASIN column, so ad spend is total-only)
      query(`
        SELECT asin, SUM(shipped_cogs) AS shipped_cogs
        FROM ${SCHEMA}.RETAIL_SALES_TRAFFIC
        WHERE client_id = ? AND date BETWEEN ? AND ?
        GROUP BY asin
      `, [CLIENT_ID, cutoff, rangeEnd]),
    ]);

    // Note: total ad spend is available but not ASIN-level (AD_CAMPAIGN is campaign-level)
    // We show shipped_cogs per ASIN; proceedsAfterAds here means shipped_cogs only
    // (cannot subtract per-ASIN ad spend without an ASIN-level ad table)
    const cogsMap = {};
    for (const r of shippedCogsByAsin) {
      cogsMap[r.ASIN] = n(r.SHIPPED_COGS) || 0;
    }

    res.json({
      asins: rows.map(r => {
        const shippedCogs = cogsMap[r.ASIN] || null;
        return {
          asin:             r.ASIN,
          model:            r.MODEL_NUMBER || r.TITLE,
          title:            r.TITLE,
          sellableOnHand:   n(r.SELLABLE_ON_HAND),
          aged90Plus:       n(r.AGED_90_PLUS),
          unhealthy:        n(r.UNHEALTHY),
          oosUnits:         n(r.OOS_UNITS),
          sellThrough:      n(r.SELL_THROUGH),
          confRate:         n(r.CONF_RATE),
          fillRate:         n(r.FILL_RATE),
          leadTime:         n(r.LEAD_TIME),
          shippedCogs,
          // proceedsAfterAds requires ASIN-level ad data (not available in AD_CAMPAIGN)
          proceedsAfterAds: shippedCogs,
        };
      }),
      weeks: req.query.weeks || 12,
      range: { start: cutoff, end: rangeEnd, label: rangeLabel },
    });
  } catch (err) { next(err); }
});

// ─── GET /vendor-analytics/advertising ───────────────────────────────────────
// Returns combined metrics + per-type breakdown for SP, SB, SD, DSP
router.get('/advertising', async (req, res, next) => {
  try {
    const CLIENT_ID = getClientId(req);
    const { start: cutoff, end: rangeEnd, label: rangeLabel } = parseDateRange(req);
    const weeks = req.query.weeks || 12;

    const [spAgg, sbAgg, sdAgg, dspAgg,
           spWeekly, sbWeekly, sdWeekly, dspWeekly,
           spCampaigns, sbCampaigns, sdCampaigns, dspOrders] = await Promise.all([

      // ── SP aggregate ──
      query(`
        SELECT
          SUM(cost)            AS spend,
          SUM(sales_14d)      AS sales,
          SUM(purchases_14d)  AS purchases,
          SUM(clicks)          AS clicks,
          SUM(impressions)     AS impressions
        FROM CALBRIDGE_PROD.RAW.AD_CAMPAIGN
        WHERE client_id = ? AND ad_product = 'SPONSORED_PRODUCTS' AND date BETWEEN ? AND ?
      `, [CLIENT_ID, cutoff, rangeEnd]),

      // ── SB aggregate ──
      query(`
        SELECT
          SUM(cost)          AS spend,
          SUM(sales_14d)         AS sales,
          SUM(purchases_14d)     AS purchases,
          SUM(clicks)        AS clicks,
          SUM(impressions)   AS impressions,
          SUM(ntb_orders_14d) AS ntb_purchases,
          SUM(ntb_sales_14d)     AS ntb_sales
        FROM CALBRIDGE_PROD.RAW.AD_CAMPAIGN
        WHERE client_id = ? AND ad_product = 'SPONSORED_BRANDS' AND date BETWEEN ? AND ?
      `, [CLIENT_ID, cutoff, rangeEnd]),

      // ── SD aggregate ──
      query(`
        SELECT
          SUM(cost)          AS spend,
          SUM(sales_14d)         AS sales,
          SUM(purchases_14d)     AS purchases,
          SUM(clicks)        AS clicks,
          SUM(impressions)   AS impressions,
          SUM(ntb_orders_14d) AS ntb_purchases,
          SUM(ntb_sales_14d)     AS ntb_sales
        FROM CALBRIDGE_PROD.RAW.AD_CAMPAIGN
        WHERE client_id = ? AND ad_product = 'SPONSORED_DISPLAY' AND date BETWEEN ? AND ?
      `, [CLIENT_ID, cutoff, rangeEnd]),

      // ── DSP aggregate ── (uses total_cost not cost)
      query(`
        SELECT
          SUM(cost)            AS spend,
          SUM(sales_14d)           AS sales,
          SUM(purchases_14d)       AS purchases,
          SUM(clicks)                AS clicks,
          SUM(impressions)           AS impressions,
          SUM(viewable_impressions)  AS viewable_impressions,
          SUM(0)     AS detail_page_views,
          SUM(ntb_orders_14d) AS ntb_purchases,
          SUM(ntb_sales_14d) AS ntb_sales
        FROM CALBRIDGE_PROD.RAW.AD_CAMPAIGN
        WHERE client_id = ? AND ad_product = 'DSP' AND date BETWEEN ? AND ?
      `, [CLIENT_ID, cutoff, rangeEnd]),

      // ── SP weekly trend ──
      query(`
        SELECT
          DATE_TRUNC('week', date) AS week_start,
          TO_VARCHAR(DATE_TRUNC('week', date), 'YYYY-MM-DD') AS week,
          SUM(cost)           AS spend,
          SUM(sales_14d)     AS sales,
          SUM(impressions)    AS impressions,
          SUM(clicks)         AS clicks
        FROM CALBRIDGE_PROD.RAW.AD_CAMPAIGN
        WHERE client_id = ? AND ad_product = 'SPONSORED_PRODUCTS' AND date BETWEEN ? AND ?
        GROUP BY DATE_TRUNC('week', date)
        ORDER BY week_start ASC
      `, [CLIENT_ID, cutoff, rangeEnd]),

      // ── SB weekly trend ──
      query(`
        SELECT
          DATE_TRUNC('week', date) AS week_start,
          TO_VARCHAR(DATE_TRUNC('week', date), 'YYYY-MM-DD') AS week,
          SUM(cost)       AS spend,
          SUM(sales_14d)      AS sales,
          SUM(impressions) AS impressions,
          SUM(clicks)     AS clicks
        FROM CALBRIDGE_PROD.RAW.AD_CAMPAIGN
        WHERE client_id = ? AND ad_product = 'SPONSORED_BRANDS' AND date BETWEEN ? AND ?
        GROUP BY DATE_TRUNC('week', date)
        ORDER BY week_start ASC
      `, [CLIENT_ID, cutoff, rangeEnd]),

      // ── SD weekly trend ──
      query(`
        SELECT
          DATE_TRUNC('week', date) AS week_start,
          TO_VARCHAR(DATE_TRUNC('week', date), 'YYYY-MM-DD') AS week,
          SUM(cost)       AS spend,
          SUM(sales_14d)      AS sales,
          SUM(impressions) AS impressions,
          SUM(clicks)     AS clicks
        FROM CALBRIDGE_PROD.RAW.AD_CAMPAIGN
        WHERE client_id = ? AND ad_product = 'SPONSORED_DISPLAY' AND date BETWEEN ? AND ?
        GROUP BY DATE_TRUNC('week', date)
        ORDER BY week_start ASC
      `, [CLIENT_ID, cutoff, rangeEnd]),

      // ── DSP weekly trend ──
      query(`
        SELECT
          DATE_TRUNC('week', date) AS week_start,
          TO_VARCHAR(DATE_TRUNC('week', date), 'YYYY-MM-DD') AS week,
          SUM(cost)           AS spend,
          SUM(sales_14d)          AS sales,
          SUM(impressions)          AS impressions,
          SUM(viewable_impressions) AS viewable_impressions,
          SUM(clicks)               AS clicks
        FROM CALBRIDGE_PROD.RAW.AD_CAMPAIGN
        WHERE client_id = ? AND ad_product = 'DSP' AND date BETWEEN ? AND ?
        GROUP BY DATE_TRUNC('week', date)
        ORDER BY week_start ASC
      `, [CLIENT_ID, cutoff, rangeEnd]),

      // ── SP top campaigns ──
      query(`
        SELECT
          campaign_id,
          campaign_name,
          status,
          SUM(cost)           AS spend,
          SUM(sales_14d)     AS sales,
          SUM(purchases_14d) AS purchases,
          SUM(impressions)    AS impressions,
          SUM(clicks)         AS clicks,
          CASE WHEN SUM(sales_14d) > 0 THEN SUM(cost)/SUM(sales_14d) ELSE NULL END AS acos,
          CASE WHEN SUM(cost) > 0 THEN SUM(sales_14d)/SUM(cost) ELSE NULL END AS roas
        FROM CALBRIDGE_PROD.RAW.AD_CAMPAIGN
        WHERE client_id = ? AND ad_product = 'SPONSORED_PRODUCTS' AND date BETWEEN ? AND ?
        GROUP BY campaign_id, campaign_name, status
        ORDER BY spend DESC NULLS LAST
        LIMIT 20
      `, [CLIENT_ID, cutoff, rangeEnd]),

      // ── SB top campaigns ──
      query(`
        SELECT
          campaign_id,
          campaign_name,
          status,
          SUM(cost)       AS spend,
          SUM(sales_14d)      AS sales,
          SUM(purchases_14d)  AS purchases,
          SUM(impressions) AS impressions,
          SUM(clicks)     AS clicks,
          SUM(ntb_orders_14d) AS ntb_purchases,
          SUM(ntb_sales_14d)     AS ntb_sales,
          CASE WHEN SUM(sales_14d) > 0 THEN SUM(cost)/SUM(sales_14d) ELSE NULL END AS acos,
          CASE WHEN SUM(cost) > 0 THEN SUM(sales_14d)/SUM(cost) ELSE NULL END AS roas
        FROM CALBRIDGE_PROD.RAW.AD_CAMPAIGN
        WHERE client_id = ? AND ad_product = 'SPONSORED_BRANDS' AND date BETWEEN ? AND ?
        GROUP BY campaign_id, campaign_name, status
        ORDER BY spend DESC NULLS LAST
        LIMIT 20
      `, [CLIENT_ID, cutoff, rangeEnd]),

      // ── SD top campaigns ──
      query(`
        SELECT
          campaign_id,
          campaign_name,
          status,
          SUM(cost)       AS spend,
          SUM(sales_14d)      AS sales,
          SUM(purchases_14d)  AS purchases,
          SUM(impressions) AS impressions,
          SUM(clicks)     AS clicks,
          SUM(ntb_orders_14d) AS ntb_purchases,
          SUM(ntb_sales_14d)     AS ntb_sales,
          CASE WHEN SUM(sales_14d) > 0 THEN SUM(cost)/SUM(sales_14d) ELSE NULL END AS acos,
          CASE WHEN SUM(cost) > 0 THEN SUM(sales_14d)/SUM(cost) ELSE NULL END AS roas
        FROM CALBRIDGE_PROD.RAW.AD_CAMPAIGN
        WHERE client_id = ? AND ad_product = 'SPONSORED_DISPLAY' AND date BETWEEN ? AND ?
        GROUP BY campaign_id, campaign_name, status
        ORDER BY spend DESC NULLS LAST
        LIMIT 20
      `, [CLIENT_ID, cutoff, rangeEnd]),

      // ── DSP top orders ── (DSP groups by order/line, not campaign)
      query(`
        SELECT
          campaign_id,
          campaign_name,
          SUM(cost)            AS spend,
          SUM(sales_14d)           AS sales,
          SUM(purchases_14d)       AS purchases,
          SUM(impressions)           AS impressions,
          SUM(viewable_impressions)  AS viewable_impressions,
          SUM(clicks)                AS clicks,
          SUM(0)     AS detail_page_views,
          SUM(ntb_orders_14d) AS ntb_purchases,
          SUM(ntb_sales_14d) AS ntb_sales,
          CASE WHEN SUM(sales_14d) > 0 THEN SUM(cost)/SUM(sales_14d) ELSE NULL END AS acos,
          CASE WHEN SUM(cost) > 0 THEN SUM(sales_14d)/SUM(cost) ELSE NULL END AS roas
        FROM CALBRIDGE_PROD.RAW.AD_CAMPAIGN
        WHERE client_id = ? AND ad_product = 'DSP' AND date BETWEEN ? AND ?
        GROUP BY campaign_id, campaign_name
        ORDER BY spend DESC NULLS LAST
        LIMIT 20
      `, [CLIENT_ID, cutoff, rangeEnd]),
    ]);

    // Helper to compute summary from agg row
    function aggSummary(r, label) {
      const spend = n(r?.SPEND) ?? 0;
      const sales = n(r?.SALES) ?? 0;
      return {
        type:       label,
        spend,
        sales,
        purchases:  n(r?.PURCHASES),
        clicks:     n(r?.CLICKS),
        impressions: n(r?.IMPRESSIONS),
        acos:       sales > 0 ? spend / sales : null,
        roas:       spend > 0 ? sales / spend : null,
        ntbPurchases: n(r?.NTB_PURCHASES),
        ntbSales:     n(r?.NTB_SALES),
        // DSP extras
        viewableImpressions: n(r?.VIEWABLE_IMPRESSIONS),
        detailPageViews:     n(r?.DETAIL_PAGE_VIEWS),
      };
    }

    const sp  = aggSummary(spAgg[0],  'SP');
    const sb  = aggSummary(sbAgg[0],  'SB');
    const sd  = aggSummary(sdAgg[0],  'SD');
    const dsp = aggSummary(dspAgg[0], 'DSP');

    const totalSpend = (sp.spend || 0) + (sb.spend || 0) + (sd.spend || 0) + (dsp.spend || 0);
    const totalSales = (sp.sales || 0) + (sb.sales || 0) + (sd.sales || 0) + (dsp.sales || 0);

    // Merge weekly trends into a single timeline keyed by week
    function mergeWeekly(arr) {
      return arr.map(r => ({
        week:                r.WEEK,
        weekStart:           dateStr(r.WEEK_START),
        spend:               n(r.SPEND),
        sales:               n(r.SALES),
        impressions:         n(r.IMPRESSIONS),
        clicks:              n(r.CLICKS),
        viewableImpressions: n(r.VIEWABLE_IMPRESSIONS),
      }));
    }

    function mapCampaign(r) {
      return {
        campaignId:   String(r.CAMPAIGN_ID || r.ORDER_ID),
        campaignName: r.CAMPAIGN_NAME || r.ORDER_NAME,
        status:       r.CAMPAIGN_STATUS || 'ENABLED',
        spend:        n(r.SPEND),
        sales:        n(r.SALES),
        purchases:    n(r.PURCHASES),
        impressions:  n(r.IMPRESSIONS),
        clicks:       n(r.CLICKS),
        acos:         n(r.ACOS),
        roas:         n(r.ROAS),
        ntbPurchases: n(r.NTB_PURCHASES),
        ntbSales:     n(r.NTB_SALES),
        viewableImpressions: n(r.VIEWABLE_IMPRESSIONS),
        detailPageViews:     n(r.DETAIL_PAGE_VIEWS),
      };
    }

    res.json({
      combined: {
        totalSpend,
        totalSales,
        blendedAcos: totalSales > 0 ? totalSpend / totalSales : null,
        blendedRoas: totalSpend > 0 ? totalSales / totalSpend : null,
      },
      byType: { sp, sb, sd, dsp },
      weekly: {
        sp:  mergeWeekly(spWeekly),
        sb:  mergeWeekly(sbWeekly),
        sd:  mergeWeekly(sdWeekly),
        dsp: mergeWeekly(dspWeekly),
      },
      campaigns: {
        sp:  spCampaigns.map(mapCampaign),
        sb:  sbCampaigns.map(mapCampaign),
        sd:  sdCampaigns.map(mapCampaign),
        dsp: dspOrders.map(mapCampaign),
      },
      weeks: req.query.weeks || 12,
      range: { start: cutoff, end: rangeEnd, label: rangeLabel },
    });
  } catch (err) { next(err); }
});

// ─── GET /vendor-analytics/forecasting ───────────────────────────────────────
router.get('/forecasting', async (req, res, next) => {
  try {
    const CLIENT_ID = getClientId(req);
    const { start: cutoff, end: rangeEnd, label: rangeLabel } = parseDateRange(req);
    const weeks = Math.min(Number(req.query.weeks) || 4, 26);

    const [allForecasts, inventoryNow] = await Promise.all([
      // All ASINs — next N weeks of forecast
      query(`
        WITH ranked AS (
          SELECT
            f.asin,
            MAX(p.model_number) AS model_number, MAX(p.title) AS title,
            SUM(f.mean_forecast_units)  AS mean_forecast,
            SUM(f.p70_forecast_units)   AS p70,
            SUM(f.p80_forecast_units)   AS p80,
            SUM(f.p90_forecast_units)   AS p90
          FROM ${SCHEMA}.RETAIL_FORECAST f
          LEFT JOIN ${SCHEMA}.RETAIL_LISTING p
            ON p.client_id = f.client_id AND p.asin = f.asin
          WHERE f.client_id = ?
            AND f.start_date >= CURRENT_DATE
            AND f.start_date <= DATEADD('week', ?, CURRENT_DATE)
          GROUP BY f.asin
        )
        SELECT * FROM ranked
        ORDER BY mean_forecast DESC NULLS LAST
      `, [CLIENT_ID, weeks]),

      // Current sellable inventory for all ASINs
      query(`
        SELECT
          asin,
          SUM(sellable_on_hand_units) AS sellable_on_hand
        FROM ${SCHEMA}.RETAIL_INVENTORY
        WHERE client_id = ?
          AND date = (
            SELECT MAX(date) FROM ${SCHEMA}.RETAIL_INVENTORY WHERE client_id = ?
          )
        GROUP BY asin
      `, [CLIENT_ID, CLIENT_ID]),
    ]);

    // Build inventory lookup
    const invMap = {};
    for (const r of inventoryNow) {
      invMap[r.ASIN] = n(r.SELLABLE_ON_HAND);
    }

    // Top 20 for the bar chart (next 1 week only, re-queried from the full set)
    const top20 = allForecasts.slice(0, 20);

    res.json({
      all: allForecasts.map(r => {
        const meanForecast = n(r.MEAN_FORECAST);
        const onHand = invMap[r.ASIN] ?? null;
        const coverageWeeks = meanForecast > 0 && onHand != null
          ? (onHand / (meanForecast / weeks)).toFixed(1)
          : null;
        return {
          asin:         r.ASIN,
          model:        r.MODEL_NUMBER || r.TITLE,
        title:        r.TITLE,
          meanForecast,
          p70:          n(r.P70),
          p80:          n(r.P80),
          p90:          n(r.P90),
          onHand,
          coverageWeeks: coverageWeeks ? Number(coverageWeeks) : null,
        };
      }),
      top20Bar: top20.map(r => ({
        asin:         r.ASIN,
        title:        r.TITLE || r.ASIN,
        meanForecast: n(r.MEAN_FORECAST),
        onHand:       invMap[r.ASIN] ?? null,
      })),
      weeks,
      totalAsins: allForecasts.length,
    });
  } catch (err) { next(err); }
});

module.exports = router;
