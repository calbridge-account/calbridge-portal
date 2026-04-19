/**
 * Calbridge Decision Engine
 *
 * Analyzes SP + SB keyword performance against target ROAS of 8.50x (11.76% ACoS)
 * and generates bid/budget recommendations for human approval.
 *
 * Rules:
 *   bid_decrease    — 30d ACoS > 11.76% AND spend > $10 AND clicks >= 10
 *   bid_increase    — 30d ACoS < 8% AND clicks >= 10 AND impressions < 10,000
 *   pause_keyword   — spend > $20 AND purchases_30d = 0 AND clicks >= 10
 *   add_keyword     — search term with ≥2 orders, good ACoS, not already targeted as EXACT
 *   budget_increase  — campaign ACoS < 10% AND budget utilization > 90%
 *   budget_decrease  — campaign ACoS > 15% AND spend > $500
 *
 * Safeguards:
 *   - Min bid: $1.00
 *   - Max step: ±20%
 *   - 7-day cooldown per entity
 *   - Human approval required before any execution
 */

'use strict';

const axios  = require('axios');
const { query } = require('./snowflakeService');
const { getValidToken } = require('./amazonAuthService');

const TARGET_ACOS     = 0.1176; // 8.50x ROAS = 11.76% ACoS
const SCALE_UP_ACOS   = 0.08;   // below this → increase bid
const PAUSE_SPEND_MIN = 20;
const MIN_CLICKS      = 10;
const MIN_SPEND       = 10;
const MIN_BID         = 1.00;
const MAX_STEP_UP     = 1.20;
const MAX_STEP_DOWN   = 0.80;
const ADS_API_BASE    = 'https://advertising-api.amazon.com';

// ─── Auth client ─────────────────────────────────────────────────────────────

async function adsClient(clientId, profileId) {
  const token = await getValidToken(clientId, 'ads');
  return axios.create({
    baseURL: ADS_API_BASE,
    headers: {
      'Authorization':                   `Bearer ${token}`,
      'Amazon-Advertising-API-ClientId':  process.env.LWA_CLIENT_ID,
      'Amazon-Advertising-API-Scope':     profileId,
      'Content-Type':                     'application/json',
    },
    timeout: 30000,
  });
}

// ─── Analysis ────────────────────────────────────────────────────────────────

