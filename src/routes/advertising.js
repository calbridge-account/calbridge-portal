const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/requireAuth');
const { query } = require('../services/snowflakeService');
const { cachedQuery, cacheKey, DEFAULT_TTL_MS } = require('../services/queryCache');
const { resolveClientId } = require('../services/advertiserResolver');
// Cache helper: keyed on clientId + full request URL (includes all query params).
// Each unique combination of date range, channel, and ad type gets its own cache entry,
// so switching date ranges or channels always fetches fresh data from Snowflake.
// clientId must be passed in (already resolved via resolveClientId) so cache keys are
// scoped to the active advertiser, not always the default session clientId.
function reqCache(clientId, req, fetchFn) {
  const ck = cacheKey(clientId, 'url', req.originalUrl);
  return cachedQuery(ck, DEFAULT_TTL_MS, fetchFn);
}

/**
 * Build a Snowflake WHERE fragment that filters by channel.
 * channel = 'ads'  → SP + SB + SD
 * channel = 'dsp'  → DSP only
 * channel = falsy  → all
 */
function channelFilter(channel, adType) {
  // Specific subtype (SP, SB, SD) takes priority
  if (adType && ['SP','SB','SD','DSP'].includes(adType)) return `AND ad_type = '${adType}'`;
  if (channel === 'ads') return `AND ad_type IN ('SP','SB','SD')`;
  if (channel === 'dsp') return `AND ad_type = 'DSP'`;
  return '';
}

/**
 * Build a Snowflake date range WHERE fragment.
 *
 * When startDate + endDate are provided (custom range from the frontend),
 * use an explicit BETWEEN so the query targets the exact historical window.
 * Otherwise fall back to the rolling DATEADD(day, -N, CURRENT_DATE) form.
 *
 * The DATEADD form always rolls back from today — it cannot represent a fixed
 * historical window like "January 2026", which is why custom range selections
 * were showing the wrong data.
 *
 * @param {string} col       - date column name (e.g. 'date', 'order_date')
 * @param {number} days      - rolling window size
 * @param {string} startDate - ISO date string (optional, for custom range)
 * @param {string} endDate   - ISO date string (optional, for custom range)
 */
function dateFilter(col, days, startDate, endDate) {
  // Validate date strings to prevent injection
  const isoRe = /^\d{4}-\d{2}-\d{2}$/;
  if (startDate && endDate && isoRe.test(startDate) && isoRe.test(endDate)) {
    return `AND ${col} BETWEEN '${startDate}' AND '${endDate}'`;
  }
  return `AND ${col} >= DATEADD(day, -${Number(days)}, CURRENT_DATE)`;
}

/**
 * Translate a frontend ?range= param into { startDate, endDate, days }.
 * Mirrors the parseDateRange helper in vendorAnalytics.js.
 */
function parseRange(req) {
  const range = req.query.range || '';
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const todayStr = today.toISOString().split('T')[0];

  if (range === 'mtd') {
    const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    return { startDate: start.toISOString().split('T')[0], endDate: todayStr, days: 30 };
  }
  if (range === 'ytd') {
    const start = new Date(Date.UTC(today.getUTCFullYear(), 0, 1));
    return { startDate: start.toISOString().split('T')[0], endDate: todayStr, days: 365 };
  }
  if (range === 'custom') {
    const isoRe = /^\d{4}-\d{2}-\d{2}$/;
    const start = req.query.start;
    const end   = req.query.end;
    if (start && end && isoRe.test(start) && isoRe.test(end)) {
      return { startDate: start, endDate: end, days: 30 };
    }
  }
  const dayMatch = range.match(/^(\d+)d$/);
  if (dayMatch) {
    return { startDate: null, endDate: null, days: parseInt(dayMatch[1]) };
  }
  // Fallback: honour legacy ?days= param, or default 30
  return { startDate: req.query.startDate || null, endDate: req.query.endDate || null, days: Number(req.query.days) || 30 };
}

/**
 * Response cache middleware factory.
 * Wraps a route handler and caches its JSON response for ttlMs milliseconds.
 * Key = clientId + method + originalUrl (includes all query params).
 * Cache is invalidated on POST /sync.
 */
function withCache(ttlMs, handler) {
  return async (req, res, next) => {
    const clientId = await resolveClientId(req);
    if (!clientId) return handler(req, res, next);
    const ck = cacheKey(clientId, req.originalUrl);
    const hit = await cachedQuery(ck, ttlMs, async () => {
      // Intercept res.json to capture the response
      return new Promise((resolve, reject) => {
        const originalJson = res.json.bind(res);
        res.json = (body) => { resolve(body); return originalJson(body); };
        Promise.resolve(handler(req, res, next)).catch(reject);
      });
    });
    // If already sent (first call), don't send again
    if (!res.headersSent) res.json(hit);
  };
}

/**
 * GET /advertising/summary?days=30&channel=ads|dsp
 * Aggregated KPI totals
 */
