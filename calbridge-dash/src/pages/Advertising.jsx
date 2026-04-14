import { useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
  ComposedChart, PieChart, Pie, Cell,
} from 'recharts';
import { useAdvertising, useAsinPerformance, useAdvertisingTrend } from '../hooks/useAnalytics';
import { useDateRange } from '../context/DateRangeContext';
import PageHeader from '../components/PageHeader';
import { SkeletonCard, SkeletonChart, SkeletonTable, ErrorState } from '../components/Skeleton';

// ─── Ad type color map ───────────────────────────────────────────────────────
const AD_TYPES = [
  { key: 'sp',  label: 'Sponsored Products', abbr: 'SP',  color: '#2563eb' },
  { key: 'sb',  label: 'Sponsored Brands',   abbr: 'SB',  color: '#10b981' },
  { key: 'sd',  label: 'Sponsored Display',  abbr: 'SD',  color: '#f59e0b' },
  { key: 'dsp', label: 'DSP',                abbr: 'DSP', color: '#8b5cf6' },
];

// ─── Channel selector options ─────────────────────────────────────────────────
const CHANNELS = [
  { key: 'all',  label: 'All',           description: 'SP · SB · SD · DSP — all ad types',              chartColor: '#6366f1' },
  { key: 'ads',  label: 'Sponsored Ads', description: 'SP · SB · SD — search and display ads',           chartColor: '#2563eb' },
  { key: 'dsp',  label: 'DSP',           description: 'Programmatic display — view-based attribution',   chartColor: '#8b5cf6' },
];

// ─── Formatters ───────────────────────────────────────────────────────────────
function fmtCurrency(n) {
  if (n == null || isNaN(n)) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}
