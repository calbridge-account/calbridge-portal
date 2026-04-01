import { useState } from 'react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { useVendorMetrics, useVendorAsins } from '../hooks/useAnalytics';
import { useDateRange } from '../context/DateRangeContext';
import PageHeader from '../components/PageHeader';
import { SkeletonCard, SkeletonChart, SkeletonTable, ErrorState } from '../components/Skeleton';

function fmt(n, style = 'number') {
  if (n == null || isNaN(n)) return '—';
  if (style === 'percent') return `${(n * 100).toFixed(1)}%`;
  if (style === 'days') return `${Number(n).toFixed(1)} days`;
  if (style === 'currency') return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
  if (style === 'number') return new Intl.NumberFormat('en-US').format(Math.round(n));
  return n;
}

function healthBadge(v, thresholdHigh = 0.9, thresholdLow = 0.7) {
  if (v == null) return null;
  const pct = v * 100;
  const color = pct >= thresholdHigh * 100
    ? 'bg-green-50 text-green-700'
    : pct >= thresholdLow * 100
    ? 'bg-yellow-50 text-yellow-700'
    : 'bg-red-50 text-red-600';
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${color}`}>
      {pct.toFixed(1)}%
    </span>
  );
}

function InfoTooltip({ text }) {
  const [show, setShow] = useState(false);
  return (
    <span className="relative inline-block ml-1">
      <span
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        className="inline-flex items-center justify-center w-4 h-4 rounded-full text-xs font-bold cursor-help"
        style={{ background: '#e5e7eb', color: '#6b7280', fontSize: '10px' }}
      >
        ?
      </span>
      {show && (
        <span
          className="absolute bottom-6 left-1/2 z-50 w-64 rounded-lg shadow-lg text-xs text-left p-3 leading-relaxed"
          style={{ transform: 'translateX(-50%)', background: '#1e3a1a', color: '#fff' }}
        >
          {text}
          <span
            className="absolute top-full left-1/2 w-0 h-0"
            style={{
              transform: 'translateX(-50%)',
              borderLeft: '6px solid transparent',
              borderRight: '6px solid transparent',
              borderTop: '6px solid #1e3a1a',
            }}
          />
        </span>
      )}
    </span>
  );
}

function MetricCard({ title, value, format, note, definition, loading }) {
  if (loading) return <SkeletonCard />;
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center text-sm font-medium text-gray-500 mb-2">
        {title}
        {definition && <InfoTooltip text={definition} />}
      </div>
      <div className="text-2xl font-bold text-gray-900 mb-1">{fmt(value, format)}</div>
      {note && <div className="text-xs text-gray-400">{note}</div>}
    </div>
  );
}

export default function VendorPerformance() {
  const { range } = useDateRange();
  const { data, isLoading, isError, error } = useVendorMetrics(range);
  const { data: asinData, isLoading: asinLoading } = useVendorAsins(range);

  const m = data?.metrics || {};
  const weeklyInv = data?.weeklyInventoryTrend || [];
  const weeklyUnits = data?.weeklyUnits || [];
  const asins = asinData?.asins || [];

  return (
    <div>
      <PageHeader
        title="Vendor Performance"
        subtitle="Inventory health, fill rates, and fulfillment metrics"
        
        
      />

      {isError && <ErrorState message={error?.message} />}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        <MetricCard
          title="Sell-Through Rate"
          value={m.avgSellThrough}
          format="percent"
          note="Avg across all ASINs"
          definition="Units shipped to customers divided by the sum of units on hand at the start of the period plus units received. A rate of 1.0 (100%) means all available inventory sold through. Higher is generally better — low sell-through may indicate overstocking or weak demand."
          loading={isLoading}
        />
        <MetricCard
          title="Vendor Confirmation Rate"
          value={m.avgConfRate}
          format="percent"
          note="PO confirmation rate"
          definition="The number of units you confirmed to ship divided by the number of units Amazon requested in purchase orders. A rate below 100% means you confirmed fewer units than Amazon ordered — this can lead to lost sales, penalties, and reduced future PO frequency."
          loading={isLoading}
        />
        <MetricCard
          title="Receive Fill Rate"
          value={m.avgFillRate}
          format="percent"
          note="Units received vs confirmed"
          definition="Units actually received by Amazon's fulfillment centers divided by the units you confirmed on purchase orders. A rate below 100% means Amazon received fewer units than you promised to ship — shortfalls can result in chargebacks and affect your vendor scorecard."
          loading={isLoading}
        />
        <MetricCard
          title="Avg Lead Time"
          value={m.avgLeadTime}
          format="days"
          note="Vendor warehouse to Amazon FC"
          definition="The average number of days between Amazon submitting a purchase order and your inventory being received at their fulfillment center. Shorter lead times allow Amazon to place replenishment orders later and reduce the risk of stockouts."
          loading={isLoading}
        />
      </div>

      {/* Secondary KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="text-sm text-gray-500 mb-1">Sellable On Hand</div>
          <div className="text-xl font-bold text-gray-900">{fmt(m.totalSellable)}</div>
          <div className="text-xs text-gray-400 mt-1">Total units across all ASINs</div>
        </div>
        <div className="bg-white rounded-xl border border-orange-100 p-5">
          <div className="text-sm text-gray-500 mb-1">Aged 90+ Days</div>
          <div className="text-xl font-bold text-orange-600">{fmt(m.totalAged90)}</div>
          <div className="text-xs text-gray-400 mt-1">At risk of long-term storage fees</div>
        </div>
        <div className="bg-white rounded-xl border border-red-100 p-5">
          <div className="text-sm text-gray-500 mb-1">OOS / Unfilled Orders</div>
          <div className="text-xl font-bold text-red-600">{fmt(m.totalOos)}</div>
          <div className="text-xs text-gray-400 mt-1">Unfilled customer order units</div>
        </div>
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
        {/* Sell-Through Rate Trend */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">
            Weekly Rate Trends (selected period)
          </h3>
          {isLoading ? (
            <div className="h-64 bg-gray-100 rounded animate-pulse" />
          ) : weeklyInv.length === 0 ? (
            <div className="h-64 flex items-center justify-center text-gray-400 text-sm">No data</div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={weeklyInv} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="week" tick={{ fontSize: 11 }} />
                <YAxis
                  tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
                  domain={[0, 1]}
                  tick={{ fontSize: 11 }}
                />
                <Tooltip
                  formatter={(v, name) => [`${(v * 100).toFixed(1)}%`, name]}
                  labelStyle={{ fontWeight: 600 }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="sellThrough" name="Sell-Through" stroke="#2563eb" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="confRate" name="Confirmation Rate" stroke="#10b981" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="fillRate" name="Fill Rate" stroke="#f59e0b" strokeWidth={2} dot={false} strokeDasharray="4 2" />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Ordered vs Shipped Units */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">
            Ordered vs Shipped Units by Week
          </h3>
          {isLoading ? (
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
      </div>

      {/* ASIN Inventory Health Table */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">
          ASIN-Level Inventory Health
        </h3>
        {asinLoading ? (
          <SkeletonTable />
        ) : asins.length === 0 ? (
          <div className="text-gray-400 text-sm text-center py-8">No inventory data</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  {[
                    { h: 'ASIN', def: null },
                    { h: 'Model #', def: null },
                    { h: 'Sellable On Hand', def: 'Units in Amazon FCs in sellable condition at end of period. Includes backorders as negative.' },
                    { h: 'Aged 90+', def: 'Sellable units that have been in Amazon\'s fulfillment centers for 90+ days. At risk of long-term storage fees.' },
                    { h: 'Unhealthy', def: 'Excess inventory units beyond what Amazon\'s demand forecast suggests is needed. Amazon flags these as overstocked.' },
                    { h: 'OOS Units', def: 'Customer orders that could not be fulfilled due to out-of-stock inventory (unfilled customer ordered units).' },
                    { h: 'Sell-Through', def: 'Units shipped ÷ (opening inventory + received). Higher = inventory moving faster.' },
                    { h: 'Fill Rate', def: 'Units received by Amazon ÷ units you confirmed on POs. Measures shipping reliability.' },
                    { h: 'Lead Time', def: 'Avg days from PO submission to receipt at Amazon FC.' },
                    { h: 'Proceeds after Ads', def: 'Shipped COGS minus total ad spend for this ASIN in the selected period. Red = ad spend exceeds COGS (negative margin signal).' },
                  ].map(({ h, def }) => (
                    <th key={h} className="text-left py-2 px-3 font-semibold text-gray-500 text-xs uppercase tracking-wide whitespace-nowrap">
                      {h}{def && <InfoTooltip text={def} />}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {asins.map((row, i) => (
                  <tr key={row.asin} className={`border-b border-gray-50 hover:bg-gray-50 ${i % 2 === 0 ? '' : 'bg-gray-50/40'}`}>
                    <td className="py-2.5 px-3 font-mono text-xs text-blue-700">{row.asin}</td>
                    <td className="py-2.5 px-3 text-gray-700 max-w-xs truncate" title={row.model || row.title}>{row.model || row.title || '—'}</td>
                    <td className="py-2.5 px-3 text-right font-medium">{fmt(row.sellableOnHand)}</td>
                    <td className="py-2.5 px-3 text-right">
                      <span className={row.aged90Plus > 0 ? 'text-orange-600 font-medium' : 'text-gray-400'}>{fmt(row.aged90Plus)}</span>
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <span className={row.unhealthy > 0 ? 'text-red-600 font-medium' : 'text-gray-400'}>{fmt(row.unhealthy)}</span>
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <span className={row.oosUnits > 0 ? 'text-red-600 font-medium' : 'text-gray-400'}>{fmt(row.oosUnits)}</span>
                    </td>
                    <td className="py-2.5 px-3">{healthBadge(row.sellThrough)}</td>
                    <td className="py-2.5 px-3">{healthBadge(row.fillRate)}</td>
                    <td className="py-2.5 px-3 text-gray-600">{row.leadTime != null ? `${Number(row.leadTime).toFixed(1)}d` : '—'}</td>
                    <td className="py-2.5 px-3 text-right">
                      {row.proceedsAfterAds != null ? (
                        <span className={row.proceedsAfterAds < 0 ? 'text-red-600 font-semibold' : 'text-gray-900'}>
                          {fmt(row.proceedsAfterAds, 'currency')}
                        </span>
                      ) : <span className="text-gray-300">—</span>}
                    </td>
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
