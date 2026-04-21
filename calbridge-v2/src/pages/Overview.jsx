import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Card, Metric, Text, Title, BadgeDelta,
} from '@tremor/react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { useDateRange } from '../context/DateRangeContext';
import { getOverview, getOpportunities, getCampaigns } from '../api/v2client';

// ─── Formatters ─────────────────────────────────────────────────────────────
const fmt$ = (v) =>
  v == null ? '—' : '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

const fmtPct = (v) =>
  v == null ? '—' : (Number(v) * 100).toFixed(1) + '%';

const fmtNum = (v) =>
  v == null ? '—' : Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 });

const fmtX = (v) =>
  v == null ? '—' : Number(v).toFixed(2) + 'x';

// ─── Skeleton blocks ─────────────────────────────────────────────────────────
function KpiSkeleton() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="rounded-lg border border-gray-200 p-4 animate-pulse bg-white">
          <div className="h-3 bg-gray-200 rounded w-2/3 mb-3" />
          <div className="h-6 bg-gray-300 rounded w-3/4" />
        </div>
      ))}
    </div>
  );
}

function ChartSkeleton() {
  return (
    <div className="rounded-lg border border-gray-200 p-4 mb-6 animate-pulse bg-white h-64" />
  );
}

function TableSkeleton() {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 animate-pulse">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="h-4 bg-gray-200 rounded mb-3 w-full" />
      ))}
    </div>
  );
}

// ─── Error state ─────────────────────────────────────────────────────────────
function ErrorState({ message }) {
  return (
    <Card className="mb-4">
      <Text className="text-red-500">⚠ {message || 'Failed to load data.'}</Text>
    </Card>
  );
}

// ─── Priority badge ───────────────────────────────────────────────────────────
const PRIORITY_COLORS = {
  high:   'bg-red-100 text-red-700',
  medium: 'bg-yellow-100 text-yellow-700',
  low:    'bg-gray-100 text-gray-600',
};

