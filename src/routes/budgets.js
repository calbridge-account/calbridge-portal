const { randomUUID } = require('crypto');

/**
 * Calbridge Budget Tracker API
 *
 * Routes:
 *   GET    /budgets                       — All budgets with pacing data
 *   GET    /budgets/campaigns/available   — Available campaigns for assignment
 *   GET    /budgets/:budgetId             — Single budget detail + daily breakdown
 *   POST   /budgets                       — Create budget
 *   PUT    /budgets/:budgetId             — Update budget
 *   DELETE /budgets/:budgetId             — Delete budget + mappings
 *   PUT    /budgets/:budgetId/campaigns   — Replace campaign assignments
 */

const express = require('express');
const router = express.Router();
const { query } = require('../services/snowflakeService');
const { requireAuth } = require('../middleware/requireAuth');

const SCHEMA = 'CALBRIDGE_PROD.APP';

function getClientId(req) {
  const id = req.session?.clientId;
  if (!id) throw Object.assign(new Error('Not authenticated'), { status: 401 });
  return id;
}

/** Format a number as currency string */
function n(val) {
  return val == null ? 0 : Number(val);
}

// All budget routes require auth
router.use(requireAuth);

// ─────────────────────────────────────────────────────────────────────────────
// GET /budgets/campaigns/available
// Must be defined BEFORE /:budgetId to avoid route conflict
// ─────────────────────────────────────────────────────────────────────────────
router.get('/campaigns/available', async (req, res) => {
  const clientId = getClientId(req);
  try {
    // Use ad_campaigns as the source for the picker — one row per campaign, fast.
    // Normalize campaign_type (Amazon raw: 'sponsoredProducts') to short code (SP/SB/SD/DSP)
    // so it fits the AD_TYPE column (max 32 chars) and is consistent with adjusted_campaign_performance.
    const rows = await query(
      `SELECT
         campaign_id,
         campaign_name,
         CASE campaign_type
           WHEN 'sponsoredProducts' THEN 'SP'
           WHEN 'sponsoredBrands'   THEN 'SB'
           WHEN 'sponsoredDisplay'  THEN 'SD'
           WHEN 'hsa'               THEN 'SB'
           ELSE UPPER(campaign_type)
         END AS ad_type
       FROM ${SCHEMA}.AD_CAMPAIGNS
       WHERE client_id = ?
       ORDER BY campaign_name ASC`,
      [clientId]
    );
    res.json(rows.map(r => ({
      campaign_id:   r.CAMPAIGN_ID   || r.campaign_id,
      campaign_name: r.CAMPAIGN_NAME || r.campaign_name,
      ad_type:       r.AD_TYPE       || r.ad_type,
    })));
  } catch (err) {
    console.error('[Budgets] available campaigns error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /budgets — all budgets with pacing
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const clientId = getClientId(req);
  try {
    // Fetch all budgets for client
    const budgets = await query(
      `SELECT budget_id, client_id, name, total_amount, currency,
              period_start, period_end, notes, created_at, updated_at
       FROM ${SCHEMA}.CLIENT_BUDGETS
       WHERE client_id = ?
       ORDER BY created_at DESC`,
      [clientId]
    );

    if (!budgets.length) {
      return res.json([]);
    }

    const budgetIds = budgets.map(b => b.BUDGET_ID || b.budget_id);

    // Fetch campaign mappings for all budgets in one query
    const mappings = await query(
      `SELECT budget_id, campaign_id, campaign_name, ad_type
       FROM ${SCHEMA}.BUDGET_CAMPAIGN_MAP
       WHERE client_id = ?
         AND budget_id IN (${budgetIds.map(() => '?').join(',')})`,
      [clientId, ...budgetIds]
    );

    // Group mappings by budget_id
    const mappingsByBudget = {};
    for (const m of mappings) {
      const bid = m.BUDGET_ID || m.budget_id;
      if (!mappingsByBudget[bid]) mappingsByBudget[bid] = [];
      mappingsByBudget[bid].push(m.CAMPAIGN_ID || m.campaign_id);
    }

    // Fetch spend for all campaigns across all budgets
    const allCampaignIds = [...new Set(mappings.map(m => m.CAMPAIGN_ID || m.campaign_id))];

    let spendByCampaign = {};
    if (allCampaignIds.length > 0) {
      // We need per-budget spend, so we'll compute in JS after fetching all campaign spends
      // Fetch spend per campaign for the full union of all budget periods
      // Use a broad date range (earliest period_start to today) and filter in JS
      const spendRows = await query(
        `SELECT campaign_id, date, SUM(adjusted_spend) AS daily_spend
         FROM ${SCHEMA}.ADJUSTED_CAMPAIGN_PERFORMANCE
         WHERE client_id = ?
           AND campaign_id IN (${allCampaignIds.map(() => '?').join(',')})
         GROUP BY campaign_id, date`,
        [clientId, ...allCampaignIds]
      );

      // Group by campaign_id -> array of { date, spend }
      for (const row of spendRows) {
        const cid = row.CAMPAIGN_ID || row.campaign_id;
        if (!spendByCampaign[cid]) spendByCampaign[cid] = [];
        spendByCampaign[cid].push({
          date: row.DATE || row.date,
          spend: n(row.DAILY_SPEND ?? row.daily_spend),
        });
      }
    }

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const result = budgets.map(b => {
      const budgetId    = b.BUDGET_ID    || b.budget_id;
      const totalAmount = n(b.TOTAL_AMOUNT ?? b.total_amount);
      const periodStart = new Date(b.PERIOD_START || b.period_start);
      const periodEnd   = new Date(b.PERIOD_END   || b.period_end);

      periodStart.setUTCHours(0, 0, 0, 0);
      periodEnd.setUTCHours(0, 0, 0, 0);

      const campaignIds = mappingsByBudget[budgetId] || [];

      // Sum spend for assigned campaigns within this budget's period
      let spent = 0;
      for (const cid of campaignIds) {
        const entries = spendByCampaign[cid] || [];
        for (const entry of entries) {
          const d = new Date(entry.date);
          d.setUTCHours(0, 0, 0, 0);
          if (d >= periodStart && d <= today) {
            spent += entry.spend;
          }
        }
      }

      const MS_PER_DAY   = 86400000;
      const daysTotal    = Math.round((periodEnd - periodStart) / MS_PER_DAY) || 1;
      const daysElapsed  = Math.max(1, Math.round((today - periodStart) / MS_PER_DAY));
      const daysRemaining = Math.max(0, Math.round((periodEnd - today) / MS_PER_DAY));

      const remaining      = totalAmount - spent;
      const pctUsed        = totalAmount > 0 ? spent / totalAmount : 0;
      const idealSpend     = totalAmount * (daysElapsed / daysTotal);
      const dailyBurnRate  = spent / daysElapsed;
      const projectedTotal = dailyBurnRate * daysTotal;

      let paceStatus = 'on_pace';
      if (projectedTotal > totalAmount * 1.10)      paceStatus = 'over';
      else if (projectedTotal < totalAmount * 0.90) paceStatus = 'under';

      return {
        budget_id:       budgetId,
        client_id:       b.CLIENT_ID    || b.client_id,
        name:            b.NAME         || b.name,
        total_amount:    totalAmount,
        currency:        b.CURRENCY     || b.currency || 'USD',
        period_start:    b.PERIOD_START || b.period_start,
        period_end:      b.PERIOD_END   || b.period_end,
        notes:           b.NOTES        || b.notes || null,
        created_at:      b.CREATED_AT   || b.created_at,
        updated_at:      b.UPDATED_AT   || b.updated_at,
        campaign_count:  campaignIds.length,
        campaigns:       mappings
          .filter(m => (m.BUDGET_ID || m.budget_id) === budgetId)
          .map(m => ({
            campaign_id:   m.CAMPAIGN_ID   || m.campaign_id,
            campaign_name: m.CAMPAIGN_NAME || m.campaign_name,
            ad_type:       m.AD_TYPE       || m.ad_type,
          })),
        // pacing
        spent:           Math.round(spent * 100) / 100,
        remaining:       Math.round(remaining * 100) / 100,
        pct_used:        Math.round(pctUsed * 10000) / 10000,
        days_total:      daysTotal,
        days_elapsed:    daysElapsed,
        days_remaining:  daysRemaining,
        ideal_spend:     Math.round(idealSpend * 100) / 100,
        daily_burn_rate: Math.round(dailyBurnRate * 100) / 100,
        projected_total: Math.round(projectedTotal * 100) / 100,
        pace_status:     paceStatus,
      };
    });

    res.json(result);
  } catch (err) {
    console.error('[Budgets] GET / error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /budgets/:budgetId — single budget detail with campaigns + daily spend
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:budgetId', async (req, res) => {
  const clientId = getClientId(req);
  const { budgetId } = req.params;
  try {
    const budgets = await query(
      `SELECT budget_id, client_id, name, total_amount, currency,
              period_start, period_end, notes, created_at, updated_at
       FROM ${SCHEMA}.CLIENT_BUDGETS
       WHERE client_id = ? AND budget_id = ?`,
      [clientId, budgetId]
    );

    if (!budgets.length) {
      return res.status(404).json({ error: 'Budget not found' });
    }

    const b = budgets[0];
    const totalAmount = n(b.TOTAL_AMOUNT ?? b.total_amount);
    const periodStart = new Date(b.PERIOD_START || b.period_start);
    const periodEnd   = new Date(b.PERIOD_END   || b.period_end);
    periodStart.setUTCHours(0, 0, 0, 0);
    periodEnd.setUTCHours(0, 0, 0, 0);

    // Fetch campaign assignments
    const mappings = await query(
      `SELECT campaign_id, campaign_name, ad_type
       FROM ${SCHEMA}.BUDGET_CAMPAIGN_MAP
       WHERE client_id = ? AND budget_id = ?`,
      [clientId, budgetId]
    );

    const campaigns = mappings.map(m => ({
      campaign_id:   m.CAMPAIGN_ID   || m.campaign_id,
      campaign_name: m.CAMPAIGN_NAME || m.campaign_name,
      ad_type:       m.AD_TYPE       || m.ad_type,
    }));

    const campaignIds = campaigns.map(c => c.campaign_id);

    // Daily spend breakdown (last 30 days within period)
    let dailySpend = [];
    if (campaignIds.length > 0) {
      const spendRows = await query(
        `SELECT date, SUM(adjusted_spend) AS daily_spend
         FROM ${SCHEMA}.ADJUSTED_CAMPAIGN_PERFORMANCE
         WHERE client_id = ?
           AND campaign_id IN (${campaignIds.map(() => '?').join(',')})
           AND date >= DATEADD('day', -30, CURRENT_DATE())
         GROUP BY date
         ORDER BY date ASC`,
        [clientId, ...campaignIds]
      );
      dailySpend = spendRows.map(r => ({
        date:  r.DATE  || r.date,
        spend: n(r.DAILY_SPEND ?? r.daily_spend),
      }));
    }

    // Compute pacing
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    let spent = 0;
    for (const row of dailySpend) {
      const d = new Date(row.date);
      d.setUTCHours(0, 0, 0, 0);
      if (d >= periodStart && d <= today) spent += row.spend;
    }
    // Also include spend before last 30 days if period started earlier
    if (campaignIds.length > 0) {
      const thirtyDaysAgo = new Date(today - 30 * 86400000);
      if (periodStart < thirtyDaysAgo) {
        const olderRows = await query(
          `SELECT SUM(adjusted_spend) AS total_spend
           FROM ${SCHEMA}.ADJUSTED_CAMPAIGN_PERFORMANCE
           WHERE client_id = ?
             AND campaign_id IN (${campaignIds.map(() => '?').join(',')})
             AND date >= ?
             AND date < DATEADD('day', -30, CURRENT_DATE())`,
          [clientId, ...campaignIds, periodStart.toISOString().split('T')[0]]
        );
        const olderSpend = n((olderRows[0]?.TOTAL_SPEND ?? olderRows[0]?.total_spend) ?? 0);
        spent += olderSpend;
      }
    }

    const MS_PER_DAY    = 86400000;
    const daysTotal     = Math.round((periodEnd - periodStart) / MS_PER_DAY) || 1;
    const daysElapsed   = Math.max(1, Math.round((today - periodStart) / MS_PER_DAY));
    const daysRemaining = Math.max(0, Math.round((periodEnd - today) / MS_PER_DAY));
    const remaining     = totalAmount - spent;
    const pctUsed       = totalAmount > 0 ? spent / totalAmount : 0;
    const idealSpend    = totalAmount * (daysElapsed / daysTotal);
    const dailyBurnRate = spent / daysElapsed;
    const projectedTotal = dailyBurnRate * daysTotal;

    let paceStatus = 'on_pace';
    if (projectedTotal > totalAmount * 1.10)      paceStatus = 'over';
    else if (projectedTotal < totalAmount * 0.90) paceStatus = 'under';

    res.json({
      budget_id:       b.BUDGET_ID    || b.budget_id,
      client_id:       b.CLIENT_ID    || b.client_id,
      name:            b.NAME         || b.name,
      total_amount:    totalAmount,
      currency:        b.CURRENCY     || b.currency || 'USD',
      period_start:    b.PERIOD_START || b.period_start,
      period_end:      b.PERIOD_END   || b.period_end,
      notes:           b.NOTES        || b.notes || null,
      created_at:      b.CREATED_AT   || b.created_at,
      updated_at:      b.UPDATED_AT   || b.updated_at,
      campaigns,
      campaign_count:  campaigns.length,
      daily_spend:     dailySpend,
      spent:           Math.round(spent * 100) / 100,
      remaining:       Math.round(remaining * 100) / 100,
      pct_used:        Math.round(pctUsed * 10000) / 10000,
      days_total:      daysTotal,
      days_elapsed:    daysElapsed,
      days_remaining:  daysRemaining,
      ideal_spend:     Math.round(idealSpend * 100) / 100,
      daily_burn_rate: Math.round(dailyBurnRate * 100) / 100,
      projected_total: Math.round(projectedTotal * 100) / 100,
      pace_status:     paceStatus,
    });
  } catch (err) {
    console.error('[Budgets] GET /:budgetId error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /budgets — create
// ─────────────────────────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  const clientId = getClientId(req);
  const { name, total_amount, currency = 'USD', period_start, period_end, notes } = req.body;

  if (!name || total_amount == null || !period_start || !period_end) {
    return res.status(400).json({ error: 'name, total_amount, period_start, and period_end are required' });
  }

  try {
    await query(
      `INSERT INTO ${SCHEMA}.CLIENT_BUDGETS
         (budget_id, client_id, name, total_amount, currency, period_start, period_end, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [randomUUID(), clientId, name, n(total_amount), currency, period_start, period_end, notes || null]
    );

    // Return the newly created budget
    const rows = await query(
      `SELECT budget_id, client_id, name, total_amount, currency,
              period_start, period_end, notes, created_at, updated_at
       FROM ${SCHEMA}.CLIENT_BUDGETS
       WHERE client_id = ?
       ORDER BY created_at DESC
       LIMIT 1`,
      [clientId]
    );

    const b = rows[0];
    res.status(201).json({
      budget_id:    b.BUDGET_ID    || b.budget_id,
      client_id:    b.CLIENT_ID    || b.client_id,
      name:         b.NAME         || b.name,
      total_amount: n(b.TOTAL_AMOUNT ?? b.total_amount),
      currency:     b.CURRENCY     || b.currency,
      period_start: b.PERIOD_START || b.period_start,
      period_end:   b.PERIOD_END   || b.period_end,
      notes:        b.NOTES        || b.notes || null,
      created_at:   b.CREATED_AT   || b.created_at,
      updated_at:   b.UPDATED_AT   || b.updated_at,
    });
  } catch (err) {
    console.error('[Budgets] POST / error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /budgets/:budgetId — update
// ─────────────────────────────────────────────────────────────────────────────
router.put('/:budgetId/campaigns', async (req, res) => {
  const clientId = getClientId(req);
  const { budgetId } = req.params;
  const { campaigns = [] } = req.body;

  try {
    // Verify budget belongs to client
    const existing = await query(
      `SELECT budget_id FROM ${SCHEMA}.CLIENT_BUDGETS WHERE client_id = ? AND budget_id = ?`,
      [clientId, budgetId]
    );
    if (!existing.length) {
      return res.status(404).json({ error: 'Budget not found' });
    }

    // Delete existing mappings
    await query(
      `DELETE FROM ${SCHEMA}.BUDGET_CAMPAIGN_MAP WHERE budget_id = ? AND client_id = ?`,
      [budgetId, clientId]
    );

    // Batch insert all campaign mappings in one query using VALUES list
    // (avoids N sequential Snowflake round-trips which caused gateway timeouts)
    if (campaigns.length > 0) {
      const BATCH = 50;
      for (let i = 0; i < campaigns.length; i += BATCH) {
        const batch = campaigns.slice(i, i + BATCH);
        const placeholders = batch.map(() => '(?,?,?,?,?)').join(',');
        const binds = batch.flatMap(c => [
          budgetId, clientId, c.campaign_id, c.campaign_name || null, c.ad_type || null
        ]);
        await query(
          `INSERT INTO ${SCHEMA}.BUDGET_CAMPAIGN_MAP
             (budget_id, client_id, campaign_id, campaign_name, ad_type)
           VALUES ${placeholders}`,
          binds
        );
      }
    }

    res.json({ success: true, campaign_count: campaigns.length });
  } catch (err) {
    console.error('[Budgets] PUT /:budgetId/campaigns error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.put('/:budgetId', async (req, res) => {
  const clientId = getClientId(req);
  const { budgetId } = req.params;
  const { name, total_amount, currency, period_start, period_end, notes } = req.body;

  try {
    const existing = await query(
      `SELECT budget_id FROM ${SCHEMA}.CLIENT_BUDGETS WHERE client_id = ? AND budget_id = ?`,
      [clientId, budgetId]
    );
    if (!existing.length) {
      return res.status(404).json({ error: 'Budget not found' });
    }

    await query(
      `UPDATE ${SCHEMA}.CLIENT_BUDGETS
       SET name = ?, total_amount = ?, currency = ?,
           period_start = ?, period_end = ?, notes = ?,
           updated_at = CURRENT_TIMESTAMP()
       WHERE client_id = ? AND budget_id = ?`,
      [name, n(total_amount), currency || 'USD', period_start, period_end, notes || null, clientId, budgetId]
    );

    const rows = await query(
      `SELECT budget_id, client_id, name, total_amount, currency,
              period_start, period_end, notes, created_at, updated_at
       FROM ${SCHEMA}.CLIENT_BUDGETS
       WHERE client_id = ? AND budget_id = ?`,
      [clientId, budgetId]
    );
    const b = rows[0];
    res.json({
      budget_id:    b.BUDGET_ID    || b.budget_id,
      client_id:    b.CLIENT_ID    || b.client_id,
      name:         b.NAME         || b.name,
      total_amount: n(b.TOTAL_AMOUNT ?? b.total_amount),
      currency:     b.CURRENCY     || b.currency,
      period_start: b.PERIOD_START || b.period_start,
      period_end:   b.PERIOD_END   || b.period_end,
      notes:        b.NOTES        || b.notes || null,
      created_at:   b.CREATED_AT   || b.created_at,
      updated_at:   b.UPDATED_AT   || b.updated_at,
    });
  } catch (err) {
    console.error('[Budgets] PUT /:budgetId error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /budgets/:budgetId
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/:budgetId', async (req, res) => {
  const clientId = getClientId(req);
  const { budgetId } = req.params;

  try {
    const existing = await query(
      `SELECT budget_id FROM ${SCHEMA}.CLIENT_BUDGETS WHERE client_id = ? AND budget_id = ?`,
      [clientId, budgetId]
    );
    if (!existing.length) {
      return res.status(404).json({ error: 'Budget not found' });
    }

    // Delete campaign mappings first
    await query(
      `DELETE FROM ${SCHEMA}.BUDGET_CAMPAIGN_MAP WHERE budget_id = ? AND client_id = ?`,
      [budgetId, clientId]
    );

    // Delete budget
    await query(
      `DELETE FROM ${SCHEMA}.CLIENT_BUDGETS WHERE budget_id = ? AND client_id = ?`,
      [budgetId, clientId]
    );

    res.json({ success: true });
  } catch (err) {
    console.error('[Budgets] DELETE /:budgetId error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
