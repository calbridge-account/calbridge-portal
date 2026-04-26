/**
 * SnowflakeSessionStore — express-session Store backed by Snowflake
 *
 * Robust by design: every method wraps errors and calls back gracefully
 * so a Snowflake hiccup never crashes the application.
 */
const session = require('express-session');
const { query } = require('./snowflakeService');

const Store = session.Store;

// Probability of running expired-session cleanup on each `set` call (1%)
const CLEANUP_PROBABILITY = 0.01;

// In-process session cache — avoids Snowflake round-trip on every request
// TTL: 30 seconds (safe; session data doesn't change that fast)
const SESSION_CACHE_TTL_MS = 30_000;
const _sessionCache = new Map(); // sid → { sess, ts }
function _cacheGet(sid) {
  const hit = _sessionCache.get(sid);
  if (hit && Date.now() - hit.ts < SESSION_CACHE_TTL_MS) return hit.sess;
  _sessionCache.delete(sid);
  return null;
}
function _cacheSet(sid, sess) {
  _sessionCache.set(sid, { sess, ts: Date.now() });
}
function _cacheDel(sid) {
  _sessionCache.delete(sid);
}

class SnowflakeStore extends Store {
  constructor(options = {}) {
    super(options);
    this._ensureTable();
  }

  /**
   * Create the sessions table if it doesn't already exist.
   * Non-blocking — errors are logged but don't prevent startup.
   */
  _ensureTable() {
    query(`
      CREATE TABLE IF NOT EXISTS sessions (
        sid        VARCHAR NOT NULL PRIMARY KEY,
        sess       VARIANT NOT NULL,
        expired_at TIMESTAMP NOT NULL
      )
    `).then(() => {
      console.log('[SnowflakeStore] sessions table ready');
    }).catch(err => {
      console.error('[SnowflakeStore] Could not ensure sessions table:', err.message);
    });
  }

  /**
   * Probabilistic cleanup of expired sessions.
   * Called on each `set` at 1% probability to avoid constant overhead.
   */
  _maybeCleanup() {
    if (Math.random() > CLEANUP_PROBABILITY) return;
    query('DELETE FROM sessions WHERE expired_at < CURRENT_TIMESTAMP')
      .catch(err => {
        console.warn('[SnowflakeStore] Cleanup error (non-fatal):', err.message);
      });
  }

  /**
   * get(sid, callback)
   * Fetch a session by ID, only if not expired.
   */
  get(sid, cb) {
    // Serve from in-process cache if fresh — avoids ~1s Snowflake round-trip per request
    const cached = _cacheGet(sid);
    if (cached) return cb(null, cached);

    query(
      'SELECT sess FROM sessions WHERE sid = ? AND expired_at > CURRENT_TIMESTAMP',
      [sid]
    ).then(rows => {
      if (!rows || rows.length === 0) return cb(null, null);
      const raw = rows[0].SESS ?? rows[0].sess;
      // Snowflake VARIANT may come back as already-parsed object or as JSON string
      const sess = typeof raw === 'string' ? JSON.parse(raw) : raw;
      _cacheSet(sid, sess); // cache for next 30s
      cb(null, sess);
    }).catch(err => {
      console.error('[SnowflakeStore] get error (returning null session):', err.message, '| code:', err.code, '| sqlState:', err.sqlState);
      cb(null, null); // fail open — treat as no session
    });
  }

  /**
   * set(sid, session, callback)
   * Create or update a session row.
   */
  set(sid, sess, cb) {
    const maxAge = (sess.cookie && sess.cookie.maxAge)
      ? sess.cookie.maxAge
      : 7 * 24 * 60 * 60 * 1000; // default 7 days
    const expiredAt = new Date(Date.now() + maxAge).toISOString();
    const sessJson = JSON.stringify(sess);

    const t = Date.now();
    query(
      `MERGE INTO sessions AS tgt
       USING (SELECT ? AS sid, PARSE_JSON(?) AS sess, ?::TIMESTAMP AS expired_at) AS src
         ON tgt.sid = src.sid
       WHEN MATCHED THEN
         UPDATE SET tgt.sess = src.sess, tgt.expired_at = src.expired_at
       WHEN NOT MATCHED THEN
         INSERT (sid, sess, expired_at) VALUES (src.sid, src.sess, src.expired_at)`,
      [sid, sessJson, expiredAt]
    ).then(() => {
      console.log('[SnowflakeStore] set OK in', Date.now()-t, 'ms for sid', sid.substring(0,8));
      _cacheSet(sid, sess); // keep cache warm after write
      this._maybeCleanup();
      cb(null);
    }).catch(err => {
      console.error('[SnowflakeStore] set error (session may not persist):', err.message, '| code:', err.code, '| sqlState:', err.sqlState);
      cb(null); // fail open — don't propagate to user
    });
  }

  /**
   * destroy(sid, callback)
   * Delete a session row.
   */
  destroy(sid, cb) {
    _cacheDel(sid); // evict from cache on logout
    query(
      'DELETE FROM sessions WHERE sid = ?',
      [sid]
    ).then(() => {
      cb(null);
    }).catch(err => {
      console.error('[SnowflakeStore] destroy error (non-fatal):', err.message);
      cb(null); // fail open
    });
  }

  /**
   * touch(sid, session, callback)
   * Extend a session's expiry without changing its data.
   */
  touch(sid, sess, cb) {
    const maxAge = (sess.cookie && sess.cookie.maxAge)
      ? sess.cookie.maxAge
      : 7 * 24 * 60 * 60 * 1000;
    const expiredAt = new Date(Date.now() + maxAge).toISOString();

    query(
      'UPDATE sessions SET expired_at = ?::TIMESTAMP WHERE sid = ?',
      [expiredAt, sid]
    ).then(() => {
      cb(null);
    }).catch(err => {
      console.error('[SnowflakeStore] touch error (non-fatal):', err.message);
      cb(null); // fail open
    });
  }
}

module.exports = SnowflakeStore;
