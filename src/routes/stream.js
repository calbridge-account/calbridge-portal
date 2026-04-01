/**
 * Amazon Marketing Stream — admin routes
 *
 * GET  /admin/stream/budget-exhaustion?clientId=xxx
 *   Returns today's budget usage across campaigns for a client.
 *   Source: stream_budget_usage table, populated by the SQS poller every 5 minutes.
 *
 * POST /admin/stream/subscribe
 *   Subscribe a client/profile to a Marketing Stream dataset.
 *   One-time setup per client/profile/dataset combo.
 *   Body: { clientId, profileId, dataset, sqsQueueArn, sqsQueueUrl }
 *
 * GET  /admin/stream/subscriptions?clientId=xxx
 *   List active stream subscriptions for a client.
 */
'use strict';

const express = require('express');
const router = express.Router();
const { query } = require('../services/snowflakeService');

// Admin auth middleware (same as adminOps.js)
function requireAdmin(req, res, next) {
  if (!req.session?.adminId) return res.status(401).json({ error: 'Admin authentication required' });
  next();
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /admin/stream/budget-exhaustion?clientId=xxx
// Returns today's budget usage ordered by % consumed desc (exhausted first).
// ─────────────────────────────────────────────────────────────────────────────
router.get('/stream/budget-exhaustion', requireAdmin, async (req, res, next) => {
  try {
    const { clientId } = req.query;
    if (!clientId) return res.status(400).json({ error: 'clientId required' });

    const { getBudgetExhaustionSummary } = require('../services/marketingStreamService');
    const data = await getBudgetExhaustionSummary(clientId);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /admin/stream/subscribe
// Subscribe a client/profile to a dataset via Amazon Ads API.
// Body: { clientId, profileId, dataset, sqsQueueArn, sqsQueueUrl }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/stream/subscribe', requireAdmin, async (req, res, next) => {
  try {
    const { clientId, profileId, dataset, sqsQueueArn, sqsQueueUrl } = req.body;

    if (!clientId || !profileId || !dataset || !sqsQueueArn) {
      return res.status(400).json({
        error: 'clientId, profileId, dataset, and sqsQueueArn are required',
        validDatasets: ['sp-traffic', 'sp-conversion', 'budget-usage', 'sb-traffic']
      });
    }

    const { subscribeToDataset } = require('../services/marketingStreamService');
    const subscriptionId = await subscribeToDataset(clientId, profileId, dataset, sqsQueueArn, sqsQueueUrl || '');
    res.json({ ok: true, subscriptionId });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /admin/stream/subscriptions?clientId=xxx
// List all stream subscriptions for a client (for ops visibility).
// ─────────────────────────────────────────────────────────────────────────────
router.get('/stream/subscriptions', requireAdmin, async (req, res, next) => {
  try {
    const { clientId } = req.query;

    const whereClause = clientId ? 'WHERE client_id = ?' : '';
    const binds = clientId ? [clientId] : [];

    const rows = await query(`
      SELECT id, client_id, profile_id, dataset, subscription_id,
             sqs_queue_url, sqs_queue_arn, status, created_at
      FROM stream_subscriptions
      ${whereClause}
      ORDER BY client_id, dataset
    `, binds);

    res.json(rows.map(r => ({
      id:             r.ID,
      clientId:       r.CLIENT_ID,
      profileId:      r.PROFILE_ID,
      dataset:        r.DATASET,
      subscriptionId: r.SUBSCRIPTION_ID,
      sqsQueueUrl:    r.SQS_QUEUE_URL,
      sqsQueueArn:    r.SQS_QUEUE_ARN,
      status:         r.STATUS,
      createdAt:      r.CREATED_AT
    })));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
