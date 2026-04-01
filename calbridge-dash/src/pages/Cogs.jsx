import { useState, useRef } from 'react';
import { useCogsMargins, useUpsertCogs } from '../hooks/useAnalytics';
import PageHeader from '../components/PageHeader';
import { SkeletonTable, ErrorState } from '../components/Skeleton';

function fmt(n, style = 'currency') {
  if (n == null || isNaN(n)) return '—';
  if (style === 'currency')
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n);
  if (style === 'percent')
    return `${Number(n).toFixed(1)}%`;
  return n;
}

function cm3Color(pct) {
  if (pct == null) return 'text-gray-400';
  if (pct < 0)   return 'text-red-600 font-semibold';
  if (pct < 10)  return 'text-orange-500 font-medium';
  if (pct < 20)  return 'text-yellow-600 font-medium';
  return 'text-green-600 font-semibold';
}

function cm3Bg(pct) {
  if (pct == null) return '';
  if (pct < 0)   return 'bg-red-50';
  if (pct < 10)  return 'bg-orange-50';
  if (pct < 20)  return 'bg-yellow-50';
  return 'bg-green-50';
}

function Toast({ msg, onClose }) {
  if (!msg) return null;
  return (
    <div className="fixed bottom-6 right-6 z-50 bg-gray-900 text-white text-sm px-4 py-3 rounded-xl shadow-lg flex items-center gap-3">
      <span>{msg}</span>
      <button onClick={onClose} className="text-gray-400 hover:text-white">✕</button>
    </div>
  );
}

function EditableCell({ asin, value, onSave, saving }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef(null);

  const startEdit = () => {
    setDraft(value != null ? String(value) : '');
    setEditing(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const commit = () => {
    const v = parseFloat(draft);
    if (!isNaN(v) && v >= 0) {
      onSave(asin, v);
    }
    setEditing(false);
  };

  const handleKey = (e) => {
    if (e.key === 'Enter') commit();
    if (e.key === 'Escape') setEditing(false);
  };

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <span className="text-gray-400 text-xs">$</span>
        <input
          ref={inputRef}
          type="number"
          min="0"
          step="0.01"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={handleKey}
          onBlur={commit}
          className="w-24 border border-blue-400 rounded px-1.5 py-0.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
        />
        <button onClick={commit} className="text-xs text-blue-600 hover:text-blue-800 font-medium px-1">✓</button>
      </div>
    );
  }

  return (
    <button
      onClick={startEdit}
      disabled={saving}
      className={`text-left w-full rounded px-2 py-1 text-sm hover:bg-blue-50 transition-colors group ${
        value != null ? 'text-gray-900' : 'text-gray-400 italic'
      }`}
      title="Click to edit"
    >
      {value != null ? fmt(value, 'currency') : 'Click to enter'}
      <span className="ml-1 opacity-0 group-hover:opacity-100 text-blue-400 text-xs">✎</span>
    </button>
  );
}

