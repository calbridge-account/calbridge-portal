import { useMemo } from 'react';
import {
  ComposedChart, BarChart, Bar, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { useOverview, useVendorMetrics, useConnections } from '../hooks/useAnalytics';
import { useDateRange } from '../context/DateRangeContext';
import { useMarketplace } from '../context/MarketplaceContext';
import PageHeader from '../components/PageHeader';
import MarketplaceSwitcher from '../components/MarketplaceSwitcher';
import { SkeletonCard, SkeletonChart, SkeletonTable, ErrorState } from '../components/Skeleton';

// ─── Formatters ───────────────────────────────────────────────────────────────
function makeFmt(currency = 'USD') {
  const locale = currency === 'CAD' ? 'en-CA' : 'en-US';
  return (n) => {
    if (n == null || isNaN(n)) return '—';
    return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);
  };
}
function fmtNum(n) {
  if (n == null || isNaN(n)) return '—';
  return new Intl.NumberFormat('en-US', { notation: 'compact' }).format(Math.round(n));
}
function fmtPct(n) {
  if (n == null || isNaN(n)) return '—';
  return `${(n * 100).toFixed(1)}%`;
}
function fmtRaw(n, decimals = 1) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toFixed(decimals);
}

// ─── WoW badge ────────────────────────────────────────────────────────────────
function WoWBadge({ current, previous }) {
  if (current == null || previous == null || previous === 0) return null;
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  const up = pct >= 0;
  return (
    <span className={`ml-2 text-xs font-semibold ${up ? 'text-green-600' : 'text-red-500'}`}>
      {up ? '▲' : '▼'} {Math.abs(pct).toFixed(1)}%
    </span>
  );
}

