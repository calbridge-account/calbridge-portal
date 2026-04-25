/**
 * navConfig.js — serve per-client nav visibility config to authenticated React app
 * Visibility is computed dynamically from connection status; DB rows can override.
 */
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/requireAuth');
const { query } = require('../services/snowflakeService');
const { getConnectionStatus } = require('../services/amazonAuthService');

const NAV_PATHS = ['/', '/vendor', '/seller', '/forecasting', '/cogs', '/advertising', '/pacing', '/account'];

/**
 * GET /nav-config
 * Returns nav visibility config for the authenticated client.
 * Paths requiring a connection are locked until that connection exists;
 * DB rows can override (e.g. admin manually lock/unlock).
 */
router.get('/nav-config', requireAuth, async (req, res, next) => {
  try {
    const clientId = req.session.clientId;

    // Get connection status
    const connections = await getConnectionStatus(clientId);
    const hasAds    = connections?.ads?.connected    === true;
    const hasVendor = connections?.vendor?.connected === true;
    const hasSeller = connections?.seller?.connected === true;

    // Base config — derive from connection status
    const config = {
      '/':            'visible',
      '/advertising': hasAds    ? 'visible' : 'locked',
      '/pacing':      hasAds    ? 'visible' : 'locked',
      '/vendor':      hasVendor ? 'visible' : 'locked',
      '/seller':      hasSeller ? 'visible' : 'locked',
      '/forecasting': hasVendor ? 'visible' : 'locked',
      '/cogs':        hasSeller ? 'visible' : 'locked',
      '/account':     'visible',
    };

    // Allow DB overrides (e.g. admin can manually lock/unlock specific paths)
    const rows = await query(
      `SELECT nav_path, visibility FROM CALBRIDGE_PROD.APP.CLIENT_NAV_CONFIG WHERE client_id = ?`,
      [clientId]
    );
    rows.forEach(r => {
      const path = r.NAV_PATH || r.nav_path;
      const vis  = r.VISIBILITY || r.visibility;
      if (path && vis) config[path] = vis;
    });

    // Reasons for locked paths — frontend can show as tooltips
    const reasons = {
      '/advertising': hasAds    ? null : 'Connect your Amazon Ads account to unlock advertising analytics',
      '/pacing':      hasAds    ? null : 'Connect your Amazon Ads account to unlock budget pacing',
      '/vendor':      hasVendor ? null : 'Connect your Vendor Central account to unlock vendor analytics',
      '/seller':      hasSeller ? null : 'Connect your Seller Central account to unlock seller analytics',
      '/forecasting': hasVendor ? null : 'Connect your Vendor Central account to unlock demand forecasting',
      '/cogs':        hasSeller ? null : 'Connect your Seller Central account to unlock COGS analytics',
    };

    res.json({
      config,
      reasons,
      connections: {
        ads:    hasAds,
        vendor: hasVendor,
        seller: hasSeller,
      },
    });
  } catch (err) { next(err); }
});

module.exports = router;
