/**
 * src/services/freshnessCacheService.js
 *
 * Redis-backed freshness cache for PIPELINE.FRESHNESS.
 *
 * Problem solved:
 *   compute_freshness() used to MERGE into PIPELINE.FRESHNESS for every
 *   (table × account) pair every hour. Each MERGE scanned the full analytics
 *   table to get MAX(updated_at) — expensive on large RAW/ANALYTICS tables
 *   and a significant Snowflake credit consumer.
 *
 * New approach:
 *   1. After each ingest/stage run, write freshness state to Redis:
 *        SET freshness:{clientId}:{table} {json} EX 86400
 *   2. Once daily at 08:00 UTC, flush all accumulated Redis freshness state
 *      to PIPELINE.FRESHNESS via a single batch MERGE.
 *   3. Reads hit Redis first, fall back to Snowflake if the key is missing.
 *
 * Key format:  freshness:{clientId}:{tableName}
 * TTL:         24 hours (refreshed on every write)
 * JSON shape:  {
 *   table_name, account_id, client_id,
 *   last_successful_load_at,   // ISO string
 *   last_successful_report_date, // ISO string | null
 *   row_count_last_run,
 *   is_stale,
 *   staleness_threshold_hours,
 *   updated_at                 // ISO string
 * }
 */

'use strict';

const { query } = require('./snowflakeService');

const REDIS_TTL_SECONDS = 86400; // 24 hours
const KEY_PREFIX = 'freshness';

function redisKey(clientId, tableName) {
  return `${KEY_PREFIX}:${clientId}:${tableName}`;
}

function getRedis() {
  try {
    const { getRedisClient } = require('./redisSessionStore');
    const redis = getRedisClient();
    return redis && redis.status === 'ready' ? redis : null;
  } catch (_) {
    return null;
  }
}

// ─── Write ─────────────────────────────────────────────────────────────────────

/**
 * Write freshness metadata to Redis after a successful ingest.
 *
 * @param {object} opts
 * @param {string}   opts.clientId
 * @param {string}   opts.accountId
 * @param {string}   opts.tableName           e.g. 'CALBRIDGE_PROD.ANALYTICS.INVENTORY_SNAPSHOT'
 * @param {Date|string|null} opts.lastLoadAt  Timestamp of the most recent loaded row
 * @param {Date|string|null} [opts.lastReportDate]
 * @param {number}   [opts.rowCount]
 * @param {number}   [opts.stalenessThresholdHours=25]
 */
async function writeFreshnessToCache(opts) {
  const {
    clientId,
    accountId,
    tableName,
    lastLoadAt       = null,
    lastReportDate   = null,
    rowCount         = 0,
    stalenessThresholdHours = 25,
  } = opts;

  const redis = getRedis();
  if (!redis) return; // gracefully skip if Redis unavailable

  const nowIso = new Date().toISOString();
  const loadTs = lastLoadAt ? new Date(lastLoadAt).toISOString() : null;

  let isStale = true;
  if (loadTs) {
    const ageHours = (Date.now() - new Date(loadTs).getTime()) / 3_600_000;
    isStale = ageHours > stalenessThresholdHours;
  }

  const payload = JSON.stringify({
    table_name:                   tableName,
    account_id:                   accountId,
    client_id:                    clientId,
    last_successful_load_at:      loadTs,
    last_successful_report_date:  lastReportDate ? new Date(lastReportDate).toISOString() : null,
    row_count_last_run:           rowCount,
    is_stale:                     isStale,
    staleness_threshold_hours:    stalenessThresholdHours,
    updated_at:                   nowIso,
  });

  try {
    await redis.set(redisKey(clientId, tableName), payload, 'EX', REDIS_TTL_SECONDS);
  } catch (err) {
    console.warn('[freshnessCacheService] Redis write failed (non-fatal):', err.message?.slice(0, 80));
  }
}

// ─── Read ──────────────────────────────────────────────────────────────────────

/**
 * Read freshness records for a client.
 * Redis-first, Snowflake fallback.
 *
 * @param {string} clientId
 * @returns {Promise<object[]>}  Array of freshness records (JSON objects)
 */
async function getFreshnessForClient(clientId) {
  const redis = getRedis();

  // Try Redis first — scan for all keys matching freshness:{clientId}:*
  if (redis) {
    try {
      const pattern = `${KEY_PREFIX}:${clientId}:*`;
      // SCAN is preferred over KEYS in production; use KEYS here for simplicity
      // since the total key count is small (3 tables × N accounts ≈ single digits).
      const keys = await redis.keys(pattern);
      if (keys.length > 0) {
        const values = await redis.mget(...keys);
        const records = values
          .filter(Boolean)
          .map(v => { try { return JSON.parse(v); } catch (_) { return null; } })
          .filter(Boolean);
        if (records.length > 0) return records;
      }
    } catch (err) {
      console.warn('[freshnessCacheService] Redis read failed, falling back to Snowflake:', err.message?.slice(0, 80));
    }
  }

  // Snowflake fallback
  try {
    const rows = await query(`
      SELECT *
      FROM CALBRIDGE_PROD.PIPELINE.FRESHNESS
      WHERE client_id = ?
      ORDER BY table_name, account_id
    `, [clientId]);

    return (rows || []).map(r => ({
      table_name:                  r.TABLE_NAME  || r.table_name,
      account_id:                  r.ACCOUNT_ID  || r.account_id,
      client_id:                   r.CLIENT_ID   || r.client_id,
      last_successful_load_at:     r.LAST_SUCCESSFUL_LOAD_AT || r.last_successful_load_at,
      last_successful_report_date: r.LAST_SUCCESSFUL_REPORT_DATE || r.last_successful_report_date,
      row_count_last_run:          r.ROW_COUNT_LAST_RUN || r.row_count_last_run,
      is_stale:                    r.IS_STALE    || r.is_stale,
      staleness_threshold_hours:   r.STALENESS_THRESHOLD_HOURS || r.staleness_threshold_hours,
      updated_at:                  r.UPDATED_AT  || r.updated_at,
      _source: 'snowflake',
    }));
  } catch (err) {
    console.warn('[freshnessCacheService] Snowflake fallback failed:', err.message?.slice(0, 80));
    return [];
  }
}

