/**
 * AgencyReports.jsx
 * Multi-client advertising reporting page for agency users.
 * Controls: client multi-select, date range, report type, marketplace.
 * Results: sortable table with per-type columns, row highlights, CSV export.
 */
import { useState, useEffect, useRef, useCallback } from 'react';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function today() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function fmt$$(n) {
  if (n == null || isNaN(n)) return '—';
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtPct(n) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toFixed(1) + '%';
}

function fmtNum(n) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toLocaleString('en-US');
}

function fmtCompact(n) {
  if (n == null || isNaN(n)) return '—';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

function fmtRoas(n) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toFixed(2) + 'x';
}

// ─── Column definitions per report type ──────────────────────────────────────

const COLUMNS = {
  summary: [
    { key: 'client',     label: 'Client',      fmt: v => v ?? '—' },
    { key: 'spend',      label: 'Spend',        fmt: fmt$$ },
    { key: 'sales',      label: 'Sales',        fmt: fmt$$ },
    { key: 'orders',     label: 'Orders',       fmt: fmtNum },
    { key: 'acos',       label: 'ACoS',         fmt: fmtPct },
    { key: 'roas',       label: 'ROAS',         fmt: fmtRoas },
    { key: 'impressions',label: 'Impressions',  fmt: fmtCompact },
    { key: 'clicks',     label: 'Clicks',       fmt: fmtCompact },
    { key: 'ctr',        label: 'CTR',          fmt: fmtPct },
    { key: 'cvr',        label: 'CVR',          fmt: fmtPct },
    { key: 'ntbOrders',  label: 'NTB Orders',   fmt: fmtNum },
  ],
  campaign: [
    { key: 'client',     label: 'Client',       fmt: v => v ?? '—' },
    { key: 'campaign',   label: 'Campaign',     fmt: v => v ?? '—' },
    { key: 'type',       label: 'Type',         fmt: v => v ?? '—' },
    { key: 'spend',      label: 'Spend',        fmt: fmt$$ },
    { key: 'sales',      label: 'Sales',        fmt: fmt$$ },
    { key: 'orders',     label: 'Orders',       fmt: fmtNum },
    { key: 'acos',       label: 'ACoS',         fmt: fmtPct },
    { key: 'roas',       label: 'ROAS',         fmt: fmtRoas },
    { key: 'impressions',label: 'Impressions',  fmt: fmtCompact },
    { key: 'clicks',     label: 'Clicks',       fmt: fmtCompact },
  ],
  daily: [
    { key: 'client',     label: 'Client',       fmt: v => v ?? '—' },
    { key: 'date',       label: 'Date',         fmt: v => v ?? '—' },
    { key: 'spend',      label: 'Spend',        fmt: fmt$$ },
    { key: 'sales',      label: 'Sales',        fmt: fmt$$ },
    { key: 'orders',     label: 'Orders',       fmt: fmtNum },
    { key: 'acos',       label: 'ACoS',         fmt: fmtPct },
    { key: 'roas',       label: 'ROAS',         fmt: fmtRoas },
    { key: 'impressions',label: 'Impressions',  fmt: fmtCompact },
    { key: 'clicks',     label: 'Clicks',       fmt: fmtCompact },
  ],
};

// ─── Client multi-select dropdown ────────────────────────────────────────────