async function analyze(clientId, days = 30) {
  // Resolve authorized profile IDs for this client from client_accounts
  // This prevents Acer profile data (leaked under CyberPower client_id) from
  // generating recommendations for the wrong account.
  const authorizedProfiles = await getAuthorizedProfiles(clientId);

  const [spKeywords, sbKeywords, campaigns, cooldownSet] = await Promise.all([
    loadSpKeywords(clientId, days, authorizedProfiles),
    loadSbKeywords(clientId, days, authorizedProfiles),
    loadCampaigns(clientId, days, authorizedProfiles),
    loadCooldownSet(clientId),
  ]);

  const actions = [];
  const skipped = { cooldown: 0, insufficient_data: 0 };

  // ── SP keywords ────────────────────────────────────────────────────────────
  for (const kw of spKeywords) {
    if (cooldownSet.has(String(kw.KEYWORD_ID))) { skipped.cooldown++; continue; }

    const spend    = Number(kw.SPEND    || 0);
    const sales    = Number(kw.SALES    || 0);
    const clicks   = Number(kw.CLICKS   || 0);
    const orders   = Number(kw.ORDERS   || 0);
    const impr     = Number(kw.IMPRESSIONS || 0);
    const bid      = Number(kw.KEYWORD_BID || 0);
    const acos     = sales > 0 ? spend / sales : null;
    const roas     = spend > 0 ? sales / spend : null;
    const keyword  = kw.TARGETING || kw.KEYWORD || '(unknown)';
    const metrics  = { acos, roas, spend_30d: spend, sales_30d: sales, clicks_30d: clicks, orders_30d: orders, impressions_30d: impr, bid };

    if (spend > PAUSE_SPEND_MIN && orders === 0 && clicks >= MIN_CLICKS) {
      actions.push(buildAction(clientId, 'pause_keyword', 'keyword', kw, 'SP', bid, bid, keyword,
        `No purchases in 30 days on $${spend.toFixed(0)} spend (${clicks} clicks)`, metrics));
    } else if (acos !== null && acos > TARGET_ACOS && spend >= MIN_SPEND && clicks >= MIN_CLICKS) {
      const rawBid = bid * (TARGET_ACOS / acos) * 0.9;
      const newBid = Math.max(MIN_BID, Math.max(bid * MAX_STEP_DOWN, Math.min(bid * MAX_STEP_UP, rawBid)));
      if (Math.abs(newBid - bid) / bid > 0.02) { // skip tiny adjustments
        actions.push(buildAction(clientId, 'bid_decrease', 'keyword', kw, 'SP', bid, +newBid.toFixed(2), keyword,
          `30d ACoS ${(acos*100).toFixed(1)}% vs ${(TARGET_ACOS*100).toFixed(1)}% target — reduce bid $${bid.toFixed(2)} → $${newBid.toFixed(2)}`, metrics));
      }
    } else if (acos !== null && acos < SCALE_UP_ACOS && clicks >= MIN_CLICKS && impr < 10000) {
      const newBid = Math.min(bid * MAX_STEP_UP, bid * 1.15);
      actions.push(buildAction(clientId, 'bid_increase', 'keyword', kw, 'SP', bid, +newBid.toFixed(2), keyword,
        `30d ACoS ${(acos*100).toFixed(1)}% well below target — increase bid $${bid.toFixed(2)} → $${newBid.toFixed(2)} to capture more volume`, metrics));
    } else {
      skipped.insufficient_data++;
    }
  }

  // ── SB keywords ────────────────────────────────────────────────────────────
  for (const kw of sbKeywords) {
    if (cooldownSet.has(String(kw.KEYWORD_ID))) { skipped.cooldown++; continue; }

    const spend   = Number(kw.SPEND   || 0);
    const sales   = Number(kw.SALES   || 0);
    const clicks  = Number(kw.CLICKS  || 0);
    const orders  = Number(kw.ORDERS  || 0);
    const bid     = Number(kw.KEYWORD_BID || 0);
    const acos    = sales > 0 ? spend / sales : null;
    const roas    = spend > 0 ? sales / spend : null;
    const keyword = kw.KEYWORD_TEXT || kw.TARGETING_TEXT || '(unknown)';
    const metrics = { acos, roas, spend_30d: spend, sales_30d: sales, clicks_30d: clicks, orders_30d: orders, bid };

    if (acos !== null && acos > TARGET_ACOS && spend >= MIN_SPEND && clicks >= MIN_CLICKS) {
      const rawBid = bid * (TARGET_ACOS / acos) * 0.9;
      const newBid = Math.max(MIN_BID, Math.max(bid * MAX_STEP_DOWN, Math.min(bid * MAX_STEP_UP, rawBid)));
      if (Math.abs(newBid - bid) / bid > 0.02) {
        actions.push(buildAction(clientId, 'bid_decrease', 'keyword', kw, 'SB', bid, +newBid.toFixed(2), keyword,
          `30d ACoS ${(acos*100).toFixed(1)}% vs target — reduce bid $${bid.toFixed(2)} → $${newBid.toFixed(2)}`, metrics));
      }
    } else if (acos !== null && acos < SCALE_UP_ACOS && clicks >= MIN_CLICKS) {
      const newBid = Math.min(bid * MAX_STEP_UP, bid * 1.15);
      actions.push(buildAction(clientId, 'bid_increase', 'keyword', kw, 'SB', bid, +newBid.toFixed(2), keyword,
        `30d ACoS ${(acos*100).toFixed(1)}% well below target — scale up bid`, metrics));
    }
  }

  // ── Keyword discovery (search term mining) ──────────────────────────────────
  let inserted = 0;  // declared here so all insert blocks can use it
  const searchTermRecs = await discoverKeywords(clientId, days, cooldownSet);
  for (const a of searchTermRecs) {
    try {
      await query(`
        INSERT INTO CALBRIDGE_PROD.APP.decision_actions
          (client_id, advertiser_id, action_type, entity_type, entity_id, entity_name,
           campaign_id, campaign_name, ad_group_id, profile_id, ad_type,
           current_value, proposed_value, reason, metrics_snapshot, status)
        SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,PARSE_JSON(?),?
      `, [
        a.client_id, null, a.action_type, a.entity_type, a.entity_id, a.entity_name,
        a.campaign_id || null, a.campaign_name || null, a.ad_group_id || null, a.profile_id || null, a.ad_type || null,
        a.current_value, a.proposed_value, a.reason, JSON.stringify(a.metrics_snapshot), 'pending',
      ]);
      inserted++;
    } catch (err) {
      console.warn('[DecisionEngine] Keyword discovery insert failed:', err.message?.substring(0, 100));
    }
  }

  // ── Campaign budgets ────────────────────────────────────────────────────────
  for (const c of campaigns) {
    if (cooldownSet.has(String(c.CAMPAIGN_ID))) { skipped.cooldown++; continue; }

    const spend  = Number(c.SPEND  || 0);
    const sales  = Number(c.SALES  || 0);
    const budget = Number(c.CAMPAIGN_BUDGET_AMOUNT || 0);
    const acos   = sales > 0 ? spend / sales : null;
    if (!budget || !acos) continue;
    const dailySpend = spend / days;
    const utilization = budget > 0 ? dailySpend / budget : 0;
    const metrics = { acos, roas: spend > 0 ? sales/spend : null, spend_30d: spend, sales_30d: sales, budget, utilization };

    if (acos < 0.10 && utilization > 0.90 && spend > 100) {
      const newBudget = +(budget * 1.10).toFixed(2);
      actions.push(buildCampaignAction(clientId, 'budget_increase', c, budget, newBudget,
        `ACoS ${(acos*100).toFixed(1)}% and hitting budget cap (${(utilization*100).toFixed(0)}% util) — increase budget $${budget.toFixed(0)} → $${newBudget.toFixed(0)}/day`, metrics));
    } else if (acos > 0.15 && spend > 500) {
      const newBudget = +(budget * 0.90).toFixed(2);
      actions.push(buildCampaignAction(clientId, 'budget_decrease', c, budget, newBudget,
        `ACoS ${(acos*100).toFixed(1)}% above 15% threshold on $${spend.toFixed(0)} spend — reduce budget`, metrics));
    }
  }

  // ── Idle inventory discovery ───────────────────────────────────────────────
  const idleAsins = await discoverIdleInventory(clientId, days, cooldownSet);
  for (const a of idleAsins) {
    try {
      await query(`
        INSERT INTO CALBRIDGE_PROD.APP.decision_actions
          (client_id, advertiser_id, action_type, entity_type, entity_id, entity_name,
           campaign_id, campaign_name, ad_group_id, profile_id, ad_type,
           current_value, proposed_value, reason, metrics_snapshot, status)
        SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,PARSE_JSON(?),?
      `, [
        a.client_id, null, a.action_type, a.entity_type, a.entity_id, a.entity_name,
        null, null, null, null, 'SP',
        a.current_value, a.proposed_value, a.reason, JSON.stringify(a.metrics_snapshot), 'pending',
      ]);
      inserted++;
    } catch (err) {
      console.warn('[DecisionEngine] Idle inventory insert failed:', err.message?.substring(0, 100));
    }
  }

  // ── Insert new actions ──────────────────────────────────────────────────────
  for (const a of actions) {
    try {
      await query(`
        INSERT INTO CALBRIDGE_PROD.APP.decision_actions
          (client_id, advertiser_id, action_type, entity_type, entity_id, entity_name,
           campaign_id, campaign_name, ad_group_id, profile_id, ad_type,
           current_value, proposed_value, reason, metrics_snapshot, status)
        SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,PARSE_JSON(?),?
      `, [
        a.client_id, a.advertiser_id || null, a.action_type, a.entity_type, a.entity_id, a.entity_name,
        a.campaign_id || null, a.campaign_name || null, a.ad_group_id || null, a.profile_id || null, a.ad_type || null,
        a.current_value, a.proposed_value, a.reason, JSON.stringify(a.metrics_snapshot), 'pending',
      ]);
      inserted++;
    } catch (err) {
      console.warn('[DecisionEngine] Insert failed:', err.message?.substring(0, 100));
    }
  }

  const pendingCount = await query(`SELECT COUNT(*) as cnt FROM CALBRIDGE_PROD.APP.decision_actions WHERE client_id=? AND status='pending'`, [clientId]);

  return {
    generated: inserted,
    skipped_cooldown: skipped.cooldown,
    skipped_data: skipped.insufficient_data,
    total_pending: Number(pendingCount[0]?.CNT || 0),
  };
}

