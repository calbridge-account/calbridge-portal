/**
 * src/jobs/daypartingEngine.js
 *
 * Dayparting execution engine — runs hourly via cron.
 *
 * Logic:
 *   1. Load all active dayparting rules for all active clients
 *   2. For each rule, check if current UTC hour + day-of-week matches
 *   3. If it matches → apply the action to affected campaigns via SP API v3
 *   4. Log what was changed
 *
 * Action types:
 *   pause        — set campaign state to PAUSED
 *   resume       — set campaign state to ENABLED
 *   reduce_bid   — multiply all keyword bids by (1 - action_value/100)
 *   increase_bid — multiply all keyword bids by (1 + action_value/100)
 *
 * applies_to:
 *   all      — all SP campaigns for the client
 *   budget   — campaigns mapped to specific budget_ids
 *   campaign — specific campaign_ids
 *   ad_type  — SP | SB | SD
 */

'use strict';

require('dotenv').config();

const axios = require('axios');
const { query } = require('../services/snowflakeService');
const { getValidToken } = require('../services/amazonAuthService');

const ADS_API = 'https://advertising-api.amazon.com';

async function adsClient(clientId, profileId) {
  const token = await getValidToken(clientId, 'ads');
  return axios.create({
    baseURL: ADS_API,
    headers: {
      'Authorization':                  `Bearer ${token}`,
      'Amazon-Advertising-API-ClientId': process.env.LWA_CLIENT_ID,
      'Amazon-Advertising-API-Scope':    profileId,
    },
    timeout: 30000,
  });
}

function parseVariant(v) {
  if (v == null) return [];
  if (Array.isArray(v)) return v;
  try { return JSON.parse(typeof v === 'string' ? v : JSON.stringify(v)); } catch { return []; }
}

// ─── Get campaigns affected by a rule ────────────────────────────────────────

async function getAffectedCampaigns(clientId, rule) {
  const appliesTo    = rule.APPLIES_TO || 'all';
  const appliesToIds = parseVariant(rule.APPLIES_TO_IDS);

  if (appliesTo === 'all') {
    // All active SP campaigns for this client
    const rows = await query(`
      SELECT DISTINCT campaign_id, profile_id
      FROM CALBRIDGE_PROD.APP.sp_campaign_report
      WHERE client_id = ?
        AND campaign_status = 'ENABLED'
        AND date >= DATEADD('day', -3, CURRENT_DATE())
    `, [clientId]);
    return rows.map(r => ({ campaignId: r.CAMPAIGN_ID, profileId: r.PROFILE_ID }));
  }

  if (appliesTo === 'budget' && appliesToIds.length) {
    const placeholders = appliesToIds.map(() => '?').join(',');
    const rows = await query(`
      SELECT DISTINCT bcm.campaign_id, sc.profile_id
      FROM CALBRIDGE_PROD.APP.budget_campaign_map bcm
      JOIN CALBRIDGE_PROD.APP.sp_campaign_report sc
        ON sc.campaign_id = bcm.campaign_id AND sc.client_id = ?
        AND sc.date >= DATEADD('day', -3, CURRENT_DATE())
      WHERE bcm.budget_id IN (${placeholders})
    `, [clientId, ...appliesToIds]);
    return rows.map(r => ({ campaignId: r.CAMPAIGN_ID, profileId: r.PROFILE_ID }));
  }

  if (appliesTo === 'campaign' && appliesToIds.length) {
    const placeholders = appliesToIds.map(() => '?').join(',');
    const rows = await query(`
      SELECT DISTINCT campaign_id, profile_id
      FROM CALBRIDGE_PROD.APP.sp_campaign_report
      WHERE client_id = ? AND campaign_id IN (${placeholders})
        AND date >= DATEADD('day', -3, CURRENT_DATE())
    `, [clientId, ...appliesToIds]);
    return rows.map(r => ({ campaignId: r.CAMPAIGN_ID, profileId: r.PROFILE_ID }));
  }

  return [];
}

// ─── Apply action to campaigns ────────────────────────────────────────────────

