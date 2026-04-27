import { useMemo } from 'react';
import {
  ComposedChart, BarChart, Bar, Line, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { useQuery } from '@tanstack/react-query';
import { useDateRange } from '../context/DateRangeContext';
import { useMarketplace } from '../context/MarketplaceContext';
import PageHeader from '../components/PageHeader';
import MarketplaceSwitcher from '../components/MarketplaceSwitcher';
import { SkeletonCard, SkeletonChart, SkeletonTable, ErrorState } from '../components/Skeleton';

// ─── API ──────────────────────────────────────────────────────────────────────
function useSellerOverview(range) {
  const { activeMarketplace } = useMarketplace() ?? {};
  const key = range ? `${range.startDate || range.days}-${range.endDate || ''}` : 'default';
  return useQuery({
    queryKey: ['seller-overview', key, activeMarketplace ?? 'US'],
    queryFn: async () => {
      const params = range?.startDate
        ? `startDate=${range.startDate}&endDate=${range.endDate}`
        : `days=${range?.days || 30}`;
      const r = await fetch(`/seller-analytics/overview?${params}`, { credentials: 'include' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    staleTime: 5 * 60 * 1000,
  });
}

// ─── Formatters ───────────────────────────────────────────────────────────────
function fmt$(n) {
  if (n == null || isNaN(n)) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}
function fmtNum(n) {
  if (n == null || isNaN(n)) return '—';
  return new Intl.NumberFormat('en-US', { notation: 'compact' }).format(Math.round(n));
}
function fmtPct(n) {
  if (n == null || isNaN(n)) return '—';
  return `${Number(n).toFixed(1)}%`;
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

// ─── Buy Box gauge ────────────────────────────────────────────────────────────
function BuyBoxGauge({ pct }) {
  if (pct == null) return <div className="text-2xl font-bold text-gray-400">—</div>;
  const color = pct >= 80 ? 'text-emerald-600' : pct >= 50 ? 'text-amber-500' : 'text-red-600';
  const bg    = pct >= 80 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-400' : 'bg-red-500';
  return (
    <div>
      <div className={`text-2xl font-bold ${color}`}>{fmtPct(pct)}</div>
      <div className="mt-2 h-2 bg-gray-200 rounded-full overflow-hidden">
        <div className={`h-full ${bg} rounded-full transition-all`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
    </div>
  );
}

// ─── Metric card ─────────────────────────────────────────────────────────────
function MetricCard({ title, value, badge, sub, highlight, loading }) {
  if (loading) return <SkeletonCard />;
  const ring = highlight === 'red' ? 'border-t-red-400'
    : highlight === 'amber' ? 'border-t-amber-400'
    : highlight === 'green' ? 'border-t-emerald-400'
    : 'border-t-blue-400';
  return (
    <div className={`bg-white rounded-xl border border-gray-200 border-t-4 ${ring} p-4`}>
      <div className="text-xs font-medium text-gray-500 mb-1">{title}</div>
      <div className="text-2xl font-bold text-gray-900">{value}{badge}</div>
      {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function SellerPerformance() {
  const { range } = useDateRange();
  const { data: ov, isLoading, isError, error } = useSellerOverview(range);

  const m    = ov?.metrics   || {};
  const trend= ov?.trend     || [];
  const asins= ov?.topAsins  || [];

  // Buy Box insight
  const bbSessions   = m.buyBoxSessions;
  const lostSessions = m.lostSessions;
  const bbPct        = m.buyBoxPct;

  // Lost revenue estimate: lost sessions × CVR × avg order value
  const aov = m.orderedRevenue && m.orderedUnits ? m.orderedRevenue / m.orderedUnits : null;
  const estimatedLostRevenue = (lostSessions && m.cvr && aov)
    ? Math.round(lostSessions * (m.cvr / 100) * aov)
    : null;

  return (
    <div>
      <PageHeader
        title="Seller Analytics"
        subtitle="Orders · Sessions · Buy Box · Conversion Rate"
        actions={<MarketplaceSwitcher />
        }
      />

      {isError && <ErrorState message={error?.message} />}

      {/* ── KPI Row 1: Revenue & Traffic ──────────────────────────────────── */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-4">
        <MetricCard
          title="Ordered Revenue"
          value={fmt$(m.orderedRevenue)}
          badge={<WoWBadge current={m.orderedRevenue} previous={m.prevOrderedRevenue} />}
          sub="Total ordered product sales"
          highlight="blue"
          loading={isLoading}
        />
        <MetricCard
          title="Ordered Units"
          value={fmtNum(m.orderedUnits)}
          sub="Units ordered in period"
          highlight="blue"
          loading={isLoading}
        />
        <MetricCard
          title="Sessions"
          value={fmtNum(m.sessions)}
          badge={<WoWBadge current={m.sessions} previous={m.prevSessions} />}
          sub="Detail page visits"
          highlight="blue"
          loading={isLoading}
        />
        <MetricCard
          title="Conversion Rate"
          value={fmtPct(m.cvr)}
          sub="Orders ÷ sessions"
          highlight={m.cvr != null && m.cvr < 5 ? 'amber' : 'green'}
          loading={isLoading}
        />
      </div>

      {/* ── KPI Row 2: Buy Box ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-6">

        {/* Buy Box % card with gauge */}
        <div className={`bg-white rounded-xl border border-gray-200 border-t-4 ${
          bbPct == null ? 'border-t-gray-300' :
          bbPct >= 80 ? 'border-t-emerald-400' :
          bbPct >= 50 ? 'border-t-amber-400' : 'border-t-red-400'
        } p-4`}>
          <div className="flex items-center justify-between mb-1">
            <div className="text-xs font-medium text-gray-500">Buy Box %</div>
            {m.prevBuyBoxPct != null && (
              <WoWBadge current={bbPct} previous={m.prevBuyBoxPct} />
            )}
          </div>
          {isLoading ? <SkeletonCard /> : <BuyBoxGauge pct={bbPct} />}
          <div className="text-xs text-gray-400 mt-2">
            {bbPct != null ? `${fmtNum(bbSessions)} sessions won · ${fmtNum(lostSessions)} lost to competitors` : 'No Buy Box data in this period'}
          </div>
          {/* Trend signal: compare first half vs second half of period */}
          {!isLoading && (() => {
            const half = Math.floor(trend.length / 2);
            if (half < 2) return null;
            const firstHalf = trend.slice(0, half).filter(r => r.buyBoxPct != null);
            const secondHalf = trend.slice(half).filter(r => r.buyBoxPct != null);
            if (!firstHalf.length || !secondHalf.length) return null;
            const avgFirst  = firstHalf.reduce((s,r)=>s+r.buyBoxPct,0)/firstHalf.length;
            const avgSecond = secondHalf.reduce((s,r)=>s+r.buyBoxPct,0)/secondHalf.length;
            const delta = avgSecond - avgFirst;
            if (Math.abs(delta) < 2) return null;
            const declining = delta < 0;
            return (
              <div className={`mt-1 text-xs font-medium ${declining ? 'text-red-500' : 'text-emerald-600'}`}>
                {declining ? '⚠️' : '✅'} {declining ? 'Declining' : 'Improving'} {Math.abs(delta).toFixed(1)}pp over period
              </div>
            );
          })()}
        </div>

        {/* Won sessions */}
        <div className="bg-white rounded-xl border border-gray-200 border-t-4 border-t-emerald-400 p-4">
          <div className="text-xs font-medium text-gray-500 mb-1">Buy Box Sessions Won</div>
          {isLoading ? <SkeletonCard /> : (
            <>
              <div className="text-2xl font-bold text-emerald-700">{fmtNum(bbSessions)}</div>
              <div className="text-xs text-gray-400 mt-0.5">of {fmtNum(m.sessions)} total sessions</div>
            </>
          )}
        </div>

        {/* Lost sessions + revenue estimate */}
        <div className="bg-white rounded-xl border border-gray-200 border-t-4 border-t-red-400 p-4">
          <div className="text-xs font-medium text-gray-500 mb-1">Lost to Competitors</div>
          {isLoading ? <SkeletonCard /> : (
            <>
              <div className="text-2xl font-bold text-red-600">{fmtNum(lostSessions)}</div>
              <div className="text-xs text-gray-400 mt-0.5">
                {estimatedLostRevenue
                  ? `≈ ${fmt$(estimatedLostRevenue)} in estimated lost revenue`
                  : 'sessions going to other sellers'}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Revenue + Sessions Trend ──────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-1">Revenue & Sessions Trend</h3>
        <p className="text-xs text-gray-400 mb-4">Daily ordered revenue · sessions · CVR</p>
        {isLoading ? <SkeletonChart /> : trend.length === 0 ? (
          <div className="h-60 flex items-center justify-center text-gray-400 text-sm">No trend data</div>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={trend} margin={{ top: 5, right: 50, bottom: 5, left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }}
                tickFormatter={d => { try { return new Date(d+'T00:00:00Z').toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'UTC'}); } catch { return d; }}}
              />
              <YAxis yAxisId="rev" tickFormatter={v => `$${(v/1000).toFixed(0)}k`} tick={{ fontSize: 11 }} />
              <YAxis yAxisId="sess" orientation="right" tickFormatter={v => fmtNum(v)} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v, name) => {
                if (name === 'Revenue') return [fmt$(v), name];
                if (name === 'CVR %') return [fmtPct(v), name];
                return [fmtNum(v), name];
              }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar yAxisId="rev" dataKey="revenue" name="Revenue" fill="#2563eb" radius={[3,3,0,0]} />
              <Line yAxisId="sess" type="monotone" dataKey="sessions" name="Sessions" stroke="#10b981" strokeWidth={2} dot={false} />
              <Line yAxisId="sess" type="monotone" dataKey="cvr" name="CVR %" stroke="#f59e0b" strokeWidth={2} dot={false} strokeDasharray="4 4" />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* ── Buy Box Trend ─────────────────────────────────────────────────── */}
      {!isLoading && trend.some(r => r.buyBoxPct != null) && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-1">Buy Box % Trend</h3>
          <p className="text-xs text-gray-400 mb-4">Won vs lost sessions over time</p>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={trend.filter(r => r.buyBoxPct != null)} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }}
                tickFormatter={d => { try { return new Date(d+'T00:00:00Z').toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'UTC'}); } catch { return d; }}}
              />
              <YAxis domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v, name) => [fmtPct(v), name]} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Area type="monotone" dataKey="buyBoxPct" name="Buy Box %" stroke="#2563eb" fill="#dbeafe" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── Top ASINs ─────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">Top ASINs by Ordered Revenue</h3>
        {isLoading ? <SkeletonTable /> : asins.length === 0 ? (
          <div className="text-gray-400 text-sm text-center py-8">No ASIN data for this period</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">ASIN</th>
                  <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Ordered Rev</th>
                  <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Units</th>
                  <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Sessions</th>
                  <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Buy Box %</th>
                  <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">CVR</th>
                </tr>
              </thead>
              <tbody>
                {asins.slice(0, 20).map((r, i) => {
                  const bbColor = r.buyBoxPct == null ? '' :
                    r.buyBoxPct >= 80 ? 'text-emerald-700 font-semibold' :
                    r.buyBoxPct >= 50 ? 'text-amber-600' : 'text-red-600 font-semibold';
                  return (
                    <tr key={r.asin} className={`border-b border-gray-50 hover:bg-gray-50 ${i % 2 === 1 ? 'bg-gray-50/40' : ''}`}>
                      <td className="py-2.5 px-3 font-mono text-xs text-blue-700">{r.asin}</td>
                      <td className="py-2.5 px-3 text-right font-semibold text-gray-900">{fmt$(r.orderedRevenue)}</td>
                      <td className="py-2.5 px-3 text-right text-gray-600">{fmtNum(r.orderedUnits)}</td>
                      <td className="py-2.5 px-3 text-right text-gray-500">{fmtNum(r.sessions) === '—' ? '—' : fmtNum(r.sessions)}</td>
                      <td className={`py-2.5 px-3 text-right ${bbColor}`}>{fmtPct(r.buyBoxPct)}</td>
                      <td className="py-2.5 px-3 text-right text-gray-500">{fmtPct(r.cvr)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
