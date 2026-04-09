import { createContext, useContext, useState, useEffect } from 'react';

const AdvertiserContext = createContext(null);

export function AdvertiserProvider({ children }) {
  const [advertisers, setAdvertisers] = useState([]);
  const [current, setCurrent] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/manager/advertisers/list', { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(list => {
        setAdvertisers(list);
        setCurrent(list.find(a => a.isCurrent) || list[0] || null);
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
