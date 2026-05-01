const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const authService = require('./authService');
const { query } = require('./snowflakeService');
const { encrypt, decrypt } = require('./tokenEncryption');

const LWA_AUTH_URL    = 'https://www.amazon.com/ap/oa';
const LWA_TOKEN_URL   = 'https://api.amazon.com/auth/o2/token';

// SP-API uses the Seller/Vendor Central consent page, not the generic LWA URL
const SELLER_CONSENT_URL = 'https://sellercentral.amazon.com/apps/authorize/consent';
const VENDOR_CONSENT_URL = 'https://vendorcentral.amazon.com/apps/authorize/consent';

const IS_PROD = process.env.NODE_ENV === 'production';

const LWA_CLIENT_ID     = process.env.LWA_CLIENT_ID;
const LWA_CLIENT_SECRET = process.env.LWA_CLIENT_SECRET;
const BASE_URL          = process.env.BASE_URL || 'http://localhost:3000';

// SP-API application ID (amzn1.sp.solution.xxx) — used for the consent page URL
const SPAPI_APP_ID = process.env.SPAPI_APP_ID;

// Use production SP-API credentials when in production, sandbox otherwise
const SPAPI_CLIENT_ID     = IS_PROD
  ? process.env.SPAPI_PROD_CLIENT_ID
  : process.env.SPAPI_CLIENT_ID;
const SPAPI_CLIENT_SECRET = IS_PROD
  ? process.env.SPAPI_PROD_CLIENT_SECRET
  : process.env.SPAPI_CLIENT_SECRET;

// Connection types
const CONNECTIONS = {
  ads:    { label: 'Amazon Ads',            scope: 'advertising::campaign_management', api: 'advertising' },
  dsp:    { label: 'Amazon DSP',            scope: 'advertising::campaign_management', api: 'advertising' },
  seller: { label: 'Amazon Seller Central', scope: 'sellingpartnerapi::migration',     api: 'spapi', consentUrl: SELLER_CONSENT_URL },
  vendor: { label: 'Amazon Vendor Central', scope: 'sellingpartnerapi::migration',     api: 'spapi', consentUrl: VENDOR_CONSENT_URL }
};

// State store — single-use, short-lived (in-memory for dev; move to Redis in prod)
const stateStore = new Map();

// Pending connection store — holds token + profile list while user picks a profile
// Key: pendingId (uuid), Value: { clientId, type, tokens, profiles, createdAt }
const pendingStore = new Map();

// Prune expired states (10 min) + pending entries (30 min) every 10 minutes
setInterval(() => {
  const stateCutoff   = Date.now() - 10 * 60 * 1000;
  const pendingCutoff = Date.now() - 30 * 60 * 1000;
  for (const [key, val] of stateStore.entries()) {
    if (val.createdAt < stateCutoff) stateStore.delete(key);
  }
  for (const [key, val] of pendingStore.entries()) {
    if (val.createdAt < pendingCutoff) pendingStore.delete(key);
  }
}, 10 * 60 * 1000);

/**
 * Build the authorization URL for any of the 4 connection types.
 *
 * - Advertising (ads/dsp): LWA generic OAuth flow (amazon.com/ap/oa)
 * - SP-API (seller/vendor): Seller/Vendor Central consent page flow
 *   Per Amazon docs, SP-API authorization uses:
 *   https://sellercentral.amazon.com/apps/authorize/consent?application_id=...
 *   https://vendorcentral.amazon.com/apps/authorize/consent?application_id=...
 */
