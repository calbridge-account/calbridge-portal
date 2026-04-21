/**
 * src/services/daypartingService.js
 *
 * 24-hour multiplier-based dayparting schedule system.
 *
 * Distinct from the rule-based daypartingEngine (pause/resume/bid%).
 * This system applies hourly bid multipliers directly to SP campaign bids
 * via the Amazon Ads API, following a 24-slot schedule per entity.
 *
 * Schedule format (VARIANT stored as JSON array of 24 entries):
 *   [ { "hour": 0, "multiplier": 0.8 }, { "hour": 1, "multiplier": 1.0 }, ... ]
 *
 * Multiplier semantics:
 *   1.0 = no change (baseline)
 *   0.5 = cut bids in half
 *   1.5 = increase bids by 50%
 *   0.0 = reserved (do not use — use pause rule instead)
 *
 * API:
 *   getSchedules(clientId)
 *   upsertSchedule(clientId, data)
 *   deleteSchedule(clientId, scheduleId)
 *   getCurrentMultiplier(schedule, timezone)
 *   applyDaypartSchedules(clientId)
 */

'use strict';

const axios   = require('axios');
const { v4: uuidv4 } = require('uuid');
const { query }      = require('./snowflakeService');
const { getValidToken } = require('./amazonAuthService');

const SCHEMA  = 'CALBRIDGE_PROD.APP';
const ADS_API = 'https://advertising-api.amazon.com';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseSchedule(raw) {
  if (!raw) return null;
  if (Array.isArray(raw)) return raw;
  try { return JSON.parse(typeof raw === 'string' ? raw : JSON.stringify(raw)); }
  catch { return null; }
}

/** Build an axios client scoped to a specific profileId */
async function adsClient(clientId, profileId) {
  const token = await getValidToken(clientId, 'ads');
  return axios.create({
    baseURL: ADS_API,
    headers: {
      'Authorization':                   `Bearer ${token}`,
      'Amazon-Advertising-API-ClientId':  process.env.LWA_CLIENT_ID,
      'Amazon-Advertising-API-Scope':     String(profileId),
    },
    timeout: 30000,
  });
}

// ─── getSchedules ─────────────────────────────────────────────────────────────

/**
 * Fetch all enabled schedules for a client.
 * @param {string} clientId
 * @returns {Promise<object[]>}
 */
async function getSchedules(clientId) {
  const rows = await query(`
    SELECT id, client_id, entity_type, entity_id, marketplace,
           label, schedule, timezone, enabled, created_at, updated_at
    FROM   ${SCHEMA}.DAYPART_SCHEDULES
    WHERE  client_id = ?
      AND  enabled   = TRUE
    ORDER  BY created_at ASC
  `, [clientId]);

  return rows.map(r => ({
    id:          r.ID,
    clientId:    r.CLIENT_ID,
    entityType:  r.ENTITY_TYPE,
    entityId:    r.ENTITY_ID,
    marketplace: r.MARKETPLACE,
    label:       r.LABEL,
    schedule:    parseSchedule(r.SCHEDULE),
    timezone:    r.TIMEZONE || 'America/Los_Angeles',
    enabled:     r.ENABLED ?? true,
    createdAt:   r.CREATED_AT,
    updatedAt:   r.UPDATED_AT,
  }));
}

// ─── upsertSchedule ───────────────────────────────────────────────────────────

/**
 * Insert or update a schedule.
 * If data.id exists and belongs to this client → UPDATE, else INSERT.
 *
 * @param {string} clientId
 * @param {object} data  { id?, entityType, entityId?, marketplace?, label?, schedule, timezone? }
 * @returns {Promise<{id: string}>}
 */
