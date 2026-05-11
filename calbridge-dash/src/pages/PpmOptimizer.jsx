import { useState, useMemo } from 'react';
import { usePpmOptimizer } from '../hooks/useAnalytics';
import { useDateRange } from '../context/DateRangeContext';
import PageHeader from '../components/PageHeader';
import { SkeletonCard, SkeletonTable, ErrorState } from '../components/Skeleton';

// ─── Formatters ───────────────────────────────────────────────────────────────
function fmtPct(n, decimals = 1) {
  if (n == null || isNaN(n)) return '—';
  return `${(n * 100).toFixed(decimals)}%`;
}
function fmtUSD(n) {
  if (n == null || isNaN(n)) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}
function fmtUSDSmall(n) {
  if (n == null || isNaN(n)) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n);
}

// ─── PPM color helpers ────────────────────────────────────────────────────────
function ppmColor(rate) {
  if (rate == null) return 'text-gray-400';
  if (rate > 0.10) return 'text-emerald-600';
  if (rate >= 0.05) return 'text-amber-600';
  return 'text-red-600';
}
function ppmBg(rate) {
  if (rate == null) return '';
  if (rate > 0.10) return '';
  if (rate >= 0.05) return 'bg-amber-50';
  return 'bg-red-50';
}
function ppmRing(rate) {
  if (rate == null) return 'border-t-gray-200';
  if (rate > 0.10) return 'border-t-emerald-400';
  if (rate >= 0.05) return 'border-t-amber-400';
  return 'border-t-red-400';
}
function ppmBadge(rate) {
  if (rate == null) return null;
  if (rate > 0.10) return <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-100 text-emerald-700">Healthy</span>;
  if (rate >= 0.05) return <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700">Watch</span>;
  return <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">Critical</span>;
}

// ─── What-If Slider ───────────────────────────────────────────────────────────
function WhatIfSlider({ asin, basePpm, coopCredits }) {
  const [delta, setDelta] = useState(0); // percentage point change in coop (e.g. -5 = reduce coop by 5%)

  // Net PPM is roughly: gross_margin - coop - price_concessions - freight
  // Simplified: if coop changes by delta%, new_ppm ≈ base_ppm + delta%
  // (coop credits are already in the margin calculation as a positive/negative component)
  const newPpm = basePpm != null ? basePpm + delta / 100 : null;

  return (
    <div className="mt-2 p-3 bg-gray-50 rounded-lg border border-gray-200">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-gray-600">What-If: Coop change</span>
        <span className={`text-sm font-bold ${ppmColor(newPpm)}`}>
          New PPM: {fmtPct(newPpm)}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-xs text-gray-400 w-8 text-right">{delta > 0 ? '+' : ''}{delta}%</span>
        <input
          type="range"
          min="-10"
          max="10"
          step="0.5"
          value={delta}
          onChange={e => setDelta(Number(e.target.value))}
          className="flex-1 accent-blue-600"
        />
        <span className="text-xs text-gray-400 w-8">{delta > 0 ? `+${delta}` : delta}pp</span>
      </div>
      {delta !== 0 && (
        <p className="text-xs text-gray-500 mt-1">
          {delta > 0 ? '▲ Coop increases by' : '▼ Coop decreases by'} {Math.abs(delta)}%
          → {fmtPct(newPpm)} PPM ({delta > 0 ? '+' : ''}{fmtPct(delta / 100, 1)} change)
        </p>
      )}
    </div>
  );
}

