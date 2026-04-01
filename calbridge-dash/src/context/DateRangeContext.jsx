import { createContext, useContext, useState } from 'react';

const DateRangeContext = createContext(null);

export const PRESETS = [
  { label: '4 Weeks',  value: '4w'  },
  { label: '8 Weeks',  value: '8w'  },
  { label: '12 Weeks', value: '12w' },
  { label: '26 Weeks', value: '26w' },
  { label: '52 Weeks', value: '52w' },
  { label: 'YTD',      value: 'ytd' },
  { label: 'Custom',   value: 'custom' },
];

export function DateRangeProvider({ children }) {
  const [range, setRange] = useState({ type: '12w' });
  return (
    <DateRangeContext.Provider value={{ range, setRange }}>
      {children}
    </DateRangeContext.Provider>
  );
}

export function useDateRange() {
  return useContext(DateRangeContext);
}
