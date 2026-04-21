'use strict';

/**
 * requirePlan — feature gating middleware factory for Calbridge plan enforcement.
 *
 * Plan hierarchy:
 *   free     → read-only, 1 connection, 30-day data, no decisions, no AI chat
 *   starter  → vendor reports, 90-day data, 2 connections, budget tracking
 *   growth   → decisions + AI chat, 365-day data, all connections, budget automation, smart alerts, dayparting
 *   pro      → campaign creation, portfolio budgets, anomaly detection, API access, 3-year data
 *   agency   → everything in pro + white-label, multi-brand portal, client access
 *
 * Usage in routes:
 *   router.post('/decisions/execute/:id', requireAuth, requirePlan('decisions'), handler)
 *   router.post('/chat', requireAuth, requirePlan('aiChat'), handler)
 */

const { query } = require('../services/snowflakeService');

// ─── Plan definitions ─────────────────────────────────────────────────────────

const PLAN_LIMITS = {
  free: {
    decisions:          false,
    aiChat:             false,
    vendorReports:      false,
    budgetAutomation:   false,
    smartAlerts:        false,
    campaignCreation:   false,
    portfolioBudgets:   false,
    apiAccess:          false,
    whiteLabel:         false,
    multiBrand:         false,
    dataWindowDays:     30,
    connections:        1,
    teamSeats:          1,
  },
  starter: {
    decisions:          false,
    aiChat:             false,
    vendorReports:      true,
    budgetAutomation:   false,
    smartAlerts:        false,
    campaignCreation:   false,
    portfolioBudgets:   false,
    apiAccess:          false,
    whiteLabel:         false,
    multiBrand:         false,
    dataWindowDays:     90,
    connections:        2,
    teamSeats:          3,
  },
  growth: {
    decisions:          true,
    aiChat:             true,
    vendorReports:      true,
    budgetAutomation:   true,
    smartAlerts:        true,
    campaignCreation:   false,
    portfolioBudgets:   false,
    apiAccess:          false,
    whiteLabel:         false,
    multiBrand:         false,
    dataWindowDays:     365,
    connections:        999,
    teamSeats:          5,
  },
  pro: {
    decisions:          true,
    aiChat:             true,
    vendorReports:      true,
    budgetAutomation:   true,
    smartAlerts:        true,
    campaignCreation:   true,
    portfolioBudgets:   true,
    apiAccess:          true,
    whiteLabel:         false,
    multiBrand:         false,
    dataWindowDays:     1095,
    connections:        999,
    teamSeats:          999,
  },
  agency: {
    decisions:          true,
    aiChat:             true,
    vendorReports:      true,
    budgetAutomation:   true,
    smartAlerts:        true,
    campaignCreation:   true,
    portfolioBudgets:   true,
    apiAccess:          true,
    whiteLabel:         true,
    multiBrand:         true,
    dataWindowDays:     1095,
    connections:        999,
    teamSeats:          999,
  },
};

// Human-readable minimum plan required per feature
const FEATURE_MIN_PLAN = {
  decisions:          'growth',
  aiChat:             'growth',
  vendorReports:      'starter',
  budgetAutomation:   'growth',
  smartAlerts:        'growth',
  campaignCreation:   'pro',
  portfolioBudgets:   'pro',
  apiAccess:          'pro',
  whiteLabel:         'agency',
  multiBrand:         'agency',
};

// Human-readable feature descriptions for upgrade messages
const FEATURE_MESSAGES = {
  decisions:          'AI-powered bid optimization requires Growth plan or above.',
  aiChat:             'AI chat assistant requires Growth plan or above.',
  vendorReports:      'Vendor analytics require Starter plan or above.',
  budgetAutomation:   'Budget automation requires Growth plan or above.',
  smartAlerts:        'Smart alerts require Growth plan or above.',
  campaignCreation:   'Smart campaign creation requires Pro plan or above.',
  portfolioBudgets:   'Portfolio budget management requires Pro plan or above.',
  apiAccess:          'API access requires Pro plan or above.',
  whiteLabel:         'White-label branding requires Agency plan.',
  multiBrand:         'Multi-brand portal requires Agency plan.',
};

// Cache TTL: 5 minutes
const PLAN_CACHE_TTL_MS = 5 * 60 * 1000;

// ─── Plan lookup (with session cache) ────────────────────────────────────────

/**
 * Look up the subscription_plan for a client, with a 5-minute session cache.
 * Returns the plan string (defaulting to 'free' if null/unknown).
 */
async function lookupPlan(req) {
  const clientId = req.session?.clientId;
  if (!clientId) return 'free';

  // Check session cache
  const cache = req.session.planCache;
  if (cache && cache.plan && (Date.now() - cache.fetchedAt) < PLAN_CACHE_TTL_MS) {
    return cache.plan;
  }

  // Fetch from DB
  try {
    const rows = await query(
      'SELECT subscription_plan, linked_client_id FROM CALBRIDGE_PROD.APP.clients WHERE client_id = ?',
      [clientId]
    );
    let raw = rows[0]?.SUBSCRIPTION_PLAN || rows[0]?.subscription_plan || null;

    // Team members inherit their parent account's plan
    if (!PLAN_LIMITS[raw]) {
      const parentId = rows[0]?.LINKED_CLIENT_ID || rows[0]?.linked_client_id;
      if (parentId) {
        const parentRows = await query(
          'SELECT subscription_plan FROM CALBRIDGE_PROD.APP.clients WHERE client_id = ?',
          [parentId]
        );
        raw = parentRows[0]?.SUBSCRIPTION_PLAN || parentRows[0]?.subscription_plan || null;
      }
    }

    const plan = PLAN_LIMITS[raw] ? raw : 'free';

    // Store in session cache
    req.session.planCache = { plan, fetchedAt: Date.now() };
    // Attach to request too (non-blocking save)
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

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  requirePlan,
  lookupPlan,
  PLAN_LIMITS,
  FEATURE_MIN_PLAN,
};
