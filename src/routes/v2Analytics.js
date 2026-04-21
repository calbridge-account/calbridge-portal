'use strict';
const express = require('express');
const router  = express.Router();
const { v4: uuidv4 } = require('uuid');
const { query } = require('../services/snowflakeService');
const { requireAuth } = require('../middleware/requireAuth');

function getClientId(req) {
  return req.session?.clientId;
}

function parseDateRange(req) {
  const type  = req.query.range || 'mtd';
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const todayStr = today.toISOString().split('T')[0];

  if (type === 'custom') {
    return {
      start: req.query.start || todayStr,
      end:   req.query.end   || todayStr,
    };
  }
  if (type === 'today')     return { start: todayStr, end: todayStr };
  if (type === 'yesterday') {
    const y = new Date(today - 86400000).toISOString().split('T')[0];
    return { start: y, end: y };
  }
  if (type === 'mtd') {
    const start = new Date(today.getUTCFullYear(), today.getUTCMonth(), 1).toISOString().split('T')[0];
    return { start, end: todayStr };
  }
  if (type === 'qtd') {
    const q = Math.floor(today.getUTCMonth() / 3);
    const start = new Date(today.getUTCFullYear(), q * 3, 1).toISOString().split('T')[0];
    return { start, end: todayStr };
  }
  // Rolling Nd
  const days = parseInt(type) || 30;
  const start = new Date(today - days * 86400000).toISOString().split('T')[0];
  return { start, end: todayStr };
}

function n(v) { return v == null ? null : Number(v); }

