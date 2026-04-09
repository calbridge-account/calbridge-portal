/**
 * Calbridge Analytics Dashboard API
 * Serves the React calbridge-dash frontend.
 * All routes are scoped to CyberPower's client_id.
 *
 * Routes:
 *   GET /vendor-analytics/overview           — KPIs + weekly trends + top ASINs + forecast table
 *   GET /vendor-analytics/vendor             — inventory health + sell-through KPIs + weekly trend
 *   GET /vendor-analytics/vendor/asins       — ASIN-level inventory detail table
 *   GET /vendor-analytics/advertising        — combined + per-type ad metrics (SP/SB/SD/DSP)
 *   GET /vendor-analytics/forecasting        — all ASINs forecast table + top 20 bar data
 *   GET /vendor-analytics/forecast-shift     — how Amazon's forecast has changed over time (by generation date)
 *   GET /vendor-analytics/annual-projection  — YTD actuals + projected remaining weeks = full-year revenue
 *   GET /vendor-analytics/inventory-detail   — ASIN-level inventory snapshot with weeks-of-cover
 *   GET /vendor-analytics/po-summary         — ASIN-level purchase order summary
 */

const express = require('express');
const router = express.Router();
const { query } = require('../services/snowflakeService');
const { requireAuth } = require('../middleware/requireAuth');

// Production database — use APP schema with current table names
const SCHEMA = 'CALBRIDGE_PROD.APP';

// Table name mapping: Project GO names → current actual table names
const T = {
  RETAIL_SALES_TRAFFIC: 'VENDOR_SALES',
  RETAIL_INVENTORY:     'VENDOR_INVENTORY',
  RETAIL_TRAFFIC:       'VENDOR_TRAFFIC',
  RETAIL_NET_PPM:       'VENDOR_NET_PPM',
  RETAIL_LISTING:       'PRODUCTS',
  RETAIL_FORECAST:      'VENDOR_FORECASTS',
};

/**
 * Resolve client ID — session takes priority, falls back to CyberPower for
 * backwards compatibility while we finish portal wiring.
 */
function getClientId(req) {
  const id = req.session?.clientId;
  if (!id) throw Object.assign(new Error('Not authenticated'), { status: 401 });
  return id;
}

/**
 * Parse date range from query params.
 * Supports:
 *   ?range=7d | 14d                        (rolling days)
 *   ?range=mtd                              (month to date)
 *   ?range=ytd                              (Jan 1 to today)
 *   ?range=custom&start=YYYY-MM-DD&end=YYYY-MM-DD
 *   ?range=4w | 8w | 12w | 26w | 52w      (rolling weeks, legacy)
 * Default: MTD
 */