function ClientSelector({ clients, selected, onChange, loading }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // Close on outside click
  useEffect(() => {
    function handler(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const allSelected = clients.length > 0 && selected.length === clients.length;

  function toggleAll() {
    if (allSelected) {
      onChange([]);
    } else {
      onChange(clients.map(c => c.clientId));
    }
  }

  function toggleOne(id) {
    if (selected.includes(id)) {
      onChange(selected.filter(s => s !== id));
    } else {
      onChange([...selected, id]);
    }
  }

  const label = loading
    ? 'Loading…'
    : clients.length === 0
      ? 'No clients'
      : allSelected
        ? 'All Clients'
        : selected.length === 0
          ? 'Select clients…'
          : `${selected.length} client${selected.length !== 1 ? 's' : ''} selected`;

  return (
    <div className="relative" ref={ref}>
      <label className="block text-xs text-gray-500 mb-1 font-medium">Clients</label>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-700 hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[160px]"
      >
        <span className="flex-1 text-left truncate">{label}</span>
        <svg className={`w-4 h-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-gray-200 rounded-xl shadow-lg min-w-[220px] max-h-64 overflow-y-auto">
          {/* Select All */}
          <label className="flex items-center gap-2.5 px-3 py-2.5 hover:bg-gray-50 cursor-pointer border-b border-gray-100">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleAll}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-sm font-medium text-gray-700">Select All</span>
          </label>

          {loading && (
            <div className="px-3 py-3 text-sm text-gray-400">Loading clients…</div>
          )}

          {!loading && clients.length === 0 && (
            <div className="px-3 py-3 text-sm text-gray-400">No clients found</div>
          )}

          {clients.map(c => (
            <label key={c.clientId} className="flex items-center gap-2.5 px-3 py-2 hover:bg-gray-50 cursor-pointer">
              <input
                type="checkbox"
                checked={selected.includes(c.clientId)}
                onChange={() => toggleOne(c.clientId)}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700 truncate">{c.name}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Sort icon ────────────────────────────────────────────────────────────────

function SortIcon({ direction }) {
  if (!direction) return <span className="ml-1 text-gray-300">⇅</span>;
  return <span className="ml-1 text-blue-500">{direction === 'asc' ? '↑' : '↓'}</span>;
}

// ─── Skeleton rows ────────────────────────────────────────────────────────────

function SkeletonRows({ cols, rows = 6 }) {
  return Array.from({ length: rows }).map((_, i) => (
    <tr key={i} className="border-b border-gray-100">
      {Array.from({ length: cols }).map((_, j) => (
        <td key={j} className="px-4 py-3">
          <div className="h-4 bg-gray-100 rounded animate-pulse" style={{ width: j === 0 ? '80%' : '60%' }} />
        </td>
      ))}
    </tr>
  ));
}

// ─── Row highlight ────────────────────────────────────────────────────────────

function rowClass(row) {
  const acos = Number(row.acos);
  const roas = Number(row.roas);
  if (!isNaN(acos) && acos > 100) return 'bg-red-50 hover:bg-red-100';
  if (!isNaN(roas) && roas > 4) return 'bg-green-50 hover:bg-green-100';
  return 'hover:bg-gray-50';
}

// ─── Report type tabs ─────────────────────────────────────────────────────────

const REPORT_TYPES = [
  { value: 'summary',  label: 'Summary' },
  { value: 'campaign', label: 'Campaigns' },
  { value: 'daily',    label: 'Daily' },
];

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AgencyReports() {
  // ── Clients ──
  const [clients, setClients] = useState([]);
  const [clientsLoading, setClientsLoading] = useState(true);
  const [selectedClients, setSelectedClients] = useState([]);

  // ── Controls ──
  const [startDate, setStartDate] = useState(daysAgo(30));
  const [endDate, setEndDate] = useState(today());
  const [reportType, setReportType] = useState('summary');
  const [marketplace, setMarketplace] = useState('all');

  // ── Report state ──
  const [reportData, setReportData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [hasRun, setHasRun] = useState(false);

  // ── Sort ──
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState('desc');

  // ── Export ──
  const [exporting, setExporting] = useState(false);

  // Fetch clients on mount
  useEffect(() => {
    setClientsLoading(true);
    fetch('/agency/reports/clients', { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(data => {
        const list = Array.isArray(data) ? data : [];
        setClients(list);
        setSelectedClients(list.map(c => c.clientId)); // default: all selected
      })
      .catch(() => setClients([]))
      .finally(() => setClientsLoading(false));
  }, []);

  // Build query params
  const buildParams = useCallback(() => {
    const params = new URLSearchParams();
    if (selectedClients.length > 0) params.set('clients', selectedClients.join(','));
    params.set('startDate', startDate);
    params.set('endDate', endDate);
    params.set('reportType', reportType);
    params.set('marketplace', marketplace);
    return params;
  }, [selectedClients, startDate, endDate, reportType, marketplace]);

  // Run report
  async function runReport() {
    setLoading(true);
    setError(null);
    setHasRun(true);
    setSortKey(null);
    try {
      const params = buildParams();
      const res = await fetch(`/agency/reports/advertising?${params}`, { credentials: 'include' });
      if (!res.ok) {
        const text = await res.text();
        let msg;
        try { msg = JSON.parse(text).error; } catch { msg = `HTTP ${res.status}`; }
        throw new Error(msg);
      }
      const data = await res.json();
      setReportData(Array.isArray(data) ? data : data.rows || []);
    } catch (e) {
      setError(e.message || 'Failed to load report');
    } finally {
      setLoading(false);
    }
  }

  // Export CSV
  async function exportCsv() {
    setExporting(true);
    try {
      const params = buildParams();
      const res = await fetch('/agency/reports/export-csv', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(params.entries())),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `agency-report-${reportType}-${endDate}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert('CSV export failed: ' + (e.message || 'Unknown error'));
    } finally {
      setExporting(false);
    }
  }

  // Sorting
  function handleSort(key) {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  const cols = COLUMNS[reportType] || COLUMNS.summary;

  const sortedData = (() => {
    if (!reportData || !sortKey) return reportData;
    return [...reportData].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const an = Number(av);
      const bn = Number(bv);
      const numericSort = !isNaN(an) && !isNaN(bn);
      let cmp = numericSort
        ? an - bn
        : String(av ?? '').localeCompare(String(bv ?? ''));
      return sortDir === 'asc' ? cmp : -cmp;
    });
  })();

  return (
    <div className="space-y-4">
      {/* ── Header ── */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Agency Reports</h1>
        <p className="text-sm text-gray-500 mt-0.5">Multi-client advertising performance</p>
      </div>

      {/* ── Controls bar ── */}
      <div className="flex flex-wrap gap-3 items-end p-4 bg-white rounded-xl border border-gray-200">
        {/* Client selector */}
        <ClientSelector
          clients={clients}
          selected={selectedClients}
          onChange={setSelectedClients}
          loading={clientsLoading}
        />

        {/* Date range */}
        <div>
          <label className="block text-xs text-gray-500 mb-1 font-medium">Start Date</label>
          <input
            type="date"
            value={startDate}
            onChange={e => setStartDate(e.target.value)}
            max={endDate}
            className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-1 font-medium">End Date</label>
          <input
            type="date"
            value={endDate}
            onChange={e => setEndDate(e.target.value)}
            min={startDate}
            max={today()}
            className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Report type — segmented buttons */}
        <div>
          <label className="block text-xs text-gray-500 mb-1 font-medium">Report Type</label>
          <div className="flex rounded-lg border border-gray-200 overflow-hidden bg-white">
            {REPORT_TYPES.map(rt => (
              <button
                key={rt.value}
                type="button"
                onClick={() => setReportType(rt.value)}
                className={`px-3 py-2 text-sm font-medium transition-colors ${
                  reportType === rt.value
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                {rt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Marketplace */}
        <div>
          <label className="block text-xs text-gray-500 mb-1 font-medium">Marketplace</label>
          <select
            value={marketplace}
            onChange={e => setMarketplace(e.target.value)}
            className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All Marketplaces</option>
            <option value="US">🇺🇸 US</option>
            <option value="CA">🇨🇦 CA</option>
            <option value="UK">🇬🇧 UK</option>
            <option value="DE">🇩🇪 DE</option>
            <option value="FR">🇫🇷 FR</option>
            <option value="JP">🇯🇵 JP</option>
            <option value="AU">🇦🇺 AU</option>
          </select>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Action buttons */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={runReport}
            disabled={loading || selectedClients.length === 0}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-colors"
          >
            {loading ? 'Running…' : 'Run Report'}
          </button>

          <button
            type="button"
            onClick={exportCsv}
            disabled={exporting || !hasRun || !reportData || reportData.length === 0}
            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed text-gray-700 text-sm font-semibold rounded-lg transition-colors"
          >
            {exporting ? 'Exporting…' : '⬇ Export CSV'}
          </button>
        </div>
      </div>

      {/* ── Results table ── */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {/* Empty / not run yet */}
        {!hasRun && !loading && (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="text-4xl mb-3">📊</div>
            <p className="text-gray-500 text-sm">Run a report to see results</p>
          </div>
        )}

        {/* Error */}
        {hasRun && !loading && error && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="text-4xl mb-3">⚠️</div>
            <p className="text-red-600 text-sm font-medium">{error}</p>
            <p className="text-gray-400 text-xs mt-1">Check your connection and try again</p>
          </div>
        )}

        {/* Empty result */}
        {hasRun && !loading && !error && reportData && reportData.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="text-4xl mb-3">🔍</div>
            <p className="text-gray-500 text-sm">No data found for the selected filters</p>
          </div>
        )}

        {/* Table */}
        {(loading || (hasRun && !error && reportData && reportData.length > 0)) && (
          <div className="overflow-x-auto">
            <table className="table-auto w-full text-sm">
              <thead className="border-b border-gray-200 bg-gray-50">
                <tr>
                  {cols.map(col => (
                    <th
                      key={col.key}
                      onClick={() => !loading && handleSort(col.key)}
                      className={`px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap select-none ${!loading ? 'cursor-pointer hover:text-gray-700' : ''}`}
                    >
                      {col.label}
                      {!loading && <SortIcon direction={sortKey === col.key ? sortDir : null} />}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading
                  ? <SkeletonRows cols={cols.length} rows={8} />
                  : sortedData.map((row, i) => (
                      <tr key={i} className={`transition-colors ${rowClass(row)}`}>
                        {cols.map(col => (
                          <td key={col.key} className="px-4 py-3 text-gray-700 whitespace-nowrap">
                            {col.fmt(row[col.key])}
                          </td>
                        ))}
                      </tr>
                    ))
                }
              </tbody>
            </table>
          </div>
        )}

        {/* Row count footer */}
        {!loading && reportData && reportData.length > 0 && (
          <div className="px-4 py-2.5 border-t border-gray-100 text-xs text-gray-400">
            {reportData.length.toLocaleString()} row{reportData.length !== 1 ? 's' : ''}
          </div>
        )}
      </div>
    </div>
  );
}
