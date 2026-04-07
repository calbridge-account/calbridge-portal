import { useState } from 'react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ComposedChart, Area, ReferenceLine,
} from 'recharts';
import { useOverview, useAnnualProjection } from '../hooks/useAnalytics';
import { useDateRange } from '../context/DateRangeContext';
import PageHeader from '../components/PageHeader';
import {
  SkeletonCard, SkeletonChart, SkeletonTable, ErrorState,
} from '../components/Skeleton';

function fmt(n, style = 'currency') {
  if (n == null || isNaN(n)) return '—';
  if (style === 'currency') return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
  if (style === 'percent') return `${(n * 100).toFixed(1)}%`;
  if (style === 'pct') return `${Number(n).toFixed(1)}%`;
  if (style === 'number') return new Intl.NumberFormat('en-US').format(n);
  return n;
}

function wowBadge(current, previous) {
  if (current == null || previous == null || previous === 0) return null;
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  const up = pct >= 0;
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${up ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
      {up ? '↑' : '↓'} {Math.abs(pct).toFixed(1)}% WoW
    </span>
  );
}

function MetricCard({ title, value, prevValue, format = 'currency', loading, negative }) {
  if (loading) return <SkeletonCard />;
  const isNeg = negative && value != null && value < 0;
  return (
    <div className={`bg-white rounded-xl border p-5 ${isNeg ? 'border-red-200' : 'border-gray-200'}`}>
      <div className="text-sm font-medium text-gray-500 mb-2">{title}</div>
      <div className={`text-2xl font-bold mb-2 ${isNeg ? 'text-red-600' : 'text-gray-900'}`}>{fmt(value, format)}</div>
      <div>{wowBadge(value, prevValue)}</div>
    </div>
  );
}

// Mini sparkline for growth signals using simple SVG
function Sparkline({ values = [], color = '#2563eb' }) {
  if (!values || values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const w = 60, h = 24;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = h - ((v - min) / range) * h;
    return `${x},${y}`;
  }).join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="inline-block">
      <polyline points={pts} fill="none" stroke={color} strokeWidth={2} />
    </svg>
  );
}

function GrowthTile({ title, value, pctChange, extra, loading }) {
  if (loading) return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 animate-pulse">
      <div className="h-3 bg-gray-200 rounded w-24 mb-3" />
      <div className="h-6 bg-gray-200 rounded w-16 mb-2" />
      <div className="h-3 bg-gray-200 rounded w-20" />
    </div>
  );

  const up = pctChange == null ? null : pctChange >= 0;
  const arrowColor = up === null ? 'text-gray-400' : up ? 'text-green-600' : 'text-red-600';

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">{title}</div>
      <div className="flex items-end justify-between">
        <div>
          <div className="text-lg font-bold text-gray-900">{value}</div>
          {pctChange != null && (
            <div className={`text-sm font-medium ${arrowColor}`}>
              {up ? '↑' : '↓'} {Math.abs(pctChange).toFixed(1)}%
            </div>
          )}
        </div>
        {extra}
      </div>
    </div>
  );
}