// ─── Data loaders ─────────────────────────────────────────────────────────────

async function getAuthorizedProfiles(clientId) {
  try {
    const rows = await query(`
      SELECT DISTINCT platform_profile_id
      FROM CALBRIDGE_PROD.APP.client_accounts
      WHERE client_id = ? AND is_active = TRUE AND channel = 'sponsored_ads'
    `, [clientId]);
    if (rows.length) {
      const profiles = rows.map(r => String(r.PLATFORM_PROFILE_ID)).filter(Boolean);
      console.log(`[DecisionEngine] Authorized profiles for ${clientId.substring(0,8)}: ${profiles.join(', ')}`);
      return profiles;
    }
  } catch (err) {
    console.warn('[DecisionEngine] Could not load authorized profiles — allowing all:', err.message);
  }
  return null;
}

function profileFilter(authorizedProfiles) {
  if (!authorizedProfiles || !authorizedProfiles.length) return '';
  const list = authorizedProfiles.map(p => `'${p}'`).join(',');
  return `AND profile_id IN (${list})`;
}

function loadSpKeywords(clientId, days, authorizedProfiles) {
  return query(`
    SELECT
      k.keyword_id, k.targeting AS keyword_text, k.targeting, k.match_type, k.keyword_bid,
      k.campaign_id,
      COALESCE(MAX(c.campaign_name), k.campaign_name) AS campaign_name,
      k.ad_group_id, k.profile_id,
      SUM(k.cost)              AS spend,
      SUM(k.sales_30_d)        AS sales,
      SUM(k.purchases_30_d)    AS orders,
      SUM(k.clicks)            AS clicks,
      SUM(k.impressions)       AS impressions
    FROM CALBRIDGE_PROD.APP.sp_targeting_keyword_report k
    LEFT JOIN (
      SELECT DISTINCT campaign_id, MAX(campaign_name) AS campaign_name
      FROM CALBRIDGE_PROD.APP.sp_campaign_report
      WHERE client_id = ?
      GROUP BY campaign_id
    ) c ON c.campaign_id = k.campaign_id
    WHERE k.client_id = ?
      AND k.date >= DATEADD('day', -?, CURRENT_DATE())
      AND k.ad_keyword_status = 'ENABLED'
      AND (k.keyword_type IN ('BROAD','PHRASE','EXACT') OR k.keyword_type IS NULL)
      ${profileFilter(authorizedProfiles)}
    GROUP BY k.keyword_id, k.targeting, k.match_type, k.keyword_bid, k.campaign_id, k.campaign_name, k.ad_group_id, k.profile_id
    HAVING SUM(k.cost) > 5 OR SUM(k.clicks) >= ?
  `, [clientId, clientId, days, MIN_CLICKS]);
}

