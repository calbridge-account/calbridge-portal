'use strict';

const express = require('express');
const router  = express.Router();
const { requireAuth } = require('../middleware/requireAuth');
const { requirePlan } = require('../middleware/requirePlan');
const { analyze, executeAction } = require('../services/decisionEngine');
const { query } = require('../services/snowflakeService');
const { resolveClientId } = require('../services/advertiserResolver');

// ─── GET /decisions/stats ─────────────────────────────────────────────────────
router.get('/stats', requireAuth, async (req, res, next) => {
  try {
    const clientId = await resolveClientId(req);
    const rows = await query(`
      SELECT status, COUNT(*) as cnt
      FROM CALBRIDGE_PROD.APP.decision_actions
      WHERE client_id = ?
        AND created_at >= DATE_TRUNC('month', CURRENT_DATE())
      GROUP BY status
    `, [clientId]);
    const stats = { pending: 0, approved: 0, executed: 0, rejected: 0, failed: 0, snoozed: 0 };
    rows.forEach(r => { stats[(r.STATUS||'').toLowerCase()] = Number(r.CNT || 0); });
    res.json(stats);
  } catch (err) { next(err); }
});

// ─── GET /decisions/analyze ───────────────────────────────────────────────────
router.get('/analyze', requireAuth, async (req, res, next) => {
  try {
    const clientId = await resolveClientId(req);
    const days = Number(req.query.days) || 30;
    const result = await analyze(clientId, days);
    res.json(result);
  } catch (err) { next(err); }
});

// ─── GET /decisions/pending ───────────────────────────────────────────────────
router.get('/pending', requireAuth, async (req, res, next) => {
  try {
    const clientId = await resolveClientId(req);
    const limit  = Math.min(Number(req.query.limit)  || 100, 500);
    const offset = Number(req.query.offset) || 0;
    const type   = req.query.type || null;

    const rows = await query(`
      SELECT *
      FROM CALBRIDGE_PROD.APP.decision_actions
      WHERE client_id = ?
        AND status = 'pending'
        AND (snoozed_until IS NULL OR snoozed_until <= CURRENT_DATE())
        ${type ? `AND action_type = '${type}'` : ''}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `, [clientId, limit, offset]);

    res.json(rows.map(formatAction));
  } catch (err) { next(err); }
});

// ─── GET /decisions/history ───────────────────────────────────────────────────
router.get('/history', requireAuth, async (req, res, next) => {
  try {
    const clientId = await resolveClientId(req);
    const status = req.query.status || 'executed';
    const limit  = Math.min(Number(req.query.limit) || 100, 500);
    const rows   = await query(`
      SELECT *
      FROM CALBRIDGE_PROD.APP.decision_actions
      WHERE client_id = ? AND status = ?
      ORDER BY updated_at DESC
      LIMIT ?
    `, [clientId, status, limit]);
    res.json(rows.map(formatAction));
  } catch (err) { next(err); }
});

