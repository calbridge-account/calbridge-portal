const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/requireAuth');
const { query } = require('../services/snowflakeService');

/**
 * Build a Snowflake WHERE fragment that filters by channel.
 * channel = 'ads'  → SP + SB + SD
 * channel = 'dsp'  → DSP only
 * channel = falsy  → all
 */
function channelFilter(channel, tableAlias) {
  const col = tableAlias ? `${tableAlias}.ad_type` : 'ad_type';
  if (channel === 'ads') return `AND ${col} IN ('SP','SB','SD')`;
  if (channel === 'dsp') return `AND ${col} = 'DSP'`;
  return '';
}

/**
 * GET /advertising/summary?days=30&channel=ads|dsp
 * Aggregated KPI totals
 */
router.get('/summary', requireAuth, async (req, res, next) => {
  try {
    const days    = Number(req.query.days) || 30;
    const channel = req.query.channel;
    const rows = await query(`
      SELECT
        COALESCE(SUM(impressions), 0)  AS total_impressions,
        COALESCE(SUM(clicks), 0)       AS total_clicks,
        COALESCE(SUM(spend), 0)        AS total_spend,
        COALESCE(SUM(sales), 0)        AS total_sales,
        COALESCE(SUM(orders), 0)       AS total_orders,
        COALESCE(SUM(units_sold), 0)   AS total_units,
        CASE WHEN SUM(sales) > 0       THEN SUM(spend) / SUM(sales)           ELSE NULL END AS acos,
        CASE WHEN SUM(spend) > 0       THEN SUM(sales) / SUM(spend)           ELSE NULL END AS roas,
        CASE WHEN SUM(impressions) > 0 THEN SUM(clicks) / SUM(impressions)    ELSE NULL END AS ctr,
        CASE WHEN SUM(clicks) > 0      THEN SUM(spend) / SUM(clicks)          ELSE NULL END AS cpc
      FROM campaign_performance
      WHERE client_id = ?
        AND date >= DATEADD(day, -?, CURRENT_DATE)
        ${channelFilter(channel)}
    `, [req.session.clientId, days]);
    res.json(rows[0] || {});
  } catch (err) { next(err); }
});

/**
 * GET /advertising/trend?days=30&channel=ads|dsp
 * Daily spend + sales + ACOS trend
 */
router.get('/trend', requireAuth, async (req, res, next) => {
  try {
    const days    = Number(req.query.days) || 30;
    const channel = req.query.channel;
    const rows = await query(`
      SELECT
        date                                                                      AS report_date,
        SUM(impressions)                                                          AS impressions,
        SUM(clicks)                                                               AS clicks,
        SUM(spend)                                                                AS spend,
        SUM(sales)                                                                AS sales,
        SUM(orders)                                                               AS orders,
        CASE WHEN SUM(sales) > 0       THEN SUM(spend) / SUM(sales)              ELSE NULL END AS acos,
        CASE WHEN SUM(spend) > 0       THEN SUM(sales) / SUM(spend)              ELSE NULL END AS roas
      FROM campaign_performance
      WHERE client_id = ?
        AND date >= DATEADD(day, -?, CURRENT_DATE)
        ${channelFilter(channel)}
      GROUP BY date
      ORDER BY date ASC
    `, [req.session.clientId, days]);
    res.json(rows);
  } catch (err) { next(err); }
});

/**
 * GET /advertising/by-channel?days=30
 * Spend split by ad_type (SP / SB / SD / DSP) — used for donut chart
 */
router.get('/by-channel', requireAuth, async (req, res, next) => {
  try {
    const days = Number(req.query.days) || 30;
    const rows = await query(`
      SELECT
        ad_type,
        SUM(impressions) AS impressions,
        SUM(clicks)      AS clicks,
        SUM(spend)       AS spend,
        SUM(sales)       AS sales,
        SUM(orders)      AS orders,
        CASE WHEN SUM(sales) > 0 THEN SUM(spend) / SUM(sales) ELSE NULL END AS acos,
        CASE WHEN SUM(spend) > 0 THEN SUM(sales) / SUM(spend) ELSE NULL END AS roas
      FROM campaign_performance
      WHERE client_id = ?
        AND date >= DATEADD(day, -?, CURRENT_DATE)
      GROUP BY ad_type
      ORDER BY SUM(spend) DESC
    `, [req.session.clientId, days]);
    res.json(rows.filter(r => Number(r.SPEND || 0) > 0));
  } catch (err) { next(err); }
});