function loadSbKeywords(clientId, days, authorizedProfiles) {
  return query(`
    SELECT
      keyword_id, keyword_text, keyword_bid, match_type,
      campaign_id, campaign_name, ad_group_id, profile_id,
      SUM(cost)      AS spend,
      SUM(sales)     AS sales,
      SUM(purchases) AS orders,
      SUM(clicks)    AS clicks,
      SUM(impressions) AS impressions
    FROM CALBRIDGE_PROD.APP.sb_keyword_report
    WHERE client_id = ?
      AND report_date >= DATEADD('day', -?, CURRENT_DATE())
      AND ad_keyword_status = 'ENABLED'
      ${profileFilter(authorizedProfiles)}
    GROUP BY keyword_id, keyword_text, keyword_bid, match_type, campaign_id, campaign_name, ad_group_id, profile_id
    HAVING SUM(cost) > 5 OR SUM(clicks) >= ?
  `, [clientId, days, MIN_CLICKS]);
}

// ─── Keyword discovery ───────────────────────────────────────────────────────

async function discoverKeywords(clientId, days, cooldownSet) {
  // Find search terms that:
  //   1. Triggered via BROAD or PHRASE match (meaning no exact target exists)
  //   2. Have ≥ 2 purchases and ≥ 5 clicks in last 30 days
  //   3. ACoS < 15% (profitable enough to justify adding)
  //   4. Not already targeted as EXACT in sp_targeting_keyword_report
  const rows = await query(`
    WITH search_perf AS (
      SELECT
        search_term,
        campaign_id, campaign_name, ad_group_id, ad_group_name, profile_id,
        MAX(keyword_bid) AS ref_bid,
        SUM(cost)            AS spend,
        SUM(sales_30_d)      AS sales,
        SUM(purchases_30_d)  AS orders,
        SUM(clicks)          AS clicks,
        CASE WHEN SUM(sales_30_d) > 0 THEN SUM(cost)/SUM(sales_30_d) ELSE NULL END AS acos
      FROM CALBRIDGE_PROD.APP.sp_search_term_report
      WHERE client_id = ?
        AND date >= DATEADD('day', -?, CURRENT_DATE())
        AND match_type IN ('BROAD','PHRASE')
        AND purchases_30_d > 0
      GROUP BY search_term, campaign_id, campaign_name, ad_group_id, ad_group_name, profile_id
      HAVING SUM(purchases_30_d) >= 2
        AND SUM(clicks) >= 5
        AND CASE WHEN SUM(sales_30_d) > 0 THEN SUM(cost)/SUM(sales_30_d) ELSE 1 END < 0.15
    ),
    already_exact AS (
      SELECT DISTINCT LOWER(TRIM(targeting)) AS kw
      FROM CALBRIDGE_PROD.APP.sp_targeting_keyword_report
      WHERE client_id = ?
        AND match_type = 'EXACT'
        AND date >= DATEADD('day', -7, CURRENT_DATE())
    )
    SELECT sp.*
    FROM search_perf sp
    LEFT JOIN already_exact ae ON LOWER(TRIM(sp.search_term)) = ae.kw
    WHERE ae.kw IS NULL
    ORDER BY sp.orders DESC
    LIMIT 50
  `, [clientId, days, clientId]);

  const crypto = require('crypto');
  const actions = [];
  for (const r of rows) {
    // Hash entity_id to stay within VARCHAR(64) — use short hash of campaign+adgroup+term
    const raw = `${r.CAMPAIGN_ID}:${r.AD_GROUP_ID}:${r.SEARCH_TERM||''}`;
    const entityId = 'kw:' + crypto.createHash('sha1').update(raw).digest('hex').substring(0, 40);
    if (cooldownSet.has(entityId)) continue;

    const spend   = Number(r.SPEND  || 0);
    const sales   = Number(r.SALES  || 0);
    const orders  = Number(r.ORDERS || 0);
    const clicks  = Number(r.CLICKS || 0);
    const acos    = r.ACOS != null ? Number(r.ACOS) : null;
    const roas    = spend > 0 ? sales / spend : null;
    // Suggest bid = ref_bid × 0.8 (conservative start), floor $1.00
    const suggestedBid = Math.max(MIN_BID, +(Number(r.REF_BID || 2.00) * 0.8).toFixed(2));

    actions.push({
      client_id:    clientId,
      action_type:  'add_keyword',
      entity_type:  'keyword',
      entity_id:    entityId,
      entity_name:  r.SEARCH_TERM,
      campaign_id:  String(r.CAMPAIGN_ID),
      campaign_name: r.CAMPAIGN_NAME || null,
      ad_group_id:  String(r.AD_GROUP_ID),
      profile_id:   String(r.PROFILE_ID || ''),
      ad_type:      'SP',
      current_value: 0,
      proposed_value: suggestedBid,
      reason: `Search term "${r.SEARCH_TERM}" has ${orders} orders, ${(acos ? (acos*100).toFixed(1) : '—')}% ACoS via broad/phrase — add as EXACT match at $${suggestedBid} bid`,
      metrics_snapshot: { acos, roas, spend_30d: spend, sales_30d: sales, clicks_30d: clicks, orders_30d: orders, search_term: r.SEARCH_TERM, suggested_match_type: 'EXACT' },
    });
  }
  return actions;
}

