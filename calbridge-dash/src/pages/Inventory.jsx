import { useState } from 'react';
import { useVendorMetrics, useInventoryDetail, usePoSummary } from '../hooks/useAnalytics';
import { useDateRange } from '../context/DateRangeContext';
import PageHeader from '../components/PageHeader';
import { SkeletonCard, SkeletonTable, ErrorState } from '../components/Skeleton';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(n, style = 'number') {
  if (n == null || isNaN(n)) return '—';
  if (style === 'percent') return `${(n * 100).toFixed(1)}%`;
  if (style === 'days') return `${Number(n).toFixed(1)} days`;
  if (style === 'number') return new Intl.NumberFormat('en-US').format(Math.round(n));
  return n;
}

function weeksOfCoverColor(weeks) {
  if (weeks == null) return 'text-gray-400';
  if (weeks >= 8) return 'text-green-700 font-semibold';
  if (weeks >= 4) return 'text-yellow-600 font-semibold';
  return 'text-red-600 font-semibold';
}

function weeksOfCoverBg(weeks) {
  if (weeks == null) return '';
  if (weeks >= 8) return 'bg-green-50';
  if (weeks >= 4) return 'bg-yellow-50';
  return 'bg-red-50';
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

function SortableHeader({ label, sortKey, sort, setSort, tooltip }) {
  const isActive = sort.key === sortKey;
  const dir = isActive ? sort.dir : null;
  function toggle() {
    if (isActive) {
      setSort({ key: sortKey, dir: dir === 'asc' ? 'desc' : 'asc' });
    } else {
      setSort({ key: sortKey, dir: 'desc' });
    }
  }
  return (
    <th
      className="text-left py-2 px-3 font-semibold text-gray-500 text-xs uppercase tracking-wide whitespace-nowrap cursor-pointer select-none hover:text-gray-700"
      onClick={toggle}
    >
      <span className="flex items-center gap-1">
        {label}
        {tooltip && <InfoTooltip text={tooltip} />}
        <span className="ml-1 opacity-50">{isActive ? (dir === 'asc' ? '↑' : '↓') : '↕'}</span>
      </span>
    </th>
  );
}

function MetricCard({ title, value, format, note, definition, loading, highlight }) {
  if (loading) return <SkeletonCard />;
  const borderColor = highlight === 'orange' ? 'border-orange-100' : highlight === 'red' ? 'border-red-100' : 'border-gray-200';
  const valueColor  = highlight === 'orange' ? 'text-orange-600' : highlight === 'red' ? 'text-red-600' : 'text-gray-900';
  return (
    <div className={`bg-white rounded-xl border ${borderColor} p-5`}>
      <div className="flex items-center text-sm font-medium text-gray-500 mb-2">
        {title}
        {definition && <InfoTooltip text={definition} />}
      </div>
      <div className={`text-2xl font-bold ${valueColor} mb-1`}>{fmt(value, format)}</div>
      {note && <div className="text-xs text-gray-400">{note}</div>}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Inventory() {
  const { range } = useDateRange();
  const { data: vmData, isLoading: vmLoading, isError, error } = useVendorMetrics(range);
  const { data: invDetailData, isLoading: invDetailLoading } = useInventoryDetail();
  const { data: poSummaryData, isLoading: poSummaryLoading } = usePoSummary();

  const [activeTab, setActiveTab] = useState('inventory'); // 'inventory' | 'po'
  const [invSort, setInvSort] = useState({ key: 'sellableUnits', dir: 'desc' });
  const [poSort,  setPoSort]  = useState({ key: 'totalUnitsOrdered', dir: 'desc' });

  const m          = vmData?.metrics || {};
  const invDetail  = Array.isArray(invDetailData) ? invDetailData : [];
  const poSummary  = Array.isArray(poSummaryData)  ? poSummaryData  : [];

  function sortedRows(rows, { key, dir }) {
    return [...rows].sort((a, b) => {
      const va = a[key] ?? (dir === 'asc' ? Infinity : -Infinity);
      const vb = b[key] ?? (dir === 'asc' ? Infinity : -Infinity);
      if (typeof va === 'string') return dir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
      return dir === 'asc' ? va - vb : vb - va;
    });
  }

  const sortedInv = sortedRows(invDetail, invSort);
  const sortedPo  = sortedRows(poSummary, poSort);

  return (
    <div>
      <PageHeader
        title="Inventory"
        subtitle="On-hand stock, aging, POs, and fulfillment health"
      />

      {isError && <ErrorState message={error?.message} />}

      {/* KPI Row 1: stock health */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
        <MetricCard
          title="Sellable On Hand"
          value={m.totalSellable}
          format="number"
          note="Units in Amazon FCs, sellable condition"
          loading={vmLoading}
        />
        <MetricCard
          title="Aged 90+ Days"
          value={m.totalAged90}
          format="number"
          note="At risk of long-term storage fees"
          highlight="orange"
          loading={vmLoading}
        />
        <MetricCard
          title="OOS / Unfilled Orders"
          value={m.totalOos}
          format="number"
          note="Unfilled customer order units"
          highlight="red"
          loading={vmLoading}
        />
      </div>

      {/* KPI Row 2: rate metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        <MetricCard
          title="Avg Sell-Through Rate"
          value={m.avgSellThrough}
          format="percent"
          note="Avg across all ASINs"
          definition="Units shipped to customers divided by the sum of units on hand at the start of the period plus units received. A rate of 1.0 (100%) means all available inventory sold through."
          loading={vmLoading}
        />
        <MetricCard
          title="Vendor Confirmation Rate"
          value={m.avgConfRate}
          format="percent"
          note="Weeks with active POs only"
          definition="Units you confirmed to ship ÷ units Amazon requested in POs. Averaged only over weeks with active POs. Target: >95%."
          loading={vmLoading}
        />
        <MetricCard
          title="Receive Fill Rate"
          value={m.avgFillRate}
          format="percent"
          note="Received vs confirmed units"
          definition="Units actually received at Amazon FCs ÷ units confirmed on POs. Can be 0 for recent POs not yet received — this is normal."
          loading={vmLoading}
        />
        <MetricCard
          title="Avg Lead Time"
          value={m.avgLeadTime}
          format="days"
          note="Vendor warehouse to Amazon FC"
          definition="The average number of days between Amazon submitting a purchase order and your inventory being received at their fulfillment center."
          loading={vmLoading}
        />
      </div>

      {/* Tabbed table section */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-gray-800">Inventory Detail</h2>
          <div className="flex gap-2">
            <button
              onClick={() => setActiveTab('inventory')}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                activeTab === 'inventory'
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
              }`}
            >
              Inventory Detail
            </button>
            <button
              onClick={() => setActiveTab('po')}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                activeTab === 'po'
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
              }`}
            >
              Purchase Orders
            </button>
          </div>
        </div>

        {/* ── Inventory Detail Tab ── */}
        {activeTab === 'inventory' && (
          invDetailLoading ? (
            <SkeletonTable />
          ) : sortedInv.length === 0 ? (
            <div className="text-gray-400 text-sm text-center py-8">No inventory data available</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <SortableHeader label="ASIN"        sortKey="asin"             sort={invSort} setSort={setInvSort} />
                    <SortableHeader label="Title"       sortKey="title"            sort={invSort} setSort={setInvSort} />
                    <SortableHeader label="On Hand"     sortKey="sellableUnits"    sort={invSort} setSort={setInvSort} tooltip="Sellable units currently in Amazon fulfillment centers." />
                    <SortableHeader label="Open POs"    sortKey="openPoUnits"      sort={invSort} setSort={setInvSort} tooltip="Units on open purchase orders — ordered by Amazon but not yet received." />
                    <SortableHeader label="Weeks Cover" sortKey="weeksOfCover"     sort={invSort} setSort={setInvSort} tooltip="Sellable on-hand ÷ avg weekly shipped units (trailing 4 weeks). Green ≥8w, Yellow 4–8w, Red <4w." />
                    <SortableHeader label="Unfilled"    sortKey="unfillableUnits"  sort={invSort} setSort={setInvSort} tooltip="Customer orders that could not be fulfilled (out-of-stock units)." />
                    <SortableHeader label="Aged 90+"    sortKey="aged90Units"      sort={invSort} setSort={setInvSort} tooltip="Units in Amazon FCs for 90+ days — at risk of long-term storage fees." />
                    <SortableHeader label="Lead Time"   sortKey="avgLeadTimeDays"  sort={invSort} setSort={setInvSort} tooltip="Avg days from Amazon PO submission to receipt at FC." />
                    <th className="text-left py-2 px-3 font-semibold text-gray-500 text-xs uppercase tracking-wide whitespace-nowrap">Snapshot</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedInv.map((row, i) => (
                    <tr
                      key={row.asin}
                      className={`border-b border-gray-50 hover:bg-gray-50 ${
                        i % 2 === 0 ? '' : 'bg-gray-50/40'
                      } ${weeksOfCoverBg(row.weeksOfCover)}`}
                    >
                      <td className="py-2.5 px-3 font-mono text-xs text-blue-700">{row.asin}</td>
                      <td className="py-2.5 px-3 text-gray-700 max-w-xs">
                        {row.title
                          ? <span className="text-xs truncate block max-w-xs" title={row.title}>{row.title}</span>
                          : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="py-2.5 px-3 text-right font-medium text-gray-900">
                        {row.sellableUnits != null ? fmt(row.sellableUnits) : '—'}
                        {row.unsellableUnits > 0 && (
                          <span className="ml-1 text-orange-500 text-xs" title={`${fmt(row.unsellableUnits)} unsellable`}>
                            +{fmt(row.unsellableUnits)}⚠
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <span className={row.openPoUnits > 0 ? 'text-blue-700 font-medium' : 'text-gray-400'}>
                          {row.openPoUnits != null ? fmt(row.openPoUnits) : '—'}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <span className={weeksOfCoverColor(row.weeksOfCover)}>
                          {row.weeksOfCover != null ? `${row.weeksOfCover.toFixed(1)}w` : '—'}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <span className={row.unfillableUnits > 0 ? 'text-red-600 font-medium' : 'text-gray-400'}>
                          {row.unfillableUnits != null ? fmt(row.unfillableUnits) : '—'}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <span className={row.aged90Units > 0 ? 'text-orange-600 font-medium' : 'text-gray-400'}>
                          {row.aged90Units != null ? fmt(row.aged90Units) : '—'}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right text-gray-600">
                        {row.avgLeadTimeDays != null ? `${Number(row.avgLeadTimeDays).toFixed(1)}d` : '—'}
                      </td>
                      <td className="py-2.5 px-3 text-gray-400 text-xs">{row.snapshotDate || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}

        {/* ── Purchase Orders Tab ── */}
        {activeTab === 'po' && (
          poSummaryLoading ? (
            <SkeletonTable />
          ) : sortedPo.length === 0 ? (
            <div className="text-gray-400 text-sm text-center py-8">No purchase order data available</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <SortableHeader label="ASIN"           sortKey="asin"               sort={poSort} setSort={setPoSort} />
                    <SortableHeader label="Title"          sortKey="title"              sort={poSort} setSort={setPoSort} />
                    <SortableHeader label="Units Ordered"  sortKey="totalUnitsOrdered"  sort={poSort} setSort={setPoSort} tooltip="Total units ordered by Amazon across all POs." />
                    <SortableHeader label="Units Received" sortKey="totalUnitsReceived" sort={poSort} setSort={setPoSort} tooltip="Units confirmed received at Amazon FCs." />
                    <SortableHeader label="Open Units"     sortKey="openUnits"          sort={poSort} setSort={setPoSort} tooltip="Units ordered but not yet received (ordered minus received)." />
                    <SortableHeader label="Last Order"     sortKey="lastOrderDate"      sort={poSort} setSort={setPoSort} tooltip="Date of most recent Amazon PO for this ASIN." />
                    <SortableHeader label="Avg Lead Time"  sortKey="avgLeadTimeDays"    sort={poSort} setSort={setPoSort} tooltip="Avg days from PO date to receipt, based on received POs." />
                  </tr>
                </thead>
                <tbody>
                  {sortedPo.map((row, i) => {
                    const receiveRate = row.totalUnitsOrdered > 0
                      ? row.totalUnitsReceived / row.totalUnitsOrdered
                      : null;
                    return (
                      <tr
                        key={row.asin}
                        className={`border-b border-gray-50 hover:bg-gray-50 ${i % 2 === 0 ? '' : 'bg-gray-50/40'}`}
                      >
                        <td className="py-2.5 px-3 font-mono text-xs text-blue-700">{row.asin}</td>
                        <td className="py-2.5 px-3 text-gray-700 max-w-xs">
                          {row.title
                            ? <span className="text-xs truncate block max-w-xs" title={row.title}>{row.title}</span>
                            : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="py-2.5 px-3 text-right font-medium text-gray-900">
                          {row.totalUnitsOrdered != null ? fmt(row.totalUnitsOrdered) : '—'}
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <span className="text-gray-700">{row.totalUnitsReceived != null ? fmt(row.totalUnitsReceived) : '—'}</span>
                          {receiveRate != null && (
                            <span className={`ml-1 text-xs ${
                              receiveRate >= 0.95 ? 'text-green-600' :
                              receiveRate >= 0.80 ? 'text-yellow-600' : 'text-red-500'
                            }`}>
                              ({(receiveRate * 100).toFixed(0)}%)
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <span className={row.openUnits > 0 ? 'text-blue-700 font-medium' : 'text-gray-400'}>
                            {row.openUnits != null ? fmt(row.openUnits) : '—'}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-gray-600 text-xs">{row.lastOrderDate || '—'}</td>
                        <td className="py-2.5 px-3 text-right text-gray-600">
                          {row.avgLeadTimeDays != null ? `${row.avgLeadTimeDays}d` : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>
    </div>
  );
}