function getAuthUrl(type, clientId) {
  const conn = CONNECTIONS[type];
  if (!conn) throw new Error(`Unknown connection type: ${type}`);

  const state = uuidv4();
  stateStore.set(state, { clientId, type, createdAt: Date.now() });

  if (conn.api === 'spapi') {
    // SP-API: redirect to Seller/Vendor Central consent page
    if (!SPAPI_APP_ID) throw new Error('SPAPI_APP_ID is not configured');
    const params = new URLSearchParams({
      application_id: SPAPI_APP_ID,
      state,
      redirect_uri:   `${BASE_URL}/amazon/callback/${type}`,
      // NOTE: do NOT include version=beta in production — that routes to the draft
      // app which may not have all roles approved. Omitting version uses the live app.
    });
    return `${conn.consentUrl}?${params.toString()}`;
  }

  // Advertising API: standard LWA OAuth flow
  const scopeData = JSON.stringify({
    [conn.scope]: { essential: true }
  });

  const params = new URLSearchParams({
    client_id:     LWA_CLIENT_ID,
    scope:         conn.scope,
    scope_data:    scopeData,
    response_type: 'code',
    redirect_uri:  `${BASE_URL}/amazon/callback/${type}`,
    state
  });

  return `${LWA_AUTH_URL}?${params.toString()}`;
}

/**
 * Exchange auth code for access + refresh tokens
 */