function loadCampaigns(clientId, days, authorizedProfiles) {
  return query(`
    SELECT
      campaign_id, campaign_name, ad_type, profile_id,
      MAX(campaign_budget_amount) AS campaign_budget_amount,
      SUM(adjusted_spend) AS spend,
      SUM(sales)          AS sales,
      SUM(orders)         AS orders
    FROM CALBRIDGE_PROD.APP.adjusted_campaign_performance
    WHERE client_id = ?
      AND date >= DATEADD('day', -?, CURRENT_DATE())
      AND ad_type IN ('SP','SB','SD')
      AND campaign_status = 'ENABLED'
      ${profileFilter(authorizedProfiles)}
    GROUP BY campaign_id, campaign_name, ad_type, profile_id
    HAVING SUM(adjusted_spend) > 50
  `, [clientId, days]);
}

async function loadCooldownSet(clientId) {
  const rows = await query(`
    SELECT DISTINCT entity_id
    FROM CALBRIDGE_PROD.APP.decision_actions
    WHERE client_id = ?
      AND (
        status = 'pending'
        OR (status = 'executed' AND executed_at >= DATEADD('day', -7, CURRENT_DATE()))
        OR (status = 'approved')
      )
  `, [clientId]);
  return new Set(rows.map(r => String(r.ENTITY_ID)));
}