async function upsertSchedule(clientId, data) {
  const {
    id,
    entityType,
    entityId    = null,
    marketplace = 'ATVPDKIKX0DER',
    label       = null,
    schedule,
    timezone    = 'America/Los_Angeles',
  } = data;

  if (!entityType) throw Object.assign(new Error('entityType is required'), { status: 400 });
  if (!schedule || !Array.isArray(schedule) || schedule.length !== 24) {
    throw Object.assign(new Error('schedule must be an array of 24 hourly entries'), { status: 400 });
  }

  // Validate multiplier range
  for (const entry of schedule) {
    if (typeof entry.multiplier !== 'number' || entry.multiplier < 0.1 || entry.multiplier > 3.0) {
      throw Object.assign(
        new Error(`Invalid multiplier ${entry.multiplier} at hour ${entry.hour} — must be 0.1–3.0`),
        { status: 400 }
      );
    }
  }

  const scheduleJson = JSON.stringify(schedule);

  // Try UPDATE if id supplied
  if (id) {
    const existing = await query(
      `SELECT id FROM ${SCHEMA}.DAYPART_SCHEDULES WHERE id = ? AND client_id = ?`,
      [id, clientId]
    );
    if (existing.length > 0) {
      await query(`
        UPDATE ${SCHEMA}.DAYPART_SCHEDULES
        SET entity_type  = ?,
            entity_id    = ?,
            marketplace  = ?,
            label        = ?,
            schedule     = PARSE_JSON(?),
            timezone     = ?,
            enabled      = TRUE,
            updated_at   = CURRENT_TIMESTAMP()
        WHERE id        = ?
          AND client_id = ?
      `, [entityType, entityId, marketplace, label, scheduleJson, timezone, id, clientId]);
      return { id };
    }
  }

  // INSERT new
  const newId = id || uuidv4();
  await query(`
    INSERT INTO ${SCHEMA}.DAYPART_SCHEDULES
      (id, client_id, entity_type, entity_id, marketplace, label, schedule, timezone, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, PARSE_JSON(?), ?, TRUE, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())
  `, [newId, clientId, entityType, entityId, marketplace, label, scheduleJson, timezone]);

  return { id: newId };
}

// ─── deleteSchedule ───────────────────────────────────────────────────────────

/**
 * Soft-delete a schedule by setting enabled=false.
 * @param {string} clientId
 * @param {string} scheduleId
 */
async function deleteSchedule(clientId, scheduleId) {
  await query(`
    UPDATE ${SCHEMA}.DAYPART_SCHEDULES
    SET enabled    = FALSE,
        updated_at = CURRENT_TIMESTAMP()
    WHERE id        = ?
      AND client_id = ?
  `, [scheduleId, clientId]);
}

// ─── getCurrentMultiplier ─────────────────────────────────────────────────────

/**
 * Get the multiplier for the current local hour given a timezone.
 *
 * @param {Array}  schedule  24-entry array [{ hour: 0, multiplier: 1.0 }, ...]
 * @param {string} timezone  IANA timezone name, e.g. 'America/Los_Angeles'
 * @returns {number}  multiplier for current hour (defaults to 1.0 if not found)
 */
function getCurrentMultiplier(schedule, timezone = 'America/Los_Angeles') {
  if (!schedule || !Array.isArray(schedule)) return 1.0;

  // Resolve current local hour via Intl API (no external deps)
  const now = new Date();
  let localHour;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      hour:     'numeric',
      hour12:   false,
      timeZone: timezone,
    }).formatToParts(now);
    const hourPart = parts.find(p => p.type === 'hour');
    localHour = hourPart ? parseInt(hourPart.value, 10) % 24 : now.getUTCHours();
  } catch {
    // Fallback to UTC if timezone is invalid
    localHour = now.getUTCHours();
  }

  const entry = schedule.find(e => e.hour === localHour);
  return entry != null ? entry.multiplier : 1.0;
}

// ─── getLocalHour ─────────────────────────────────────────────────────────────

