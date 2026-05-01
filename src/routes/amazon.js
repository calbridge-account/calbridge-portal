const express = require('express');
const router = express.Router();
const amazonAuthService = require('../services/amazonAuthService');
const { requireAuth } = require('../middleware/requireAuth');

const VALID_TYPES = ['ads', 'dsp', 'seller', 'vendor'];
// Types that require the user to pick a profile before completing the connection
const PROFILE_PICKER_TYPES = ['ads', 'dsp'];

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

    // Amazon may return ?error=access_denied&error_description=... on failure
    if (req.query.error) {
      const desc = req.query.error_description || req.query.error;
      console.error(`[Amazon] OAuth error for ${type}: ${req.query.error} — ${desc}`);
      return res.redirect(`/account?oauth_error=${encodeURIComponent(desc)}&type=${type}`);
    }

    if (!code) {
      console.error(`[Amazon] Callback for ${type} missing code. Query:`, JSON.stringify(req.query));
      return res.status(400).json({ error: 'Missing authorization code' });
    }

    const extra = {};
    if (selling_partner_id) extra.sellingPartnerId = selling_partner_id;

    // Ads / DSP: use profile picker flow — show profile selection before finalising
    if (PROFILE_PICKER_TYPES.includes(type)) {
      const { pendingId, profiles } = await amazonAuthService.handleCallbackPending({
        clientId: req.session.clientId,
        code,
        state,
        type,
      });
      // Redirect to React profile picker page
      return res.redirect(`/account?selectProfile=1&pendingId=${encodeURIComponent(pendingId)}&type=${type}`);
    }

    // SP-API (seller/vendor): complete immediately as before
    await amazonAuthService.handleCallback({
      clientId: req.session.clientId,
      code,
      state,
      type,
      extra
    });

    res.redirect(`/account?connected=${type}`);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /amazon/pending-profiles?pendingId=xxx
 * Returns the profile list for a pending connection so the picker UI can render.
 */
router.get('/pending-profiles', requireAuth, async (req, res, next) => {
  try {
    const { pendingId } = req.query;
    if (!pendingId) return res.status(400).json({ error: 'pendingId required' });

    // Access the pending store via the service
    const { getPendingProfiles } = require('../services/amazonAuthService');
    const data = await getPendingProfiles(pendingId, req.session.clientId);
    if (!data) return res.status(404).json({ error: 'Pending connection not found or expired' });

    res.json({ profiles: data.profiles, type: data.type });
  } catch (err) { next(err); }
});

/**
 * POST /amazon/confirm-profile
 * Step 2 of the profile picker flow.
 * Body: { pendingId, selectedProfileIds: string[] }
 */
router.post('/confirm-profile', requireAuth, async (req, res, next) => {
  try {
    const { pendingId, selectedProfileIds } = req.body;
    if (!pendingId || !Array.isArray(selectedProfileIds) || selectedProfileIds.length === 0) {
      return res.status(400).json({ error: 'pendingId and selectedProfileIds are required' });
    }
    const result = await amazonAuthService.confirmProfile({
      pendingId,
      clientId: req.session.clientId,
      selectedProfileIds,
    });
    res.json(result);
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
