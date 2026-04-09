/**
 * advertiserResolver.js
 *
 * Resolves the effective clientId for data queries when an advertiser has been
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
  return req.session.clientId;
}

module.exports = { resolveClientId };