router.get('/summary', requireAuth, async (req, res, next) => {
  try {
    const days      = Number(req.query.days) || 30;
    const startDate = req.query.startDate || null;
    const endDate   = req.query.endDate   || null;
    const channel   = req.query.channel;
    const adType    = req.query.adType;
    // Aggregate inside the CTE to avoid Snowflake nested-aggregate error on views
    const clientId = await resolveClientId(req);
    const ck = cacheKey(clientId, 'summary', days, startDate, endDate, channel, adType);
    const rows = await cachedQuery(ck, DEFAULT_TTL_MS, () => query(`
      WITH cp AS (
        SELECT
          COALESCE(SUM(impressions), 0)  AS total_impressions,
          COALESCE(SUM(clicks), 0)       AS total_clicks,
          COALESCE(SUM(adjusted_spend), 0)        AS total_spend,
          COALESCE(SUM(sales), 0)        AS total_sales,
          COALESCE(SUM(orders), 0)       AS total_orders,
          COALESCE(SUM(units_sold), 0)   AS total_units
        FROM adjusted_campaign_performance
        WHERE client_id = ? ${dateFilter('date', days, startDate, endDate)}
        ${channelFilter(channel, adType)}
      )
      SELECT
        total_impressions, total_clicks, total_spend, total_sales, total_orders, total_units,
        CASE WHEN total_sales > 0       THEN total_spend / total_sales           ELSE NULL END AS acos,
        CASE WHEN total_spend > 0       THEN total_sales / total_spend           ELSE NULL END AS roas,
        CASE WHEN total_impressions > 0 THEN total_clicks / total_impressions    ELSE NULL END AS ctr,
        CASE WHEN total_clicks > 0      THEN total_spend / total_clicks          ELSE NULL END AS cpc
      FROM cp
    `, [clientId]));
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
    const startDate = req.query.startDate || null;
    const endDate   = req.query.endDate   || null;
    const channel = req.query.channel;
    const adType  = req.query.adType;
    const clientId = await resolveClientId(req);
    const rows = await reqCache(clientId, req, () => query(`
      WITH cp AS (
        SELECT
          date,
          SUM(impressions) AS impressions,
          SUM(clicks)      AS clicks,
          SUM(adjusted_spend)  AS spend,
          SUM(sales)       AS sales,
          SUM(orders)      AS orders
        FROM adjusted_campaign_performance
        WHERE client_id = ? ${dateFilter("date", days, startDate, endDate)}
        ${channelFilter(channel, adType)}
        GROUP BY date
      )
      SELECT
        date                                                          AS report_date,
        impressions, clicks, spend, sales, orders,
        CASE WHEN sales > 0 THEN spend / sales ELSE NULL END         AS acos,
        CASE WHEN spend > 0 THEN sales / spend ELSE NULL END         AS roas
      FROM cp
      ORDER BY date ASC
    `, [clientId]));
    res.json(rows);
  } catch (err) { next(err); }
});

/**
 * GET /advertising/by-channel?days=30
 * Spend split by ad_type (SP / SB / SD / DSP) — used for channel breakdown cards
 */
router.get('/by-channel', requireAuth, async (req, res, next) => {
  try {
    const days = Number(req.query.days) || 30;
    const startDate = req.query.startDate || null;
    const endDate   = req.query.endDate   || null;
    const clientId = await resolveClientId(req);
    const rows = await reqCache(clientId, req, () => query(`
      WITH cp AS (
        SELECT
          ad_type,
          SUM(impressions) AS impressions,
          SUM(clicks)      AS clicks,
          SUM(adjusted_spend)  AS spend,
          SUM(sales)       AS sales,
          SUM(orders)      AS orders
        FROM adjusted_campaign_performance
        WHERE client_id = ? ${dateFilter("date", days, startDate, endDate)}
        GROUP BY ad_type
      )
      SELECT
        ad_type,
        impressions, clicks, spend, sales, orders,
        CASE WHEN sales > 0 THEN spend / sales ELSE NULL END AS acos,
        CASE WHEN spend > 0 THEN sales / spend ELSE NULL END AS roas
      FROM cp
      ORDER BY spend DESC
    `, [clientId]));
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
    const startDate = req.query.startDate || null;
    const endDate   = req.query.endDate   || null;
    const limit   = Number(req.query.limit) || 200;
    const channel = req.query.channel;
    const adType  = req.query.adType;
    const clientId = await resolveClientId(req);
    const rows = await reqCache(clientId, req, () => query(`
      WITH cp AS (
        SELECT
          campaign_id,
          campaign_name,
          ad_type,
          campaign_status,
          campaign_budget_amount,
          SUM(impressions) AS impressions,
          SUM(clicks)      AS clicks,
          SUM(adjusted_spend)  AS spend,
          SUM(sales)       AS sales,
          SUM(orders)      AS orders,
          SUM(units_sold)  AS units_sold
        FROM adjusted_campaign_performance
        WHERE client_id = ? ${dateFilter("date", days, startDate, endDate)}
        ${channelFilter(channel, adType)}
        GROUP BY campaign_id, campaign_name, ad_type, campaign_status, campaign_budget_amount
      )
      SELECT
        campaign_id,
        campaign_name,
        ad_type,
        campaign_status        AS status,
        campaign_budget_amount AS budget,
        impressions, clicks, spend, sales, orders, units_sold,
        CASE WHEN sales > 0       THEN spend / sales        ELSE NULL END AS acos,
        CASE WHEN spend > 0       THEN sales / spend        ELSE NULL END AS roas,
        CASE WHEN impressions > 0 THEN clicks / impressions ELSE NULL END AS ctr,
        CASE WHEN clicks > 0      THEN spend / clicks       ELSE NULL END AS cpc,
        CASE WHEN clicks > 0      THEN orders / clicks      ELSE NULL END AS cvr
      FROM cp
      ORDER BY spend DESC
      LIMIT ?
    `, [clientId, limit]));
    res.json(rows);
  } catch (err) { next(err); }
});

