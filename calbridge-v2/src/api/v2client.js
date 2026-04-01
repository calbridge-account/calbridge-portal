const BASE = '/v2-analytics';

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

export const getOverview      = (rp) => fetchJSON(`/overview?${rp}`);
export const getCampaigns     = (rp, filter = '') => fetchJSON(`/advertising/campaigns?${rp}${filter}`);
export const getSearchTerms   = (rp) => fetchJSON(`/advertising/search-terms?${rp}`);
export const getOpportunities = (rp) => fetchJSON(`/opportunities?${rp}`);
export const getActions       = (rp) => fetchJSON(`/actions?${rp}`);
export const createAction     = (body) => fetchJSON('/actions', { method: 'POST', body: JSON.stringify(body) });
export const updateAction     = (id, body) => fetchJSON(`/actions/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
