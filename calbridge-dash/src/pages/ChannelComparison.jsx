import { useState } from 'react';
import { useChannelComparison, useConnections } from '../hooks/useAnalytics';
import { useDateRange } from '../context/DateRangeContext';
import PageHeader from '../components/PageHeader';
import { SkeletonCard, SkeletonTable, ErrorState } from '../components/Skeleton';

// ─── Formatters ───────────────────────────────────────────────────────────────
function fmtUSD(n) {
  if (n == null || isNaN(n)) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}
function fmtNum(n) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
}
function fmtPct(n) {
  if (n == null || isNaN(n)) return '—';
  return `${(n * 100).toFixed(1)}%`;
}

// ─── Better channel indicator ─────────────────────────────────────────────────
function BetterBadge({ vendorVal, sellerVal, higherIsBetter = true }) {
  if (vendorVal == null || sellerVal == null) return null;
  const vendorWins = higherIsBetter ? vendorVal > sellerVal : vendorVal < sellerVal;
  const tie = Math.abs(vendorVal - sellerVal) / Math.max(Math.abs(vendorVal), Math.abs(sellerVal), 0.0001) < 0.01;
  if (tie) return <span className="text-xs text-gray-400">≈</span>;
  return vendorWins
    ? <span className="text-xs font-semibold text-blue-600">V ▲</span>
    : <span className="text-xs font-semibold text-orange-500">S ▲</span>;
}

