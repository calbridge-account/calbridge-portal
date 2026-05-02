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
  // Amazon Ads data is keyed to Pacific time (PST/PDT).
  // Always compute dates in America/Los_Angeles so MTD/YTD/yesterday
  // match what's actually in the database regardless of the user's browser timezone.
  const toPacificDateStr = (d) =>
    d.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }); // en-CA gives YYYY-MM-DD

  const todayPST = toPacificDateStr(new Date());
  const [ty, tm, td] = todayPST.split('-').map(Number);

  // "Yesterday" in Pacific time
  const yesterdayDate = new Date(Date.UTC(ty, tm - 1, td) - 86400000);
  const yesterdayPST  = toPacificDateStr(yesterdayDate);
  const [yy, ym, yd] = yesterdayPST.split('-').map(Number);

  const toISO = (y, m, d) => `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;

  switch (type) {
    case '7d': {
      const s = new Date(Date.UTC(yy, ym - 1, yd) - 6 * 86400000);
      const [sy, sm, sd] = toPacificDateStr(s).split('-').map(Number);
      return { start: toISO(sy, sm, sd), end: yesterdayPST };
    }
    case '14d': {
      const s = new Date(Date.UTC(yy, ym - 1, yd) - 13 * 86400000);
      const [sy, sm, sd] = toPacificDateStr(s).split('-').map(Number);
      return { start: toISO(sy, sm, sd), end: yesterdayPST };
    }
    case 'mtd': {
      // If today is the 1st in PST, show just yesterday (prior month end)
      const startPST = td === 1 ? yesterdayPST : toISO(yy, ym, 1);
      return { start: startPST, end: yesterdayPST };
    }
    case 'ytd': {
      return { start: toISO(yy, 1, 1), end: yesterdayPST };
    }
    case 'custom':
      return { start: customStart, end: customEnd };
    default: {
      const startPST = td === 1 ? yesterdayPST : toISO(yy, ym, 1);
      return { start: startPST, end: yesterdayPST };
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
