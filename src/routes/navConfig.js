/**
 * navConfig.js — serve per-client nav visibility config to authenticated React app
 * Visibility is computed dynamically from connection status; DB rows can override.
 */
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/requireAuth');
const { query } = require('../services/snowflakeService');
const { getConnectionStatus } = require('../services/amazonAuthService');

const NAV_PATHS = ['/', '/vendor', '/seller', '/forecasting', '/cogs', '/inventory', '/advertising', '/pacing', '/reports', '/account'];

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
    // Check plan for Pro-gated features
    const planRows = await query(
      'SELECT subscription_plan FROM CALBRIDGE_PROD.APP.clients WHERE client_id = ?',
      [clientId]
    ).catch(() => []);
    const plan = planRows[0]?.SUBSCRIPTION_PLAN || planRows[0]?.subscription_plan || 'free';
    const isProPlus = plan === 'pro' || plan === 'agency';

    // Marketplace-aware: check if retail (seller/vendor) is connected for the active marketplace
    const activeMarketplace = req.session.activeMarketplace || 'US';

    // Check client_accounts for marketplace-specific retail connections
    let hasVendorForMarketplace = hasVendor; // default: fall back to global connection status
    let hasSellerForMarketplace = hasSeller;
    try {
      const mpRows = await query(
        `SELECT channel, marketplace FROM CALBRIDGE_PROD.APP.client_accounts
         WHERE client_id = ? AND channel IN ('seller','vendor') AND is_active = TRUE`,
        [clientId]
      );
      // If we have marketplace-level data, use it; otherwise fall back to global
      if (mpRows.length > 0) {
        hasVendorForMarketplace = mpRows.some(r =>
          (r.CHANNEL || r.channel) === 'vendor' &&
          (r.MARKETPLACE || r.marketplace) === activeMarketplace
        );
        hasSellerForMarketplace = mpRows.some(r =>
          (r.CHANNEL || r.channel) === 'seller' &&
          (r.MARKETPLACE || r.marketplace) === activeMarketplace
        );
      }
    } catch (_) { /* non-fatal, fall back to global */ }

    // Simple consistent rule: connected for this marketplace = visible, otherwise grayed
    // Same logic applies to US and every other marketplace
    const hasRetailForMarketplace = hasVendorForMarketplace || hasSellerForMarketplace;

    const vis  = (connected) => connected ? 'visible' : 'grayed';
    const gate = (connected) => connected ? 'visible' : 'locked'; // locked = need to connect at all

    const config = {
      '/':            vis(hasRetailForMarketplace),
      '/advertising': gate(hasAds),
      '/pacing':      gate(hasAds),
      '/vendor':      vis(hasVendorForMarketplace),
      '/seller':      vis(hasSellerForMarketplace),
      '/forecasting': vis(hasVendorForMarketplace),
      '/inventory':   vis(hasSellerForMarketplace || hasVendorForMarketplace),
      '/cogs':        vis(hasSellerForMarketplace),
      '/reports':     isProPlus ? 'visible' : 'grayed',
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
      '/':            hasRetailForMarketplace ? null : `No retail connections for ${activeMarketplace}`,
      '/advertising': hasAds ? null : 'Connect your Amazon Ads account to unlock advertising analytics',
      '/pacing':      hasAds ? null : 'Connect your Amazon Ads account to unlock budget pacing',
      '/vendor':      hasVendorForMarketplace ? null : `No Vendor Central connection for ${activeMarketplace}`,
      '/seller':      hasSellerForMarketplace ? null : `No Seller Central connection for ${activeMarketplace}`,
      '/forecasting': hasVendorForMarketplace ? null : `No Vendor Central connection for ${activeMarketplace}`,
      '/inventory':   (hasSellerForMarketplace || hasVendorForMarketplace) ? null : `No retail connections for ${activeMarketplace}`,
      '/cogs':        hasSellerForMarketplace ? null : `No Seller Central connection for ${activeMarketplace}`,
      '/reports':     isProPlus ? null : 'Report Builder requires Pro plan or above',
    };

    res.json({
      config,
      reasons,
      connections: { ads: hasAds, vendor: hasVendor, seller: hasSeller },
      activeMarketplace,
      hasRetail,
      // landingPath: frontend uses this to redirect on login when overview is grayed
      landingPath: hasRetailForMarketplace ? '/' : (hasAds ? '/advertising' : '/account'),
    });
  } catch (err) { next(err); }
});

module.exports = router;