/**
 * GET /advertising/campaigns?days=30&limit=200&channel=ads|dsp
 * Campaign-level breakdown
 */
router.get('/campaigns', requireAuth, async (req, res, next) => {
  try {
    const days    = Number(req.query.days)  || 30;
    const limit   = Number(req.query.limit) || 200;
    const channel = req.query.channel;
    const rows = await query(`
      SELECT
        campaign_id,
        campaign_name,
        ad_type,
        campaign_status        AS status,
        campaign_budget_amount AS budget,
        SUM(impressions)       AS impressions,
        SUM(clicks)            AS clicks,
        SUM(spend)             AS spend,
        SUM(sales)             AS sales,
        SUM(orders)            AS orders,
        CASE WHEN SUM(sales) > 0       THEN SUM(spend) / SUM(sales)        ELSE NULL END AS acos,
        CASE WHEN SUM(spend) > 0       THEN SUM(sales) / SUM(spend)        ELSE NULL END AS roas,
        CASE WHEN SUM(impressions) > 0 THEN SUM(clicks) / SUM(impressions) ELSE NULL END AS ctr,
        CASE WHEN SUM(clicks) > 0      THEN SUM(spend) / SUM(clicks)       ELSE NULL END AS cpc
      FROM campaign_performance
      WHERE client_id = ?
        AND date >= DATEADD(day, -?, CURRENT_DATE)
        ${channelFilter(channel)}
      GROUP BY campaign_id, campaign_name, ad_type, campaign_status, campaign_budget_amount
      ORDER BY SUM(spend) DESC
      LIMIT ?
    `, [req.session.clientId, days, limit]);
    res.json(rows);
  } catch (err) { next(err); }
});

/**
 * GET /advertising/by-campaign-type?days=30
 * Kept for backwards compat — proxies to by-channel
 */
router.get('/by-campaign-type', requireAuth, async (req, res, next) => {
  try {
    const days = Number(req.query.days) || 30;
    const rows = await query(`
      SELECT
        ad_type AS campaign_type,
        ad_type AS connection_type,
        SUM(impressions) AS impressions,
        SUM(clicks)      AS clicks,
        SUM(spend)       AS spend,
        SUM(sales)       AS sales,
        SUM(orders)      AS orders,
        CASE WHEN SUM(sales) > 0 THEN SUM(spend) / SUM(sales) ELSE NULL END AS acos,
        CASE WHEN SUM(spend) > 0 THEN SUM(sales) / SUM(spend) ELSE NULL END AS roas
      FROM campaign_performance
      WHERE client_id = ?
        AND date >= DATEADD(day, -?, CURRENT_DATE)
      GROUP BY ad_type
      ORDER BY SUM(spend) DESC
    `, [req.session.clientId, days]);
    res.json(rows);
  } catch (err) { next(err); }
});

/**
 * GET /advertising/roas-by-type?days=30
 */
