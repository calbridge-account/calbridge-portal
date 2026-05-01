/**
 * Competitors API — /competitors
 *
 * Manages per-client competitor definitions used for keyword classification.
 * Competitors have match_terms (JSON array stored as VARCHAR) used to classify
 * keywords as "competitive" in the campaign wizard.
 */
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/requireAuth');
const { query } = require('../services/snowflakeService');

/** Resolve clientId from session (supports both old and new session shapes) */
function getClientId(req) {
  return req.session?.clientId || req.session?.client?.id;
}

// ─── Subcategory inference rules ──────────────────────────────────────────────
const SUBCATEGORY_RULES = [
  { keywords: ['monitor', 'display', 'screen'],          label: 'Monitors'   },
  { keywords: ['laptop', 'notebook'],                    label: 'Notebooks'  },
  { keywords: ['desktop', 'tower'],                      label: 'Desktops'   },
  { keywords: ['ups', 'uninterruptible'],                 label: 'UPS'        },
  { keywords: ['keyboard'],                              label: 'Keyboards'  },
  { keywords: ['mouse', 'mice'],                         label: 'Mice'       },
  { keywords: ['headset', 'headphone'],                  label: 'Headsets'   },
  { keywords: ['tablet', 'ipad'],                        label: 'Tablets'    },
  { keywords: ['printer'],                               label: 'Printers'   },
  { keywords: ['projector'],                             label: 'Projectors' },
];

function inferSubcategory(title) {
  if (!title) return 'Other';
  const lower = title.toLowerCase();
  // Special case: "pc" should only match as a standalone-ish word to avoid false positives
  if (/\bpc\b/.test(lower)) return 'Desktops';
  for (const rule of SUBCATEGORY_RULES) {
    if (rule.keywords.some(kw => lower.includes(kw))) {
      return rule.label;
    }
  }
  return 'Other';
}

// ─── Ensure table exists ──────────────────────────────────────────────────────
async function ensureCompetitorsTable() {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS CALBRIDGE_PROD.APP.brand_competitors (
        id              VARCHAR(36)   DEFAULT UUID_STRING() PRIMARY KEY,
        client_id       VARCHAR(36)   NOT NULL,
        brand_id        VARCHAR(36),
        subcategory     VARCHAR(200),
        competitor_name VARCHAR(200)  NOT NULL,
        match_terms     VARCHAR(2000) NOT NULL DEFAULT '[]',
        created_at      TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at      TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);
  } catch (err) {
    console.warn('[competitors] Could not create brand_competitors table:', err.message);
  }
}

ensureCompetitorsTable();

// ─── Map Snowflake row → camelCase ────────────────────────────────────────────
function rowToCompetitor(r) {
  let matchTerms = [];
  try { matchTerms = JSON.parse(r.MATCH_TERMS || '[]'); } catch {}
  return {
    id:             r.ID,
    clientId:       r.CLIENT_ID,
    brandId:        r.BRAND_ID   || null,
    subcategory:    r.SUBCATEGORY || null,
    competitorName: r.COMPETITOR_NAME,
    matchTerms,
    createdAt:      r.CREATED_AT,
    updatedAt:      r.UPDATED_AT,
  };
}

// ─── GET /competitors ─────────────────────────────────────────────────────────
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const clientId = getClientId(req);
    const rows = await query(`
      SELECT id, client_id, brand_id, subcategory, competitor_name, match_terms, created_at, updated_at
      FROM CALBRIDGE_PROD.APP.brand_competitors
      WHERE client_id = ?
      ORDER BY competitor_name ASC
    `, [clientId]);
    res.json(rows.map(rowToCompetitor));
  } catch (err) { next(err); }
});

// ─── GET /competitors/signals ─────────────────────────────────────────────────
// Returns a flat, deduped, lowercased array of all match_terms for this client.
// Used by the campaign wizard to classify keywords.
router.get('/signals', requireAuth, async (req, res, next) => {
  try {
    const clientId = getClientId(req);
    const rows = await query(`
      SELECT match_terms
      FROM CALBRIDGE_PROD.APP.brand_competitors
      WHERE client_id = ?
    `, [clientId]);

    const all = new Set();
    for (const row of rows) {
      let terms = [];
      try { terms = JSON.parse(row.MATCH_TERMS || '[]'); } catch {}
      for (const t of terms) {
        if (t && typeof t === 'string') all.add(t.trim().toLowerCase());
      }
    }
    res.json([...all]);
  } catch (err) { next(err); }
});