async function applyAction(clientId, profileId, campaigns, rule) {
  if (!campaigns.length) return { applied: 0 };
  const actionType  = rule.ACTION_TYPE;
  const actionValue = Number(rule.ACTION_VALUE || 0);
  const campaignIds = campaigns.map(c => c.campaignId);

  const client = await adsClient(clientId, profileId);

  try {
    if (actionType === 'pause') {
      await client.put('/sp/campaigns', {
        campaigns: campaignIds.map(id => ({ campaignId: String(id), state: 'PAUSED' }))
      }, { headers: { 'Content-Type': 'application/vnd.spCampaign.v3+json', 'Accept': 'application/vnd.spCampaign.v3+json' } });

    } else if (actionType === 'resume') {
      await client.put('/sp/campaigns', {
        campaigns: campaignIds.map(id => ({ campaignId: String(id), state: 'ENABLED' }))
      }, { headers: { 'Content-Type': 'application/vnd.spCampaign.v3+json', 'Accept': 'application/vnd.spCampaign.v3+json' } });

    } else if (actionType === 'reduce_bid' || actionType === 'increase_bid') {
      // Get current keyword bids for these campaigns
      const placeholders = campaignIds.map(() => '?').join(',');
      const kwRows = await query(`
        SELECT DISTINCT keyword_id, keyword_bid
        FROM CALBRIDGE_PROD.APP.sp_targeting_keyword_report
        WHERE client_id = ?
          AND campaign_id IN (${placeholders})
          AND ad_keyword_status = 'ENABLED'
          AND keyword_bid IS NOT NULL
          AND keyword_bid > 0
          AND date >= DATEADD('day', -3, CURRENT_DATE())
      `, [clientId, ...campaignIds]);

      if (!kwRows.length) return { applied: 0, note: 'No keyword bids found' };

      const multiplier = actionType === 'reduce_bid'
        ? (1 - actionValue / 100)
        : (1 + actionValue / 100);

      // Batch bid updates
      const CHUNK = 1000;
      for (let i = 0; i < kwRows.length; i += CHUNK) {
        const batch = kwRows.slice(i, i + CHUNK);
        await client.put('/sp/keywords', {
          keywords: batch.map(k => ({
            keywordId: String(k.KEYWORD_ID),
            bid: Math.max(0.02, Math.round(Number(k.KEYWORD_BID) * multiplier * 100) / 100),
          }))
        }, { headers: { 'Content-Type': 'application/vnd.spKeyword.v3+json', 'Accept': 'application/vnd.spKeyword.v3+json' } });
      }
    }

    return { applied: campaignIds.length };
  } catch (err) {
    console.warn(`[daypartingEngine] Action ${actionType} failed for profile ${profileId}:`, err.message.slice(0, 100));
    return { applied: 0, error: err.message.slice(0, 100) };
  }
}

// ─── Execute rules for one client ────────────────────────────────────────────

async function executeDaypartingRules(clientId) {
  const now         = new Date();
  const currentHour = now.getUTCHours();          // 0-23
  const currentDay  = now.getUTCDay();            // 0=Sunday, 6=Saturday

  const rules = await query(`
    SELECT rule_id, rule_name, action_type, action_value,
           days_of_week, hours_utc, applies_to, applies_to_ids
    FROM CALBRIDGE_PROD.APP.client_dayparting
    WHERE client_id = ? AND is_active = TRUE
  `, [clientId]);

  if (!rules.length) return { rulesChecked: 0, actionsApplied: 0 };

  let actionsApplied = 0;
  const log = [];

  for (const rule of rules) {
    const daysOfWeek = parseVariant(rule.DAYS_OF_WEEK);
    const hoursUtc   = parseVariant(rule.HOURS_UTC);

    // Check if this rule fires right now
    const dayMatches  = daysOfWeek.includes(currentDay);
    const hourMatches = hoursUtc.includes(currentHour);

    if (!dayMatches || !hourMatches) continue;

    console.log(`[daypartingEngine] Rule "${rule.RULE_NAME}" fires at ${currentDay}d ${currentHour}h UTC`);

    const campaigns = await getAffectedCampaigns(clientId, rule);
    if (!campaigns.length) {
      log.push({ rule: rule.RULE_NAME, campaigns: 0, note: 'No matching campaigns' });
      continue;
    }

    // Group by profile (can't mix profiles in one API call)
    const byProfile = {};
    for (const c of campaigns) {
      if (!byProfile[c.profileId]) byProfile[c.profileId] = [];
      byProfile[c.profileId].push(c);
    }

    for (const [profileId, profileCampaigns] of Object.entries(byProfile)) {
      const result = await applyAction(clientId, profileId, profileCampaigns, rule);
      actionsApplied += result.applied || 0;
      log.push({
        rule:      rule.RULE_NAME,
        action:    rule.ACTION_TYPE,
        profileId,
        campaigns: result.applied,
        note:      result.note || result.error || null,
      });
    }
  }

  if (actionsApplied > 0) {
    console.log(`[daypartingEngine] ${clientId}: ${actionsApplied} campaigns affected by ${log.length} rule(s)`);
  }

  return { rulesChecked: rules.length, actionsApplied, log };
}

// ─── All clients ──────────────────────────────────────────────────────────────

async function executeDaypartingAllClients({ triggeredBy = 'cron' } = {}) {
  const clients = await query(
    `SELECT client_id FROM clients WHERE status = 'active' AND linked_client_id IS NULL`
  );
  let ran = 0;
  for (const row of (clients || [])) {
    const clientId = row.CLIENT_ID || row.client_id;
    try {
      const result = await executeDaypartingRules(clientId);
      if (result.actionsApplied > 0) {
        console.log(`[daypartingEngine] ${clientId}: ${result.actionsApplied} actions applied`);
        ran++;
      }
    } catch (err) {
      console.warn(`[daypartingEngine] ${clientId} failed:`, err.message.slice(0, 100));
    }
  }
  if (ran > 0) console.log(`[daypartingEngine] Complete — ${ran} client(s) had active rules`);
}

module.exports = { executeDaypartingRules, executeDaypartingAllClients };