/**
 * GET /advertising/by-campaign-type?days=30
 * Ad type breakdown for composition chart (SP / SB / SD / DSP)
 */
router.get('/by-campaign-type', requireAuth, async (req, res, next) => {
  try {
    const days = Number(req.query.days) || 30;
    const startDate = req.query.startDate || null;
    const endDate   = req.query.endDate   || null;
    const clientId = await resolveClientId(req);
    const rows = await reqCache(clientId, req, () => query(`
      WITH cp AS (
        SELECT
          ad_type,
          SUM(impressions) AS impressions,
          SUM(clicks)      AS clicks,
          SUM(adjusted_spend)  AS spend,
          SUM(sales)       AS sales,
          SUM(orders)      AS orders
        FROM adjusted_campaign_performance
        WHERE client_id = ? ${dateFilter("date", days, startDate, endDate)}
        GROUP BY ad_type
      )
      SELECT
        ad_type AS campaign_type,
        ad_type AS connection_type,
        impressions, clicks, spend, sales, orders,
        CASE WHEN sales > 0 THEN spend / sales ELSE NULL END AS acos,
        CASE WHEN spend > 0 THEN sales / spend ELSE NULL END AS roas
      FROM cp
      ORDER BY spend DESC
    `, [clientId]));
    res.json(rows);
  } catch (err) { next(err); }
});

/**
 * GET /advertising/roas-by-type?days=30
 */
