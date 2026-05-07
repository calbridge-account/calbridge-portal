/**
 * AdTrendChart
 * Reusable spend/sales trend chart for advertising sub-tabs.
 * Mirrors the overview's chart with Daily/Weekly/Monthly toggle + Export.
 *
 * Props:
 *   trendRows      — raw rows from /advertising/trend (may be uppercase Snowflake cols)
 *   loading        — boolean
 *   channel        — 'all' | 'ads' | 'dsp'  (for colour)
 *   adType         — 'SP' | 'SB' | 'SD' | 'DSP' | null  (for display label)
 *   currency       — 'USD' | 'CAD'
 *   title          — optional override chart heading
 *   className      — optional extra wrapper classes
 *   selectedRows   — array of row objects with .spend/.sales (subset selected in table)
 *   allRows        — array of all row objects with .spend/.sales (for proportion calc)
 */
import { useState, useMemo, useRef } from 'react';
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import ExportMenu from './ExportMenu';
import { exportToXlsx, exportToCsv, exportChartToPng } from '../utils/exportUtils';

// ─── helpers ─────────────────────────────────────────────────────────────────
function makeFmtCurrency(currency = 'USD') {
  const locale = currency === 'CAD' ? 'en-CA' : 'en-US';
  return (n) => {
    if (n == null || isNaN(n)) return '—';
    return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);
  };
}
function fmtRoas(n) {
  if (n == null || isNaN(n)) return '—';
  return `$${Number(n).toFixed(2)}`;
}

