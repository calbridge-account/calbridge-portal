import { useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { useDspSummary, useDspOrders } from '../../hooks/useAnalytics';
import { useDateRange } from '../../context/DateRangeContext';
import { useMarketplace } from '../../context/MarketplaceContext';
import PageHeader from '../../components/PageHeader';
import { SkeletonCard, SkeletonTable, ErrorState } from '../../components/Skeleton';
import AdvertisingSubNav from './AdvertisingSubNav';

function makeFmtCurrency(currency = 'USD') {
  const locale = currency === 'CAD' ? 'en-CA' : 'en-US';
  return (n) => {
    if (n == null || isNaN(n)) return '—';
    return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);
  };
}
function fmtNum(n) {
  if (n == null || isNaN(n)) return '—';
  return new Intl.NumberFormat('en-US', { notation: 'compact' }).format(n);
}
function fmtPct(n) {
  if (n == null || isNaN(n)) return '—';
  return `${(Number(n) * 100).toFixed(1)}%`;
}

function MetricTile({ label, value, sub, purple }) {
  return (
    <div className={`rounded-xl border p-4 text-center ${purple ? 'bg-purple-50 border-purple-200' : 'bg-white border-gray-200'}`}>
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className={`text-xl font-bold ${purple ? 'text-purple-800' : 'text-gray-900'}`}>{value}</div>
      {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}

function Th({ col, label, right, sort, onSort }) {
  const active = sort.col === col;
  return (
    <th
      className={`py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide cursor-pointer select-none hover:text-gray-700 ${right ? 'text-right' : 'text-left'}`}
      onClick={() => onSort(col)}
    >
      {label} {active ? (sort.dir === 'desc' ? '▾' : '▴') : ''}
    </th>
  );
}

export default function AdvertisingDsp() {
  const { range } = useDateRange();
  const { activeMarketplace } = useMarketplace() ?? { activeMarketplace: 'US' };
  const currency = activeMarketplace === 'CA' ? 'CAD' : 'USD';
  const fmt$ = makeFmtCurrency(currency);

  const [sort, setSort] = useState({ col: 'spend', dir: 'desc' });
  const [search, setSearch] = useState('');

  const { data: summary, isLoading: summaryLoading, isError: summaryError } = useDspSummary(range);
  const { data: ordersData, isLoading: ordersLoading, isError: ordersError } = useDspOrders(range);

  const handleSort = col => setSort(s => ({ col, dir: s.col === col && s.dir === 'desc' ? 'asc' : 'desc' }));

  // Normalize summary metrics
  const metrics = summary || {};
  const spend    = Number(metrics.spend     || metrics.SPEND     || 0);
  const sales    = Number(metrics.sales     || metrics.SALES     || 0);
  const impr     = Number(metrics.impressions || metrics.IMPRESSIONS || 0);
  const clicks   = Number(metrics.clicks    || metrics.CLICKS    || 0);
  const dpv      = Number(metrics.dpv       || metrics.DPV       || metrics.detail_page_views || 0);
  const ntbOrders= Number(metrics.ntb_orders || metrics.NTB_ORDERS || metrics.newToBrandOrders || 0);
  const ntbSales = Number(metrics.ntb_sales || metrics.NTB_SALES  || metrics.newToBrandSales  || 0);
  const viewRate = metrics.viewability_rate || metrics.VIEWABILITY_RATE || metrics.viewabilityRate || null;
  const roas     = spend > 0 ? sales / spend : null;
  const cpm      = impr  > 0 ? (spend / impr) * 1000 : null;
  const ctr      = impr  > 0 ? clicks / impr : null;
  const ntbPct   = sales > 0 ? ntbSales / sales : null;

  // Orders table
  const rawOrders = Array.isArray(ordersData) ? ordersData : (ordersData?.orders || ordersData?.rows || []);

  const normalizeOrder = r => ({
    orderId:      r.ORDER_ID    || r.order_id    || r.ORDER_NAME || r.order_name || '—',
    orderName:    r.ORDER_NAME  || r.order_name  || '—',
    lineItem:     r.LINE_ITEM_NAME || r.line_item_name || '—',
    spend:        Number(r.SPEND       || r.spend       || 0),
    sales:        Number(r.SALES       || r.sales       || 0),
    impressions:  Number(r.IMPRESSIONS || r.impressions || 0),
    clicks:       Number(r.CLICKS      || r.clicks      || 0),
    dpv:          Number(r.DPV || r.dpv || 0),
    ntbOrders:    Number(r.NTB_ORDERS || r.ntb_orders || 0),
    ntbSales:     Number(r.NTB_SALES  || r.ntb_sales  || 0),
    viewability:  r.VIEWABILITY_RATE != null ? Number(r.VIEWABILITY_RATE) : r.viewability_rate != null ? Number(r.viewability_rate) : null,
    roas:         r.ROAS != null ? Number(r.ROAS) : null,
  });

  const orders = rawOrders.map(normalizeOrder)
    .filter(r => !search || r.orderName.toLowerCase().includes(search.toLowerCase()) || r.lineItem.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const av = a[sort.col] ?? -Infinity;
      const bv = b[sort.col] ?? -Infinity;
      return sort.dir === 'desc' ? bv - av : av - bv;
    });

  return (
    <div>
      <PageHeader title="DSP" subtitle="Programmatic display — view-through attribution, NTB, DPV" />
      <AdvertisingSubNav />

      {summaryError && <ErrorState message="Failed to load DSP summary" />}

      {/* Attribution note */}
      <div className="bg-purple-50 border border-purple-200 rounded-lg px-4 py-3 mb-6 text-sm text-purple-800">
        <strong>DSP Attribution:</strong> Sales reflect view-through attribution (not click-based). NTB = new-to-brand customers. DPV = detail page views.
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
        {summaryLoading ? (
          Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)
        ) : (
          <>
            <MetricTile label="Total Spend"   value={fmt$(spend)}                                             purple />
            <MetricTile label="Attributed Sales" value={fmt$(sales)}                                          purple />
            <MetricTile label="ROAS"          value={roas != null ? roas.toFixed(2) + 'x' : '—'}             purple />
            <MetricTile label="Impressions"   value={fmtNum(impr)}  sub={viewRate != null ? `${(viewRate * 100).toFixed(1)}% viewable` : null} />
            <MetricTile label="Detail Page Views" value={fmtNum(dpv)} sub={impr > 0 ? `${((dpv / impr) * 100).toFixed(2)}% DPV rate` : null} />
            <MetricTile label="NTB Orders"    value={fmtNum(ntbOrders)} sub={ntbPct != null ? `${(ntbPct * 100).toFixed(1)}% of sales` : null} />
          </>
        )}
      </div>

      {/* Secondary KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        {summaryLoading ? null : (
          <>
            <MetricTile label="Clicks"        value={fmtNum(clicks)} sub={ctr != null ? fmtPct(ctr) + ' CTR' : null} />
            <MetricTile label="CPM"           value={cpm != null ? fmt$(cpm) : '—'} sub="Cost per 1k impressions" />
            <MetricTile label="NTB Sales"     value={fmt$(ntbSales)} />
            <MetricTile label="Viewability"   value={viewRate != null ? fmtPct(viewRate) : '—'} />
          </>
        )}
      </div>

      {/* Orders / Line Items Table */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-700">DSP Orders &amp; Line Items</h3>
          <input
            type="text"
            placeholder="Search orders…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="text-sm border border-gray-200 rounded px-3 py-1.5 w-56 focus:outline-none focus:ring-1 focus:ring-purple-500"
          />
        </div>

        {ordersLoading ? (
          <SkeletonTable />
        ) : ordersError ? (
          <div className="text-center py-8 text-gray-400 text-sm">DSP orders data unavailable</div>
        ) : orders.length === 0 ? (
          <div className="text-center py-8 text-gray-400 text-sm">No DSP order data for this period</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Order / Line Item</th>
                  <Th col="spend"       label="Spend"       right sort={sort} onSort={handleSort} />
                  <Th col="sales"       label="Sales"       right sort={sort} onSort={handleSort} />
                  <Th col="roas"        label="ROAS"        right sort={sort} onSort={handleSort} />
                  <Th col="impressions" label="Impr."       right sort={sort} onSort={handleSort} />
                  <Th col="clicks"      label="Clicks"      right sort={sort} onSort={handleSort} />
                  <Th col="dpv"         label="DPV"         right sort={sort} onSort={handleSort} />
                  <Th col="ntbOrders"   label="NTB Orders"  right sort={sort} onSort={handleSort} />
                  <Th col="ntbSales"    label="NTB Sales"   right sort={sort} onSort={handleSort} />
                  <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Viewability</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((r, i) => (
                  <tr key={i} className={`border-b border-gray-50 hover:bg-gray-50 ${i % 2 === 1 ? 'bg-gray-50/40' : ''}`}>
                    <td className="py-2 px-3 max-w-xs">
                      <span className="block truncate max-w-[240px] font-medium text-gray-800">{r.orderName !== '—' ? r.orderName : r.orderId}</span>
                      {r.lineItem !== '—' && (
                        <span className="block truncate max-w-[240px] text-xs text-gray-400">{r.lineItem}</span>
                      )}
                    </td>
                    <td className="py-2 px-3 text-right font-medium text-gray-900">{fmt$(r.spend)}</td>
                    <td className="py-2 px-3 text-right text-gray-700">{fmt$(r.sales)}</td>
                    <td className="py-2 px-3 text-right text-gray-700">{r.roas != null ? r.roas.toFixed(2) + 'x' : '—'}</td>
                    <td className="py-2 px-3 text-right text-gray-500">{fmtNum(r.impressions)}</td>
                    <td className="py-2 px-3 text-right text-gray-500">{r.clicks.toLocaleString()}</td>
                    <td className="py-2 px-3 text-right text-gray-500">{fmtNum(r.dpv)}</td>
                    <td className="py-2 px-3 text-right text-gray-500">{r.ntbOrders.toLocaleString()}</td>
                    <td className="py-2 px-3 text-right text-gray-500">{fmt$(r.ntbSales)}</td>
                    <td className="py-2 px-3 text-right text-gray-500">{r.viewability != null ? fmtPct(r.viewability) : '—'}</td>
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
