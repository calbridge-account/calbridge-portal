'use strict';
/**
 * Marginal ROAS & Contribution Margin API Routes
 *
 * GET  /api/marginal-roas/scores          — latest campaign efficiency scores
 * GET  /api/marginal-roas/asin-economics  — ASIN cost/margin data
 * POST /api/marginal-roas/asin-economics  — upsert ASIN cost/margin data
 * POST /api/marginal-roas/score           — manually trigger scoring for client
 */

const express = require('express');
const router  = express.Router();
const { requireAuth } = require('../middleware/requireAuth');
const svc = require('../services/marginalRoasService');

// ─── GET /scores ──────────────────────────────────────────────────────────────
// Returns the latest Marginal ROAS efficiency scores for all campaigns.
//
// Query params:
//   marketplace  (default: ATVPDKIKX0DER)
//   limit        (default: 50, max: 500)
//   recommendation  filter by recommendation: scale|hold|reduce|pause
//
router.get('/scores', requireAuth, async (req, res) => {
  try {
    const clientId    = req.session?.clientId || req.user?.clientId;
    if (!clientId) return res.status(401).json({ error: 'No client context' });

    const marketplace = req.query.marketplace || 'ATVPDKIKX0DER';
    const limit       = Math.min(parseInt(req.query.limit || '50', 10), 500);

    let scores = await svc.getCampaignScores(clientId, marketplace, limit);

    // Optional filter by recommendation
    if (req.query.recommendation) {
      const filter = req.query.recommendation.toLowerCase();
      scores = scores.filter(s => s.recommendation === filter);
    }

    res.json({
      client_id: clientId,
      marketplace,
      scored_at: scores[0]?.scored_at ?? null,
      count: scores.length,
      campaigns: scores,
    });
  } catch (err) {
    console.error('[marginalRoas] GET /scores error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /asin-economics ──────────────────────────────────────────────────────
// Returns ASIN-level cost structure and contribution margin data.
//
// Query params:
//   asins  comma-separated list of ASINs (optional, returns all if omitted)
//
router.get('/asin-economics', requireAuth, async (req, res) => {
  try {
    const clientId = req.session?.clientId || req.user?.clientId;
    if (!clientId) return res.status(401).json({ error: 'No client context' });

    const asins = req.query.asins
      ? req.query.asins.split(',').map(a => a.trim().toUpperCase()).filter(Boolean)
      : [];

    const data = await svc.getAsinEconomics(clientId, asins);

    res.json({
      client_id: clientId,
      count: data.length,
      asins: data,
    });
  } catch (err) {
    console.error('[marginalRoas] GET /asin-economics error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /asin-economics ─────────────────────────────────────────────────────
// Upsert ASIN economics data (COGS, FBA fees, selling price).
//
// Body (JSON):
//   { records: [ { asin, cogs, fba_fee, referral_fee_pct, avg_selling_price, data_source }, ... ] }
//
router.post('/asin-economics', requireAuth, async (req, res) => {
  try {
    const clientId = req.session?.clientId || req.user?.clientId;
    if (!clientId) return res.status(401).json({ error: 'No client context' });

    const { records } = req.body || {};
    if (!Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ error: 'Body must contain a non-empty "records" array' });
    }

    // Basic validation
    for (const r of records) {
      if (!r.asin) return res.status(400).json({ error: 'Each record must have an "asin" field' });
    }

    const written = await svc.upsertAsinEconomics(clientId, records);

    res.json({
      success: true,
      client_id: clientId,
      rows_written: written,
    });
  } catch (err) {
    console.error('[marginalRoas] POST /asin-economics error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /score ──────────────────────────────────────────────────────────────
// Manually trigger a scoring run for the current client.
//
// Body (JSON, optional):
//   { marketplace: 'ATVPDKIKX0DER' }
//
router.post('/score', requireAuth, async (req, res) => {
  try {
    const clientId = req.session?.clientId || req.user?.clientId;
    if (!clientId) return res.status(401).json({ error: 'No client context' });

    const marketplace = req.body?.marketplace || 'ATVPDKIKX0DER';

    console.log(`[marginalRoas] Manual score trigger for ${clientId} / ${marketplace}`);
    const written = await svc.scoreAllCampaigns(clientId, marketplace);

    res.json({
      success: true,
      client_id: clientId,
      marketplace,
      campaigns_scored: written,
    });
  } catch (err) {
    console.error('[marginalRoas] POST /score error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
