/**
 * Recommendations API — /recommendations
 *
 * Wraps the decision engine to provide structured recommendation summaries.
 * Recommendations are derived in real-time from CM + advertising data.
 *
 * Priority levels:
 *   critical   — losing money, immediate action required
 *   warning    — at risk, action recommended soon
 *   opportunity — could improve profitability with action
 */
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/requireAuth');
const { analyze } = require('../services/decisionEngine');

/**
 * GET /recommendations/summary
 * Returns a summary of recommendations for the logged-in client.
 * Groups by priority: critical / warning / opportunity.
 */
router.get('/summary', requireAuth, async (req, res, next) => {
  try {
    const days = Number(req.query.days) || 30;
    const clientId = req.session.clientId;

    let insights = [];
    try {
      const result = await analyze(clientId, days);
      insights = result?.insights || result?.recommendations || result?.alerts || [];
      if (!Array.isArray(insights)) insights = [];
    } catch (err) {
      // Decision engine failure is non-fatal — return empty set
      console.warn('[Recommendations] Decision engine error:', err.message);
    }

    // Group by priority
    const critical    = insights.filter(i => i.priority === 'critical'     || i.severity === 'critical');
    const warnings    = insights.filter(i => i.priority === 'warning'      || i.severity === 'warning');
    const opportunities = insights.filter(i => i.priority === 'opportunity' || i.type === 'opportunity' || i.type === 'invest');

    res.json({
      days,
      total:        insights.length,
      critical:     critical.length,
      warnings:     warnings.length,
      opportunities: opportunities.length,
      items: {
        critical,
        warnings,
        opportunities,
      },
      // Flat list sorted by priority (critical first)
      all: [
        ...critical,
        ...warnings,
        ...opportunities,
        ...insights.filter(i =>
          !critical.includes(i) && !warnings.includes(i) && !opportunities.includes(i)
        ),
      ],
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /recommendations
 * Full recommendation list (alias for /summary).
 */
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const days = Number(req.query.days) || 30;
    const result = await analyze(req.session.clientId, days);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
