import { useState, useEffect, useCallback } from 'react';
import PageHeader from '../components/PageHeader';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt$(n) {
  if (!n || isNaN(n)) return '—';
  if (n >= 1_000_000) return '$' + (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000)     return '$' + (n / 1_000).toFixed(1) + 'k';
  return '$' + Number(n).toFixed(2);
}
function fmtPct(n) {
  if (!n || isNaN(n)) return '—';
  return Number(n).toFixed(1) + '%';
}
function fmtNum(n) {
  if (!n || isNaN(n)) return '—';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'k';
  return String(Math.round(n));
}

function AcosBadge({ acos }) {
  if (!acos || acos === 0) return <span className="text-gray-300 text-xs">—</span>;
  const cls = acos < 20
    ? 'bg-green-50 text-green-700 border-green-200'
    : acos < 35
    ? 'bg-yellow-50 text-yellow-700 border-yellow-200'
    : 'bg-red-50 text-red-700 border-red-200';
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium border ${cls}`}>
      {fmtPct(acos)}
    </span>
  );
}

// Connection chip — shows label + coloured dot
function ConnChip({ connected, label }) {
  return (
    <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${
      connected
        ? 'bg-green-50 border-green-200 text-green-700'
        : 'bg-gray-50 border-gray-200 text-gray-400'
    }`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${connected ? 'bg-green-500' : 'bg-gray-300'}`} />
      {label}
    </div>
  );
}

function StatLine({ label, value }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
      <span className="text-xs text-gray-500">{label}</span>
      <span className="text-xs font-semibold text-gray-800">{value}</span>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function Brands() {
  const [brands, setBrands]     = useState([]);
  const [kpi, setKpi]           = useState(null);
  const [loading, setLoading]   = useState(true);
  const [kpiLoading, setKpiLoading] = useState(true);
  const [entering, setEntering] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [confirmRemove, setConfirmRemove] = useState(null);
  const [error, setError]       = useState(null);
  const [toast, setToast]       = useState(null);
  const [days, setDays]         = useState(30);

  // Add brand modal
  const [showModal, setShowModal] = useState(false);
  const [form, setForm]           = useState({ brandName: '', contactEmail: '', marketplace: 'US' });
  const [saving, setSaving]       = useState(false);
  const [formError, setFormError] = useState(null);

  const loadBrands = useCallback(async () => {
    try {
      const res = await fetch('/agency/brands', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load brands');
      const data = await res.json();
      setBrands(data.brands || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  const loadKpi = useCallback(async (d) => {
    setKpiLoading(true);
    try {
      const res = await fetch(`/agency/kpi-summary?days=${d}`, { credentials: 'include' });
      if (!res.ok) return;
      setKpi(await res.json());
    } catch { /* non-fatal */ }
    finally { setKpiLoading(false); }
  }, []);

  useEffect(() => { loadBrands(); }, [loadBrands]);
  useEffect(() => { loadKpi(days); }, [loadKpi, days]);

  // Merge brands list with kpi data keyed by brandName
  const mergedBrands = brands.map(brand => {
    const perf = kpi?.brands?.find(b => b.brandName === brand.brandName) || {};
    return { ...brand, ...perf };
  });

  // Summary across all brands
  const summary = kpi?.summary || {};

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
    } catch (e) { setEntering(null); setError(e.message); }
  }

  async function handleAddBrand(e) {
    e.preventDefault();
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
      await loadBrands(); await loadKpi(days);
    } catch (e) { setFormError(e.message); }
    finally { setSaving(false); }
  }

  async function removeBrand(managerId) {
    setRemoving(managerId); setConfirmRemove(null);
    try {
      const res = await fetch(`/agency/brands/${managerId}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) throw new Error('Failed');
      showToast('Brand removed');
      await loadBrands(); await loadKpi(days);
    } catch (e) { setError(e.message); }
    finally { setRemoving(null); }
  }

  function showToast(msg) { setToast(msg); setTimeout(() => setToast(null), 3000); }

  const DAYS_OPTIONS = [
    { label: '7D',  value: 7 },
    { label: '30D', value: 30 },
    { label: '60D', value: 60 },
    { label: '90D', value: 90 },
  ];

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-gray-400 text-sm">Loading brands…</div>;
  }

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

      {toast && (
        <div className="mb-4 px-4 py-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-800 font-medium">
          ✅ {toast}
        </div>
      )}
      {error && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-4 text-red-400 hover:text-red-600">✕</button>
        </div>
      )}

      {brands.length === 0 ? (
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
      ) : (
        <>
          {/* Period selector + portfolio summary strip */}
          <div className="flex flex-wrap items-center gap-3 mb-5">
            <div className="flex items-center gap-1.5">
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
            </div>

            {/* Inline summary pills */}
            {!kpiLoading && summary.totalSpend > 0 && (
              <div className="flex flex-wrap gap-2 ml-2">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-white border border-gray-200 rounded-full text-xs text-gray-600">
                  <span className="font-semibold text-gray-800">{fmt$(summary.totalSpend)}</span> spend
                </span>
                <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-white border border-gray-200 rounded-full text-xs text-gray-600">
                  <span className="font-semibold text-gray-800">{fmt$(summary.totalSales)}</span> sales
                </span>
                <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-white border border-gray-200 rounded-full text-xs text-gray-600">
                  <span className="font-semibold text-gray-800">{fmtPct(summary.blendedAcos)}</span> ACoS
                </span>
                <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-white border border-gray-200 rounded-full text-xs text-gray-600">
                  <span className="font-semibold text-gray-800">{fmtNum(summary.totalImpressions)}</span> impressions
                </span>
              </div>
            )}
            {kpiLoading && <span className="text-xs text-gray-400 ml-2">Loading…</span>}
          </div>

          {/* Brand cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {mergedBrands.map(brand => (
              <div
                key={brand.managerId || brand.advertiserId}
                className="bg-white rounded-xl border border-gray-200 p-5 flex flex-col gap-0"
              >
                {/* Header: logo + name + marketplace */}
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-lg bg-gray-100 border border-gray-200 flex items-center justify-center overflow-hidden flex-shrink-0">
                    {brand.logoUrl ? (
                      <img src={brand.logoUrl} alt={brand.brandName} className="w-full h-full object-contain p-1" />
                    ) : (
                      <span className="text-lg font-bold text-gray-400">{brand.brandName?.[0] || '?'}</span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-gray-800 truncate">{brand.brandName}</div>
                    <div className="text-xs text-gray-400">{brand.marketplace}</div>
                  </div>
                </div>

                {/* Connections */}
                <div className="flex flex-wrap gap-1.5 mb-4">
                  <ConnChip connected={brand.connections?.ads?.connected}    label="Ads" />
                  <ConnChip connected={brand.connections?.vendor?.connected} label="Vendor" />
                  <ConnChip connected={brand.connections?.seller?.connected} label="Seller" />
                  <ConnChip connected={brand.connections?.dsp?.connected}    label="DSP" />
                </div>

                {/* Performance stats */}
                <div className="bg-gray-50 rounded-lg px-3 py-1 mb-4">
                  {kpiLoading ? (
                    <div className="text-xs text-gray-400 py-2 text-center">Loading…</div>
                  ) : brand.spend > 0 ? (
                    <>
                      <StatLine label="Spend"       value={fmt$(brand.spend)} />
                      <StatLine label="Sales"       value={fmt$(brand.sales)} />
                      <StatLine label="ACoS"        value={<AcosBadge acos={brand.acos} />} />
                      <StatLine label="ROAS"        value={brand.roas ? brand.roas.toFixed(2) + 'x' : '—'} />
                      <StatLine label="Clicks"      value={fmtNum(brand.clicks)} />
                      <StatLine label="Campaigns"   value={brand.campaigns || '—'} />
                    </>
                  ) : (
                    <div className="text-xs text-gray-400 py-2 text-center">No ad data for this period</div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex gap-2 mt-auto">
                  <button
                    onClick={() => selectBrand(brand)}
                    disabled={!!entering || !!removing}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-green-700 hover:bg-green-800 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50"
                  >
                    {entering === brand.clientId ? 'Entering…' : 'Enter →'}
                  </button>

                  {confirmRemove === brand.managerId ? (
                    <div className="flex gap-1">
                      <button
                        onClick={() => removeBrand(brand.managerId)}
                        disabled={!!removing}
                        className="px-3 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-50"
                      >
                        {removing === brand.managerId ? '…' : 'Remove'}
                      </button>
                      <button
                        onClick={() => setConfirmRemove(null)}
                        className="px-3 py-2 border border-gray-300 text-gray-500 text-xs rounded-lg hover:bg-gray-50"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmRemove(brand.managerId)}
                      disabled={!!entering || !!removing}
                      className="px-3 py-2 border border-gray-200 text-gray-400 hover:text-red-500 hover:border-red-300 text-xs rounded-lg transition-colors disabled:opacity-50"
                      title="Remove from agency"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>
            ))}
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
