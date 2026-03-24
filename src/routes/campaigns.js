const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/requireAuth');
const { query } = require('../services/snowflakeService');
const { v4: uuidv4 } = require('uuid');

/**
 * Ensure campaign_actions table exists.
 * Called once at startup from app.js — but also safe to call inline.
 */
async function ensureCampaignActionsTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS campaign_actions (
      action_id    VARCHAR(36)   PRIMARY KEY,
      client_id    VARCHAR(36)   NOT NULL,
      campaign_id  VARCHAR(100)  NOT NULL,
      action_type  VARCHAR(50)   NOT NULL,
      payload      VARIANT,
      status       VARCHAR(20)   DEFAULT 'pending',
      created_at   TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP,
      executed_at  TIMESTAMP_NTZ
    )
  `);
}

/**
 * Log a queued write action to the campaign_actions table.
 */
async function logCampaignAction(clientId, campaignId, actionType, payload = null) {
  const actionId = uuidv4();
  await query(
    `INSERT INTO campaign_actions (action_id, client_id, campaign_id, action_type, payload, status)
     SELECT ?, ?, ?, ?, PARSE_JSON(?), 'pending'`,
    [actionId, clientId, campaignId, actionType, payload ? JSON.stringify(payload) : 'null']
  );
  return actionId;
}

// ---- Routes ----------------------------------------------------------------

/**
 * GET /campaigns
 * List all campaigns for the logged-in client with full metrics.
 */
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const days = Number(req.query.days) || 30;
    const rows = await query(`
      SELECT
        c.campaign_id,
        c.campaign_name,
        c.campaign_type,
        c.connection_type,
        c.status,
        c.budget,
        COALESCE(SUM(ap.impressions), 0)  AS impressions,
        COALESCE(SUM(ap.clicks),      0)  AS clicks,
        COALESCE(SUM(ap.spend),       0)  AS spend,
        COALESCE(SUM(ap.sales),       0)  AS sales,
        COALESCE(SUM(ap.orders),      0)  AS orders,
        CASE WHEN SUM(ap.sales) > 0 THEN SUM(ap.spend) / SUM(ap.sales) ELSE NULL END  AS acos,
        CASE WHEN SUM(ap.spend) > 0 THEN SUM(ap.sales) / SUM(ap.spend) ELSE NULL END  AS roas,
        CASE WHEN SUM(ap.impressions) > 0 THEN SUM(ap.clicks) / SUM(ap.impressions) ELSE NULL END AS ctr,
        CASE WHEN SUM(ap.clicks) > 0 THEN SUM(ap.spend) / SUM(ap.clicks) ELSE NULL END AS cpc
      FROM ad_campaigns c
      LEFT JOIN ad_performance ap
        ON c.client_id    = ap.client_id
        AND c.campaign_id  = ap.campaign_id
        AND c.connection_type = ap.connection_type
        AND ap.report_date >= DATEADD(day, -?, CURRENT_DATE)
      WHERE c.client_id = ?
      GROUP BY
        c.campaign_id, c.campaign_name, c.campaign_type,
        c.connection_type, c.status, c.budget
      ORDER BY SUM(ap.spend) DESC NULLS LAST
    `, [days, req.session.clientId]);

    res.json(rows);
  } catch (err) { next(err); }
});

/**
 * GET /campaigns/actions/pending
 * List pending (not yet executed) campaign actions for this client.
 * Must come BEFORE /:id to avoid route conflict.
 */
router.get('/actions/pending', requireAuth, async (req, res, next) => {
  try {
    const rows = await query(`
      SELECT action_id, campaign_id, action_type, payload, status, created_at
      FROM campaign_actions
      WHERE client_id = ?
        AND status = 'pending'
      ORDER BY created_at DESC
    `, [req.session.clientId]);

    res.json(rows);
  } catch (err) { next(err); }
});

/**
 * GET /campaigns/:id
 * Single campaign detail with daily performance trend.
 */
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const { id } = req.params;
    const days = Number(req.query.days) || 30;

    // Campaign details
    const campaignRows = await query(`
      SELECT
        c.campaign_id, c.campaign_name, c.campaign_type,
        c.connection_type, c.status, c.budget, 
        COALESCE(SUM(ap.impressions), 0) AS impressions,
        COALESCE(SUM(ap.clicks),      0) AS clicks,
        COALESCE(SUM(ap.spend),       0) AS spend,
        COALESCE(SUM(ap.sales),       0) AS sales,
        COALESCE(SUM(ap.orders),      0) AS orders,
        CASE WHEN SUM(ap.sales) > 0 THEN SUM(ap.spend) / SUM(ap.sales) ELSE NULL END AS acos,
        CASE WHEN SUM(ap.spend) > 0 THEN SUM(ap.sales) / SUM(ap.spend) ELSE NULL END AS roas
      FROM ad_campaigns c
      LEFT JOIN ad_performance ap
        ON c.client_id = ap.client_id
        AND c.campaign_id = ap.campaign_id
        AND c.connection_type = ap.connection_type
        AND ap.report_date >= DATEADD(day, -?, CURRENT_DATE)
      WHERE c.client_id = ?
        AND c.campaign_id = ?
      GROUP BY
        c.campaign_id, c.campaign_name, c.campaign_type,
        c.connection_type, c.status, c.budget
    `, [days, req.session.clientId, id]);

    if (!campaignRows || campaignRows.length === 0) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    // Daily performance trend
    const trendRows = await query(`
      SELECT
        report_date,
        SUM(impressions) AS impressions,
        SUM(clicks)      AS clicks,
        SUM(spend)       AS spend,
        SUM(sales)       AS sales,
        SUM(orders)      AS orders,
        CASE WHEN SUM(sales) > 0 THEN SUM(spend) / SUM(sales) ELSE NULL END AS acos,
        CASE WHEN SUM(spend) > 0 THEN SUM(sales) / SUM(spend) ELSE NULL END AS roas
      FROM ad_performance
      WHERE client_id    = ?
        AND campaign_id  = ?
        AND report_date >= DATEADD(day, -?, CURRENT_DATE)
      GROUP BY report_date
      ORDER BY report_date ASC
    `, [req.session.clientId, id, days]);

    // Pending actions for this campaign
    const actionRows = await query(`
      SELECT action_id, action_type, payload, status, created_at
      FROM campaign_actions
      WHERE client_id = ?
        AND campaign_id = ?
        AND status = 'pending'
      ORDER BY created_at DESC
    `, [req.session.clientId, id]);

    res.json({
      campaign: campaignRows[0],
      trend: trendRows,
      pendingActions: actionRows
    });
  } catch (err) { next(err); }
});

/**
 * POST /campaigns/:id/pause
 * GATED: Queue a pause action.
 */
router.post('/:id/pause', requireAuth, async (req, res, next) => {
  try {
    const { id } = req.params;
    const actionId = await logCampaignAction(req.session.clientId, id, 'pause');
    console.log(`[CampaignAction] PAUSE queued — client=${req.session.clientId} campaign=${id} action=${actionId}`);
    res.json({
      status: 'queued',
      actionId,
      message: 'Campaign pause queued — will execute when write permissions are active'
    });
  } catch (err) { next(err); }
});

/**
 * POST /campaigns/:id/resume
 * GATED: Queue a resume action.
 */
router.post('/:id/resume', requireAuth, async (req, res, next) => {
  try {
    const { id } = req.params;
    const actionId = await logCampaignAction(req.session.clientId, id, 'resume');
    console.log(`[CampaignAction] RESUME queued — client=${req.session.clientId} campaign=${id} action=${actionId}`);
    res.json({
      status: 'queued',
      actionId,
      message: 'Campaign resume queued — will execute when write permissions are active'
    });
  } catch (err) { next(err); }
});

/**
 * PATCH /campaigns/:id/budget
 * GATED: Queue a budget update.
 * Body: { budget: number }
 */
router.patch('/:id/budget', requireAuth, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { budget } = req.body;
    if (budget == null || isNaN(Number(budget)) || Number(budget) <= 0) {
      return res.status(400).json({ error: 'budget must be a positive number' });
    }
    const actionId = await logCampaignAction(req.session.clientId, id, 'update_budget', { budget: Number(budget) });
    console.log(`[CampaignAction] UPDATE_BUDGET queued — client=${req.session.clientId} campaign=${id} budget=${budget} action=${actionId}`);
    res.json({
      status: 'queued',
      actionId,
      message: 'Budget update queued — will execute when write permissions are active'
    });
  } catch (err) { next(err); }
});

/**
 * PATCH /campaigns/:id/bids
 * GATED: Queue a bid update.
 * Body: { bid: number }
 */
router.patch('/:id/bids', requireAuth, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { bid } = req.body;
    if (bid == null || isNaN(Number(bid)) || Number(bid) <= 0) {
      return res.status(400).json({ error: 'bid must be a positive number' });
    }
    const actionId = await logCampaignAction(req.session.clientId, id, 'update_bids', { bid: Number(bid) });
    console.log(`[CampaignAction] UPDATE_BIDS queued — client=${req.session.clientId} campaign=${id} bid=${bid} action=${actionId}`);
    res.json({
      status: 'queued',
      actionId,
      message: 'Bid update queued — will execute when write permissions are active'
    });
  } catch (err) { next(err); }
});

module.exports = router;
module.exports.ensureCampaignActionsTable = ensureCampaignActionsTable;
