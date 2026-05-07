import { useState, useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useKeywordTargeting, useAdvertisingTrend } from '../../hooks/useAnalytics';
import { useDateRange } from '../../context/DateRangeContext';
import { useMarketplace } from '../../context/MarketplaceContext';
import PageHeader from '../../components/PageHeader';
import { SkeletonTable, ErrorState } from '../../components/Skeleton';
import AdvertisingSubNav from './AdvertisingSubNav';
import CampaignDrawer from '../../components/CampaignDrawer';
import ExportMenu from '../../components/ExportMenu';
import { exportToXlsx, exportToCsv } from '../../utils/exportUtils';
import AdTrendChart from '../../components/AdTrendChart';
import { ResizableTh, useTableResize } from '../../components/ResizableTable';

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
function fmtNum(n) {
  if (n == null || isNaN(n)) return '—';
  return new Intl.NumberFormat('en-US', { notation: 'compact' }).format(n);
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

const MATCH_TYPE_COLORS = {
  EXACT:   'bg-blue-100 text-blue-700',
  PHRASE:  'bg-indigo-100 text-indigo-700',
  BROAD:   'bg-gray-100 text-gray-600',
  AUTO:    'bg-green-100 text-green-700',
};

export default function AdvertisingKeywords() {
  const { range } = useDateRange();
  const { activeMarketplace } = useMarketplace() ?? { activeMarketplace: 'US' };
  const currency = activeMarketplace === 'CA' ? 'CAD' : 'USD';
  const fmtC = makeFmtCurrency(currency);
  const fmt$ = fmtC;

  const [searchParams] = useSearchParams();
  const [channel, setChannel] = useState('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState({ col: 'spend', dir: 'desc' });
  const [selectedKeys, setSelectedKeys] = useState(new Set());
  // Pre-fill matchType from URL param (e.g. when navigating from Targeting page)
  const [matchTypeFilter, setMatchTypeFilter] = useState(() => searchParams.get('matchType') || 'All');

  // If URL param changes (e.g. back navigation), sync filter
  useEffect(() => {
    const mt = searchParams.get('matchType');
    if (mt) setMatchTypeFilter(mt);
  }, [searchParams]);

  // Drawer state
  const [drawer, setDrawer] = useState({ open: false, keyword: null, matchType: null, adType: null });
  const closeDrawer = useCallback(() => setDrawer(d => ({ ...d, open: false })), []);

  const openDrawer = useCallback((keyword, matchType, adType) => {
    setDrawer({ open: true, keyword, matchType, adType });
  }, []);

  const { colWidths, startResize, resetWidth } = useTableResize({ keyword: 260, match: 70, adtype: 50 });
  const { data, isLoading, isError, error } = useKeywordTargeting(range, channel);
  // Trend: filter to same channel; if matchType is known it maps to SP/SB adType
  const trendAdType = channel === 'ads' ? undefined : undefined; // channel filter sufficient
  const { data: trendRows, isLoading: trendLoading } = useAdvertisingTrend(range, channel, trendAdType);

  const raw = Array.isArray(data) ? data : (data?.keywords || data?.rows || []);

  const normalize = r => ({
    // Handle both Snowflake uppercase cols AND camelCase API response keys
    keyword:       r.KEYWORD      || r.keyword      || r.TARGETING_TEXT || r.targeting_text || '—',
    matchType:    (r.MATCH_TYPE   || r.match_type   || r.matchType      || r.MATCH_TYPE_TEXT || '—').toUpperCase().replace('N/A','—'),
    adType:        r.AD_TYPE      || r.ad_type      || r.adType         || '—',
    campaign:      r.CAMPAIGN_NAME|| r.campaign_name|| r.campaignName   || '—',
    campaignCount: Number(r.CAMPAIGN_COUNT || r.campaignCount || 1),
    spend:         Number(r.SPEND       || r.spend       || 0),
    sales:         Number(r.SALES       || r.sales       || 0),
    clicks:        Number(r.CLICKS      || r.clicks      || 0),
    impressions:   Number(r.IMPRESSIONS || r.impressions || 0),
    orders:        Number(r.ORDERS      || r.orders      || 0),
    acos:          r.ACOS != null ? Number(r.ACOS) : r.acos != null ? Number(r.acos) : null,
    roas:          r.ROAS != null ? Number(r.ROAS) : r.roas != null ? Number(r.roas) : null,
    cpc:           r.CPC  != null ? Number(r.CPC)  : r.cpc  != null ? Number(r.cpc)  : null,
    ctr:           r.CTR  != null ? Number(r.CTR)  : r.ctr  != null ? Number(r.ctr)  : null,
  });

  const rows = raw.map(normalize);
  const matchTypes = ['All', ...new Set(rows.map(r => r.matchType).filter(t => t && t !== '—'))];

  const filtered = rows
    .filter(r => matchTypeFilter === 'All' || r.matchType === matchTypeFilter)
    .filter(r => !search || r.keyword.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const av = a[sort.col] ?? -Infinity;
      const bv = b[sort.col] ?? -Infinity;
      return sort.dir === 'desc' ? bv - av : av - bv;
    });

  const handleSort = col => setSort(s => ({ col, dir: s.col === col && s.dir === 'desc' ? 'asc' : 'desc' }));
  const acosColor = v => v == null ? '' : v > 0.4 ? 'text-red-600' : v < 0.2 ? 'text-green-700' : 'text-gray-900';

  // Export handler
  const handleExportXlsx = () => exportToXlsx(
    filtered.map(r => ({
      Keyword:    r.keyword,
      'Match Type': r.matchType,
      'Ad Type':  r.adType,
      Campaigns:  r.campaignCount,
      Spend:      r.spend,
      Sales:      r.sales,
      ACoS:       r.acos != null ? `${(r.acos * 100).toFixed(1)}%` : '',
      ROAS:       r.roas != null ? r.roas.toFixed(2) : '',
      Clicks:     r.clicks,
      Orders:     r.orders,
      Impressions: r.impressions,
      CTR:        r.ctr != null ? `${(r.ctr * 100).toFixed(2)}%` : '',
      CPC:        r.cpc != null ? r.cpc.toFixed(2) : '',
    })),
    'keywords-performance'
  );
  const handleExportCsv = () => exportToCsv(
    filtered.map(r => ({
      Keyword:    r.keyword,
      'Match Type': r.matchType,
      'Ad Type':  r.adType,
      Campaigns:  r.campaignCount,
      Spend:      r.spend,
      Sales:      r.sales,
      ACoS:       r.acos != null ? `${(r.acos * 100).toFixed(1)}%` : '',
      ROAS:       r.roas != null ? r.roas.toFixed(2) : '',
      Clicks:     r.clicks,
      Orders:     r.orders,
      Impressions: r.impressions,
      CTR:        r.ctr != null ? `${(r.ctr * 100).toFixed(2)}%` : '',
      CPC:        r.cpc != null ? r.cpc.toFixed(2) : '',
    })),
    'keywords-performance'
  );

  // Build drawer endpoint
  const drawerEndpoint = drawer.keyword
    ? `/advertising/keyword-campaigns?keyword=${encodeURIComponent(drawer.keyword)}${drawer.matchType && drawer.matchType !== '—' ? `&matchType=${encodeURIComponent(drawer.matchType)}` : ''}&range=${range}`
    : null;

  return (
    <div>
      <PageHeader title="Keywords" subtitle="Keyword and search term targeting performance" />
      <AdvertisingSubNav />

      {isError && <ErrorState message={error?.message} />}

      {/* Trend chart */}
      <AdTrendChart
        trendRows={trendRows}
        loading={trendLoading}
        channel={channel}
        currency={currency}
        title={`Keywords — Spend & Sales Trend${matchTypeFilter !== 'All' ? ` (${matchTypeFilter})` : ''}`}
        className="mb-4"
        selectedRows={selectedKeys.size > 0 ? filtered.filter(r => selectedKeys.has(r.keyword + '|' + r.matchType)) : []}
        allRows={filtered}
      />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        {/* Channel */}
        <div className="flex gap-1">
          {[{ key: 'all', label: 'All' }, { key: 'ads', label: 'Sponsored Ads' }].map(c => (
            <button
              key={c.key}
              onClick={() => setChannel(c.key)}
              className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
                channel === c.key
                  ? 'border-green-700 bg-green-700 text-white font-semibold'
                  : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>

        {/* Match type filter */}
        <div className="flex gap-1 flex-wrap">
          {matchTypes.map(t => (
            <button
              key={t}
              onClick={() => setMatchTypeFilter(t)}
              className={`px-2.5 py-1 text-xs rounded border font-medium transition-colors ${
                matchTypeFilter === t
                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                  : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <input
            type="text"
            placeholder="Search keywords…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="text-sm border border-gray-200 rounded px-3 py-1.5 w-64 focus:outline-none focus:ring-1 focus:ring-green-600"
          />
          {!isLoading && filtered.length > 0 && (
            <ExportMenu onXlsx={handleExportXlsx} onCsv={handleExportCsv} />
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5">
        {isLoading ? (
          <SkeletonTable />
        ) : filtered.length === 0 ? (
          <div className="text-gray-400 text-sm text-center py-8">
            {isError ? 'Failed to load keyword data' : 'No keyword data for this period'}
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs text-gray-400">
                {filtered.length.toLocaleString()} keywords
                {selectedKeys.size > 0 && <span className="ml-2 text-blue-600 font-medium">{selectedKeys.size} selected — chart filtered</span>}
                {selectedKeys.size === 0 && <span className="ml-2 text-gray-300">· ☐ Select rows to filter chart</span>}
              </div>
              {selectedKeys.size > 0 && (
                <button onClick={() => setSelectedKeys(new Set())} className="text-xs text-gray-400 hover:text-gray-600 underline">Clear selection</button>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="py-2 px-1 w-8"><input type="checkbox" className="w-3.5 h-3.5 accent-blue-600 cursor-pointer" onChange={e => { if(e.target.checked) setSelectedKeys(new Set(filtered.map(r=>r.keyword+'|'+r.matchType))); else setSelectedKeys(new Set()); }} checked={selectedKeys.size === filtered.length && filtered.length > 0} /></th>
                    <ResizableTh col="keyword" colWidths={colWidths} startResize={startResize} resetWidth={resetWidth} className="text-left py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Keyword / Target</ResizableTh>
                    <ResizableTh col="match" colWidths={colWidths} startResize={startResize} resetWidth={resetWidth} className="text-left py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Match</ResizableTh>
                    <ResizableTh col="adtype" colWidths={colWidths} startResize={startResize} resetWidth={resetWidth} className="text-left py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Type</ResizableTh>
                    <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Campaigns</th>
                    <Th col="spend"       label="Spend"  right sort={sort} onSort={handleSort} />
                    <Th col="sales"       label="Sales"  right sort={sort} onSort={handleSort} />
                    <Th col="acos"        label="ACoS"   right sort={sort} onSort={handleSort} />
                    <Th col="roas"        label="ROAS"   right sort={sort} onSort={handleSort} />
                    <Th col="clicks"      label="Clicks" right sort={sort} onSort={handleSort} />
                    <Th col="orders"      label="Orders" right sort={sort} onSort={handleSort} />
                    <Th col="impressions" label="Impr."  right sort={sort} onSort={handleSort} />
                    <Th col="ctr"         label="CTR"    right sort={sort} onSort={handleSort} />
                    <Th col="cpc"         label="CPC"    right sort={sort} onSort={handleSort} />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r, i) => {
                    const rowKey = r.keyword + '|' + r.matchType;
                    const isSelected = selectedKeys.has(rowKey);
                    return (
                    <tr
                      key={i}
                      className={`border-b border-gray-50 hover:bg-blue-50/40 cursor-pointer transition-colors ${isSelected ? 'bg-blue-50 ring-1 ring-inset ring-blue-200' : i % 2 === 1 ? 'bg-gray-50/40' : ''}`}
                    >
                      <td className="py-2 px-1" onClick={e => { e.stopPropagation(); setSelectedKeys(prev => { const n = new Set(prev); n.has(rowKey)?n.delete(rowKey):n.add(rowKey); return n; }); }}>
                        <input type="checkbox" className="w-3.5 h-3.5 accent-blue-600 cursor-pointer" checked={isSelected} onChange={()=>{}} />
                      </td>
                      <td className="py-2 px-3 overflow-hidden" style={{ maxWidth: colWidths.keyword ? colWidths.keyword + 'px' : '260px' }} title={r.keyword} onClick={() => openDrawer(r.keyword, r.matchType, r.adType)}>
                        <span className="block truncate font-medium text-gray-800">{r.keyword}</span>
                      </td>
                      <td className="py-2 px-3">
                        <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${MATCH_TYPE_COLORS[r.matchType] || 'bg-gray-100 text-gray-500'}`}>
                          {r.matchType !== '—' ? r.matchType : '—'}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-xs text-gray-500">{r.adType}</td>
                      <td className="py-2 px-3 text-right">
                        <span
                          className={`inline-flex items-center justify-center min-w-[1.5rem] text-xs font-semibold px-1.5 py-0.5 rounded-full ${r.campaignCount > 1 ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-500'}`}
                          title={`Active in ${r.campaignCount} campaign${r.campaignCount !== 1 ? 's' : ''}`}
                        >
                          {r.campaignCount}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-right font-medium text-gray-900">{fmtC(r.spend)}</td>
                      <td className="py-2 px-3 text-right text-gray-700">{fmtC(r.sales)}</td>
                      <td className={`py-2 px-3 text-right font-medium ${acosColor(r.acos)}`}>{r.acos != null ? (r.acos * 100).toFixed(1) + '%' : '—'}</td>
                      <td className="py-2 px-3 text-right text-gray-700">{r.roas != null ? fmtRoas(r.roas) : '—'}</td>
                      <td className="py-2 px-3 text-right text-gray-500">{r.clicks.toLocaleString()}</td>
                      <td className="py-2 px-3 text-right text-gray-500">{r.orders.toLocaleString()}</td>
                      <td className="py-2 px-3 text-right text-gray-500">{fmtNum(r.impressions)}</td>
                      <td className="py-2 px-3 text-right text-gray-500">{r.ctr != null ? (r.ctr * 100).toFixed(2) + '%' : '—'}</td>
                      <td className="py-2 px-3 text-right text-gray-500">{r.cpc != null ? fmtC(r.cpc) : '—'}</td>
                    </tr>);
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <CampaignDrawer
        open={drawer.open}
        onClose={closeDrawer}
        title={drawer.keyword || ''}
        subtitle={[drawer.matchType, drawer.adType].filter(Boolean).join(' · ')}
        endpoint={drawerEndpoint}
        currency={currency}
      />
    </div>
  );
}