function getLocalHour(timezone = 'America/Los_Angeles') {
  const now = new Date();
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      hour:     'numeric',
      hour12:   false,
      timeZone: timezone,
    }).formatToParts(now);
    const hourPart = parts.find(p => p.type === 'hour');
    return hourPart ? parseInt(hourPart.value, 10) % 24 : now.getUTCHours();
  } catch {
    return now.getUTCHours();
  }
}

// ─── Apply multiplier to SP campaigns ────────────────────────────────────────

/**
 * Apply a bid multiplier to all SP campaigns in the given profile.
 * Uses SP API v3 PUT /sp/campaigns — sets bidding.adjustments[0].percentage.
 *
 * Note: This adjusts the top-of-search placement multiplier which is the
 * primary lever for hourly bid scheduling without changing base bid.
 * A multiplier of 1.0 = 0% adjustment (no change),
 * 1.5 = 50% boost, 0.5 = -50% (effectively a 50% decrease).
 *
 * We convert: percentage = (multiplier - 1.0) * 100, clamped to [-99, 900].
 */
async function applyMultiplierToCampaigns(clientId, profileId, campaignIds, multiplier) {
  const client = await adsClient(clientId, profileId);

  // Convert multiplier to bidding adjustment percentage
  // SP API accepts -99 to 900 for placement adjustments
  const rawPct = Math.round((multiplier - 1.0) * 100);
  const pct    = Math.max(-99, Math.min(900, rawPct));

  const payload = {
    campaigns: campaignIds.map(id => ({
      campaignId: String(id),
      bidding: {
        strategy: 'LEGACY_FOR_SALES',
        adjustments: [
          { predicate: 'PLACEMENT_TOP', percentage: pct },
        ],
      },
    })),
  };

  const res = await client.put('/sp/campaigns', payload);
  return res.data;
}

// ─── applyDaypartSchedules ────────────────────────────────────────────────────

/**
 * Main execution function — runs once per hour for a single client.
 *
 * For each enabled schedule:
 *   1. Resolve current local hour multiplier
 *   2. Compare to previous hour's multiplier
 *   3. If changed → call Amazon Ads API to apply new bid multiplier
 *   4. Log result to DAYPART_LOG
 *
 * @param {string} clientId
 * @returns {Promise<{processed: number, changed: number, errors: number}>}
 */