// ─── Action builders ──────────────────────────────────────────────────────────

function buildAction(clientId, actionType, entityType, kw, adType, currentVal, proposedVal, name, reason, metrics) {
  return {
    client_id:       clientId,
    advertiser_id:   null,
    action_type:     actionType,
    entity_type:     entityType,
    entity_id:       String(kw.KEYWORD_ID),
    entity_name:     name,
    campaign_id:     String(kw.CAMPAIGN_ID || ''),
    campaign_name:   kw.CAMPAIGN_NAME || null,
    ad_group_id:     String(kw.AD_GROUP_ID || ''),
    profile_id:      String(kw.PROFILE_ID || ''),
    ad_type:         adType,
    current_value:   currentVal,
    proposed_value:  proposedVal,
    reason,
    metrics_snapshot: metrics,
  };
}

function buildCampaignAction(clientId, actionType, c, currentVal, proposedVal, reason, metrics) {
  return {
    client_id:       clientId,
    advertiser_id:   null,
    action_type:     actionType,
    entity_type:     'campaign',
    entity_id:       String(c.CAMPAIGN_ID),
    entity_name:     c.CAMPAIGN_NAME || String(c.CAMPAIGN_ID),
    campaign_id:     String(c.CAMPAIGN_ID),
    campaign_name:   c.CAMPAIGN_NAME || null,
    ad_group_id:     null,
    profile_id:      String(c.PROFILE_ID || ''),
    ad_type:         c.AD_TYPE,
    current_value:   currentVal,
    proposed_value:  proposedVal,
    reason,
    metrics_snapshot: metrics,
  };
}

// ─── Execute action ───────────────────────────────────────────────────────────

async function executeAction(actionId, clientId, executedBy) {
  const rows = await query(
    `SELECT * FROM CALBRIDGE_PROD.APP.decision_actions WHERE action_id = ? AND client_id = ?`,
    [actionId, clientId]
  );
  if (!rows.length) throw new Error('Action not found');
  const action = rows[0];

  if (action.STATUS !== 'approved') throw new Error(`Cannot execute action with status: ${action.STATUS}`);

  const profileId = action.PROFILE_ID;
  if (!profileId) throw new Error('No profile_id on action — cannot call Amazon API');

  const client = await adsClient(clientId, profileId);
  let result;

  try {
    if (action.ACTION_TYPE === 'bid_decrease' || action.ACTION_TYPE === 'bid_increase') {
      if (action.AD_TYPE === 'SP') {
        const res = await client.put('/v2/sp/keywords', [
          { keywordId: action.ENTITY_ID, bid: action.PROPOSED_VALUE, state: 'enabled' }
        ]);
        result = res.data;
      } else if (action.AD_TYPE === 'SB') {
        const res = await client.put('/v2/sb/keywords', [
          { keywordId: action.ENTITY_ID, bid: action.PROPOSED_VALUE }
        ]);
        result = res.data;
      } else {
        throw new Error(`Bid update not supported for ad type: ${action.AD_TYPE}`);
      }
    } else if (action.ACTION_TYPE === 'add_keyword') {
      // Add new keyword to SP campaign
      const res = await client.post('/v2/sp/keywords', [{
        campaignId:  action.CAMPAIGN_ID,
        adGroupId:   action.AD_GROUP_ID,
        keywordText: action.ENTITY_NAME,
        matchType:   action.METRICS_SNAPSHOT?.suggested_match_type || 'EXACT',
        bid:         action.PROPOSED_VALUE,
        state:       'enabled',
      }]);
      result = res.data;
    } else if (action.ACTION_TYPE === 'budget_increase' || action.ACTION_TYPE === 'budget_decrease') {
      const res = await client.put('/v2/sp/campaigns', [
        { campaignId: action.ENTITY_ID, dailyBudget: action.PROPOSED_VALUE }
      ]);
      result = res.data;
    } else if (action.ACTION_TYPE === 'pause_keyword') {
      if (action.AD_TYPE === 'SP') {
        const res = await client.put('/v2/sp/keywords', [
          { keywordId: action.ENTITY_ID, state: 'paused' }
        ]);
        result = res.data;
      } else {
        throw new Error('Pause not yet implemented for non-SP keywords');
      }
    } else {
      throw new Error(`Unknown action type: ${action.ACTION_TYPE}`);
    }

    await query(`
      UPDATE CALBRIDGE_PROD.APP.decision_actions
      SET status='executed', executed_at=CURRENT_TIMESTAMP(), execution_result=PARSE_JSON(?), updated_at=CURRENT_TIMESTAMP()
      WHERE action_id=?
    `, [JSON.stringify(result), actionId]);

    return { success: true, result };
  } catch (err) {
    await query(`
      UPDATE CALBRIDGE_PROD.APP.decision_actions
      SET status='failed', execution_result=PARSE_JSON(?), updated_at=CURRENT_TIMESTAMP()
      WHERE action_id=?
    `, [JSON.stringify({ error: err.message, response: err.response?.data }), actionId]);
    throw err;
  }
}

