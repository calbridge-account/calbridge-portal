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
    // Source campaigns from adjusted_campaign_performance — these are the actual
    // campaign IDs that have real spend data. ad_campaigns uses IDs from the entity
    // API which can come from different profiles and won't match performance data.
    const rows = await query(
      `SELECT
         MAX_BY(campaign_id, adjusted_spend)  AS campaign_id,
         campaign_name,
         ad_type,
         SUM(adjusted_spend)                  AS total_spend,
         MAX(date)                            AS last_active
       FROM ${SCHEMA}.ADJUSTED_CAMPAIGN_PERFORMANCE
       WHERE client_id = ?
       GROUP BY campaign_name, ad_type
       ORDER BY total_spend DESC NULLS LAST`,
      [clientId]
    );
    res.json(rows.map(r => ({
      campaign_id:   r.CAMPAIGN_ID   || r.campaign_id,
      campaign_name: r.CAMPAIGN_NAME || r.campaign_name,
      ad_type:       r.AD_TYPE       || r.ad_type,
      status:        'active',
      last_active:   r.LAST_ACTIVE   ? String(r.LAST_ACTIVE).substring(0,10) : null,
    })));
  } catch (err) {
    console.error('[Budgets] available campaigns error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Auto-reconcile budget_campaign_map: find DSP campaigns with spend that match
// a mapped campaign by name but different ID (64-bit truncation artifacts).
// Runs inline when budgets are fetched — adds missing variants silently.
async function reconcileBudgetCampaigns(clientId, budgetIds) {
  if (!budgetIds || !budgetIds.length) return;
  try {
    const monthStart = new Date().toISOString().substring(0, 7) + '-01';
    for (const budgetId of budgetIds) {
      const toAdd = await query(`
        WITH unmapped AS (
          SELECT DISTINCT p.campaign_id, MAX(p.campaign_name) as campaign_name, p.ad_type
          FROM \${SCHEMA}.ADJUSTED_CAMPAIGN_PERFORMANCE p
          WHERE p.client_id = ?
            AND p.ad_type = 'DSP'
            AND p.date >= ?
            AND p.campaign_id NOT IN (
              SELECT campaign_id FROM \${SCHEMA}.BUDGET_CAMPAIGN_MAP WHERE budget_id = ?
            )
          GROUP BY p.campaign_id, p.ad_type
          HAVING SUM(p.adjusted_spend) > 0
        )
        SELECT u.campaign_id, u.campaign_name, u.ad_type
        FROM unmapped u
        WHERE EXISTS (
          SELECT 1 FROM \${SCHEMA}.BUDGET_CAMPAIGN_MAP m
          WHERE m.budget_id = ?
            AND LOWER(TRIM(u.campaign_name)) = LOWER(TRIM(m.campaign_name))
        )
      `, [clientId, monthStart, budgetId, budgetId]);

      for (const c of toAdd) {
        await query(`
          INSERT INTO \${SCHEMA}.BUDGET_CAMPAIGN_MAP (budget_id, client_id, campaign_id, campaign_name, ad_type)
          SELECT ?,?,?,?,?
          WHERE NOT EXISTS (
            SELECT 1 FROM \${SCHEMA}.BUDGET_CAMPAIGN_MAP WHERE budget_id=? AND campaign_id=?
          )
        `, [budgetId, clientId, c.CAMPAIGN_ID||c.campaign_id, c.CAMPAIGN_NAME||c.campaign_name, c.AD_TYPE||c.ad_type, budgetId, c.CAMPAIGN_ID||c.campaign_id]);
      }
      if (toAdd.length > 0) {
        console.log(`[budgets] Auto-mapped \${toAdd.length} DSP campaign variants for budget \${budgetId.substring(0,8)}`);
      }
    }
  } catch (err) {
    console.warn('[budgets] reconcileBudgetCampaigns failed (non-fatal):', err.message?.substring(0,80));
  }
}

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

    // Auto-reconcile: map any new DSP campaign ID variants by name (handles 64-bit truncation)
    reconcileBudgetCampaigns(clientId, budgetIds).catch(() => {});

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

    // Helper: Snowflake date columns return objects with .toJSON() not plain strings.
    // new Date(snowflakeObj) produces 'Invalid Date' — must use .toJSON() first.
    function parseSnowflakeDate(val) {
      if (!val) return null;
      const s = typeof val === 'object' && val.toJSON ? val.toJSON() : String(val);
      const d = new Date(s);
      d.setUTCHours(0, 0, 0, 0);
      return d;
    }

    const result = budgets.map(b => {
      const budgetId    = b.BUDGET_ID    || b.budget_id;
      const totalAmount = n(b.TOTAL_AMOUNT ?? b.total_amount);
      const periodStart = parseSnowflakeDate(b.PERIOD_START || b.period_start);
      const periodEnd   = parseSnowflakeDate(b.PERIOD_END   || b.period_end);

      if (!periodStart || !periodEnd) return null; // skip malformed budgets

      const campaignIds = mappingsByBudget[budgetId] || [];

      // Sum spend for assigned campaigns within this budget's period
      let spent = 0;
      // Per-campaign MTD spend (for campaign list)
      const campaignMtdSpend = {};
      // Spend by ad type
      const spendByType = { SP: 0, SB: 0, SD: 0, DSP: 0 };
      // Build a map of campaign_id -> ad_type from mappings for this budget
      const budgetMappings = mappings.filter(m => (m.BUDGET_ID || m.budget_id) === budgetId);
      const adTypeForCampaign = {};
      for (const m of budgetMappings) {
        const cid = m.CAMPAIGN_ID || m.campaign_id;
        adTypeForCampaign[cid] = (m.AD_TYPE || m.ad_type || '').toUpperCase();
      }

      for (const cid of campaignIds) {
        const entries = spendByCampaign[cid] || [];
        let cidMtd = 0;
        for (const entry of entries) {
          const d = new Date(entry.date);
          d.setUTCHours(0, 0, 0, 0);
          if (d >= periodStart && d <= today) {
            spent += entry.spend;
            cidMtd += entry.spend;
            // Bucket into ad type
            const adType = adTypeForCampaign[cid];
            if (adType && spendByType.hasOwnProperty(adType)) {
              spendByType[adType] += entry.spend;
            }
          }
        }
        campaignMtdSpend[cid] = cidMtd;
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

      // ── Velocity: compute burn_rate_7d and burn_rate_3d ──────────────────
      const sevenDaysAgo  = new Date(today.getTime() - 7  * MS_PER_DAY);
      const threeDaysAgo  = new Date(today.getTime() - 3  * MS_PER_DAY);
      const thirtyDaysAgo = new Date(today.getTime() - 30 * MS_PER_DAY);

      let spend7d = 0, spend3d = 0, spend30d = 0;
      let days7dCount = 0, days3dCount = 0, days30dCount = 0;

      for (const cid of campaignIds) {
        const entries = spendByCampaign[cid] || [];
        for (const entry of entries) {
          const d = new Date(entry.date);
          d.setUTCHours(0, 0, 0, 0);
          if (d > sevenDaysAgo  && d <= today) { spend7d  += entry.spend; }
          if (d > threeDaysAgo  && d <= today) { spend3d  += entry.spend; }
          if (d > thirtyDaysAgo && d <= today) { spend30d += entry.spend; }
        }
      }
      const burnRate7d  = spend7d  / 7;
      const burnRate3d  = spend3d  / 3;
      const burnRate30d = spend30d / 30;

      // Velocity: compare 7-day avg vs overall avg (±15% threshold)
      let velocity = 'steady';
      if (dailyBurnRate > 0) {
        const ratio = burnRate7d / dailyBurnRate;
        if (ratio > 1.15)      velocity = 'accelerating';
        else if (ratio < 0.85) velocity = 'decelerating';
      }

      let paceStatus = 'on_pace';
      if (projectedTotal > totalAmount * 1.10)      paceStatus = 'over';
      else if (projectedTotal < totalAmount * 0.90) paceStatus = 'under';

      // ── Alert flags ──────────────────────────────────────────────────────
      const flightRisk    = projectedTotal > totalAmount * 1.20;
      const underdelivery = projectedTotal < totalAmount * 0.80 && daysRemaining < 30;
      const spike         = burnRate30d > 0 && burnRate3d > burnRate30d * 2;

      // Build enhanced campaign list sorted by MTD spend DESC
      const campaignList = budgetMappings
        .map(m => ({
          campaign_id:   m.CAMPAIGN_ID   || m.campaign_id,
          campaign_name: m.CAMPAIGN_NAME || m.campaign_name,
          ad_type:       m.AD_TYPE       || m.ad_type,
          mtd_spend:     Math.round((campaignMtdSpend[m.CAMPAIGN_ID || m.campaign_id] || 0) * 100) / 100,
        }))
        .sort((a, b) => b.mtd_spend - a.mtd_spend);

      // Round spendByType values
      for (const k of Object.keys(spendByType)) {
        spendByType[k] = Math.round(spendByType[k] * 100) / 100;
      }

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
        campaigns:       campaignList,
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
        // velocity & advanced metrics
        burn_rate_7d:    Math.round(burnRate7d  * 100) / 100,
        burn_rate_3d:    Math.round(burnRate3d  * 100) / 100,
        burn_rate_30d:   Math.round(burnRate30d * 100) / 100,
        velocity,
        spend_by_type:   spendByType,
        // alert flags
        alert_flight_risk:    flightRisk,
        alert_underdelivery:  underdelivery,
        alert_spike:          spike,
      };
    });

    res.json(result.filter(Boolean));
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
    const parseSnowflakeDate = (val) => {
      if (!val) return null;
      const s = typeof val === 'object' && val.toJSON ? val.toJSON() : String(val);
      const d = new Date(s); d.setUTCHours(0,0,0,0); return d;
    };
    const periodStart = parseSnowflakeDate(b.PERIOD_START || b.period_start);
    const periodEnd   = parseSnowflakeDate(b.PERIOD_END   || b.period_end);

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
