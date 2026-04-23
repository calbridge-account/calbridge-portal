import { createContext, useContext, useState, useEffect, useRef } from 'react';
import { useUser } from './UserContext';

const AdvertiserContext = createContext(null);

export function AdvertiserProvider({ children }) {
  const [advertisers, setAdvertisers] = useState([]);
  const [current, setCurrent] = useState(null);
  const [loading, setLoading] = useState(true);
  const hasFetched = useRef(false);

  // Get accountType from UserContext (AdvertiserProvider is inside UserProvider)
  const { user, ready } = useUser() || {};
  const isAgency = user?.accountType === 'agency' || user?.account_type === 'agency';

  useEffect(() => {
    // Wait until UserContext has resolved so isAgency is accurate
    if (!ready) return;
    // Only fetch once — don't re-run when isAgency changes after initial load
    // This prevents the URL param being stripped then the effect re-running without it
    if (hasFetched.current) return;
    hasFetched.current = true;

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
        // Ensure list is an array (backend always returns array)
        const safeList = Array.isArray(list) ? list : [];

        // Synthetic "All Brands" entry for agency accounts
        const allBrandsEntry = {
          advertiserId: 'all',
          advertiserName: 'All Brands',
          managerName: 'All Brands',
          isCurrent: false,
        };

        const fullList = isAgency ? [allBrandsEntry, ...safeList] : safeList;
        setAdvertisers(fullList);

        // Determine current selection
        let selected = null;

        // Agency with no specific brand requested → stay in agency home (All Brands)
        if (isAgency && !requestedId) {
          selected = allBrandsEntry;
        } else if (requestedId === 'all' && isAgency) {
          selected = allBrandsEntry;
        } else if (requestedId && requestedId !== 'all') {
          selected = safeList.find(a => a.advertiserId === requestedId) || null;
          // Fall back to All Brands if not found
          if (!selected && isAgency) selected = allBrandsEntry;
        }

        if (!selected) {
          // Non-agency: fall back to isCurrent from server, then first
          selected = safeList.find(a => a.isCurrent) || safeList[0] || null;
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
  }, [ready]); // depend on ready — fires once when UserContext resolves

  // isAgencyView = true when in agency-level view (no specific brand selected)
  const isAgencyView = !current || current?.advertiserId === 'all';

  return (
    <AdvertiserContext.Provider value={{ advertisers, current, setCurrent, loading, isAgency, isAgencyView }}>
      {children}
    </AdvertiserContext.Provider>
  );
}

export function useAdvertiser() {
  return useContext(AdvertiserContext);
}
