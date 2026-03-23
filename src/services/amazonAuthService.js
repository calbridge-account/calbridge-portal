const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const authService = require('./authService');

const LWA_AUTH_URL = 'https://www.amazon.com/ap/oa';
const LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token';

const {
  LWA_CLIENT_ID,
  LWA_CLIENT_SECRET,
  SPAPI_CLIENT_ID,
  SPAPI_CLIENT_SECRET,
  BASE_URL = 'http://localhost:3000'
} = process.env;

// Connection types
const CONNECTIONS = {
  ads:    { label: 'Amazon Ads',            scope: 'advertising::campaign_management', api: 'advertising' },
  dsp:    { label: 'Amazon DSP',            scope: 'advertising::campaign_management', api: 'advertising' },
  seller: { label: 'Amazon Seller Central', scope: 'sellingpartnerapi::migration',     api: 'spapi' },
  vendor: { label: 'Amazon Vendor Central', scope: 'sellingpartnerapi::migration',     api: 'spapi' }
};

// State store — single-use, short-lived (in-memory for dev; move to Redis in prod)
const stateStore = new Map();

// Prune expired states every 10 minutes
setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [key, val] of stateStore.entries()) {
    if (val.createdAt < cutoff) stateStore.delete(key);
  }
}, 10 * 60 * 1000);

/**
 * Build the LWA authorization URL for any of the 4 connection types
 */
function getAuthUrl(type, clientId) {
  const conn = CONNECTIONS[type];
  if (!conn) throw new Error(`Unknown connection type: ${type}`);

  const state = uuidv4();
  stateStore.set(state, { clientId, type, createdAt: Date.now() });

  // SP-API uses the SP-API client ID; Advertising uses LWA client ID
  const clientIdToUse = conn.api === 'spapi' ? SPAPI_CLIENT_ID : LWA_CLIENT_ID;

  const params = new URLSearchParams({
    client_id: clientIdToUse,
    scope: conn.scope,
    response_type: 'code',
    redirect_uri: `${BASE_URL}/amazon/callback/${type}`,
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
  }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

  const { access_token, expires_in } = response.data;
  return {
    accessToken: access_token,
    expiresAt:   new Date(Date.now() + expires_in * 1000).toISOString()
  };
}

/**
 * Get a valid access token for a client+type, auto-refreshing if needed
 */
async function getValidToken(clientId, type) {
  const client = await authService.getById(clientId);
  const conn = client.connections?.[type];
  if (!conn) throw Object.assign(new Error(`${type} not connected`), { status: 401 });

  const expiresAt = new Date(conn.expiresAt).getTime();
  const shouldRefresh = expiresAt - Date.now() < 5 * 60 * 1000; // refresh if <5 min left

  if (shouldRefresh) {
    const refreshed = await refreshAccessToken({ refreshToken: conn.refreshToken, type });
    const updated = { ...conn, ...refreshed };
    const connections = { ...(client.connections || {}), [type]: updated };
    await authService.updateClient(clientId, { connections });
    return updated.accessToken;
  }

  return conn.accessToken;
}

/**
 * Handle OAuth callback for any connection type
 */
async function handleCallback({ clientId, code, state, type, extra = {} }) {
  const stateData = stateStore.get(state);
  if (!stateData || stateData.clientId !== clientId || stateData.type !== type) {
    throw Object.assign(new Error('Invalid or expired OAuth state'), { status: 400 });
  }
  stateStore.delete(state);

  const tokens = await exchangeCode({ code, type });
  const client = await authService.getById(clientId);
  const connections = { ...(client.connections || {}), [type]: { ...tokens, ...extra, connectedAt: new Date().toISOString() } };
  await authService.updateClient(clientId, { connections });

  console.log(`[Amazon] ${CONNECTIONS[type].label} connected for client ${clientId}`);
}

/**
 * Get connection status for all 4 types for a client
 */
async function getConnectionStatus(clientId) {
  const client = await authService.getById(clientId);
  const connections = client.connections || {};

  return Object.fromEntries(
    Object.entries(CONNECTIONS).map(([type, meta]) => {
      const conn = connections[type];
      return [type, conn
        ? { connected: true, label: meta.label, connectedAt: conn.connectedAt, expiresAt: conn.expiresAt, ...(conn.sellingPartnerId ? { sellingPartnerId: conn.sellingPartnerId } : {}) }
        : { connected: false, label: meta.label }
      ];
    })
  );
}

module.exports = {
  getAuthUrl,
  handleCallback,
  getConnectionStatus,
  getValidToken,
  refreshAccessToken,
  CONNECTIONS
};
