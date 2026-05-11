import { useState } from 'react';
import { useFillRate } from '../hooks/useAnalytics';
import { useDateRange } from '../context/DateRangeContext';
import PageHeader from '../components/PageHeader';
import { SkeletonCard, SkeletonTable, ErrorState } from '../components/Skeleton';

// ─── Formatters ───────────────────────────────────────────────────────────────
function fmtPct(n) {
  if (n == null || isNaN(n)) return '—';
  return `${(n * 100).toFixed(1)}%`;
}
function fmtNum(n) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
}
function fmtDays(n) {
  if (n == null || isNaN(n)) return '—';
  return `${Number(n).toFixed(1)}d`;
}

// ─── Fill rate color helpers ──────────────────────────────────────────────────
function fillRateColor(rate) {
  if (rate == null) return 'text-gray-400';
  if (rate >= 0.9) return 'text-emerald-600';
  if (rate >= 0.7) return 'text-amber-600';
  return 'text-red-600';
}

function fillRateBg(rate) {
  if (rate == null) return '';
  if (rate >= 0.9) return 'bg-emerald-50';
  if (rate >= 0.7) return 'bg-amber-50';
  return 'bg-red-50';
}

function fillRateRing(rate) {
  if (rate == null) return 'border-t-gray-200';
  if (rate >= 0.9) return 'border-t-emerald-400';
  if (rate >= 0.7) return 'border-t-amber-400';
  return 'border-t-red-400';
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────
function KpiCard({ title, value, sub, ring, loading }) {
  if (loading) return <SkeletonCard />;
  return (
    <div className={`bg-white rounded-xl border border-gray-200 border-t-4 ${ring} p-4`}>
      <p className="text-xs font-medium text-gray-500 mb-1">{title}</p>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function FillRate() {
  const { range } = useDateRange();
  const { data, isLoading, error } = useFillRate(range);
  const [sortKey, setSortKey] = useState('fillRate');
  const [sortDir, setSortDir] = useState('asc');

  function toggleSort(key) {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  const summary = data?.summary ?? {};
  const asins = data?.asins ?? [];
  const sorted = [...asins].sort((a, b) => {
    const av = a[sortKey] ?? 0;
    const bv = b[sortKey] ?? 0;
    return sortDir === 'asc' ? av - bv : bv - av;
  });

  if (error) return <ErrorState message={error.message} />;

  const overallFillRate = summary.overallFillRate;

  return (
    <div className="p-6 space-y-6">
      <PageHeader title="PO Fill Rate Scorecard" subtitle="Purchase order fulfillment performance — worst ASINs first" />

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard
          title="Overall Fill Rate"
          value={isLoading ? '…' : fmtPct(overallFillRate)}
          sub={overallFillRate != null ? (overallFillRate >= 0.9 ? '✅ On target' : overallFillRate >= 0.7 ? '⚠️ Below target' : '🚨 Critical') : undefined}
          ring={fillRateRing(overallFillRate)}
          loading={isLoading}
        />
        <KpiCard
          title="Total Units Ordered"
          value={isLoading ? '…' : fmtNum(summary.totalOrdered)}
          ring="border-t-blue-400"
          loading={isLoading}
        />
        <KpiCard
          title="Open Units"
          value={isLoading ? '…' : fmtNum(summary.openUnits)}
          sub="Not yet received"
          ring={summary.openUnits > 0 ? 'border-t-amber-400' : 'border-t-emerald-400'}
          loading={isLoading}
        />
        <KpiCard
          title="Avg Lead Time"
          value={isLoading ? '…' : fmtDays(summary.avgLeadTime)}
          sub="From latest inventory snapshot"
          ring="border-t-purple-400"
          loading={isLoading}
        />
      </div>

      {/* Fill rate visual meter */}
      {!isLoading && overallFillRate != null && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex justify-between text-sm mb-2">
            <span className="font-medium text-gray-700">Overall Fill Rate</span>
            <span className={`font-bold ${fillRateColor(overallFillRate)}`}>{fmtPct(overallFillRate)}</span>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-3">
            <div
              className={`h-3 rounded-full transition-all ${overallFillRate >= 0.9 ? 'bg-emerald-500' : overallFillRate >= 0.7 ? 'bg-amber-500' : 'bg-red-500'}`}
              style={{ width: `${Math.min(100, (overallFillRate ?? 0) * 100)}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-gray-400 mt-1">
            <span>0%</span>
            <span className="text-amber-500">70% target</span>
            <span className="text-emerald-500">90% goal</span>
            <span>100%</span>
          </div>
        </div>
      )}

      {/* ASIN Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700">ASIN Detail — Sorted by Fill Rate (worst first)</h3>
          <span className="text-xs text-gray-400">{asins.length} ASINs</span>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="text-left px-4 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide">ASIN</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide">Product</th>
              {[
                { key: 'fillRate',                label: 'Fill Rate' },
                { key: 'unitsOrdered',            label: 'Ordered' },
                { key: 'unitsReceived',           label: 'Received' },
                { key: 'openUnits',               label: 'Open' },
                { key: 'receiveFillRate',         label: 'Recv Fill Rate' },
                { key: 'vendorConfirmationRate',  label: 'Confirmation Rate' },
                { key: 'avgLeadTimeDays',         label: 'Lead Time' },
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
              <th className="text-right px-4 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide">Last Order</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && Array.from({ length: 8 }).map((_, i) => (
              <tr key={i} className="border-b border-gray-50">
                {Array.from({ length: 9 }).map((_, j) => (
                  <td key={j} className="px-4 py-3">
                    <div className="h-4 bg-gray-100 animate-pulse rounded" />
                  </td>
                ))}
              </tr>
            ))}
            {!isLoading && sorted.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-12 text-center text-gray-400">
                  No PO data found for the selected period
                </td>
              </tr>
            )}
            {!isLoading && sorted.map(row => (
              <tr key={row.asin} className={`border-b border-gray-50 hover:bg-gray-50 transition-colors ${fillRateBg(row.fillRate)}`}>
                <td className="px-4 py-3 font-mono text-xs text-gray-500">{row.asin}</td>
                <td className="px-4 py-3 text-gray-800 max-w-xs truncate" title={row.title}>{row.title || row.asin}</td>
                <td className={`px-4 py-3 text-right font-bold ${fillRateColor(row.fillRate)}`}>{fmtPct(row.fillRate)}</td>
                <td className="px-4 py-3 text-right text-gray-700">{fmtNum(row.unitsOrdered)}</td>
                <td className="px-4 py-3 text-right text-gray-700">{fmtNum(row.unitsReceived)}</td>
                <td className={`px-4 py-3 text-right ${row.openUnits > 0 ? 'text-amber-600 font-medium' : 'text-gray-400'}`}>{fmtNum(row.openUnits)}</td>
                <td className={`px-4 py-3 text-right ${fillRateColor(row.receiveFillRate)}`}>{fmtPct(row.receiveFillRate)}</td>
                <td className={`px-4 py-3 text-right ${fillRateColor(row.vendorConfirmationRate)}`}>{fmtPct(row.vendorConfirmationRate)}</td>
                <td className="px-4 py-3 text-right text-gray-600">{fmtDays(row.avgLeadTimeDays)}</td>
                <td className="px-4 py-3 text-right text-gray-400 text-xs">{row.lastOrderDate || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
