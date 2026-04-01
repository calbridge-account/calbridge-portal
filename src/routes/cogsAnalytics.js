/**
 * COGS Analytics Routes
 * Manages cost-per-unit entries and calculates CM2/CM3 margins per ASIN.
 *
 * Routes:
 *   GET  /cogs-analytics/entries   — fetch all COGS entries for client
 *   POST /cogs-analytics/entries   — upsert COGS per ASIN
 *   GET  /cogs-analytics/margins   — per-ASIN CM2 and CM3
 */

const express = require('express');
const router = express.Router();
const { query } = require('../services/snowflakeService');
const { requireAuth } = require('../middleware/requireAuth');

const SCHEMA = 'CALBRIDGE_PROD.RAW';
const APP_SCHEMA = 'CALBRIDGE_PROD.APP';

function getClientId(req) {
  return req.session?.clientId || '7d88ea17-002b-4a02-97fc-bcab1292d57e';
}

function n(v) {
  return v == null ? null : Number(v);
}

/**
 * Ensure the CLIENT_COGS table exists before any operation.
 */
async function ensureCogsTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS ${APP_SCHEMA}.CLIENT_COGS (
      client_id      VARCHAR       NOT NULL,
      asin           VARCHAR       NOT NULL,
      cost_per_unit  NUMBER(18,4)  NOT NULL,
      currency_code  VARCHAR       DEFAULT 'USD',
      effective_date DATE          DEFAULT CURRENT_DATE,
      notes          VARCHAR,
      updated_at     TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP,
      updated_by     VARCHAR,
      PRIMARY KEY (client_id, asin)
    )
  `, []);
}

// ─── GET /cogs-analytics/entries ─────────────────────────────────────────────
router.get('/entries', requireAuth, async (req, res, next) => {
  try {
    await ensureCogsTable();
    const CLIENT_ID = getClientId(req);

    const rows = await query(`
      SELECT
        c.asin,
        c.cost_per_unit,
        c.currency_code,
        c.effective_date,
        c.notes,
        c.updated_at,
        c.updated_by,
        p.title,
        p.model_number
      FROM ${APP_SCHEMA}.CLIENT_COGS c
      LEFT JOIN ${SCHEMA}.RETAIL_LISTING p
        ON p.client_id = c.client_id AND p.asin = c.asin
      WHERE c.client_id = ?
      ORDER BY c.asin
    `, [CLIENT_ID]);

    res.json({
      entries: rows.map(r => ({
        asin:          r.ASIN,
        costPerUnit:   n(r.COST_PER_UNIT),
        currencyCode:  r.CURRENCY_CODE || 'USD',
        effectiveDate: r.EFFECTIVE_DATE,
        notes:         r.NOTES,
        updatedAt:     r.UPDATED_AT,
        updatedBy:     r.UPDATED_BY,
        title:         r.TITLE,
        model:         r.MODEL_NUMBER || r.TITLE,
      })),
    });
  } catch (err) { next(err); }
});

// ─── POST /cogs-analytics/entries ────────────────────────────────────────────
router.post('/entries', requireAuth, async (req, res, next) => {
  try {
    await ensureCogsTable();
    const CLIENT_ID = getClientId(req);
    const { asin, costPerUnit, currencyCode = 'USD', notes = '' } = req.body;

    if (!asin || costPerUnit == null) {
      return res.status(400).json({ error: 'asin and costPerUnit are required' });
    }
    const cost = parseFloat(costPerUnit);
    if (isNaN(cost) || cost < 0) {
      return res.status(400).json({ error: 'costPerUnit must be a non-negative number' });
    }

    // Upsert
    await query(`
      MERGE INTO ${APP_SCHEMA}.CLIENT_COGS t
      USING (SELECT ? AS client_id, ? AS asin) s
        ON t.client_id = s.client_id AND t.asin = s.asin
      WHEN MATCHED THEN UPDATE SET
        cost_per_unit  = ?,
        currency_code  = ?,
        effective_date = CURRENT_DATE,
        notes          = ?,
        updated_at     = CURRENT_TIMESTAMP,
        updated_by     = ?
      WHEN NOT MATCHED THEN INSERT
        (client_id, asin, cost_per_unit, currency_code, effective_date, notes, updated_at, updated_by)
      VALUES
        (?, ?, ?, ?, CURRENT_DATE, ?, CURRENT_TIMESTAMP, ?)
    `, [
      CLIENT_ID, asin,
      cost, currencyCode, notes, req.session?.userEmail || 'portal',
      CLIENT_ID, asin, cost, currencyCode, notes, req.session?.userEmail || 'portal',
    ]);

    res.json({ success: true, asin, costPerUnit: cost });
  } catch (err) { next(err); }
});

// ─── GET /cogs-analytics/margins ─────────────────────────────────────────────
// Returns per-ASIN CM2 and CM3, pulling sales data from last 4 weeks
router.get('/margins', requireAuth, async (req, res, next) => {
  try {
    await ensureCogsTable();
    const CLIENT_ID = getClientId(req);

    const [listings, cogsEntries, salesData] = await Promise.all([
      // All ASINs from listing
      query(`
        SELECT asin, title, model_number
        FROM ${SCHEMA}.RETAIL_LISTING
        WHERE client_id = ?
        ORDER BY asin
      `, [CLIENT_ID]),

      // All COGS entries for client
      query(`
        SELECT asin, cost_per_unit
        FROM ${APP_SCHEMA}.CLIENT_COGS
        WHERE client_id = ?
      `, [CLIENT_ID]),

      // Per-ASIN shipped_cogs and units (last 4 weeks) for per-unit calc
      query(`
        SELECT
          asin,
          SUM(shipped_cogs)    AS shipped_cogs,
          SUM(shipped_units)   AS shipped_units,
          SUM(shipped_revenue) AS shipped_revenue
        FROM ${SCHEMA}.RETAIL_SALES_TRAFFIC
        WHERE client_id = ? AND date >= DATEADD('week', -4, CURRENT_DATE)
        GROUP BY asin
      `, [CLIENT_ID]),

    ]);
    // Note: AD_CAMPAIGN table is campaign-level (no ASIN column).
    // CM3 cannot include per-ASIN ad spend. CM2 = shipped_cogs_per_unit - cost_per_unit.
    // CM3 is same as CM2 until ASIN-level ad data is available.

    // Build lookup maps
    const cogsMap = {};
    for (const r of cogsEntries) { cogsMap[r.ASIN] = n(r.COST_PER_UNIT); }

    const salesMap = {};
    for (const r of salesData) {
      salesMap[r.ASIN] = {
        cogs:     n(r.SHIPPED_COGS) || 0,
        units:    n(r.SHIPPED_UNITS) || 0,
        revenue:  n(r.SHIPPED_REVENUE) || 0,
      };
    }

    const result = listings.map(r => {
      const asin    = r.ASIN;
      const sales   = salesMap[asin] || { cogs: 0, units: 0, revenue: 0 };
      const cogsPU  = cogsMap[asin]; // may be null if not entered

      const cogsPerUnit = cogsPU;
      const shippedCogsPerUnit = sales.units > 0 ? sales.cogs / sales.units : null;

      let cm2 = null, cm3 = null, marginPct = null;
      if (cogsPerUnit != null && shippedCogsPerUnit != null) {
        // CM2 = amazon's shipped_cogs_per_unit minus our cost_per_unit
        cm2 = shippedCogsPerUnit - cogsPerUnit;
        // CM3 = CM2 (ad spend not available per-ASIN from current data model)
        cm3 = cm2;
        const revenuePerUnit = sales.units > 0 ? sales.revenue / sales.units : null;
        if (revenuePerUnit && revenuePerUnit > 0) {
          marginPct = (cm3 / revenuePerUnit) * 100;
        }
      }

      return {
        asin,
        model:             r.MODEL_NUMBER || r.TITLE,
        title:             r.TITLE,
        costPerUnit:       cogsPerUnit,
        shippedCogsPerUnit,
        adSpendPerUnit:    null, // not available per-ASIN
        cm2,
        cm3,
        marginPct,
        shippedUnits:      sales.units,
        shippedRevenue:    sales.revenue,
        totalAdSpend:      null, // not available per-ASIN
        hasCogs:           cogsPerUnit != null,
      };
    });

    // Summary stats
    const withCogs = result.filter(r => r.hasCogs && r.cm2 != null);
    const totalUnits = withCogs.reduce((s, r) => s + r.shippedUnits, 0);
    const weightedCm3Pct = totalUnits > 0
      ? withCogs.reduce((s, r) => {
          const rpU = r.shippedUnits > 0 ? r.shippedRevenue / r.shippedUnits : 0;
          return s + (rpU > 0 ? (r.cm2 / rpU) * r.shippedUnits : 0);
        }, 0) / totalUnits * 100
      : null;

    res.json({
      asins: result,
      summary: {
        totalAsins:         result.length,
        asinsWithCogs:      result.filter(r => r.hasCogs).length,
        weightedAvgCm3Pct:  weightedCm3Pct,
      },
    });
  } catch (err) { next(err); }
});

module.exports = router;
