import { useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer, Cell, LineChart, Line,
} from 'recharts';
import { useForecasting, useForecastShift } from '../hooks/useAnalytics';
import { useDateRange } from '../context/DateRangeContext';
import PageHeader from '../components/PageHeader';
import { SkeletonChart, SkeletonTable, ErrorState } from '../components/Skeleton';

function fmt(n, style = 'number') {
  if (n == null || isNaN(n)) return '—';
  if (style === 'number') return new Intl.NumberFormat('en-US').format(Math.round(n));
  if (style === 'weeks') return `${Number(n).toFixed(1)}w`;
  return n;
}

const FORECAST_WEEKS = [
  { value: 1, label: 'Next 1 week' },
  { value: 2, label: 'Next 2 weeks' },
  { value: 4, label: 'Next 4 weeks' },
  { value: 8, label: 'Next 8 weeks' },
];

function coverageColor(weeks) {
  if (weeks == null) return 'text-gray-400';
  if (weeks < 1) return 'text-red-600 font-semibold';
  if (weeks < 2) return 'text-orange-600 font-medium';
  if (weeks < 4) return 'text-yellow-600';
  return 'text-green-700';
}

export default function Forecasting() {
  const { range } = useDateRange();
  const [weeks, setWeeks] = useState(4);
  const [search, setSearch] = useState('');
  const { data, isLoading, isError, error } = useForecasting(range);

  const allAsins = data?.all || [];
  const top20    = data?.top20Bar || [];
  const total    = data?.totalAsins || 0;

  const filtered = allAsins.filter(r => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return r.asin?.toLowerCase().includes(q) || r.title?.toLowerCase().includes(q);
  });

  return (
    <div>
      <PageHeader
        title="Demand Forecasting"
        subtitle={`${total} ASINs · Amazon ML forecast`}
      />

      {/* Period selector — custom options for forecast */}
      <div className="flex items-center gap-2 mb-6">
        <span className="text-sm text-gray-500">Horizon:</span>
        {FORECAST_WEEKS.map(o => (
          <button
            key={o.value}
            onClick={() => setWeeks(o.value)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-all ${
              weeks === o.value
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>

      {isError && <ErrorState message={error?.message} />}

      {/* Summary stats */}
      {!isLoading && allAsins.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
          {[
            {
              label: 'Total Forecasted Units',
              value: fmt(allAsins.reduce((s, r) => s + (r.meanForecast || 0), 0)),
              sub: `Mean across ${total} ASINs`,
            },
            {
              label: 'P90 Total (high confidence)',
              value: fmt(allAsins.reduce((s, r) => s + (r.p90 || 0), 0)),
              sub: '90th percentile scenario',
            },
            {
              label: 'ASINs with Low Coverage',
              value: allAsins.filter(r => r.coverageWeeks != null && r.coverageWeeks < 2).length,
              sub: '< 2 weeks inventory left',
              warn: true,
            },
            {
              label: 'ASINs Out of Stock',
              value: allAsins.filter(r => r.onHand != null && r.onHand === 0).length,
              sub: 'Zero sellable on hand',
              warn: true,
            },
          ].map(card => (
            <div key={card.label} className={`bg-white rounded-xl border p-4 ${card.warn ? 'border-orange-200' : 'border-gray-200'}`}>
              <div className="text-xs text-gray-500 mb-1">{card.label}</div>
              <div className={`text-xl font-bold ${card.warn ? 'text-orange-600' : 'text-gray-900'}`}>{card.value}</div>
              <div className="text-xs text-gray-400 mt-0.5">{card.sub}</div>
            </div>
          ))}
        </div>
      )}

      {/* Top 20 Bar Chart */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">
          Top 20 ASINs by Mean Forecast (next {weeks} {weeks === 1 ? 'week' : 'weeks'})
        </h3>
        {isLoading ? (
          <div className="h-72 bg-gray-100 rounded animate-pulse" />
        ) : top20.length === 0 ? (
          <div className="h-72 flex items-center justify-center text-gray-400 text-sm">No forecast data</div>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart
              data={top20}
              layout="vertical"
              margin={{ top: 5, right: 30, left: 80, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 10 }} />
              <YAxis
                type="category"
                dataKey="asin"
                tick={{ fontSize: 10 }}
                width={90}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0].payload;
                  return (
                    <div className="bg-white border border-gray-200 rounded-lg p-3 shadow-lg text-xs">
                      <div className="font-semibold text-gray-900 mb-1">{d.asin}</div>
                      {d.title && <div className="text-gray-500 mb-2 max-w-48 truncate">{d.title}</div>}
                      <div className="flex gap-4">
                        <div><span className="text-gray-400">Forecast:</span> <strong>{fmt(d.meanForecast)}</strong></div>
                        <div><span className="text-gray-400">On Hand:</span> <strong>{fmt(d.onHand)}</strong></div>
                      </div>
                    </div>
                  );
                }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="meanForecast" name="Mean Forecast" fill="#2563eb" radius={[0, 4, 4, 0]}>
                {top20.map((entry, index) => (
                  <Cell
                    key={entry.asin}
                    fill={entry.onHand != null && entry.onHand < entry.meanForecast ? '#ef4444' : '#2563eb'}
                  />
                ))}
              </Bar>
              <Bar dataKey="onHand" name="On Hand" fill="#d1fae5" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
        <p className="text-xs text-gray-400 mt-2">
          Red bars = forecast exceeds current on-hand inventory.
        </p>
      </div>

      {/* Full Forecast Table */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
          <h3 className="text-sm font-semibold text-gray-700">
            All ASINs — Demand Forecast ({total} ASINs)
          </h3>
          <input
            type="text"
            placeholder="Search ASIN or product…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-3 py-2 w-full sm:w-64 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {isLoading ? (
          <SkeletonTable />
        ) : filtered.length === 0 ? (
          <div className="text-gray-400 text-sm text-center py-8">
            {search ? 'No ASINs match your search.' : 'No forecast data available.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  {['ASIN', 'Model #', 'Mean Forecast', 'P70', 'P80', 'P90', 'On Hand', 'Coverage (weeks)'].map(h => (
                    <th key={h} className="text-left py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((row, i) => (
                  <tr key={row.asin} className={`border-b border-gray-50 hover:bg-blue-50/30 transition-colors ${i % 2 === 1 ? 'bg-gray-50/40' : ''}`}>
                    <td className="py-2.5 px-3 font-mono text-xs text-blue-700 whitespace-nowrap">{row.asin}</td>
                    <td className="py-2.5 px-3 text-gray-700 max-w-sm" title={[row.model, row.title].filter(Boolean).join(' — ')}>
                      {row.model && <span className="font-medium text-gray-900 whitespace-nowrap">{row.model}</span>}
                      {row.model && row.title && <span className="text-gray-400 mx-1">—</span>}
                      {row.title && <span className="text-gray-500 text-xs truncate block max-w-xs">{row.title}</span>}
                      {!row.model && !row.title && '—'}
                    </td>
                    <td className="py-2.5 px-3 text-right font-semibold text-gray-900">{fmt(row.meanForecast)}</td>
                    <td className="py-2.5 px-3 text-right text-gray-600">{fmt(row.p70)}</td>
                    <td className="py-2.5 px-3 text-right text-gray-600">{fmt(row.p80)}</td>
                    <td className="py-2.5 px-3 text-right text-gray-600">{fmt(row.p90)}</td>
                    <td className="py-2.5 px-3 text-right">
                      {row.onHand != null ? (
                        <span className={row.onHand < (row.meanForecast || 0) ? 'text-red-600 font-medium' : 'text-gray-700'}>
                          {fmt(row.onHand)}
                        </span>
                      ) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className={`py-2.5 px-3 text-right ${coverageColor(row.coverageWeeks)}`}>
                      {row.coverageWeeks != null ? fmt(row.coverageWeeks, 'weeks') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="text-xs text-gray-400 mt-3 flex items-center gap-4">
              <span>{filtered.length} ASINs shown</span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-red-500" /> Inventory below forecast
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-orange-500" /> &lt; 2 weeks coverage
              </span>
            </div>
          </div>
        )}
      </div>
      {/* Forecast Shift / Revision History */}
      <ForecastShiftSection />
    </div>
  );
}

// Line colors for the top ASINs in the forecast shift chart
const SHIFT_COLORS = ['#2563eb', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#64748b'];

function ForecastShiftSection() {
  const { data, isLoading, isError } = useForecastShift();
  const [selectedAsin, setSelectedAsin] = useState(null);

  const asins = data?.asins || [];

  // Pick which ASINs to show in the chart (single selected, or top 5 if none selected)
  const displayAsins = selectedAsin
    ? asins.filter(a => a.asin === selectedAsin)
    : asins.slice(0, 5);

  // Build chart data: x = generationDate, y = totalForecastNext4Weeks per ASIN
  // Collect all unique generation dates
  const allDates = [...new Set(
    asins.flatMap(a => a.generationDates.map(g => g.date))
  )].sort();

  const chartData = allDates.map(date => {
    const point = { date };
    for (const asin of displayAsins) {
      const found = asin.generationDates.find(g => g.date === date);
      point[asin.asin] = found ? found.totalForecastNext4Weeks : null;
    }
    return point;
  });

  function shortLabel(asin, modelNumber) {
    return modelNumber || asin;
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 mt-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-700">
            📈 Forecast Revision History
          </h3>
          <p className="text-xs text-gray-400 mt-0.5">
            How Amazon’s demand forecast for the next 4 weeks has shifted over time, by forecast generation date.
          </p>
        </div>
        <select
          className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={selectedAsin || ''}
          onChange={e => setSelectedAsin(e.target.value || null)}
        >
          <option value="">Top 5 ASINs</option>
          {asins.map(a => (
            <option key={a.asin} value={a.asin}>
              {a.modelNumber || a.asin}
            </option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <div className="h-64 bg-gray-100 rounded animate-pulse" />
      ) : isError ? (
        <div className="text-red-400 text-sm py-4">Failed to load forecast history</div>
      ) : chartData.length === 0 ? (
        <div className="h-40 flex items-center justify-center text-gray-400 text-sm">No forecast history available</div>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={chartData} margin={{ top: 5, right: 10, bottom: 20, left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10 }}
                angle={-35}
                textAnchor="end"
                interval={Math.max(0, Math.floor(allDates.length / 8) - 1)}
              />
              <YAxis
                tickFormatter={(v) => new Intl.NumberFormat('en-US', { notation: 'compact' }).format(v)}
                tick={{ fontSize: 10 }}
              />
              <Tooltip
                formatter={(v, name) => [v != null ? new Intl.NumberFormat('en-US').format(Math.round(v)) : '—', name]}
                labelStyle={{ fontWeight: 600 }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {displayAsins.map((asin, i) => (
                <Line
                  key={asin.asin}
                  type="monotone"
                  dataKey={asin.asin}
                  name={shortLabel(asin.asin, asin.modelNumber)}
                  stroke={SHIFT_COLORS[i % SHIFT_COLORS.length]}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
          <p className="text-xs text-gray-400 mt-2">
            Each point = Amazon’s forecast for the next 4 weeks, as generated on that date.
            A rising line means Amazon is increasing its demand expectation.
          </p>
        </>
      )}
    </div>
  );
}