// ─── Not connected state ──────────────────────────────────────────────────────
function NotConnectedBanner({ missingChannel }) {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-8 text-center">
      <p className="text-4xl mb-3">🔌</p>
      <h3 className="text-lg font-semibold text-amber-800 mb-2">Channel Comparison Requires Both Channels</h3>
      <p className="text-sm text-amber-700">
        Connect your <strong>{missingChannel}</strong> account to compare vendor vs. seller performance side-by-side.
      </p>
      <a href="/analytics/account" className="mt-4 inline-flex items-center px-4 py-2 bg-amber-600 text-white rounded-lg text-sm font-medium hover:bg-amber-700 transition-colors">
        Connect Account →
      </a>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function ChannelComparison() {
  const { range } = useDateRange();
  const { data: connections, isLoading: connLoading } = useConnections();
  const { data, isLoading, error } = useChannelComparison(range);
  const [sortKey, setSortKey] = useState('vendorRevenue');
  const [sortDir, setSortDir] = useState('desc');
  const [highlight, setHighlight] = useState('revenue'); // 'revenue' | 'units' | 'ppm'

  const hasVendor = connections?.vendor?.connected === true;
  const hasSeller = connections?.seller?.connected === true;

  function toggleSort(key) {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  // Show gating state while connection check loads
  if (connLoading) {
    return (
      <div className="p-6">
        <PageHeader title="Channel Comparison" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
          {[1, 2, 3].map(i => <SkeletonCard key={i} />)}
        </div>
      </div>
    );
  }

  // Not both connected
  if (!hasVendor || !hasSeller) {
    const missing = !hasVendor ? 'Vendor Central' : 'Seller Central';
    return (
      <div className="p-6 space-y-6">
        <PageHeader title="Channel Comparison" subtitle="Side-by-side vendor vs. seller performance per ASIN" />
        <NotConnectedBanner missingChannel={missing} />
      </div>
    );
  }

  // Both connected but seller data not available in DB
  if (!isLoading && data && !data.available) {
    return (
      <div className="p-6 space-y-6">
        <PageHeader title="Channel Comparison" subtitle="Side-by-side vendor vs. seller performance per ASIN" />
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-8 text-center">
          <p className="text-4xl mb-3">📊</p>
          <h3 className="text-lg font-semibold text-gray-700 mb-2">Seller Data Not Yet Available</h3>
          <p className="text-sm text-gray-500">{data.reason}</p>
        </div>
      </div>
    );
  }

  if (error) return <ErrorState message={error.message} />;

  const asins = data?.asins ?? [];

  // Compute sort key from nested objects
  function getSortVal(row) {
    const k = sortKey;
    if (k === 'vendorRevenue') return row.vendor?.revenue ?? 0;
    if (k === 'sellerRevenue') return row.seller?.revenue ?? 0;
    if (k === 'vendorUnits')   return row.vendor?.units ?? 0;
    if (k === 'sellerUnits')   return row.seller?.units ?? 0;
    if (k === 'vendorNetPpm')  return row.vendor?.netPpm ?? 0;
    if (k === 'totalRevenue')  return (row.vendor?.revenue ?? 0) + (row.seller?.revenue ?? 0);
    return 0;
  }

  const sorted = [...asins].sort((a, b) => {
    const av = getSortVal(a);
    const bv = getSortVal(b);
    return sortDir === 'asc' ? av - bv : bv - av;
  });

  // Totals for summary
  const totalVendorRev = asins.reduce((s, r) => s + (r.vendor?.revenue ?? 0), 0);
  const totalSellerRev = asins.reduce((s, r) => s + (r.seller?.revenue ?? 0), 0);
  const totalVendorUnits = asins.reduce((s, r) => s + (r.vendor?.units ?? 0), 0);
  const totalSellerUnits = asins.reduce((s, r) => s + (r.seller?.units ?? 0), 0);

  return (
    <div className="p-6 space-y-6">
      <PageHeader title="Channel Comparison" subtitle="Vendor vs. Seller Central — side-by-side per ASIN" />

      {/* Summary KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 border-t-4 border-t-blue-400 p-4">
          <p className="text-xs font-medium text-gray-500 mb-1">Vendor Revenue</p>
          {isLoading ? <div className="h-8 w-24 bg-gray-100 animate-pulse rounded" /> : <p className="text-xl font-bold text-blue-700">{fmtUSD(totalVendorRev)}</p>}
        </div>
        <div className="bg-white rounded-xl border border-gray-200 border-t-4 border-t-orange-400 p-4">
          <p className="text-xs font-medium text-gray-500 mb-1">Seller Revenue</p>
          {isLoading ? <div className="h-8 w-24 bg-gray-100 animate-pulse rounded" /> : <p className="text-xl font-bold text-orange-600">{fmtUSD(totalSellerRev)}</p>}
        </div>
        <div className="bg-white rounded-xl border border-gray-200 border-t-4 border-t-blue-400 p-4">
          <p className="text-xs font-medium text-gray-500 mb-1">Vendor Units</p>
          {isLoading ? <div className="h-8 w-20 bg-gray-100 animate-pulse rounded" /> : <p className="text-xl font-bold text-blue-700">{fmtNum(totalVendorUnits)}</p>}
        </div>
        <div className="bg-white rounded-xl border border-gray-200 border-t-4 border-t-orange-400 p-4">
          <p className="text-xs font-medium text-gray-500 mb-1">Seller Units</p>
          {isLoading ? <div className="h-8 w-20 bg-gray-100 animate-pulse rounded" /> : <p className="text-xl font-bold text-orange-600">{fmtNum(totalSellerUnits)}</p>}
        </div>
      </div>

      {/* Channel legend + highlight toggle */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex gap-3 text-xs">
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-blue-100 border border-blue-300 inline-block" /><strong className="text-blue-700">V</strong> = Vendor winning</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-orange-100 border border-orange-300 inline-block" /><strong className="text-orange-600">S</strong> = Seller winning</span>
        </div>
        <div className="flex gap-2 ml-auto">
          {['revenue', 'units', 'ppm'].map(h => (
            <button
              key={h}
              onClick={() => setHighlight(h)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${highlight === h ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
            >
              {h.charAt(0).toUpperCase() + h.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              <th className="text-left px-4 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide" rowSpan={2}>ASIN</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide" rowSpan={2}>Product</th>
              {/* Vendor columns */}
              <th className="text-center px-4 py-2 font-semibold text-blue-600 text-xs uppercase tracking-wide border-l border-blue-100 bg-blue-50" colSpan={3}>
                📦 Vendor
              </th>
              {/* Seller columns */}
              <th className="text-center px-4 py-2 font-semibold text-orange-600 text-xs uppercase tracking-wide border-l border-orange-100 bg-orange-50" colSpan={2}>
                🛒 Seller
              </th>
              <th className="text-center px-4 py-2 font-semibold text-gray-500 text-xs uppercase tracking-wide border-l border-gray-100" rowSpan={2}>
                Better
              </th>
            </tr>
            <tr className="border-b border-gray-100 bg-gray-50">
              {[
                { key: 'vendorRevenue', label: 'Revenue', cls: 'border-l border-blue-100 bg-blue-50' },
                { key: 'vendorUnits',   label: 'Units',   cls: 'bg-blue-50' },
                { key: 'vendorNetPpm',  label: 'Net PPM', cls: 'bg-blue-50' },
                { key: 'sellerRevenue', label: 'Revenue', cls: 'border-l border-orange-100 bg-orange-50' },
                { key: 'sellerUnits',   label: 'Units',   cls: 'bg-orange-50' },
              ].map(col => (
                <th
                  key={col.key}
                  className={`text-right px-4 py-2 font-semibold text-gray-500 text-xs uppercase tracking-wide cursor-pointer hover:text-blue-600 select-none ${col.cls}`}
                  onClick={() => toggleSort(col.key)}
                >
                  {col.label}
                  {sortKey === col.key && <span className="ml-1">{sortDir === 'asc' ? '▲' : '▼'}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading && Array.from({ length: 8 }).map((_, i) => (
              <tr key={i} className="border-b border-gray-50">
                {Array.from({ length: 8 }).map((_, j) => (
                  <td key={j} className="px-4 py-3">
                    <div className="h-4 bg-gray-100 animate-pulse rounded" />
                  </td>
                ))}
              </tr>
            ))}
            {!isLoading && sorted.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-gray-400">
                  No ASINs found with data in both channels for this period
                </td>
              </tr>
            )}
            {!isLoading && sorted.map(row => {
              const vRev = row.vendor?.revenue;
              const sRev = row.seller?.revenue;
              const vUnits = row.vendor?.units;
              const sUnits = row.seller?.units;
              const vPpm = row.vendor?.netPpm;

              // Highlight column based on selected highlight mode
              const vendorHighlight = highlight === 'revenue'
                ? (vRev != null && sRev != null && vRev > sRev ? 'font-bold text-blue-700' : '')
                : highlight === 'units'
                ? (vUnits != null && sUnits != null && vUnits > sUnits ? 'font-bold text-blue-700' : '')
                : '';
              const sellerHighlight = highlight === 'revenue'
                ? (sRev != null && vRev != null && sRev > vRev ? 'font-bold text-orange-600' : '')
                : highlight === 'units'
                ? (sUnits != null && vUnits != null && sUnits > vUnits ? 'font-bold text-orange-600' : '')
                : '';

              return (
                <tr key={row.asin} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs text-gray-500">{row.asin}</td>
                  <td className="px-4 py-3 text-gray-800 max-w-xs truncate" title={row.title}>{row.title || row.asin}</td>
                  {/* Vendor */}
                  <td className={`px-4 py-3 text-right border-l border-blue-50 ${vendorHighlight || 'text-gray-700'}`}>{fmtUSD(vRev)}</td>
                  <td className={`px-4 py-3 text-right ${vendorHighlight || 'text-gray-600'}`}>{fmtNum(vUnits)}</td>
                  <td className={`px-4 py-3 text-right ${vPpm != null ? (vPpm > 0.10 ? 'text-emerald-600' : vPpm >= 0.05 ? 'text-amber-600' : 'text-red-600') : 'text-gray-400'}`}>{fmtPct(vPpm)}</td>
                  {/* Seller */}
                  <td className={`px-4 py-3 text-right border-l border-orange-50 ${sellerHighlight || 'text-gray-700'}`}>{fmtUSD(sRev)}</td>
                  <td className={`px-4 py-3 text-right ${sellerHighlight || 'text-gray-600'}`}>{fmtNum(sUnits)}</td>
                  {/* Better indicator */}
                  <td className="px-4 py-3 text-center border-l border-gray-100">
                    {highlight === 'revenue' && <BetterBadge vendorVal={vRev} sellerVal={sRev} />}
                    {highlight === 'units' && <BetterBadge vendorVal={vUnits} sellerVal={sUnits} />}
                    {highlight === 'ppm' && <BetterBadge vendorVal={vPpm} sellerVal={null} />}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
