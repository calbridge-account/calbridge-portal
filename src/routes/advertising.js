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
    const days    = Number(req.query.days) || 30;
    const channel = req.query.channel; // 'ads' | 'dsp' | undefined
    const channelFilter = channel ? `AND connection_type = '${channel === 'ads' ? 'ads' : 'dsp'}'` : '';
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
        ${channelFilter}
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
        ap.connection_type,
        SUM(ap.impressions)  AS impressions,
        SUM(ap.clicks)       AS clicks,
        SUM(ap.spend)        AS spend,
        SUM(ap.sales)        AS sales,
        SUM(ap.orders)       AS orders,
        CASE WHEN SUM(ap.sales) > 0 THEN SUM(ap.spend) / SUM(ap.sales) ELSE NULL END AS acos,
        CASE WHEN SUM(ap.spend) > 0 THEN SUM(ap.sales) / SUM(ap.spend) ELSE NULL END AS roas
      FROM ad_performance ap
      JOIN ad_campaigns c
        ON ap.client_id = c.client_id
        AND ap.campaign_id = c.campaign_id
        AND ap.connection_type = c.connection_type
      WHERE ap.client_id = ?
        AND ap.report_date >= DATEADD(day, -?, CURRENT_DATE)
      GROUP BY c.campaign_type, ap.connection_type
      ORDER BY SUM(ap.spend) DESC
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
    const days    = Number(req.query.days) || 30;
    const channel = req.query.channel;
    const channelFilter = channel ? `AND connection_type = '${channel === 'ads' ? 'ads' : 'dsp'}'` : '';
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
        ${channelFilter}
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
    const days    = Number(req.query.days)  || 30;
    const limit   = Number(req.query.limit) || 20;
    const channel = req.query.channel;
    const channelFilter = channel ? `AND ap.connection_type = '${channel === 'ads' ? 'ads' : 'dsp'}'` : '';
    const rows = await query(`
      SELECT
        ap.campaign_id,
        c.campaign_name,
        c.campaign_type,
        ap.connection_type,
        c.status,
        c.budget,
        SUM(ap.impressions)  AS impressions,
        SUM(ap.clicks)       AS clicks,
        SUM(ap.spend)        AS spend,
        SUM(ap.sales)        AS sales,
        SUM(ap.orders)       AS orders,
        CASE WHEN SUM(ap.sales) > 0 THEN SUM(ap.spend) / SUM(ap.sales) ELSE NULL END AS acos,
        CASE WHEN SUM(ap.spend) > 0 THEN SUM(ap.sales) / SUM(ap.spend) ELSE NULL END AS roas,
        CASE WHEN SUM(ap.impressions) > 0 THEN SUM(ap.clicks) / SUM(ap.impressions) ELSE NULL END AS ctr,
        CASE WHEN SUM(ap.clicks) > 0 THEN SUM(ap.spend) / SUM(ap.clicks) ELSE NULL END AS cpc
      FROM ad_performance ap
      LEFT JOIN ad_campaigns c
        ON ap.client_id = c.client_id
        AND ap.campaign_id = c.campaign_id
        AND ap.connection_type = c.connection_type
      WHERE ap.client_id = ?
        AND ap.report_date >= DATEADD(day, -?, CURRENT_DATE)
        ${channelFilter}
      GROUP BY ap.campaign_id, c.campaign_name, c.campaign_type, ap.connection_type, c.status, c.budget
      ORDER BY SUM(ap.spend) DESC
      LIMIT ?
    `, [req.session.clientId, days, limit]);

    res.json(rows);
  } catch (err) { next(err); }
});

/**
 * GET /advertising/roas-by-type?days=30
 * ROAS broken out by campaign type: SP / SB / SD / DSP
 * Also returns TACOS for advertising context.
 */
