const { query } = require('../services/snowflakeService');

// Plan cache TTL: 5 minutes
const PLAN_CACHE_TTL_MS = 5 * 60 * 1000;

// Known valid plans — anything else defaults to 'free'
const VALID_PLANS = new Set(['free', 'starter', 'growth', 'pro']);

/**
 * Middleware: require an authenticated session.
 * Attach to any route that needs a logged-in client.
 *
 * Phase 3F: Also lazy-loads agencyId/managerId/advertiserId from client_migration_map
 * for sessions that have clientId but not yet the new account context.
 * clientId remains primary — this is backward compatible.
 *
 * Plan lookup: Attaches req.userPlan with a 5-minute session cache.
 */
async function requireAuth(req, res, next) {
  if (!req.session || !req.session.clientId) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  // Phase 3F: Lazy-load new account context if not already in session
  if (req.session.clientId && !req.session.managerId) {
    try {
      const map = await query(
        'SELECT agency_id, manager_id, advertiser_id FROM CALBRIDGE_PROD.APP.client_migration_map WHERE client_id = ?',
        [req.session.clientId]
      );
      if (map.length) {
        req.session.agencyId     = map[0].AGENCY_ID     || null;
        req.session.managerId    = map[0].MANAGER_ID    || null;
        req.session.advertiserId = map[0].ADVERTISER_ID || null;
        await new Promise(r => req.session.save(r));
      }
    } catch (e) {
      // Non-fatal — clientId-based auth still works for all existing routes
    }
  }

  // Plan lookup with 5-minute session cache
  try {
    const cache = req.session.planCache;
    if (cache && cache.plan && (Date.now() - cache.fetchedAt) < PLAN_CACHE_TTL_MS) {
      req.userPlan = cache.plan;
    } else {
      const rows = await query(
        'SELECT subscription_plan FROM CALBRIDGE_PROD.APP.clients WHERE client_id = ?',
        [req.session.clientId]
      );
      const raw  = rows[0]?.SUBSCRIPTION_PLAN || rows[0]?.subscription_plan || null;
      const plan = VALID_PLANS.has(raw) ? raw : 'free';
      req.session.planCache = { plan, fetchedAt: Date.now() };
      req.userPlan = plan;
    }
  } catch (e) {
    // Non-fatal — default to most restrictive plan on DB error
    req.userPlan = req.session.planCache?.plan || 'free';
  }

  next();
}

module.exports = { requireAuth };