router.get('/roas-by-type', requireAuth, async (req, res, next) => {
  try {
    const days = Number(req.query.days) || 30;
    const startDate = req.query.startDate || null;
    const endDate   = req.query.endDate   || null;
    const clientId = await resolveClientId(req);

    const [roasRows, salesRow] = await reqCache(clientId, req, () => Promise.all([
      query(`
        WITH cp AS (
          SELECT
            ad_type,
            SUM(impressions) AS impressions,
            SUM(clicks)      AS clicks,
            SUM(adjusted_spend)  AS spend,
            SUM(sales)       AS sales,
            SUM(orders)      AS orders
          FROM adjusted_campaign_performance
          WHERE client_id = ? ${dateFilter("date", days, startDate, endDate)}
          GROUP BY ad_type
        )
        SELECT
          ad_type AS campaign_type,
          ad_type AS connection_type,
          impressions, clicks, spend, sales, orders,
          CASE WHEN spend > 0       THEN sales / spend        ELSE NULL END AS roas,
          CASE WHEN sales > 0       THEN spend / sales        ELSE NULL END AS acos,
          CASE WHEN impressions > 0 THEN clicks / impressions ELSE NULL END AS ctr
        FROM cp
        ORDER BY spend DESC
      `, [clientId]),
      query(`
        SELECT COALESCE(SUM(ordered_revenue + COALESCE(shipped_revenue, 0)), 0) AS total_revenue
        FROM vendor_purchase_orders
        WHERE client_id = ? ${dateFilter("order_date", days, startDate, endDate)}
      `, [clientId])
    ]));

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
    const { days, startDate, endDate } = parseRange(req);
    const limit    = Number(req.query.limit) || 200;
    const adType   = req.query.adType ? req.query.adType.toUpperCase() : null;
    const clientId = await resolveClientId(req);

    let rows = await reqCache(clientId, req, async () => {
    let r = [];
    try {
      r = await query(`
        SELECT
          p.advertised_asin                                                       AS asin,
          MAX(pr.sku)                                                             AS model_number,
          COALESCE(MAX(pr.title), p.advertised_asin)                             AS product_title,
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
          ${dateFilter("p.date", days, startDate, endDate)}
          AND p.advertised_asin != 'UNATTRIBUTED'
          ${adType && adType !== 'DSP' ? '' : '/* sp-only table, no adType filter needed */'}
        GROUP BY p.advertised_asin
        ORDER BY spend DESC
        LIMIT ?
      `, [clientId, limit]);
      // sp_advertised_product_report is SP-only — if a non-SP adType was requested,
      // return empty so the fallback (which has ad_type column) can handle it
      if (adType && !['SP', 'ALL'].includes(adType)) r = [];
    } catch (e) {
      // Fallback: older table
      r = await query(`
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
          ${dateFilter("ap.report_date", days, startDate, endDate)}
          AND ap.advertised_asin != 'UNATTRIBUTED'
          ${adType ? `AND ap.ad_type = '${adType}'` : ''}
        GROUP BY ap.advertised_asin
        ORDER BY spend DESC
        LIMIT ?
      `, [clientId, limit]);
    }
    return r;
    });

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
    const startDate = req.query.startDate || null;
    const endDate   = req.query.endDate   || null;
    const limit    = Number(req.query.limit) || 10;
    const clientId = await resolveClientId(req);

    const rows = await reqCache(clientId, req, () => query(`
      SELECT
        st.search_term                                                            AS search_term,
        st.keyword                                                                AS keyword,
        MAX(st.match_type)                                                        AS match_type,
        SUM(st.cost)                                                              AS total_spend,
        SUM(st.sales_30_d)                                                        AS total_sales,
        SUM(st.purchases_30_d)                                                    AS total_orders,
        SUM(st.clicks)                                                            AS total_clicks,
        SUM(st.impressions)                                                       AS total_impressions,
        CASE WHEN SUM(st.cost) > 0           THEN SUM(st.sales_30_d) / SUM(st.cost)           ELSE NULL END AS roas,
        CASE WHEN SUM(st.sales_30_d) > 0     THEN SUM(st.cost) / SUM(st.sales_30_d)           ELSE NULL END AS acos,
        CASE WHEN SUM(st.impressions) > 0    THEN SUM(st.clicks) / SUM(st.impressions)        ELSE NULL END AS ctr,
        CASE WHEN SUM(st.clicks) > 0         THEN SUM(st.purchases_30_d) / SUM(st.clicks)     ELSE NULL END AS cvr
      FROM sp_search_term_report st
      WHERE st.client_id = ?
        ${dateFilter("st.date", days, startDate, endDate)}
        AND st.search_term IS NOT NULL
      GROUP BY st.search_term, st.keyword
    `, [clientId]));

    const mapped = rows.map(r => ({
      searchTerm:  r.SEARCH_TERM,
      keyword:     r.KEYWORD || null,
      matchType:   r.MATCH_TYPE || null,
      spend:       Number(r.TOTAL_SPEND       || 0),
      sales:       Number(r.TOTAL_SALES       || 0),
      orders:      Number(r.TOTAL_ORDERS      || 0),
      clicks:      Number(r.TOTAL_CLICKS      || 0),
      impressions: Number(r.TOTAL_IMPRESSIONS || 0),
      roas:        r.ROAS != null ? Number(r.ROAS) : null,
      acos:        r.ACOS != null ? Number(r.ACOS) : null,
      ctr:         r.CTR  != null ? Number(r.CTR)  : null,
      cvr:         r.CVR  != null ? Number(r.CVR)  : null
    }));

    const topByRoas    = [...mapped].filter(r => r.roas != null && r.spend > 10).sort((a, b) => b.roas - a.roas).slice(0, limit);
    const wastedSpend  = [...mapped].filter(r => r.spend > 10 && (r.orders === 0 || (r.acos != null && r.acos > 0.8))).sort((a, b) => b.spend - a.spend).slice(0, limit);

    res.json({ days, topByRoas, wastedSpend });
  } catch (err) { next(err); }
});

/**
 * GET /advertising/keyword-targeting?days=30&limit=200&adType=SP|SB|SD
 * Keyword-level performance — SP from sp_targeting_keyword_report,
 * SB from sb_keyword_report. Results unioned and sorted by spend desc.
 */
