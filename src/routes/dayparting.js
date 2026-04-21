/**
 * src/routes/dayparting.js
 *
 * Dayparting — schedule-based campaign bid/state management.
 *
 * GET    /dayparting                — list all rules for client
 * POST   /dayparting                — create rule
 * PUT    /dayparting/:ruleId        — update rule
 * DELETE /dayparting/:ruleId        — delete rule
 * POST   /dayparting/:ruleId/toggle — enable/disable rule
 * POST   /dayparting/execute        — manually trigger execution (for testing)
 *
 * Rule schema:
 *   rule_name       — display name
 *   action_type     — 'pause' | 'resume' | 'reduce_bid' | 'increase_bid'
 *   action_value    — % for bid changes (e.g. 30 = reduce by 30%)
 *   days_of_week    — [0-6] where 0=Sunday, 6=Saturday
 *   hours_utc       — [0-23] hours when rule is ACTIVE (rule fires)
 *   applies_to      — 'all' | 'budget' | 'campaign' | 'ad_type'
 *   applies_to_ids  — array of budget_ids or campaign_ids (if not 'all')
 *   is_active       — boolean
 */

'use strict';

const express = require('express');
const router  = express.Router();
const { v4: uuidv4 } = require('uuid');
const { requireAuth }  = require('../middleware/requireAuth');
const { requirePlan }  = require('../middleware/requirePlan');
const { query }        = require('../services/snowflakeService');
const { resolveClientId } = require('../services/advertiserResolver');

const SCHEMA = 'CALBRIDGE_PROD.APP';

// ─── GET /dayparting ──────────────────────────────────────────────────────────
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const clientId = await resolveClientId(req);
    const rows = await query(`
      SELECT rule_id, rule_name, action_type, action_value,
             days_of_week, hours_utc, applies_to, applies_to_ids,
             is_active, created_at
      FROM ${SCHEMA}.client_dayparting
      WHERE client_id = ?
      ORDER BY created_at ASC
    `, [clientId]);

    res.json(rows.map(r => ({
      ruleId:       r.RULE_ID,
      ruleName:     r.RULE_NAME,
      actionType:   r.ACTION_TYPE,
      actionValue:  r.ACTION_VALUE != null ? Number(r.ACTION_VALUE) : null,
      daysOfWeek:   parseVariant(r.DAYS_OF_WEEK),   // [0,1,2,3,4] = Mon-Fri
      hoursUtc:     parseVariant(r.HOURS_UTC),       // [22,23,0,1,2,3,4,5] = 10pm-6am
      appliesTo:    r.APPLIES_TO    || 'all',
      appliesToIds: parseVariant(r.APPLIES_TO_IDS) || [],
      isActive:     r.IS_ACTIVE ?? true,
      createdAt:    r.CREATED_AT,
    })));
  } catch (err) { next(err); }
});

// ─── POST /dayparting ─────────────────────────────────────────────────────────
router.post('/', requireAuth, requirePlan('decisions'), async (req, res, next) => {
  try {
    const clientId = await resolveClientId(req);
    const {
      ruleName, actionType, actionValue,
      daysOfWeek, hoursUtc, appliesTo, appliesToIds,
    } = req.body;

    if (!ruleName || !actionType || !daysOfWeek?.length || !hoursUtc?.length) {
      return res.status(400).json({ error: 'ruleName, actionType, daysOfWeek, hoursUtc required' });
    }
    if (!['pause', 'resume', 'reduce_bid', 'increase_bid'].includes(actionType)) {
      return res.status(400).json({ error: 'actionType must be pause|resume|reduce_bid|increase_bid' });
    }
    if (['reduce_bid', 'increase_bid'].includes(actionType) && !actionValue) {
      return res.status(400).json({ error: 'actionValue (%) required for bid changes' });
    }

    const ruleId = uuidv4();
    await query(`
      INSERT INTO ${SCHEMA}.client_dayparting
        (rule_id, client_id, rule_name, action_type, action_value,
         days_of_week, hours_utc, applies_to, applies_to_ids, is_active, created_at)
      VALUES (?, ?, ?, ?, ?, PARSE_JSON(?), PARSE_JSON(?), ?, PARSE_JSON(?), TRUE, CURRENT_TIMESTAMP())
    `, [
      ruleId, clientId, ruleName, actionType,
      actionValue ?? null,
      JSON.stringify(daysOfWeek),
      JSON.stringify(hoursUtc),
      appliesTo || 'all',
      JSON.stringify(appliesToIds || []),
    ]);

    res.status(201).json({ ruleId, message: 'Rule created' });
  } catch (err) { next(err); }
});

