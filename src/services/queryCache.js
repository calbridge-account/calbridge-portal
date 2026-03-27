/**
 * src/services/queryCache.js
 *
 * Lightweight in-memory query result cache.
 * Prevents redundant Snowflake round-trips when multiple users hit the same
 * endpoint with identical parameters within a short window.
 *
 * Design:
 *   - Keys are built from (clientId, route, params) — each client's data is isolated
 *   - Default TTL: 60 seconds (enough for a demo / small team, fresh enough for real use)
 *   - No external dependencies — plain JS Map
 *   - Automatically evicts expired entries on each get/set to keep memory bounded
 *
 * Usage:
 *   const { cachedQuery } = require('../services/queryCache');
 *   const rows = await cachedQuery(cacheKey, ttlMs, () => query(sql, params));
 */

'use strict';

const cache = new Map();

const DEFAULT_TTL_MS = 60_000; // 60 seconds

/**
 * Build a cache key from an array of values.
 * @param  {...any} parts
 * @returns {string}
 */
function cacheKey(...parts) {
  return parts.map(p => (p == null ? '' : String(p))).join('|');
}

/**
 * Return a cached result if fresh, otherwise call fetchFn, cache and return its result.
 *
 * @param {string}   key      - Cache key (use cacheKey() helper)
 * @param {number}   ttlMs    - Time-to-live in milliseconds (default 60s)
 * @param {Function} fetchFn  - Async function that returns the data to cache
 * @returns {Promise<any>}
 */
async function cachedQuery(key, ttlMs = DEFAULT_TTL_MS, fetchFn) {
  evictExpired();

  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < ttlMs) {
    return hit.data;
  }

  const data = await fetchFn();
  cache.set(key, { data, ts: Date.now() });
  return data;
}

/**
 * Invalidate all cache entries for a specific client.
 * Call this after a manual sync to ensure the next load is fresh.
 * @param {string} clientId
 */
function invalidateClient(clientId) {
  for (const key of cache.keys()) {
    if (key.startsWith(clientId + '|')) {
      cache.delete(key);
    }
  }
}

/**
 * Invalidate a specific cache key.
 * @param {string} key
 */
function invalidate(key) {
  cache.delete(key);
}

/**
 * Remove all entries whose TTL has expired.
 * Called automatically on every get/set — no separate cleanup timer needed.
 */
function evictExpired() {
  const now = Date.now();
  for (const [key, entry] of cache.entries()) {
    if (now - entry.ts > DEFAULT_TTL_MS * 10) { // evict anything >10 TTLs old
      cache.delete(key);
    }
  }
}

/**
 * Return current cache stats (for debugging / ash-ops dashboard).
 */
function stats() {
  return { size: cache.size, keys: [...cache.keys()] };
}

module.exports = { cachedQuery, cacheKey, invalidateClient, invalidate, stats, DEFAULT_TTL_MS };
