'use strict';

/**
 * requirePlan — feature gating middleware factory for Calbridge plan enforcement.
 *
 * Plan hierarchy:
 *   free     → read-only, 1 connection, 30-day data, no decisions, no AI chat
 *   starter  → vendor reports, manual recommendations, 90-day data, 2 connections
 *   growth   → decisions + AI chat + dayparting, 365-day data, all connections, budget automation, smart alerts
 *   pro      → campaign creation, portfolio budgets, anomaly detection, reporting download, API access, 3-year data
 *   agency   → everything in pro + white-label, multi-brand portal, client access
 *
 * Usage in routes:
 *   router.post('/decisions/execute/:id', requireAuth, requirePlan('decisions'), handler)
 *   router.post('/chat', requireAuth, requirePlan('aiChat'), handler)
 */

const { query } = require('../services/snowflakeService');
const { cachedQuery, cacheKey } = require('../services/queryCache');

// ─── Plan definitions ─────────────────────────────────────────────────────────

const PLAN_LIMITS = {
  free: {
    manualRecommendations:  false,
    decisions:              false,
    aiChat:                 false,
    vendorReports:          false,
    budgetAutomation:       false,
    smartAlerts:            false,
    dayparting:             false,
    campaignCreation:       false,
    portfolioBudgets:       false,
    reportingDownload:      false,
    anomalyDetection:       false,
    apiAccess:              false,
    whiteLabel:             false,
    multiBrand:             false,
    dataWindowDays:         30,
    connections:            1,
    teamSeats:              1,
  },
  starter: {
    manualRecommendations:  true,
    decisions:              false,
    aiChat:                 false,
    vendorReports:          true,
    budgetAutomation:       false,
    smartAlerts:            false,
    dayparting:             false,
    campaignCreation:       false,
    portfolioBudgets:       false,
    reportingDownload:      false,
    anomalyDetection:       false,
    apiAccess:              false,
    whiteLabel:             false,
    multiBrand:             false,
    dataWindowDays:         90,
    connections:            2,
    teamSeats:              3,
  },
  growth: {
    manualRecommendations:  true,
    decisions:              true,
    aiChat:                 true,
    vendorReports:          true,
    budgetAutomation:       true,
    smartAlerts:            true,
    dayparting:             true,
    campaignCreation:       false,
    portfolioBudgets:       false,
    reportingDownload:      false,
    anomalyDetection:       false,
    apiAccess:              false,
    whiteLabel:             false,
    multiBrand:             false,
    dataWindowDays:         365,
    connections:            999,
    teamSeats:              5,
  },
  pro: {
    manualRecommendations:  true,
    decisions:              true,
    aiChat:                 true,
    vendorReports:          true,
    budgetAutomation:       true,
    smartAlerts:            true,
    dayparting:             true,
    campaignCreation:       true,
    portfolioBudgets:       true,
    reportingDownload:      true,
    anomalyDetection:       true,
    apiAccess:              true,
    whiteLabel:             false,
    multiBrand:             false,
    dataWindowDays:         1095,
    connections:            999,
    teamSeats:              999,
  },
  agency: {
    manualRecommendations:  true,
    decisions:              true,
    aiChat:                 true,
    vendorReports:          true,
    budgetAutomation:       true,
    smartAlerts:            true,
    dayparting:             true,
    campaignCreation:       true,
    portfolioBudgets:       true,
    reportingDownload:      true,
    anomalyDetection:       true,
    apiAccess:              true,
    whiteLabel:             true,
    multiBrand:             true,
    dataWindowDays:         1095,
    connections:            999,
    teamSeats:              999,
  },
};

// Human-readable minimum plan required per feature
const FEATURE_MIN_PLAN = {
  manualRecommendations:  'starter',
  decisions:              'growth',
  aiChat:                 'growth',
  vendorReports:          'starter',
  budgetAutomation:       'growth',
  smartAlerts:            'growth',
  dayparting:             'growth',
  campaignCreation:       'pro',
  portfolioBudgets:       'pro',
  reportingDownload:      'pro',
  anomalyDetection:       'pro',
  apiAccess:              'pro',
  whiteLabel:             'agency',
  multiBrand:             'agency',
};

// Human-readable feature descriptions for upgrade messages
const FEATURE_MESSAGES = {
  manualRecommendations:  'Manual recommendations require Starter plan or above.',
  decisions:              'AI-powered bid optimization requires Growth plan or above.',
  aiChat:                 'AI chat assistant requires Growth plan or above.',
  vendorReports:          'Vendor analytics require Starter plan or above.',
  budgetAutomation:       'Budget automation requires Growth plan or above.',
  smartAlerts:            'Smart alerts require Growth plan or above.',
  dayparting:             'Dayparting requires Growth plan or above.',
  campaignCreation:       'Smart campaign creation requires Pro plan or above.',
  portfolioBudgets:       'Portfolio budget management requires Pro plan or above.',
  reportingDownload:      'Report downloads require Pro plan or above.',
  anomalyDetection:       'Anomaly detection requires Pro plan or above.',
  apiAccess:              'API access requires Pro plan or above.',
  whiteLabel:             'White-label branding requires Agency plan.',
  multiBrand:             'Multi-brand portal requires Agency plan.',
};

// Cache TTL: 5 minutes — shared with requireAuth via same Redis key
const PLAN_CACHE_TTL_MS = 5 * 60 * 1000;

// ─── Plan lookup (Redis-backed cache, shared with requireAuth) ───────────────

