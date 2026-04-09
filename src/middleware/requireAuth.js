const { query } = require('../services/snowflakeService');

/**
 * Middleware: require an authenticated session.
 * Attach to any route that needs a logged-in client.
 *
 * Phase 3F: Also lazy-loads agencyId/managerId/advertiserId from client_migration_map
 * for sessions that have clientId but not yet the new account context.
 * clientId remains primary — this is backward compatible.
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

  next();
}

module.exports = { requireAuth };