// ─── Expanded row ─────────────────────────────────────────────────────────────
function ExpandedRow({ row }) {
  const { components } = row;
  return (
    <tr>
      <td colSpan={5} className="px-6 py-0 pb-4 bg-gray-50 border-b border-gray-100">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-3">
          {/* Component breakdown */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">PPM Components</p>
            <table className="w-full text-xs">
              <tbody>
                {[
                  { label: 'Coop Credits', value: components?.coopCredits, hint: 'Marketing co-op chargebacks' },
                  { label: 'Price Concessions', value: components?.priceConcessions, hint: 'Negotiated price reductions' },
                  { label: 'Freight Costs', value: components?.freightCosts, hint: 'Inbound freight allocation' },
                ].map(c => (
                  <tr key={c.label} className="border-b border-gray-100">
                    <td className="py-1.5 text-gray-600">{c.label}</td>
                    <td className="py-1.5 text-right font-mono text-gray-700">{fmtPct(c.value)}</td>
                    <td className="py-1.5 text-right text-gray-400 pl-4">{c.hint}</td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td className="py-2 text-gray-800">Net PPM</td>
                  <td className={`py-2 text-right font-mono ${ppmColor(row.netPpm)}`}>{fmtPct(row.netPpm)}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
          {/* What-if slider */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">What-If Simulator</p>
            <WhatIfSlider asin={row.asin} basePpm={row.netPpm} coopCredits={components?.coopCredits} />
          </div>
        </div>
      </td>
    </tr>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function PpmOptimizer() {
  const { range } = useDateRange();
  const { data, isLoading, error } = usePpmOptimizer(range);
  const [sortKey, setSortKey] = useState('netPpm');
  const [sortDir, setSortDir] = useState('asc');
  const [expandedAsin, setExpandedAsin] = useState(null);

  function toggleSort(key) {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  const asins = data?.asins ?? [];
  const sorted = useMemo(() => [...asins].sort((a, b) => {
    const av = a[sortKey] ?? 0;
    const bv = b[sortKey] ?? 0;
    return sortDir === 'asc' ? av - bv : bv - av;
  }), [asins, sortKey, sortDir]);

  // Summary stats
  const avgPpm = asins.length > 0
    ? asins.reduce((s, r) => s + (r.netPpm ?? 0), 0) / asins.filter(r => r.netPpm != null).length
    : null;
  const criticalCount = asins.filter(r => r.netPpm != null && r.netPpm < 0.05).length;
  const healthyCount  = asins.filter(r => r.netPpm != null && r.netPpm > 0.10).length;

  if (error) return <ErrorState message={error.message} />;

  return (
    <div className="p-6 space-y-6">
      <PageHeader title="Net PPM Optimizer" subtitle="Net Pure Product Margin by ASIN — click a row to expand the what-if simulator" />

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <div className={`bg-white rounded-xl border border-gray-200 border-t-4 ${ppmRing(avgPpm)} p-4`}>
          <p className="text-xs font-medium text-gray-500 mb-1">Avg Net PPM</p>
          {isLoading
            ? <div className="h-8 w-20 bg-gray-100 animate-pulse rounded" />
            : <p className={`text-2xl font-bold ${ppmColor(avgPpm)}`}>{fmtPct(avgPpm)}</p>
          }
        </div>
        <div className="bg-white rounded-xl border border-gray-200 border-t-4 border-t-red-400 p-4">
          <p className="text-xs font-medium text-gray-500 mb-1">Critical ASINs (&lt;5%)</p>
          {isLoading
            ? <div className="h-8 w-12 bg-gray-100 animate-pulse rounded" />
            : <p className="text-2xl font-bold text-red-600">{criticalCount}</p>
          }
        </div>
        <div className="bg-white rounded-xl border border-gray-200 border-t-4 border-t-emerald-400 p-4">
          <p className="text-xs font-medium text-gray-500 mb-1">Healthy ASINs (&gt;10%)</p>
          {isLoading
            ? <div className="h-8 w-12 bg-gray-100 animate-pulse rounded" />
            : <p className="text-2xl font-bold text-emerald-600">{healthyCount}</p>
          }
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-xs">
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-red-100 border border-red-300 inline-block" /> &lt;5% (critical)</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-amber-100 border border-amber-300 inline-block" /> 5–10% (watch)</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-white border border-emerald-300 inline-block" /> &gt;10% (healthy)</span>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              <th className="text-left px-4 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide">ASIN</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide">Product</th>
              {[
                { key: 'netPpm',        label: 'Net PPM' },
                { key: 'shippedRevenue', label: 'Shipped Revenue' },
                { key: 'shippedCogs',   label: 'Shipped COGS' },
              ].map(col => (
                <th
                  key={col.key}
                  className="text-right px-4 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide cursor-pointer hover:text-blue-600 select-none"
                  onClick={() => toggleSort(col.key)}
                >
                  {col.label}
                  {sortKey === col.key && <span className="ml-1">{sortDir === 'asc' ? '▲' : '▼'}</span>}
                </th>
              ))}
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {isLoading && Array.from({ length: 8 }).map((_, i) => (
              <tr key={i} className="border-b border-gray-50">
                {Array.from({ length: 6 }).map((_, j) => (
                  <td key={j} className="px-4 py-3">
                    <div className="h-4 bg-gray-100 animate-pulse rounded" />
                  </td>
                ))}
              </tr>
            ))}
            {!isLoading && sorted.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-gray-400">
                  No PPM data found for the selected period
                </td>
              </tr>
            )}
            {!isLoading && sorted.map(row => [
              <tr
                key={row.asin}
                className={`border-b border-gray-50 hover:bg-gray-50 transition-colors cursor-pointer select-none ${ppmBg(row.netPpm)}`}
                onClick={() => setExpandedAsin(expandedAsin === row.asin ? null : row.asin)}
              >
                <td className="px-4 py-3 font-mono text-xs text-gray-500">{row.asin}</td>
                <td className="px-4 py-3 text-gray-800 max-w-xs">
                  <span className="truncate block" title={row.title}>{row.title || row.asin}</span>
                  {ppmBadge(row.netPpm)}
                </td>
                <td className={`px-4 py-3 text-right font-bold ${ppmColor(row.netPpm)}`}>{fmtPct(row.netPpm)}</td>
                <td className="px-4 py-3 text-right text-gray-700">{fmtUSD(row.shippedRevenue)}</td>
                <td className="px-4 py-3 text-right text-gray-500">{fmtUSD(row.shippedCogs)}</td>
                <td className="px-4 py-3 text-right text-gray-400 text-xs">{expandedAsin === row.asin ? '▲' : '▼'}</td>
              </tr>,
              expandedAsin === row.asin && <ExpandedRow key={`${row.asin}-expanded`} row={row} />,
            ])}
          </tbody>
        </table>
      </div>
    </div>
  );
}
