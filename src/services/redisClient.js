/**
 * src/services/redisClient.js
 *
 * Shared ioredis client for query caching.
 * Uses the same Redis instance as the session store.
 *
 * Falls back gracefully: if Redis is unavailable, operations are no-ops
 * so the app continues to function (just without caching).
 */

'use strict';

const Redis = require('ioredis');

let _client = null;

function getClient() {
  if (_client) return _client;

  _client = new Redis({
    host:                 process.env.REDIS_HOST || '127.0.0.1',
    port:                 parseInt(process.env.REDIS_PORT || '6379', 10),
    lazyConnect:          true,
    retryStrategy:        (times) => Math.min(times * 100, 3000),
    maxRetriesPerRequest: 3,
    enableReadyCheck:     false,
  });

  _client.on('error', (err) => {
    // Suppress noisy connection errors — cache is best-effort
    if (err.code !== 'ECONNREFUSED') {
      console.warn('[Redis/queryCache] Error:', err.message);
    }
  });

  return _client;
}

module.exports = { getClient };
