/**
 * navConfig.js — serve per-client nav visibility config to authenticated React app
 */
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/requireAuth');
const { query } = require('../services/snowflakeService');

const NAV_PATHS = ['/', '/vendor', '/forecasting', '/cogs', '/advertising', '/pacing', '/account'];

/**
 * GET /nav-config
 * Returns nav visibility config for the authenticated client.
 * Defaults to 'visible' for any path not explicitly configured.
 */
router.get('/nav-config', requireAuth, async (req, res, next) => {
  try {
    const clientId = req.session.clientId;
    const rows = await query(
      `SELECT nav_path, visibility FROM CALBRIDGE_PROD.APP.CLIENT_NAV_CONFIG WHERE client_id = ?`,
      [clientId]
    );
    const config = {};
    NAV_PATHS.forEach(p => { config[p] = 'visible'; });
    rows.forEach(r => { config[r.NAV_PATH] = r.VISIBILITY; });
    res.json({ config });
  } catch (err) { next(err); }
});

module.exports = router;
