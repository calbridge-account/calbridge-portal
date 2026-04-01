import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Callout } from '@tremor/react';
import { useDateRange } from '../context/DateRangeContext';
import { getCampaigns, getSearchTerms } from '../api/v2client';
import MetricCard from '../components/MetricCard';
import DataTable from '../components/DataTable';
import AdTypeBadge from '../components/AdTypeBadge';
import StatusBadge from '../components/StatusBadge';
import { acosColor } from '../utils/format';

// ─── Ad type filter config ───────────────────────────────────────────────────
const AD_TYPES = [
  { value: 'ALL',                label: 'All',  color: '#374151' },
  { value: 'SPONSORED_PRODUCTS', label: 'SP',   color: '#2563eb' },
  { value: 'SPONSORED_BRANDS',   label: 'SB',   color: '#10b981' },
  { value: 'SPONSORED_DISPLAY',  label: 'SD',   color: '#f59e0b' },
  { value: 'DSP',                label: 'DSP',  color: '#8b5cf6' },
];

// ─── Campaign table columns ──────────────────────────────────────────────────
const CAMPAIGN_COLUMNS = [
  { key: 'campaignName', label: 'Campaign Name', sortable: true, truncate: true },
  {
    key: 'adProduct',
    label: 'Type',
    sortable: true,
    render: (v) => <AdTypeBadge type={v} />,
  },
  {
    key: 'status',
    label: 'Status',
    sortable: true,
    render: (v) => <StatusBadge status={v} />,
  },
  { key: 'spend',       label: 'Spend',       format: 'currency', sortable: true },
  { key: 'sales',       label: 'Sales',        format: 'currency', sortable: true },
  {
    key: 'acos',
    label: 'ACoS',
    sortable: true,
    render: (v) => {
      const cls = acosColor(v);
      return <span className={cls}>{v != null ? `${(v * 100).toFixed(1)}%` : '—'}</span>;
    },
  },
  { key: 'roas',        label: 'ROAS',         format: 'roas',    sortable: true },
  { key: 'impressions', label: 'Impressions',   format: 'compact', sortable: true },
  { key: 'clicks',      label: 'Clicks',        format: 'compact', sortable: true },
  { key: 'ctr',         label: 'CTR',           format: 'percent', sortable: true },
  { key: 'cpc',         label: 'CPC',           format: 'currency', sortable: true },
];

// ─── Search term table columns ───────────────────────────────────────────────
const SEARCH_TERM_COLUMNS = [
  { key: 'searchTerm', label: 'Search Term', sortable: true },
  {
    key: 'matchType',
    label: 'Match Type',
    sortable: true,
    render: (v) => (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700">
        {v || '—'}
      </span>
    ),
  },
  { key: 'spend',     label: 'Spend',     format: 'currency', sortable: true },
  { key: 'sales',     label: 'Sales',     format: 'currency', sortable: true },
  {
    key: 'acos',
    label: 'ACoS',
    sortable: true,
    render: (v) => {
      const cls = acosColor(v);
      return <span className={cls}>{v != null ? `${(v * 100).toFixed(1)}%` : '—'}</span>;
    },
  },
  { key: 'roas',      label: 'ROAS',      format: 'roas',    sortable: true },
  { key: 'purchases', label: 'Purchases', format: 'compact', sortable: true },
  { key: 'ctr',       label: 'CTR',       format: 'percent', sortable: true },
  { key: 'cpc',       label: 'CPC',       format: 'currency', sortable: true },
];

// ─── KPI aggregation helpers ─────────────────────────────────────────────────
function computeKPIs(rows) {
  if (!rows || rows.length === 0) return { spend: null, sales: null, acos: null, roas: null };
  const spend = rows.reduce((s, r) => s + (r.spend || 0), 0);
  const sales = rows.reduce((s, r) => s + (r.sales || 0), 0);
  const acos  = sales > 0 ? spend / sales : null;
  const roas  = spend > 0 ? sales / spend : null;
  return { spend, sales, acos, roas };
}

// ─── Campaign KPI bar ─────────────────────────────────────────────────────────
function CampaignKPIs({ campaigns, adTypeFilter, loading }) {
  const filtered = useMemo(() => {
    if (!campaigns) return [];
    if (adTypeFilter === 'ALL') return campaigns;
    return campaigns.filter(c => c.adProduct === adTypeFilter);
  }, [campaigns, adTypeFilter]);

  const kpis = useMemo(() => computeKPIs(filtered), [filtered]);

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      <MetricCard title="Total Spend"    value={kpis.spend} format="currency" loading={loading} />
      <MetricCard title="Ad Sales"       value={kpis.sales} format="currency" loading={loading} />
      <MetricCard
        title="Blended ACoS"
        value={kpis.acos}
        format="percent"
        colorFn={acosColor}
        loading={loading}
      />
      <MetricCard title="Blended ROAS"   value={kpis.roas} format="roas"     loading={loading} />
    </div>
  );
}

