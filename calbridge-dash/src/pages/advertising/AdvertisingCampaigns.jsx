import { useState } from 'react';
import { useAdvertisingCampaigns, useAdvertisingTrend } from '../../hooks/useAnalytics';
import { useDateRange } from '../../context/DateRangeContext';
import { useMarketplace } from '../../context/MarketplaceContext';
import PageHeader from '../../components/PageHeader';
import { SkeletonTable, ErrorState } from '../../components/Skeleton';
import AdvertisingSubNav from './AdvertisingSubNav';
import ExportMenu from '../../components/ExportMenu';
import { exportToXlsx, exportToCsv } from '../../utils/exportUtils';
import AdTrendChart from '../../components/AdTrendChart';

// ─── Formatters ───────────────────────────────────────────────────────────────
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

const AD_TYPE_COLORS = {
  SP:  'bg-blue-100 text-blue-700',
  SB:  'bg-green-100 text-green-700',
  SD:  'bg-amber-100 text-amber-700',
  DSP: 'bg-purple-100 text-purple-700',
};
const STATUS_COLORS = {
  ENABLED:  'text-green-600',
  PAUSED:   'text-amber-500',
  ARCHIVED: 'text-gray-400',
};

const AD_TYPE_FILTER_OPTIONS = ['All', 'SP', 'SB', 'SD', 'DSP'];

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

