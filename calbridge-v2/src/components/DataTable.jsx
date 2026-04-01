import { useState, useMemo } from 'react';
import { fmtCurrency, fmtPct, fmtRoas, fmtCompact, acosColor } from '../utils/format';

function formatCell(value, format) {
  switch (format) {
    case 'currency':  return { text: fmtCurrency(value), cls: '' };
    case 'percent':   return { text: fmtPct(value), cls: '' };
    case 'acos':      return { text: fmtPct(value), cls: acosColor(value) };
    case 'roas':      return { text: fmtRoas(value), cls: '' };
    case 'compact':   return { text: fmtCompact(value), cls: '' };
    default:          return { text: value ?? '—', cls: '' };
  }
}

const SKELETON_ROWS = 8;

function SkeletonRows({ colCount }) {
  return Array.from({ length: SKELETON_ROWS }).map((_, i) => (
    <tr key={i} className="border-b border-gray-100">
      {Array.from({ length: colCount }).map((_, j) => (
        <td key={j} className="px-4 py-3">
          <div className="h-4 bg-gray-200 animate-pulse rounded" style={{ width: `${60 + Math.random() * 30}%` }} />
        </td>
      ))}
    </tr>
  ));
}

export default function DataTable({
  columns,
  data = [],
  pageSize = 25,
  searchable = false,
  searchPlaceholder = 'Search...',
  searchKey,
  loading = false,
  emptyMessage = 'No data found for this date range.',
  extraControls,
}) {
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState('desc');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');

  function handleSort(key) {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
    setPage(1);
  }

  const filtered = useMemo(() => {
    let rows = [...data];
    if (searchable && search && searchKey) {
      const q = search.toLowerCase();
      rows = rows.filter(r => String(r[searchKey] ?? '').toLowerCase().includes(q));
    }
    return rows;
  }, [data, search, searchable, searchKey]);

  const sorted = useMemo(() => {
    if (!sortKey) return filtered;
    return [...filtered].sort((a, b) => {
      const av = a[sortKey] ?? (typeof a[sortKey] === 'number' ? 0 : '');
      const bv = b[sortKey] ?? (typeof b[sortKey] === 'number' ? 0 : '');
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filtered, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageData = sorted.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  function exportCSV() {
    const headers = columns.map(c => c.label).join(',');
    const rows = sorted.map(row =>
      columns.map(c => {
        const v = row[c.key];
        return typeof v === 'string' && v.includes(',') ? `"${v}"` : (v ?? '');
      }).join(',')
    );
    const csv = [headers, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'export.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      {/* Controls row */}
      <div className="flex flex-wrap items-center gap-3 mb-3">
        {searchable && (
          <input
            type="text"
            placeholder={searchPlaceholder}
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-56 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        )}
        {extraControls}
        <div className="ml-auto">
          <button
            onClick={exportCSV}
            className="text-sm text-gray-600 border border-gray-300 rounded-md px-3 py-1.5 hover:bg-gray-50 transition"
          >
            Export CSV
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-sm text-left">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              {columns.map(col => (
                <th
                  key={col.key}
                  className={`px-4 py-3 font-semibold text-gray-600 whitespace-nowrap ${col.sortable !== false ? 'cursor-pointer select-none hover:bg-gray-100' : ''}`}
                  onClick={() => col.sortable !== false && handleSort(col.key)}
                >
                  <span className="flex items-center gap-1">
                    {col.label}
                    {col.sortable !== false && sortKey === col.key && (
                      <span className="text-blue-500">{sortDir === 'asc' ? '↑' : '↓'}</span>
                    )}
                    {col.sortable !== false && sortKey !== col.key && (
                      <span className="text-gray-300">↕</span>
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <SkeletonRows colCount={columns.length} />
            ) : pageData.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-10 text-center text-gray-400">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              pageData.map((row, i) => (
                <tr key={i} className="border-b border-gray-100 hover:bg-gray-50 transition">
                  {columns.map(col => {
                    if (col.render) {
                      return (
                        <td key={col.key} className="px-4 py-3">
                          {col.render(row[col.key], row)}
                        </td>
                      );
                    }
                    const { text, cls } = formatCell(row[col.key], col.format);
                    return (
                      <td key={col.key} className={`px-4 py-3 ${cls}`}>
                        {col.truncate ? (
                          <span className="block max-w-xs truncate" title={row[col.key]}>
                            {text}
                          </span>
                        ) : text}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {!loading && sorted.length > pageSize && (
        <div className="flex items-center justify-between mt-3 text-sm text-gray-600">
          <span>
            Showing {((currentPage - 1) * pageSize) + 1}–{Math.min(currentPage * pageSize, sorted.length)} of {sorted.length}
          </span>
          <div className="flex gap-2">
            <button
              disabled={currentPage <= 1}
              onClick={() => setPage(p => p - 1)}
              className="px-3 py-1 border border-gray-300 rounded disabled:opacity-40 hover:bg-gray-50"
            >
              ← Prev
            </button>
            <span className="px-2 py-1">Page {currentPage} of {totalPages}</span>
            <button
              disabled={currentPage >= totalPages}
              onClick={() => setPage(p => p + 1)}
              className="px-3 py-1 border border-gray-300 rounded disabled:opacity-40 hover:bg-gray-50"
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
