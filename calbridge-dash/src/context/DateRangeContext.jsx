import { createContext, useContext, useState, useEffect } from 'react';

const DateRangeContext = createContext(null);

export const PRESETS = [
  { label: '7 Days',   value: '7d'    },
  { label: '14 Days',  value: '14d'   },
  { label: 'MTD',      value: 'mtd'   },
  { label: 'YTD',      value: 'ytd'   },
  { label: 'Custom',   value: 'custom' },
];

const VALID_TYPES = new Set(PRESETS.map(p => p.value));

/**
 * Returns { start, end } as ISO date strings (YYYY-MM-DD) for a given range type.
 * For 'custom', pass the explicit start/end values.
 */
export function getDateRange(type, customStart, customEnd) {
  const today = new Date();
  const toISO = (d) => d.toISOString().slice(0, 10);

  switch (type) {
    case '7d': {
      const start = new Date(today);
      start.setDate(today.getDate() - 6);
      return { start: toISO(start), end: toISO(today) };
    }
    case '14d': {
      const start = new Date(today);
      start.setDate(today.getDate() - 13);
      return { start: toISO(start), end: toISO(today) };
    }
    case 'mtd': {
      const start = new Date(today.getFullYear(), today.getMonth(), 1);
      return { start: toISO(start), end: toISO(today) };
    }
    case 'ytd': {
      const start = new Date(today.getFullYear(), 0, 1);
      return { start: toISO(start), end: toISO(today) };
    }
    case 'custom':
      return { start: customStart, end: customEnd };
    default: {
      // Fallback: MTD
      const start = new Date(today.getFullYear(), today.getMonth(), 1);
      return { start: toISO(start), end: toISO(today) };
    }
  }
}

export function DateRangeProvider({ children }) {
  // Read initial range from URL ?range= param, fall back to mtd
  function getInitialRange() {
    try {
      const params = new URLSearchParams(window.location.search);
      const r = params.get('range');
      if (r && VALID_TYPES.has(r)) {
        if (r === 'custom') {
          const start = params.get('start');
          const end = params.get('end');
          if (start && end) return { type: 'custom', start, end };
        } else {
          return { type: r };
        }
      }
    } catch (_) { /* SSR / test safety */ }
    return { type: 'mtd' };
  }

  const [range, setRange] = useState(getInitialRange);

  // Sync range → URL on every change (no page reload)
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      params.set('range', range.type);
      if (range.type === 'custom' && range.start && range.end) {
        params.set('start', range.start);
        params.set('end', range.end);
      } else {
        params.delete('start');
        params.delete('end');
      }
      window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
    } catch (_) { /* SSR / test safety */ }
  }, [range]);

  return (
    <DateRangeContext.Provider value={{ range, setRange }}>
      {children}
    </DateRangeContext.Provider>
  );
}

export function useDateRange() {
  return useContext(DateRangeContext);
}