router.get('/keyword-targeting', requireAuth, async (req, res, next) => {
  try {
    const days      = Number(req.query.days)  || 30;
    const startDate = req.query.startDate || null;
    const endDate   = req.query.endDate   || null;
    const limit     = Number(req.query.limit) || 500;
    const adType    = req.query.adType || null;  // 'SP' | 'SB' | null (all)
    const clientId  = await resolveClientId(req);

    // Build query — SP only, SB only, or both via UNION ALL
    let sql, binds;
    const spSql = `
      SELECT
        'SP'                                                                      AS ad_type,
        COALESCE(keyword, targeting)                                              AS keyword,
        COALESCE(match_type, 'AUTO')                                              AS match_type,
        MAX(campaign_name)                                                        AS campaign_name,
        MAX(ad_group_name)                                                        AS ad_group_name,
        MAX(ad_keyword_status)                                                    AS keyword_status,
        MAX(keyword_bid)                                                          AS keyword_bid,
        SUM(impressions)                                                          AS impressions,
        SUM(clicks)                                                               AS clicks,
        SUM(cost)                                                                 AS spend,
        SUM(purchases_30_d)                                                       AS orders,
        SUM(sales_30_d)                                                           AS sales,
        SUM(units_sold_clicks_30_d)                                               AS units_sold,
        CASE WHEN SUM(sales_30_d) > 0        THEN SUM(cost) / SUM(sales_30_d)          ELSE NULL END AS acos,
        CASE WHEN SUM(cost) > 0              THEN SUM(sales_30_d) / SUM(cost)          ELSE NULL END AS roas,
        CASE WHEN SUM(impressions) > 0       THEN SUM(clicks) / SUM(impressions)       ELSE NULL END AS ctr,
        CASE WHEN SUM(clicks) > 0            THEN SUM(purchases_30_d) / SUM(clicks)    ELSE NULL END AS cvr,
        CASE WHEN SUM(clicks) > 0            THEN SUM(cost) / SUM(clicks)              ELSE NULL END AS cpc
      FROM sp_targeting_keyword_report
      WHERE client_id = ?
        ${dateFilter('date', days, startDate, endDate)}
        AND COALESCE(keyword, targeting) IS NOT NULL
      GROUP BY COALESCE(keyword, targeting), COALESCE(match_type, 'AUTO')`;

    const sbSql = `
      SELECT
        'SB'                                                                      AS ad_type,
        COALESCE(keyword_text, targeting_text)                                    AS keyword,
        COALESCE(match_type, 'N/A')                                               AS match_type,
        MAX(campaign_name)                                                        AS campaign_name,
        MAX(ad_group_name)                                                        AS ad_group_name,
        MAX(ad_keyword_status)                                                    AS keyword_status,
        MAX(keyword_bid)                                                          AS keyword_bid,
        SUM(impressions)                                                          AS impressions,
        SUM(clicks)                                                               AS clicks,
        SUM(cost)                                                                 AS spend,
        SUM(purchases)                                                            AS orders,
        SUM(sales)                                                                AS sales,
        SUM(units_sold)                                                           AS units_sold,
        CASE WHEN SUM(sales) > 0        THEN SUM(cost) / SUM(sales)             ELSE NULL END AS acos,
        CASE WHEN SUM(cost) > 0         THEN SUM(sales) / SUM(cost)             ELSE NULL END AS roas,
        CASE WHEN SUM(impressions) > 0  THEN SUM(clicks) / SUM(impressions)     ELSE NULL END AS ctr,
        CASE WHEN SUM(clicks) > 0       THEN SUM(purchases) / SUM(clicks)       ELSE NULL END AS cvr,
        CASE WHEN SUM(clicks) > 0       THEN SUM(cost) / SUM(clicks)            ELSE NULL END AS cpc
      FROM sb_keyword_report
      WHERE client_id = ?
        ${dateFilter('report_date', days, startDate, endDate)}
        AND COALESCE(keyword_text, targeting_text) IS NOT NULL
      GROUP BY COALESCE(keyword_text, targeting_text), COALESCE(match_type, 'N/A')`;

    if (adType === 'SP') {
      sql = spSql; binds = [clientId];
    } else if (adType === 'SB') {
      sql = sbSql; binds = [clientId];
    } else {
      sql = `${spSql} UNION ALL ${sbSql}`; binds = [clientId, clientId];
    }

    const rows = await reqCache(clientId, req, () => query(sql, binds));

    // Sort combined results by spend desc and limit
    const sorted = rows
      .filter(r => Number(r.SPEND || 0) > 0)
      .sort((a, b) => Number(b.SPEND || 0) - Number(a.SPEND || 0))
      .slice(0, limit);

    res.json(sorted.map(r => ({
      adType:        r.AD_TYPE,
      keyword:       r.KEYWORD,
      matchType:     r.MATCH_TYPE || null,
      campaignName:  r.CAMPAIGN_NAME || null,
      adGroupName:   r.AD_GROUP_NAME || null,
      keywordStatus: r.KEYWORD_STATUS || null,
      keywordBid:    r.KEYWORD_BID != null ? Number(r.KEYWORD_BID) : null,
      impressions:   Number(r.IMPRESSIONS || 0),
      clicks:        Number(r.CLICKS      || 0),
      spend:         Number(r.SPEND       || 0),
      orders:        Number(r.ORDERS      || 0),
      sales:         Number(r.SALES       || 0),
      unitsSold:     Number(r.UNITS_SOLD  || 0),
      acos:          r.ACOS != null ? Number(r.ACOS) : null,
      roas:          r.ROAS != null ? Number(r.ROAS) : null,
      ctr:           r.CTR  != null ? Number(r.CTR)  : null,
      cvr:           r.CVR  != null ? Number(r.CVR)  : null,
      cpc:           r.CPC  != null ? Number(r.CPC)  : null
    })));
  } catch (err) { next(err); }
});

/**
 * GET /advertising/targeting-rollup?days=30
 * Aggregate keyword performance rolled up by targeting type (Auto / Broad / Phrase / Exact)
 * across SP + SB, with a total row. Also returns per-type top keywords.
 */
