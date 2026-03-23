const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/requireAuth');
const { query } = require('../services/snowflakeService');

/**
 * GET /advertising/summary?days=30
 * Aggregated totals across Ads + DSP
 */
router.get('/summary', requireAuth, async (req, res, next) => {
  try {
    const days = Number(req.query.days) || 30;
    const rows = await query(`
      SELECT
        SUM(impressions)                          AS total_impressions,
        SUM(clicks)                               AS total_clicks,
        SUM(spend)                                AS total_spend,
        SUM(sales)                                AS total_sales,
        SUM(orders)                               AS total_orders,
        SUM(units_sold)                           AS total_units,
        CASE WHEN SUM(sales)  > 0 THEN SUM(spend) / SUM(sales)  ELSE NULL END AS acos,
        CASE WHEN SUM(spend)  > 0 THEN SUM(sales) / SUM(spend)  ELSE NULL END AS roas,
        CASE WHEN SUM(impressions) > 0 THEN SUM(clicks) / SUM(impressions) ELSE NULL END AS ctr,
        CASE WHEN SUM(clicks) > 0 THEN SUM(spend) / SUM(clicks) ELSE NULL END AS cpc
      FROM ad_performance
      WHERE client_id = ?
        AND report_date >= DATEADD(day, -?, CURRENT_DATE)
    `, [req.session.clientId, days]);

    res.json(rows[0] || {});
  } catch (err) { next(err); }
});

/**
 * GET /advertising/by-channel?days=30
 * Split by connection_type (ads vs dsp)
 */
router.get('/by-channel', requireAuth, async (req, res, next) => {
  try {
    const days = Number(req.query.days) || 30;
    const rows = await query(`
      SELECT
        connection_type,
        SUM(impressions)  AS impressions,
        SUM(clicks)       AS clicks,
        SUM(spend)        AS spend,
        SUM(sales)        AS sales,
        SUM(orders)       AS orders,
        CASE WHEN SUM(sales) > 0 THEN SUM(spend) / SUM(sales) ELSE NULL END AS acos,
        CASE WHEN SUM(spend) > 0 THEN SUM(sales) / SUM(spend) ELSE NULL END AS roas
      FROM ad_performance
      WHERE client_id = ?
        AND report_date >= DATEADD(day, -?, CURRENT_DATE)
      GROUP BY connection_type
    `, [req.session.clientId, days]);

    res.json(rows);
  } catch (err) { next(err); }
});

/**
 * GET /advertising/by-campaign-type?days=30
 * Split by campaign type (SP, SB, SD, DSP video etc)
 */
router.get('/by-campaign-type', requireAuth, async (req, res, next) => {
  try {
    const days = Number(req.query.days) || 30;
    const rows = await query(`
      SELECT
        c.campaign_type,
        p.connection_type,
        SUM(p.impressions)  AS impressions,
        SUM(p.clicks)       AS clicks,
        SUM(p.spend)        AS spend,
        SUM(p.sales)        AS sales,
        SUM(p.orders)       AS orders,
        CASE WHEN SUM(p.sales) > 0 THEN SUM(p.spend) / SUM(p.sales) ELSE NULL END AS acos,
        CASE WHEN SUM(p.spend) > 0 THEN SUM(p.sales) / SUM(p.spend) ELSE NULL END AS roas
      FROM ad_performance p
      JOIN ad_campaigns c
        ON p.client_id = c.client_id
        AND p.campaign_id = c.campaign_id
        AND p.connection_type = c.connection_type
      WHERE p.client_id = ?
        AND p.report_date >= DATEADD(day, -?, CURRENT_DATE)
      GROUP BY c.campaign_type, p.connection_type
      ORDER BY SUM(p.spend) DESC
    `, [req.session.clientId, days]);

    res.json(rows);
  } catch (err) { next(err); }
});

/**
 * GET /advertising/trend?days=30
 * Daily spend + sales trend across all channels
 */
router.get('/trend', requireAuth, async (req, res, next) => {
  try {
    const days = Number(req.query.days) || 30;
    const rows = await query(`
      SELECT
        report_date,
        SUM(impressions)  AS impressions,
        SUM(clicks)       AS clicks,
        SUM(spend)        AS spend,
        SUM(sales)        AS sales,
        SUM(orders)       AS orders,
        CASE WHEN SUM(sales) > 0 THEN SUM(spend) / SUM(sales) ELSE NULL END AS acos,
        CASE WHEN SUM(spend) > 0 THEN SUM(sales) / SUM(spend) ELSE NULL END AS roas
      FROM ad_performance
      WHERE client_id = ?
        AND report_date >= DATEADD(day, -?, CURRENT_DATE)
      GROUP BY report_date
      ORDER BY report_date ASC
    `, [req.session.clientId, days]);

    res.json(rows);
  } catch (err) { next(err); }
});

/**
 * GET /advertising/campaigns?days=30&limit=20
 * Campaign-level breakdown, sorted by spend
 */
router.get('/campaigns', requireAuth, async (req, res, next) => {
  try {
    const days  = Number(req.query.days)  || 30;
    const limit = Number(req.query.limit) || 20;
    const rows = await query(`
      SELECT
        p.campaign_id,
        c.campaign_name,
        c.campaign_type,
        p.connection_type,
        c.status,
        c.budget,
        SUM(p.impressions)  AS impressions,
        SUM(p.clicks)       AS clicks,
        SUM(p.spend)        AS spend,
        SUM(p.sales)        AS sales,
        SUM(p.orders)       AS orders,
        CASE WHEN SUM(p.sales) > 0 THEN SUM(p.spend) / SUM(p.sales) ELSE NULL END AS acos,
        CASE WHEN SUM(p.spend) > 0 THEN SUM(p.sales) / SUM(p.spend) ELSE NULL END AS roas,
        CASE WHEN SUM(p.impressions) > 0 THEN SUM(p.clicks) / SUM(p.impressions) ELSE NULL END AS ctr,
        CASE WHEN SUM(p.clicks) > 0 THEN SUM(p.spend) / SUM(p.clicks) ELSE NULL END AS cpc
      FROM ad_performance p
      LEFT JOIN ad_campaigns c
        ON p.client_id = c.client_id
        AND p.campaign_id = c.campaign_id
        AND p.connection_type = c.connection_type
      WHERE p.client_id = ?
        AND p.report_date >= DATEADD(day, -?, CURRENT_DATE)
      GROUP BY p.campaign_id, c.campaign_name, c.campaign_type, p.connection_type, c.status, c.budget
      ORDER BY SUM(p.spend) DESC
      LIMIT ?
    `, [req.session.clientId, days, limit]);

    res.json(rows);
  } catch (err) { next(err); }
});

module.exports = router;
