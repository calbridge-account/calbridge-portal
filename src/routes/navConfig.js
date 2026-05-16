/**
 * navConfig.js — serve per-client nav visibility config to authenticated React app
 * Visibility is computed dynamically from connection status; DB rows can override.
 */
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/requireAuth');
const { query } = require('../services/snowflakeService');
const { cachedQuery } = require('../services/queryCache');
const { getConnectionStatus } = require('../services/amazonAuthService');

// Cache TTLs for nav lookups
const TTL_PLAN_MS         =  5 * 60 * 1000;  //  5 min — subscription plan
const TTL_NAV_CONFIG_MS   =  5 * 60 * 1000;  //  5 min — nav overrides rarely change
const TTL_CLIENT_ACCTS_MS = 30 * 60 * 1000;  // 30 min — channel/marketplace connections

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
    // Marketplace-aware: check if retail (seller/vendor) is connected for the active marketplace
    const activeMarketplace = req.session.activeMarketplace || 'US';

    // Consolidated query: fetch subscription_plan + marketplace-specific account channels in one shot
    // Previously 2 separate queries; now 1 LEFT JOIN. Redis-cached 10 min (plan) / 30 min (accounts).
    // Using 10 min as a safe middle ground for the join result.
    let plan = 'free';
    let hasVendorForMarketplace = hasVendor; // default: fall back to global connection status
    let hasSellerForMarketplace = hasSeller;
    try {
      const clientRows = await cachedQuery(
        `sfcache:nav_client_data:${clientId}`,
        TTL_CLIENT_ACCTS_MS,
        () => query(
          `SELECT c.subscription_plan, ca.channel, ca.marketplace
           FROM CALBRIDGE_PROD.APP.clients c
           LEFT JOIN CALBRIDGE_PROD.APP.client_accounts ca
             ON ca.client_id = c.client_id
            AND ca.channel IN ('seller','vendor')
            AND ca.is_active = TRUE
           WHERE c.client_id = ?`,
          [clientId]
        )
      );
      if (clientRows.length > 0) {
        const sp = clientRows[0].SUBSCRIPTION_PLAN || clientRows[0].subscription_plan;
        if (sp) plan = sp;
        // If any account rows came back (channel is non-null), use marketplace-level data
        const accountRows = clientRows.filter(r => r.CHANNEL || r.channel);
        if (accountRows.length > 0) {
          hasVendorForMarketplace = accountRows.some(r =>
            (r.CHANNEL || r.channel) === 'vendor' &&
            (r.MARKETPLACE || r.marketplace) === activeMarketplace
          );
          hasSellerForMarketplace = accountRows.some(r =>
            (r.CHANNEL || r.channel) === 'seller' &&
            (r.MARKETPLACE || r.marketplace) === activeMarketplace
          );
        }
      }
    } catch (_) { /* non-fatal, fall back to defaults */ }
    const isProPlus = plan === 'pro' || plan === 'agency';

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

    // Allow DB overrides (e.g. admin can manually lock/unlock specific paths) — Redis-cached 5 min
    const rows = await cachedQuery(
      `sfcache:CLIENT_NAV_CONFIG:${clientId}`,
      TTL_NAV_CONFIG_MS,
      () => query(
        `SELECT nav_path, visibility FROM CALBRIDGE_PROD.APP.CLIENT_NAV_CONFIG WHERE client_id = ?`,
        [clientId]
      )
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
      hasRetail: hasVendor || hasSeller,
      // landingPath: frontend uses this to redirect on login when overview is grayed
      landingPath: hasRetailForMarketplace ? '/' : (hasAds ? '/advertising' : '/account'),
    });
  } catch (err) { next(err); }
});

module.exports = router;
