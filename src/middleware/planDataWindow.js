'use strict';

/**
 * planDataWindow — injects req.planDataWindowDays into every authenticated request.
 *
 * Routes use this value to cap their Snowflake date range queries so that free/starter
 * clients cannot access more historical data than their plan allows.
 *
 * Data window by plan:
 *   free    →  30 days
 *   starter →  90 days
 *   growth  → 365 days
 *   pro     → 730 days
 *
 * Usage:
 *   // Mount globally after requireAuth in app.js, or per-router:
 *   router.use(requireAuth, planDataWindow);
 *
 *   // Inside a route handler, cap the requested date range:
 *   const { startDate, endDate } = capDateRange(req.query.start, req.query.end, req.planDataWindowDays);
 */

const { lookupPlan, PLAN_LIMITS } = require('./requirePlan');

// ─── Middleware ───────────────────────────────────────────────────────────────

/**
 * Express middleware that resolves the client's plan and attaches
 * req.planDataWindowDays (number of days). Call after requireAuth.
 */
async function planDataWindow(req, res, next) {
  if (!req.session?.clientId) {
    // Not authenticated — no-op; requireAuth handles the 401
    return next();
  }

  try {
    const plan    = await lookupPlan(req);
    const limits  = PLAN_LIMITS[plan] || PLAN_LIMITS.free;
    req.userPlan           = plan;
    req.planDataWindowDays = limits.dataWindowDays;
    next();
  } catch (err) {
    // Non-fatal — fall back to the most restrictive window
    req.planDataWindowDays = PLAN_LIMITS.free.dataWindowDays;
    next();
  }
}

// ─── Helper ───────────────────────────────────────────────────────────────────

/**
 * capDateRange — cap a requested [startDate, endDate] range to the plan's data window.
 *
 * If startDate is before (endDate - maxDays), it is pushed forward so that the
 * total span never exceeds maxDays. endDate is left unchanged (callers may further
 * clamp it to today if needed).
 *
 * @param {string|Date} startDate   Requested start date (ISO string or Date object)
 * @param {string|Date} endDate     Requested end date   (ISO string or Date object)
 * @param {number}      maxDays     Maximum allowed window in days (from req.planDataWindowDays)
 * @returns {{ startDate: Date, endDate: Date, capped: boolean }}
 *   capped=true means startDate was moved forward to enforce the limit.
 */
function capDateRange(startDate, endDate, maxDays) {
  const end   = endDate   instanceof Date ? endDate   : new Date(endDate);
  let   start = startDate instanceof Date ? startDate : new Date(startDate);

  if (isNaN(end.getTime()))   throw new Error('capDateRange: invalid endDate');
  if (isNaN(start.getTime())) throw new Error('capDateRange: invalid startDate');

  const maxMs      = maxDays * 24 * 60 * 60 * 1000;
  const earliestOk = new Date(end.getTime() - maxMs);

  const capped = start < earliestOk;
  if (capped) start = earliestOk;

  return { startDate: start, endDate: end, capped };
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  planDataWindow,
  capDateRange,
};
