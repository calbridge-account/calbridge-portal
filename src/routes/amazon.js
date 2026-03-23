const express = require('express');
const router = express.Router();
const amazonAuthService = require('../services/amazonAuthService');
const { requireAuth } = require('../middleware/requireAuth');

// GET /amazon/connect/ads
// Kicks off LWA OAuth for Amazon Advertising
router.get('/connect/ads', requireAuth, (req, res) => {
  const url = amazonAuthService.getAdsAuthUrl(req.session.clientId);
  res.redirect(url);
});

// GET /amazon/connect/spapi
// Kicks off LWA OAuth for SP-API (Seller/Vendor Central)
router.get('/connect/spapi', requireAuth, (req, res) => {
  const url = amazonAuthService.getSpapiAuthUrl(req.session.clientId);
  res.redirect(url);
});

// GET /amazon/callback/ads
// OAuth callback for Amazon Advertising
router.get('/callback/ads', requireAuth, async (req, res, next) => {
  try {
    const { code, state } = req.query;
    if (!code) return res.status(400).json({ error: 'Missing auth code' });
    await amazonAuthService.handleAdsCallback({ clientId: req.session.clientId, code, state });
    res.redirect('/dashboard?connected=ads');
  } catch (err) {
    next(err);
  }
});

// GET /amazon/callback/spapi
// OAuth callback for SP-API
router.get('/callback/spapi', requireAuth, async (req, res, next) => {
  try {
    const { code, state, selling_partner_id } = req.query;
    if (!code) return res.status(400).json({ error: 'Missing auth code' });
    await amazonAuthService.handleSpapiCallback({ clientId: req.session.clientId, code, state, sellingPartnerId: selling_partner_id });
    res.redirect('/dashboard?connected=spapi');
  } catch (err) {
    next(err);
  }
});

// GET /amazon/status
// Returns connection status for the logged-in client
router.get('/status', requireAuth, async (req, res, next) => {
  try {
    const status = await amazonAuthService.getConnectionStatus(req.session.clientId);
    res.json(status);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
