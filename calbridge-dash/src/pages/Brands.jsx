import { useState, useEffect } from 'react';
import PageHeader from '../components/PageHeader';

function ConnectionDot({ connected, label }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${connected ? 'bg-green-500' : 'bg-gray-300'}`} />
      <span className="text-xs text-gray-500">{label}</span>
    </div>
  );
}

export default function Brands() {
  const [brands, setBrands] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ brandName: '', contactEmail: '', marketplace: 'US' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);

  async function loadBrands() {
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
  }

  useEffect(() => { loadBrands(); }, []);

  async function handleAddBrand(e) {
    e.preventDefault();
    if (!form.brandName.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/agency/brands', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || 'Failed to add brand');
      }
      setShowModal(false);
      setForm({ brandName: '', contactEmail: '', marketplace: 'US' });
      setToast(`${form.brandName} added successfully`);
      setTimeout(() => setToast(null), 3000);
      await loadBrands();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  function selectBrand(brand) {
    const url = new URL(window.location.href);
    url.searchParams.set('advertiserId', brand.advertiserId);
    // Navigate to overview for that brand
    const base = url.pathname.replace(/\/brands\/?$/, '/');
    url.pathname = base;
    window.location.href = url.toString();
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400 text-sm">Loading brands…</div>
    );
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

      {/* Toast */}
      {toast && (
        <div className="mb-4 px-4 py-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-800 font-medium">
          ✅ {toast}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Empty state */}
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
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {brands.map(brand => (
            <div
              key={brand.managerId || brand.advertiserId}
              className="bg-white rounded-xl border border-gray-200 p-5 hover:border-green-400 hover:shadow-md transition-all cursor-pointer group"
              onClick={() => selectBrand(brand)}
            >
              {/* Logo + name */}
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg bg-gray-100 border border-gray-200 flex items-center justify-center overflow-hidden flex-shrink-0">
                  {brand.logoUrl ? (
                    <img src={brand.logoUrl} alt={brand.brandName} className="w-full h-full object-contain p-1" />
                  ) : (
                    <span className="text-lg font-bold text-gray-400">{brand.brandName?.[0] || '?'}</span>
                  )}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-gray-800 truncate group-hover:text-green-800">{brand.brandName}</div>
                  <div className="text-xs text-gray-400">{brand.marketplace}</div>
                </div>
                <div className="ml-auto">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                    brand.plan === 'pro' || brand.plan === 'agency' ? 'bg-purple-50 text-purple-700' :
                    brand.plan === 'growth' ? 'bg-blue-50 text-blue-700' :
                    brand.plan === 'starter' ? 'bg-green-50 text-green-700' :
                    'bg-gray-100 text-gray-500'
                  }`}>{brand.plan || 'free'}</span>
                </div>
              </div>

              {/* Connection status */}
              <div className="flex gap-4 pt-3 border-t border-gray-100">
                <ConnectionDot connected={brand.connections?.ads}    label="Ads" />
                <ConnectionDot connected={brand.connections?.vendor} label="Vendor" />
                <ConnectionDot connected={brand.connections?.seller} label="Seller" />
              </div>

              <div className="mt-3 text-xs text-green-700 font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                Open brand →
              </div>
            </div>
          ))}
        </div>
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
              {error && <p className="text-sm text-red-600">{error}</p>}
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