// ─── GET /competitors/subcategories ──────────────────────────────────────────
// Infers subcategory names from product titles for this client.
router.get('/subcategories', requireAuth, async (req, res, next) => {
  try {
    const clientId = getClientId(req);
    let titles = [];
    try {
      const rows = await query(`
        SELECT DISTINCT title
        FROM CALBRIDGE_PROD.APP.PRODUCTS
        WHERE client_id = ?
          AND title IS NOT NULL
        LIMIT 500
      `, [clientId]);
      titles = rows.map(r => r.TITLE || r.title || '').filter(Boolean);
    } catch (err) {
      // PRODUCTS table may not exist for all clients — return empty gracefully
      console.warn('[competitors/subcategories] Could not query PRODUCTS:', err.message);
    }

    const found = new Set();
    for (const title of titles) {
      found.add(inferSubcategory(title));
    }
    found.delete('Other'); // Only include Other if nothing else found
    const result = [...found].sort();
    if (!result.length) result.push('Other');
    res.json(result);
  } catch (err) { next(err); }
});

// ─── POST /competitors ────────────────────────────────────────────────────────
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const clientId      = getClientId(req);
    const { competitorName, matchTerms, subcategory, brandId } = req.body;

    if (!competitorName || !competitorName.trim()) {
      return res.status(400).json({ error: 'competitorName is required' });
    }
    if (!Array.isArray(matchTerms) || matchTerms.length === 0) {
      return res.status(400).json({ error: 'matchTerms must be a non-empty array' });
    }

    const matchTermsJson = JSON.stringify(matchTerms.map(t => String(t).trim().toLowerCase()).filter(Boolean));

    const rows = await query(`
      INSERT INTO CALBRIDGE_PROD.APP.brand_competitors
        (client_id, brand_id, subcategory, competitor_name, match_terms)
      VALUES (?, ?, ?, ?, ?)
    `, [
      clientId,
      brandId  || null,
      subcategory ? subcategory.trim() : null,
      competitorName.trim(),
      matchTermsJson,
    ]);

    // Fetch the newly created row
    const created = await query(`
      SELECT id, client_id, brand_id, subcategory, competitor_name, match_terms, created_at, updated_at
      FROM CALBRIDGE_PROD.APP.brand_competitors
      WHERE client_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `, [clientId]);

    res.status(201).json(created.length ? rowToCompetitor(created[0]) : { ok: true });
  } catch (err) { next(err); }
});

// ─── PUT /competitors/:id ─────────────────────────────────────────────────────
router.put('/:id', requireAuth, async (req, res, next) => {
  try {
    const clientId      = getClientId(req);
    const { id }        = req.params;
    const { competitorName, matchTerms, subcategory, brandId } = req.body;

    // Verify ownership
    const existing = await query(`
      SELECT id FROM CALBRIDGE_PROD.APP.brand_competitors
      WHERE id = ? AND client_id = ?
    `, [id, clientId]);
    if (!existing.length) return res.status(404).json({ error: 'Competitor not found' });

    if (!competitorName || !competitorName.trim()) {
      return res.status(400).json({ error: 'competitorName is required' });
    }
    if (!Array.isArray(matchTerms) || matchTerms.length === 0) {
      return res.status(400).json({ error: 'matchTerms must be a non-empty array' });
    }

    const matchTermsJson = JSON.stringify(matchTerms.map(t => String(t).trim().toLowerCase()).filter(Boolean));

    await query(`
      UPDATE CALBRIDGE_PROD.APP.brand_competitors
      SET competitor_name = ?,
          match_terms     = ?,
          subcategory     = ?,
          brand_id        = ?,
          updated_at      = CURRENT_TIMESTAMP
      WHERE id = ? AND client_id = ?
    `, [
      competitorName.trim(),
      matchTermsJson,
      subcategory ? subcategory.trim() : null,
      brandId || null,
      id,
      clientId,
    ]);

    const updated = await query(`
      SELECT id, client_id, brand_id, subcategory, competitor_name, match_terms, created_at, updated_at
      FROM CALBRIDGE_PROD.APP.brand_competitors
      WHERE id = ? AND client_id = ?
    `, [id, clientId]);

    res.json(updated.length ? rowToCompetitor(updated[0]) : { ok: true });
  } catch (err) { next(err); }
});

// ─── DELETE /competitors/:id ──────────────────────────────────────────────────
router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const clientId = getClientId(req);
    const { id }   = req.params;

    // Verify ownership
    const existing = await query(`
      SELECT id FROM CALBRIDGE_PROD.APP.brand_competitors
      WHERE id = ? AND client_id = ?
    `, [id, clientId]);
    if (!existing.length) return res.status(404).json({ error: 'Competitor not found' });

    await query(`
      DELETE FROM CALBRIDGE_PROD.APP.brand_competitors
      WHERE id = ? AND client_id = ?
    `, [id, clientId]);

    res.json({ ok: true, id });
  } catch (err) { next(err); }
});

module.exports = router;
