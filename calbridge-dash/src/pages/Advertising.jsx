import { useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
  ComposedChart, PieChart, Pie, Cell,
} from 'recharts';
import { useAdvertising, useAsinPerformance } from '../hooks/useAnalytics';
import { useDateRange } from '../context/DateRangeContext';
import PageHeader from '../components/PageHeader';
import { SkeletonCard, SkeletonChart, SkeletonTable, ErrorState } from '../components/Skeleton';

// ─── Types ────────────────────────────────────────────────────────────────────
const AD_TYPES = [
  {
    key: 'all',
    label: 'All Types',
    color: '#6366f1',
    description: 'Combined view across SP, SB, SD, and DSP',
  },
  {
    key: 'sp',
    label: 'Sponsored Products',
    abbr: 'SP',
    color: '#2563eb',
    description: 'Search-based product ads',
  },
  {
    key: 'sb',
    label: 'Sponsored Brands',
    abbr: 'SB',
    color: '#10b981',
    description: 'Brand awareness — headline + video ads',
  },
  {
    key: 'sd',
    label: 'Sponsored Display',
    abbr: 'SD',
    color: '#f59e0b',
    description: 'Display retargeting and product targeting',
  },
  {
    key: 'dsp',
    label: 'DSP',
    abbr: 'DSP',
    color: '#8b5cf6',
    description: 'Programmatic display — viewability-based attribution',
  },
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

function TypeSummaryCard({ type, data, loading }) {
  if (loading) return <SkeletonCard />;
  if (!data) return null;
  const { color, label, abbr, description } = type;
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-center gap-2 mb-3">
        <span
          className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold text-white"
          style={{ backgroundColor: color }}
        >
          {abbr || label}
        </span>
        <span className="text-xs text-gray-400">{description}</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="text-xs text-gray-500">Spend</div>
          <div className="text-sm font-semibold text-gray-900">{fmtCurrency(data.spend)}</div>
        </div>
        <div>
          <div className="text-xs text-gray-500">Sales</div>
          <div className="text-sm font-semibold text-gray-900">{fmtCurrency(data.sales)}</div>
        </div>
        <div>
          <div className="text-xs text-gray-500">ACoS</div>
          <div className="text-sm font-semibold text-gray-900">{fmtPct(data.acos)}</div>
        </div>
        <div>
          <div className="text-xs text-gray-500">ROAS</div>
          <div className="text-sm font-semibold text-gray-900">{fmtX(data.roas)}</div>
        </div>
        {data.ntbPurchases != null && (
          <>
            <div>
              <div className="text-xs text-gray-500">NTB Orders</div>
              <div className="text-sm font-semibold text-emerald-700">{fmtNum(data.ntbPurchases)}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">NTB Sales</div>
              <div className="text-sm font-semibold text-emerald-700">{fmtCurrency(data.ntbSales)}</div>
            </div>
          </>
        )}
        {data.viewableImpressions != null && (
          <div>
            <div className="text-xs text-gray-500">Viewable Imp.</div>
            <div className="text-sm font-semibold text-gray-900">{fmtNum(data.viewableImpressions)}</div>
          </div>
        )}
      </div>
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
  const [activeTab, setActiveTab] = useState('all');
  const { data, isLoading, isError, error } = useAdvertising(range);
  const { data: asinData, isLoading: asinLoading } = useAsinPerformance(range, activeTab);

  const combined = data?.combined || {};
  const byType   = data?.byType   || {};
  const weekly   = data?.weekly   || {};

  // Build a merged weekly series for "all" view
  const allWeeklyMerged = (() => {
    if (!data) return [];
    const map = {};
    for (const type of ['sp', 'sb', 'sd', 'dsp']) {
      for (const row of (weekly[type] || [])) {
        if (!map[row.weekStart]) map[row.weekStart] = { week: row.week, weekStart: row.weekStart, spend: 0, sales: 0, clicks: 0 };
        map[row.weekStart].spend  += row.spend  || 0;
        map[row.weekStart].sales  += row.sales  || 0;
        map[row.weekStart].clicks += row.clicks || 0;
      }
    }
    return Object.values(map).sort((a, b) => a.weekStart?.localeCompare(b.weekStart));
  })();

  const activeType = AD_TYPES.find(t => t.key === activeTab);

  // Get weekly data for selected tab — enrich with roas/cpc if missing
  const enrichWeekly = (rows) => rows.map(r => ({
    ...r,
    roas: r.roas != null ? r.roas : (r.spend > 0 ? r.sales / r.spend : null),
    cpc:  r.cpc  != null ? r.cpc  : (r.clicks > 0 ? r.spend / r.clicks : null),
  }));
  const chartData = enrichWeekly(activeTab === 'all' ? allWeeklyMerged : (weekly[activeTab] || []));

  // ASIN table data — sorted by spend desc
  const tableAsins = (asinData?.asins || []).sort((a, b) => (b.spend || 0) - (a.spend || 0));

  // Pie chart data for spend mix
  const pieData = AD_TYPES.filter(t => t.key !== 'all').map(type => ({
    name: type.abbr || type.label,
    value: byType[type.key]?.spend || 0,
    color: type.color,
  })).filter(d => d.value > 0);

  return (
    <div>
      <PageHeader
        title="Advertising"
        subtitle="SP · SB · SD · DSP — all ad types in one view"
        
        
      />

      {isError && <ErrorState message={error?.message} />}

      {/* Combined KPI cards — row 1 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-4">
        <MetricCard title="Total Spend" value={combined.totalSpend} format="currency" highlight loading={isLoading} />
        <MetricCard title="Total Sales (attributed)" value={combined.totalSales} format="currency" loading={isLoading} />
        <MetricCard title="Blended ACoS" value={combined.blendedAcos} format="percent" sub="Across all ad types" loading={isLoading} />
        <MetricCard title="Blended ROAS" value={combined.blendedRoas} format="roas" sub="Total sales / total spend" loading={isLoading} />
      </div>

      {/* Combined KPI cards — row 2 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        <MetricCard title="Impressions" value={combined.totalImpressions} format="number" loading={isLoading} />
        <MetricCard title="Clicks" value={combined.totalClicks} format="number" loading={isLoading} />
        <MetricCard title="Orders" value={combined.totalOrders} format="number" loading={isLoading} />
        <MetricCard title="Conversion Rate" value={combined.conversionRate} format="percent" sub="Orders / clicks" loading={isLoading} />
      </div>

      {/* Per-type summary strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        {AD_TYPES.filter(t => t.key !== 'all').map(type => (
          <TypeSummaryCard key={type.key} type={type} data={byType[type.key]} loading={isLoading} />
        ))}
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 mb-6 w-fit">
        {AD_TYPES.map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
              activeTab === t.key
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.key === 'all' ? 'All' : t.abbr}
          </button>
        ))}
      </div>

      {/* Chart + table for selected tab */}
      <div className="mb-6">
        {/* Weekly trend + Spend Mix side by side */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 mb-6">
          {/* Weekly chart — 2/3 width */}
          <div className="xl:col-span-2 bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-1">
              Weekly Spend vs Sales — {activeType?.label}
            </h3>
            <p className="text-xs text-gray-400 mb-4">{activeType?.description}</p>
            {isLoading ? (
              <div className="h-64 bg-gray-100 rounded animate-pulse" />
            ) : chartData.length === 0 ? (
              <div className="h-64 flex items-center justify-center text-gray-400 text-sm">No data for this period</div>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart data={chartData} margin={{ top: 5, right: 60, bottom: 5, left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="week" tick={{ fontSize: 11 }} />
                  <YAxis
                    yAxisId="left"
                    tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                    tick={{ fontSize: 11 }}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tickFormatter={(v) => v != null ? `${Number(v).toFixed(1)}x` : ''}
                    tick={{ fontSize: 11 }}
                  />
                  <Tooltip
                    formatter={(v, name) => {
                      if (name === 'ROAS') return [`${Number(v).toFixed(2)}x`, name];
                      if (name === 'CPC')  return [`$${Number(v).toFixed(2)}`, name];
                      return [new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v), name];
                    }}
                    labelStyle={{ fontWeight: 600 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line yAxisId="left"  type="monotone" dataKey="spend" name="Spend" stroke={activeType?.color || '#2563eb'} strokeWidth={2} dot={false} />
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
                  {AD_TYPES.filter(t => t.key !== 'all').map(type => {
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

        {/* DSP special note */}
        {activeTab === 'dsp' && (
          <div className="bg-purple-50 border border-purple-200 rounded-lg px-4 py-3 mb-4 text-sm text-purple-800">
            <strong>DSP Attribution:</strong> DSP uses view-based attribution (not click-based). “Sales” reflects total attributed sales including view-through.
            Note: ASIN-level data is sourced from SP reports; DSP ASIN data may be limited.
          </div>
        )}

        {/* ASIN performance table */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">
            Ad Performance by ASIN
            {' '}
            <span className="text-xs font-normal text-gray-400">sorted by spend — {activeTab === 'all' ? 'all ad types' : activeType?.label}</span>
          </h3>
          <AsinTable
            asins={tableAsins}
            loading={asinLoading}
          />
        </div>
      </div>


    </div>
  );
}