router.get('/roas-by-type', requireAuth, async (req, res, next) => {
  try {
    const days = Number(req.query.days) || 30;
    const clientId = req.session.clientId;

    const [roasRows, salesRow] = await Promise.all([
      query(`
        SELECT
          ad_type AS campaign_type,
          ad_type AS connection_type,
          SUM(impressions) AS impressions,
          SUM(clicks)      AS clicks,
          SUM(spend)       AS spend,
          SUM(sales)       AS sales,
          SUM(orders)      AS orders,
          CASE WHEN SUM(spend) > 0       THEN SUM(sales) / SUM(spend)        ELSE NULL END AS roas,
          CASE WHEN SUM(sales) > 0       THEN SUM(spend) / SUM(sales)        ELSE NULL END AS acos,
          CASE WHEN SUM(impressions) > 0 THEN SUM(clicks) / SUM(impressions) ELSE NULL END AS ctr
        FROM campaign_performance
        WHERE client_id = ?
          AND date >= DATEADD(day, -?, CURRENT_DATE)
        GROUP BY ad_type
        ORDER BY SUM(spend) DESC
      `, [clientId, days]),
      query(`
        SELECT COALESCE(SUM(ordered_revenue + COALESCE(shipped_revenue, 0)), 0) AS total_revenue
        FROM sales
        WHERE client_id = ? AND order_date >= DATEADD(day, -?, CURRENT_DATE)
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
      roas:           r.ROAS != null ? Number(r.ROAS) : null,
      acos:           r.ACOS != null ? Number(r.ACOS) : null,
      ctr:            r.CTR  != null ? Number(r.CTR)  : null,
      tacos:          totalRevenue > 0 ? Number(r.SPEND || 0) / totalRevenue : null
    }));

    const totalSpend   = byType.reduce((s, r) => s + r.spend, 0);
    const overallTacos = totalRevenue > 0 ? totalSpend / totalRevenue : null;

    res.json({ days, totalRevenue, totalSpend, overallTacos, tacosPercent: overallTacos != null ? overallTacos * 100 : null, byType });
  } catch (err) { next(err); }
});

/**
 * GET /advertising/asin-performance?days=30&limit=200
 * ASIN-level performance from sp_advertised_product_report (SP only)
 */
router.get('/asin-performance', requireAuth, async (req, res, next) => {
  try {
    const days     = Number(req.query.days)  || 30;
    const limit    = Number(req.query.limit) || 200;
    const clientId = req.session.clientId;

    let rows = [];
    try {
      rows = await query(`
        SELECT
          p.advertised_asin                                                       AS asin,
          pr.sku                                                                  AS model_number,
          COALESCE(pr.title, p.advertised_asin)                                  AS product_title,
          SUM(p.cost)                                                             AS spend,
          SUM(p.clicks)                                                           AS clicks,
          SUM(p.impressions)                                                      AS impressions,
          SUM(p.purchases_30_d)                                                   AS purchases,
          SUM(p.purchases_7_d)                                                    AS purchases_7d,
          SUM(p.sales_30_d)                                                       AS sales,
          SUM(p.sales_7_d)                                                        AS sales_7d,
          SUM(p.units_sold_clicks_30_d)                                           AS units_sold,
          CASE WHEN SUM(p.sales_30_d) > 0  THEN SUM(p.cost) / SUM(p.sales_30_d)         ELSE NULL END AS acos,
          CASE WHEN SUM(p.cost) > 0        THEN SUM(p.sales_30_d) / SUM(p.cost)         ELSE NULL END AS roas,
          CASE WHEN SUM(p.impressions) > 0 THEN SUM(p.clicks) / SUM(p.impressions)      ELSE NULL END AS ctr,
          CASE WHEN SUM(p.clicks) > 0      THEN SUM(p.cost) / SUM(p.clicks)             ELSE NULL END AS cpc
        FROM sp_advertised_product_report p
        LEFT JOIN products pr ON p.client_id = pr.client_id AND p.advertised_asin = pr.asin
        WHERE p.client_id = ?
          AND p.date >= DATEADD(day, -?, CURRENT_DATE)
          AND p.advertised_asin != 'UNATTRIBUTED'
        GROUP BY p.advertised_asin, pr.sku, pr.title
        ORDER BY spend DESC
        LIMIT ?
      `, [clientId, days, limit]);
    } catch (e) {
      // Fallback: older table
      rows = await query(`
        SELECT
          COALESCE(ap.advertised_asin, 'UNATTRIBUTED')                           AS asin,
          MAX(p.sku)                                                              AS model_number,
          COALESCE(MAX(p.title), ap.advertised_asin)                             AS product_title,
          SUM(ap.spend)                                                           AS spend,
          SUM(ap.clicks)                                                          AS clicks,
          SUM(ap.impressions)                                                     AS impressions,
          SUM(ap.orders)                                                          AS purchases,
          SUM(ap.sales)                                                           AS sales,
          CASE WHEN SUM(ap.sales) > 0        THEN SUM(ap.spend) / SUM(ap.sales)         ELSE NULL END AS acos,
          CASE WHEN SUM(ap.spend) > 0        THEN SUM(ap.sales) / SUM(ap.spend)         ELSE NULL END AS roas,
          CASE WHEN SUM(ap.impressions) > 0  THEN SUM(ap.clicks) / SUM(ap.impressions)  ELSE NULL END AS ctr,
          CASE WHEN SUM(ap.clicks) > 0       THEN SUM(ap.spend) / SUM(ap.clicks)        ELSE NULL END AS cpc
        FROM ad_performance ap
        LEFT JOIN products p ON ap.client_id = p.client_id AND UPPER(TRIM(ap.advertised_asin)) = UPPER(TRIM(p.asin))
        WHERE ap.client_id = ?
          AND ap.report_date >= DATEADD(day, -?, CURRENT_DATE)
          AND ap.advertised_asin != 'UNATTRIBUTED'
        GROUP BY ap.advertised_asin, p.sku, p.title
        ORDER BY spend DESC
        LIMIT ?
      `, [clientId, days, limit]);
    }

    const totalSpend = rows.reduce((s, r) => s + Number(r.SPEND || 0), 0);
    res.json({
      days,
      totalSpend,
      asins: rows.map(r => ({
        asin:         r.ASIN,
        modelNumber:  r.MODEL_NUMBER || null,
        productTitle: r.PRODUCT_TITLE || r.ASIN,
        spend:        Number(r.SPEND       || 0),
        clicks:       Number(r.CLICKS      || 0),
        impressions:  Number(r.IMPRESSIONS || 0),
        purchases:    Number(r.PURCHASES   || 0),
        sales:        Number(r.SALES       || 0),
        acos:         r.ACOS != null ? Number(r.ACOS) : null,
        roas:         r.ROAS != null ? Number(r.ROAS) : null,
        ctr:          r.CTR  != null ? Number(r.CTR)  : null,
        cpc:          r.CPC  != null ? Number(r.CPC)  : null,
        spendShare:   totalSpend > 0 ? Number(r.SPEND || 0) / totalSpend : 0
      }))
    });
  } catch (err) { next(err); }
});

/**
 * GET /advertising/keyword-efficiency?days=30&limit=10
 */
router.get('/keyword-efficiency', requireAuth, async (req, res, next) => {
  try {
    const days     = Number(req.query.days)  || 30;
    const limit    = Number(req.query.limit) || 10;
    const clientId = req.session.clientId;

    const rows = await query(`
      SELECT
        st.search_term                                                            AS search_term,
        st.keyword                                                                AS keyword,
        SUM(st.cost)                                                              AS total_spend,
        SUM(st.sales_30_d)                                                        AS total_sales,
        SUM(st.purchases_30_d)                                                    AS total_orders,
        SUM(st.clicks)                                                            AS total_clicks,
        SUM(st.impressions)                                                       AS total_impressions,
        CASE WHEN SUM(st.cost) > 0           THEN SUM(st.sales_30_d) / SUM(st.cost)           ELSE NULL END AS roas,
        CASE WHEN SUM(st.sales_30_d) > 0     THEN SUM(st.cost) / SUM(st.sales_30_d)           ELSE NULL END AS acos,
        CASE WHEN SUM(st.impressions) > 0    THEN SUM(st.clicks) / SUM(st.impressions)        ELSE NULL END AS ctr
      FROM sp_search_term_report st
      WHERE st.client_id = ?
        AND st.date >= DATEADD(day, -?, CURRENT_DATE)
        AND st.search_term IS NOT NULL
      GROUP BY st.search_term, st.keyword
    `, [clientId, days]);

    const mapped = rows.map(r => ({
      searchTerm:  r.SEARCH_TERM,
      keyword:     r.KEYWORD || null,
      spend:       Number(r.TOTAL_SPEND       || 0),
      sales:       Number(r.TOTAL_SALES       || 0),
      orders:      Number(r.TOTAL_ORDERS      || 0),
      clicks:      Number(r.TOTAL_CLICKS      || 0),
      impressions: Number(r.TOTAL_IMPRESSIONS || 0),
      roas:        r.ROAS != null ? Number(r.ROAS) : null,
      acos:        r.ACOS != null ? Number(r.ACOS) : null,
      ctr:         r.CTR  != null ? Number(r.CTR)  : null
    }));

    const topByRoas    = [...mapped].filter(r => r.roas != null && r.spend > 10).sort((a, b) => b.roas - a.roas).slice(0, limit);
    const wastedSpend  = [...mapped].filter(r => r.spend > 10 && (r.orders === 0 || (r.acos != null && r.acos > 0.8))).sort((a, b) => b.spend - a.spend).slice(0, limit);

    res.json({ days, topByRoas, wastedSpend });
  } catch (err) { next(err); }
});

module.exports = router;
