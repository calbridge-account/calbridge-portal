import { useState, useEffect, useCallback } from 'react';
import PageHeader from '../components/PageHeader';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt$(n) {
  if (n == null || isNaN(n)) return '—';
  if (n >= 1_000_000) return '$' + (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000)     return '$' + (n / 1_000).toFixed(1) + 'k';
  return '$' + Number(n).toFixed(2);
}
function fmtPct(n) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toFixed(1) + '%';
}
function fmtNum(n) {
  if (n == null || isNaN(n)) return '—';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'k';
  return String(Math.round(n));
}
function fmtRoas(n) {
  if (n == null || isNaN(n) || n === 0) return '—';
  return Number(n).toFixed(2) + 'x';
}

function AcosBadge({ acos }) {
  if (!acos || acos === 0) return <span className="text-gray-400 text-xs">—</span>;
  const good = acos < 20;
  const warn = acos >= 20 && acos < 35;
  const cls = good
    ? 'bg-green-50 text-green-700 border border-green-200'
    : warn
    ? 'bg-yellow-50 text-yellow-700 border border-yellow-200'
    : 'bg-red-50 text-red-700 border border-red-200';
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${cls}`}>
      {fmtPct(acos)}
    </span>
  );
}

function ConnectionPip({ connected }) {
  return (
    <span className={`inline-block w-1.5 h-1.5 rounded-full ${connected ? 'bg-green-500' : 'bg-gray-300'}`} />
  );
}

function SortIcon({ col, sortBy, sortDir }) {
  if (sortBy !== col) return <span className="text-gray-300 ml-1">↕</span>;
  return <span className="text-green-600 ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>;
}

function StatCard({ label, value, sub }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 px-5 py-4">
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className="text-xl font-bold text-gray-900">{value}</div>
      {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function Brands() {
  // Brands list state
  const [brands, setBrands]       = useState([]);
  const [kpi, setKpi]             = useState(null);
  const [loading, setLoading]     = useState(true);
  const [kpiLoading, setKpiLoading] = useState(true);
  const [entering, setEntering]   = useState(null);
  const [error, setError]         = useState(null);
  const [toast, setToast]         = useState(null);

  // Add brand modal
  const [showModal, setShowModal]   = useState(false);
  const [form, setForm]             = useState({ brandName: '', contactEmail: '', marketplace: 'US' });
  const [saving, setSaving]         = useState(false);
  const [formError, setFormError]   = useState(null);

  // Confirm remove
  const [confirmRemove, setConfirmRemove] = useState(null);
  const [removing, setRemoving]           = useState(null);

  // Table controls
  const [search, setSearch]   = useState('');
  const [sortBy, setSortBy]   = useState('spend');
  const [sortDir, setSortDir] = useState('desc');
  const [days, setDays]       = useState(30);

  // ── Data fetching ──────────────────────────────────────────────────────────

  const loadBrands = useCallback(async () => {
    try {
      const res = await fetch('/agency/brands', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load brands');
      const data = await res.json();
      setBrands(data.brands || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadKpi = useCallback(async (d) => {
    setKpiLoading(true);
    try {
      const res = await fetch(`/agency/kpi-summary?days=${d}`, { credentials: 'include' });
      if (!res.ok) return;
      const data = await res.json();
      setKpi(data);
    } catch { /* non-fatal */ } finally {
      setKpiLoading(false);
    }
  }, []);

  useEffect(() => { loadBrands(); }, [loadBrands]);
  useEffect(() => { loadKpi(days); }, [loadKpi, days]);

  // ── Derived table data ─────────────────────────────────────────────────────

  // Merge brand connection info with kpi per-brand data
  const tableRows = brands.map(brand => {
    const kpiBrand = kpi?.brands?.find(b => b.brandName === brand.brandName) || {};
    return { ...brand, ...kpiBrand };
  });

  const filtered = tableRows.filter(b =>
    !search || b.brandName?.toLowerCase().includes(search.toLowerCase())
  );

  const sorted = [...filtered].sort((a, b) => {
    let va = a[sortBy] ?? 0;
    let vb = b[sortBy] ?? 0;
    if (typeof va === 'string') va = va.toLowerCase();
    if (typeof vb === 'string') vb = vb.toLowerCase();
    if (va < vb) return sortDir === 'asc' ? -1 : 1;
    if (va > vb) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  function toggleSort(col) {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(col); setSortDir('desc'); }
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  async function selectBrand(brand) {
    setEntering(brand.clientId);
    try {
      const res = await fetch('/agency/switch-brand', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: brand.clientId }),
      });
      if (!res.ok) throw new Error('Failed to enter brand');
      sessionStorage.removeItem('calbridge_advertiser_id');
      window.location.href = '/analytics/';
    } catch (e) {
      setEntering(null);
      setError(e.message);
    }
  }

  async function handleAddBrand(e) {
    e.preventDefault();
    if (!form.brandName.trim()) return;
    setSaving(true); setFormError(null);
    try {
      const res = await fetch('/agency/brands', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Failed'); }
      setShowModal(false);
      setForm({ brandName: '', contactEmail: '', marketplace: 'US' });
      showToast(`${form.brandName} added`);
      await loadBrands();
      await loadKpi(days);
    } catch (e) { setFormError(e.message); }
    finally { setSaving(false); }
  }

  async function removeBrand(managerId) {
    setRemoving(managerId); setConfirmRemove(null);
    try {
      const res = await fetch(`/agency/brands/${managerId}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) throw new Error('Failed to remove brand');
      showToast('Brand removed');
      await loadBrands();
      await loadKpi(days);
    } catch (e) { setError(e.message); }
    finally { setRemoving(null); }
  }

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const summary = kpi?.summary || {};

  const DAYS_OPTIONS = [
    { label: '7D',  value: 7 },
    { label: '30D', value: 30 },
    { label: '60D', value: 60 },
    { label: '90D', value: 90 },
  ];

  const COLS = [
    { key: 'brandName',   label: 'Brand' },
    { key: 'spend',       label: 'Spend',       numeric: true },
    { key: 'sales',       label: 'Sales',       numeric: true },
    { key: 'acos',        label: 'ACoS',        numeric: true },
    { key: 'roas',        label: 'ROAS',        numeric: true },
    { key: 'clicks',      label: 'Clicks',      numeric: true },
    { key: 'impressions', label: 'Impressions', numeric: true },
    { key: 'campaigns',   label: 'Campaigns',   numeric: true },
  ];

  return (
    <div>
      <PageHeader
        title="Brands"
        subtitle={`${brands.length} brand${brands.length !== 1 ? 's' : ''} under management`}
        actions={
          <button
            onClick={() => setShowModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-green-700 hover:bg-green-800 text-white text-sm font-semibold rounded-lg transition-colors"
          >
            <span>＋</span> Add Brand
          </button>
        }
      />

      {/* Toast */}
      {toast && (
        <div className="mb-4 px-4 py-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-800 font-medium">
          ✅ {toast}
        </div>
      )}
      {error && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600 ml-4">✕</button>
        </div>
      )}

      {/* Empty state */}
      {!loading && brands.length === 0 && (
        <div className="bg-white rounded-xl border border-dashed border-gray-300 p-16 text-center">
          <div className="text-4xl mb-4">🏢</div>
          <h3 className="text-base font-semibold text-gray-800 mb-2">No brands yet</h3>
          <p className="text-sm text-gray-500 mb-6">Add your first brand to get started.</p>
          <button
            onClick={() => setShowModal(true)}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-green-700 hover:bg-green-800 text-white text-sm font-semibold rounded-lg transition-colors"
          >
            ＋ Add Brand
          </button>
        </div>
      )}

      {brands.length > 0 && (
        <>
          {/* Period selector */}
          <div className="flex items-center gap-2 mb-5">
            {DAYS_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setDays(opt.value)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  days === opt.value
                    ? 'bg-green-700 text-white'
                    : 'bg-white border border-gray-200 text-gray-600 hover:border-gray-300'
                }`}
              >
                {opt.label}
              </button>
            ))}
            {kpiLoading && <span className="text-xs text-gray-400 ml-2">Refreshing…</span>}
          </div>

          {/* Summary KPI cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <StatCard
              label="Total Spend"
              value={kpiLoading ? '…' : fmt$(summary.totalSpend)}
              sub={`${days}d across ${summary.activeBrands || brands.length} brands`}
            />
            <StatCard
              label="Total Sales"
              value={kpiLoading ? '…' : fmt$(summary.totalSales)}
              sub={summary.blendedRoas ? `${fmtRoas(summary.blendedRoas)} blended ROAS` : undefined}
            />
            <StatCard
              label="Blended ACoS"
              value={kpiLoading ? '…' : fmtPct(summary.blendedAcos)}
              sub={`${fmtNum(summary.totalClicks)} clicks`}
            />
            <StatCard
              label="Impressions"
              value={kpiLoading ? '…' : fmtNum(summary.totalImpressions)}
              sub={`${summary.activeCampaigns || 0} active campaigns`}
            />
          </div>

          {/* Search + table */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-3">
              <input
                type="text"
                placeholder="Search brands…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="flex-1 max-w-xs px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-600 focus:border-transparent"
              />
              <span className="text-xs text-gray-400 ml-auto">{sorted.length} brand{sorted.length !== 1 ? 's' : ''}</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    {COLS.map(col => (
                      <th
                        key={col.key}
                        onClick={() => toggleSort(col.key)}
                        className={`px-4 py-2.5 text-xs font-semibold text-gray-500 cursor-pointer select-none whitespace-nowrap hover:text-gray-700 ${col.numeric ? 'text-right' : 'text-left'}`}
                      >
                        {col.label}<SortIcon col={col.key} sortBy={sortBy} sortDir={sortDir} />
                      </th>
                    ))}
                    <th className="px-4 py-2.5 text-xs font-semibold text-gray-500 text-center">Connections</th>
                    <th className="px-4 py-2.5 w-24"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {sorted.map(brand => (
                    <tr
                      key={brand.managerId || brand.advertiserId}
                      className="hover:bg-gray-50 transition-colors group"
                    >
                      {/* Brand name + logo */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded-md bg-gray-100 border border-gray-200 flex items-center justify-center overflow-hidden flex-shrink-0">
                            {brand.logoUrl ? (
                              <img src={brand.logoUrl} alt={brand.brandName} className="w-full h-full object-contain p-0.5" />
                            ) : (
                              <span className="text-xs font-bold text-gray-400">{brand.brandName?.[0] || '?'}</span>
                            )}
                          </div>
                          <div>
                            <div className="font-medium text-gray-800 text-sm leading-tight">{brand.brandName}</div>
                            <div className="text-xs text-gray-400">{brand.marketplace}</div>
                          </div>
                        </div>
                      </td>

                      {/* Metrics */}
                      <td className="px-4 py-3 text-right font-medium text-gray-800">{fmt$(brand.spend)}</td>
                      <td className="px-4 py-3 text-right text-gray-700">{fmt$(brand.sales)}</td>
                      <td className="px-4 py-3 text-right"><AcosBadge acos={brand.acos} /></td>
                      <td className="px-4 py-3 text-right text-gray-700">{fmtRoas(brand.roas)}</td>
                      <td className="px-4 py-3 text-right text-gray-600">{fmtNum(brand.clicks)}</td>
                      <td className="px-4 py-3 text-right text-gray-600">{fmtNum(brand.impressions)}</td>
                      <td className="px-4 py-3 text-right text-gray-600">{brand.campaigns || '—'}</td>

                      {/* Connection pips */}
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-1.5" title="Ads / Vendor / Seller">
                          <ConnectionPip connected={brand.connections?.ads?.connected} />
                          <ConnectionPip connected={brand.connections?.vendor?.connected} />
                          <ConnectionPip connected={brand.connections?.seller?.connected} />
                        </div>
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 justify-end">
                          {confirmRemove === brand.managerId ? (
                            <>
                              <button
                                onClick={() => removeBrand(brand.managerId)}
                                disabled={!!removing}
                                className="px-2 py-1 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold rounded transition-colors disabled:opacity-50"
                              >
                                {removing === brand.managerId ? '…' : 'Remove'}
                              </button>
                              <button
                                onClick={() => setConfirmRemove(null)}
                                className="px-2 py-1 border border-gray-300 text-gray-500 text-xs rounded hover:bg-gray-50"
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                onClick={() => selectBrand(brand)}
                                disabled={!!entering}
                                className="px-3 py-1.5 bg-green-700 hover:bg-green-800 text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap"
                              >
                                {entering === brand.clientId ? '…' : 'Enter →'}
                              </button>
                              <button
                                onClick={() => setConfirmRemove(brand.managerId)}
                                disabled={!!entering || !!removing}
                                className="px-2 py-1.5 border border-gray-200 text-gray-300 hover:text-red-400 hover:border-red-300 text-xs rounded-lg transition-colors disabled:opacity-50"
                                title="Remove from agency"
                              >
                                ✕
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Add Brand Modal */}
      {showModal && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={e => e.target === e.currentTarget && setShowModal(false)}
        >
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-semibold text-gray-800">Add Brand</h2>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
            </div>
            <form onSubmit={handleAddBrand} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Brand Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={form.brandName}
                  onChange={e => setForm(f => ({ ...f, brandName: e.target.value }))}
                  placeholder="e.g. Acme Electronics"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-600 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Contact Email <span className="text-xs text-gray-400">(optional)</span>
                </label>
                <input
                  type="email"
                  value={form.contactEmail}
                  onChange={e => setForm(f => ({ ...f, contactEmail: e.target.value }))}
                  placeholder="brand@example.com"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-600 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Marketplace</label>
                <select
                  value={form.marketplace}
                  onChange={e => setForm(f => ({ ...f, marketplace: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-600"
                >
                  <option value="US">🇺🇸 United States</option>
                  <option value="CA">🇨🇦 Canada</option>
                  <option value="UK">🇬🇧 United Kingdom</option>
                  <option value="DE">🇩🇪 Germany</option>
                </select>
              </div>
              {formError && <p className="text-sm text-red-600">{formError}</p>}
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 px-4 py-2 bg-green-700 hover:bg-green-800 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50"
                >
                  {saving ? 'Adding…' : 'Add Brand'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
