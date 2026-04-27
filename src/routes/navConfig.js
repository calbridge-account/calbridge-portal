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

    // Marketplace-aware: when CA is active, retail tabs lock since retail data is US-only
    const activeMarketplace = req.session.activeMarketplace || 'US';
    const isCA = activeMarketplace === 'CA';

    // hasRetail = has either Seller or Vendor connected (drives overview visibility)
    const hasRetail = hasVendor || hasSeller;

    const config = {
      // Overview: locked (grayed) when no retail connected — ads-only clients land on /advertising
      '/':            hasRetail ? 'visible' : 'grayed',
      '/advertising': hasAds    ? 'visible' : 'locked',
      '/pacing':      hasAds    ? 'visible' : 'locked',
      // Retail tabs: locked when CA selected (no CA retail data) or connection missing
      '/vendor':      isCA ? 'grayed' : (hasVendor ? 'visible' : 'locked'),
      '/seller':      isCA ? 'grayed' : (hasSeller ? 'visible' : 'locked'),
      '/forecasting': isCA ? 'grayed' : (hasVendor ? 'visible' : 'locked'),
      '/cogs':        isCA ? 'grayed' : (hasSeller ? 'visible' : 'locked'),
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
      '/vendor':      isCA      ? 'Vendor Central data is US-only — switch to US marketplace'
                    : hasVendor ? null : 'Connect your Vendor Central account to unlock vendor analytics',
      '/seller':      isCA      ? 'Seller Central data is US-only — switch to US marketplace'
                    : hasSeller ? null : 'Connect your Seller Central account to unlock seller analytics',
      '/forecasting': isCA      ? 'Forecasting data is US-only — switch to US marketplace'
                    : hasVendor ? null : 'Connect your Vendor Central account to unlock demand forecasting',
      '/cogs':        isCA      ? 'COGS data is US-only — switch to US marketplace'
                    : hasSeller ? null : 'Connect your Seller Central account to unlock COGS analytics',
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
