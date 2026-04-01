import { useState } from 'react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { useAdvertising } from '../hooks/useAnalytics';
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

function CampaignTable({ campaigns, isDsp = false, loading }) {
  if (loading) return <SkeletonTable />;
  if (!campaigns?.length) return <div className="text-gray-400 text-sm text-center py-8">No campaigns in this period</div>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200">
            <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{isDsp ? 'Order Name' : 'Campaign'}</th>
            <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
            <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Spend</th>
            <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Sales</th>
            <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">ACoS</th>
            <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">ROAS</th>
            <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Clicks</th>
            {isDsp && <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Viewable Imp.</th>}
            {isDsp && <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">DPV</th>}
            {!isDsp && <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Orders</th>}
          </tr>
        </thead>
        <tbody>
          {campaigns.map((c, i) => {
            const acosColor = c.acos == null ? '' : c.acos > 0.4 ? 'text-red-600' : c.acos < 0.2 ? 'text-green-700' : 'text-gray-900';
            return (
              <tr key={c.campaignId} className={`border-b border-gray-50 hover:bg-gray-50 ${i % 2 === 1 ? 'bg-gray-50/40' : ''}`}>
                <td className="py-2.5 px-3 text-gray-800 max-w-xs truncate font-medium" title={c.campaignName}>{c.campaignName}</td>
                <td className="py-2.5 px-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    c.status?.toLowerCase() === 'enabled' ? 'bg-green-50 text-green-700' :
                    c.status?.toLowerCase() === 'paused' ? 'bg-yellow-50 text-yellow-700' :
                    'bg-gray-100 text-gray-500'
                  }`}>
                    {c.status || 'ENABLED'}
                  </span>
                </td>
                <td className="py-2.5 px-3 text-right font-medium text-gray-900">{fmtCurrency(c.spend)}</td>
                <td className="py-2.5 px-3 text-right text-gray-700">{fmtCurrency(c.sales)}</td>
                <td className={`py-2.5 px-3 text-right font-medium ${acosColor}`}>{fmtPct(c.acos)}</td>
                <td className="py-2.5 px-3 text-right text-gray-700">{fmtX(c.roas)}</td>
                <td className="py-2.5 px-3 text-right text-gray-500">{fmtNum(c.clicks)}</td>
                {isDsp && <td className="py-2.5 px-3 text-right text-gray-500">{fmtNum(c.viewableImpressions)}</td>}
                {isDsp && <td className="py-2.5 px-3 text-right text-gray-500">{fmtNum(c.detailPageViews)}</td>}
                {!isDsp && <td className="py-2.5 px-3 text-right text-gray-500">{fmtNum(c.purchases)}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function Advertising() {
  const { range } = useDateRange();
  const [activeTab, setActiveTab] = useState('all');
  const { data, isLoading, isError, error } = useAdvertising(range);

  const combined = data?.combined || {};
  const byType   = data?.byType   || {};
  const weekly   = data?.weekly   || {};
  const campaigns = data?.campaigns || {};

  // Build a merged weekly series for "all" view
  const allWeeklyMerged = (() => {
    if (!data) return [];
    const map = {};
    for (const type of ['sp', 'sb', 'sd', 'dsp']) {
      for (const row of (weekly[type] || [])) {
        if (!map[row.weekStart]) map[row.weekStart] = { week: row.week, weekStart: row.weekStart, spend: 0, sales: 0 };
        map[row.weekStart].spend += row.spend || 0;
        map[row.weekStart].sales += row.sales || 0;
      }
    }
    return Object.values(map).sort((a, b) => a.weekStart?.localeCompare(b.weekStart));
  })();

  const activeType = AD_TYPES.find(t => t.key === activeTab);

  // Get weekly data for selected tab
  const chartData = activeTab === 'all' ? allWeeklyMerged : (weekly[activeTab] || []);
  const tableCampaigns = activeTab === 'all'
    ? [...(campaigns.sp || []), ...(campaigns.sb || []), ...(campaigns.sd || []), ...(campaigns.dsp || [])].sort((a, b) => (b.spend || 0) - (a.spend || 0)).slice(0, 20)
    : (campaigns[activeTab] || []);

  return (
    <div>
      <PageHeader
        title="Advertising"
        subtitle="SP · SB · SD · DSP — all ad types in one view"
        
        
      />

      {isError && <ErrorState message={error?.message} />}

      {/* Combined KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        <MetricCard title="Total Spend" value={combined.totalSpend} format="currency" highlight loading={isLoading} />
        <MetricCard title="Total Sales (attributed)" value={combined.totalSales} format="currency" loading={isLoading} />
        <MetricCard title="Blended ACoS" value={combined.blendedAcos} format="percent" sub="Across all ad types" loading={isLoading} />
        <MetricCard title="Blended ROAS" value={combined.blendedRoas} format="roas" sub="Total sales / total spend" loading={isLoading} />
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
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-1">
            Weekly Spend vs Sales — {activeType?.label}
          </h3>
          <p className="text-xs text-gray-400 mb-4">{activeType?.description}</p>
          {isLoading ? (
            <div className="h-64 bg-gray-100 rounded animate-pulse" />
          ) : chartData.length === 0 ? (
            <div className="h-64 flex items-center justify-center text-gray-400 text-sm">No data for this period</div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={chartData} margin={{ top: 5, right: 10, bottom: 5, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="week" tick={{ fontSize: 11 }} />
                <YAxis
                  tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                  tick={{ fontSize: 11 }}
                />
                <Tooltip
                  formatter={(v, name) => [
                    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v),
                    name,
                  ]}
                  labelStyle={{ fontWeight: 600 }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="spend" name="Spend" stroke={activeType?.color || '#2563eb'} strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="sales" name="Sales" stroke="#10b981" strokeWidth={2} dot={false} strokeDasharray="4 2" />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* DSP special note */}
        {activeTab === 'dsp' && (
          <div className="bg-purple-50 border border-purple-200 rounded-lg px-4 py-3 mb-4 text-sm text-purple-800">
            <strong>DSP Attribution:</strong> DSP uses view-based attribution (not click-based). "Sales" reflects total attributed sales including view-through.
            Viewable Impressions and Detail Page Views are key engagement metrics for DSP campaigns.
          </div>
        )}

        {/* Campaign / Order table */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">
            {activeTab === 'dsp' ? 'DSP Orders' : activeTab === 'all' ? 'Top 20 Campaigns (All Types)' : `${activeType?.label} Campaigns`}
            {' '}
            <span className="text-xs font-normal text-gray-400">by spend</span>
          </h3>
          <CampaignTable
            campaigns={tableCampaigns}
            isDsp={activeTab === 'dsp'}
            loading={isLoading}
          />
        </div>
      </div>

      {/* Spend breakdown bar (visual share by type) */}
      {!isLoading && combined.totalSpend > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Spend Mix by Ad Type</h3>
          <div className="flex h-8 rounded-lg overflow-hidden w-full mb-3">
            {AD_TYPES.filter(t => t.key !== 'all').map(type => {
              const typeData = byType[type.key];
              const pct = combined.totalSpend > 0 ? ((typeData?.spend || 0) / combined.totalSpend) * 100 : 0;
              if (pct < 0.5) return null;
              return (
                <div
                  key={type.key}
                  style={{ width: `${pct}%`, backgroundColor: type.color }}
                  className="flex items-center justify-center text-white text-xs font-bold transition-all"
                  title={`${type.abbr}: ${pct.toFixed(1)}%`}
                >
                  {pct > 8 ? `${type.abbr} ${pct.toFixed(0)}%` : ''}
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-4">
            {AD_TYPES.filter(t => t.key !== 'all').map(type => {
              const typeData = byType[type.key];
              const pct = combined.totalSpend > 0 ? ((typeData?.spend || 0) / combined.totalSpend) * 100 : 0;
              return (
                <div key={type.key} className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: type.color }} />
                  <span className="text-xs text-gray-600">{type.abbr}: <strong>{fmtCurrency(typeData?.spend)}</strong> ({pct.toFixed(1)}%)</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
