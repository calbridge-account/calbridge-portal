import { useState, useCallback } from 'react';
import { useAsinPerformance } from '../../hooks/useAnalytics';
import { useDateRange } from '../../context/DateRangeContext';
import { useMarketplace } from '../../context/MarketplaceContext';
import PageHeader from '../../components/PageHeader';
import { SkeletonTable, ErrorState } from '../../components/Skeleton';
import AdvertisingSubNav from './AdvertisingSubNav';
import CampaignDrawer from '../../components/CampaignDrawer';

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

export default function AdvertisingProducts() {
  const { range } = useDateRange();
  const { activeMarketplace } = useMarketplace() ?? { activeMarketplace: 'US' };
  const currency = activeMarketplace === 'CA' ? 'CAD' : 'USD';
  const fmt$ = makeFmtCurrency(currency);

  const [channel, setChannel] = useState('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState({ col: 'spend', dir: 'desc' });

  // Drawer state
  const [drawer, setDrawer] = useState({ open: false, asin: null, productTitle: null });
  const closeDrawer = useCallback(() => setDrawer(d => ({ ...d, open: false })), []);
  const openDrawer  = useCallback((asin, productTitle) => setDrawer({ open: true, asin, productTitle }), []);

  const { data, isLoading, isError, error } = useAsinPerformance(range, channel);

  const asins = (data?.asins || []).map(a => ({
    asin:          a.asin         || a.ASIN         || '—',
    productTitle:  a.productTitle || a.PRODUCT_TITLE || a.product_title || '—',
    campaignCount: Number(a.campaignCount || a.CAMPAIGN_COUNT || 1),
    spend:         Number(a.spend  || a.SPEND  || 0),
    sales:         Number(a.sales  || a.SALES  || 0),
    clicks:        Number(a.clicks || a.CLICKS || 0),
    orders:        Number(a.purchases || a.PURCHASES || a.orders || a.ORDERS || 0),
    impressions:   Number(a.impressions || a.IMPRESSIONS || 0),
    acos:          a.acos  != null ? Number(a.acos)  : a.ACOS  != null ? Number(a.ACOS)  : null,
    roas:          a.roas  != null ? Number(a.roas)  : a.ROAS  != null ? Number(a.ROAS)  : null,
    cpc:           a.cpc   != null ? Number(a.cpc)   : a.CPC   != null ? Number(a.CPC)   : null,
    ctr:           a.ctr   != null ? Number(a.ctr)   : a.CTR   != null ? Number(a.CTR)   : null,
  }));

  const filtered = asins
    .filter(r => !search || r.asin.toLowerCase().includes(search.toLowerCase()) || r.productTitle.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const av = a[sort.col] ?? -Infinity;
      const bv = b[sort.col] ?? -Infinity;
      return sort.dir === 'desc' ? bv - av : av - bv;
    });

  const handleSort = col => setSort(s => ({ col, dir: s.col === col && s.dir === 'desc' ? 'asc' : 'desc' }));
  const acosColor = v => v == null ? '' : v > 0.4 ? 'text-red-600' : v < 0.2 ? 'text-green-700' : 'text-gray-900';

  // Totals
  const totals = filtered.reduce((acc, r) => {
    acc.spend += r.spend;
    acc.sales += r.sales;
    acc.clicks += r.clicks;
    acc.orders += r.orders;
    return acc;
  }, { spend: 0, sales: 0, clicks: 0, orders: 0 });
  const totalRoas = totals.spend > 0 ? totals.sales / totals.spend : null;
  const totalAcos = totals.sales > 0 ? totals.spend / totals.sales : null;

  const drawerEndpoint = drawer.asin
    ? `/advertising/product-campaigns?asin=${encodeURIComponent(drawer.asin)}&range=${range}`
    : null;

  return (
    <div>
      <PageHeader title="Products" subtitle="ASIN-level advertising performance" />
      <AdvertisingSubNav />

      {isError && <ErrorState message={error?.message} />}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex gap-1">
          {[{ key: 'all', label: 'All Channels' }, { key: 'ads', label: 'Sponsored Ads' }, { key: 'dsp', label: 'DSP' }].map(c => (
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

        <input
          type="text"
          placeholder="Search ASIN or title…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="ml-auto text-sm border border-gray-200 rounded px-3 py-1.5 w-64 focus:outline-none focus:ring-1 focus:ring-green-600"
        />
      </div>

      {/* Summary bar */}
      {!isLoading && filtered.length > 0 && (
        <div className="bg-green-50 border border-green-100 rounded-xl px-4 py-3 mb-4 flex flex-wrap gap-6 text-sm">
          <span className="text-gray-500">{filtered.length} ASINs</span>
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
          <div className="text-gray-400 text-sm text-center py-8">No ASIN data for this period</div>
        ) : (
          <>
            <div className="text-xs text-gray-400 mb-3">
              {filtered.length.toLocaleString()} ASINs
              <span className="ml-2 text-gray-300">· Click a row to see campaign breakdown</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">ASIN</th>
                    <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Product</th>
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
                  {filtered.map((r, i) => (
                    <tr
                      key={r.asin + i}
                      onClick={() => openDrawer(r.asin, r.productTitle)}
                      className={`border-b border-gray-50 hover:bg-blue-50/40 cursor-pointer transition-colors ${i % 2 === 1 ? 'bg-gray-50/40' : ''}`}
                    >
                      <td className="py-2.5 px-3 font-mono text-xs text-blue-700">{r.asin}</td>
                      <td className="py-2.5 px-3 text-gray-800 max-w-xs" title={r.productTitle}>
                        <span className="block truncate max-w-[220px] font-medium">{r.productTitle}</span>
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <span className={`inline-flex items-center justify-center min-w-[1.5rem] text-xs font-semibold px-1.5 py-0.5 rounded-full ${r.campaignCount > 1 ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-500'}`}>
                          {r.campaignCount}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right font-medium text-gray-900">{fmt$(r.spend)}</td>
                      <td className="py-2.5 px-3 text-right text-gray-700">{fmt$(r.sales)}</td>
                      <td className={`py-2.5 px-3 text-right font-medium ${acosColor(r.acos)}`}>{r.acos != null ? (r.acos * 100).toFixed(1) + '%' : '—'}</td>
                      <td className="py-2.5 px-3 text-right text-gray-700">{r.roas != null ? r.roas.toFixed(2) + 'x' : '—'}</td>
                      <td className="py-2.5 px-3 text-right text-gray-500">{r.clicks.toLocaleString()}</td>
                      <td className="py-2.5 px-3 text-right text-gray-500">{r.orders.toLocaleString()}</td>
                      <td className="py-2.5 px-3 text-right text-gray-500">{fmtNum(r.impressions)}</td>
                      <td className="py-2.5 px-3 text-right text-gray-500">{r.ctr != null ? (r.ctr * 100).toFixed(2) + '%' : '—'}</td>
                      <td className="py-2.5 px-3 text-right text-gray-500">{r.cpc != null ? fmt$(r.cpc) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <CampaignDrawer
        open={drawer.open}
        onClose={closeDrawer}
        title={drawer.asin || ''}
        subtitle={drawer.productTitle || ''}
        endpoint={drawerEndpoint}
        currency={currency}
      />
    </div>
  );
}
