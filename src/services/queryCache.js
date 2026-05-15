/**
 * src/services/queryCache.js
 *
 * Two-tier query result cache: L1 in-memory + L2 Redis.
 *
 * L1 (in-memory Map): sub-millisecond hits within a single process.
 * L2 (Redis): shared across dynos/restarts; survives pm2 restarts.
 *
 * Design:
 *   - Keys are built from (clientId, route, params) via cacheKey()
 *   - Default TTL: 5 minutes (300s) — ad data updates at most once/day
 *   - Redis TTL: 10 minutes (600s) for expensive dashboard queries
 *   - Falls back to in-memory-only if Redis is unavailable
 *   - invalidateClient() purges both L1 and L2 for a client prefix
 *
 * Usage:
 *   const { cachedQuery, cacheKey } = require('../services/queryCache');
 *   const rows = await cachedQuery(key, ttlMs, () => query(sql, params));
 */

'use strict';

const { getClient } = require('./redisClient');

// ── L1: in-memory ────────────────────────────────────────────────────────────
const _cache = new Map();

const DEFAULT_TTL_MS = 300_000; // 5 minutes

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a cache key from an array of values.
 * @param  {...any} parts
 * @returns {string}
 */
function cacheKey(...parts) {
  return parts.map(p => (p == null ? '' : String(p))).join('|');
}

/**
 * Evict expired in-memory entries.
 * Called on every get/set — no separate timer needed.
 */
function evictExpired() {
  const now = Date.now();
  for (const [key, entry] of _cache.entries()) {
    if (now - entry.ts > entry.ttlMs * 10) {
      _cache.delete(key);
    }
  }
}

// ── core API ─────────────────────────────────────────────────────────────────

/**
 * Return a cached result if fresh, otherwise call fetchFn, cache and return.
 *
 * @param {string}   key      - Cache key (use cacheKey() helper)
 * @param {number}   ttlMs    - Time-to-live in milliseconds (default 5min)
 * @param {Function} fetchFn  - Async function returning data to cache
 * @returns {Promise<any>}
 */
async function cachedQuery(key, ttlMs = DEFAULT_TTL_MS, fetchFn) {
  evictExpired();

  // ── L1 hit ────────────────────────────────────────────────────────────────
  const l1 = _cache.get(key);
  if (l1 && Date.now() - l1.ts < ttlMs) {
    return l1.data;
  }

  // ── L2 hit (Redis) ────────────────────────────────────────────────────────
  const redis = getClient();
  try {
    const raw = await redis.get(`qcache:${key}`);
    if (raw) {
      const data = JSON.parse(raw);
      // Promote to L1
      _cache.set(key, { data, ts: Date.now(), ttlMs });
      return data;
    }
  } catch { /* Redis unavailable — fall through to fetch */ }

  // ── Miss: fetch, write both layers ────────────────────────────────────────
  const data = await fetchFn();

  // Write L1
  _cache.set(key, { data, ts: Date.now(), ttlMs });

  // Write L2 (best-effort — don't await to avoid blocking the response)
  const ttlSeconds = Math.ceil(ttlMs / 1000);
  redis.set(`qcache:${key}`, JSON.stringify(data), 'EX', ttlSeconds).catch(() => {});

  return data;
}

/**
 * Invalidate all cache entries for a specific client.
 * Purges L1 (prefix scan) and L2 (Redis SCAN + DEL).
 * Call after manual sync or ingest completion.
 * @param {string} clientId
 */
async function invalidateClient(clientId) {
  // L1 purge
  const prefix = `${clientId}|`;
  for (const key of _cache.keys()) {
    if (key.startsWith(prefix) || key === clientId) {
      _cache.delete(key);
    }
  }

  // L2 purge — SCAN for matching keys then DEL in one batch
  const redis = getClient();
  try {
    const pattern = `qcache:${clientId}|*`;
    let cursor = '0';
    const toDelete = [];
    do {
      const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      toDelete.push(...keys);
      cursor = nextCursor;
    } while (cursor !== '0');

    if (toDelete.length) {
      await redis.del(...toDelete);
      console.log(`[QueryCache] Invalidated ${toDelete.length} Redis keys for client ${clientId}`);
    }
  } catch { /* Redis unavailable — L1 purge was enough */ }
}

/**
 * Invalidate a specific cache key in both L1 and L2.
 * @param {string} key
 */
async function invalidate(key) {
  _cache.delete(key);
  const redis = getClient();
  try { await redis.del(`qcache:${key}`); } catch {}
}

/**
 * Return current in-memory cache stats (for debugging).
 */
function stats() {
  return { size: _cache.size, keys: [..._cache.keys()] };
}

module.exports = { cachedQuery, cacheKey, invalidateClient, invalidate, stats, DEFAULT_TTL_MS };
