import { useState } from 'react';
import { useKeywordTargeting } from '../../hooks/useAnalytics';
import { useDateRange } from '../../context/DateRangeContext';
import { useMarketplace } from '../../context/MarketplaceContext';
import PageHeader from '../../components/PageHeader';
import { SkeletonTable, ErrorState } from '../../components/Skeleton';
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
  const fmt$ = makeFmtCurrency(currency);

  const [channel, setChannel] = useState('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState({ col: 'spend', dir: 'desc' });
  const [matchTypeFilter, setMatchTypeFilter] = useState('All');

  const { data, isLoading, isError, error } = useKeywordTargeting(range, channel);

  const raw = Array.isArray(data) ? data : (data?.keywords || data?.rows || []);

  const normalize = r => ({
    keyword:    r.KEYWORD    || r.keyword    || r.TARGETING_TEXT || r.targeting_text || '—',
    matchType:  r.MATCH_TYPE || r.match_type || r.MATCH_TYPE_TEXT || '—',
    adType:     r.AD_TYPE    || r.ad_type    || '—',
    campaign:   r.CAMPAIGN_NAME || r.campaign_name || '—',
    spend:      Number(r.SPEND       || r.spend       || 0),
    sales:      Number(r.SALES       || r.sales       || 0),
    clicks:     Number(r.CLICKS      || r.clicks      || 0),
    impressions:Number(r.IMPRESSIONS || r.impressions || 0),
    orders:     Number(r.ORDERS      || r.orders      || 0),
    acos:       r.ACOS != null ? Number(r.ACOS) : r.acos != null ? Number(r.acos) : null,
    roas:       r.ROAS != null ? Number(r.ROAS) : r.roas != null ? Number(r.roas) : null,
    cpc:        r.CPC  != null ? Number(r.CPC)  : r.cpc  != null ? Number(r.cpc)  : null,
    ctr:        r.CTR  != null ? Number(r.CTR)  : r.ctr  != null ? Number(r.ctr)  : null,
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

  return (
    <div>
      <PageHeader title="Keywords" subtitle="Keyword and search term targeting performance" />
      <AdvertisingSubNav />

      {isError && <ErrorState message={error?.message} />}

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

        <input
          type="text"
          placeholder="Search keywords…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="ml-auto text-sm border border-gray-200 rounded px-3 py-1.5 w-64 focus:outline-none focus:ring-1 focus:ring-green-600"
        />
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
            <div className="text-xs text-gray-400 mb-3">{filtered.length.toLocaleString()} keywords</div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Keyword / Target</th>
                    <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Match</th>
                    <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Type</th>
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
                  {filtered.map((r, i) => (
                    <tr key={i} className={`border-b border-gray-50 hover:bg-gray-50 ${i % 2 === 1 ? 'bg-gray-50/40' : ''}`}>
                      <td className="py-2 px-3 max-w-xs" title={r.keyword}>
                        <span className="block truncate max-w-[260px] font-medium text-gray-800">{r.keyword}</span>
                        {r.campaign !== '—' && (
                          <span className="block truncate max-w-[260px] text-xs text-gray-400">{r.campaign}</span>
                        )}
                      </td>
                      <td className="py-2 px-3">
                        <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${MATCH_TYPE_COLORS[r.matchType] || 'bg-gray-100 text-gray-500'}`}>
                          {r.matchType !== '—' ? r.matchType : '—'}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-xs text-gray-500">{r.adType}</td>
                      <td className="py-2 px-3 text-right font-medium text-gray-900">{fmt$(r.spend)}</td>
                      <td className="py-2 px-3 text-right text-gray-700">{fmt$(r.sales)}</td>
                      <td className={`py-2 px-3 text-right font-medium ${acosColor(r.acos)}`}>{r.acos != null ? (r.acos * 100).toFixed(1) + '%' : '—'}</td>
                      <td className="py-2 px-3 text-right text-gray-700">{r.roas != null ? r.roas.toFixed(2) + 'x' : '—'}</td>
                      <td className="py-2 px-3 text-right text-gray-500">{r.clicks.toLocaleString()}</td>
                      <td className="py-2 px-3 text-right text-gray-500">{r.orders.toLocaleString()}</td>
                      <td className="py-2 px-3 text-right text-gray-500">{fmtNum(r.impressions)}</td>
                      <td className="py-2 px-3 text-right text-gray-500">{r.ctr != null ? (r.ctr * 100).toFixed(2) + '%' : '—'}</td>
                      <td className="py-2 px-3 text-right text-gray-500">{r.cpc != null ? fmt$(r.cpc) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