export default function Overview() {
  const { range } = useDateRange();
  const { data, isLoading, isError, error } = useOverview(range);

  const metrics = data?.metrics || {};
  const weeklyTrend = data?.weeklyTrend || [];
  const topAsins = data?.topAsins || [];
  const forecastTable = data?.forecastTable || [];
  const gs = data?.growthSignals || {};
  const dataThrough = data?.dataThrough || null;
  const usingFallback = data?.usingFallbackRange || false;

  // Revenue WoW pct
  const revPct = gs.revenueGrowthWoW?.pctChange;
  const gvPct  = gs.glanceViewGrowthWoW?.pctChange;
  const acosCur = gs.adEfficiencyTrend?.currentAcos;
  const acosPrv = gs.adEfficiencyTrend?.previousAcos;
  const acosImproving = gs.adEfficiencyTrend?.improving;

  return (
    <div>
      {usingFallback && dataThrough && (
        <div className="mb-4 px-4 py-2.5 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800 flex items-center gap-2">
          <span>⚠️</span>
          <span>Retail data available through <strong>{new Date(dataThrough).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</strong> — showing most recent 30 days. Data for the selected range is not yet available.</span>
        </div>
      )}
      <PageHeader
        title="Overview Dashboard"
        subtitle="CyberPower — Amazon Vendor Analytics"
      />

      {isError && <ErrorState message={error?.message} />}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4 mb-6">
        <MetricCard
          title="Shipped Revenue"
          value={metrics.shippedRevenue}
          prevValue={metrics.prevShippedRevenue}
          format="currency"
          loading={isLoading}
        />
        <MetricCard
          title="Shipped COGS"
          value={metrics.shippedCogs}
          prevValue={metrics.prevShippedCogs}
          format="currency"
          loading={isLoading}
        />
        <MetricCard
          title="Glance Views"
          value={metrics.glanceViews}
          prevValue={metrics.prevGlanceViews}
          format="number"
          loading={isLoading}
        />
        <MetricCard
          title="Net PPM %"
          value={metrics.netPpm}
          prevValue={metrics.prevNetPpm}
          format="percent"
          loading={isLoading}
        />
        <MetricCard
          title="Proceeds after Ads"
          value={metrics.proceedsAfterAds}
          prevValue={metrics.prevProceedsAfterAds}
          format="currency"
          loading={isLoading}
          negative
        />
      </div>

      {/* Growth Signals */}
      <div className="mb-6">
        <h3 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-3">
          📡 Growth Signals (last 7 days vs prior 7 days)
        </h3>
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
          <GrowthTile
            title="Revenue Growth WoW"
            value={gs.revenueGrowthWoW?.current != null ? fmt(gs.revenueGrowthWoW.current, 'currency') : '—'}
            pctChange={revPct}
            loading={isLoading}
          />
          <GrowthTile
            title="Glance View Growth WoW"
            value={gs.glanceViewGrowthWoW?.current != null ? fmt(gs.glanceViewGrowthWoW.current, 'number') : '—'}
            pctChange={gvPct}
            loading={isLoading}
          />
          <GrowthTile
            title="Stockout Risk"
            value={
              gs.stockoutRisk?.atRiskCount != null
                ? `${gs.stockoutRisk.atRiskCount} ASINs at risk`
                : '—'
            }
            pctChange={null}
            extra={
              gs.stockoutRisk?.atRiskCount > 0
                ? <span className="text-2xl">⚠️</span>
                : gs.stockoutRisk?.atRiskCount === 0
                ? <span className="text-2xl">✅</span>
                : null
            }
            loading={isLoading}
          />
          <GrowthTile
            title="Ad Efficiency (ACoS)"
            value={acosCur != null ? fmt(acosCur, 'percent') : '—'}
            pctChange={null}
            extra={
              acosCur != null && acosPrv != null ? (
                <div className="text-right">
                  <div className={`text-sm font-bold ${acosImproving ? 'text-green-600' : 'text-red-600'}`}>
                    {acosImproving ? '↓ Improving' : '↑ Worsening'}
                  </div>
                  <div className="text-xs text-gray-400">prev {fmt(acosPrv, 'percent')}</div>
                </div>
              ) : null
            }
            loading={isLoading}
          />
        </div>
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
        {/* Weekly Revenue Trend */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">
            Weekly Revenue Trend (last 12 weeks)
          </h3>
          {isLoading ? (
            <div className="h-64 bg-gray-100 rounded animate-pulse" />
          ) : weeklyTrend.length === 0 ? (
            <div className="h-64 flex items-center justify-center text-gray-400 text-sm">No data available</div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={weeklyTrend} margin={{ top: 5, right: 10, bottom: 5, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="week" tick={{ fontSize: 11 }} />
                <YAxis
                  tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                  tick={{ fontSize: 11 }}
                />
                <Tooltip
                  formatter={(v, name) => [fmt(v), name]}
                  labelStyle={{ fontWeight: 600 }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line
                  type="monotone"
                  dataKey="shippedRevenue"
                  name="Shipped Revenue"
                  stroke="#2563eb"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="orderedRevenue"
                  name="Ordered Revenue"
                  stroke="#93c5fd"
                  strokeWidth={2}
                  dot={false}
                  strokeDasharray="4 2"
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Top 10 ASINs — Shipped Revenue + Proceeds after Ads */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-1">
            Top 10 ASINs — Revenue vs Proceeds after Ads (last 4 weeks)
          </h3>
          <p className="text-xs text-gray-400 mb-3">Proceeds = Shipped COGS − Ad Spend. Red bar = ad spend exceeds COGS.</p>
          {isLoading ? (
            <div className="h-64 bg-gray-100 rounded animate-pulse" />
          ) : topAsins.length === 0 ? (
            <div className="h-64 flex items-center justify-center text-gray-400 text-sm">No data available</div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart
                data={topAsins.slice(0, 10)}
                layout="vertical"
                margin={{ top: 5, right: 30, left: 60, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                <XAxis
                  type="number"
                  tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                  tick={{ fontSize: 10 }}
                />
                <YAxis type="category" dataKey="asin" tick={{ fontSize: 10 }} width={80} />
                <Tooltip
                  formatter={(v, name) => [fmt(v, 'currency'), name]}
                  labelStyle={{ fontWeight: 600 }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="shippedRevenue" name="Shipped Revenue" fill="#2563eb" radius={[0, 4, 4, 0]} />
                <Bar
                  dataKey="proceedsAfterAds"
                  name="Proceeds after Ads"
                  fill="#10b981"
                  radius={[0, 4, 4, 0]}
                  // Negative values show in red — recharts uses fill, so we use a custom cell approach
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Demand Forecast Table */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">
          Demand Forecast — Top 20 ASINs (next 4 weeks)
        </h3>
        {isLoading ? (
          <SkeletonTable />
        ) : forecastTable.length === 0 ? (
          <div className="text-gray-400 text-sm text-center py-8">No forecast data available</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 px-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">ASIN</th>
                  <th className="text-left py-2 px-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">Model / Product</th>
                  <th className="text-right py-2 px-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">Mean Forecast</th>
                  <th className="text-right py-2 px-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">P70</th>
                  <th className="text-right py-2 px-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">P80</th>
                  <th className="text-right py-2 px-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">P90</th>
                </tr>
              </thead>
              <tbody>
                {forecastTable.slice(0, 20).map((row, i) => (
                  <tr key={row.asin} className={`border-b border-gray-50 hover:bg-gray-50 ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}>
                    <td className="py-2.5 px-3 font-mono text-xs text-gray-700">{row.asin}</td>
                    <td className="py-2.5 px-3 text-gray-700 max-w-sm" title={[row.model, row.title].filter(Boolean).join(' — ')}>
                      {row.model && <span className="font-medium text-gray-900">{row.model}</span>}
                      {row.model && row.title && <span className="text-gray-400 mx-1">—</span>}
                      {row.title && <span className="text-gray-500 text-xs">{row.title}</span>}
                      {!row.model && !row.title && '—'}
                    </td>
                    <td className="py-2.5 px-3 text-right font-medium text-gray-900">{fmt(row.meanForecast, 'number')}</td>
                    <td className="py-2.5 px-3 text-right text-gray-600">{fmt(row.p70, 'number')}</td>
                    <td className="py-2.5 px-3 text-right text-gray-600">{fmt(row.p80, 'number')}</td>
                    <td className="py-2.5 px-3 text-right text-gray-600">{fmt(row.p90, 'number')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Annual Revenue Projection */}
      <AnnualProjectionSection />
    </div>
  );
}

function AnnualProjectionSection() {
  const { data, isLoading, isError } = useAnnualProjection();
  const s = data?.summary || {};
  const weekly = data?.weeklyData || [];

  function fmtCur(v) {
    if (v == null || isNaN(v)) return '—';
    if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v);
  }

  // Find where actuals end and projections start for reference line
  const splitIdx = weekly.findIndex(w => w.type === 'projected');
  const splitLabel = splitIdx >= 0 ? weekly[splitIdx]?.week : null;

  // Build chart data with a combined value field
  const chartData = weekly.map(w => ({
    week: w.week,
    startDate: w.startDate,
    type: w.type,
    revenue: w.type === 'actual' ? w.shippedRevenue : w.projectedRevenue,
    cogs:    w.type === 'actual' ? w.shippedCogs    : w.projectedCogs,
  }));

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-5">
        <div>
          <h3 className="text-sm font-semibold text-gray-700">
            📅 {s.year || new Date().getFullYear()} Annual Revenue Projection
          </h3>
          <p className="text-xs text-gray-400 mt-0.5">
            YTD actuals through {s.lastActualDate || '…'} + forecast-based projection for remaining weeks
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="h-64 bg-gray-100 rounded animate-pulse" />
      ) : isError ? (
        <div className="text-red-400 text-sm py-4">Failed to load annual projection</div>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
            <div className="bg-blue-50 rounded-lg p-3">
              <div className="text-xs text-blue-600 font-medium mb-1">Full-Year Revenue</div>
              <div className="text-xl font-bold text-blue-900">{fmtCur(s.fullYearRevenue)}</div>
              <div className="text-xs text-blue-400 mt-0.5">projected</div>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="text-xs text-gray-600 font-medium mb-1">YTD Actual Revenue</div>
              <div className="text-xl font-bold text-gray-900">{fmtCur(s.ytdRevenue)}</div>
              <div className="text-xs text-gray-400 mt-0.5">{s.ytdUnits != null ? new Intl.NumberFormat('en-US').format(Math.round(s.ytdUnits)) + ' units' : ''}</div>
            </div>
            <div className="bg-green-50 rounded-lg p-3">
              <div className="text-xs text-green-600 font-medium mb-1">Remaining Projected</div>
              <div className="text-xl font-bold text-green-900">{fmtCur(s.projectedRevenue)}</div>
              <div className="text-xs text-green-400 mt-0.5">based on forecast</div>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="text-xs text-gray-600 font-medium mb-1">Full-Year COGS</div>
              <div className="text-xl font-bold text-gray-900">{fmtCur(s.fullYearCogs)}</div>
              <div className="text-xs text-gray-400 mt-0.5">
                avg {s.avgSellingPrice != null ? fmtCur(s.avgSellingPrice) : '—'}/unit
              </div>
            </div>
          </div>

          {/* Weekly chart */}
          {chartData.length > 0 && (
            <ResponsiveContainer width="100%" height={220}>
              <ComposedChart data={chartData} margin={{ top: 5, right: 10, bottom: 5, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis
                  dataKey="week"
                  tick={{ fontSize: 9 }}
                  interval={Math.floor(chartData.length / 10)}
                />
                <YAxis
                  tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                  tick={{ fontSize: 10 }}
                />
                <Tooltip
                  formatter={(v, name) => [fmtCur(v), name]}
                  labelFormatter={(label, payload) => {
                    const item = payload?.[0]?.payload;
                    return `${label}${item?.type === 'projected' ? ' (projected)' : ' (actual)'}`;
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {splitLabel && (
                  <ReferenceLine
                    x={splitLabel}
                    stroke="#94a3b8"
                    strokeDasharray="4 2"
                    label={{ value: 'Forecast →', position: 'insideTopRight', fontSize: 10, fill: '#94a3b8' }}
                  />
                )}
                <Area
                  type="monotone"
                  dataKey="revenue"
                  name="Revenue"
                  stroke="#2563eb"
                  fill="#eff6ff"
                  strokeWidth={2}
                  dot={false}
                />
                <Area
                  type="monotone"
                  dataKey="cogs"
                  name="COGS"
                  stroke="#6b7280"
                  fill="#f9fafb"
                  strokeWidth={1.5}
                  dot={false}
                  strokeDasharray="4 2"
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
          <p className="text-xs text-gray-400 mt-2">
            Dashed vertical line marks transition from actuals to forecast-based projection. 
            COGS projected using avg COGS/unit from YTD actuals.
          </p>
        </>
      )}
    </div>
  );
}