/**
 * Look up the subscription_plan for a client.
 * Cache hierarchy:
 *   L0: req.session.planCache (in-request session, sub-ms)
 *   L1: queryCache in-memory (same process)
 *   L2: Redis (sfcache:plan:{clientId}, 5 min, shared across restarts)
 *   L3: Snowflake (source of truth)
 *
 * Returns the plan string (defaulting to 'free' if null/unknown).
 */
async function lookupPlan(req) {
  const clientId = req.session?.clientId;
  if (!clientId) return 'free';

  // L0: session cache (prevents repeat Redis hops within the same request lifecycle)
  const cache = req.session.planCache;
  if (cache && cache.plan && (Date.now() - cache.fetchedAt) < PLAN_CACHE_TTL_MS) {
    return cache.plan;
  }

  try {
    const planKey = cacheKey('sfcache:plan', clientId);

    // L1+L2+L3: cachedQuery handles in-memory → Redis → Snowflake
    const rows = await cachedQuery(planKey, PLAN_CACHE_TTL_MS, () =>
      query(
        'SELECT subscription_plan, subscription_status, linked_client_id FROM CALBRIDGE_PROD.APP.clients WHERE client_id = ?',
        [clientId]
      )
    );

    // Immediate lock on payment failure — past_due/paused/cancelled = no paid features
    const subStatus = rows[0]?.SUBSCRIPTION_STATUS || rows[0]?.subscription_status || null;
    if (subStatus === 'past_due' || subStatus === 'paused' || subStatus === 'cancelled') {
      req.session.planCache = { plan: 'free', fetchedAt: Date.now() };
      req.userPlan = 'free';
      return 'free';
    }

    let raw = rows[0]?.SUBSCRIPTION_PLAN || rows[0]?.subscription_plan || null;

    // Team members inherit their parent account's plan
    if (!PLAN_LIMITS[raw]) {
      const parentId = rows[0]?.LINKED_CLIENT_ID || rows[0]?.linked_client_id;
      if (parentId) {
        const parentKey = cacheKey('sfcache:plan', parentId);
        const parentRows = await cachedQuery(parentKey, PLAN_CACHE_TTL_MS, () =>
          query(
            'SELECT subscription_plan FROM CALBRIDGE_PROD.APP.clients WHERE client_id = ?',
            [parentId]
          )
        );
        raw = parentRows[0]?.SUBSCRIPTION_PLAN || parentRows[0]?.subscription_plan || null;
      }
    }

    const plan = PLAN_LIMITS[raw] ? raw : 'free';

    // Populate session cache so subsequent calls in this session skip Redis
    req.session.planCache = { plan, fetchedAt: Date.now() };
    req.userPlan = plan;

    return plan;
  } catch (err) {
    // Non-fatal — default to 'free' on DB error
    console.warn('[requirePlan] plan lookup failed, defaulting to free:', err.message);
    return 'free';
  }
}

// ─── Middleware factory ───────────────────────────────────────────────────────

/**
 * requirePlan(feature) → Express middleware
 *
 * Blocks the request with 403 if the authenticated client's plan does not
 * include the specified feature. Call after requireAuth.
 *
 * @param {string} feature  Key from PLAN_LIMITS (e.g. 'decisions', 'aiChat', 'vendorReports')
 */
function requirePlan(feature) {
  return async (req, res, next) => {
    if (!req.session?.clientId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    try {
      const plan   = await lookupPlan(req);
      const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;

      if (limits[feature] === false) {
        const requiredPlan = FEATURE_MIN_PLAN[feature] || 'growth';
        const message      = FEATURE_MESSAGES[feature] || `This feature requires the ${requiredPlan} plan or above.`;

        return res.status(403).json({
          error:        'upgrade_required',
          feature,
          requiredPlan,
          message,
        });
      }

      // Feature is allowed — attach plan info to request and continue
      req.userPlan = plan;
      next();
    } catch (err) {
      next(err);
    }
  };
}

// ─── Brand / connection limit helpers ───────────────────────────────────────

/**
 * getPlanLimits(plan) → PLAN_LIMITS entry
 * Convenience wrapper so callers don't need to import PLAN_LIMITS directly.
 */
function getPlanLimits(plan) {
  return PLAN_LIMITS[plan] || PLAN_LIMITS.free;
}

/**
 * checkBrandLimit — Express middleware
 * Blocks brand/connection creation when the client has reached their plan limit.
 * Uses the `brands` table (is_active = TRUE count per client).
 */
async function checkBrandLimit(req, res, next) {
  try {
    const plan   = await lookupPlan(req);
    const limits = getPlanLimits(plan);
    const clientId = req.session?.clientId || req.session?.client?.id;

    if (!clientId) return res.status(401).json({ error: 'Unauthorized' });

    // Unlimited plans skip the count check
    if (limits.connections >= 999) return next();

    const rows = await query(
      'SELECT COUNT(*) AS cnt FROM brands WHERE client_id = ? AND is_active = TRUE',
      [clientId]
    );
    const count = Number(rows[0]?.CNT || rows[0]?.cnt || 0);

    if (count >= limits.connections) {
      return res.status(403).json({
        error:   'CONNECTION_LIMIT',
        message: `Your ${plan} plan allows up to ${limits.connections} connection${
          limits.connections === 1 ? '' : 's'
        }. Upgrade to add more.`,
        current: count,
        limit:   limits.connections,
        upgrade: true,
      });
    }

    next();
  } catch (err) {
    next(err);
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  requirePlan,
  lookupPlan,
  getPlanLimits,
  checkBrandLimit,
  PLAN_LIMITS,
  FEATURE_MIN_PLAN,
};