function fmtPct(n) {
  if (n == null || isNaN(n)) return '—';
  return `${(n * 100).toFixed(1)}%`;
}
function fmtNum(n) {
  if (n == null || isNaN(n)) return '—';
  return new Intl.NumberFormat('en-US', { notation: 'compact' }).format(n);
}
function fmtX(n) {
  if (n == null || isNaN(n)) return '—';
  return `${Number(n).toFixed(2)}x`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────
// ─── Ad Type Breakdown Card ──────────────────────────────────────────────────
function AdTypeCard({ type, metrics, muted, loading }) {
  const colorMap = {
    sp:  { border: 'border-t-blue-500',   badge: 'bg-blue-100 text-blue-700' },
    sb:  { border: 'border-t-green-500',  badge: 'bg-green-100 text-green-700' },
    sd:  { border: 'border-t-amber-500',  badge: 'bg-amber-100 text-amber-700' },
    dsp: { border: 'border-t-purple-500', badge: 'bg-purple-100 text-purple-700' },
  };
  const colors = colorMap[type.key] || colorMap.sp;

  const spend = muted ? '—' : fmtCurrency(metrics?.spend);
  const sales = muted ? '—' : fmtCurrency(metrics?.sales);
  const roas  = muted ? '—' : fmtX(metrics?.roas ?? (metrics?.spend > 0 ? metrics?.sales / metrics?.spend : null));
  const acos  = muted ? '—' : (type.key === 'dsp' ? null : fmtPct(metrics?.acos));

  if (loading) return <SkeletonCard />;

  return (
    <div
      className={`bg-white rounded-xl border border-gray-200 border-t-4 ${colors.border} p-4 transition-opacity`}
      style={{ opacity: muted ? 0.35 : 1 }}
    >
      <div className="mb-3">
        <span className={`inline-block px-2 py-0.5 rounded text-xs font-bold ${colors.badge}`}>
          {type.abbr}
        </span>
        <span className="ml-2 text-xs text-gray-500">{type.label}</span>
      </div>
      <div className="space-y-1.5">
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Spend</span>
          <span className="font-semibold text-gray-900">{spend}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Sales</span>
          <span className="font-medium text-gray-800">{sales}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">ROAS</span>
          <span className="font-medium text-gray-800">{roas}</span>
        </div>
        {type.key === 'dsp' ? (
          <div className="flex justify-between text-sm">
            <span className="text-gray-400 italic text-xs">View-through attribution</span>
          </div>
        ) : (
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">ACoS</span>
            <span className="font-medium text-gray-800">{acos}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function MetricCard({ title, value, format = 'currency', sub, highlight, loading }) {
  if (loading) return <SkeletonCard />;
  const formatted = format === 'currency' ? fmtCurrency(value)
    : format === 'percent' ? fmtPct(value)
    : format === 'roas' ? fmtX(value)
    : format === 'number' ? fmtNum(value)
    : value;
  return (
    <div className={`bg-white rounded-xl border p-5 ${highlight ? 'border-blue-200 ring-1 ring-blue-100' : 'border-gray-200'}`}>
      <div className="text-sm font-medium text-gray-500 mb-2">{title}</div>
      <div className="text-2xl font-bold text-gray-900">{formatted}</div>
      {sub && <div className="text-xs text-gray-400 mt-1">{sub}</div>}
    </div>
  );
}

function AsinTable({ asins, loading }) {
  if (loading) return <SkeletonTable />;
  if (!asins?.length) return <div className="text-gray-400 text-sm text-center py-8">No ASIN data in this period</div>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200">
            <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">ASIN</th>
            <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Product Title</th>
            <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Spend</th>
            <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Sales</th>
            <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">ACoS</th>
            <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">ROAS</th>
            <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Clicks</th>
            <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Orders</th>
          </tr>
        </thead>
        <tbody>
          {asins.map((a, i) => {
            const acosColor = a.acos == null ? '' : a.acos > 0.4 ? 'text-red-600' : a.acos < 0.2 ? 'text-green-700' : 'text-gray-900';
            return (
              <tr key={a.asin} className={`border-b border-gray-50 hover:bg-gray-50 ${i % 2 === 1 ? 'bg-gray-50/40' : ''}`}>
                <td className="py-2.5 px-3 font-mono text-xs text-blue-700">{a.asin}</td>
                <td className="py-2.5 px-3 text-gray-800 max-w-xs truncate font-medium" title={a.productTitle}>{a.productTitle}</td>
                <td className="py-2.5 px-3 text-right font-medium text-gray-900">{fmtCurrency(a.spend)}</td>
                <td className="py-2.5 px-3 text-right text-gray-700">{fmtCurrency(a.sales)}</td>
                <td className={`py-2.5 px-3 text-right font-medium ${acosColor}`}>{fmtPct(a.acos)}</td>
                <td className="py-2.5 px-3 text-right text-gray-700">{fmtX(a.roas)}</td>
                <td className="py-2.5 px-3 text-right text-gray-500">{fmtNum(a.clicks)}</td>
                <td className="py-2.5 px-3 text-right text-gray-500">{fmtNum(a.purchases)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Pie chart custom label ───────────────────────────────────────────────────
const RADIAN = Math.PI / 180;
function PieLabel({ cx, cy, midAngle, innerRadius, outerRadius, percent, name }) {
  if (percent < 0.04) return null;
  const radius = innerRadius + (outerRadius - innerRadius) * 0.6;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  return (
    <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight={700}>
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function Advertising() {
  const { range } = useDateRange();
  const [activeChannel, setActiveChannel] = useState('all');
  const { data, isLoading, isError, error } = useAdvertising(range, activeChannel);
  const { data: asinData, isLoading: asinLoading } = useAsinPerformance(range, activeChannel);
  const { data: trendRows, isLoading: trendLoading } = useAdvertisingTrend(range, activeChannel);

  const combined = data?.combined || {};
  const byType   = data?.byType   || {};

  // Daily trend data — normalize keys from server (uppercase Snowflake cols → lowercase)
  const chartData = (trendRows || []).map(r => {
    const spend  = Number(r.SPEND  ?? r.spend  ?? 0);
    const sales  = Number(r.SALES  ?? r.sales  ?? 0);
    const clicks = Number(r.CLICKS ?? r.clicks ?? 0);
    const dateRaw = r.REPORT_DATE ?? r.report_date ?? '';
    // Format label: '2026-04-01' → 'Apr 1'
    const label = (() => {
      try {
        const d = new Date(String(dateRaw).substring(0, 10) + 'T00:00:00Z');
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
      } catch { return String(dateRaw).substring(0, 10); }
    })();
    return {
      date:  String(dateRaw).substring(0, 10),
      label,
      spend,
      sales,
      clicks,
      roas:  spend  > 0 ? sales  / spend  : null,
      cpc:   clicks > 0 ? spend  / clicks : null,
      acos:  Number(r.ACOS  ?? r.acos  ?? null),
    };
  });

  const activeChannelInfo = CHANNELS.find(c => c.key === activeChannel);

  const chartTitle = activeChannel === 'all' ? 'All Channels'
    : activeChannel === 'ads' ? 'Sponsored Ads'
    : 'DSP';

  // ASIN table data — sorted by spend desc
  const tableAsins = (asinData?.asins || []).sort((a, b) => (b.spend || 0) - (a.spend || 0));

  // Pie chart data for spend mix
  const pieData = AD_TYPES.map(type => ({
    name: type.abbr || type.label,
    value: byType[type.key]?.spend || 0,
    color: type.color,
  })).filter(d => d.value > 0);

  return (
    <div>
      <PageHeader
        title="Advertising"
        subtitle="Spend · Sales · ACoS · ROAS across your ad channels"
      />

      {isError && <ErrorState message={error?.message} />}

      {/* Channel selector — sole filter for all page data */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '24px' }}>
        {CHANNELS.map(c => (
          <button
            key={c.key}
            onClick={() => setActiveChannel(c.key)}
            style={{
              padding: '8px 18px',
              borderRadius: '20px',
              border: activeChannel === c.key ? '2px solid #6366f1' : '1px solid #e5e7eb',
              background: activeChannel === c.key ? '#6366f1' : '#fff',
              color: activeChannel === c.key ? '#fff' : '#374151',
              fontWeight: activeChannel === c.key ? 600 : 400,
              cursor: 'pointer',
              fontSize: '14px',
            }}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* Combined KPI cards — row 1 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-4">
        <MetricCard title="Total Spend" value={combined.totalSpend} format="currency" highlight loading={isLoading} />
        <MetricCard title="Total Sales (attributed)" value={combined.totalSales} format="currency" loading={isLoading} />
        <MetricCard title="Blended ACoS" value={combined.acos} format="percent" sub={activeChannel === "all" ? "Across all ad types" : activeChannel === "ads" ? "Sponsored Ads only" : "DSP only"} loading={isLoading} />
        <MetricCard title="Blended ROAS" value={combined.roas} format="roas" sub={activeChannel === "all" ? "Total sales / total spend" : activeChannel === "ads" ? "Sponsored Ads ROAS" : "DSP ROAS"} loading={isLoading} />
      </div>

      {/* Combined KPI cards — row 2 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        <MetricCard title="Impressions" value={combined.totalImpressions} format="number" loading={isLoading} />
        <MetricCard title="Clicks" value={combined.totalClicks} format="number" loading={isLoading} />
        <MetricCard title="Orders" value={combined.totalOrders} format="number" loading={isLoading} />
        <MetricCard title="Conversion Rate" value={combined.conversionRate} format="percent" sub="Orders / clicks" loading={isLoading} />
      </div>

      {/* Ad type breakdown cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        {AD_TYPES.map(type => {
          const isSponsoredType = type.key !== 'dsp';
          const muted =
            (activeChannel === 'ads' && type.key === 'dsp') ||
            (activeChannel === 'dsp' && isSponsoredType);
          return (
            <AdTypeCard
              key={type.key}
              type={type}
              metrics={byType[type.key]}
              muted={muted}
              loading={isLoading}
            />
          );
        })}
      </div>

      {/* Daily trend + Spend Mix side by side */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 mb-6">
        {/* Daily chart — 2/3 width */}
        <div className="xl:col-span-2 bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-baseline justify-between mb-1">
            <h3 className="text-sm font-semibold text-gray-700">Daily Spend &amp; Sales — {chartTitle}</h3>
            <span className="text-xs text-gray-400">{activeChannelInfo?.description}</span>
          </div>
          <p className="text-xs text-gray-400 mb-4">Spend · Sales · ROAS · CPC per day</p>
          {trendLoading ? (
            <div className="h-64 bg-gray-100 rounded animate-pulse" />
          ) : chartData.length === 0 ? (
            <div className="h-64 flex items-center justify-center text-gray-400 text-sm">No data for this period</div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={chartData} margin={{ top: 5, right: 60, bottom: 5, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10 }}
                  interval={Math.max(0, Math.floor(chartData.length / 10) - 1)}
                  angle={chartData.length > 20 ? -35 : 0}
                  textAnchor={chartData.length > 20 ? 'end' : 'middle'}
                  height={chartData.length > 20 ? 45 : 20}
                />
                <YAxis
                  yAxisId="left"
                  tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                  tick={{ fontSize: 11 }}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tickFormatter={(v) => v != null ? `${Number(v).toFixed(2)}x` : ''}
                  tick={{ fontSize: 11 }}
                />
                <Tooltip
                  labelFormatter={(label) => label}
                  formatter={(v, name) => {
                    if (v == null) return ['—', name];
                    if (name === 'ROAS') return [`${Number(v).toFixed(2)}x`, name];
                    if (name === 'CPC')  return [`$${Number(v).toFixed(2)}`, name];
                    return [new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v), name];
                  }}
                  labelStyle={{ fontWeight: 600 }}
                  contentStyle={{ fontSize: 12 }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line yAxisId="left"  type="monotone" dataKey="spend" name="Spend" stroke={activeChannelInfo?.chartColor || '#6366f1'} strokeWidth={2} dot={false} />
                <Line yAxisId="left"  type="monotone" dataKey="sales" name="Sales" stroke="#10b981" strokeWidth={2} dot={false} strokeDasharray="4 2" />
                <Line yAxisId="right" type="monotone" dataKey="roas"  name="ROAS"  stroke="#f59e0b" strokeWidth={1.5} dot={false} strokeDasharray="2 2" />
                <Line yAxisId="right" type="monotone" dataKey="cpc"   name="CPC"   stroke="#8b5cf6" strokeWidth={1.5} dot={false} strokeDasharray="2 2" />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Spend Mix pie — 1/3 width */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 flex flex-col">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Spend Mix by Ad Type</h3>
          {isLoading || pieData.length === 0 ? (
            <div className="flex-1 flex items-center justify-center">
              {isLoading
                ? <div className="h-40 w-40 bg-gray-100 rounded-full animate-pulse" />
                : <span className="text-gray-400 text-sm">No spend data</span>}
            </div>
          ) : (
            <div className="flex-1">
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    outerRadius={70}
                    dataKey="value"
                    labelLine={false}
                    label={PieLabel}
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value, name) => [fmtCurrency(value), name]}
                    labelFormatter={() => ''}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="mt-3 space-y-1.5">
                {AD_TYPES.map(type => {
                  const spend = byType[type.key]?.spend || 0;
                  const pct = combined.totalSpend > 0 ? (spend / combined.totalSpend * 100).toFixed(1) : '0.0';
                  if (spend === 0) return null;
                  return (
                    <div key={type.key} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: type.color }} />
                        <span className="text-gray-600">{type.abbr}</span>
                      </div>
                      <span className="text-gray-500">{fmtCurrency(spend)} <span className="text-gray-400">({pct}%)</span></span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* DSP attribution note */}
      {activeChannel === 'dsp' && (
        <div className="bg-purple-50 border border-purple-200 rounded-lg px-4 py-3 mb-4 text-sm text-purple-800">
          <strong>DSP Attribution:</strong> DSP uses view-based attribution (not click-based). "Sales" reflects total attributed sales including view-through.
          Note: ASIN-level data is sourced from SP reports; DSP ASIN data may be limited.
        </div>
      )}

      {/* ASIN performance table */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">
          Ad Performance by ASIN
          {' '}
          <span className="text-xs font-normal text-gray-400">
            sorted by spend — {activeChannel === 'all' ? 'all channels' : activeChannelInfo?.label}
          </span>
        </h3>
        <AsinTable
          asins={tableAsins}
          loading={asinLoading}
        />
      </div>
    </div>
  );
}
