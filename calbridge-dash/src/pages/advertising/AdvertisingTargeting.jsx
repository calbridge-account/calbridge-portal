import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTargetingRollup, useAdvertisingTrend } from '../../hooks/useAnalytics';
import { useDateRange } from '../../context/DateRangeContext';
import { useMarketplace } from '../../context/MarketplaceContext';
import PageHeader from '../../components/PageHeader';
import { SkeletonCard, SkeletonTable, ErrorState } from '../../components/Skeleton';
import AdvertisingSubNav from './AdvertisingSubNav';
import ExportMenu from '../../components/ExportMenu';
import { exportToXlsx, exportToCsv } from '../../utils/exportUtils';
import AdTrendChart from '../../components/AdTrendChart';

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
function fmtX(n) {
  if (n == null || isNaN(n)) return '—';
  return `${Number(n).toFixed(2)}x`;
}

const MATCH_TYPE_COLORS = {
  AUTO:    'bg-gray-100 text-gray-600',
  BROAD:   'bg-blue-100 text-blue-700',
  PHRASE:  'bg-green-100 text-green-700',
  EXACT:   'bg-purple-100 text-purple-700',
  PRODUCT: 'bg-amber-100 text-amber-700',
};

function MetricTile({ label, value, sub }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className="text-xl font-bold text-gray-900">{value}</div>
      {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}

export default function AdvertisingTargeting() {
  const { range } = useDateRange();
  const { activeMarketplace } = useMarketplace() ?? { activeMarketplace: 'US' };
  const currency = activeMarketplace === 'CA' ? 'CAD' : 'USD';
  const fmt$ = makeFmtCurrency(currency);
  const navigate = useNavigate();

  // Clicking a match type row navigates to Keywords page pre-filtered to that match type
  const handleRowClick = useCallback((matchType) => {
    navigate(`/advertising/keywords?matchType=${encodeURIComponent(matchType)}`);
  }, [navigate]);

  const { data, isLoading, isError, error } = useTargetingRollup(range);
  // Targeting = SP + SB keywords → channel 'ads'
  const { data: trendRows, isLoading: trendLoading } = useAdvertisingTrend(range, 'ads');

  // API returns { days, total: {...}, byType: [{matchType, spend, sales, ...}] }
  const total  = data?.total   || {};
  const byType = data?.byType  || [];

  const acosColor = v => v == null ? '' : v > 0.4 ? 'text-red-600' : v < 0.2 ? 'text-green-700' : 'text-gray-900';

  // Sort by spend desc
  const rows = [...byType].sort((a, b) => (b.spend || 0) - (a.spend || 0));
  const totalSpend = total.spend || 0;

  // Export handlers
  const handleExportXlsx = () => exportToXlsx(
    rows.map(r => ({
      'Match Type':  r.matchType,
      'Spend':       r.spend,
      'Spend %':     totalSpend > 0 ? `${(r.spend / totalSpend * 100).toFixed(1)}%` : '',
      'Sales':       r.sales,
      'ACoS':        r.acos != null ? `${(r.acos * 100).toFixed(1)}%` : '',
      'ROAS':        r.roas != null ? r.roas.toFixed(2) : '',
      'Orders':      r.orders || 0,
      'Clicks':      r.clicks || 0,
      'CTR':         r.ctr  != null ? `${(r.ctr  * 100).toFixed(2)}%` : '',
      'CVR':         r.cvr  != null ? `${(r.cvr  * 100).toFixed(2)}%` : '',
      'CPC':         r.cpc  != null ? r.cpc.toFixed(2) : '',
      'Impressions': r.impressions || 0,
    })),
    'targeting-performance'
  );
  const handleExportCsv = () => exportToCsv(
    rows.map(r => ({
      'Match Type':  r.matchType,
      'Spend':       r.spend,
      'Spend %':     totalSpend > 0 ? `${(r.spend / totalSpend * 100).toFixed(1)}%` : '',
      'Sales':       r.sales,
      'ACoS':        r.acos != null ? `${(r.acos * 100).toFixed(1)}%` : '',
      'ROAS':        r.roas != null ? r.roas.toFixed(2) : '',
      'Orders':      r.orders || 0,
      'Clicks':      r.clicks || 0,
      'CTR':         r.ctr  != null ? `${(r.ctr  * 100).toFixed(2)}%` : '',
      'CVR':         r.cvr  != null ? `${(r.cvr  * 100).toFixed(2)}%` : '',
      'CPC':         r.cpc  != null ? r.cpc.toFixed(2) : '',
      'Impressions': r.impressions || 0,
    })),
    'targeting-performance'
  );

  return (
    <div>
      <PageHeader title="Targeting" subtitle="SP + SB targeting performance rolled up by match type" />
      <AdvertisingSubNav />

      {isError && <ErrorState message={error?.message} />}

      {/* Trend chart */}
      <AdTrendChart
        trendRows={trendRows}
        loading={trendLoading}
        channel="ads"
        currency={currency}
        title="Targeting — Spend & Sales Trend (Sponsored Ads)"
        className="mb-6"
      />

      {/* Totals row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
        {isLoading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-gray-100 rounded-xl border border-gray-200 h-20 animate-pulse" />
          ))
        ) : (
          <>
            <MetricTile label="Total Spend"    value={fmt$(total.spend)}   />
            <MetricTile label="Total Sales"    value={fmt$(total.sales)}   />
            <MetricTile label="Blended ACoS"   value={fmtPct(total.acos)}  />
            <MetricTile label="Blended ROAS"   value={fmtX(total.roas)}    />
            <MetricTile label="Total Orders"   value={fmtNum(total.orders)} />
            <MetricTile label="Total Clicks"   value={fmtNum(total.clicks)} sub={total.ctr != null ? fmtPct(total.ctr) + ' CTR' : null} />
          </>
        )}
      </div>

      {/* By Match Type table */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-700">Performance by Targeting Type</h3>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-400">Click a row to see keywords →</span>
            {!isLoading && rows.length > 0 && (
              <ExportMenu onXlsx={handleExportXlsx} onCsv={handleExportCsv} />
            )}
          </div>
        </div>
        {isLoading ? (
          <SkeletonTable />
        ) : rows.length === 0 ? (
          <div className="text-gray-400 text-sm text-center py-8">No targeting data for this period</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Match Type</th>
                  <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Spend</th>
                  <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Spend %</th>
                  <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Sales</th>
                  <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">ACoS</th>
                  <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">ROAS</th>
                  <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Orders</th>
                  <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Clicks</th>
                  <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">CTR</th>
                  <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">CVR</th>
                  <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">CPC</th>
                  <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Impressions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const spendPct = totalSpend > 0 ? (r.spend / totalSpend * 100).toFixed(1) : '—';
                  return (
                    <tr
                      key={i}
                      onClick={() => handleRowClick(r.matchType)}
                      title={`View ${r.matchType} keywords →`}
                      className={`border-b border-gray-50 hover:bg-blue-50/40 cursor-pointer transition-colors ${i % 2 === 1 ? 'bg-gray-50/40' : ''}`}
                    >
                      <td className="py-3 px-3">
                        <span className={`text-xs font-bold px-2 py-1 rounded ${MATCH_TYPE_COLORS[r.matchType] || 'bg-gray-100 text-gray-600'}`}>
                          {r.matchType}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-right font-semibold text-gray-900">{fmt$(r.spend)}</td>
                      <td className="py-3 px-3 text-right text-gray-500">{spendPct}%</td>
                      <td className="py-3 px-3 text-right text-gray-700">{fmt$(r.sales)}</td>
                      <td className={`py-3 px-3 text-right font-medium ${acosColor(r.acos)}`}>{fmtPct(r.acos)}</td>
                      <td className="py-3 px-3 text-right text-gray-700">{fmtX(r.roas)}</td>
                      <td className="py-3 px-3 text-right text-gray-500">{(r.orders || 0).toLocaleString()}</td>
                      <td className="py-3 px-3 text-right text-gray-500">{(r.clicks || 0).toLocaleString()}</td>
                      <td className="py-3 px-3 text-right text-gray-500">{fmtPct(r.ctr)}</td>
                      <td className="py-3 px-3 text-right text-gray-500">{fmtPct(r.cvr)}</td>
                      <td className="py-3 px-3 text-right text-gray-500">{fmt$(r.cpc)}</td>
                      <td className="py-3 px-3 text-right text-gray-500">{fmtNum(r.impressions)}</td>
                    </tr>
                  );
                })}

                {/* Totals footer */}
                <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold">
                  <td className="py-3 px-3 text-xs text-gray-600 uppercase tracking-wide">Total</td>
                  <td className="py-3 px-3 text-right text-gray-900">{fmt$(total.spend)}</td>
                  <td className="py-3 px-3 text-right text-gray-500">100%</td>
                  <td className="py-3 px-3 text-right text-gray-700">{fmt$(total.sales)}</td>
                  <td className={`py-3 px-3 text-right font-semibold ${acosColor(total.acos)}`}>{fmtPct(total.acos)}</td>
                  <td className="py-3 px-3 text-right text-gray-700">{fmtX(total.roas)}</td>
                  <td className="py-3 px-3 text-right text-gray-500">{(total.orders || 0).toLocaleString()}</td>
                  <td className="py-3 px-3 text-right text-gray-500">{(total.clicks || 0).toLocaleString()}</td>
                  <td className="py-3 px-3 text-right text-gray-500">{fmtPct(total.ctr)}</td>
                  <td className="py-3 px-3 text-right text-gray-500">{fmtPct(total.cvr)}</td>
                  <td className="py-3 px-3 text-right text-gray-500">{fmt$(total.cpc)}</td>
                  <td className="py-3 px-3 text-right text-gray-500">{fmtNum(total.impressions)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
