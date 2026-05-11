import { useState } from 'react';
import { useStockoutImpact } from '../hooks/useAnalytics';
import { useDateRange } from '../context/DateRangeContext';
import PageHeader from '../components/PageHeader';
import { SkeletonCard, SkeletonTable, ErrorState } from '../components/Skeleton';

// ─── Formatters ───────────────────────────────────────────────────────────────
function fmtUSD(n) {
  if (n == null || isNaN(n)) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}
function fmtNum(n, decimals = 1) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: decimals });
}

// ─── Severity badge ───────────────────────────────────────────────────────────
function SeverityBadge({ days }) {
  if (days == null) return null;
  if (days === 0) return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-100 text-emerald-800">In Stock</span>;
  if (days <= 2) return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-100 text-emerald-700">{days}d</span>;
  if (days <= 7) return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">{days}d</span>;
  return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">{days}d</span>;
}

// Row background based on severity
function rowClass(days) {
  if (days > 7) return 'bg-red-50';
  if (days >= 3) return 'bg-amber-50';
  return '';
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function StockoutImpact() {
  const { range } = useDateRange();
  const { data, isLoading, error } = useStockoutImpact(range);
  const [sortKey, setSortKey] = useState('estimatedLostRevenue');
  const [sortDir, setSortDir] = useState('desc');

  function toggleSort(key) {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  const asins = data?.asins ?? [];
  const sorted = [...asins].sort((a, b) => {
    const av = a[sortKey] ?? 0;
    const bv = b[sortKey] ?? 0;
    return sortDir === 'asc' ? av - bv : bv - av;
  });

  const totalLostRevenue = data?.summary?.totalEstimatedLostRevenue ?? 0;
  const totalStockoutDays = data?.summary?.totalStockoutDays ?? 0;

  if (error) return <ErrorState message={error.message} />;

  return (
    <div className="p-6 space-y-6">
      <PageHeader title="Out-of-Stock Revenue Impact" subtitle="Estimated revenue lost due to stockouts during the selected period" />

      {/* Hero banner */}
      <div className={`rounded-2xl border-2 ${totalLostRevenue > 0 ? 'border-red-300 bg-red-50' : 'border-emerald-300 bg-emerald-50'} p-6 flex flex-col md:flex-row md:items-center md:gap-8`}>
        <div className="flex-1">
          <p className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-1">Total Estimated Lost Revenue</p>
          {isLoading
            ? <div className="h-10 w-48 bg-gray-200 animate-pulse rounded" />
            : <p className={`text-5xl font-black ${totalLostRevenue > 0 ? 'text-red-600' : 'text-emerald-600'}`}>{fmtUSD(totalLostRevenue)}</p>
          }
          <p className="text-xs text-gray-500 mt-1">Based on avg daily velocity × stockout days × avg selling price</p>
        </div>
        <div className="flex gap-6 mt-4 md:mt-0">
          <div className="text-center">
            {isLoading
              ? <div className="h-8 w-16 bg-gray-200 animate-pulse rounded mx-auto" />
              : <p className="text-3xl font-bold text-gray-800">{totalStockoutDays.toLocaleString()}</p>
            }
            <p className="text-xs text-gray-500 mt-0.5">Total Stockout Days</p>
          </div>
          <div className="text-center">
            {isLoading
              ? <div className="h-8 w-16 bg-gray-200 animate-pulse rounded mx-auto" />
              : <p className="text-3xl font-bold text-gray-800">{asins.length}</p>
            }
            <p className="text-xs text-gray-500 mt-0.5">ASINs Affected</p>
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-xs">
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-emerald-100 border border-emerald-300 inline-block" /> 0–2 days</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-amber-100 border border-amber-300 inline-block" /> 3–7 days</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-red-100 border border-red-300 inline-block" /> 7+ days (critical)</span>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              <th className="text-left px-4 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">ASIN</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">Product</th>
              {[
                { key: 'stockoutDays',          label: 'Stockout Days' },
                { key: 'estimatedLostUnits',    label: 'Est. Lost Units' },
                { key: 'estimatedLostRevenue',  label: 'Est. Lost Revenue' },
                { key: 'avgDailyVelocity',      label: 'Avg Daily Velocity' },
              ].map(col => (
                <th
                  key={col.key}
                  className="text-right px-4 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide cursor-pointer hover:text-blue-600 select-none"
                  onClick={() => toggleSort(col.key)}
                >
                  {col.label}
                  {sortKey === col.key && <span className="ml-1">{sortDir === 'asc' ? '▲' : '▼'}</span>}
                </th>
              ))}
              <th className="text-right px-4 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">Last Stockout</th>
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
                  🎉 No stockouts detected in this period
                </td>
              </tr>
            )}
            {!isLoading && sorted.map(row => (
              <tr key={row.asin} className={`border-b border-gray-50 hover:bg-gray-50 transition-colors ${rowClass(row.stockoutDays)}`}>
                <td className="px-4 py-3 font-mono text-xs text-gray-500">{row.asin}</td>
                <td className="px-4 py-3 text-gray-800 max-w-xs truncate" title={row.title}>{row.title || row.asin}</td>
                <td className="px-4 py-3 text-right">
                  <SeverityBadge days={row.stockoutDays} />
                </td>
                <td className="px-4 py-3 text-right text-gray-700">{fmtNum(row.estimatedLostUnits, 0)}</td>
                <td className="px-4 py-3 text-right font-semibold text-red-600">{fmtUSD(row.estimatedLostRevenue)}</td>
                <td className="px-4 py-3 text-right text-gray-600">{fmtNum(row.avgDailyVelocity)} /day</td>
                <td className="px-4 py-3 text-right text-gray-500 text-xs">{row.lastStockoutDate || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