export default function AdvertisingCampaigns() {
  const { range } = useDateRange();
  const { activeMarketplace } = useMarketplace() ?? { activeMarketplace: 'US' };
  const currency = activeMarketplace === 'CA' ? 'CAD' : 'USD';
  const fmt$ = makeFmtCurrency(currency);

  const [adTypeFilter, setAdTypeFilter] = useState('All');
  const [channelFilter, setChannelFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState({ col: 'spend', dir: 'desc' });

  const { data, isLoading, isError, error } = useAdvertisingCampaigns(range, channelFilter);
  // Trend uses same channel + ad-type filter so chart scope matches table
  const adTypeParam = adTypeFilter !== 'All' ? adTypeFilter : undefined;
  const { data: trendRows, isLoading: trendLoading } = useAdvertisingTrend(range, channelFilter, adTypeParam);

  const normalize = r => ({
    campaign_id:   r.CAMPAIGN_ID   || r.campaign_id,
    campaign_name: r.CAMPAIGN_NAME || r.campaign_name || '—',
    ad_type:       r.AD_TYPE       || r.ad_type       || '—',
    status:        r.STATUS        || r.status        || '—',
    spend:         Number(r.SPEND       || r.spend       || 0),
    sales:         Number(r.SALES       || r.sales       || 0),
    orders:        Number(r.ORDERS      || r.orders      || 0),
    impressions:   Number(r.IMPRESSIONS || r.impressions || 0),
    clicks:        Number(r.CLICKS      || r.clicks      || 0),
    acos:          r.ACOS != null ? Number(r.ACOS) : r.acos != null ? Number(r.acos) : null,
    roas:          r.ROAS != null ? Number(r.ROAS) : r.roas != null ? Number(r.roas) : null,
    ctr:           r.CTR  != null ? Number(r.CTR)  : r.ctr  != null ? Number(r.ctr)  : null,
    cpc:           r.CPC  != null ? Number(r.CPC)  : r.cpc  != null ? Number(r.cpc)  : null,
  });

  const campaigns = (Array.isArray(data) ? data : []).map(normalize);

  const filtered = campaigns
    .filter(r => adTypeFilter === 'All' || r.ad_type === adTypeFilter)
    .filter(r => !search || r.campaign_name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const av = a[sort.col] ?? -Infinity;
      const bv = b[sort.col] ?? -Infinity;
      return sort.dir === 'desc' ? bv - av : av - bv;
    });

  const handleSort = (col) => setSort(s => ({ col, dir: s.col === col && s.dir === 'desc' ? 'asc' : 'desc' }));
  const acosColor = v => v == null ? '' : v > 0.4 ? 'text-red-600' : v < 0.2 ? 'text-green-700' : 'text-gray-900';

  // Export handlers
  const handleExportXlsx = () => exportToXlsx(
    filtered.map(r => ({
      Campaign:    r.campaign_name,
      Type:        r.ad_type,
      Status:      r.status,
      Spend:       r.spend,
      Sales:       r.sales,
      ROAS:        r.roas != null ? r.roas.toFixed(2) : '',
      ACoS:        r.acos != null ? `${(r.acos * 100).toFixed(1)}%` : '',
      Orders:      r.orders,
      Clicks:      r.clicks,
      Impressions: r.impressions,
      CTR:         r.ctr  != null ? `${(r.ctr  * 100).toFixed(2)}%` : '',
      CPC:         r.cpc  != null ? r.cpc.toFixed(2) : '',
    })),
    'campaigns-performance'
  );
  const handleExportCsv = () => exportToCsv(
    filtered.map(r => ({
      Campaign:    r.campaign_name,
      Type:        r.ad_type,
      Status:      r.status,
      Spend:       r.spend,
      Sales:       r.sales,
      ROAS:        r.roas != null ? r.roas.toFixed(2) : '',
      ACoS:        r.acos != null ? `${(r.acos * 100).toFixed(1)}%` : '',
      Orders:      r.orders,
      Clicks:      r.clicks,
      Impressions: r.impressions,
      CTR:         r.ctr  != null ? `${(r.ctr  * 100).toFixed(2)}%` : '',
      CPC:         r.cpc  != null ? r.cpc.toFixed(2) : '',
    })),
    'campaigns-performance'
  );

  // Aggregate totals
  const totals = filtered.reduce((acc, r) => {
    acc.spend += r.spend;
    acc.sales += r.sales;
    acc.orders += r.orders;
    acc.clicks += r.clicks;
    acc.impressions += r.impressions;
    return acc;
  }, { spend: 0, sales: 0, orders: 0, clicks: 0, impressions: 0 });
  const totalRoas = totals.spend > 0 ? totals.sales / totals.spend : null;
  const totalAcos = totals.sales > 0 ? totals.spend / totals.sales : null;

  return (
    <div>
      <PageHeader title="Campaigns" subtitle="Full campaign-level performance breakdown" />
      <AdvertisingSubNav />

      {isError && <ErrorState message={error?.message} />}

      {/* Filters row */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        {/* Channel selector */}
        <div className="flex gap-1">
          {[
            { key: 'all', label: 'All Channels' },
            { key: 'ads', label: 'Sponsored Ads' },
            { key: 'dsp', label: 'DSP' },
          ].map(c => (
            <button
              key={c.key}
              onClick={() => setChannelFilter(c.key)}
              className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
                channelFilter === c.key
                  ? 'border-green-700 bg-green-700 text-white font-semibold'
                  : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>

        {/* Ad type filter */}
        <div className="flex gap-1">
          {AD_TYPE_FILTER_OPTIONS.map(t => (
            <button
              key={t}
              onClick={() => setAdTypeFilter(t)}
              className={`px-3 py-1.5 text-xs rounded border transition-colors font-medium ${
                adTypeFilter === t
                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                  : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Search + Export */}
        <div className="ml-auto flex items-center gap-2">
          <input
            type="text"
            placeholder="Search campaigns…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="text-sm border border-gray-200 rounded px-3 py-1.5 w-64 focus:outline-none focus:ring-1 focus:ring-green-600"
          />
          {!isLoading && filtered.length > 0 && (
            <ExportMenu onXlsx={handleExportXlsx} onCsv={handleExportCsv} />
          )}
        </div>
      </div>

      {/* Trend chart */}
      <AdTrendChart
        trendRows={trendRows}
        loading={trendLoading}
        channel={channelFilter}
        adType={adTypeFilter !== 'All' ? adTypeFilter : undefined}
        currency={currency}
        title={`Campaigns — Spend & Sales Trend${adTypeFilter !== 'All' ? ` (${adTypeFilter})` : ''}`}
        className="mb-4"
      />

      {/* Summary bar */}
      {!isLoading && filtered.length > 0 && (
        <div className="bg-green-50 border border-green-100 rounded-xl px-4 py-3 mb-4 flex flex-wrap gap-6 text-sm">
          <span className="text-gray-500">{filtered.length} campaigns</span>
          <span><span className="text-gray-500">Spend</span> <strong className="text-gray-800">{fmt$(totals.spend)}</strong></span>
          <span><span className="text-gray-500">Sales</span> <strong className="text-gray-800">{fmt$(totals.sales)}</strong></span>
          <span><span className="text-gray-500">ROAS</span> <strong className="text-gray-800">{totalRoas != null ? totalRoas.toFixed(2) + 'x' : '—'}</strong></span>
          <span><span className="text-gray-500">ACoS</span> <strong className={acosColor(totalAcos)}>{totalAcos != null ? (totalAcos * 100).toFixed(1) + '%' : '—'}</strong></span>
          <span><span className="text-gray-500">Orders</span> <strong className="text-gray-800">{totals.orders.toLocaleString()}</strong></span>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 p-5">
        {isLoading ? (
          <SkeletonTable />
        ) : filtered.length === 0 ? (
          <div className="text-gray-400 text-sm text-center py-8">No campaign data for this period</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Campaign</th>
                  <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Type</th>
                  <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                  <Th col="spend"       label="Spend"    right sort={sort} onSort={handleSort} />
                  <Th col="sales"       label="Sales"    right sort={sort} onSort={handleSort} />
                  <Th col="roas"        label="ROAS"     right sort={sort} onSort={handleSort} />
                  <Th col="acos"        label="ACoS"     right sort={sort} onSort={handleSort} />
                  <Th col="orders"      label="Orders"   right sort={sort} onSort={handleSort} />
                  <Th col="clicks"      label="Clicks"   right sort={sort} onSort={handleSort} />
                  <Th col="impressions" label="Impr."    right sort={sort} onSort={handleSort} />
                  <Th col="ctr"         label="CTR"      right sort={sort} onSort={handleSort} />
                  <Th col="cpc"         label="CPC"      right sort={sort} onSort={handleSort} />
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, i) => (
                  <tr key={r.campaign_id || i} className={`border-b border-gray-50 hover:bg-gray-50 ${i % 2 === 1 ? 'bg-gray-50/40' : ''}`}>
                    <td className="py-2 px-3 text-gray-800 max-w-xs font-medium" title={r.campaign_name}>
                      <span className="block truncate max-w-[320px]">{r.campaign_name}</span>
                    </td>
                    <td className="py-2 px-3">
                      <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${AD_TYPE_COLORS[r.ad_type] || 'bg-gray-100 text-gray-600'}`}>{r.ad_type}</span>
                    </td>
                    <td className={`py-2 px-3 text-xs font-medium ${STATUS_COLORS[r.status] || 'text-gray-500'}`}>{r.status}</td>
                    <td className="py-2 px-3 text-right font-medium text-gray-900">{fmt$(r.spend)}</td>
                    <td className="py-2 px-3 text-right text-gray-700">{fmt$(r.sales)}</td>
                    <td className="py-2 px-3 text-right text-gray-700">{r.roas != null ? r.roas.toFixed(2) + 'x' : '—'}</td>
                    <td className={`py-2 px-3 text-right font-medium ${acosColor(r.acos)}`}>{r.acos != null ? (r.acos * 100).toFixed(1) + '%' : '—'}</td>
                    <td className="py-2 px-3 text-right text-gray-500">{r.orders.toLocaleString()}</td>
                    <td className="py-2 px-3 text-right text-gray-500">{r.clicks.toLocaleString()}</td>
                    <td className="py-2 px-3 text-right text-gray-500">{fmtNum(r.impressions)}</td>
                    <td className="py-2 px-3 text-right text-gray-500">{r.ctr != null ? (r.ctr * 100).toFixed(2) + '%' : '—'}</td>
                    <td className="py-2 px-3 text-right text-gray-500">{r.cpc != null ? fmt$(r.cpc) : '—'}</td>
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