function parseDateRange(req) {
  const range = req.query.range || 'mtd';
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const todayStr = today.toISOString().split('T')[0];

  if (range === 'mtd') {
    const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    return { start: start.toISOString().split('T')[0], end: todayStr, label: 'MTD' };
  }

  if (range === 'ytd') {
    const start = new Date(Date.UTC(today.getUTCFullYear(), 0, 1));
    return { start: start.toISOString().split('T')[0], end: todayStr, label: 'YTD' };
  }

  if (range === 'custom') {
    const start = req.query.start || new Date(today - 30 * 86400000).toISOString().split('T')[0];
    const end   = req.query.end   || todayStr;
    return { start, end, label: 'Custom' };
  }

  // Rolling days: 7d, 14d
  const dayMatch = range.match(/^(\d+)d$/);
  if (dayMatch) {
    const days = parseInt(dayMatch[1]);
    const start = new Date(today - (days - 1) * 86400000);
    return { start: start.toISOString().split('T')[0], end: todayStr, label: `${days}D` };
  }

  // Rolling weeks (legacy): 4w, 8w, 12w, 26w, 52w
  const weekMatch = range.match(/^(\d+)w$/);
  const weeks = weekMatch ? parseInt(weekMatch[1]) : 4;
  const start = new Date(today - weeks * 7 * 86400000);
  return { start: start.toISOString().split('T')[0], end: todayStr, label: `${weeks}W` };
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

    // Check latest available vendor data date — fall back to last 30 days if
    // selected range has no vendor data (e.g. MTD when data is stale)
    const latestDateRow = await query(
      `SELECT MAX(start_date) AS latest FROM ${SCHEMA}.VENDOR_SALES WHERE client_id = ?`,
      [CLIENT_ID]
    );
    const latestDate = latestDateRow?.[0]?.LATEST || latestDateRow?.[0]?.latest;
    const dataThrough = latestDate ? dateStr(latestDate) : null;

    // If selected range has no vendor data, silently shift to last 30 days of available data
    let effectiveCutoff = cutoff;
    let effectiveRangeEnd = rangeEnd;
    if (dataThrough && dataThrough < cutoff) {
      const d = new Date(dataThrough);
      const s = new Date(dataThrough); s.setDate(s.getDate() - 29);
      effectiveCutoff    = s.toISOString().split('T')[0];
      effectiveRangeEnd  = dataThrough;
      console.log(`[overview] Selected range ${cutoff}–${rangeEnd} has no vendor data — falling back to ${effectiveCutoff}–${effectiveRangeEnd}`);
    }

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
        FROM ${SCHEMA}.VENDOR_SALES
        WHERE client_id = ? AND start_date BETWEEN ? AND ?
      `, [CLIENT_ID, effectiveCutoff, effectiveRangeEnd]),

      // Previous week only (for WoW)
      query(`
        SELECT
          SUM(shipped_revenue) AS shipped_revenue,
          SUM(shipped_cogs)    AS shipped_cogs
        FROM ${SCHEMA}.VENDOR_SALES
        WHERE client_id = ? AND start_date >= ? AND start_date < ?
      `, [CLIENT_ID, prevCutoff, effectiveCutoff]),

      // Current glance views
      query(`
        SELECT SUM(glance_views) AS glance_views
        FROM ${SCHEMA}.VENDOR_TRAFFIC
        WHERE client_id = ? AND start_date BETWEEN ? AND ?
      `, [CLIENT_ID, effectiveCutoff, effectiveRangeEnd]),

      // Previous glance views
      query(`
        SELECT SUM(glance_views) AS glance_views
        FROM ${SCHEMA}.VENDOR_TRAFFIC
        WHERE client_id = ? AND start_date >= ? AND start_date < ?
      `, [CLIENT_ID, prevCutoff, effectiveCutoff]),

      // Net PPM — avg of weekly values
      query(`
        SELECT AVG(net_pure_product_margin) AS net_ppm
        FROM ${SCHEMA}.VENDOR_NET_PPM
        WHERE client_id = ? AND start_date BETWEEN ? AND ?
      `, [CLIENT_ID, effectiveCutoff, effectiveRangeEnd]),

      // Previous net PPM
      query(`
        SELECT AVG(net_pure_product_margin) AS net_ppm
        FROM ${SCHEMA}.VENDOR_NET_PPM
        WHERE client_id = ? AND start_date >= ? AND start_date < ?
      `, [CLIENT_ID, prevCutoff, effectiveCutoff]),

      // Current period total ad spend (all ad types) — use original range (ads are current)
      query(`
        SELECT SUM(adjusted_spend) AS total_ad_spend
        FROM CALBRIDGE_PROD.APP.ADJUSTED_CAMPAIGN_PERFORMANCE
        WHERE client_id = ? AND date BETWEEN ? AND ?
      `, [CLIENT_ID, cutoff, rangeEnd]),

      // Previous period total ad spend
      query(`
        SELECT SUM(adjusted_spend) AS total_ad_spend
        FROM CALBRIDGE_PROD.APP.ADJUSTED_CAMPAIGN_PERFORMANCE
        WHERE client_id = ? AND date >= ? AND date < ?
      `, [CLIENT_ID, prevCutoff, cutoff]),

      // Weekly trend: use effective range so chart always has data
      query(`
        SELECT
          TO_VARCHAR(start_date, 'Mon DD') AS week,
          start_date AS date,
          SUM(shipped_revenue) AS shipped_revenue,
          SUM(ordered_revenue) AS ordered_revenue,
          SUM(shipped_units)   AS shipped_units
        FROM ${SCHEMA}.VENDOR_SALES
        WHERE client_id = ? AND start_date BETWEEN ? AND ?
        GROUP BY start_date
        ORDER BY start_date ASC
      `, [CLIENT_ID, effectiveCutoff, effectiveRangeEnd]),

      // Top 10 ASINs by shipped revenue (last 4 weeks) + their ad spend
      query(`
        SELECT
          s.asin,
          MAX(p.title)           AS title,
          SUM(s.shipped_revenue) AS shipped_revenue,
          SUM(s.shipped_units)   AS shipped_units,
          SUM(s.shipped_cogs)    AS shipped_cogs
        FROM ${SCHEMA}.VENDOR_SALES s
        LEFT JOIN ${SCHEMA}.PRODUCTS p
          ON p.client_id = s.client_id AND p.asin = s.asin
        WHERE s.client_id = ? AND s.start_date >= DATEADD('week', -4, CURRENT_DATE)
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
          FROM ${SCHEMA}.VENDOR_FORECASTS f
          LEFT JOIN ${SCHEMA}.PRODUCTS p
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
        FROM ${SCHEMA}.VENDOR_SALES
        WHERE client_id = ? AND start_date >= DATEADD('day', -7, CURRENT_DATE)
      `, [CLIENT_ID]),

      // Growth: prior week revenue (7-14 days ago)
      query(`
        SELECT SUM(shipped_revenue) AS revenue
        FROM ${SCHEMA}.VENDOR_SALES
        WHERE client_id = ? AND start_date >= DATEADD('day', -14, CURRENT_DATE) AND start_date < DATEADD('day', -7, CURRENT_DATE)
      `, [CLIENT_ID]),

      // Growth: current week glance views
      query(`
        SELECT SUM(glance_views) AS glance_views
        FROM ${SCHEMA}.VENDOR_TRAFFIC
        WHERE client_id = ? AND start_date >= DATEADD('day', -7, CURRENT_DATE)
      `, [CLIENT_ID]),

      // Growth: prior week glance views
      query(`
        SELECT SUM(glance_views) AS glance_views
        FROM ${SCHEMA}.VENDOR_TRAFFIC
        WHERE client_id = ? AND start_date >= DATEADD('day', -14, CURRENT_DATE) AND start_date < DATEADD('day', -7, CURRENT_DATE)
      `, [CLIENT_ID]),

      // Stockout risk: ASINs where sellable_on_hand < 2x weekly forecast
      query(`
        WITH latest_inv AS (
          SELECT asin, SUM(sellable_on_hand_units) AS sellable_on_hand
          FROM ${SCHEMA}.VENDOR_INVENTORY
          WHERE client_id = ?
            AND start_date = (SELECT MAX(start_date) FROM ${SCHEMA}.VENDOR_INVENTORY WHERE client_id = ?)
          GROUP BY asin
        ),
        next2w_forecast AS (
          SELECT asin, SUM(mean_forecast_units) / 2.0 AS weekly_mean_forecast
          FROM ${SCHEMA}.VENDOR_FORECASTS
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
          SUM(adjusted_spend) AS spend,
          SUM(sales) AS sales
        FROM CALBRIDGE_PROD.APP.ADJUSTED_CAMPAIGN_PERFORMANCE
        WHERE client_id = ? AND ad_type = 'SP'
          AND date >= DATEADD('day', -7, CURRENT_DATE)
      `, [CLIENT_ID]),

      // Ad efficiency: prior period ACoS (SP only, 7-14 days ago)
      query(`
        SELECT
          SUM(adjusted_spend) AS spend,
          SUM(sales) AS sales
        FROM CALBRIDGE_PROD.APP.ADJUSTED_CAMPAIGN_PERFORMANCE
        WHERE client_id = ? AND ad_type = 'SP'
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
          model:            r.MODEL_NUMBER || null,
          title:            r.TITLE || null,
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
        model:        r.MODEL_NUMBER || null,
        title:        r.TITLE || null,
        meanForecast: n(r.MEAN_FORECAST),
        p70:          n(r.P70),
        p80:          n(r.P80),
        p90:          n(r.P90),
      })),
      weeks: req.query.weeks || 12,
      range: { start: cutoff, end: rangeEnd, label: rangeLabel },
      dataThrough,
      usingFallbackRange: effectiveCutoff !== cutoff,
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
      // NOTE: AVG(vendor_confirmation_rate) only over weeks with data (>0) to avoid dragging
      //       down the average with weeks where no POs were issued (confirmation_rate=0).
      //       receive_fill_rate is shown separately — it's expected to be 0 for recent POs
      //       that haven't been received yet.
      query(`
        SELECT
          AVG(sell_through_rate)          AS avg_sell_through,
          AVG(CASE WHEN vendor_confirmation_rate > 0 THEN vendor_confirmation_rate END) AS avg_conf_rate,
          AVG(receive_fill_rate)          AS avg_fill_rate,
          AVG(avg_vendor_lead_time_days)  AS avg_lead_time,
          SUM(sellable_on_hand_units)     AS total_sellable,
          SUM(aged_90_plus_units)         AS total_aged_90,
          SUM(unhealthy_units)            AS total_unhealthy,
          SUM(unfilled_customer_ordered_units) AS total_oos
        FROM ${SCHEMA}.VENDOR_INVENTORY
        WHERE client_id = ? AND start_date BETWEEN ? AND ?
      `, [CLIENT_ID, cutoff, rangeEnd]),

      // Weekly sell-through rate trend
      // Only average conf_rate over rows where a PO was confirmed (rate > 0)
      query(`
        SELECT
          TO_VARCHAR(start_date, 'Mon DD') AS week,
          start_date AS date,
          AVG(sell_through_rate)                                                    AS sell_through_rate,
          AVG(CASE WHEN vendor_confirmation_rate > 0 THEN vendor_confirmation_rate END) AS conf_rate,
          AVG(receive_fill_rate)                                                    AS fill_rate
        FROM ${SCHEMA}.VENDOR_INVENTORY
        WHERE client_id = ? AND start_date BETWEEN ? AND ?
        GROUP BY start_date
        ORDER BY start_date ASC
      `, [CLIENT_ID, cutoff, rangeEnd]),

      // Weekly ordered vs shipped units
      query(`
        SELECT
          TO_VARCHAR(start_date, 'Mon DD') AS week,
          start_date AS date,
          SUM(ordered_units)  AS ordered_units,
          SUM(shipped_units)  AS shipped_units
        FROM ${SCHEMA}.VENDOR_SALES
        WHERE client_id = ? AND start_date BETWEEN ? AND ?
        GROUP BY start_date
        ORDER BY start_date ASC
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
          SUM(i.open_purchase_order_units)    AS open_po_units,
          SUM(i.aged_90_plus_units)           AS aged_90_plus,
          SUM(i.unhealthy_units)              AS unhealthy,
          SUM(i.unfilled_customer_ordered_units) AS oos_units,
          AVG(i.sell_through_rate)            AS sell_through,
          AVG(CASE WHEN i.vendor_confirmation_rate > 0 THEN i.vendor_confirmation_rate END) AS conf_rate,
          AVG(i.receive_fill_rate)            AS fill_rate,
          AVG(i.avg_vendor_lead_time_days)    AS lead_time
        FROM ${SCHEMA}.VENDOR_INVENTORY i
        LEFT JOIN ${SCHEMA}.PRODUCTS p
          ON p.client_id = i.client_id AND p.asin = i.asin
        WHERE i.client_id = ? AND i.start_date >= ?
        GROUP BY i.asin
        ORDER BY sellable_on_hand DESC NULLS LAST
      `, [CLIENT_ID, cutoff, rangeEnd]),

      // Per-ASIN shipped_cogs (AD_CAMPAIGN has no ASIN column, so ad spend is total-only)
      query(`
        SELECT asin, SUM(shipped_cogs) AS shipped_cogs
        FROM ${SCHEMA}.VENDOR_SALES
        WHERE client_id = ? AND start_date BETWEEN ? AND ?
        GROUP BY asin
      `, [CLIENT_ID, cutoff, rangeEnd]),
    ]);

    // Also fetch conf_rate filtered for ASIN table (only where >0 to avoid diluting with no-PO weeks)

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
          model:            r.MODEL_NUMBER,
          title:            r.TITLE,
          sellableOnHand:   n(r.SELLABLE_ON_HAND),
          openPoUnits:      n(r.OPEN_PO_UNITS),
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
           spCampaigns, sbCampaigns, sdCampaigns, dspOrders,
           topAsins] = await Promise.all([

      // ── SP aggregate ──
      query(`
        SELECT
          SUM(adjusted_spend)            AS spend,
          SUM(sales)      AS sales,
          SUM(orders)  AS purchases,
          SUM(clicks)          AS clicks,
          SUM(impressions)     AS impressions
        FROM CALBRIDGE_PROD.APP.ADJUSTED_CAMPAIGN_PERFORMANCE
        WHERE client_id = ? AND ad_type = 'SP' AND date BETWEEN ? AND ?
      `, [CLIENT_ID, cutoff, rangeEnd]),

      // ── SB aggregate ──
      query(`
        SELECT
          SUM(adjusted_spend)          AS spend,
          SUM(sales)         AS sales,
          SUM(orders)     AS purchases,
          SUM(clicks)        AS clicks,
          SUM(impressions)   AS impressions,
          SUM(new_to_brand_purchases) AS ntb_purchases,
          SUM(new_to_brand_sales)     AS ntb_sales
        FROM CALBRIDGE_PROD.APP.ADJUSTED_CAMPAIGN_PERFORMANCE
        WHERE client_id = ? AND ad_type = 'SB' AND date BETWEEN ? AND ?
      `, [CLIENT_ID, cutoff, rangeEnd]),

      // ── SD aggregate ── SD is display (view-attributed): use sales_30d/purchases_30d like DSP
      query(`
        SELECT
          SUM(adjusted_spend)          AS spend,
          SUM(sales)         AS sales,
          SUM(orders)     AS purchases,
          SUM(clicks)        AS clicks,
          SUM(impressions)   AS impressions,
          SUM(new_to_brand_purchases) AS ntb_purchases,
          SUM(new_to_brand_sales)     AS ntb_sales
        FROM CALBRIDGE_PROD.APP.ADJUSTED_CAMPAIGN_PERFORMANCE
        WHERE client_id = ? AND ad_type = 'SD' AND date BETWEEN ? AND ?
      `, [CLIENT_ID, cutoff, rangeEnd]),

      // ── DSP aggregate ── DSP uses total (view-attributed) sales = sales_30d
      query(`
        SELECT
          SUM(adjusted_spend)            AS spend,
          SUM(sales)           AS sales,
          SUM(orders)       AS purchases,
          SUM(clicks)                AS clicks,
          SUM(impressions)           AS impressions,
          SUM(impressions)  AS viewable_impressions,
          SUM(0)     AS detail_page_views,
          SUM(new_to_brand_purchases) AS ntb_purchases,
          SUM(new_to_brand_sales) AS ntb_sales
        FROM CALBRIDGE_PROD.APP.ADJUSTED_CAMPAIGN_PERFORMANCE
        WHERE client_id = ? AND ad_type = 'DSP' AND date BETWEEN ? AND ?
      `, [CLIENT_ID, cutoff, rangeEnd]),

      // ── SP weekly trend ──
      query(`
        SELECT
          date AS week_start,
          TO_VARCHAR(date, 'Mon DD') AS week,
          SUM(adjusted_spend)           AS spend,
          SUM(sales)     AS sales,
          SUM(impressions)    AS impressions,
          SUM(clicks)         AS clicks
        FROM CALBRIDGE_PROD.APP.ADJUSTED_CAMPAIGN_PERFORMANCE
        WHERE client_id = ? AND ad_type = 'SP' AND date BETWEEN ? AND ?
        GROUP BY date
        ORDER BY date ASC
      `, [CLIENT_ID, cutoff, rangeEnd]),

      // ── SB weekly trend ──
      query(`
        SELECT
          date AS week_start,
          TO_VARCHAR(date, 'Mon DD') AS week,
          SUM(adjusted_spend)       AS spend,
          SUM(sales)      AS sales,
          SUM(impressions) AS impressions,
          SUM(clicks)     AS clicks
        FROM CALBRIDGE_PROD.APP.ADJUSTED_CAMPAIGN_PERFORMANCE
        WHERE client_id = ? AND ad_type = 'SB' AND date BETWEEN ? AND ?
        GROUP BY date
        ORDER BY date ASC
      `, [CLIENT_ID, cutoff, rangeEnd]),

      // ── SD weekly trend ── SD is display (view-attributed): use sales_30d like DSP
      query(`
        SELECT
          date AS week_start,
          TO_VARCHAR(date, 'Mon DD') AS week,
          SUM(adjusted_spend)       AS spend,
          SUM(sales)      AS sales,
          SUM(impressions) AS impressions,
          SUM(clicks)     AS clicks
        FROM CALBRIDGE_PROD.APP.ADJUSTED_CAMPAIGN_PERFORMANCE
        WHERE client_id = ? AND ad_type = 'SD' AND date BETWEEN ? AND ?
        GROUP BY date
        ORDER BY date ASC
      `, [CLIENT_ID, cutoff, rangeEnd]),

      // ── DSP weekly trend ──
      query(`
        SELECT
          date AS week_start,
          TO_VARCHAR(date, 'Mon DD') AS week,
          SUM(adjusted_spend)           AS spend,
          SUM(sales)          AS sales,
          SUM(impressions)          AS impressions,
          SUM(impressions) AS viewable_impressions,
          SUM(clicks)               AS clicks
        FROM CALBRIDGE_PROD.APP.ADJUSTED_CAMPAIGN_PERFORMANCE
        WHERE client_id = ? AND ad_type = 'DSP' AND date BETWEEN ? AND ?
        GROUP BY date
        ORDER BY date ASC
      `, [CLIENT_ID, cutoff, rangeEnd]),

      // ── SP top campaigns ──
      query(`
        SELECT
          campaign_id,
          campaign_name,
          campaign_status AS status,
          SUM(adjusted_spend)           AS spend,
          SUM(sales)     AS sales,
          SUM(orders) AS purchases,
          SUM(impressions)    AS impressions,
          SUM(clicks)         AS clicks,
          CASE WHEN SUM(sales) > 0 THEN SUM(adjusted_spend)/SUM(sales) ELSE NULL END AS acos,
          CASE WHEN SUM(adjusted_spend) > 0 THEN SUM(sales)/SUM(adjusted_spend) ELSE NULL END AS roas
        FROM CALBRIDGE_PROD.APP.ADJUSTED_CAMPAIGN_PERFORMANCE
        WHERE client_id = ? AND ad_type = 'SP' AND date BETWEEN ? AND ?
        GROUP BY campaign_id, campaign_name, campaign_status
        ORDER BY spend DESC NULLS LAST
        LIMIT 20
      `, [CLIENT_ID, cutoff, rangeEnd]),

      // ── SB top campaigns ──
      query(`
        SELECT
          campaign_id,
          campaign_name,
          campaign_status AS status,
          SUM(adjusted_spend)       AS spend,
          SUM(sales)      AS sales,
          SUM(orders)  AS purchases,
          SUM(impressions) AS impressions,
          SUM(clicks)     AS clicks,
          SUM(new_to_brand_purchases) AS ntb_purchases,
          SUM(new_to_brand_sales)     AS ntb_sales,
          CASE WHEN SUM(sales) > 0 THEN SUM(adjusted_spend)/SUM(sales) ELSE NULL END AS acos,
          CASE WHEN SUM(adjusted_spend) > 0 THEN SUM(sales)/SUM(adjusted_spend) ELSE NULL END AS roas
        FROM CALBRIDGE_PROD.APP.ADJUSTED_CAMPAIGN_PERFORMANCE
        WHERE client_id = ? AND ad_type = 'SB' AND date BETWEEN ? AND ?
        GROUP BY campaign_id, campaign_name, campaign_status
        ORDER BY spend DESC NULLS LAST
        LIMIT 20
      `, [CLIENT_ID, cutoff, rangeEnd]),

      // ── SD top campaigns ──
      query(`
        SELECT
          campaign_id,
          campaign_name,
          campaign_status AS status,
          SUM(adjusted_spend)       AS spend,
          SUM(sales)      AS sales,
          SUM(orders)  AS purchases,
          SUM(impressions) AS impressions,
          SUM(clicks)     AS clicks,
          SUM(new_to_brand_purchases) AS ntb_purchases,
          SUM(new_to_brand_sales)     AS ntb_sales,
          CASE WHEN SUM(sales) > 0 THEN SUM(adjusted_spend)/SUM(sales) ELSE NULL END AS acos,
          CASE WHEN SUM(adjusted_spend) > 0 THEN SUM(sales)/SUM(adjusted_spend) ELSE NULL END AS roas
        FROM CALBRIDGE_PROD.APP.ADJUSTED_CAMPAIGN_PERFORMANCE
        WHERE client_id = ? AND ad_type = 'SD' AND date BETWEEN ? AND ?
        GROUP BY campaign_id, campaign_name, campaign_status
        ORDER BY spend DESC NULLS LAST
        LIMIT 20
      `, [CLIENT_ID, cutoff, rangeEnd]),

      // ── DSP top orders ── (DSP uses total/view-attributed sales = sales_30d)
      query(`
        SELECT
          campaign_id,
          campaign_name,
          SUM(adjusted_spend)            AS spend,
          SUM(sales)           AS sales,
          SUM(orders)       AS purchases,
          SUM(impressions)           AS impressions,
          SUM(impressions)  AS viewable_impressions,
          SUM(clicks)                AS clicks,
          SUM(0)     AS detail_page_views,
          SUM(new_to_brand_purchases) AS ntb_purchases,
          SUM(new_to_brand_sales) AS ntb_sales,
          CASE WHEN SUM(sales) > 0 THEN SUM(adjusted_spend)/SUM(sales) ELSE NULL END AS acos,
          CASE WHEN SUM(adjusted_spend) > 0 THEN SUM(sales)/SUM(adjusted_spend) ELSE NULL END AS roas
        FROM CALBRIDGE_PROD.APP.ADJUSTED_CAMPAIGN_PERFORMANCE
        WHERE client_id = ? AND ad_type = 'DSP' AND date BETWEEN ? AND ?
        GROUP BY campaign_id, campaign_name
        ORDER BY spend DESC NULLS LAST
        LIMIT 20
      `, [CLIENT_ID, cutoff, rangeEnd]),

      // ── Top 20 ASINs by spend (SP advertised product report) ──
      query(`
        SELECT
          r.advertised_asin                                          AS asin,
          COALESCE(p.title, r.advertised_asin)                       AS title,
          p.model_number                                             AS model_number,
          SUM(r.cost)                                                AS spend,
          SUM(r.sales_30_d)                                          AS sales,
          SUM(r.purchases_30_d)                                      AS purchases,
          SUM(r.impressions)                                         AS impressions,
          SUM(r.clicks)                                              AS clicks,
          SUM(r.units_sold_clicks_30_d)                              AS units_sold,
          CASE WHEN SUM(r.sales_30_d) > 0 THEN SUM(r.cost)/SUM(r.sales_30_d) ELSE NULL END AS acos,
          CASE WHEN SUM(r.cost) > 0 THEN SUM(r.sales_30_d)/SUM(r.cost) ELSE NULL END        AS roas
        FROM CALBRIDGE_PROD.APP.SP_ADVERTISED_PRODUCT_REPORT r
        LEFT JOIN CALBRIDGE_PROD.APP.PRODUCTS p
          ON p.client_id = r.client_id AND p.asin = r.advertised_asin
        WHERE r.client_id = ?
          AND r.date BETWEEN ? AND ?
          AND r.advertised_asin != 'UNATTRIBUTED'
        GROUP BY r.advertised_asin, p.title, p.model_number
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

    const totalSpend       = (sp.spend       || 0) + (sb.spend       || 0) + (sd.spend       || 0) + (dsp.spend       || 0);
    const totalSales       = (sp.sales       || 0) + (sb.sales       || 0) + (sd.sales       || 0) + (dsp.sales       || 0);
    const totalImpressions = (sp.impressions || 0) + (sb.impressions || 0) + (sd.impressions || 0) + (dsp.impressions || 0);
    const totalClicks      = (sp.clicks      || 0) + (sb.clicks      || 0) + (sd.clicks      || 0) + (dsp.clicks      || 0);
    const totalOrders      = (sp.purchases   || 0) + (sb.purchases   || 0) + (sd.purchases   || 0) + (dsp.purchases   || 0);

    // Merge weekly trends into a single timeline keyed by week
    function mergeWeekly(arr) {
      return arr.map(r => {
        const spend = n(r.SPEND) || 0;
        const sales = n(r.SALES) || 0;
        return {
          week:                r.WEEK,
          weekStart:           dateStr(r.WEEK_START),
          spend,
          sales,
          roas:                spend > 0 ? sales / spend : null,
          impressions:         n(r.IMPRESSIONS),
          clicks:              n(r.CLICKS),
          viewableImpressions: n(r.VIEWABLE_IMPRESSIONS),
        };
      });
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
        blendedAcos:   totalSales > 0   ? totalSpend / totalSales : null,
        blendedRoas:   totalSpend > 0   ? totalSales / totalSpend : null,
        totalImpressions,
        totalClicks,
        totalOrders,
        conversionRate: totalClicks > 0 ? totalOrders / totalClicks : null,
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
      topAsins: (topAsins || []).map(r => ({
        asin:        r.ASIN,
        title:       r.TITLE,
        modelNumber: r.MODEL_NUMBER,
        spend:       n(r.SPEND),
        sales:       n(r.SALES),
        purchases:   n(r.PURCHASES),
        impressions: n(r.IMPRESSIONS),
        clicks:      n(r.CLICKS),
        unitsSold:   n(r.UNITS_SOLD),
        acos:        n(r.ACOS),
        roas:        n(r.ROAS),
      })),
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
          FROM ${SCHEMA}.VENDOR_FORECASTS f
          LEFT JOIN ${SCHEMA}.PRODUCTS p
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
        FROM ${SCHEMA}.VENDOR_INVENTORY
        WHERE client_id = ?
          AND start_date = (
            SELECT MAX(start_date) FROM ${SCHEMA}.VENDOR_INVENTORY WHERE client_id = ?
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
          model:        r.MODEL_NUMBER || null,
          title:        r.TITLE || null,
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

// ─── GET /vendor-analytics/forecast-shift ────────────────────────────────────
// Returns how Amazon's forecast has changed over time per ASIN (by FORECAST_GENERATION_DATE)
router.get('/forecast-shift', async (req, res, next) => {
  try {
    const CLIENT_ID = getClientId(req);
    const asinParam = req.query.asin || null; // optional: filter to single ASIN

    // Get top 10 ASINs by total forecasted units (next 8 weeks, latest generation)
    // Then for each, return all generation dates with their next-4-week totals
    const [topAsins, shiftData] = await Promise.all([
      // Top ASINs by latest forecast
      query(`
        WITH latest_gen AS (
          SELECT MAX(forecast_generation_date) AS max_gen
          FROM ${SCHEMA}.VENDOR_FORECASTS
          WHERE client_id = ?
        ),
        top_asins AS (
          SELECT
            f.asin,
            MAX(p.title) AS title,
            MAX(p.model_number) AS model_number,
            SUM(f.mean_forecast_units) AS total_forecast
          FROM ${SCHEMA}.VENDOR_FORECASTS f
          LEFT JOIN ${SCHEMA}.PRODUCTS p
            ON p.client_id = f.client_id AND p.asin = f.asin
          CROSS JOIN latest_gen lg
          WHERE f.client_id = ?
            AND f.forecast_generation_date = lg.max_gen
            AND f.start_date >= CURRENT_DATE
            AND f.start_date <= DATEADD('week', 8, CURRENT_DATE)
          GROUP BY f.asin
          ORDER BY total_forecast DESC NULLS LAST
          LIMIT 10
        )
        SELECT asin, title, model_number, total_forecast FROM top_asins
      `, [CLIENT_ID, CLIENT_ID]),

      // For each generation date, sum next-4-week forecast for each ASIN
      query(`
        WITH gen_dates AS (
          SELECT DISTINCT forecast_generation_date
          FROM ${SCHEMA}.VENDOR_FORECASTS
          WHERE client_id = ?
          ORDER BY forecast_generation_date DESC
          LIMIT 16
        ),
        top_asins AS (
          SELECT
            f.asin,
            SUM(f.mean_forecast_units) AS total_forecast
          FROM ${SCHEMA}.VENDOR_FORECASTS f
          CROSS JOIN (
            SELECT MAX(forecast_generation_date) AS max_gen
            FROM ${SCHEMA}.VENDOR_FORECASTS WHERE client_id = ?
          ) lg
          WHERE f.client_id = ?
            AND f.forecast_generation_date = lg.max_gen
            AND f.start_date >= CURRENT_DATE
            AND f.start_date <= DATEADD('week', 8, CURRENT_DATE)
          GROUP BY f.asin
          ORDER BY total_forecast DESC NULLS LAST
          LIMIT 10
        )
        SELECT
          f.asin,
          f.forecast_generation_date,
          f.start_date,
          f.mean_forecast_units,
          f.p70_forecast_units,
          f.p80_forecast_units
        FROM ${SCHEMA}.VENDOR_FORECASTS f
        JOIN top_asins ta ON ta.asin = f.asin
        JOIN gen_dates gd ON gd.forecast_generation_date = f.forecast_generation_date
        WHERE f.client_id = ?
          AND f.start_date >= CURRENT_DATE
          AND f.start_date <= DATEADD('week', 4, CURRENT_DATE)
        ORDER BY f.asin, f.forecast_generation_date, f.start_date
      `, [CLIENT_ID, CLIENT_ID, CLIENT_ID, CLIENT_ID]),
    ]);

    // Build lookup maps
    const asinMeta = {};
    for (const r of topAsins) {
      asinMeta[r.ASIN] = {
        title: r.TITLE,
        modelNumber: r.MODEL_NUMBER,
        totalForecast: n(r.TOTAL_FORECAST),
      };
    }

    // Group shift data by ASIN → generationDate → weeks
    const byAsin = {};
    for (const r of shiftData) {
      const asin = r.ASIN;
      const genDate = dateStr(r.FORECAST_GENERATION_DATE);
      const startDate = dateStr(r.START_DATE);
      if (!byAsin[asin]) byAsin[asin] = {};
      if (!byAsin[asin][genDate]) byAsin[asin][genDate] = [];
      byAsin[asin][genDate].push({
        startDate,
        meanForecast: n(r.MEAN_FORECAST_UNITS),
        p70: n(r.P70_FORECAST_UNITS),
        p80: n(r.P80_FORECAST_UNITS),
      });
    }

    // Build output per ASIN
    const result = topAsins.map(r => {
      const asin = r.ASIN;
      const genDates = byAsin[asin] || {};
      const generationDates = Object.keys(genDates)
        .sort()
        .map(date => {
          const weeks = genDates[date];
          const totalForecastNext4Weeks = weeks.reduce((s, w) => s + (w.meanForecast || 0), 0);
          return { date, totalForecastNext4Weeks, weeklyBreakdown: weeks };
        });
      return {
        asin,
        title: r.TITLE,
        modelNumber: r.MODEL_NUMBER,
        generationDates,
      };
    });

    res.json({ asins: result });
  } catch (err) { next(err); }
});

// ─── GET /vendor-analytics/annual-projection ──────────────────────────────────
// Returns YTD actuals + projected remaining weeks = full-year revenue projection
router.get('/annual-projection', async (req, res, next) => {
  try {
    const CLIENT_ID = getClientId(req);
    const currentYear = new Date().getUTCFullYear();
    const janFirst = `${currentYear}-01-01`;

    // Last complete Sunday (end of last full week)
    const now = new Date();
    const dayOfWeek = now.getUTCDay(); // 0=Sun
    const lastSunday = new Date(now);
    lastSunday.setUTCDate(now.getUTCDate() - (dayOfWeek === 0 ? 7 : dayOfWeek));
    const lastSundayStr = lastSunday.toISOString().substring(0, 10);

    const [ytdActuals, weeklyActuals, futureForecasts] = await Promise.all([
      // YTD aggregate actuals (Jan 1 through last complete Sunday)
      query(`
        SELECT
          SUM(shipped_revenue) AS total_revenue,
          SUM(shipped_cogs)    AS total_cogs,
          SUM(shipped_units)   AS total_units
        FROM ${SCHEMA}.VENDOR_SALES
        WHERE client_id = ?
          AND start_date >= ?
          AND start_date <= ?
      `, [CLIENT_ID, janFirst, lastSundayStr]),

      // Week-by-week actuals for the year
      query(`
        SELECT
          start_date AS date,
          TO_VARCHAR(start_date, 'Mon DD') AS week_label,
          SUM(shipped_revenue) AS shipped_revenue,
          SUM(shipped_cogs)    AS shipped_cogs,
          SUM(shipped_units)   AS shipped_units
        FROM ${SCHEMA}.VENDOR_SALES
        WHERE client_id = ?
          AND start_date >= ?
          AND start_date <= ?
        GROUP BY start_date
        ORDER BY start_date ASC
      `, [CLIENT_ID, janFirst, lastSundayStr]),

      // Future forecast: sum mean_forecast_units per week for remaining weeks of the year
      // Use latest generation date for each start_date
      query(`
        WITH latest_forecasts AS (
          SELECT
            start_date,
            SUM(mean_forecast_units) AS mean_forecast_units
          FROM ${SCHEMA}.VENDOR_FORECASTS f
          WHERE f.client_id = ?
            AND f.start_date > ?
            AND f.start_date <= ?
            AND f.forecast_generation_date = (
              SELECT MAX(forecast_generation_date)
              FROM ${SCHEMA}.VENDOR_FORECASTS
              WHERE client_id = ? AND asin = f.asin
            )
          GROUP BY start_date
        )
        SELECT
          start_date,
          TO_VARCHAR(start_date, 'Mon DD') AS week_label,
          SUM(mean_forecast_units) AS mean_forecast_units
        FROM latest_forecasts
        GROUP BY start_date
        ORDER BY start_date ASC
      `, [CLIENT_ID, lastSundayStr, `${currentYear}-12-31`, CLIENT_ID]),
    ]);

    // Compute per-unit averages from YTD actuals
    const ytdRevenue = n(ytdActuals[0]?.TOTAL_REVENUE) || 0;
    const ytdCogs    = n(ytdActuals[0]?.TOTAL_COGS) || 0;
    const ytdUnits   = n(ytdActuals[0]?.TOTAL_UNITS) || 0;
    const avgSellingPrice = ytdUnits > 0 ? ytdRevenue / ytdUnits : 0;
    const avgCogsPerUnit  = ytdUnits > 0 ? ytdCogs / ytdUnits : 0;

    // Build week-by-week output: actuals first, then projections
    const weeklyActualsOut = weeklyActuals.map(r => ({
      week: r.WEEK_LABEL,
      startDate: dateStr(r.DATE),
      type: 'actual',
      shippedRevenue: n(r.SHIPPED_REVENUE),
      shippedCogs:    n(r.SHIPPED_COGS),
      shippedUnits:   n(r.SHIPPED_UNITS),
    }));

    const projectedRevenue = futureForecasts.reduce((s, r) => s + (n(r.MEAN_FORECAST_UNITS) || 0) * avgSellingPrice, 0);
    const projectedCogs    = futureForecasts.reduce((s, r) => s + (n(r.MEAN_FORECAST_UNITS) || 0) * avgCogsPerUnit, 0);

    const weeklyProjectedOut = futureForecasts.map(r => {
      const units = n(r.MEAN_FORECAST_UNITS) || 0;
      return {
        week: r.WEEK_LABEL,
        startDate: dateStr(r.START_DATE),
        type: 'projected',
        forecastedUnits: units,
        projectedRevenue: units * avgSellingPrice,
        projectedCogs:    units * avgCogsPerUnit,
      };
    });

    res.json({
      summary: {
        ytdRevenue,
        ytdCogs,
        ytdUnits,
        projectedRevenue,
        projectedCogs,
        fullYearRevenue: ytdRevenue + projectedRevenue,
        fullYearCogs:    ytdCogs + projectedCogs,
        avgSellingPrice,
        avgCogsPerUnit,
        lastActualDate: lastSundayStr,
        year: currentYear,
      },
      weeklyData: [...weeklyActualsOut, ...weeklyProjectedOut],
    });
  } catch (err) { next(err); }
});

// ─── GET /vendor-analytics/inventory-detail ─────────────────────────────────
// Returns per-ASIN inventory snapshot (latest week) joined to products for title.
// weeks_of_cover = sellable_units / avg_weekly_shipped (trailing 4 weeks)
router.get('/inventory-detail', requireAuth, async (req, res, next) => {
  try {
    const CLIENT_ID = getClientId(req);

    const rows = await query(`
      WITH latest_snapshot AS (
        SELECT
          asin,
          MAX(end_date) AS latest_date
        FROM ${SCHEMA}.VENDOR_INVENTORY
        WHERE client_id = ?
        GROUP BY asin
      ),
      inv AS (
        SELECT
          vi.asin,
          vi.end_date                        AS snapshot_date,
          vi.sellable_on_hand_units,
          vi.unsellable_on_hand_units,
          vi.open_purchase_order_units,
          vi.unfilled_customer_ordered_units,
          vi.aged_90_plus_units,
          vi.sell_through_rate,
          vi.avg_vendor_lead_time_days
        FROM ${SCHEMA}.VENDOR_INVENTORY vi
        JOIN latest_snapshot ls
          ON vi.asin = ls.asin
          AND vi.end_date = ls.latest_date
          AND vi.client_id = ?
      ),
      weekly_shipped AS (
        SELECT
          asin,
          SUM(shipped_units) / NULLIF(COUNT(DISTINCT start_date), 0) AS avg_weekly_shipped
        FROM ${SCHEMA}.VENDOR_SALES
        WHERE client_id = ?
          AND start_date >= DATEADD('week', -4, CURRENT_DATE)
        GROUP BY asin
      )
      SELECT
        inv.asin,
        p.title,
        inv.sellable_on_hand_units,
        inv.unsellable_on_hand_units,
        inv.open_purchase_order_units,
        inv.unfilled_customer_ordered_units,
        inv.aged_90_plus_units,
        inv.sell_through_rate,
        inv.avg_vendor_lead_time_days,
        ws.avg_weekly_shipped,
        CASE
          WHEN COALESCE(ws.avg_weekly_shipped, 0) > 0
          THEN inv.sellable_on_hand_units / ws.avg_weekly_shipped
          ELSE NULL
        END AS weeks_of_cover,
        inv.snapshot_date
      FROM inv
      LEFT JOIN ${SCHEMA}.PRODUCTS p
        ON p.asin = inv.asin AND p.client_id = ?
      LEFT JOIN weekly_shipped ws
        ON ws.asin = inv.asin
      ORDER BY inv.sellable_on_hand_units DESC NULLS LAST
    `, [CLIENT_ID, CLIENT_ID, CLIENT_ID, CLIENT_ID]);

    const out = rows.map(r => ({
      asin:              r.ASIN,
      title:             r.TITLE || null,
      sellableUnits:     n(r.SELLABLE_ON_HAND_UNITS),
      unsellableUnits:   n(r.UNSELLABLE_ON_HAND_UNITS),
      openPoUnits:       n(r.OPEN_PURCHASE_ORDER_UNITS),
      unfillableUnits:   n(r.UNFILLED_CUSTOMER_ORDERED_UNITS),
      aged90Units:       n(r.AGED_90_PLUS_UNITS),
      sellThroughRate:   n(r.SELL_THROUGH_RATE),
      avgLeadTimeDays:   n(r.AVG_VENDOR_LEAD_TIME_DAYS),
      avgWeeklyShipped:  n(r.AVG_WEEKLY_SHIPPED),
      weeksOfCover:      n(r.WEEKS_OF_COVER),
      snapshotDate:      dateStr(r.SNAPSHOT_DATE),
    }));

    res.json(out);
  } catch (err) { next(err); }
});

// ─── GET /vendor-analytics/po-summary ────────────────────────────────────────
// Returns per-ASIN purchase order summary: totals, open units, last order date,
// and avg lead time computed from PO data directly.
router.get('/po-summary', requireAuth, async (req, res, next) => {
  try {
    const CLIENT_ID = getClientId(req);

    const rows = await query(`
      SELECT
        po.asin,
        p.title,
        SUM(po.units_ordered)                                        AS total_units_ordered,
        SUM(po.units_received)                                       AS total_units_received,
        SUM(po.units_ordered) - SUM(po.units_received)               AS open_units,
        MAX(po.order_date)                                           AS last_order_date,
        AVG(
          CASE
            WHEN po.units_received > 0
            THEN DATEDIFF('day', po.order_date, CURRENT_DATE)
            ELSE NULL
          END
        )                                                            AS avg_lead_time_days
      FROM ${SCHEMA}.VENDOR_PURCHASE_ORDERS po
      LEFT JOIN ${SCHEMA}.PRODUCTS p
        ON p.asin = po.asin AND p.client_id = ?
      WHERE po.client_id = ?
      GROUP BY po.asin, p.title
      ORDER BY total_units_ordered DESC NULLS LAST
    `, [CLIENT_ID, CLIENT_ID]);

    const out = rows.map(r => ({
      asin:              r.ASIN,
      title:             r.TITLE || null,
      totalUnitsOrdered: n(r.TOTAL_UNITS_ORDERED),
      totalUnitsReceived: n(r.TOTAL_UNITS_RECEIVED),
      openUnits:         n(r.OPEN_UNITS),
      lastOrderDate:     dateStr(r.LAST_ORDER_DATE),
      avgLeadTimeDays:   r.AVG_LEAD_TIME_DAYS != null ? Math.round(n(r.AVG_LEAD_TIME_DAYS)) : null,
    }));

    res.json(out);
  } catch (err) { next(err); }
});

module.exports = router;
