/**
 * navConfig.js — serve per-client nav visibility config to authenticated React app
 * Visibility is computed dynamically from connection status; DB rows can override.
 */
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/requireAuth');
const { query } = require('../services/snowflakeService');
const { getConnectionStatus } = require('../services/amazonAuthService');

const NAV_PATHS = ['/', '/vendor', '/seller', '/forecasting', '/cogs', '/advertising', '/pacing', '/reports', '/account'];

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

    // hasRetail = has either Seller or Vendor for current marketplace (drives overview visibility)
    const hasRetail = hasVendor || hasSeller; // global — overview visible if any retail connected
    const hasRetailForMarketplace = hasVendorForMarketplace || hasSellerForMarketplace;

    const config = {
      // Overview: grayed when no retail connected globally — ads-only clients land on /advertising
      '/':            hasRetail ? 'visible' : 'grayed',
      '/advertising': hasAds    ? 'visible' : 'locked',
      '/pacing':      hasAds    ? 'visible' : 'locked',
      // Retail tabs: grayed when no retail for active marketplace, locked if no connection at all
      '/vendor':      hasVendorForMarketplace ? 'visible' : (hasVendor ? 'grayed' : 'locked'),
      '/seller':      hasSellerForMarketplace ? 'visible' : (hasSeller ? 'grayed' : 'locked'),
      '/forecasting': hasVendorForMarketplace ? 'visible' : (hasVendor ? 'grayed' : 'locked'),
      '/cogs':        hasSellerForMarketplace ? 'visible' : (hasSeller ? 'grayed' : 'locked'),
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
      '/':            hasRetail ? null : 'No retail connections yet — overview not available',
      '/advertising': hasAds    ? null : 'Connect your Amazon Ads account to unlock advertising analytics',
      '/pacing':      hasAds    ? null : 'Connect your Amazon Ads account to unlock budget pacing',
      '/vendor':      hasVendorForMarketplace ? null
                    : hasVendor ? `No Vendor Central connection for ${activeMarketplace} marketplace`
                    : 'Connect your Vendor Central account to unlock vendor analytics',
      '/seller':      hasSellerForMarketplace ? null
                    : hasSeller ? `No Seller Central connection for ${activeMarketplace} marketplace`
                    : 'Connect your Seller Central account to unlock seller analytics',
      '/forecasting': hasVendorForMarketplace ? null
                    : hasVendor ? `No Vendor Central connection for ${activeMarketplace} marketplace`
                    : 'Connect your Vendor Central account to unlock demand forecasting',
      '/cogs':        hasSellerForMarketplace ? null
                    : hasSeller ? `No Seller Central connection for ${activeMarketplace} marketplace`
                    : 'Connect your Seller Central account to unlock COGS analytics',
      '/reports':     isProPlus ? null : 'Report Builder requires Pro plan or above',
    };

    res.json({
      config,
      reasons,
      connections: { ads: hasAds, vendor: hasVendor, seller: hasSeller },
      activeMarketplace,
      hasRetail,
      // landingPath: frontend uses this to redirect on login when overview is grayed
      landingPath: hasRetail ? '/' : (hasAds ? '/advertising' : '/account'),
    });
  } catch (err) { next(err); }
});

module.exports = router;