async function applyDaypartSchedules(clientId) {
  const schedules = await getSchedules(clientId);
  if (!schedules.length) return { processed: 0, changed: 0, errors: 0 };

  const utcHour   = new Date().getUTCHours();
  const prevUtcHour = (utcHour + 23) % 24;

  let processed = 0, changed = 0, errors = 0;

  for (const sched of schedules) {
    processed++;
    const { id: scheduleId, entityType, entityId, timezone, schedule } = sched;

    // Get current and previous hour multipliers for this timezone
    const currentMultiplier = getCurrentMultiplier(schedule, timezone);
    const localHour         = getLocalHour(timezone);

    // Previous local hour's multiplier
    const prevLocalHour = (localHour + 23) % 24;
    const prevEntry     = schedule.find(e => e.hour === prevLocalHour);
    const prevMultiplier = prevEntry != null ? prevEntry.multiplier : 1.0;

    // Only apply if multiplier changed
    if (currentMultiplier === prevMultiplier) {
      continue;
    }

    changed++;
    let status = 'ok';
    let amazonResponse = null;

    try {
      if (entityType === 'campaign' && entityId) {
        // Single campaign — find its profileId from sp_campaign_report
        const profRows = await query(`
          SELECT DISTINCT profile_id
          FROM   ${SCHEMA}.sp_campaign_report
          WHERE  client_id   = ?
            AND  campaign_id = ?
          LIMIT  1
        `, [clientId, entityId]);

        if (profRows.length === 0) {
          throw new Error(`No profile found for campaign ${entityId}`);
        }
        const profileId = profRows[0].PROFILE_ID;
        amazonResponse  = await applyMultiplierToCampaigns(clientId, profileId, [entityId], currentMultiplier);

      } else if (entityType === 'portfolio') {
        // All campaigns in the portfolio
        const campRows = await query(`
          SELECT DISTINCT campaign_id, profile_id
          FROM   ${SCHEMA}.sp_campaign_report
          WHERE  client_id    = ?
            AND  portfolio_id = ?
          ORDER  BY profile_id
        `, [clientId, entityId]);

        // Group by profile
        const byProfile = {};
        for (const r of campRows) {
          const pid = r.PROFILE_ID;
          if (!byProfile[pid]) byProfile[pid] = [];
          byProfile[pid].push(r.CAMPAIGN_ID);
        }
        const responses = [];
        for (const [pid, cids] of Object.entries(byProfile)) {
          responses.push(await applyMultiplierToCampaigns(clientId, pid, cids, currentMultiplier));
        }
        amazonResponse = responses;

      } else if (entityType === 'all') {
        // All SP campaigns for this client
        const campRows = await query(`
          SELECT DISTINCT campaign_id, profile_id
          FROM   ${SCHEMA}.sp_campaign_report
          WHERE  client_id = ?
          ORDER  BY profile_id
        `, [clientId]);

        const byProfile = {};
        for (const r of campRows) {
          const pid = r.PROFILE_ID;
          if (!byProfile[pid]) byProfile[pid] = [];
          byProfile[pid].push(r.CAMPAIGN_ID);
        }
        const responses = [];
        for (const [pid, cids] of Object.entries(byProfile)) {
          responses.push(await applyMultiplierToCampaigns(clientId, pid, cids, currentMultiplier));
        }
        amazonResponse = responses;
      }
    } catch (err) {
      console.error(`[daypartingService] Schedule ${scheduleId} apply error: ${err.message}`);
      status = 'error';
      amazonResponse = { error: err.message };
      errors++;
    }

    // Log to DAYPART_LOG
    try {
      await query(`
        INSERT INTO ${SCHEMA}.DAYPART_LOG
          (id, schedule_id, client_id, entity_type, entity_id,
           hour_utc, hour_local, multiplier, status, amazon_response, executed_at)
        VALUES (UUID_STRING(), ?, ?, ?, ?, ?, ?, ?, ?, PARSE_JSON(?), CURRENT_TIMESTAMP())
      `, [
        scheduleId, clientId, entityType, entityId || null,
        utcHour, localHour,
        currentMultiplier, status,
        JSON.stringify(amazonResponse || {}),
      ]);
    } catch (logErr) {
      console.warn(`[daypartingService] Log write failed: ${logErr.message}`);
    }
  }

  console.log(`[daypartingService] ${clientId}: processed=${processed} changed=${changed} errors=${errors}`);
  return { processed, changed, errors };
}

// ─── applyDaypartSchedulesAllClients ─────────────────────────────────────────

/**
 * Run applyDaypartSchedules for all clients that have active schedules.
 * Called by cron.js.
 */
async function applyDaypartSchedulesAllClients({ triggeredBy = 'cron' } = {}) {
  try {
    const rows = await query(`
      SELECT DISTINCT client_id
      FROM   ${SCHEMA}.DAYPART_SCHEDULES
      WHERE  enabled = TRUE
    `);

    let ran = 0;
    for (const row of (rows || [])) {
      const clientId = row.CLIENT_ID || row.client_id;
      try {
        await applyDaypartSchedules(clientId);
        ran++;
      } catch (err) {
        console.warn(`[daypartingService] applyDaypartSchedules ${clientId} failed: ${err.message}`);
      }
    }
    console.log(`[daypartingService] applyDaypartSchedulesAllClients complete — ran for ${ran} client(s)`);
  } catch (err) {
    console.error('[daypartingService] applyDaypartSchedulesAllClients error:', err.message);
  }
}

module.exports = {
  getSchedules,
  upsertSchedule,
  deleteSchedule,
  getCurrentMultiplier,
  applyDaypartSchedules,
  applyDaypartSchedulesAllClients,
};