// ─── Idle inventory discovery ─────────────────────────────────────────────────

async function discoverIdleInventory(clientId, days, cooldownSet) {
  // Find ASINs with significant inventory (>=50 units) but <$10 SP spend in last 30 days.
  // These are products sitting in Amazon's warehouse with no ad support.
  // Recommendation: launch or expand SP campaigns.
  try {
    const rows = await query(`
      WITH latest_inv AS (
        SELECT asin,
               MAX(sellable_on_hand_units)   AS units,
               MAX(open_purchase_order_units) AS open_pos,
               MAX(end_date)                  AS snapshot
        FROM CALBRIDGE_PROD.APP.vendor_inventory
        WHERE client_id = ?
          AND end_date >= DATEADD('day', -30, CURRENT_DATE())
        GROUP BY asin
        HAVING MAX(sellable_on_hand_units) >= 50
      ),
      sp_perf AS (
        SELECT advertised_asin, SUM(cost) AS spend, SUM(purchases_30_d) AS orders
        FROM CALBRIDGE_PROD.APP.sp_advertised_product_report
        WHERE client_id = ?
          AND date >= DATEADD('day', -?, CURRENT_DATE())
        GROUP BY advertised_asin
      )
      SELECT i.asin, i.units, i.open_pos, i.snapshot,
             COALESCE(s.spend, 0)  AS sp_spend,
             COALESCE(s.orders, 0) AS sp_orders
      FROM latest_inv i
      LEFT JOIN sp_perf s ON i.asin = s.advertised_asin
      WHERE COALESCE(s.spend, 0) < 10
      ORDER BY i.units DESC
      LIMIT 50
    `, [clientId, clientId, days]);

    const actions = [];
    for (const r of rows) {
      const entityId = `idle_inv:${r.ASIN}`;
      if (cooldownSet.has(entityId)) continue;

      const units   = Number(r.UNITS    || 0);
      const spend   = Number(r.SP_SPEND || 0);
      const orders  = Number(r.SP_ORDERS|| 0);
      const openPos = Number(r.OPEN_POS || 0);

      actions.push({
        client_id:    clientId,
        action_type:  'launch_campaign',
        entity_type:  'asin',
        entity_id:    entityId,
        entity_name:  r.ASIN,
        current_value: spend,
        proposed_value: 0, // no specific bid — recommendation to create campaign
        reason: `${units.toLocaleString()} units on hand with $${spend.toFixed(0)} SP spend in last ${days} days — product needs ad support to drive sell-through`,
        metrics_snapshot: {
          asin: r.ASIN,
          sellable_units: units,
          open_pos: openPos,
          sp_spend_30d: spend,
          sp_orders_30d: orders,
          snapshot_date: r.SNAPSHOT?.toString().substring(0, 10),
        },
      });
    }
    return actions;
  } catch (err) {
    console.warn('[DecisionEngine] Idle inventory discovery failed (non-fatal):', err.message?.substring(0, 100));
    return [];
  }
}

module.exports = { analyze, executeAction };
