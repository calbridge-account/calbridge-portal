/**
 * ExportMenu
 * A small dropdown button for exporting tables (.xlsx / .csv) or charts (.png).
 *
 * Props:
 *   onXlsx      — () => void   show for tables
 *   onCsv       — () => void   show for tables
 *   onPng       — () => void   show for charts
 *   label       — string       optional button label override
 *   className   — string       optional extra classes
 */
import { useState, useRef, useEffect } from 'react';

export default function ExportMenu({ onXlsx, onCsv, onPng, label = 'Export', className = '' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const hasTable = onXlsx || onCsv;
  const hasChart = !!onPng;

  return (
    <div ref={ref} className={`relative inline-block ${className}`}>
      <button
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:border-gray-300 hover:bg-gray-50 transition-colors"
        title="Export data"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
        {label}
        <svg className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-40 bg-white border border-gray-200 rounded-lg shadow-lg z-50 py-1">
          {hasTable && (
            <>
              <div className="px-3 py-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Table</div>
              {onXlsx && (
                <button
                  onClick={() => { onXlsx(); setOpen(false); }}
                  className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                >
                  <span className="text-green-600 font-bold text-[10px] leading-none px-1 py-0.5 bg-green-50 rounded border border-green-200">XLSX</span>
                  Excel (.xlsx)
                </button>
              )}
              {onCsv && (
                <button
                  onClick={() => { onCsv(); setOpen(false); }}
                  className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                >
                  <span className="text-blue-600 font-bold text-[10px] leading-none px-1 py-0.5 bg-blue-50 rounded border border-blue-200">CSV</span>
                  CSV (.csv)
                </button>
              )}
            </>
          )}
          {hasTable && hasChart && <div className="border-t border-gray-100 my-1" />}
          {hasChart && (
            <>
              <div className="px-3 py-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Chart</div>
              <button
                onClick={() => { onPng(); setOpen(false); }}
                className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 flex items-center gap-2"
              >
                <span className="text-orange-600 font-bold text-[10px] leading-none px-1 py-0.5 bg-orange-50 rounded border border-orange-200">PNG</span>
                Image (.png)
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
