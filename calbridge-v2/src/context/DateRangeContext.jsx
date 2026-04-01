import { createContext, useContext, useState, useCallback } from 'react';

export const DATE_PRESETS = [
  { label: 'Today',          value: 'today' },
  { label: 'Yesterday',      value: 'yesterday' },
  { label: 'Last 7 days',    value: '7d' },
  { label: 'Last 14 days',   value: '14d' },
  { label: 'Last 30 days',   value: '30d' },
  { label: 'Month to date',  value: 'mtd' },
  { label: 'Quarter to date',value: 'qtd' },
  { label: 'Custom',         value: 'custom' },
];

const DateRangeContext = createContext(null);

export function DateRangeProvider({ children }) {
  const [range, setRange] = useState({ type: 'mtd' });

  const setPreset = useCallback((type) => {
    setRange({ type });
  }, []);

  const setCustom = useCallback((start, end) => {
    setRange({ type: 'custom', start, end });
  }, []);

  // Build query string for API calls
  const rangeParams = useCallback(() => {
    const { type, start, end } = range;
    if (type === 'custom' && start && end) return `range=custom&start=${start}&end=${end}`;
    return `range=${type}`;
  }, [range]);

  // Human-readable label for current range
  const rangeLabel = useCallback(() => {
    const preset = DATE_PRESETS.find(p => p.value === range.type);
    if (range.type === 'custom' && range.start) return `${range.start} → ${range.end}`;
    return preset?.label || range.type;
  }, [range]);

  return (
    <DateRangeContext.Provider value={{ range, setPreset, setCustom, rangeParams, rangeLabel }}>
      {children}
    </DateRangeContext.Provider>
  );
}

export function useDateRange() {
  const ctx = useContext(DateRangeContext);
  if (!ctx) throw new Error('useDateRange must be used within DateRangeProvider');
  return ctx;
}
