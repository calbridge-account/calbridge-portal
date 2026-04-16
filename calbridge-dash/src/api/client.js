/**
 * Calbridge Analytics Dashboard API client
 * Vite proxies /vendor-analytics/* → localhost:3000
 * In production, served from same origin at /vendor-analytics
 */

const BASE = '/vendor-analytics';

async function fetchJSON(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }

  return res.json();
}

/**
 * Build query string from a date range object.
 * range: { type: '7d'|'14d'|'mtd'|'ytd'|'custom', start?, end? }
 */
function rangeParams(range) {
  if (!range) return '?range=mtd';
  if (range.type === 'custom' && range.start && range.end) {
    return `?range=custom&start=${range.start}&end=${range.end}`;
  }
  return `?range=${range.type || 'mtd'}`;
}

export const getMarketplaces      = () => fetch('/manager/active-advertiser/marketplaces', { credentials: 'include' }).then(r => r.ok ? r.json() : { marketplaces: [], activeMarketplace: 'US' });
export const postSetMarketplace   = (marketplace) => fetch('/manager/set-marketplace', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ marketplace }) });

export const getOverview          = (range, marketplace) => {
  const mp = marketplace && marketplace !== 'all' ? `&marketplace=${marketplace}` : '';
  return fetchJSON(`/overview${rangeParams(range)}${mp}`);
};
export const getVendorMetrics     = (range, marketplace) => {
  const mp = marketplace && marketplace !== 'all' ? `&marketplace=${marketplace}` : '';
  return fetchJSON(`/vendor${rangeParams(range)}${mp}`);
};
export const getVendorAsins       = (range, marketplace) => {
  const mp = marketplace && marketplace !== 'all' ? `&marketplace=${marketplace}` : '';
  return fetchJSON(`/vendor/asins${rangeParams(range)}${mp}`);
};
export const getInventoryDetail   = ()      => fetchJSON('/inventory-detail');
export const getPoSummary         = ()      => fetchJSON('/po-summary');
// Advertising API uses /advertising base (not /vendor-analytics)
async function fetchAdvertisingJSON(path) {
  const res = await fetch(path, { credentials: 'include' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export const getAdvertisingTrend  = (range, channel, marketplace) => {
  const channelParam = channel && channel !== 'all' ? `&channel=${channel}` : '';
  const mp = marketplace && marketplace !== 'all' ? `&marketplace=${marketplace}` : '';
  return fetchAdvertisingJSON(`/advertising/trend${rangeParams(range)}${channelParam}${mp}`);
};

export const getAdvertisingCampaigns = (range, channel, marketplace) => {
  const channelParam = channel && channel !== 'all' ? `&channel=${channel}` : '';
  const mp = marketplace && marketplace !== 'all' ? `&marketplace=${marketplace}` : '';
  return fetchAdvertisingJSON(`/advertising/campaigns${rangeParams(range)}${channelParam}${mp}&limit=500`);
};

export const getAdvertising       = (range, channel, marketplace) => {
  const channelParam = channel && channel !== 'all' ? `&channel=${channel}` : '';
  const mp = marketplace && marketplace !== 'all' ? `&marketplace=${marketplace}` : '';
  return fetchAdvertisingJSON(`/advertising${rangeParams(range)}${channelParam}${mp}`);
};
export const getForecasting       = (range) => fetchJSON(`/forecasting${rangeParams(range)}`);
export const getForecastShift     = (asin)  => fetchJSON(`/forecast-shift${asin ? `?asin=${asin}` : ''}`);
export const getAnnualProjection  = ()      => fetchJSON('/annual-projection');

// COGS Analytics — uses /cogs-analytics base (proxied separately)
const COGS_BASE = '/cogs-analytics';
async function cogsJSON(path, options = {}) {
  const res = await fetch(`${COGS_BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export const getCogsEntries   = () => cogsJSON('/entries');
export const getCogsMargins   = () => cogsJSON('/margins');
export const upsertCogsEntry  = (body) => cogsJSON('/entries', {
  method: 'POST',
  body: JSON.stringify(body),
});

// Budget Tracker — uses /budgets base
async function budgetJSON(path, options = {}) {
  const res = await fetch(`/budgets${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export const getBudgets              = () => budgetJSON('');
export const getBudgetDetail         = (id) => budgetJSON(`/${id}`);
export const getBudgetCampaigns      = () => budgetJSON('/campaigns/available');
export const createBudget            = (body) => budgetJSON('', { method: 'POST', body: JSON.stringify(body) });
export const updateBudget            = (id, body) => budgetJSON(`/${id}`, { method: 'PUT', body: JSON.stringify(body) });
export const deleteBudget            = (id) => budgetJSON(`/${id}`, { method: 'DELETE' });
export const updateBudgetCampaigns   = (id, campaigns) => budgetJSON(`/${id}/campaigns`, { method: 'PUT', body: JSON.stringify({ campaigns }) });

// Advertising ASIN performance — uses /advertising base (proxied separately)
async function advJSON(path, options = {}) {
  const res = await fetch(`/advertising${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export const getAsinPerformance = (range, channel, marketplace) => {
  const base = rangeParams(range); // e.g. ?range=mtd or ?range=custom&start=...&end=...
  const channelParam = channel && channel !== 'all' ? `&channel=${channel}` : '';
  const mp = marketplace && marketplace !== 'all' ? `&marketplace=${marketplace}` : '';
  return advJSON(`/asin-performance${base}${channelParam}${mp}`);
};