// ─── PUT /dayparting/:ruleId ──────────────────────────────────────────────────
router.put('/:ruleId', requireAuth, requirePlan('decisions'), async (req, res, next) => {
  try {
    const clientId = await resolveClientId(req);
    const { ruleId } = req.params;
    const {
      ruleName, actionType, actionValue,
      daysOfWeek, hoursUtc, appliesTo, appliesToIds,
    } = req.body;

    await query(`
      UPDATE ${SCHEMA}.client_dayparting
      SET rule_name      = ?,
          action_type    = ?,
          action_value   = ?,
          days_of_week   = PARSE_JSON(?),
          hours_utc      = PARSE_JSON(?),
          applies_to     = ?,
          applies_to_ids = PARSE_JSON(?)
      WHERE rule_id = ? AND client_id = ?
    `, [
      ruleName, actionType, actionValue ?? null,
      JSON.stringify(daysOfWeek),
      JSON.stringify(hoursUtc),
      appliesTo || 'all',
      JSON.stringify(appliesToIds || []),
      ruleId, clientId,
    ]);

    res.json({ message: 'Rule updated' });
  } catch (err) { next(err); }
});

// ─── DELETE /dayparting/:ruleId ───────────────────────────────────────────────
router.delete('/:ruleId', requireAuth, requirePlan('decisions'), async (req, res, next) => {
  try {
    const clientId = await resolveClientId(req);
    await query(
      `DELETE FROM ${SCHEMA}.client_dayparting WHERE rule_id = ? AND client_id = ?`,
      [req.params.ruleId, clientId]
    );
    res.json({ message: 'Rule deleted' });
  } catch (err) { next(err); }
});

// ─── POST /dayparting/:ruleId/toggle ─────────────────────────────────────────
router.post('/:ruleId/toggle', requireAuth, requirePlan('decisions'), async (req, res, next) => {
  try {
    const clientId = await resolveClientId(req);
    const rows = await query(
      `SELECT is_active FROM ${SCHEMA}.client_dayparting WHERE rule_id = ? AND client_id = ?`,
      [req.params.ruleId, clientId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Rule not found' });

    const newState = !rows[0].IS_ACTIVE;
    await query(
      `UPDATE ${SCHEMA}.client_dayparting SET is_active = ? WHERE rule_id = ? AND client_id = ?`,
      [newState, req.params.ruleId, clientId]
    );
    res.json({ isActive: newState });
  } catch (err) { next(err); }
});

// ─── POST /dayparting/execute ─────────────────────────────────────────────────
// Manually trigger rule execution for testing
router.post('/execute', requireAuth, requirePlan('decisions'), async (req, res, next) => {
  try {
    const clientId = await resolveClientId(req);
    const { executeDaypartingRules } = require('../jobs/daypartingEngine');
    const result = await executeDaypartingRules(clientId);
    res.json(result);
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 24-HOUR MULTIPLIER SCHEDULE ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

const {
  getSchedules,
  upsertSchedule,
  deleteSchedule,
  applyDaypartSchedules,
} = require('../services/daypartingService');

// ─── GET /dayparting/schedules ────────────────────────────────────────────────
router.get('/schedules', requireAuth, async (req, res, next) => {
  try {
    const clientId = await resolveClientId(req);
    const schedules = await getSchedules(clientId);
    res.json(schedules);
  } catch (err) { next(err); }
});

// ─── POST /dayparting/schedules ───────────────────────────────────────────────
router.post('/schedules', requireAuth, requirePlan('decisions'), async (req, res, next) => {
  try {
    const clientId = await resolveClientId(req);
    const result   = await upsertSchedule(clientId, req.body);
    res.status(201).json(result);
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    next(err);
  }
});

// ─── PUT /dayparting/schedules/:id ───────────────────────────────────────────
router.put('/schedules/:id', requireAuth, requirePlan('decisions'), async (req, res, next) => {
  try {
    const clientId = await resolveClientId(req);
    const result   = await upsertSchedule(clientId, { ...req.body, id: req.params.id });
    res.json(result);
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    next(err);
  }
});

// ─── DELETE /dayparting/schedules/:id ────────────────────────────────────────
router.delete('/schedules/:id', requireAuth, requirePlan('decisions'), async (req, res, next) => {
  try {
    const clientId = await resolveClientId(req);
    await deleteSchedule(clientId, req.params.id);
    res.json({ message: 'Schedule deleted' });
  } catch (err) { next(err); }
});

// ─── POST /dayparting/schedules/run ──────────────────────────────────────────
// Admin: manually trigger schedule execution for this client
router.post('/schedules/run', requireAuth, requirePlan('decisions'), async (req, res, next) => {
  try {
    const clientId = await resolveClientId(req);
    const result   = await applyDaypartSchedules(clientId);
    res.json(result);
  } catch (err) { next(err); }
});

// ─── Helper ───────────────────────────────────────────────────────────────────
function parseVariant(v) {
  if (v == null) return null;
  if (Array.isArray(v)) return v;
  try { return JSON.parse(typeof v === 'string' ? v : JSON.stringify(v)); } catch { return null; }
}

module.exports = router;