// ---------------------------------------------------------------------------
// Ensure ACTION_LOG table exists (called once at startup)
// ---------------------------------------------------------------------------
async function ensureActionLogTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS CALBRIDGE_PROD.APP.ACTION_LOG (
      id              VARCHAR(36)    PRIMARY KEY,
      client_id       VARCHAR(36)    NOT NULL,
      opportunity_id  VARCHAR(36),
      action_type     VARCHAR(50),
      entity_type     VARCHAR(30),
      entity_id       VARCHAR(100),
      entity_name     VARCHAR(500),
      status          VARCHAR(20)    DEFAULT 'pending',
      notes           TEXT,
      created_by      VARCHAR(255),
      created_at      TIMESTAMP_NTZ  DEFAULT CURRENT_TIMESTAMP(),
      updated_at      TIMESTAMP_NTZ  DEFAULT CURRENT_TIMESTAMP()
    )
  `, []);
}

ensureActionLogTable()
  .then(() => console.log('[v2Analytics] ACTION_LOG table ready'))
  .catch(err => console.warn('[v2Analytics] ACTION_LOG table creation failed:', err.message));

// ---------------------------------------------------------------------------
// GET /v2-analytics/overview
// ---------------------------------------------------------------------------
router.get('/overview', requireAuth, async (req, res) => {
  try {
    const clientId = getClientId(req);
    const { start, end } = parseDateRange(req);

    const [adRows, dspRows, retailRows, trendRows] = await Promise.all([
      // Advertising KPIs (SP / SB / SD)
      query(`
        SELECT
          SUM(adjusted_cost) AS spend,
          SUM(sales_14d)     AS ad_sales,
          SUM(impressions)   AS impressions,
          SUM(clicks)        AS clicks,
          COUNT(DISTINCT campaign_id) AS campaigns
        FROM CALBRIDGE_PROD.RAW.ADJUSTED_AD_CAMPAIGN
        WHERE client_id = ? AND date BETWEEN ? AND ?
          AND ad_product IN ('SPONSORED_PRODUCTS','SPONSORED_BRANDS','SPONSORED_DISPLAY')
      `, [clientId, start, end]),

      // DSP KPIs
      query(`
        SELECT
          SUM(adjusted_cost) AS dsp_spend,
          SUM(sales_30d)     AS dsp_sales
        FROM CALBRIDGE_PROD.RAW.ADJUSTED_AD_CAMPAIGN
        WHERE client_id = ? AND date BETWEEN ? AND ?
          AND ad_product = 'DSP'
      `, [clientId, start, end]),

      // Retail vendor KPIs
      query(`
        SELECT
          SUM(ordered_units)   AS ordered_units,
          SUM(ordered_revenue) AS ordered_revenue,
          SUM(shipped_units)   AS shipped_units,
          SUM(shipped_revenue) AS shipped_revenue
        FROM CALBRIDGE_PROD.RAW.RETAIL_SALES_TRAFFIC
        WHERE client_id = ? AND date BETWEEN ? AND ?
      `, [clientId, start, end]),

      // Daily spend trend
      query(`
        SELECT
          date,
          SUM(adjusted_cost) AS spend,
          SUM(sales_14d)     AS sales
        FROM CALBRIDGE_PROD.RAW.ADJUSTED_AD_CAMPAIGN
        WHERE client_id = ? AND date BETWEEN ? AND ?
          AND ad_product IN ('SPONSORED_PRODUCTS','SPONSORED_BRANDS','SPONSORED_DISPLAY','DSP')
        GROUP BY date
        ORDER BY date ASC
      `, [clientId, start, end]),
    ]);

    const ad     = adRows[0]    || {};
    const dsp    = dspRows[0]   || {};
    const retail = retailRows[0] || {};

    const totalSpend    = (n(ad.SPEND) || 0) + (n(dsp.DSP_SPEND) || 0);
    const totalAdSales  = (n(ad.AD_SALES) || 0) + (n(dsp.DSP_SALES) || 0);
    const impressions   = n(ad.IMPRESSIONS) || 0;
    const clicks        = n(ad.CLICKS) || 0;

    const kpis = {
      totalSpend,
      totalAdSales,
      blendedAcos:     totalAdSales > 0 ? totalSpend / totalAdSales : null,
      blendedRoas:     totalSpend   > 0 ? totalAdSales / totalSpend : null,
      impressions,
      clicks,
      ctr:             impressions  > 0 ? clicks / impressions : null,
      orderedRevenue:  n(retail.ORDERED_REVENUE) || 0,
      orderedUnits:    n(retail.ORDERED_UNITS)   || 0,
      shippedRevenue:  n(retail.SHIPPED_REVENUE) || 0,
      campaigns:       n(ad.CAMPAIGNS) || 0,
    };

    const spendTrend = trendRows.map(r => ({
      date:  r.DATE,
      spend: n(r.SPEND) || 0,
      sales: n(r.SALES) || 0,
    }));

    res.json({ kpis, spendTrend, range: { start, end } });
  } catch (err) {
    console.error('[v2Analytics /overview]', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /v2-analytics/advertising/campaigns
// ---------------------------------------------------------------------------
router.get('/advertising/campaigns', requireAuth, async (req, res) => {
  try {
    const clientId    = getClientId(req);
    const { start, end } = parseDateRange(req);
    const adProduct   = req.query.adProduct;

    let sql = `
      SELECT
        campaign_id,
        MAX(campaign_name) AS campaign_name,
        MAX(status)        AS status,
        ad_product,
        SUM(adjusted_cost) AS spend,
        SUM(CASE WHEN ad_product = 'DSP' THEN sales_30d ELSE sales_14d END) AS sales,
        SUM(impressions)   AS impressions,
        SUM(clicks)        AS clicks,
        SUM(CASE WHEN ad_product IN ('SPONSORED_PRODUCTS','SPONSORED_BRANDS','SPONSORED_DISPLAY')
              THEN purchases_14d ELSE purchases_30d END) AS purchases,
        SUM(ntb_orders_14d)        AS ntb_orders,
        SUM(viewable_impressions)  AS viewable_impressions
      FROM CALBRIDGE_PROD.RAW.ADJUSTED_AD_CAMPAIGN
      WHERE client_id = ? AND date BETWEEN ? AND ?
    `;
    const params = [clientId, start, end];

    if (adProduct) {
      sql += ` AND ad_product = ?`;
      params.push(adProduct);
    }

    sql += `
      GROUP BY campaign_id, ad_product
      ORDER BY spend DESC NULLS LAST
      LIMIT 200
    `;

    const rows = await query(sql, params);

    const campaigns = rows.map(r => {
      const spend     = n(r.SPEND)       || 0;
      const sales     = n(r.SALES)       || 0;
      const imp       = n(r.IMPRESSIONS) || 0;
      const clicks    = n(r.CLICKS)      || 0;
      const purchases = n(r.PURCHASES)   || 0;

      return {
        campaignId:           r.CAMPAIGN_ID,
        campaignName:         r.CAMPAIGN_NAME,
        status:               r.STATUS,
        adProduct:            r.AD_PRODUCT,
        spend,
        sales,
        impressions:          imp,
        clicks,
        purchases,
        ntbOrders:            n(r.NTB_ORDERS)           || 0,
        viewableImpressions:  n(r.VIEWABLE_IMPRESSIONS) || 0,
        acos:  sales   > 0 ? spend / sales   : null,
        roas:  spend   > 0 ? sales / spend   : null,
        ctr:   imp     > 0 ? clicks / imp    : null,
        cpc:   clicks  > 0 ? spend / clicks  : null,
        cvr:   clicks  > 0 ? purchases / clicks : null,
      };
    });

    res.json({ campaigns, range: { start, end } });
  } catch (err) {
    console.error('[v2Analytics /advertising/campaigns]', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /v2-analytics/advertising/search-terms
// ---------------------------------------------------------------------------
router.get('/advertising/search-terms', requireAuth, async (req, res) => {
  try {
    const clientId = getClientId(req);
    const { start, end } = parseDateRange(req);

    const rows = await query(`
      SELECT
        search_term,
        MAX(campaign_id)   AS campaign_id,
        MAX(match_type)    AS match_type,
        SUM(cost)          AS spend,
        SUM(purchases_30d) AS purchases,
        SUM(sales_30d)     AS sales,
        SUM(impressions)   AS impressions,
        SUM(clicks)        AS clicks
      FROM CALBRIDGE_PROD.RAW.AD_SEARCH_TERM
      WHERE client_id = ? AND date BETWEEN ? AND ?
      GROUP BY search_term
      ORDER BY spend DESC NULLS LAST
      LIMIT 500
    `, [clientId, start, end]);

    const searchTerms = rows.map(r => {
      const spend     = n(r.SPEND)       || 0;
      const sales     = n(r.SALES)       || 0;
      const imp       = n(r.IMPRESSIONS) || 0;
      const clicks    = n(r.CLICKS)      || 0;
      const purchases = n(r.PURCHASES)   || 0;

      return {
        searchTerm:  r.SEARCH_TERM,
        campaignId:  r.CAMPAIGN_ID,
        matchType:   r.MATCH_TYPE,
        spend,
        sales,
        impressions: imp,
        clicks,
        purchases,
        acos: sales  > 0 ? spend / sales  : null,
        roas: spend  > 0 ? sales / spend  : null,
        ctr:  imp    > 0 ? clicks / imp   : null,
        cpc:  clicks > 0 ? spend / clicks : null,
        cvr:  clicks > 0 ? purchases / clicks : null,
      };
    });

    res.json({ searchTerms, range: { start, end } });
  } catch (err) {
    console.error('[v2Analytics /advertising/search-terms]', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /v2-analytics/opportunities
// ---------------------------------------------------------------------------
router.get('/opportunities', requireAuth, async (req, res) => {
  try {
    const clientId = getClientId(req);
    const { start, end } = parseDateRange(req);

    // Run all 4 heuristic queries in parallel; budget query may not have table
    const [raiseBidRows, pauseRows, negKwRows, budgetRows] = await Promise.all([
      // Heuristic 1 — Raise bid (ACOS < 10%)
      query(`
        SELECT campaign_id, MAX(campaign_name) AS campaign_name, ad_product,
          SUM(adjusted_cost) AS spend, SUM(sales_14d) AS sales,
          SUM(impressions) AS impressions
        FROM CALBRIDGE_PROD.RAW.ADJUSTED_AD_CAMPAIGN
        WHERE client_id = ? AND date BETWEEN ? AND ?
          AND ad_product IN ('SPONSORED_PRODUCTS','SPONSORED_BRANDS','SPONSORED_DISPLAY')
        GROUP BY campaign_id, ad_product
        HAVING SUM(adjusted_cost) > 10
          AND SUM(sales_14d) > 0
          AND SUM(adjusted_cost) / SUM(sales_14d) < 0.10
        ORDER BY SUM(adjusted_cost) / SUM(sales_14d) ASC
        LIMIT 20
      `, [clientId, start, end]),

      // Heuristic 2 — Pause waste ($50+ spend, 0 sales)
      query(`
        SELECT campaign_id, MAX(campaign_name) AS campaign_name, ad_product,
          SUM(adjusted_cost) AS spend, SUM(sales_14d) AS sales
        FROM CALBRIDGE_PROD.RAW.ADJUSTED_AD_CAMPAIGN
        WHERE client_id = ? AND date BETWEEN ? AND ?
          AND ad_product IN ('SPONSORED_PRODUCTS','SPONSORED_BRANDS','SPONSORED_DISPLAY')
        GROUP BY campaign_id, ad_product
        HAVING SUM(adjusted_cost) >= 50
          AND COALESCE(SUM(sales_14d), 0) = 0
        ORDER BY spend DESC
        LIMIT 20
      `, [clientId, start, end]),

      // Heuristic 3 — Negative keyword (search term ACOS > 50%)
      query(`
        SELECT search_term,
          SUM(cost) AS spend,
          SUM(sales_30d) AS sales,
          SUM(purchases_30d) AS purchases
        FROM CALBRIDGE_PROD.RAW.AD_SEARCH_TERM
        WHERE client_id = ? AND date BETWEEN ? AND ?
        GROUP BY search_term
        HAVING SUM(cost) >= 10
          AND SUM(sales_30d) > 0
          AND SUM(cost) / SUM(sales_30d) > 0.50
        ORDER BY SUM(cost) DESC
        LIMIT 30
      `, [clientId, start, end]),

      // Heuristic 4 — Budget constrained (graceful fallback)
      query(`
        SELECT campaign_id, MAX(campaign_name) AS campaign_name,
          MAX(budget_amount)   AS budget_amount,
          MAX(budget_pct_used) AS budget_pct_used
        FROM CALBRIDGE_PROD.APP.STREAM_BUDGET_USAGE
        WHERE client_id = ? AND DATE(event_time) = CURRENT_DATE()
        GROUP BY campaign_id
        HAVING MAX(budget_pct_used) >= 0.95
        ORDER BY budget_pct_used DESC
        LIMIT 20
      `, [clientId]).catch(() => []),  // table may not exist yet
    ]);

    const opportunities = [];

    // --- Raise bid ---
    for (const r of raiseBidRows) {
      const spend = n(r.SPEND) || 0;
      const sales = n(r.SALES) || 0;
      const acos  = sales > 0 ? spend / sales : null;
      const priority = acos !== null && acos < 0.05 ? 'high' : 'medium';
      const confidence = acos !== null ? Math.max(0, 1 - (acos / 0.10)) : 0.5;

      opportunities.push({
        id:   uuidv4(),
        type: 'raise_bid',
        priority,
        title: `Raise bid: ${r.CAMPAIGN_NAME || r.CAMPAIGN_ID}`,
        why:   `ACOS is ${acos !== null ? (acos * 100).toFixed(1) : '—'}%, well below target. Increasing bids could capture more volume while staying profitable.`,
        evidence: { spend, sales, acos, impressions: n(r.IMPRESSIONS) || 0 },
        entity: { type: 'campaign', id: r.CAMPAIGN_ID, name: r.CAMPAIGN_NAME || r.CAMPAIGN_ID },
        expectedImpact: 'Increase impression share and sales volume without sacrificing margin.',
        confidence: parseFloat(confidence.toFixed(3)),
        recommendedAction: 'Increase keyword bids by 10–20% in this campaign.',
      });
    }

    // --- Pause waste ---
    for (const r of pauseRows) {
      const spend    = n(r.SPEND) || 0;
      const priority = spend > 200 ? 'high' : 'medium';

      opportunities.push({
        id:   uuidv4(),
        type: 'pause_waste',
        priority,
        title: `Pause campaign: ${r.CAMPAIGN_NAME || r.CAMPAIGN_ID}`,
        why:   `$${spend.toFixed(2)} spent with zero attributed sales in the selected period.`,
        evidence: { spend, sales: 0 },
        entity: { type: 'campaign', id: r.CAMPAIGN_ID, name: r.CAMPAIGN_NAME || r.CAMPAIGN_ID },
        expectedImpact: `Save $${spend.toFixed(2)} in wasted ad spend.`,
        confidence: 0.9,
        recommendedAction: 'Pause this campaign or review its targeting and creative.',
      });
    }

    // --- Add negative keyword ---
    for (const r of negKwRows) {
      const spend = n(r.SPEND) || 0;
      const sales = n(r.SALES) || 0;
      const acos  = sales > 0 ? spend / sales : null;
      const priority    = acos !== null && acos > 1.0 ? 'high' : 'medium';
      const confidence  = parseFloat(Math.min(0.95, spend / (spend + 100)).toFixed(3));

      opportunities.push({
        id:   uuidv4(),
        type: 'add_negative',
        priority,
        title: `Add negative: "${r.SEARCH_TERM}"`,
        why:   `ACOS of ${acos !== null ? (acos * 100).toFixed(1) : '—'}% on this search term — spend $${spend.toFixed(2)} with only $${sales.toFixed(2)} in sales.`,
        evidence: { searchTerm: r.SEARCH_TERM, spend, sales, acos },
        entity: { type: 'search_term', id: r.SEARCH_TERM, name: r.SEARCH_TERM },
        expectedImpact: `Eliminate $${spend.toFixed(2)} in low-efficiency spend.`,
        confidence,
        recommendedAction: `Add "${r.SEARCH_TERM}" as a negative exact keyword.`,
      });
    }

    // --- Raise budget ---
    for (const r of budgetRows) {
      const pct = n(r.BUDGET_PCT_USED) || 0;
      const budget = n(r.BUDGET_AMOUNT) || 0;

      opportunities.push({
        id:   uuidv4(),
        type: 'raise_budget',
        priority: 'high',
        title: `Budget capped: ${r.CAMPAIGN_NAME || r.CAMPAIGN_ID}`,
        why:   `Campaign has used ${(pct * 100).toFixed(0)}% of its daily budget — losing impressions and sales.`,
        evidence: { budgetAmount: budget, budgetPctUsed: pct },
        entity: { type: 'campaign', id: r.CAMPAIGN_ID, name: r.CAMPAIGN_NAME || r.CAMPAIGN_ID },
        expectedImpact: 'Recover lost impressions and incremental sales from budget cap.',
        confidence: 0.85,
        recommendedAction: `Increase daily budget by 20–30% (currently $${budget.toFixed(2)}).`,
      });
    }

    // Sort: high > medium > low, then by confidence desc
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    opportunities.sort((a, b) => {
      const pd = priorityOrder[a.priority] - priorityOrder[b.priority];
      return pd !== 0 ? pd : b.confidence - a.confidence;
    });

    const byType = { raise_bid: 0, pause_waste: 0, add_negative: 0, raise_budget: 0 };
    for (const o of opportunities) byType[o.type] = (byType[o.type] || 0) + 1;

    res.json({
      opportunities,
      summary: { total: opportunities.length, byType },
      range: { start, end },
    });
  } catch (err) {
    console.error('[v2Analytics /opportunities]', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /v2-analytics/actions
// ---------------------------------------------------------------------------
router.get('/actions', requireAuth, async (req, res) => {
  try {
    const clientId = getClientId(req);
    const rows = await query(`
      SELECT id, client_id, opportunity_id, action_type, entity_type, entity_id,
             entity_name, status, notes, created_by, created_at, updated_at
      FROM CALBRIDGE_PROD.APP.ACTION_LOG
      WHERE client_id = ?
      ORDER BY created_at DESC
      LIMIT 100
    `, [clientId]);

    const actions = rows.map(r => ({
      id:            r.ID,
      clientId:      r.CLIENT_ID,
      opportunityId: r.OPPORTUNITY_ID,
      actionType:    r.ACTION_TYPE,
      entityType:    r.ENTITY_TYPE,
      entityId:      r.ENTITY_ID,
      entityName:    r.ENTITY_NAME,
      status:        r.STATUS,
      notes:         r.NOTES,
      createdBy:     r.CREATED_BY,
      createdAt:     r.CREATED_AT,
      updatedAt:     r.UPDATED_AT,
    }));

    res.json({ actions });
  } catch (err) {
    console.error('[v2Analytics GET /actions]', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /v2-analytics/actions
// ---------------------------------------------------------------------------
router.post('/actions', requireAuth, async (req, res) => {
  try {
    const clientId = getClientId(req);
    const { opportunityId, actionType, entityType, entityId, entityName, notes } = req.body;
    const id = uuidv4();
    const createdBy = req.session?.email || clientId;

    await query(`
      INSERT INTO CALBRIDGE_PROD.APP.ACTION_LOG
        (id, client_id, opportunity_id, action_type, entity_type, entity_id, entity_name, status, notes, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `, [id, clientId, opportunityId || null, actionType || null,
        entityType || null, entityId || null, entityName || null,
        notes || null, createdBy]);

    res.status(201).json({
      action: {
        id, clientId, opportunityId, actionType, entityType, entityId, entityName,
        status: 'pending', notes, createdBy, createdAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error('[v2Analytics POST /actions]', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// PATCH /v2-analytics/actions/:id
// ---------------------------------------------------------------------------
const VALID_STATUSES = new Set(['pending', 'accepted', 'rejected', 'snoozed', 'applied', 'failed']);

router.patch('/actions/:id', requireAuth, async (req, res) => {
  try {
    const clientId = getClientId(req);
    const { id }   = req.params;
    const { status, notes } = req.body;

    if (status && !VALID_STATUSES.has(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${[...VALID_STATUSES].join(', ')}` });
    }

    await query(`
      UPDATE CALBRIDGE_PROD.APP.ACTION_LOG
      SET status = COALESCE(?, status),
          notes  = COALESCE(?, notes),
          updated_at = CURRENT_TIMESTAMP()
      WHERE id = ? AND client_id = ?
    `, [status || null, notes || null, id, clientId]);

    res.json({ ok: true, id, status, notes });
  } catch (err) {
    console.error('[v2Analytics PATCH /actions/:id]', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