// ─── Search Term KPI bar ──────────────────────────────────────────────────────
function SearchTermKPIs({ searchTerms, loading }) {
  const kpis = useMemo(() => computeKPIs(searchTerms), [searchTerms]);
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      <MetricCard title="Total Spend" value={kpis.spend} format="currency" loading={loading} />
      <MetricCard title="Ad Sales"    value={kpis.sales} format="currency" loading={loading} />
      <MetricCard
        title="Blended ACoS"
        value={kpis.acos}
        format="percent"
        colorFn={acosColor}
        loading={loading}
      />
      <MetricCard title="Blended ROAS" value={kpis.roas} format="roas"    loading={loading} />
    </div>
  );
}

// ─── Campaigns Tab ────────────────────────────────────────────────────────────
function CampaignsTab({ rangeParams }) {
  const [adTypeFilter, setAdTypeFilter] = useState('ALL');

  const adProductParam = adTypeFilter !== 'ALL' ? `&adProduct=${adTypeFilter}` : '';

  const { data: campaigns, isLoading, error } = useQuery({
    queryKey: ['campaigns', rangeParams, adTypeFilter],
    queryFn: () => getCampaigns(rangeParams, adProductParam),
  });

  // When "ALL" is selected, we pass all data; otherwise filter client-side too (belt + suspenders)
  const tableData = useMemo(() => {
    if (!campaigns) return [];
    if (adTypeFilter === 'ALL') return campaigns;
    return campaigns.filter(c => c.adProduct === adTypeFilter);
  }, [campaigns, adTypeFilter]);

  return (
    <div>
      {/* Ad Type Filter Strip */}
      <div className="flex flex-wrap gap-2 mb-6">
        {AD_TYPES.map(t => {
          const active = adTypeFilter === t.value;
          return (
            <button
              key={t.value}
              onClick={() => setAdTypeFilter(t.value)}
              style={active ? { backgroundColor: t.color, borderColor: t.color, color: '#fff' } : { borderColor: t.color, color: t.color }}
              className="px-4 py-1.5 rounded-full text-sm font-semibold border-2 transition-all"
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {/* KPI Summary */}
      <CampaignKPIs
        campaigns={adTypeFilter === 'ALL' ? campaigns : tableData}
        adTypeFilter={adTypeFilter}
        loading={isLoading}
      />

      {/* Error */}
      {error && (
        <Callout className="mb-4" title="Error loading campaigns" color="red">
          {error.message}
        </Callout>
      )}

      {/* Table */}
      <DataTable
        columns={CAMPAIGN_COLUMNS}
        data={tableData}
        pageSize={25}
        searchable
        searchKey="campaignName"
        searchPlaceholder="Search campaigns..."
        loading={isLoading}
        emptyMessage="No campaigns found for this date range."
      />
    </div>
  );
}

// ─── Search Terms Tab ─────────────────────────────────────────────────────────
function SearchTermsTab({ rangeParams }) {
  const [minSpend, setMinSpend] = useState('');

  const { data: searchTerms, isLoading, error } = useQuery({
    queryKey: ['search-terms', rangeParams],
    queryFn: () => getSearchTerms(rangeParams),
  });

  const filteredTerms = useMemo(() => {
    if (!searchTerms) return [];
    const threshold = parseFloat(minSpend);
    if (!isNaN(threshold) && threshold > 0) {
      return searchTerms.filter(r => (r.spend || 0) >= threshold);
    }
    return searchTerms;
  }, [searchTerms, minSpend]);

  const minSpendControl = (
    <div className="flex items-center gap-2">
      <label className="text-sm text-gray-600 whitespace-nowrap">Min Spend $</label>
      <input
        type="number"
        min="0"
        step="1"
        value={minSpend}
        onChange={e => setMinSpend(e.target.value)}
        placeholder="0"
        className="border border-gray-300 rounded-md px-2 py-1.5 text-sm w-24 focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    </div>
  );

  return (
    <div>
      {/* KPI Summary */}
      <SearchTermKPIs searchTerms={filteredTerms} loading={isLoading} />

      {/* Error */}
      {error && (
        <Callout className="mb-4" title="Error loading search terms" color="red">
          {error.message}
        </Callout>
      )}

      {/* Table */}
      <DataTable
        columns={SEARCH_TERM_COLUMNS}
        data={filteredTerms}
        pageSize={25}
        searchable
        searchKey="searchTerm"
        searchPlaceholder="Search terms..."
        loading={isLoading}
        emptyMessage="No search terms found for this date range."
        extraControls={minSpendControl}
      />
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
const TABS = ['Campaigns', 'Search Terms'];

export default function Advertising() {
  const { rangeLabel, rangeParams } = useDateRange();
  const [activeTab, setActiveTab] = useState('Campaigns');
  const rp = rangeParams();

  return (
    <div>
      {/* Page Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Advertising</h1>
        <p className="text-sm text-gray-500 mt-1">Showing data for: {rangeLabel()}</p>
      </div>

      {/* Tab Bar */}
      <div className="flex gap-1 border-b border-gray-200 mb-6">
        {TABS.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-5 py-2.5 text-sm font-semibold transition-all border-b-2 -mb-px ${
              activeTab === tab
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'Campaigns' && <CampaignsTab rangeParams={rp} />}
      {activeTab === 'Search Terms' && <SearchTermsTab rangeParams={rp} />}
    </div>
  );
}
