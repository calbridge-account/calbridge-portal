const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/requireAuth');
const { requirePlan } = require('../middleware/requirePlan');
const { query } = require('../services/snowflakeService');
const { v4: uuidv4 } = require('uuid');
const { resolveClientId } = require('../services/advertiserResolver');
const { adsClient, getAuthorizedProfiles } = require('../jobs/adsIngestion');

/**
 * Ensure campaign_actions table exists.
 * Called once at startup from app.js — but also safe to call inline.
 */
async function ensureCampaignActionsTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS campaign_actions (
      action_id    VARCHAR(36)   PRIMARY KEY,
      client_id    VARCHAR(36)   NOT NULL,
      campaign_id  VARCHAR(100)  NOT NULL,
      action_type  VARCHAR(50)   NOT NULL,
      payload      VARIANT,
      status       VARCHAR(20)   DEFAULT 'pending',
      created_at   TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP,
      executed_at  TIMESTAMP_NTZ
    )
  `);
}

/**
 * Log a queued write action to the campaign_actions table.
 */
async function logCampaignAction(clientId, campaignId, actionType, payload = null) {
  const actionId = uuidv4();
  await query(
    `INSERT INTO campaign_actions (action_id, client_id, campaign_id, action_type, payload, status)
     SELECT ?, ?, ?, ?, PARSE_JSON(?), 'pending'`,
    [actionId, clientId, campaignId, actionType, payload ? JSON.stringify(payload) : 'null']
  );
  return actionId;
}

// ---- Routes ----------------------------------------------------------------

/**
 * GET /campaigns
 * List all campaigns for the logged-in client with full metrics.
 */
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const days     = Number(req.query.days) || 30;
    const clientId = await resolveClientId(req);

    // Resolve authorized profile IDs for this client so we never return
    // campaigns that were contaminated from another brand's profile.
    // Falls back gracefully to no profile filter if lookup fails.
    let profileFilter = '';
    let profileParams = [];
    try {
      const allProfiles = await require('../jobs/adsIngestion').fetchProfiles(clientId, 'ads').catch(() => []);
      const authProfiles = await getAuthorizedProfiles(clientId, allProfiles);
      if (authProfiles.length > 0) {
        const ids = authProfiles.map(p => String(p.profileId));
        const placeholders = ids.map(() => '?').join(',');
        // Filter by profile_id when set; include rows where profile_id IS NULL for backward compat
        profileFilter = `AND (c.profile_id IS NULL OR c.profile_id IN (${placeholders}))`;
        profileParams = ids;
      }
    } catch (e) {
      // Non-fatal — just skip profile filter, query still scoped by client_id
      console.warn('[campaigns] profile filter failed:', e.message?.slice(0, 80));
    }

    const rows = await query(`
      SELECT
        c.campaign_id,
        c.campaign_name,
        c.campaign_type,
        c.connection_type,
        c.status,
        c.budget,
        COALESCE(SUM(ap.impressions), 0)  AS impressions,
        COALESCE(SUM(ap.clicks),      0)  AS clicks,
        COALESCE(SUM(ap.spend),       0)  AS spend,
        COALESCE(SUM(ap.sales),       0)  AS sales,
        COALESCE(SUM(ap.orders),      0)  AS orders,
        CASE WHEN SUM(ap.sales) > 0 THEN SUM(ap.spend) / SUM(ap.sales) ELSE NULL END  AS acos,
        CASE WHEN SUM(ap.spend) > 0 THEN SUM(ap.sales) / SUM(ap.spend) ELSE NULL END  AS roas,
        CASE WHEN SUM(ap.impressions) > 0 THEN SUM(ap.clicks) / SUM(ap.impressions) ELSE NULL END AS ctr,
        CASE WHEN SUM(ap.clicks) > 0 THEN SUM(ap.spend) / SUM(ap.clicks) ELSE NULL END AS cpc
      FROM ad_campaigns c
      LEFT JOIN ad_performance ap
        ON c.client_id       = ap.client_id
        AND c.campaign_id    = ap.campaign_id
        AND c.connection_type = ap.connection_type
        AND ap.report_date   >= DATEADD(day, -?, CURRENT_DATE)
      WHERE c.client_id = ?
        ${profileFilter}
      GROUP BY
        c.campaign_id, c.campaign_name, c.campaign_type,
        c.connection_type, c.status, c.budget
      HAVING SUM(ap.spend) > 0 OR SUM(ap.impressions) > 0
      ORDER BY SUM(ap.spend) DESC NULLS LAST
    `, [days, clientId, ...profileParams]);

    res.json(rows);
  } catch (err) { next(err); }
});

/**
 * GET /campaigns/actions/pending
 * List pending (not yet executed) campaign actions for this client.
 * Must come BEFORE /:id to avoid route conflict.
 */
router.get('/actions/pending', requireAuth, async (req, res, next) => {
  try {
    const rows = await query(`
      SELECT action_id, campaign_id, action_type, payload, status, created_at
      FROM campaign_actions
      WHERE client_id = ?
        AND status = 'pending'
      ORDER BY created_at DESC
    `, [await resolveClientId(req)]);

    res.json(rows);
  } catch (err) { next(err); }
});

// ─── Campaign Creation Wizard Endpoints ─────────────────────────────────────

/**
 * GET /campaigns/create/profile
 * Returns the Amazon Ads profile ID for this client (from client_accounts).
 */
router.get('/create/profile', requireAuth, async (req, res, next) => {
  try {
    const clientId = await resolveClientId(req);
    const rows = await query(`
      SELECT platform_profile_id, account_id, marketplace
      FROM CALBRIDGE_PROD.APP.client_accounts
      WHERE client_id = ?
        AND channel   = 'sponsored_ads'
        AND is_active  = TRUE
      LIMIT 1
    `, [clientId]);

    if (!rows || rows.length === 0) {
      return res.json({ profileId: null, accountId: null });
    }
    const r = rows[0];
    res.json({
      profileId:  r.PLATFORM_PROFILE_ID || r.platform_profile_id || null,
      accountId:  r.ACCOUNT_ID          || r.account_id          || null,
      marketplace: r.MARKETPLACE        || r.marketplace         || 'US',
    });
  } catch (err) { next(err); }
});

/**
 * GET /campaigns/create/suggestions?adType=SP|SB
 * Returns keyword suggestions from historical search term data (last 60 days).
 * Must be registered BEFORE /:id to avoid route conflict.
 */
router.get('/create/suggestions', requireAuth, async (req, res, next) => {
  try {
    const clientId = await resolveClientId(req);
    const rows = await query(`
      SELECT
        SEARCH_TERM                                        AS term,
        SUM(CLICKS)                                        AS clicks,
        SUM(SPEND)                                         AS spend,
        SUM(PURCHASES_14D)                                 AS orders,
        SUM(SALES_14D)                                     AS sales,
        MODE(MATCH_TYPE)                                   AS match_type
      FROM CALBRIDGE_PROD.RAW.AD_SEARCH_TERM
      WHERE CLIENT_ID   = ?
        AND DATE       >= DATEADD(day, -60, CURRENT_DATE)
      GROUP BY SEARCH_TERM
      HAVING SUM(CLICKS) >= 5
      ORDER BY SUM(PURCHASES_14D) DESC NULLS LAST, SUM(CLICKS) DESC
      LIMIT 100
    `, [clientId]);

    const results = rows.map(r => ({
      term:      r.TERM      || r.term      || '',
      clicks:    Number(r.CLICKS  || r.clicks  || 0),
      spend:     Number(r.SPEND   || r.spend   || 0),
      orders:    Number(r.ORDERS  || r.orders  || 0),
      sales:     Number(r.SALES   || r.sales   || 0),
      matchType: r.MATCH_TYPE || r.match_type || 'BROAD',
    }));

    res.json(results);
  } catch (err) { next(err); }
});

/**
 * GET /campaigns/create/asins
 * Returns ASINs with performance data for ad targeting (last 60 days).
 */
router.get('/create/asins', requireAuth, async (req, res, next) => {
  try {
    const clientId = await resolveClientId(req);

    let rows = [];
    try {
      rows = await query(`
        SELECT
          ADVERTISED_ASIN                AS asin,
          COALESCE(MAX(TITLE), '')       AS title,
          SUM(CLICKS)                   AS clicks,
          SUM(SPEND)                    AS spend,
          SUM(PURCHASES_14D)            AS orders,
          SUM(SALES_14D)                AS sales
        FROM CALBRIDGE_PROD.RAW.AD_ADVERTISED_PRODUCT
        WHERE CLIENT_ID  = ?
          AND DATE      >= DATEADD(day, -60, CURRENT_DATE)
        GROUP BY ADVERTISED_ASIN
        ORDER BY SUM(PURCHASES_14D) DESC NULLS LAST, SUM(CLICKS) DESC
        LIMIT 50
      `, [clientId]);
    } catch (e) {
      console.warn('[campaigns/create/asins] AD_ADVERTISED_PRODUCT query failed, falling back to PRODUCTS:', e.message);
    }

    // Fallback: query APP.PRODUCTS if no ad data
    if (!rows || rows.length === 0) {
      try {
        rows = await query(`
          SELECT
            ASIN   AS asin,
            TITLE  AS title,
            0      AS clicks,
            0      AS spend,
            0      AS orders,
            0      AS sales
          FROM CALBRIDGE_PROD.APP.PRODUCTS
          WHERE CLIENT_ID = ?
          ORDER BY ASIN
          LIMIT 50
        `, [clientId]);
      } catch (e2) {
        console.warn('[campaigns/create/asins] PRODUCTS fallback also failed:', e2.message);
      }
    }

    const results = (rows || []).map(r => ({
      asin:   r.ASIN   || r.asin   || '',
      title:  r.TITLE  || r.title  || '',
      clicks: Number(r.CLICKS || r.clicks || 0),
      spend:  Number(r.SPEND  || r.spend  || 0),
      orders: Number(r.ORDERS || r.orders || 0),
      sales:  Number(r.SALES  || r.sales  || 0),
    }));

    res.json(results);
  } catch (err) { next(err); }
});

/**
 * POST /campaigns/create
 * Creates a full SP or SB campaign via the Amazon Ads API.
 * Body: { adType, campaignName, budget, startDate, targetingType, bidStrategy,
 *         defaultBid, keywords: [{term, matchType, bid}], asins: [string],
 *         adGroupName, profileId }
 */
router.post('/create', requireAuth, requirePlan('decisions'), async (req, res, next) => {
  try {
    const clientId = await resolveClientId(req);
    const {
      adType,
      campaignName,
      budget,
      startDate,
      endDate,
      targetingType,
      bidStrategy,
      defaultBid,
      keywords = [],
      asins = [],
      adGroupName,
      profileId,
      // SD-specific
      sdTactic,
      sdBidOptimization,
      // SB-specific (passed through from body for logging)
      sbHeadline,
      sbLogoUrl,
      sbMainImgUrl,
    } = req.body;

    // Validate required fields
    const missing = [];
    if (!adType)        missing.push('adType');
    if (!campaignName)  missing.push('campaignName');
    if (!budget)        missing.push('budget');
    if (!startDate)     missing.push('startDate');
    if (!targetingType) missing.push('targetingType');
    if (!profileId)     missing.push('profileId');
    if (missing.length) {
      return res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
    }

    // Build ads API client
    const client = await adsClient(clientId, 'ads');
    const scope  = { headers: { 'Amazon-Advertising-API-Scope': String(profileId) } };

    let campaignId, adGroupId;

    if (adType === 'SP') {
      // ── 1. Create SP Campaign ──────────────────────────────────────────────
      const campaignPayload = [{
        name:          campaignName,
        campaignType:  'sponsoredProducts',
        targetingType: targetingType.toLowerCase(),  // 'manual' | 'auto'
        state:         'enabled',
        dailyBudget:   Number(budget),
        startDate:     startDate.replace(/-/g, ''),  // YYYYMMDD
        ...(endDate ? { endDate: endDate.replace(/-/g, '') } : {}),
        bidding: {
          strategy: bidStrategy || 'legacyForSales',
          adjustments: [],
        },
      }];

      let spCampRes;
      try {
        spCampRes = await client.post('/v2/sp/campaigns', campaignPayload, scope);
      } catch (apiErr) {
        const msg = apiErr.response?.data ? JSON.stringify(apiErr.response.data) : apiErr.message;
        await logCampaignCreateAction(clientId, 'unknown', 'create', 'failed', req.body, msg);
        return res.status(502).json({ success: false, error: `Amazon API error (SP campaign): ${msg}` });
      }

      const campResult = Array.isArray(spCampRes.data) ? spCampRes.data[0] : spCampRes.data;
      if (campResult?.code && campResult.code !== 'SUCCESS') {
        const msg = campResult.description || campResult.details || JSON.stringify(campResult);
        await logCampaignCreateAction(clientId, 'unknown', 'create', 'failed', req.body, msg);
        return res.status(400).json({ success: false, error: `Campaign creation failed: ${msg}` });
      }
      campaignId = String(campResult.campaignId || campResult.campaign_id);

      // ── 2. Create SP Ad Group ──────────────────────────────────────────────
      const adGroupPayload = [{
        name:       adGroupName || `${campaignName} - Ad Group 1`,
        campaignId: Number(campaignId),
        defaultBid: Number(defaultBid || 0.75),
        state:      'enabled',
      }];

      let spAGRes;
      try {
        spAGRes = await client.post('/v2/sp/adGroups', adGroupPayload, scope);
      } catch (apiErr) {
        const msg = apiErr.response?.data ? JSON.stringify(apiErr.response.data) : apiErr.message;
        await logCampaignCreateAction(clientId, campaignId, 'create', 'failed', req.body, msg);
        return res.status(502).json({ success: false, error: `Amazon API error (SP ad group): ${msg}` });
      }

      const agResult = Array.isArray(spAGRes.data) ? spAGRes.data[0] : spAGRes.data;
      adGroupId = String(agResult.adGroupId || agResult.ad_group_id);

      // ── 3. Create Product Ads (one per ASIN) ─────────────────────────────
      if (asins.length > 0) {
        const productAdsPayload = asins.map(asin => ({
          campaignId: Number(campaignId),
          adGroupId:  Number(adGroupId),
          asin,
          state: 'enabled',
        }));
        try {
          await client.post('/v2/sp/productAds', productAdsPayload, scope);
        } catch (apiErr) {
          console.warn('[CampaignCreate] SP productAds error (non-fatal):', apiErr.message);
        }
      }

      // ── 4. Create Keywords (manual) or Auto Targets (auto) ────────────────
      if (targetingType.toLowerCase() === 'manual' && keywords.length > 0) {
        const kwPayload = keywords.map(kw => ({
          campaignId: Number(campaignId),
          adGroupId:  Number(adGroupId),
          keywordText: kw.term,
          matchType:   (kw.matchType || 'broad').toLowerCase(),
          state:       'enabled',
          bid:         Number(kw.bid || defaultBid || 0.75),
        }));
        try {
          await client.post('/v2/sp/keywords', kwPayload, scope);
        } catch (apiErr) {
          console.warn('[CampaignCreate] SP keywords error (non-fatal):', apiErr.message);
        }
      } else if (targetingType.toLowerCase() === 'auto') {
        const autoTargetPayload = [{
          campaignId: Number(campaignId),
          adGroupId:  Number(adGroupId),
          state:      'enabled',
          expression: [{ type: 'asinCategorySameAs', value: 'close-match' }],
          expressionType: 'auto',
          bid: Number(defaultBid || 0.75),
        }];
        try {
          await client.post('/v2/sp/targets', autoTargetPayload, scope);
        } catch (apiErr) {
          console.warn('[CampaignCreate] SP auto targets error (non-fatal):', apiErr.message);
        }
      }

    } else if (adType === 'SD') {
      // ── Sponsored Display ────────────────────────────────────────────────
      // SD API: /sd/campaigns, /sd/adGroups, /sd/targets (product/audience targeting)
      // tactic: T00020 = product targeting (contextual), T00030 = audience/retargeting
      // bidOptimization: 'clicks' | 'reach' | 'conversions' | 'viewableImpressions'
      const tactic  = sdTactic || 'T00020'; // default: product targeting
      const bidOpt  = sdBidOptimization || 'clicks';

      // ── 1. Create SD Campaign ─────────────────────────────────────────────
      const sdCampaignPayload = {
        name:         campaignName,
        state:        'enabled',
        budget:       Number(budget),
        budgetType:   'daily',
        startDate:    startDate.replace(/-/g, ''),
        ...(endDate ? { endDate: endDate.replace(/-/g, '') } : {}),
        costType:     bidOpt === 'viewableImpressions' ? 'vcpm' : 'cpc',
        tactic,
      };

      let sdCampRes;
      try {
        sdCampRes = await client.post('/sd/campaigns', [sdCampaignPayload], scope);
      } catch (apiErr) {
        const msg = apiErr.response?.data ? JSON.stringify(apiErr.response.data) : apiErr.message;
        await logCampaignCreateAction(clientId, 'unknown', 'create', 'failed', req.body, msg);
        return res.status(502).json({ success: false, error: `Amazon API error (SD campaign): ${msg}` });
      }
      const sdCampResult = Array.isArray(sdCampRes.data) ? sdCampRes.data[0] : sdCampRes.data;
      if (sdCampResult?.code && sdCampResult.code !== 'SUCCESS') {
        const msg = sdCampResult.description || sdCampResult.details || JSON.stringify(sdCampResult);
        await logCampaignCreateAction(clientId, 'unknown', 'create', 'failed', req.body, msg);
        return res.status(400).json({ success: false, error: `SD campaign creation failed: ${msg}` });
      }
      campaignId = String(sdCampResult.campaignId || sdCampResult.campaign_id);

      // ── 2. Create SD Ad Group ─────────────────────────────────────────────
      const sdAGPayload = [{
        name:             adGroupName || `${campaignName} - Ad Group 1`,
        campaignId:       Number(campaignId),
        defaultBid:       Number(defaultBid || 0.75),
        bidOptimization:  bidOpt,
        state:            'enabled',
      }];
      let sdAGRes;
      try {
        sdAGRes = await client.post('/sd/adGroups', sdAGPayload, scope);
      } catch (apiErr) {
        const msg = apiErr.response?.data ? JSON.stringify(apiErr.response.data) : apiErr.message;
        await logCampaignCreateAction(clientId, campaignId, 'create', 'failed', req.body, msg);
        return res.status(502).json({ success: false, error: `Amazon API error (SD ad group): ${msg}` });
      }
      const sdAGResult = Array.isArray(sdAGRes.data) ? sdAGRes.data[0] : sdAGRes.data;
      adGroupId = String(sdAGResult.adGroupId || sdAGResult.ad_group_id);

      // ── 3. Create SD Product Ads (one per ASIN) ───────────────────────────
      if (asins.length > 0) {
        const sdProductAdsPayload = asins.map(asin => ({
          campaignId: Number(campaignId),
          adGroupId:  Number(adGroupId),
          asin,
          state: 'enabled',
        }));
        try {
          await client.post('/sd/productAds', sdProductAdsPayload, scope);
        } catch (apiErr) {
          console.warn('[CampaignCreate] SD productAds error (non-fatal):', apiErr.message);
        }
      }

      // ── 4. Create SD Targets ──────────────────────────────────────────────
      // T00020 = product targeting: expression type asinSameAs / asinCategorySameAs
      // T00030 = audience: expression type audiences (views/purchases remarketing)
      if (asins.length > 0 && tactic === 'T00020') {
        // Product targeting: target each selected ASIN
        const sdTargetPayload = asins.map(asin => ({
          campaignId:     Number(campaignId),
          adGroupId:      Number(adGroupId),
          state:          'enabled',
          bid:            Number(defaultBid || 0.75),
          expression:     [{ type: 'asinSameAs', value: asin }],
          expressionType: 'manual',
          resolvedExpression: [{ type: 'asinSameAs', value: asin }],
        }));
        try {
          await client.post('/sd/targets', sdTargetPayload, scope);
        } catch (apiErr) {
          console.warn('[CampaignCreate] SD targets error (non-fatal):', apiErr.message);
        }
      } else if (tactic === 'T00030') {
        // Audience retargeting: views + purchases remarketing on advertised ASINs
        const sdAudienceTargets = [
          { type: 'views', lookback: 30 },
          { type: 'purchases', lookback: 30 },
        ].map(({ type, lookback }) => ({
          campaignId:     Number(campaignId),
          adGroupId:      Number(adGroupId),
          state:          'enabled',
          bid:            Number(defaultBid || 0.75),
          expression:     [{ type: 'audiencesSameAs', value: `${type}:${lookback}d` }],
          expressionType: 'manual',
        }));
        try {
          await client.post('/sd/targets', sdAudienceTargets, scope);
        } catch (apiErr) {
          console.warn('[CampaignCreate] SD audience targets error (non-fatal):', apiErr.message);
        }
      }

    } else if (adType === 'SB') {
      // ── 1. Create SB Campaign ──────────────────────────────────────────────
      const sbCampaignPayload = {
        name:         campaignName,
        state:        'enabled',
        budget:       Number(budget),
        budgetType:   'daily',
        startDate:    startDate.replace(/-/g, ''),
        ...(endDate ? { endDate: endDate.replace(/-/g, '') } : {}),
        bidding: { bidOptimization: true },
        ...(sbHeadline ? { headline: sbHeadline } : {}),
      };

      let sbCampRes;
      try {
        sbCampRes = await client.post('/v2/sb/campaigns', sbCampaignPayload, scope);
      } catch (apiErr) {
        const msg = apiErr.response?.data ? JSON.stringify(apiErr.response.data) : apiErr.message;
        await logCampaignCreateAction(clientId, 'unknown', 'create', 'failed', req.body, msg);
        return res.status(502).json({ success: false, error: `Amazon API error (SB campaign): ${msg}` });
      }

      campaignId = String(sbCampRes.data?.campaignId || sbCampRes.data?.campaign_id);

      // ── 2. Create SB Ad Group ─────────────────────────────────────────────
      const sbAGPayload = {
        campaignId: Number(campaignId),
        name:       adGroupName || `${campaignName} - Ad Group 1`,
      };
      let sbAGRes;
      try {
        sbAGRes = await client.post('/v2/sb/adGroups', sbAGPayload, scope);
      } catch (apiErr) {
        console.warn('[CampaignCreate] SB adGroup error (non-fatal):', apiErr.message);
      }
      adGroupId = String(sbAGRes?.data?.adGroupId || sbAGRes?.data?.ad_group_id || '');

      // ── 3. Create SB Keywords (manual) ───────────────────────────────────
      if (keywords.length > 0) {
        const sbKwPayload = keywords.map(kw => ({
          campaignId:  Number(campaignId),
          adGroupId:   adGroupId ? Number(adGroupId) : undefined,
          keywordText: kw.term,
          matchType:   (kw.matchType || 'broad').toLowerCase(),
          state:       'enabled',
          bid:         Number(kw.bid || defaultBid || 0.75),
        }));
        try {
          await client.post('/v2/sb/keywords', sbKwPayload, scope);
        } catch (apiErr) {
          console.warn('[CampaignCreate] SB keywords error (non-fatal):', apiErr.message);
        }
      }

    } else {
      return res.status(400).json({ success: false, error: `Unknown adType: ${adType}. Use SP, SB, or SD.` });
    }

    // Log success
    const successPayload = {
      ...req.body,
      ...(sbLogoUrl    ? { sbLogoUrl }    : {}),
      ...(sbMainImgUrl ? { sbMainImgUrl } : {}),
    };
    await logCampaignCreateAction(clientId, campaignId, 'create', 'completed', successPayload, null);
    console.log(`[CampaignCreate] ${adType} campaign created — client=${clientId} campaign=${campaignId} adGroup=${adGroupId}`);

    res.json({ success: true, campaignId, adGroupId });
  } catch (err) { next(err); }
});

/**
 * Helper: log campaign create actions to campaign_actions table.
 */
async function logCampaignCreateAction(clientId, campaignId, actionType, status, payload, errorMsg) {
  try {
    const actionId = uuidv4();
    const fullPayload = errorMsg ? { ...payload, error: errorMsg } : payload;
    await query(
      `INSERT INTO campaign_actions (action_id, client_id, campaign_id, action_type, payload, status, executed_at)
       SELECT ?, ?, ?, ?, PARSE_JSON(?), ?, CURRENT_TIMESTAMP`,
      [actionId, clientId, String(campaignId || 'unknown'), actionType,
       JSON.stringify(fullPayload || {}), status]
    );
  } catch (e) {
    console.warn('[CampaignCreate] Could not log action:', e.message);
  }
}

/**
 * GET /campaigns/:id
 * Single campaign detail with daily performance trend.
 */
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const { id } = req.params;
    const days = Number(req.query.days) || 30;

    // Campaign details
    const campaignRows = await query(`
      SELECT
        c.campaign_id, c.campaign_name, c.campaign_type,
        c.connection_type, c.status, c.budget, 
        COALESCE(SUM(ap.impressions), 0) AS impressions,
        COALESCE(SUM(ap.clicks),      0) AS clicks,
        COALESCE(SUM(ap.spend),       0) AS spend,
        COALESCE(SUM(ap.sales),       0) AS sales,
        COALESCE(SUM(ap.orders),      0) AS orders,
        CASE WHEN SUM(ap.sales) > 0 THEN SUM(ap.spend) / SUM(ap.sales) ELSE NULL END AS acos,
        CASE WHEN SUM(ap.spend) > 0 THEN SUM(ap.sales) / SUM(ap.spend) ELSE NULL END AS roas
      FROM ad_campaigns c
      LEFT JOIN ad_performance ap
        ON c.client_id = ap.client_id
        AND c.campaign_id = ap.campaign_id
        AND c.connection_type = ap.connection_type
        AND ap.report_date >= DATEADD(day, -?, CURRENT_DATE)
      WHERE c.client_id = ?
        AND c.campaign_id = ?
      GROUP BY
        c.campaign_id, c.campaign_name, c.campaign_type,
        c.connection_type, c.status, c.budget
    `, [days, await resolveClientId(req), id]);

    if (!campaignRows || campaignRows.length === 0) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    // Daily performance trend
    const trendRows = await query(`
      SELECT
        report_date,
        SUM(impressions) AS impressions,
        SUM(clicks)      AS clicks,
        SUM(spend)       AS spend,
        SUM(sales)       AS sales,
        SUM(orders)      AS orders,
        CASE WHEN SUM(sales) > 0 THEN SUM(spend) / SUM(sales) ELSE NULL END AS acos,
        CASE WHEN SUM(spend) > 0 THEN SUM(sales) / SUM(spend) ELSE NULL END AS roas
      FROM ad_performance
      WHERE client_id    = ?
        AND campaign_id  = ?
        AND report_date >= DATEADD(day, -?, CURRENT_DATE)
      GROUP BY report_date
      ORDER BY report_date ASC
    `, [await resolveClientId(req), id, days]);

    // Pending actions for this campaign
    const actionRows = await query(`
      SELECT action_id, action_type, payload, status, created_at
      FROM campaign_actions
      WHERE client_id = ?
        AND campaign_id = ?
        AND status = 'pending'
      ORDER BY created_at DESC
    `, [await resolveClientId(req), id]);

    res.json({
      campaign: campaignRows[0],
      trend: trendRows,
      pendingActions: actionRows
    });
  } catch (err) { next(err); }
});

/**
 * POST /campaigns/:id/pause
 * GATED: Queue a pause action.
 */
router.post('/:id/pause', requireAuth, requirePlan('decisions'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const clientId = await resolveClientId(req);
    const actionId = await logCampaignAction(clientId, id, 'pause');
    console.log(`[CampaignAction] PAUSE queued — client=${clientId} campaign=${id} action=${actionId}`);
    res.json({
      status: 'queued',
      actionId,
      message: 'Campaign pause queued — will execute when write permissions are active'
    });
  } catch (err) { next(err); }
});

/**
 * POST /campaigns/:id/resume
 * GATED: Queue a resume action.
 */
router.post('/:id/resume', requireAuth, requirePlan('decisions'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const clientId = await resolveClientId(req);
    const actionId = await logCampaignAction(clientId, id, 'resume');
    console.log(`[CampaignAction] RESUME queued — client=${clientId} campaign=${id} action=${actionId}`);
    res.json({
      status: 'queued',
      actionId,
      message: 'Campaign resume queued — will execute when write permissions are active'
    });
  } catch (err) { next(err); }
});

/**
 * PATCH /campaigns/:id/budget
 * GATED: Queue a budget update.
 * Body: { budget: number }
 */
router.patch('/:id/budget', requireAuth, requirePlan('decisions'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { budget } = req.body;
    if (budget == null || isNaN(Number(budget)) || Number(budget) <= 0) {
      return res.status(400).json({ error: 'budget must be a positive number' });
    }
    const clientId = await resolveClientId(req);
    const actionId = await logCampaignAction(clientId, id, 'update_budget', { budget: Number(budget) });
    console.log(`[CampaignAction] UPDATE_BUDGET queued — client=${clientId} campaign=${id} budget=${budget} action=${actionId}`);
    res.json({
      status: 'queued',
      actionId,
      message: 'Budget update queued — will execute when write permissions are active'
    });
  } catch (err) { next(err); }
});

/**
 * PATCH /campaigns/:id/bids
 * GATED: Queue a bid update.
 * Body: { bid: number }
 */
router.patch('/:id/bids', requireAuth, requirePlan('decisions'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { bid } = req.body;
    if (bid == null || isNaN(Number(bid)) || Number(bid) <= 0) {
      return res.status(400).json({ error: 'bid must be a positive number' });
    }
    const clientId = await resolveClientId(req);
    const actionId = await logCampaignAction(clientId, id, 'update_bids', { bid: Number(bid) });
    console.log(`[CampaignAction] UPDATE_BIDS queued — client=${clientId} campaign=${id} bid=${bid} action=${actionId}`);
    res.json({
      status: 'queued',
      actionId,
      message: 'Bid update queued — will execute when write permissions are active'
    });
  } catch (err) { next(err); }
});


module.exports = router;
module.exports.ensureCampaignActionsTable = ensureCampaignActionsTable;