// ─── POST /decisions/:id/approve ─────────────────────────────────────────────
router.post('/:id/approve', requireAuth, async (req, res, next) => {
  try {
    const clientId = await resolveClientId(req);
    const user = req.session.email || req.session.clientId;
    await query(`
      UPDATE CALBRIDGE_PROD.APP.decision_actions
      SET status='approved', approved_by=?, approved_at=CURRENT_TIMESTAMP(), updated_at=CURRENT_TIMESTAMP()
      WHERE action_id=? AND client_id=? AND status='pending'
    `, [user, req.params.id, clientId]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ─── POST /decisions/:id/reject ──────────────────────────────────────────────
router.post('/:id/reject', requireAuth, async (req, res, next) => {
  try {
    const clientId = await resolveClientId(req);
    const user = req.session.email || req.session.clientId;
    await query(`
      UPDATE CALBRIDGE_PROD.APP.decision_actions
      SET status='rejected', approved_by=?, approved_at=CURRENT_TIMESTAMP(), updated_at=CURRENT_TIMESTAMP()
      WHERE action_id=? AND client_id=?
    `, [user, req.params.id, clientId]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ─── POST /decisions/:id/snooze ──────────────────────────────────────────────
router.post('/:id/snooze', requireAuth, async (req, res, next) => {
  try {
    const clientId = await resolveClientId(req);
    const days = Number(req.body?.days) || 7;
    await query(`
      UPDATE CALBRIDGE_PROD.APP.decision_actions
      SET status='snoozed', snoozed_until=DATEADD('day',?,CURRENT_DATE()), updated_at=CURRENT_TIMESTAMP()
      WHERE action_id=? AND client_id=?
    `, [days, req.params.id, clientId]);
    res.json({ ok: true, snoozed_days: days });
  } catch (err) { next(err); }
});

// ─── POST /decisions/approve-all ─────────────────────────────────────────────
router.post('/approve-all', requireAuth, async (req, res, next) => {
  try {
    const clientId = await resolveClientId(req);
    const user = req.session.email || req.session.clientId;
    const type = req.body?.type || null;
    const result = await query(`
      UPDATE CALBRIDGE_PROD.APP.decision_actions
      SET status='approved', approved_by=?, approved_at=CURRENT_TIMESTAMP(), updated_at=CURRENT_TIMESTAMP()
      WHERE client_id=? AND status='pending'
        AND (snoozed_until IS NULL OR snoozed_until <= CURRENT_DATE())
        ${type ? `AND action_type = '${type}'` : ''}
    `, [user, clientId]);
    const count = result[0]?.['number of rows updated'] || 0;
    res.json({ ok: true, approved: count });
  } catch (err) { next(err); }
});

// ─── POST /decisions/execute-all ────────────────────────────────────────────
router.post('/execute-all', requireAuth, requirePlan('decisions'), async (req, res, next) => {
  try {
    const clientId   = await resolveClientId(req);
    const executedBy = req.session.email || req.session.clientId;
    const type       = req.body?.type || null;

    // Fetch all approved pending actions
    const rows = await query(`
      SELECT action_id
      FROM CALBRIDGE_PROD.APP.decision_actions
      WHERE client_id = ?
        AND status = 'approved'
        AND (snoozed_until IS NULL OR snoozed_until <= CURRENT_DATE())
        ${type ? `AND action_type = '${type}'` : ''}
      ORDER BY created_at ASC
    `, [clientId]);

    const results = [];
    for (const row of rows) {
      try {
        const result = await executeAction(row.ACTION_ID || row.action_id, clientId, executedBy);
        results.push({ actionId: row.ACTION_ID || row.action_id, ok: true, result });
      } catch (err) {
        results.push({ actionId: row.ACTION_ID || row.action_id, ok: false, error: err.message });
      }
    }

    res.json({ ok: true, executed: results.length, results });
  } catch (err) { next(err); }
});

// ─── POST /decisions/execute/:id ─────────────────────────────────────────────
router.post('/execute/:id', requireAuth, requirePlan('decisions'), async (req, res, next) => {
  try {
    const clientId  = await resolveClientId(req);
    const executedBy = req.session.email || req.session.clientId;
    const result = await executeAction(req.params.id, clientId, executedBy);
    if (result?.expired) {
      return res.status(410).json({ error: result.reason || 'Amazon entity no longer exists', expired: true });
    }
    res.json(result);
  } catch (err) {
    if (err.message?.includes('Cannot execute') || err.message?.includes('not found')) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

// ─── Formatter ────────────────────────────────────────────────────────────────
function formatAction(r) {
  return {
    actionId:       r.ACTION_ID,
    clientId:       r.CLIENT_ID,
    actionType:     r.ACTION_TYPE,
    entityType:     r.ENTITY_TYPE,
    entityId:       r.ENTITY_ID,
    entityName:     r.ENTITY_NAME,
    campaignId:     r.CAMPAIGN_ID,
    campaignName:   r.CAMPAIGN_NAME,
    adGroupId:      r.AD_GROUP_ID,
    adType:         r.AD_TYPE,
    currentValue:   r.CURRENT_VALUE,
    proposedValue:  r.PROPOSED_VALUE,
    reason:         r.REASON,
    metrics:        r.METRICS_SNAPSHOT,
    status:         r.STATUS,
    approvedBy:     r.APPROVED_BY,
    approvedAt:     r.APPROVED_AT,
    executedAt:     r.EXECUTED_AT,
    executionResult: r.EXECUTION_RESULT,
    snoozedUntil:   r.SNOOZED_UNTIL,
    createdAt:      r.CREATED_AT,
  };
}

module.exports = router;
