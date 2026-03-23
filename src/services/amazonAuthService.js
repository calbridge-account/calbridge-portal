const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const authService = require('./authService');

const LWA_AUTH_URL = 'https://www.amazon.com/ap/oa';
const LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token';

const {
  LWA_CLIENT_ID,
  LWA_CLIENT_SECRET,
  BASE_URL = 'http://localhost:3000'
} = process.env;

// State store (in-memory for dev; move to Redis/DB in prod)
const stateStore = new Map();

/**
 * Build the LWA authorization URL for Amazon Advertising API
 */
function getAdsAuthUrl(clientId) {
  const state = uuidv4();
  stateStore.set(state, { clientId, type: 'ads', createdAt: Date.now() });

  const params = new URLSearchParams({
    client_id: LWA_CLIENT_ID,
    scope: 'advertising::campaign_management',
    response_type: 'code',
    redirect_uri: `${BASE_URL}/amazon/callback/ads`,
    state
  });

  return `${LWA_AUTH_URL}?${params.toString()}`;
}

/**
 * Build the LWA authorization URL for SP-API (Seller/Vendor Central)
 */
function getSpapiAuthUrl(clientId) {
  const state = uuidv4();
  stateStore.set(state, { clientId, type: 'spapi', createdAt: Date.now() });

  const params = new URLSearchParams({
    client_id: LWA_CLIENT_ID,
    scope: 'sellingpartnerapi::migration',
    response_type: 'code',
    redirect_uri: `${BASE_URL}/amazon/callback/spapi`,
    state
  });

  return `${LWA_AUTH_URL}?${params.toString()}`;
}

/**
 * Exchange auth code for tokens — shared helper
 */
async function exchangeCode({ code, redirectUri }) {
  const response = await axios.post(LWA_TOKEN_URL, new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: LWA_CLIENT_ID,
    client_secret: LWA_CLIENT_SECRET
  }), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });

  const { access_token, refresh_token, expires_in } = response.data;
  return {
    accessToken: access_token,
    refreshToken: refresh_token,
    expiresAt: new Date(Date.now() + expires_in * 1000).toISOString()
  };
}

/**
 * Refresh an access token using a stored refresh token
 */
async function refreshAccessToken(refreshToken) {
  const response = await axios.post(LWA_TOKEN_URL, new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: LWA_CLIENT_ID,
    client_secret: LWA_CLIENT_SECRET
  }), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });

  const { access_token, expires_in } = response.data;
  return {
    accessToken: access_token,
    expiresAt: new Date(Date.now() + expires_in * 1000).toISOString()
  };
}

/**
 * Handle OAuth callback for Amazon Advertising
 */
async function handleAdsCallback({ clientId, code, state }) {
  // Validate state
  const stateData = stateStore.get(state);
  if (!stateData || stateData.clientId !== clientId) {
    throw Object.assign(new Error('Invalid OAuth state'), { status: 400 });
  }
  stateStore.delete(state);

  const tokens = await exchangeCode({
    code,
    redirectUri: `${BASE_URL}/amazon/callback/ads`
  });

  await authService.updateClient(clientId, { amazonAds: tokens });
  console.log(`[Amazon Ads] Connected for client ${clientId}`);
}

/**
 * Handle OAuth callback for SP-API
 */
async function handleSpapiCallback({ clientId, code, state, sellingPartnerId }) {
  const stateData = stateStore.get(state);
  if (!stateData || stateData.clientId !== clientId) {
    throw Object.assign(new Error('Invalid OAuth state'), { status: 400 });
  }
  stateStore.delete(state);

  const tokens = await exchangeCode({
    code,
    redirectUri: `${BASE_URL}/amazon/callback/spapi`
  });

  await authService.updateClient(clientId, { spapi: { ...tokens, sellingPartnerId } });
  console.log(`[SP-API] Connected for client ${clientId}, seller ${sellingPartnerId}`);
}

/**
 * Get connection status for a client
 */
async function getConnectionStatus(clientId) {
  const client = await authService.getById(clientId);
  return {
    amazonAds: client.amazonAds
      ? { connected: true, expiresAt: client.amazonAds.expiresAt }
      : { connected: false },
    spapi: client.spapi
      ? { connected: true, sellingPartnerId: client.spapi.sellingPartnerId, expiresAt: client.spapi.expiresAt }
      : { connected: false }
  };
}

module.exports = {
  getAdsAuthUrl,
  getSpapiAuthUrl,
  handleAdsCallback,
  handleSpapiCallback,
  getConnectionStatus,
  refreshAccessToken
};
