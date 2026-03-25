/**
 * Plan enforcement middleware for Calbridge tier gating.
 *
 * Tiers:
 *   starter    ($499/mo)  — 1 brand, no DSP, no client portal, no API
 *   pro        ($999/mo)  — up to 10 brands, client portal
 *   scale      ($1,999/mo)— unlimited brands, DSP, white-label
 *   enterprise (custom)   — unlimited, all features + API access
 */

const PLAN_LIMITS = {
  starter:    { brands: 1,        dsp: false, whiteLabel: false, clientPortal: false, api: false },
  pro:        { brands: 10,       dsp: false, whiteLabel: false, clientPortal: true,  api: false },
  scale:      { brands: Infinity, dsp: true,  whiteLabel: true,  clientPortal: true,  api: false },
  enterprise: { brands: Infinity, dsp: true,  whiteLabel: true,  clientPortal: true,  api: true  },
};

/**
 * Get the feature limits for a given plan name.
 * Falls back to starter limits for unrecognised plan strings.
 */
function getPlanLimits(plan) {
  return PLAN_LIMITS[plan] || PLAN_LIMITS.starter;
}

/**
 * Express middleware factory — block access if the client's plan
 * does not include the specified boolean feature.
 *
 * Usage: router.get('/dsp-report', requireFeature('dsp'), handler)
 */
function requireFeature(feature) {
  return (req, res, next) => {
    // Plan is stored on req.session.client.plan once the /auth/me enrichment runs,
    // but may also be present directly on the session for older flows.
    // TODO: Standardise to req.session.client.plan once auth/me is updated.
    const plan = req.session?.client?.plan || req.session?.clientPlan || 'starter';
    const limits = getPlanLimits(plan);
    if (!limits[feature]) {
      return res.status(403).json({
        error:   'PLAN_LIMIT',
        message: `This feature requires a higher plan. Current plan: ${plan}`,
        feature,
        upgrade: true,
      });
    }
    next();
  };
}

/**
 * Express middleware — enforce per-plan brand count limit before brand creation.
 *
 * Usage: router.post('/brands', checkBrandLimit, createBrandHandler)
 */
async function checkBrandLimit(req, res, next) {
  try {
    const { query } = require('../services/snowflakeService');
    const plan = req.session?.client?.plan || req.session?.clientPlan || 'starter';
    const limits = getPlanLimits(plan);
    const clientId = req.session?.clientId || req.session?.client?.id;

    if (!clientId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Unlimited plans skip the count check
    if (limits.brands === Infinity) return next();

    const rows = await query(
      'SELECT COUNT(*) AS cnt FROM brands WHERE client_id = ? AND is_active = TRUE',
      [clientId]
    );
    const count = Number(rows[0]?.CNT || 0);

    if (count >= limits.brands) {
      return res.status(403).json({
        error:   'BRAND_LIMIT',
        message: `Your ${plan} plan allows up to ${limits.brands} brand${limits.brands === 1 ? '' : 's'}. Upgrade to add more.`,
        current: count,
        limit:   limits.brands,
        upgrade: true,
      });
    }

    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { getPlanLimits, requireFeature, checkBrandLimit, PLAN_LIMITS };
