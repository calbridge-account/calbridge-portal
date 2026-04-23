/**
 * Brands API — /brands
 *
 * A Brand is the unifying concept that maps:
 *   - An Amazon Ads profile (profileId) — Sponsored Products/Brands/Display
 *   - An optional DSP advertiser (advertiserId) — Scale+ only
 *   - An optional SP-API seller (sellingPartnerId)
 *   - An optional SP-API vendor (vendorGroupId)
 *
 * All routes are client-scoped via session.clientId.
 */
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { requireAuth } = require('../middleware/requireAuth');
const { checkBrandLimit, getPlanLimits } = require('../middleware/requirePlan');
const { query } = require('../services/snowflakeService');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve clientId from session (supports both old and new session shapes) */
function getClientId(req) {
  return req.session?.clientId || req.session?.client?.id;
}

/** Resolve plan from session */
function getClientPlan(req) {
  return req.session?.client?.plan || req.session?.clientPlan || 'starter';
}

/** Map a Snowflake row to a camelCase brand object */
function rowToBrand(r) {
  return {
    brandId:          r.BRAND_ID,
    clientId:         r.CLIENT_ID,
    name:             r.NAME,
    marketplace:      r.MARKETPLACE,
    adsProfileId:     r.ADS_PROFILE_ID     || null,
    dspAdvertiserId:  r.DSP_ADVERTISER_ID  || null,
    spSellerId:       r.SP_SELLER_ID       || null,
    spVendorId:       r.SP_VENDOR_ID       || null,
    isActive:         r.IS_ACTIVE !== false && r.IS_ACTIVE !== 'false',
    createdAt:        r.CREATED_AT,
    updatedAt:        r.UPDATED_AT,
  };
}

// ---------------------------------------------------------------------------
// GET /brands/plan-info
// Must be defined BEFORE /:brandId to avoid route shadowing.
// Returns the client's plan, current brand count, and plan limits.
// ---------------------------------------------------------------------------
router.get('/plan-info', requireAuth, async (req, res, next) => {
  try {
    const clientId = getClientId(req);
    const plan = getClientPlan(req);
    const limits = getPlanLimits(plan);

    // If plan not already on session, fetch from DB
    let resolvedPlan = plan;
    if (!req.session?.client?.plan && !req.session?.clientPlan) {
      const rows = await query(
        'SELECT plan FROM clients WHERE client_id = ?',
        [clientId]
      ).catch(() => []);
      if (rows[0]?.PLAN) {
        resolvedPlan = rows[0].PLAN;
        // Cache on session for subsequent requests
        req.session.clientPlan = resolvedPlan;
      }
    }

    const resolvedLimits = getPlanLimits(resolvedPlan);

    const countRows = await query(
      'SELECT COUNT(*) AS cnt FROM brands WHERE client_id = ? AND is_active = TRUE',
      [clientId]
    );
    const brandCount = Number(countRows[0]?.CNT || 0);

    res.json({
      plan:       resolvedPlan,
      brandCount,
      limits:     resolvedLimits,
      canAddBrand: resolvedLimits.brands === Infinity || brandCount < resolvedLimits.brands,
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /brands
// List all active brands for the current client.
// ---------------------------------------------------------------------------
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const clientId = getClientId(req);
    const rows = await query(
      `SELECT * FROM brands
       WHERE client_id = ? AND is_active = TRUE
       ORDER BY created_at ASC`,
      [clientId]
    );
    res.json({ brands: rows.map(rowToBrand) });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /brands/:brandId
// Get a single brand (must belong to this client).
// ---------------------------------------------------------------------------
router.get('/:brandId', requireAuth, async (req, res, next) => {
  try {
    const clientId = getClientId(req);
    const { brandId } = req.params;

    const rows = await query(
      'SELECT * FROM brands WHERE brand_id = ? AND client_id = ?',
      [brandId, clientId]
    );
    if (!rows.length) {
      return res.status(404).json({ error: 'Brand not found' });
    }
    res.json({ brand: rowToBrand(rows[0]) });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /brands
// Create a new brand. Enforces per-plan brand count limit.
// ---------------------------------------------------------------------------
router.post('/', requireAuth, checkBrandLimit, async (req, res, next) => {
  try {
    const clientId = getClientId(req);
    const {
      name,
      marketplace     = 'US',
      adsProfileId    = null,
      dspAdvertiserId = null,
      spSellerId      = null,
      spVendorId      = null,
    } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Brand name is required' });
    }

    const brandId = crypto.randomUUID();
    const now = new Date().toISOString();

    await query(
      `INSERT INTO brands
         (brand_id, client_id, name, marketplace, ads_profile_id, dsp_advertiser_id,
          sp_seller_id, sp_vendor_id, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [brandId, clientId, name.trim(), marketplace, adsProfileId, dspAdvertiserId, spSellerId, spVendorId]
    );

    const rows = await query(
      'SELECT * FROM brands WHERE brand_id = ? AND client_id = ?',
      [brandId, clientId]
    );

    res.status(201).json({ brand: rowToBrand(rows[0]) });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// PUT /brands/:brandId
// Update an existing brand (must belong to this client).
// ---------------------------------------------------------------------------
router.put('/:brandId', requireAuth, async (req, res, next) => {
  try {
    const clientId = getClientId(req);
    const { brandId } = req.params;

    // Verify ownership
    const existing = await query(
      'SELECT brand_id FROM brands WHERE brand_id = ? AND client_id = ?',
      [brandId, clientId]
    );
    if (!existing.length) {
      return res.status(404).json({ error: 'Brand not found' });
    }

    const {
      name,
      marketplace,
      adsProfileId,
      dspAdvertiserId,
      spSellerId,
      spVendorId,
    } = req.body;

    // Build SET clause dynamically — only update provided fields
    const updates = [];
    const binds = [];

    if (name !== undefined)            { updates.push('name = ?');              binds.push(name.trim()); }
    if (marketplace !== undefined)     { updates.push('marketplace = ?');       binds.push(marketplace); }
    if (adsProfileId !== undefined)    { updates.push('ads_profile_id = ?');    binds.push(adsProfileId); }
    if (dspAdvertiserId !== undefined) { updates.push('dsp_advertiser_id = ?'); binds.push(dspAdvertiserId); }
    if (spSellerId !== undefined)      { updates.push('sp_seller_id = ?');      binds.push(spSellerId); }
    if (spVendorId !== undefined)      { updates.push('sp_vendor_id = ?');      binds.push(spVendorId); }

    if (!updates.length) {
      return res.status(400).json({ error: 'No updatable fields provided' });
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    binds.push(brandId, clientId);

    await query(
      `UPDATE brands SET ${updates.join(', ')} WHERE brand_id = ? AND client_id = ?`,
      binds
    );

    const rows = await query(
      'SELECT * FROM brands WHERE brand_id = ? AND client_id = ?',
      [brandId, clientId]
    );

    res.json({ brand: rowToBrand(rows[0]) });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// DELETE /brands/:brandId
// Soft-delete a brand (sets is_active = FALSE).
// ---------------------------------------------------------------------------
router.delete('/:brandId', requireAuth, async (req, res, next) => {
  try {
    const clientId = getClientId(req);
    const { brandId } = req.params;

    const existing = await query(
      'SELECT brand_id FROM brands WHERE brand_id = ? AND client_id = ?',
      [brandId, clientId]
    );
    if (!existing.length) {
      return res.status(404).json({ error: 'Brand not found' });
    }

    await query(
      'UPDATE brands SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP WHERE brand_id = ? AND client_id = ?',
      [brandId, clientId]
    );

    res.json({ message: 'Brand deactivated', brandId });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