function PriorityBadge({ priority }) {
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${PRIORITY_COLORS[priority] || PRIORITY_COLORS.low}`}>
      {priority?.toUpperCase()}
    </span>
  );
}

// ─── KPI Cards ───────────────────────────────────────────────────────────────
function KpiCards({ kpis }) {
  const cards = [
    { label: 'Total Ad Spend',        value: fmt$(kpis.totalSpend),       delta: null },
    { label: 'Ad Attributed Sales',   value: fmt$(kpis.totalAdSales),     delta: null },
    { label: 'Blended ACoS',          value: fmtPct(kpis.blendedAcos),    delta: null },
    { label: 'Blended ROAS',          value: fmtX(kpis.blendedRoas),      delta: null },
    { label: 'Ordered Revenue',       value: fmt$(kpis.orderedRevenue),    delta: null },
    { label: 'Impressions',           value: fmtNum(kpis.impressions),     delta: null },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
      {cards.map((c) => (
        <Card key={c.label} className="flex flex-col gap-1">
          <Text className="text-xs text-gray-500 font-medium">{c.label}</Text>
          <Metric className="text-xl">{c.value}</Metric>
        </Card>
      ))}
    </div>
  );
}

// ─── Spend Trend Chart ────────────────────────────────────────────────────────
function SpendTrendChart({ data }) {
  if (!data || data.length === 0) {
    return (
      <Card className="mb-6">
        <Title>Spend &amp; Sales Trend</Title>
        <Text className="mt-2 text-gray-400">No data for selected period.</Text>
      </Card>
    );
  }

  const formatted = data.map((d) => ({
    date:  typeof d.date === 'string' ? d.date.slice(0, 10) : String(d.date).slice(0, 10),
    spend: Number(d.spend) || 0,
    sales: Number(d.sales) || 0,
  }));

  return (
    <Card className="mb-6">
      <Title className="mb-4">Spend &amp; Sales Trend</Title>
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={formatted} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11 }}
            tickFormatter={(v) => v.slice(5)} // MM-DD
          />
          <YAxis
            tick={{ fontSize: 11 }}
            tickFormatter={(v) => '$' + (v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v)}
          />
          <Tooltip
            formatter={(val, name) => ['$' + Number(val).toLocaleString(), name]}
          />
          <Legend />
          <Line
            type="monotone"
            dataKey="spend"
            stroke="#6366f1"
            strokeWidth={2}
            dot={false}
            name="Spend"
          />
          <Line
            type="monotone"
            dataKey="sales"
            stroke="#22c55e"
            strokeWidth={2}
            dot={false}
            name="Sales"
          />
        </LineChart>
      </ResponsiveContainer>
    </Card>
  );
}

// ─── Opportunity Strip ────────────────────────────────────────────────────────
function OpportunityStrip({ opportunities }) {
  const top3 = (opportunities || []).slice(0, 3);

  return (
    <Card className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <Title>Top Opportunities</Title>
        <Link to="/opportunities" className="text-sm text-indigo-600 hover:underline font-medium">
          View all →
        </Link>
      </div>
      {top3.length === 0 ? (
        <Text className="text-gray-400">No opportunities found for this period.</Text>
      ) : (
        <div className="flex flex-col gap-3">
          {top3.map((opp) => (
            <Link
              key={opp.id}
              to="/opportunities"
              className="flex items-start gap-3 p-3 rounded-lg border border-gray-100 hover:bg-gray-50 transition"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <PriorityBadge priority={opp.priority} />
                  <span className="text-xs text-gray-400 uppercase tracking-wide">{opp.type?.replace(/_/g, ' ')}</span>
                </div>
                <p className="text-sm font-semibold text-gray-800 truncate">{opp.title}</p>
                <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{opp.why}</p>
              </div>
              <div className="text-right shrink-0">
                <span className="text-xs text-gray-400">
                  {(opp.confidence * 100).toFixed(0)}% conf
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </Card>
  );
}

// ─── Top Campaigns Table ──────────────────────────────────────────────────────
function TopCampaignsTable({ campaigns }) {
  const top5 = (campaigns || []).slice(0, 5);

  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <Title>Top Campaigns by Spend</Title>
        <Link to="/advertising" className="text-sm text-indigo-600 hover:underline font-medium">
          View all →
        </Link>
      </div>
      {top5.length === 0 ? (
        <Text className="text-gray-400">No campaign data for this period.</Text>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                <th className="pb-2 pr-4 font-medium">Campaign</th>
                <th className="pb-2 pr-4 font-medium text-right">Spend</th>
                <th className="pb-2 pr-4 font-medium text-right">Sales</th>
                <th className="pb-2 font-medium text-right">ACoS</th>
              </tr>
            </thead>
            <tbody>
              {top5.map((c) => (
                <tr key={`${c.campaignId}-${c.adProduct}`} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="py-2 pr-4 max-w-[200px]">
                    <p className="truncate font-medium text-gray-800" title={c.campaignName}>
                      {c.campaignName || c.campaignId}
                    </p>
                    <span className="text-xs text-gray-400">{c.adProduct}</span>
                  </td>
                  <td className="py-2 pr-4 text-right text-gray-700">{fmt$(c.spend)}</td>
                  <td className="py-2 pr-4 text-right text-gray-700">{fmt$(c.sales)}</td>
                  <td className="py-2 text-right">
                    {c.acos == null ? (
                      <span className="text-gray-400">—</span>
                    ) : (
                      <span
                        className={
                          c.acos < 0.15
                            ? 'text-green-600 font-medium'
                            : c.acos < 0.30
                            ? 'text-yellow-600 font-medium'
                            : 'text-red-600 font-medium'
                        }
                      >
                        {fmtPct(c.acos)}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ─── Main Overview Component ──────────────────────────────────────────────────
export default function Overview() {
  const { rangeParams, rangeLabel } = useDateRange();
  const rp = rangeParams();

  const {
    data: overviewData,
    isLoading: overviewLoading,
    error: overviewError,
  } = useQuery({
    queryKey: ['overview', rp],
    queryFn:  () => getOverview(rp),
    staleTime: 5 * 60 * 1000,
  });

  const {
    data: oppsData,
    isLoading: oppsLoading,
    error: oppsError,
  } = useQuery({
    queryKey: ['opportunities', rp],
    queryFn:  () => getOpportunities(rp),
    staleTime: 5 * 60 * 1000,
  });

  const {
    data: campaignsData,
    isLoading: campaignsLoading,
    error: campaignsError,
  } = useQuery({
    queryKey: ['campaigns-overview', rp],
    queryFn:  () => getCampaigns(rp),
    staleTime: 5 * 60 * 1000,
  });

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Overview</h1>
        <p className="text-sm text-gray-500 mt-1">Showing data for: {rangeLabel()}</p>
      </div>

      {/* KPI Cards */}
      {overviewLoading ? (
        <KpiSkeleton />
      ) : overviewError ? (
        <ErrorState message={overviewError.message} />
      ) : (
        <KpiCards kpis={overviewData?.kpis || {}} />
      )}

      {/* Spend Trend */}
      {overviewLoading ? (
        <ChartSkeleton />
      ) : overviewError ? null : (
        <SpendTrendChart data={overviewData?.spendTrend || []} />
      )}

      {/* Bottom row: Opportunities + Campaigns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Opportunities */}
        {oppsLoading ? (
          <div className="animate-pulse"><TableSkeleton /></div>
        ) : oppsError ? (
          <ErrorState message={oppsError.message} />
        ) : (
          <OpportunityStrip opportunities={oppsData?.opportunities || []} />
        )}

        {/* Top Campaigns */}
        {campaignsLoading ? (
          <div className="animate-pulse"><TableSkeleton /></div>
        ) : campaignsError ? (
          <ErrorState message={campaignsError.message} />
        ) : (
          <TopCampaignsTable campaigns={campaignsData?.campaigns || []} />
        )}
      </div>
    </div>
  );
}