export default function Cogs() {
  const { data, isLoading, isError, error, refetch } = useCogsMargins();
  const { mutate: upsert, isPending: saving } = useUpsertCogs();
  const [toast, setToast] = useState('');
  const [search, setSearch] = useState('');

  const asins    = data?.asins    || [];
  const summary  = data?.summary  || {};

  const filtered = asins.filter(r => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (r.asin || '').toLowerCase().includes(q) ||
           (r.model || '').toLowerCase().includes(q) ||
           (r.title || '').toLowerCase().includes(q);
  });

  const handleSave = (asin, costPerUnit) => {
    upsert({ asin, costPerUnit }, {
      onSuccess: () => {
        setToast(`Saved $${costPerUnit.toFixed(2)} for ${asin}`);
        setTimeout(() => setToast(''), 3000);
      },
      onError: (err) => {
        setToast(`Error: ${err.message}`);
        setTimeout(() => setToast(''), 4000);
      },
    });
  };

  return (
    <div>
      <PageHeader
        title="COGS & Margins"
        subtitle="Enter cost per unit to calculate contribution margins (CM2, CM3)"
      />

      {isError && <ErrorState message={error?.message} />}

      {/* Summary bar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="text-sm text-gray-500 mb-1">Weighted Avg CM3%</div>
          <div className={`text-2xl font-bold ${cm3Color(summary.weightedAvgCm3Pct)}`}>
            {summary.weightedAvgCm3Pct != null ? fmt(summary.weightedAvgCm3Pct, 'percent') : '—'}
          </div>
          <div className="text-xs text-gray-400 mt-1">Across ASINs with COGS entered</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="text-sm text-gray-500 mb-1">COGS Coverage</div>
          <div className="text-2xl font-bold text-gray-900">
            {summary.asinsWithCogs ?? 0} / {summary.totalAsins ?? 0}
          </div>
          <div className="text-xs text-gray-400 mt-1">ASINs with cost per unit entered</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-gray-500 mb-1">Bulk Import</div>
              <div className="text-xs text-gray-400">Upload multiple ASINs at once</div>
            </div>
            <button
              onClick={() => { setToast('CSV bulk import coming soon!'); setTimeout(() => setToast(''), 3000); }}
              className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm rounded-lg transition-colors"
            >
              📥 Upload CSV
            </button>
          </div>
        </div>
      </div>

      {/* Color legend */}
      <div className="flex items-center gap-4 mb-3 text-xs text-gray-500">
        <span className="font-medium">CM3 colors:</span>
        <span className="text-green-600 font-medium">■ &gt;20% great</span>
        <span className="text-yellow-600 font-medium">■ 10–20% ok</span>
        <span className="text-orange-500 font-medium">■ &lt;10% thin</span>
        <span className="text-red-600 font-medium">■ Negative (ad spend &gt; margin)</span>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-700">ASIN Cost & Margin Table</h3>
          <input
            type="search"
            placeholder="Search ASIN or model…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm w-56 focus:outline-none focus:ring-2 focus:ring-blue-300"
          />
        </div>

        {isLoading ? (
          <SkeletonTable />
        ) : filtered.length === 0 ? (
          <div className="text-gray-400 text-sm text-center py-8">
            {search ? 'No ASINs match your search.' : 'No ASINs found.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 px-3 text-xs uppercase tracking-wide font-semibold text-gray-500">ASIN</th>
                  <th className="text-left py-2 px-3 text-xs uppercase tracking-wide font-semibold text-gray-500">Model #</th>
                  <th className="text-right py-2 px-3 text-xs uppercase tracking-wide font-semibold text-gray-500">Units Shipped<br/><span className="font-normal normal-case">(4w)</span></th>
                  <th className="text-left py-2 px-3 text-xs uppercase tracking-wide font-semibold text-gray-500">
                    Cost/Unit
                    <span className="ml-1 text-gray-400 font-normal normal-case">(click to edit)</span>
                  </th>
                  <th className="text-right py-2 px-3 text-xs uppercase tracking-wide font-semibold text-gray-500" title="Amazon shipped_cogs/unit minus your cost/unit">CM2/Unit</th>
                  <th className="text-right py-2 px-3 text-xs uppercase tracking-wide font-semibold text-gray-500" title="CM2/unit minus ad spend/unit">CM3/Unit</th>
                  <th className="text-right py-2 px-3 text-xs uppercase tracking-wide font-semibold text-gray-500">Margin %</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row, i) => (
                  <tr
                    key={row.asin}
                    className={`border-b border-gray-50 hover:bg-gray-50 transition-colors ${
                      i % 2 === 0 ? '' : 'bg-gray-50/40'
                    } ${cm3Bg(row.marginPct)}`}
                  >
                    <td className="py-2.5 px-3 font-mono text-xs text-blue-700">{row.asin}</td>
                    <td className="py-2.5 px-3 text-gray-700 max-w-xs truncate" title={row.title}>
                      {row.model || row.title || '—'}
                    </td>
                    <td className="py-2.5 px-3 text-right text-gray-600">
                      {row.shippedUnits > 0
                        ? new Intl.NumberFormat('en-US').format(Math.round(row.shippedUnits))
                        : '—'}
                    </td>
                    <td className="py-2.5 px-3">
                      <EditableCell
                        asin={row.asin}
                        value={row.costPerUnit}
                        onSave={handleSave}
                        saving={saving}
                      />
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      {row.cm2 != null ? (
                        <span className={row.cm2 >= 0 ? 'text-gray-900' : 'text-red-600'}>
                          {fmt(row.cm2, 'currency')}
                        </span>
                      ) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      {row.cm3 != null ? (
                        <span className={cm3Color(row.marginPct)}>
                          {fmt(row.cm3, 'currency')}
                        </span>
                      ) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className={`py-2.5 px-3 text-right font-semibold ${cm3Color(row.marginPct)}`}>
                      {row.marginPct != null ? fmt(row.marginPct, 'percent') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Toast msg={toast} onClose={() => setToast('')} />
    </div>
  );
}