function isoWeek(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const jan4 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const weekNum = Math.ceil(((d - jan4) / 86400000 + jan4.getUTCDay() + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

function aggregateTrend(rows, granularity) {
  if (granularity === 'daily') return rows;
  const buckets = new Map();
  for (const r of rows) {
    const key = granularity === 'weekly'
      ? isoWeek(r.date)
      : r.date.substring(0, 7);
    if (!buckets.has(key)) buckets.set(key, { key, spend: 0, sales: 0, clicks: 0 });
    const b = buckets.get(key);
    b.spend  += r.spend;
    b.sales  += r.sales;
    b.clicks += r.clicks;
  }
  return Array.from(buckets.values()).map(b => ({
    date:  b.key,
    label: b.key,
    spend: b.spend,
    sales: b.sales,
    clicks: b.clicks,
    roas:  b.spend  > 0 ? b.sales  / b.spend  : null,
    cpc:   b.clicks > 0 ? b.spend  / b.clicks : null,
    acos:  b.sales  > 0 ? b.spend  / b.sales  : null,
  }));
}

const CHANNEL_COLORS = {
  all:  '#6366f1',
  ads:  '#2563eb',
  dsp:  '#8b5cf6',
  SP:   '#2563eb',
  SB:   '#10b981',
  SD:   '#f59e0b',
  DSP:  '#8b5cf6',
};

// ─── Tooltip ─────────────────────────────────────────────────────────────────
function CustomTooltip({ active, payload, label, fmtC }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-200 shadow-lg rounded-lg px-3 py-2 text-xs">
      <div className="font-semibold text-gray-700 mb-1">{label}</div>
      {payload.map(p => (
        <div key={p.dataKey} className="flex justify-between gap-4">
          <span style={{ color: p.color }}>{p.name}</span>
          <span className="font-medium text-gray-800">
            {p.dataKey === 'roas' ? fmtRoas(p.value) :
             p.dataKey === 'cpc'  ? fmtC(p.value) :
             p.dataKey === 'acos' ? (p.value != null ? (p.value * 100).toFixed(1) + '%' : '—') :
             fmtC(p.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function AdTrendChart({ trendRows, loading, channel = 'all', adType, currency = 'USD', title, className = '', selectedRows, allRows }) {
  const [granularity, setGranularity] = useState('daily');
  const chartRef = useRef(null);
  const fmtC = makeFmtCurrency(currency);

  const spendColor = CHANNEL_COLORS[adType] || CHANNEL_COLORS[channel] || '#6366f1';

  // Normalise rows (handles both uppercase Snowflake cols and camelCase)
  const dailyData = useMemo(() => (trendRows || []).map(r => {
    const spend  = Number(r.SPEND  ?? r.spend  ?? 0);
    const sales  = Number(r.SALES  ?? r.sales  ?? 0);
    const clicks = Number(r.CLICKS ?? r.clicks ?? 0);
    const dateRaw = r.REPORT_DATE ?? r.report_date ?? '';
    const dateStr = String(dateRaw).substring(0, 10);
    const label = (() => {
      try {
        const d = new Date(dateStr + 'T00:00:00Z');
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
      } catch { return dateStr; }
    })();
    return {
      date: dateStr, label, spend, sales, clicks,
      roas: spend  > 0 ? sales  / spend  : null,
      cpc:  clicks > 0 ? spend  / clicks : null,
      acos: sales  > 0 ? spend  / sales  : null,
    };
  }), [trendRows]);

  const chartData = useMemo(() => aggregateTrend(dailyData, granularity), [dailyData, granularity]);

  // If rows are selected, scale chart proportionally to their share of total spend
  const scaledChartData = useMemo(() => {
    if (!selectedRows || selectedRows.length === 0 || !allRows || allRows.length === 0) return chartData;
    const allSpend = allRows.reduce((s, r) => s + (r.spend || 0), 0);
    const selSpend = selectedRows.reduce((s, r) => s + (r.spend || 0), 0);
    const allSales = allRows.reduce((s, r) => s + (r.sales || 0), 0);
    const selSales = selectedRows.reduce((s, r) => s + (r.sales || 0), 0);
    const spendRatio = allSpend > 0 ? selSpend / allSpend : 0;
    const salesRatio = allSales > 0 ? selSales / allSales : 0;
    return chartData.map(r => ({
      ...r,
      spend: r.spend * spendRatio,
      sales: r.sales * salesRatio,
      roas:  (r.spend * spendRatio) > 0 ? (r.sales * salesRatio) / (r.spend * spendRatio) : null,
      cpc:   r.clicks > 0 ? (r.spend * spendRatio) / r.clicks : null,
    }));
  }, [chartData, selectedRows, allRows]);

  const displayTitle = title || (adType ? `${adType} — Spend & Sales Trend` : 'Spend & Sales Trend');
  const selectionNote = selectedRows && selectedRows.length > 0
    ? ` — ${selectedRows.length} selected`
    : '';

  const exportRows = () => chartData.map(r => ({
    Date:  r.date,
    Spend: r.spend,
    Sales: r.sales,
    ROAS:  r.roas?.toFixed(2) ?? '',
    CPC:   r.cpc?.toFixed(2) ?? '',
    ACoS:  r.acos != null ? `${(r.acos * 100).toFixed(1)}%` : '',
    Clicks: r.clicks,
  }));

  if (loading) {
    return (
      <div className={`bg-white rounded-xl border border-gray-200 p-5 ${className}`}>
        <div className="h-4 bg-gray-100 rounded w-48 mb-4 animate-pulse" />
        <div className="h-48 bg-gray-100 rounded animate-pulse" />
      </div>
    );
  }

  if (!chartData.length) return null;

  return (
    <div ref={chartRef} className={`bg-white rounded-xl border border-gray-200 p-5 ${className}`}>
      <div className="flex items-center justify-between mb-1 gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-gray-700">{displayTitle}{selectionNote}</h3>
          {selectedRows && selectedRows.length > 0 && (
            <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">
              Filtered to selection
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {chartData.length > 0 && (
            <ExportMenu
              onXlsx={() => exportToXlsx(exportRows(), 'trend-data')}
              onCsv={() => exportToCsv(exportRows(), 'trend-data')}
              onPng={() => chartRef.current && exportChartToPng(chartRef.current, 'trend-chart')}
            />
          )}
          <div className="flex gap-0 border border-gray-200 rounded-lg overflow-hidden">
            {[{ key: 'daily', label: 'Daily' }, { key: 'weekly', label: 'Weekly' }, { key: 'monthly', label: 'Monthly' }].map(g => (
              <button
                key={g.key}
                onClick={() => setGranularity(g.key)}
                className={`px-3 py-1 text-xs font-medium transition-colors ${
                  granularity === g.key ? 'bg-green-700 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'
                }`}
              >
                {g.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <p className="text-xs text-gray-400 mb-4">Spend · Sales · ROAS · CPC</p>
      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart data={scaledChartData} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: '#9ca3af' }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            yAxisId="left"
            tick={{ fontSize: 11, fill: '#9ca3af' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={v => fmtC(v)}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            tick={{ fontSize: 11, fill: '#9ca3af' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={v => v != null ? `$${Number(v).toFixed(2)}` : ''}
          />
          <Tooltip content={<CustomTooltip fmtC={fmtC} />} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line yAxisId="left"  type="monotone" dataKey="spend" name="Spend" stroke={spendColor}  strokeWidth={2} dot={false} />
          <Line yAxisId="left"  type="monotone" dataKey="sales" name="Sales" stroke="#10b981" strokeWidth={2} dot={false} strokeDasharray="4 2" />
          <Line yAxisId="right" type="monotone" dataKey="roas"  name="ROAS"  stroke="#f59e0b" strokeWidth={1.5} dot={false} strokeDasharray="2 2" />
          <Line yAxisId="right" type="monotone" dataKey="cpc"   name="CPC"   stroke="#8b5cf6" strokeWidth={1.5} dot={false} strokeDasharray="2 2" />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