// ─── Metric card ─────────────────────────────────────────────────────────────
function MetricCard({ title, value, sub, badge, highlight, loading }) {
  if (loading) return <SkeletonCard />;
  const ring = highlight === 'red'
    ? 'border-t-red-400'
    : highlight === 'amber'
    ? 'border-t-amber-400'
    : highlight === 'green'
    ? 'border-t-emerald-400'
    : 'border-t-blue-400';
  return (
    <div className={`bg-white rounded-xl border border-gray-200 border-t-4 ${ring} p-4`}>
      <div className="text-xs font-medium text-gray-500 mb-1">{title}</div>
      <div className="text-2xl font-bold text-gray-900">
        {value}
        {badge}
      </div>
      {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function VendorPerformance() {
  const { range }                       = useDateRange();
  const { activeMarketplace }           = useMarketplace() ?? { activeMarketplace: 'US' };
  const fmt$                            = makeFmt(activeMarketplace === 'CA' ? 'CAD' : 'USD');

  const { data: ov,  isLoading: ovLoading,  isError: ovErr,  error: ovErrObj  } = useOverview(range);
  const { data: vm,  isLoading: vmLoading                                      } = useVendorMetrics(range);
  const { data: connections, isLoading: connLoading } = useConnections();

  const isLoading = ovLoading || vmLoading;

  // Show empty state if vendor is not connected
  const hasVendor = connLoading || connections?.vendor?.connected || connections?.seller?.connected;
  if (!connLoading && !hasVendor) {
    return (
      <div>
        <PageHeader title="Sales" subtitle="Revenue, margin, traffic, and demand signals" />
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="text-5xl mb-4">📦</div>
          <h2 className="text-xl font-semibold text-gray-800 mb-2">No retail account connected</h2>
          <p className="text-gray-500 text-sm mb-6 max-w-sm">Connect your Amazon Vendor Central or Seller Central account to see sales, revenue, inventory, and traffic data.</p>
          <a href="/brand-setup.html" className="inline-flex items-center gap-2 px-4 py-2 bg-green-700 text-white rounded-lg text-sm font-medium hover:bg-green-800 transition-colors">
            Connect Amazon Account →
          </a>
        </div>
      </div>
    );
  }

  // ── Shape data ────────────────────────────────────────────────────────────
  const m   = ov?.metrics        || {};
  const gs  = ov?.growthSignals  || {};
  const wt  = ov?.weeklyTrend    || [];
  const top = ov?.topAsins       || [];
  const ft  = ov?.forecastTable  || [];
  const vm_kpis = vm?.metrics    || {};
  const weeklyUnits = vm?.weeklyUnits || [];

  const grossMarginPct = m.shippedRevenue > 0
    ? (m.shippedRevenue - m.shippedCogs) / m.shippedRevenue
    : null;
  const prevGrossMarginPct = m.prevShippedRevenue > 0
    ? (m.prevShippedRevenue - m.prevShippedCogs) / m.prevShippedRevenue
    : null;

  // Revenue trend chart — join weekly sales + units
  const revenueChartData = useMemo(() => {
    const unitsByWeek = Object.fromEntries(weeklyUnits.map(r => [r.week, r]));
    return wt.map(r => ({
      week:           r.week,
      shippedRevenue: r.shippedRevenue || 0,
      orderedRevenue: r.orderedRevenue || 0,
      orderedUnits:   unitsByWeek[r.week]?.orderedUnits || 0,
      shippedUnits:   unitsByWeek[r.week]?.shippedUnits || 0,
    }));
  }, [wt, weeklyUnits]);

  return (
    <div>
      <PageHeader
        title="Sales"
        subtitle="Revenue, margin, traffic, and demand signals"
        actions={<MarketplaceSwitcher />}
      />

      {ovErr && <ErrorState message={ovErrObj?.message} />}

      {/* ── KPI Row 1: Revenue ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-4">
        <MetricCard
          title="Shipped Revenue"
          value={fmt$(m.shippedRevenue)}
          badge={<WoWBadge current={m.shippedRevenue} previous={m.prevShippedRevenue} />}
          sub="Amazon fulfilled to customers"
          highlight="blue"
          loading={isLoading}
        />
        <MetricCard
          title="Ordered Revenue"
          value={fmt$(m.orderedRevenue)}
          sub="POs submitted by Amazon"
          highlight="blue"
          loading={isLoading}
        />
        <MetricCard
          title="Gross Margin"
          value={fmtPct(grossMarginPct)}
          badge={<WoWBadge current={grossMarginPct} previous={prevGrossMarginPct} />}
          sub="(Shipped rev − COGS) / shipped rev"
          highlight={grossMarginPct != null && grossMarginPct < 0.1 ? 'red' : 'green'}
          loading={isLoading}
        />
        <MetricCard
          title="Net PPM"
          value={fmtPct(m.netPpm)}
          badge={<WoWBadge current={m.netPpm} previous={m.prevNetPpm} />}
          sub="Net pure product margin"
          highlight={m.netPpm != null && m.netPpm < 0 ? 'red' : 'green'}
          loading={isLoading}
        />
      </div>

      {/* ── KPI Row 2: Inventory Health ───────────────────────────────────── */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        <MetricCard
          title="Glance Views"
          value={fmtNum(m.glanceViews)}
          badge={<WoWBadge current={m.glanceViews} previous={m.prevGlanceViews} />}
          sub="Detail page visits"
          highlight="blue"
          loading={isLoading}
        />
        <MetricCard
          title="Inventory Turnover"
          value={vm_kpis.invTurnover != null ? `${vm_kpis.invTurnover.toFixed(1)}× / yr` : '—'}
          sub={vm_kpis.daysOnHand != null ? `${Math.round(vm_kpis.daysOnHand)}d on hand` : 'Based on 30d shipped COGS'}
          highlight={vm_kpis.invTurnover != null && vm_kpis.invTurnover < 4 ? 'amber' : 'green'}
          loading={isLoading}
        />
        <MetricCard
          title="Stockout Rate"
          value={vm_kpis.stockoutRate != null ? fmtPct(vm_kpis.stockoutRate) : '—'}
          sub={vm_kpis.stockoutAsins != null ? `${vm_kpis.stockoutAsins} ASINs at 0 units · ${vm_kpis.lowStockAsins ?? 0} low` : ''}
          highlight={vm_kpis.stockoutRate != null && vm_kpis.stockoutRate > 0.05 ? 'red' : 'green'}
          loading={isLoading}
        />
        <MetricCard
          title="Carrying Cost"
          value={vm_kpis.carryingCost != null ? fmt$(Math.round(vm_kpis.carryingCost)) : '—'}
          sub={vm_kpis.totalInvValue != null ? `Est. monthly · ${fmt$(Math.round(vm_kpis.totalInvValue))} inv value` : 'Est. monthly (2% of inv value)'}
          highlight="blue"
          loading={isLoading}
        />
      </div>

      {/* ── Revenue Trend ─────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-1">Revenue Trend</h3>
        <p className="text-xs text-gray-400 mb-4">Weekly shipped revenue · ordered revenue · units</p>
        {isLoading ? (
          <SkeletonChart />
        ) : revenueChartData.length === 0 ? (
          <div className="h-60 flex items-center justify-center text-gray-400 text-sm">No trend data</div>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={revenueChartData} margin={{ top: 5, right: 50, bottom: 5, left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="week" tick={{ fontSize: 10 }} />
              <YAxis yAxisId="rev" tickFormatter={v => `$${(v/1000).toFixed(0)}k`} tick={{ fontSize: 11 }} />
              <YAxis yAxisId="units" orientation="right" tickFormatter={v => fmtNum(v)} tick={{ fontSize: 11 }} />
              <Tooltip
                formatter={(v, name) => {
                  if (name.includes('Units')) return [fmtNum(v), name];
                  return [fmt$(v), name];
                }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar yAxisId="rev" dataKey="shippedRevenue" name="Shipped Revenue" fill="#2563eb" radius={[3,3,0,0]} />
              <Bar yAxisId="rev" dataKey="orderedRevenue"  name="Ordered Revenue"  fill="#93c5fd" radius={[3,3,0,0]} />
              <Line yAxisId="units" type="monotone" dataKey="shippedUnits" name="Shipped Units" stroke="#10b981" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* ── Ordered vs Shipped Units ──────────────────────────────────────── */}
      {!isLoading && weeklyUnits.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Ordered vs Shipped Units by Week</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={weeklyUnits} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="week" tick={{ fontSize: 10 }} />
              <YAxis tickFormatter={v => fmtNum(v)} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v, name) => [fmtNum(v), name]} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="orderedUnits" name="Ordered" fill="#c7d2fe" radius={[3,3,0,0]} />
              <Bar dataKey="shippedUnits" name="Shipped" fill="#4f46e5" radius={[3,3,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── Top ASINs ─────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-700">Top ASINs by Shipped Revenue</h3>
          <div className="flex gap-3 text-xs text-gray-400">
            <a href="/analytics/inventory" className="text-blue-600 hover:underline">View Inventory →</a>
            <a href="/analytics/forecasting" className="text-blue-600 hover:underline">View Forecasts →</a>
          </div>
        </div>
        {isLoading ? (
          <SkeletonTable />
        ) : top.length === 0 ? (
          <div className="text-gray-400 text-sm text-center py-8">No ASIN data for this period</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">ASIN</th>
                  <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Product</th>
                  <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Shipped Rev</th>
                  <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Shipped Units</th>
                  <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Proceeds After Ads</th>
                </tr>
              </thead>
              <tbody>
                {top.slice(0, 15).map((r, i) => {
                  const paa = r.proceedsAfterAds;
                  const paaColor = paa == null ? '' : paa >= 0 ? 'text-green-700 font-semibold' : 'text-red-600 font-semibold';
                  return (
                    <tr key={r.asin} className={`border-b border-gray-50 hover:bg-gray-50 ${i % 2 === 1 ? 'bg-gray-50/40' : ''}`}>
                      <td className="py-2.5 px-3 font-mono text-xs text-blue-700">{r.asin}</td>
                      <td className="py-2.5 px-3 text-gray-700 max-w-xs">
                        <span className="text-xs block truncate" title={r.title || r.model}>
                          {r.title || r.model || <span className="text-gray-300">—</span>}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right font-semibold text-gray-900">{fmt$(r.shippedRevenue)}</td>
                      <td className="py-2.5 px-3 text-right text-gray-600">{fmtNum(r.shippedUnits)}</td>
                      <td className={`py-2.5 px-3 text-right ${paaColor}`}>{paa != null ? fmt$(paa) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Forecast Preview ──────────────────────────────────────────────── */}
      {ft.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-gray-700">Demand Forecast — Next 4 Weeks</h3>
              <p className="text-xs text-gray-400 mt-0.5">Amazon's projected order quantities by ASIN</p>
            </div>
            <a href="/analytics/forecasting" className="text-xs text-blue-600 hover:underline">Full forecast →</a>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">ASIN</th>
                  <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Product</th>
                  <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Mean (units)</th>
                  <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">P70</th>
                  <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">P80</th>
                  <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">P90</th>
                </tr>
              </thead>
              <tbody>
                {ft.slice(0, 10).map((r, i) => (
                  <tr key={r.asin} className={`border-b border-gray-50 hover:bg-gray-50 ${i % 2 === 1 ? 'bg-gray-50/40' : ''}`}>
                    <td className="py-2 px-3 font-mono text-xs text-blue-700">{r.asin}</td>
                    <td className="py-2 px-3 text-xs text-gray-600 max-w-xs truncate">{r.title || r.model || '—'}</td>
                    <td className="py-2 px-3 text-right font-semibold text-gray-900">{fmtNum(r.meanForecast)}</td>
                    <td className="py-2 px-3 text-right text-gray-600">{fmtNum(r.p70)}</td>
                    <td className="py-2 px-3 text-right text-gray-600">{fmtNum(r.p80)}</td>
                    <td className="py-2 px-3 text-right text-gray-600">{fmtNum(r.p90)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