router.get('/targeting-rollup', requireAuth, async (req, res, next) => {
  try {
    const days      = Number(req.query.days) || 30;
    const startDate = req.query.startDate || null;
    const endDate   = req.query.endDate   || null;
    const clientId  = await resolveClientId(req);

    // Normalize Amazon match_type values to 4 display buckets
    // AUTO: TARGETING_EXPRESSION, TARGETING_EXPRESSION_PREDEFINED, null
    // BROAD / PHRASE / EXACT: as-is
    const [spRows, sbRows] = await Promise.all([
      query(`
        SELECT
          COALESCE(match_type, 'TARGETING_EXPRESSION') AS raw_match_type,
          SUM(impressions)      AS impressions,
          SUM(clicks)           AS clicks,
          SUM(cost)             AS spend,
          SUM(purchases_30_d)   AS orders,
          SUM(sales_30_d)       AS sales,
          SUM(units_sold_clicks_30_d) AS units_sold
        FROM sp_targeting_keyword_report
        WHERE client_id = ?
          ${dateFilter('date', days, startDate, endDate)}
        GROUP BY COALESCE(match_type, 'TARGETING_EXPRESSION')
      `, [clientId]),
      query(`
        SELECT
          COALESCE(match_type, 'N/A') AS raw_match_type,
          SUM(impressions)   AS impressions,
          SUM(clicks)        AS clicks,
          SUM(cost)          AS spend,
          SUM(purchases)     AS orders,
          SUM(sales)         AS sales,
          SUM(units_sold)    AS units_sold
        FROM sb_keyword_report
        WHERE client_id = ?
          ${dateFilter('report_date', days, startDate, endDate)}
        GROUP BY COALESCE(match_type, 'N/A')
      `, [clientId])
    ]);

    const normalizeMatchType = mt => {
      if (!mt) return 'AUTO';
      const u = mt.toUpperCase();
      if (u === 'TARGETING_EXPRESSION' || u === 'TARGETING_EXPRESSION_PREDEFINED' || u === 'N/A') return 'AUTO';
      if (u === 'BROAD')  return 'BROAD';
      if (u === 'PHRASE') return 'PHRASE';
      if (u === 'EXACT')  return 'EXACT';
      return 'AUTO';
    };

    // Merge SP + SB into 4 buckets
    const buckets = { AUTO: null, BROAD: null, PHRASE: null, EXACT: null };
    for (const r of [...spRows, ...sbRows]) {
      const mt = normalizeMatchType(r.RAW_MATCH_TYPE);
      if (!buckets[mt]) buckets[mt] = { matchType: mt, impressions: 0, clicks: 0, spend: 0, orders: 0, sales: 0, unitsSold: 0 };
      buckets[mt].impressions += Number(r.IMPRESSIONS || 0);
      buckets[mt].clicks      += Number(r.CLICKS      || 0);
      buckets[mt].spend       += Number(r.SPEND       || 0);
      buckets[mt].orders      += Number(r.ORDERS      || 0);
      buckets[mt].sales       += Number(r.SALES       || 0);
      buckets[mt].unitsSold   += Number(r.UNITS_SOLD  || 0);
    }

    // Compute derived metrics per bucket
    const byType = Object.values(buckets).filter(Boolean).map(b => ({
      ...b,
      acos: b.sales > 0 ? b.spend / b.sales : null,
      roas: b.spend > 0 ? b.sales / b.spend : null,
      ctr:  b.impressions > 0 ? b.clicks / b.impressions : null,
      cvr:  b.clicks > 0 ? b.orders / b.clicks : null,
      cpc:  b.clicks > 0 ? b.spend / b.clicks : null
    })).sort((a, b) => b.spend - a.spend);

    // Total row
    const total = byType.reduce((acc, b) => ({
      impressions: acc.impressions + b.impressions,
      clicks:      acc.clicks      + b.clicks,
      spend:       acc.spend       + b.spend,
      orders:      acc.orders      + b.orders,
      sales:       acc.sales       + b.sales,
      unitsSold:   acc.unitsSold   + b.unitsSold
    }), { impressions: 0, clicks: 0, spend: 0, orders: 0, sales: 0, unitsSold: 0 });

    total.acos = total.sales > 0 ? total.spend / total.sales : null;
    total.roas = total.spend > 0 ? total.sales / total.spend : null;
    total.ctr  = total.impressions > 0 ? total.clicks / total.impressions : null;
    total.cvr  = total.clicks > 0 ? total.orders / total.clicks : null;
    total.cpc  = total.clicks > 0 ? total.spend / total.clicks : null;

    res.json({ days, total, byType });
  } catch (err) { next(err); }
});

/**
 * GET /advertising/dsp-summary?days=30
 * DSP-specific KPIs: DPVs, NTB, viewability, video completions
 */
