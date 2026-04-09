import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { useVendorMetrics, useOverview } from '../hooks/useAnalytics';
import { useDateRange } from '../context/DateRangeContext';
import PageHeader from '../components/PageHeader';
import { SkeletonCard, SkeletonChart, SkeletonTable, ErrorState } from '../components/Skeleton';

function fmt(n, style = 'number') {
  if (n == null || isNaN(n)) return '—';
  if (style === 'currency') return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
  if (style === 'number') return new Intl.NumberFormat('en-US').format(Math.round(n));
  return n;
}

function MetricCard({ title, value, format, note, loading }) {
  if (loading) return <SkeletonCard />;
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="text-sm font-medium text-gray-500 mb-2">{title}</div>
      <div className="text-2xl font-bold text-gray-900 mb-1">{fmt(value, format)}</div>
      {note && <div className="text-xs text-gray-400">{note}</div>}
    </div>
  );
}

export default function VendorPerformance() {
  const { range } = useDateRange();
  const { data: vmData, isLoading: vmLoading, isError, error } = useVendorMetrics(range);
  const { data: overviewData, isLoading: overviewLoading } = useOverview(range);

  const weeklyUnits = vmData?.weeklyUnits || [];
  const topAsins = overviewData?.topAsins || [];

  // Build a weekly revenue trend from topAsins if overview provides time-series;
  // otherwise we simply skip the revenue chart — topAsins is a flat ranking list.
  const weeklyRevenue = overviewData?.weeklyRevenue || [];

  // Aggregate KPIs from topAsins
  const totalShippedRevenue = topAsins.reduce((s, r) => s + (r.shipped_revenue || 0), 0);
  const totalShippedUnits   = topAsins.reduce((s, r) => s + (r.shipped_units   || 0), 0);
  const totalShippedCogs    = topAsins.reduce((s, r) => s + (r.shipped_cogs    || 0), 0);
  // ordered revenue not in topAsins — use weeklyUnits sum as proxy if available
  const totalOrderedUnits   = weeklyUnits.reduce((s, r) => s + (r.orderedUnits || 0), 0);

  const isLoading = vmLoading || overviewLoading;

  return (
    <div>
      <PageHeader
        title="Sales"
        subtitle="Ordered & shipped revenue, units, and COGS"
      />

      {isError && <ErrorState message={error?.message} />}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        <MetricCard
          title="Ordered Units (period)"
          value={totalOrderedUnits}
          format="number"
          note="Sum of weekly ordered units"
          loading={isLoading}
        />
        <MetricCard
          title="Shipped Revenue"
          value={totalShippedRevenue}
          format="currency"
          note="Top ASINs, selected period"
          loading={isLoading}
        />
        <MetricCard
          title="Shipped Units"
          value={totalShippedUnits}
          format="number"
          note="Top ASINs, selected period"
          loading={isLoading}
        />
        <MetricCard
          title="Shipped COGS"
          value={totalShippedCogs}
          format="currency"
          note="Cost of goods shipped"
          loading={isLoading}
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
        {/* Ordered vs Shipped Units bar chart */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">
            Ordered vs Shipped Units by Week
          </h3>
          {vmLoading ? (
            <div className="h-64 bg-gray-100 rounded animate-pulse" />
          ) : weeklyUnits.length === 0 ? (
            <div className="h-64 flex items-center justify-center text-gray-400 text-sm">No data</div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={weeklyUnits} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="week" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={(v) => new Intl.NumberFormat('en-US', { notation: 'compact' }).format(v)} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v, name) => [new Intl.NumberFormat('en-US').format(v), name]} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="orderedUnits" name="Ordered Units" fill="#93c5fd" radius={[4, 4, 0, 0]} />
                <Bar dataKey="shippedUnits" name="Shipped Units" fill="#2563eb" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Weekly Revenue trend (if available) */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">
            Weekly Revenue Trend
          </h3>
          {overviewLoading ? (
            <div className="h-64 bg-gray-100 rounded animate-pulse" />
          ) : weeklyRevenue.length === 0 ? (
            <div className="h-64 flex items-center justify-center text-gray-400 text-sm">No weekly revenue data</div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={weeklyRevenue} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="week" tick={{ fontSize: 11 }} />
                <YAxis
                  tickFormatter={(v) => new Intl.NumberFormat('en-US', { notation: 'compact', style: 'currency', currency: 'USD' }).format(v)}
                  tick={{ fontSize: 11 }}
                />
                <Tooltip formatter={(v) => [fmt(v, 'currency'), 'Revenue']} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="revenue" name="Shipped Revenue" stroke="#2563eb" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Top 10 ASINs by shipped revenue */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">
          Top ASINs by Shipped Revenue
        </h3>
        {overviewLoading ? (
          <SkeletonTable />
        ) : topAsins.length === 0 ? (
          <div className="text-gray-400 text-sm text-center py-8">No ASIN data</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 px-3 font-semibold text-gray-500 text-xs uppercase tracking-wide">ASIN</th>
                  <th className="text-left py-2 px-3 font-semibold text-gray-500 text-xs uppercase tracking-wide">Title</th>
                  <th className="text-right py-2 px-3 font-semibold text-gray-500 text-xs uppercase tracking-wide">Shipped Revenue</th>
                  <th className="text-right py-2 px-3 font-semibold text-gray-500 text-xs uppercase tracking-wide">Shipped Units</th>
                  <th className="text-right py-2 px-3 font-semibold text-gray-500 text-xs uppercase tracking-wide">Shipped COGS</th>
                </tr>
              </thead>
              <tbody>
                {topAsins.slice(0, 10).map((row, i) => (
                  <tr key={row.asin} className={`border-b border-gray-50 hover:bg-gray-50 ${i % 2 === 1 ? 'bg-gray-50/40' : ''}`}>
                    <td className="py-2.5 px-3 font-mono text-xs text-blue-700">{row.asin}</td>
                    <td className="py-2.5 px-3 text-gray-700 max-w-xs">
                      {row.title
                        ? <span className="text-xs truncate block max-w-xs" title={row.title}>{row.title}</span>
                        : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="py-2.5 px-3 text-right font-semibold text-gray-900">{fmt(row.shipped_revenue, 'currency')}</td>
                    <td className="py-2.5 px-3 text-right text-gray-700">{fmt(row.shipped_units)}</td>
                    <td className="py-2.5 px-3 text-right text-gray-600">{fmt(row.shipped_cogs, 'currency')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
