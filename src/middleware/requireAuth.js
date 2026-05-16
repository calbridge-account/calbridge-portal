const { query } = require('../services/snowflakeService');
const { cachedQuery, cacheKey } = require('../services/queryCache');

// Plan cache TTL: 5 minutes (Redis-backed, shared across restarts)
const PLAN_CACHE_TTL_MS  = 5 * 60 * 1000;
// Migration map cache TTL: 10 minutes (rarely changes)
const MIGMAP_CACHE_TTL_MS = 10 * 60 * 1000;

// Known valid plans — anything else defaults to 'free'
const VALID_PLANS = new Set(['free', 'starter', 'growth', 'pro', 'agency']);

/**
 * Middleware: require an authenticated session.
 * Attach to any route that needs a logged-in client.
 *
 * Phase 3F: Also lazy-loads agencyId/managerId/advertiserId from client_migration_map
 * for sessions that have clientId but not yet the new account context.
 * clientId remains primary — this is backward compatible.
 *
 * Plan lookup: Attaches req.userPlan with a 5-minute Redis cache (key: sfcache:plan:{clientId}).
 * Migration map: Cached 10 minutes in Redis (key: sfcache:migmap:{clientId}).
 */
async function requireAuth(req, res, next) {
  if (!req.session || !req.session.clientId) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const clientId = req.session.clientId;

  // Phase 3F: Lazy-load new account context if not already in session
  if (clientId && !req.session.managerId) {
    try {
      const migKey = cacheKey('sfcache:migmap', clientId);
      const map = await cachedQuery(migKey, MIGMAP_CACHE_TTL_MS, () =>
        query(
          'SELECT agency_id, manager_id, advertiser_id FROM CALBRIDGE_PROD.APP.client_migration_map WHERE client_id = ?',
          [clientId]
        )
      );
      if (map && map.length) {
        req.session.agencyId     = map[0].AGENCY_ID     || null;
        req.session.managerId    = map[0].MANAGER_ID    || null;
        req.session.advertiserId = map[0].ADVERTISER_ID || null;
        await new Promise(r => req.session.save(r));
      } else if (map) {
        // No mapping found — set managerId sentinel so we stop querying
        req.session.managerId = null;
        await new Promise(r => req.session.save(r));
      }
    } catch (e) {
      // Non-fatal — clientId-based auth still works for all existing routes
    }
  }

  // Plan lookup with 5-minute Redis cache
  try {
    const planKey = cacheKey('sfcache:plan', clientId);

    // L1: check session cache first (sub-millisecond, no Redis hop)
    const sessionCache = req.session.planCache;
    if (sessionCache && sessionCache.plan && (Date.now() - sessionCache.fetchedAt) < PLAN_CACHE_TTL_MS) {
      req.userPlan = sessionCache.plan;
      return next();
    }

    // L2: Redis + Snowflake fallback via cachedQuery
    const rows = await cachedQuery(planKey, PLAN_CACHE_TTL_MS, () =>
      query(
        'SELECT subscription_plan FROM CALBRIDGE_PROD.APP.clients WHERE client_id = ?',
        [clientId]
      )
    );

    const raw  = rows[0]?.SUBSCRIPTION_PLAN || rows[0]?.subscription_plan || null;
    const plan = VALID_PLANS.has(raw) ? raw : 'free';

    // Populate session cache so subsequent requests on same session skip Redis too
    req.session.planCache = { plan, fetchedAt: Date.now() };
    req.userPlan = plan;
  } catch (e) {
    // Non-fatal — default to most restrictive plan on DB error
    req.userPlan = req.session.planCache?.plan || 'free';
  }

  next();
}

module.exports = { requireAuth };