router.get('/dsp-summary', requireAuth, async (req, res, next) => {
  try {
    const days     = Number(req.query.days) || 30;
    const startDate = req.query.startDate || null;
    const endDate   = req.query.endDate   || null;
    const clientId = await resolveClientId(req);

    const rows = await reqCache(clientId, req, () => query(`
      SELECT
        SUM(impressions)                                                          AS total_impressions,
        SUM(clicks)                                                               AS total_clicks,
        SUM(adjusted_spend)                                                       AS total_spend,
        SUM(sales)                                                                AS total_sales,
        SUM(total_purchases)                                                      AS total_purchases,
        SUM(detail_page_views)                                                    AS total_dpv,
        SUM(new_to_brand_purchases)                                               AS total_ntb_purchases,
        SUM(new_to_brand_sales)                                                   AS total_ntb_sales,
        SUM(viewable_impressions)                                                 AS total_viewable_impressions,
        SUM(add_to_cart)                                                          AS total_atc,
        SUM(video_ad_complete)                                                    AS total_video_completions,
        SUM(orders)                                                               AS grand_total_purchases,
        SUM(sales)                                                                AS grand_total_sales,
        CASE WHEN SUM(adjusted_spend) > 0     THEN SUM(sales) / SUM(adjusted_spend)            ELSE NULL END AS roas,
        CASE WHEN SUM(impressions) > 0        THEN SUM(clicks) / SUM(impressions)              ELSE NULL END AS ctr,
        CASE WHEN SUM(impressions) > 0        THEN SUM(viewable_impressions) / SUM(impressions) ELSE NULL END AS viewability_rate,
        CASE WHEN SUM(video_ad_start) > 0     THEN SUM(video_ad_complete) / SUM(video_ad_start) ELSE NULL END AS vcr,
        CASE WHEN SUM(adjusted_spend) > 0     THEN SUM(detail_page_views) / SUM(adjusted_spend) ELSE NULL END AS dpvr
      FROM adjusted_campaign_performance
      WHERE client_id = ?
        AND ad_type = 'DSP'
        ${dateFilter("date", days, startDate, endDate)}
    `, [clientId]));

    const d = rows[0] || {};
    res.json({
      totalSpend:             Number(d.TOTAL_SPEND              || 0),
      totalSales:             Number(d.TOTAL_SALES              || 0),
      totalImpressions:       Number(d.TOTAL_IMPRESSIONS        || 0),
      totalClicks:            Number(d.TOTAL_CLICKS             || 0),
      totalPurchases:         Number(d.TOTAL_PURCHASES          || 0),
      totalDpv:               Number(d.TOTAL_DPV                || 0),
      totalNtbPurchases:      Number(d.TOTAL_NTB_PURCHASES      || 0),
      totalNtbSales:          Number(d.TOTAL_NTB_SALES          || 0),
      totalViewableImpr:      Number(d.TOTAL_VIEWABLE_IMPRESSIONS || 0),
      totalAtc:               Number(d.TOTAL_ATC                || 0),
      totalVideoCompletions:  Number(d.TOTAL_VIDEO_COMPLETIONS  || 0),
      grandTotalPurchases:    Number(d.GRAND_TOTAL_PURCHASES     || 0),
      grandTotalSales:        Number(d.GRAND_TOTAL_SALES         || 0),
      roas:           d.ROAS            != null ? Number(d.ROAS)            : null,
      ctr:            d.CTR             != null ? Number(d.CTR)             : null,
      viewabilityRate: d.VIEWABILITY_RATE != null ? Number(d.VIEWABILITY_RATE) : null,
      vcr:            d.VCR             != null ? Number(d.VCR)             : null,
      dpvr:           d.DPVR            != null ? Number(d.DPVR)            : null
    });
  } catch (err) { next(err); }
});

/**
 * GET /advertising/dsp-orders?days=30&limit=200
 * DSP order/line-item campaign breakdown
 */
