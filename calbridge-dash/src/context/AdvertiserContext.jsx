import { createContext, useContext, useState, useEffect } from 'react';

const AdvertiserContext = createContext(null);

export function AdvertiserProvider({ children }) {
  const [advertisers, setAdvertisers] = useState([]);
  const [current, setCurrent] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check if a specific advertiserId was requested via query param (from selector switch)
    const params = new URLSearchParams(window.location.search);
    const requestedId = params.get('advertiserId');

    // Build the list URL — pass advertiserId as hint so server can update session
    const listUrl = requestedId
      ? `/manager/advertisers/list?advertiserId=${encodeURIComponent(requestedId)}`
      : '/manager/advertisers/list';

    fetch(listUrl, { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(list => {
        setAdvertisers(list);

        // Prefer the explicitly-requested advertiser if present in the list;
        // otherwise use whichever the server marked as isCurrent; fallback to first.
        let selected = null;
        if (requestedId) {
          selected = list.find(a => a.advertiserId === requestedId) || null;
        }
        if (!selected) {
          selected = list.find(a => a.isCurrent) || list[0] || null;
        }
        setCurrent(selected);

        // Strip ?advertiserId from URL bar without triggering a reload
        if (requestedId && window.history.replaceState) {
          const clean = new URL(window.location.href);
          clean.searchParams.delete('advertiserId');
          window.history.replaceState({}, '', clean.toString());
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <AdvertiserContext.Provider value={{ advertisers, current, setCurrent, loading }}>
      {children}
    </AdvertiserContext.Provider>
  );
}

export function useAdvertiser() {
  return useContext(AdvertiserContext);
}