router.get('/roas-by-type', requireAuth, async (req, res, next) => {
  try {
    const days = Number(req.query.days) || 30;
    const clientId = req.session.clientId;

    const [roasRows, salesRow] = await Promise.all([
      // ROAS per campaign type
      query(`
        SELECT
          COALESCE(c.campaign_type, 'Unknown')  AS campaign_type,
          ap.connection_type,
          SUM(ap.impressions)  AS impressions,
          SUM(ap.clicks)       AS clicks,
          SUM(ap.spend)        AS spend,
          SUM(ap.sales)        AS sales,
          SUM(ap.orders)       AS orders,
          CASE WHEN SUM(ap.spend) > 0  THEN SUM(ap.sales) / SUM(ap.spend)  ELSE NULL END AS roas,
          CASE WHEN SUM(ap.sales) > 0  THEN SUM(ap.spend) / SUM(ap.sales)  ELSE NULL END AS acos,
          CASE WHEN SUM(ap.impressions) > 0 THEN SUM(ap.clicks) / SUM(ap.impressions) ELSE NULL END AS ctr
        FROM ad_performance ap
        LEFT JOIN ad_campaigns c
          ON ap.client_id = c.client_id
          AND ap.campaign_id = c.campaign_id
          AND ap.connection_type = c.connection_type
        WHERE ap.client_id = ?
          AND ap.report_date >= DATEADD(day, -?, CURRENT_DATE)
        GROUP BY COALESCE(c.campaign_type, 'Unknown'), ap.connection_type
        ORDER BY spend DESC
      `, [clientId, days]),

      // Total revenue for TACOS denominator
      query(`
        SELECT COALESCE(SUM(ordered_revenue + COALESCE(shipped_revenue, 0)), 0) AS total_revenue
        FROM sales
        WHERE client_id = ?
          AND order_date >= DATEADD(day, -?, CURRENT_DATE)
      `, [clientId, days])
    ]);

    const totalRevenue = Number(salesRow[0]?.TOTAL_REVENUE || 0);

    const byType = roasRows.map(r => ({
      campaignType:   r.CAMPAIGN_TYPE,
      connectionType: r.CONNECTION_TYPE,
      impressions:    Number(r.IMPRESSIONS || 0),
      clicks:         Number(r.CLICKS      || 0),
      spend:          Number(r.SPEND       || 0),
      sales:          Number(r.SALES       || 0),
      orders:         Number(r.ORDERS      || 0),
      roas:           r.ROAS  != null ? Number(r.ROAS)  : null,
      acos:           r.ACOS  != null ? Number(r.ACOS)  : null,
      ctr:            r.CTR   != null ? Number(r.CTR)   : null,
      // TACOS contribution: this type's spend / total revenue
      tacos:          totalRevenue > 0 ? Number(r.SPEND || 0) / totalRevenue : null
    }));

    const totalSpend = byType.reduce((s, r) => s + r.spend, 0);
    const overallTacos = totalRevenue > 0 ? totalSpend / totalRevenue : null;

    res.json({
      days,
      totalRevenue,
      totalSpend,
      overallTacos,
      tacosPercent: overallTacos != null ? overallTacos * 100 : null,
      byType
    });
  } catch (err) { next(err); }
});

/**
 * GET /advertising/keyword-efficiency?days=30&limit=20
 * Top converting search terms by ROAS and top wasted spend.
 *
 * Note: Requires keyword-level reporting data in ad_performance.
 * If no keyword data is available (advertised_asin-level only),
 * this endpoint returns a graceful "not available" response.
 */
router.get('/keyword-efficiency', requireAuth, async (req, res, next) => {
  try {
    const days  = Number(req.query.days)  || 30;
    const limit = Number(req.query.limit) || 10;
    const clientId = req.session.clientId;

    // Check if keyword-level data exists (separate keyword table future feature)
    // For now, surface ASIN-level efficiency as a proxy using advertised_asin
    const rows = await query(`
      SELECT
        COALESCE(ap.advertised_asin, 'UNATTRIBUTED') AS asin,
        MAX(p.title)   AS product_title,
        SUM(ap.spend)  AS total_spend,
        SUM(ap.sales)  AS total_sales,
        SUM(ap.orders) AS total_orders,
        SUM(ap.clicks) AS total_clicks,
        SUM(ap.impressions) AS total_impressions,
        CASE WHEN SUM(ap.spend) > 0  THEN SUM(ap.sales) / SUM(ap.spend)  ELSE NULL END AS roas,
        CASE WHEN SUM(ap.sales) > 0  THEN SUM(ap.spend) / SUM(ap.sales)  ELSE NULL END AS acos,
        CASE WHEN SUM(ap.impressions) > 0 THEN SUM(ap.clicks) / SUM(ap.impressions) ELSE NULL END AS ctr
      FROM ad_performance ap
      LEFT JOIN products p
        ON ap.client_id = p.client_id
        AND UPPER(TRIM(ap.advertised_asin)) = UPPER(TRIM(p.asin))
      WHERE ap.client_id = ?
        AND ap.report_date >= DATEADD(day, -?, CURRENT_DATE)
        AND ap.advertised_asin IS NOT NULL
        AND ap.advertised_asin != 'UNATTRIBUTED'
      GROUP BY COALESCE(ap.advertised_asin, 'UNATTRIBUTED')
    `, [clientId, days]);

    const mapped = rows.map(r => ({
      asin:         r.ASIN,
      productTitle: r.PRODUCT_TITLE || null,
      spend:        Number(r.TOTAL_SPEND  || 0),
      sales:        Number(r.TOTAL_SALES  || 0),
      orders:       Number(r.TOTAL_ORDERS || 0),
      clicks:       Number(r.TOTAL_CLICKS || 0),
      impressions:  Number(r.TOTAL_IMPRESSIONS || 0),
      roas:         r.ROAS != null ? Number(r.ROAS) : null,
      acos:         r.ACOS != null ? Number(r.ACOS) : null,
      ctr:          r.CTR  != null ? Number(r.CTR)  : null
    }));

    // Top 10 by ROAS (converting well)
    const topByRoas = [...mapped]
      .filter(r => r.roas != null && r.spend > 10)
      .sort((a, b) => b.roas - a.roas)
      .slice(0, limit);

    // Top 10 wasted spend: high spend, low/no orders
    const wastedSpend = [...mapped]
      .filter(r => r.spend > 10 && (r.orders === 0 || (r.acos != null && r.acos > 0.8)))
      .sort((a, b) => b.spend - a.spend)
      .slice(0, limit);

    res.json({
      days,
      note: 'Currently showing ASIN-level efficiency. Keyword-level search term data requires a dedicated keyword report — planned for a future ingestion update.',
      topByRoas,
      wastedSpend
    });
  } catch (err) { next(err); }
});

module.exports = router;