router.get('/dsp-orders', requireAuth, async (req, res, next) => {
  try {
    const days     = Number(req.query.days)  || 30;
    const startDate = req.query.startDate || null;
    const endDate   = req.query.endDate   || null;
    const limit    = Number(req.query.limit) || 200;
    const clientId = await resolveClientId(req);

    const rows = await reqCache(clientId, req, () => query(`
      SELECT
        campaign_id,
        MAX(campaign_name)                                                        AS order_name,
        MAX(order_budget)                                                         AS order_budget,
        MAX(order_start_date)                                                     AS order_start_date,
        MAX(order_end_date)                                                       AS order_end_date,
        SUM(impressions)                                                          AS impressions,
        SUM(clicks)                                                               AS clicks,
        SUM(adjusted_spend)                                                       AS spend,
        SUM(sales)                                                                AS sales,
        SUM(orders)                                                               AS purchases,
        SUM(detail_page_views)                                                    AS dpv,
        SUM(new_to_brand_purchases)                                               AS ntb_purchases,
        SUM(new_to_brand_sales)                                                   AS ntb_sales,
        SUM(viewable_impressions)                                                 AS viewable_impressions,
        SUM(add_to_cart)                                                          AS atc,
        SUM(video_ad_complete)                                                    AS video_completions,
        CASE WHEN SUM(adjusted_spend) > 0  THEN SUM(sales) / SUM(adjusted_spend)   ELSE NULL END AS roas,
        CASE WHEN SUM(impressions) > 0     THEN SUM(clicks) / SUM(impressions)      ELSE NULL END AS ctr,
        CASE WHEN SUM(impressions) > 0     THEN SUM(viewable_impressions) / SUM(impressions) ELSE NULL END AS viewability_rate
      FROM adjusted_campaign_performance
      WHERE client_id = ?
        AND ad_type = 'DSP'
        ${dateFilter("date", days, startDate, endDate)}
      GROUP BY campaign_id
      ORDER BY SUM(adjusted_spend) DESC
      LIMIT ?
    `, [clientId, limit]));

    res.json(rows.map(r => ({
      orderId:          r.CAMPAIGN_ID,
      orderName:        r.ORDER_NAME       || r.CAMPAIGN_ID,
      orderBudget:      r.ORDER_BUDGET     != null ? Number(r.ORDER_BUDGET) : null,
      orderStart:       r.ORDER_START_DATE || null,
      orderEnd:         r.ORDER_END_DATE   || null,
      impressions:      Number(r.IMPRESSIONS        || 0),
      clicks:           Number(r.CLICKS             || 0),
      spend:            Number(r.SPEND              || 0),
      sales:            Number(r.SALES              || 0),
      purchases:        Number(r.PURCHASES          || 0),
      dpv:              Number(r.DPV                || 0),
      ntbPurchases:     Number(r.NTB_PURCHASES      || 0),
      ntbSales:         Number(r.NTB_SALES          || 0),
      viewableImpr:     Number(r.VIEWABLE_IMPRESSIONS || 0),
      atc:              Number(r.ATC                || 0),
      videoCompletions: Number(r.VIDEO_COMPLETIONS  || 0),
      roas:             r.ROAS             != null ? Number(r.ROAS)             : null,
      ctr:              r.CTR              != null ? Number(r.CTR)              : null,
      viewabilityRate:  r.VIEWABILITY_RATE != null ? Number(r.VIEWABILITY_RATE) : null
    })));
  } catch (err) { next(err); }
});

/**
 * GET /advertising/keyword-type-breakdown?days=30
 * SP spend/sales/orders/acos grouped by match_type (Auto, Broad, Phrase, Exact)
 */
router.get('/keyword-type-breakdown', requireAuth, async (req, res, next) => {
  try {
    const days      = Number(req.query.days) || 30;
    const startDate = req.query.startDate || null;
    const endDate   = req.query.endDate   || null;
    const clientId  = await resolveClientId(req);

    const rows = await reqCache(clientId, req, () => query(`
      SELECT
        COALESCE(match_type, 'AUTO')                                              AS match_type,
        SUM(cost)                                                                 AS spend,
        SUM(sales_30_d)                                                           AS sales,
        SUM(purchases_30_d)                                                       AS orders,
        SUM(clicks)                                                               AS clicks,
        SUM(impressions)                                                          AS impressions,
        CASE WHEN SUM(sales_30_d) > 0 THEN SUM(cost) / SUM(sales_30_d) ELSE NULL END AS acos,
        CASE WHEN SUM(cost) > 0       THEN SUM(sales_30_d) / SUM(cost) ELSE NULL END AS roas
      FROM sp_targeting_keyword_report
      WHERE client_id = ?
        ${dateFilter("date", days, startDate, endDate)}
      GROUP BY COALESCE(match_type, 'AUTO')
      ORDER BY SUM(cost) DESC
    `, [clientId]));

    // Normalize Amazon's internal match type names to the 4 display categories
    const normalizeMatchType = mt => {
      if (!mt) return 'AUTO';
      const u = mt.toUpperCase();
      if (u === 'TARGETING_EXPRESSION' || u === 'TARGETING_EXPRESSION_PREDEFINED') return 'AUTO';
      if (u === 'BROAD')  return 'BROAD';
      if (u === 'PHRASE') return 'PHRASE';
      if (u === 'EXACT')  return 'EXACT';
      return 'AUTO'; // catch-all (Placeholder keyword etc.)
    };

    // Merge rows with the same normalized type
    const merged = {};
    for (const r of rows) {
      const mt = normalizeMatchType(r.MATCH_TYPE);
      if (!merged[mt]) merged[mt] = { matchType: mt, spend: 0, sales: 0, orders: 0, clicks: 0, impressions: 0 };
      merged[mt].spend       += Number(r.SPEND       || 0);
      merged[mt].sales       += Number(r.SALES       || 0);
      merged[mt].orders      += Number(r.ORDERS      || 0);
      merged[mt].clicks      += Number(r.CLICKS      || 0);
      merged[mt].impressions += Number(r.IMPRESSIONS || 0);
    }

    res.json(Object.values(merged).map(m => ({
      ...m,
      acos: m.sales > 0 ? m.spend / m.sales : null,
      roas: m.spend > 0 ? m.sales / m.spend : null
    })));
  } catch (err) { next(err); }
});

module.exports = router;