async function exchangeCode({ code, type }) {
  const conn = CONNECTIONS[type];
  const clientId     = conn.api === 'spapi' ? SPAPI_CLIENT_ID     : LWA_CLIENT_ID;
  const clientSecret = conn.api === 'spapi' ? SPAPI_CLIENT_SECRET  : LWA_CLIENT_SECRET;

  const response = await axios.post(LWA_TOKEN_URL, new URLSearchParams({
    grant_type:    'authorization_code',
    code,
    redirect_uri:  `${BASE_URL}/amazon/callback/${type}`,
    client_id:     clientId,
    client_secret: clientSecret
  }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

  const { access_token, refresh_token, expires_in } = response.data;
  return {
    accessToken:  access_token,
    refreshToken: refresh_token,
    expiresAt:    new Date(Date.now() + expires_in * 1000).toISOString()
  };
}

/**
 * Refresh an access token using a stored refresh token
 */
async function refreshAccessToken({ refreshToken, type }) {
  const conn = CONNECTIONS[type];
  const clientId     = conn.api === 'spapi' ? SPAPI_CLIENT_ID     : LWA_CLIENT_ID;
  const clientSecret = conn.api === 'spapi' ? SPAPI_CLIENT_SECRET  : LWA_CLIENT_SECRET;

  const response = await axios.post(LWA_TOKEN_URL, new URLSearchParams({
    grant_type:    'refresh_token',
    refresh_token: refreshToken,
    client_id:     clientId,
    client_secret: clientSecret
  }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 30000 });

  const { access_token, expires_in } = response.data;
  return {
    accessToken: access_token,
    expiresAt:   new Date(Date.now() + expires_in * 1000).toISOString()
  };
}

/**
 * Get a valid access token for a client+type, auto-refreshing if needed.
 *
 * Read order (Phase 2a dual-path):
 *  1. In-process cache (fast path, no DB hit)
 *  2. client_credentials table (new path)
 *  3. clients.connections JSON (legacy fallback)
 *
 * On refresh: writes back to BOTH client_credentials AND clients.connections.
 */
// In-process token cache: avoid hitting Snowflake on every call within the same Node process.
// Key: `${clientId}:${type}`, value: { accessToken, expiresAt (ms), credentialId (optional) }
const _tokenCache = new Map();

async function getValidToken(clientId, type) {
  const cacheKey = `${clientId}:${type}`;
  const cached = _tokenCache.get(cacheKey);
  // Use cache if token is valid for >30 more minutes
  if (cached && cached.expiresAt - Date.now() > 30 * 60 * 1000) {
    return cached.accessToken;
  }

  // ── Path 1: amazon_connections table (new schema) ───────────────────────────
  let credRow = null;
  try {
    const rows = await query(`
      SELECT credential_id, access_token, refresh_token, expires_at AS token_expires_at
      FROM   CALBRIDGE_PROD.APP.amazon_connections
      WHERE  client_id = ?
        AND  connection_type = ?
        AND  (is_active IS NULL OR is_active = TRUE)
      ORDER  BY connected_at DESC
      LIMIT  1
    `, [clientId, type]);
    if (rows.length > 0) credRow = rows[0];
  } catch (err) {
    console.warn(`[AmazonAuth] amazon_connections lookup failed (falling back): ${err.message}`);
  }

  if (credRow) {
    const accessToken  = decrypt(credRow.ACCESS_TOKEN);
    const refreshToken = decrypt(credRow.REFRESH_TOKEN);
    const credentialId = credRow.CREDENTIAL_ID;
    const expiresAt    = credRow.TOKEN_EXPIRES_AT ? new Date(credRow.TOKEN_EXPIRES_AT).getTime() : 0;
    const shouldRefresh = expiresAt - Date.now() < 30 * 60 * 1000;

    if (shouldRefresh) {
      const refreshed = await refreshAccessToken({ refreshToken, type });
      const newExpiresAt = new Date(refreshed.expiresAt).getTime();
      const newExpiresAtSf = refreshed.expiresAt.replace('T', ' ').replace('Z', '');

      // Write back to amazon_connections (encrypt before storing)
      try {
        await query(`
          UPDATE CALBRIDGE_PROD.APP.amazon_connections
          SET    access_token = ?,
                 expires_at   = ?,
                 updated_at   = CURRENT_TIMESTAMP()
          WHERE  credential_id = ?
        `, [encrypt(refreshed.accessToken), newExpiresAtSf, credentialId]);
      } catch (err) {
        console.warn(`[AmazonAuth] Failed to update amazon_connections on refresh: ${err.message}`);
      }

      // Write back to clients.connections (legacy path — keep in sync during Phase 2)
      try {
        const client = await authService.getById(clientId);
        const conn = client.connections?.[type] || {};
        const updated = { ...conn, accessToken: refreshed.accessToken, expiresAt: refreshed.expiresAt };
        const connections = { ...(client.connections || {}), [type]: updated };
        await authService.updateClient(clientId, { connections });
      } catch (err) {
        console.warn(`[AmazonAuth] Failed to update clients.connections on refresh: ${err.message}`);
      }

      _tokenCache.set(cacheKey, { accessToken: refreshed.accessToken, expiresAt: newExpiresAt, credentialId });
      return refreshed.accessToken;
    }

    _tokenCache.set(cacheKey, { accessToken, expiresAt, credentialId });
    return accessToken;
  }

  // ── Path 2: legacy clients.connections fallback ────────────────────────────
  console.log(`[AmazonAuth] No client_credentials row for ${clientId}/${type} — falling back to clients.connections`);
  const client = await authService.getById(clientId);
  const conn = client.connections?.[type];
  if (!conn) throw Object.assign(new Error(`${type} not connected`), { status: 401 });

  const expiresAt = new Date(conn.expiresAt).getTime();
  const shouldRefresh = expiresAt - Date.now() < 30 * 60 * 1000; // refresh if <30 min left

  if (shouldRefresh) {
    const refreshed = await refreshAccessToken({ refreshToken: conn.refreshToken, type });
    const updated = { ...conn, ...refreshed };
    const connections = { ...(client.connections || {}), [type]: updated };
    await authService.updateClient(clientId, { connections });
    _tokenCache.set(cacheKey, { accessToken: updated.accessToken, expiresAt: new Date(updated.expiresAt).getTime() });
    return updated.accessToken;
  }

  _tokenCache.set(cacheKey, { accessToken: conn.accessToken, expiresAt });
  return conn.accessToken;
}

// Map from connection type → client_accounts.channel
const TYPE_TO_CHANNEL = {
  ads:    'sponsored_ads',
  dsp:    'dsp',
  seller: 'seller',
  vendor: 'vendor',
};

/**
 * Handle OAuth callback for any connection type.
 *
 * Phase 3: writes tokens to amazon_connections ONLY.
 * clients.connections (legacy) is NO LONGER written on new OAuth connects.
 * The read fallback to clients.connections remains in getValidToken() so
 * existing tokens continue to work until they expire naturally.
 */
async function handleCallback({ clientId, code, state, type, extra = {} }) {
  const stateData = stateStore.get(state);
  if (!stateData || stateData.clientId !== clientId || stateData.type !== type) {
    throw Object.assign(new Error('Invalid or expired OAuth state'), { status: 400 });
  }
  stateStore.delete(state);

  const tokens = await exchangeCode({ code, type });
  const connectedAt = new Date().toISOString();

  // ── Write: amazon_connections only (Phase 3 — legacy dual-write removed) ─────────────
  try {
    // Look up account_id from client_accounts
    const channel = TYPE_TO_CHANNEL[type];
    let accountId = null;
    if (channel) {
      const acctRows = await query(`
        SELECT account_id
        FROM   CALBRIDGE_PROD.APP.client_accounts
        WHERE  client_id = ?
          AND  channel   = ?
          AND  is_active = TRUE
        LIMIT  1
      `, [clientId, channel]);
      if (acctRows.length > 0) accountId = acctRows[0].ACCOUNT_ID;
    }

    const tokenExpiresAtSf = tokens.expiresAt
      ? tokens.expiresAt.replace('T', ' ').replace('Z', '')
      : null;
    const connectedAtSf = connectedAt.replace('T', ' ').replace('Z', '');

    // Check if a credential row already exists for this client + type
    const existing = await query(`
      SELECT credential_id
      FROM   CALBRIDGE_PROD.APP.amazon_connections
      WHERE  client_id = ?
        AND  connection_type = ?
      LIMIT  1
    `, [clientId, type]);

    if (existing.length > 0) {
      // UPDATE existing row (encrypt tokens before storing)
      await query(`
        UPDATE CALBRIDGE_PROD.APP.amazon_connections
        SET    account_id    = ?,
               access_token  = ?,
               refresh_token = ?,
               expires_at    = ?,
               connected_at  = ?,
               is_active     = TRUE,
               updated_at    = CURRENT_TIMESTAMP()
        WHERE  credential_id = ?
      `, [
        accountId,
        encrypt(tokens.accessToken),
        encrypt(tokens.refreshToken),
        tokenExpiresAtSf,
        connectedAtSf,
        existing[0].CREDENTIAL_ID,
      ]);
    } else {
      // INSERT new row (encrypt tokens before storing)
      const credentialId = uuidv4();
      await query(`
        INSERT INTO CALBRIDGE_PROD.APP.amazon_connections
          (credential_id, account_id, client_id, connection_type,
           access_token, refresh_token, expires_at, connected_at,
           is_active, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, TRUE, CURRENT_TIMESTAMP())
      `, [
        credentialId,
        accountId,
        clientId,
        type,
        encrypt(tokens.accessToken),
        encrypt(tokens.refreshToken),
        tokenExpiresAtSf,
        connectedAtSf,
      ]);
    }

    // Invalidate in-process cache so next read picks up fresh token
    _tokenCache.delete(`${clientId}:${type}`);

    console.log(`[Amazon] ${CONNECTIONS[type].label} connected for client ${clientId} — connected OK${accountId ? ` (account=${accountId})` : ''}`);

    // ── Trigger historical backfill on first-time vendor or seller connection ──
    // Fire-and-forget in background so the OAuth redirect is not blocked.
    // Only runs when a vendor or seller account is newly connected (INSERT path).
    if (type === 'vendor' && existing.length === 0) {
      console.log(`[Amazon] First vendor connection for ${clientId} — triggering vendor historical backfill`);
      setImmediate(async () => {
        try {
          const { runVendorBackfill } = require('../jobs/vendorBackfill');
          await runVendorBackfill(clientId);
        } catch (bfErr) {
          console.error(`[Amazon] Vendor historical backfill failed for ${clientId}:`, bfErr.message);
        }
      });
    }
    if (type === 'seller' && existing.length === 0) {
      console.log(`[Amazon] First seller connection for ${clientId} — triggering seller historical backfill`);
      setImmediate(async () => {
        try {
          const { sellerBackfill } = require('../jobs/sellerIngestion');
          await sellerBackfill(clientId);
        } catch (bfErr) {
          console.error(`[Amazon] Seller historical backfill failed for ${clientId}:`, bfErr.message);
        }
      });
    }
  } catch (err) {
    console.error(`[Amazon] amazon_connections write failed: ${err.message}`);
    throw err; // re-throw — without amazon_connections we have no token stored
  }
}

/**
 * Step 1 of the profile-picker flow (ads/dsp only).
 * Exchanges the OAuth code, fetches the profile list, stores everything in
 * pendingStore, and returns { pendingId, profiles } to the caller.
 * No DB writes happen yet — those happen in confirmProfile().
 */
async function handleCallbackPending({ clientId, code, state, type }) {
  const stateData = stateStore.get(state);
  if (!stateData || stateData.clientId !== clientId || stateData.type !== type) {
    throw Object.assign(new Error('Invalid or expired OAuth state'), { status: 400 });
  }
  stateStore.delete(state);

  const tokens = await exchangeCode({ code, type });

  // Fetch all profiles visible to this token
  let profiles = [];
  try {
    const axios = require('axios');
    const res = await axios.default.get('https://advertising-api.amazon.com/v2/profiles', {
      headers: {
        'Authorization':                   `Bearer ${tokens.accessToken}`,
        'Amazon-Advertising-API-ClientId':  LWA_CLIENT_ID,
      },
      timeout: 10000,
    });
    profiles = (res.data || []).map(p => ({
      profileId:   String(p.profileId),
      name:        p.accountInfo?.name || '',
      type:        p.accountInfo?.type || '',
      countryCode: p.countryCode || 'US',
      currency:    p.currencyCode || 'USD',
      entityId:    p.accountInfo?.id || '',
    }));
  } catch (err) {
    console.warn('[Amazon] handleCallbackPending: profile fetch failed:', err.response?.data || err.message);
    // Still store the token — user won't be able to pick a profile but at least token is preserved
  }

  // For DSP: also fetch advertisers under each agency profile so the
  // UI can show a two-level picker (agency profile → DSP advertiser).
  let dspAdvertisersByProfile = null;
  if (type === 'dsp' && profiles.length > 0) {
    try {
      const axios = require('axios');
      dspAdvertisersByProfile = {};
      for (const p of profiles) {
        try {
          const advRes = await axios.default.get('https://advertising-api.amazon.com/dsp/advertisers', {
            headers: {
              'Authorization':                   `Bearer ${tokens.accessToken}`,
              'Amazon-Advertising-API-ClientId':  LWA_CLIENT_ID,
              'Amazon-Advertising-API-Scope':     p.profileId,
            },
            params: { pageSize: 100 },
            timeout: 10000,
          });
          const advData = advRes.data?.response || advRes.data?.advertisers || advRes.data || [];
          dspAdvertisersByProfile[p.profileId] = (Array.isArray(advData) ? advData : []).map(a => ({
            advertiserId: String(a.advertiserId || a.id || ''),
            name:         a.name || a.advertiserName || String(a.advertiserId || a.id || ''),
          })).filter(a => a.advertiserId);
        } catch (advErr) {
          console.warn(`[Amazon] DSP advertiser fetch failed for profile ${p.profileId}:`, advErr.response?.data || advErr.message);
          dspAdvertisersByProfile[p.profileId] = [];
        }
      }
    } catch (err) {
      console.warn('[Amazon] DSP advertiser fetch outer error:', err.message);
    }
  }

  const pendingId = uuidv4();
  pendingStore.set(pendingId, { clientId, type, tokens, profiles, dspAdvertisersByProfile, createdAt: Date.now() });

  return { pendingId, profiles };
}

/**
 * Step 2 of the profile-picker flow.
 * Called after the user selects their profile(s).
 * Writes the token to amazon_connections and the selected profiles to client_accounts.
 */
async function confirmProfile({ pendingId, clientId, selectedProfileIds }) {
  const pending = pendingStore.get(pendingId);
  if (!pending || pending.clientId !== clientId) {
    throw Object.assign(new Error('Invalid or expired pending connection'), { status: 400 });
  }
  pendingStore.delete(pendingId);

  const { type, tokens, profiles, dspAdvertisersByProfile } = pending;
  const connectedAt    = new Date().toISOString();
  const connectedAtSf  = connectedAt.replace('T', ' ').replace('Z', '');
  const tokenExpiresAtSf = tokens.expiresAt ? tokens.expiresAt.replace('T', ' ').replace('Z', '') : null;
  const channel        = TYPE_TO_CHANNEL[type];

  // ── Write token to amazon_connections ──────────────────────────────────────
  const existing = await query(`
    SELECT credential_id FROM CALBRIDGE_PROD.APP.amazon_connections
    WHERE client_id = ? AND connection_type = ? LIMIT 1
  `, [clientId, type]);

  if (existing.length > 0) {
    await query(`
      UPDATE CALBRIDGE_PROD.APP.amazon_connections
      SET access_token = ?, refresh_token = ?, expires_at = ?,
          connected_at = ?, is_active = TRUE, updated_at = CURRENT_TIMESTAMP()
      WHERE credential_id = ?
    `, [encrypt(tokens.accessToken), encrypt(tokens.refreshToken), tokenExpiresAtSf, connectedAtSf, existing[0].CREDENTIAL_ID]);
  } else {
    await query(`
      INSERT INTO CALBRIDGE_PROD.APP.amazon_connections
        (credential_id, client_id, connection_type, access_token, refresh_token,
         expires_at, connected_at, is_active, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, TRUE, CURRENT_TIMESTAMP())
    `, [uuidv4(), clientId, type, encrypt(tokens.accessToken), encrypt(tokens.refreshToken), tokenExpiresAtSf, connectedAtSf]);
  }
  _tokenCache.delete(`${clientId}:${type}`);

  // ── Write selected profiles to client_accounts ─────────────────────────────
  if (channel && selectedProfileIds && selectedProfileIds.length > 0) {
    // Deactivate existing entries for this channel so we start clean
    await query(`
      UPDATE CALBRIDGE_PROD.APP.client_accounts
      SET is_active = FALSE
      WHERE client_id = ? AND channel = ?
    `, [clientId, channel]);

    if (type === 'dsp' && dspAdvertisersByProfile) {
      // DSP two-level flow: selectedProfileIds contains "agencyProfileId|advertiserId" pairs.
      // Write one row per advertiser with agency_profile_id + platform_profile_id (advertiser).
      for (const combo of selectedProfileIds) {
        const [agencyProfileId, advertiserId] = combo.split('|');
        if (!agencyProfileId || !advertiserId) continue;

        const agencyProfile = profiles.find(p => p.profileId === agencyProfileId);
        const advertiserList = dspAdvertisersByProfile[agencyProfileId] || [];
        const advertiser = advertiserList.find(a => a.advertiserId === advertiserId);
        const accountName = advertiser?.name || agencyProfile?.name || 'DSP Advertiser';

        const existingRow = await query(`
          SELECT account_id FROM CALBRIDGE_PROD.APP.client_accounts
          WHERE client_id = ? AND channel = ? AND platform_profile_id = ? LIMIT 1
        `, [clientId, channel, advertiserId]);

        if (existingRow.length > 0) {
          await query(`
            UPDATE CALBRIDGE_PROD.APP.client_accounts
            SET is_active = TRUE, agency_profile_id = ?, account_name = ?, updated_at = CURRENT_TIMESTAMP()
            WHERE client_id = ? AND channel = ? AND platform_profile_id = ?
          `, [agencyProfileId, accountName, clientId, channel, advertiserId]);
        } else {
          await query(`
            INSERT INTO CALBRIDGE_PROD.APP.client_accounts
              (account_id, client_id, channel, platform_profile_id, agency_profile_id, account_name, is_active)
            VALUES (?, ?, ?, ?, ?, ?, TRUE)
          `, [uuidv4(), clientId, channel, advertiserId, agencyProfileId, accountName]);
        }
      }
    } else {
      // Ads (SP/SB/SD): single-level — selectedProfileIds contains plain profileIds
      const selectedProfiles = profiles.filter(p => selectedProfileIds.includes(p.profileId));
      for (const p of selectedProfiles) {
        const existingRow = await query(`
          SELECT account_id FROM CALBRIDGE_PROD.APP.client_accounts
          WHERE client_id = ? AND channel = ? AND platform_profile_id = ? LIMIT 1
        `, [clientId, channel, p.profileId]);

        if (existingRow.length > 0) {
          await query(`
            UPDATE CALBRIDGE_PROD.APP.client_accounts
            SET is_active = TRUE, account_name = COALESCE(account_name, ?), updated_at = CURRENT_TIMESTAMP()
            WHERE client_id = ? AND channel = ? AND platform_profile_id = ?
          `, [p.name || 'Sponsored Ads', clientId, channel, p.profileId]);
        } else {
          await query(`
            INSERT INTO CALBRIDGE_PROD.APP.client_accounts
              (account_id, client_id, channel, platform_profile_id, account_name, is_active)
            VALUES (?, ?, ?, ?, ?, TRUE)
          `, [uuidv4(), clientId, channel, p.profileId, p.name || 'Sponsored Ads']);
        }

        // Also upsert brands table for SP/SB/SD
        await query(`
          MERGE INTO CALBRIDGE_PROD.APP.brands tgt
          USING (SELECT ? AS client_id, ? AS ads_profile_id) src
          ON tgt.client_id = src.client_id AND tgt.ads_profile_id = src.ads_profile_id
          WHEN MATCHED THEN UPDATE SET is_active = TRUE, name = ?
          WHEN NOT MATCHED THEN INSERT (brand_id, client_id, ads_profile_id, name, is_active)
            VALUES (?, ?, ?, ?, TRUE)
        `, [clientId, p.profileId, p.name, uuidv4(), clientId, p.profileId, p.name]);
      }
    }
  }

  console.log(`[Amazon] ${CONNECTIONS[type]?.label} confirmed for client ${clientId} — profiles: ${selectedProfileIds?.join(', ')}`);
  return { ok: true, type, selectedProfileIds };
}

/**
 * Get connection status for all 4 types for a client.
 *
 * Phase 2c dual-source: merges data from BOTH:
 *  1. clients.connections (legacy JSON) — always read
 *  2. client_accounts + amazon_connections (new schema) — OR logic
 *
 * For each channel: if EITHER source says connected → connected=true.
 * Prefers amazon_connections for connected_at / expires_at when available.
 */
async function getConnectionStatus(clientId) {
  const client = await authService.getById(clientId);
  const connections = client.connections || {};

  // ── Source 2: client_accounts + amazon_connections (new schema) ────────────
  // channel in client_accounts maps to: ads→sponsored_ads, dsp→dsp, seller→seller, vendor→vendor
  const CHANNEL_TO_TYPE = {
    sponsored_ads: 'ads',
    dsp:           'dsp',
    seller:        'seller',
    vendor:        'vendor',
  };

  let acctRows = [];
  try {
    acctRows = await query(`
      SELECT ca.channel,
             ca.account_id,
             ac.connected_at,
             ac.expires_at    AS token_expires_at
      FROM   CALBRIDGE_PROD.APP.client_accounts ca
      LEFT JOIN CALBRIDGE_PROD.APP.amazon_connections ac
             ON ac.client_id       = ca.client_id
            AND ac.connection_type = CASE ca.channel
                                       WHEN 'sponsored_ads' THEN 'ads'
                                       WHEN 'dsp'           THEN 'dsp'
                                       WHEN 'seller'        THEN 'seller'
                                       WHEN 'vendor'        THEN 'vendor'
                                     END
            AND (ac.is_active IS NULL OR ac.is_active = TRUE)
      WHERE  ca.client_id = ?
        AND  ca.is_active = TRUE
    `, [clientId]);
  } catch (err) {
    console.warn(`[AmazonAuth] getConnectionStatus: client_accounts lookup failed (falling back): ${err.message}`);
  }

  // Build a map: type → { connected_at, token_expires_at, account_id } from new schema
  const newSchemaByType = {};
  for (const row of acctRows) {
    const ch   = (row.CHANNEL || row.channel || '').toLowerCase();
    const type = CHANNEL_TO_TYPE[ch];
    if (!type) continue;
    newSchemaByType[type] = {
      connectedAt: row.CONNECTED_AT   || row.connected_at   || null,
      expiresAt:   row.TOKEN_EXPIRES_AT || row.token_expires_at || null,
      accountId:   row.ACCOUNT_ID     || row.account_id     || null,
    };
  }

  return Object.fromEntries(
    Object.entries(CONNECTIONS).map(([type, meta]) => {
      const legacyConn  = connections[type];      // legacy path
      const newConn     = newSchemaByType[type];  // new schema path
      const isConnected = !!(legacyConn || newConn); // OR logic

      if (!isConnected) return [type, { connected: false, label: meta.label }];

      // Prefer new schema for timestamps (more reliable); fall back to legacy
      const connectedAt = newConn?.connectedAt || legacyConn?.connectedAt || null;
      const expiresAt   = newConn?.expiresAt   || legacyConn?.expiresAt   || null;

      return [type, {
        connected:  true,
        label:      meta.label,
        connectedAt,
        expiresAt,
        ...(legacyConn?.sellingPartnerId ? { sellingPartnerId: legacyConn.sellingPartnerId } : {}),
        ...(newConn?.accountId           ? { accountId: newConn.accountId }                  : {}),
      }];
    })
  );
}

/**
 * Returns pending connection data for the profile picker UI.
 * Enriches profiles with currentlyActive flag from client_accounts.
 */
async function getPendingProfiles(pendingId, clientId) {
  const pending = pendingStore.get(pendingId);
  if (!pending || pending.clientId !== clientId) return null;

  // Mark which profiles are already active for this client
  let activeIds = new Set();
  try {
    const channel = TYPE_TO_CHANNEL[pending.type];
    if (channel) {
      const rows = await query(`
        SELECT platform_profile_id FROM CALBRIDGE_PROD.APP.client_accounts
        WHERE client_id = ? AND channel = ? AND is_active = TRUE
      `, [clientId, channel]);
      activeIds = new Set(rows.map(r => String(r.PLATFORM_PROFILE_ID || r.platform_profile_id)));
    }
  } catch (_) {}

  const profiles = pending.profiles.map(p => ({
    ...p,
    currentlyActive: activeIds.has(p.profileId),
  }));

  return { profiles, type: pending.type, dspAdvertisersByProfile: pending.dspAdvertisersByProfile || null };
}

module.exports = {
  getAuthUrl,
  handleCallback,
  handleCallbackPending,
  confirmProfile,
  getPendingProfiles,
  getConnectionStatus,
  getValidToken,
  refreshAccessToken,
  CONNECTIONS
};
