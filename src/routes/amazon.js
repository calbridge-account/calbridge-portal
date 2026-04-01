const express = require('express');
const router = express.Router();
const amazonAuthService = require('../services/amazonAuthService');
const { requireAuth } = require('../middleware/requireAuth');

const VALID_TYPES = ['ads', 'dsp', 'seller', 'vendor'];

/**
 * GET /amazon/connect/:type
 * Kicks off LWA OAuth for the given connection type.
 * type: ads | dsp | seller | vendor
 */
router.get('/connect/:type', requireAuth, (req, res, next) => {
  try {
    const { type } = req.params;
    if (!VALID_TYPES.includes(type)) {
      return res.status(400).json({ error: `Invalid type. Must be one of: ${VALID_TYPES.join(', ')}` });
    }
    const url = amazonAuthService.getAuthUrl(type, req.session.clientId);
    res.redirect(url);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /amazon/callback/:type
 * OAuth callback handler for all 4 connection types.
 */
router.get('/callback/:type', requireAuth, async (req, res, next) => {
  try {
    const { type } = req.params;
    if (!VALID_TYPES.includes(type)) {
      return res.status(400).json({ error: 'Invalid callback type' });
    }

    // SP-API consent page returns `spapi_oauth_code`; LWA returns `code`
    const code = req.query.spapi_oauth_code || req.query.code;
    const { state, selling_partner_id } = req.query;
    if (!code) return res.status(400).json({ error: 'Missing authorization code' });

    const extra = {};
    if (selling_partner_id) extra.sellingPartnerId = selling_partner_id;

    await amazonAuthService.handleCallback({
      clientId: req.session.clientId,
      code,
      state,
      type,
      extra
    });

    res.redirect(`/dashboard.html?connected=${type}`);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /amazon/status
 * Returns connection status for all 4 types for the logged-in client.
 */
router.get('/status', requireAuth, async (req, res, next) => {
  try {
    const status = await amazonAuthService.getConnectionStatus(req.session.clientId);
    res.json(status);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
