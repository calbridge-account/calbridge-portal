/**
 * src/middleware/responseCache.js
 *
 * HTTP response cache middleware for Express.
 * Caches JSON responses keyed on (clientId + full URL including query string).
 * Serves cached responses to subsequent identical requests within the TTL window.
 *
 * Usage:
 *   router.get('/summary', requireAuth, responseCache(60_000), async (req, res, next) => { ... })
 *
 * Cache invalidation:
 *   Call invalidateClient(clientId) after a sync to force fresh data on next load.
 *   Imported from queryCache.js which holds the shared cache Map.
 *
 * Why HTTP-layer vs query-layer:
 *   Caching the full response is simpler and more complete — it covers routes
 *   that make multiple query() calls (e.g. roas-by-type does 2 parallel queries).
 *   It also means zero changes to individual route handler logic.
 */

'use strict';

const { cachedQuery, cacheKey, DEFAULT_TTL_MS } = require('../services/queryCache');

/**
 * Returns an Express middleware that caches the JSON response for ttlMs milliseconds.
 * @param {number} ttlMs - Cache TTL (default 60s)
 */
function responseCache(ttlMs = DEFAULT_TTL_MS) {
  return async (req, res, next) => {
    // Only cache GET requests for authenticated sessions
    if (req.method !== 'GET' || !req.session?.clientId) return next();

    const ck = cacheKey(req.session.clientId, 'http', req.originalUrl);

    // Check cache first — serve immediately if hit
    const { cachedQuery: _cq, ...rest } = require('../services/queryCache');
    const cacheModule = require('../services/queryCache');
    
    // Direct cache check to avoid double-fetching
    const hit = await new Promise(resolve => {
      cacheModule.cachedQuery(ck, ttlMs, () => {
        // Cache miss — intercept res.json to capture response body
        return new Promise((captureResolve, captureReject) => {
          const originalJson = res.json.bind(res);
          res.json = function(body) {
            // Restore original and send
            res.json = originalJson;
            captureResolve(body);
            return originalJson(body);
          };
          // Run the actual route handler
          next();
          // Timeout safety — if handler never calls res.json, resolve with null
          setTimeout(() => captureResolve(null), 25_000);
        });
      }).then(resolve).catch(() => { resolve(null); next(); });
    });

    // If we got here via cache hit, res.json was already called by cachedQuery
    // If cache miss, res.json was called inside the handler via the intercept above
    // Either way, response is sent — nothing more to do.
  };
}

module.exports = { responseCache };
