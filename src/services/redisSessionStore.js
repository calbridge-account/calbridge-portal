/**
 * src/services/redisSessionStore.js
 *
 * Redis-backed session store using connect-redis + ioredis.
 * Replaces SnowflakeSessionStore to eliminate session queries from Snowflake
 * (was keeping CALBRIDGE_WH warm 24/7 and burning ~200 credits/month).
 *
 * Falls back to SnowflakeStore if Redis is unavailable at startup.
 *
 * Redis key format: sess:{sid}
 * TTL: matches cookie maxAge (7 days default)
 */

'use strict';

const Redis        = require('ioredis');
const { RedisStore } = require('connect-redis');

let _redisClient = null;
let _store       = null;

function getRedisClient() {
  if (_redisClient) return _redisClient;
  _redisClient = new Redis({
    host:           process.env.REDIS_HOST || '127.0.0.1',
    port:           parseInt(process.env.REDIS_PORT || '6379', 10),
    lazyConnect:    true,
    retryStrategy:  (times) => Math.min(times * 100, 3000),
    maxRetriesPerRequest: 3,
    enableReadyCheck: false,
  });
  _redisClient.on('error', (err) => {
    // Log but don't crash — connect-redis handles reconnection
    if (!err.message?.includes('ECONNREFUSED')) {
      console.warn('[RedisSession] Redis error:', err.message?.slice(0, 100));
    }
  });
  _redisClient.on('connect', () => console.log('[RedisSession] Connected to Redis'));
  return _redisClient;
}

/**
 * Build the session store.
 * Returns a Redis-backed store, or falls back to SnowflakeStore if Redis unreachable.
 *
 * @param {object} session - express-session instance
 * @returns {object} session store
 */
async function buildSessionStore(session) {
  const redis = getRedisClient();

  try {
    await redis.connect();
    await redis.ping(); // confirm it's actually up

    _store = new RedisStore({
      prefix:      'sess:',
      ttl:         7 * 24 * 60 * 60,  // 7 days in seconds
      disableTouch: false,
    });

    console.log('[RedisSession] ✅ Using Redis session store');

    // One-time migration: copy existing Snowflake sessions to Redis
    // so active users aren't logged out on first deploy
    migrateSnowflakeSessions(redis).catch(e =>
      console.warn('[RedisSession] Session migration warning (non-fatal):', e.message?.slice(0, 80))
    );

    return _store;

  } catch (err) {
    console.warn('[RedisSession] ⚠️  Redis unavailable, falling back to Snowflake session store:', err.message?.slice(0, 80));
    const SnowflakeStore = require('./snowflakeSessionStore');
    return new SnowflakeStore();
  }
}

// ─── One-time Snowflake → Redis session migration ────────────────────────────
async function migrateSnowflakeSessions(redis) {
  try {
    const { query } = require('./snowflakeService');
    const rows = await query(
      `SELECT sid, sess, expired_at FROM CALBRIDGE_PROD.APP.sessions WHERE expired_at > CURRENT_TIMESTAMP`
    );
    if (!rows.length) return;

    let migrated = 0;
    for (const row of rows) {
      const sid      = row.SID || row.sid;
      const sessData = row.SESS || row.sess;
      const expiry   = row.EXPIRED_AT || row.expired_at;

      if (!sid || !sessData) continue;

      const sess   = typeof sessData === 'string' ? JSON.parse(sessData) : sessData;
      const ttlMs  = new Date(expiry).getTime() - Date.now();
      const ttlSec = Math.max(60, Math.floor(ttlMs / 1000));

      await redis.setex(`sess:${sid}`, ttlSec, JSON.stringify(sess));
      migrated++;
    }
    if (migrated > 0) console.log(`[RedisSession] Migrated ${migrated} session(s) from Snowflake → Redis`);
  } catch (err) {
    // Non-fatal — users just need to log in again
    console.warn('[RedisSession] Session migration failed:', err.message?.slice(0, 80));
  }
}

module.exports = { buildSessionStore, getRedisClient };
