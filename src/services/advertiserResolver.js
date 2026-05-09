/**
 * advertiserResolver.js
 *
 * Resolves the effective clientId and marketplace for data queries when an advertiser has been
 * explicitly switched in the manager/nav selector.
 *
 * Bridge approach (Phase 3H):
 *   - Looks up advertiser_id → client_id via client_migration_map
 *   - Falls back to req.session.clientId for backward compatibility
 *   - Phase 3I will re-key all data tables to advertiser_id directly
 */

const { query } = require('./snowflakeService');

/**
 * Resolve the effective clientId for data queries.
 * If an advertiserId is in session (from the nav selector switch), look up
 * its clientId from client_migration_map. Falls back to session.clientId for
 * backward compat.
 *
 * @param {import('express').Request} req
 * @returns {Promise<string>}
 */
// Admin accounts have no direct advertiser mapping — default them to CyberPower
// so the admin can view live data. Remove once a proper impersonation UI exists.
const ADMIN_DEFAULT_CLIENT_ID = '7d88ea17-002b-4a02-97fc-bcab1292d57e'; // CyberPower
const ADMIN_CLIENT_IDS = new Set(['abe-admin-001']);

async function resolveClientId(req) {
  const advertiserId = req.session.activeAdvertiserId || req.session.advertiserId;
  if (advertiserId) {
    try {
      const rows = await query(
        'SELECT client_id FROM CALBRIDGE_PROD.APP.client_migration_map WHERE advertiser_id = ?',
        [advertiserId]
      );
      if (rows.length) return rows[0].CLIENT_ID || rows[0].client_id;
    } catch (e) {
      // Fall through to session.clientId on any Snowflake error
    }
  }
  // Admin default: only apply when session.clientId is literally the admin account
  // (not a brand session — switch-brand changes clientId away from abe-admin-001)
  if (req.session.clientId === 'abe-admin-001') return ADMIN_DEFAULT_CLIENT_ID;
  return req.session.clientId;
}

/**
 * Resolve the active marketplace for data queries.
 * Returns the marketplace set in session via POST /manager/set-marketplace,
 * or 'US' as default. 'all' means no filter should be applied.
 *
 * @param {import('express').Request} req
 * @returns {string}
 */
function resolveMarketplace(req) {
  return req.session.activeMarketplace || 'US';
}

module.exports = { resolveClientId, resolveMarketplace };