// ─── Daily batch flush ─────────────────────────────────────────────────────────

/**
 * Flush all freshness data from Redis to PIPELINE.FRESHNESS in Snowflake.
 * Runs once daily at 08:00 UTC via cron.
 *
 * Scans all freshness:* keys, groups them, and issues a single MERGE per batch.
 * Replaces the per-run MERGE that used to fire every 30-60 minutes.
 */
async function flushFreshnessToSnowflake({ triggeredBy = 'cron' } = {}) {
  const redis = getRedis();
  if (!redis) {
    console.warn('[freshnessCacheService] flush: Redis unavailable — skipping');
    return { flushed: 0 };
  }

  let allKeys = [];
  try {
    allKeys = await redis.keys(`${KEY_PREFIX}:*`);
  } catch (err) {
    console.warn('[freshnessCacheService] flush: Redis KEYS failed:', err.message?.slice(0, 80));
    return { flushed: 0 };
  }

  if (!allKeys.length) {
    console.log('[freshnessCacheService] flush: No freshness keys in Redis — nothing to flush');
    return { flushed: 0 };
  }

  let values = [];
  try {
    values = await redis.mget(...allKeys);
  } catch (err) {
    console.warn('[freshnessCacheService] flush: mget failed:', err.message?.slice(0, 80));
    return { flushed: 0 };
  }

  const records = values
    .filter(Boolean)
    .map(v => { try { return JSON.parse(v); } catch (_) { return null; } })
    .filter(Boolean);

  if (!records.length) {
    console.log('[freshnessCacheService] flush: All keys empty — nothing to flush');
    return { flushed: 0 };
  }

  // Batch MERGE into Snowflake — one row per record
  // Snowflake VALUES clause supports multi-row inserts in the USING subquery
  let flushed = 0;
  const BATCH_SIZE = 50; // stay well under Snowflake query size limits

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);

    // Build a multi-row VALUES list with positional params
    const placeholders = batch.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?)').join(',\n      ');
    const params = batch.flatMap(r => [
      r.table_name,
      r.account_id,
      r.client_id,
      r.last_successful_load_at     || null,
      r.last_successful_report_date || null,
      r.row_count_last_run          || 0,
      r.is_stale                    ? 'TRUE' : 'FALSE',
      r.staleness_threshold_hours   || 25,
      r.updated_at,
    ]);

    try {
      await query(`
        MERGE INTO CALBRIDGE_PROD.PIPELINE.FRESHNESS tgt
        USING (
          SELECT
            col1  AS table_name,
            col2  AS account_id,
            col3  AS client_id,
            col4::TIMESTAMP_NTZ  AS last_successful_load_at,
            col5::DATE           AS last_successful_report_date,
            col6::NUMBER         AS row_count_last_run,
            col7::BOOLEAN        AS is_stale,
            col8::NUMBER         AS staleness_threshold_hours,
            col9::TIMESTAMP_NTZ  AS updated_at
          FROM VALUES ${placeholders}
        ) src (col1,col2,col3,col4,col5,col6,col7,col8,col9)
        ON  tgt.table_name = src.table_name
        AND tgt.account_id = src.account_id
        AND tgt.client_id  = src.client_id
        WHEN MATCHED THEN UPDATE SET
          last_successful_load_at      = src.last_successful_load_at,
          last_successful_report_date  = src.last_successful_report_date,
          row_count_last_run           = src.row_count_last_run,
          is_stale                     = src.is_stale,
          staleness_threshold_hours    = src.staleness_threshold_hours,
          updated_at                   = src.updated_at
        WHEN NOT MATCHED THEN INSERT (
          table_name, account_id, client_id,
          last_successful_load_at, last_successful_report_date,
          row_count_last_run, is_stale, staleness_threshold_hours, updated_at
        ) VALUES (
          src.table_name, src.account_id, src.client_id,
          src.last_successful_load_at, src.last_successful_report_date,
          src.row_count_last_run, src.is_stale, src.staleness_threshold_hours, src.updated_at
        )
      `, params);

      flushed += batch.length;
    } catch (err) {
      console.error(`[freshnessCacheService] flush: Batch ${i / BATCH_SIZE + 1} MERGE failed:`, err.message?.slice(0, 150));
    }
  }

  console.log(`[freshnessCacheService] ✅ Flushed ${flushed}/${records.length} freshness record(s) to Snowflake`);
  return { flushed };
}

module.exports = {
  writeFreshnessToCache,
  getFreshnessForClient,
  flushFreshnessToSnowflake,
};
