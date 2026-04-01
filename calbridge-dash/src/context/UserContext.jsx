import { createContext, useContext, useState, useEffect } from 'react';

const UserContext = createContext(null);

export function UserProvider({ children }) {
  const [user, setUser]   = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    fetch('/auth/me', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        setUser(data?.client || null);
        setReady(true);
      })
      .catch(() => setReady(true));
  }, []);

  // Role level helper
  const LEVELS = { viewer: 1, analyst: 2, manager: 3, owner: 4 };
  function hasRole(minRole) {
    const level = LEVELS[user?.role] ?? 4; // default owner for existing sessions
    const min   = LEVELS[minRole]    ?? 1;
    return level >= min;
  }

  return (
    <UserContext.Provider value={{ user, ready, hasRole, setUser }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  return useContext(UserContext);
}
