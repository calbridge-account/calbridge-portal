import { createContext, useContext, useState, useEffect } from 'react';

const MarketplaceContext = createContext(null);

export function MarketplaceProvider({ children }) {
  const [marketplaces, setMarketplaces] = useState([]);
  const [activeMarketplace, setActiveMarketplace] = useState('US');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/manager/active-advertiser/marketplaces', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data) {
          setMarketplaces(data.marketplaces ?? []);
          setActiveMarketplace(data.activeMarketplace ?? 'US');
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function switchMarketplace(marketplace) {
    await fetch('/manager/set-marketplace', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ marketplace }),
    });
    window.location.reload();
  }

  return (
    <MarketplaceContext.Provider value={{ marketplaces, activeMarketplace, loading, switchMarketplace }}>
      {children}
    </MarketplaceContext.Provider>
  );
}

export function useMarketplace() {
  return useContext(MarketplaceContext);
}
