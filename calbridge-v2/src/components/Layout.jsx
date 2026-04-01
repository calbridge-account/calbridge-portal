import { useState, useEffect } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import DateRangePicker from './DateRangePicker';

const NAV_ITEMS = [
  { icon: '📊', label: 'Overview',      path: '/',             exact: true },
  { icon: '📦', label: 'Retail',        path: '/retail' },
  { icon: '📢', label: 'Advertising',   path: '/advertising' },
  { icon: '💡', label: 'Opportunities', path: '/opportunities' },
  { icon: '⚡', label: 'Actions',       path: '/actions' },
  { icon: '🔍', label: 'Data Explorer', path: '/data' },
];

const V2_ITEMS = [
  { icon: '🧪', label: 'Experiments', path: '/experiments' },
  { icon: '📈', label: 'Forecasting', path: '/forecasting' },
  { icon: '📋', label: 'Reports',     path: '/reports' },
  { icon: '⚙️',  label: 'Settings',   path: '/settings' },
];

const PAGE_TITLES = {
  '/':              'Overview',
  '/retail':        'Retail',
  '/advertising':   'Advertising',
  '/opportunities': 'Opportunities',
  '/actions':       'Actions',
  '/data':          'Data Explorer',
  '/experiments':   'Experiments',
  '/forecasting':   'Forecasting',
  '/reports':       'Reports',
  '/settings':      'Settings',
};

export default function Layout({ children }) {
  const [collapsed, setCollapsed] = useState(false);
  const [logoUrl, setLogoUrl] = useState('/calbridge-logo.png');
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    fetch('/account/profile', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.logoUrl) setLogoUrl(data.logoUrl);
      })
      .catch(() => {});
  }, []);

  const pageTitle = PAGE_TITLES[location.pathname] || 'Calbridge';

  function handleSignOut() {
    fetch('/auth/logout', { method: 'POST', credentials: 'include' })
      .finally(() => { window.location.href = '/'; });
  }

  const navLinkClass = (path, exact) => ({ isActive }) =>
    `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
      isActive
        ? 'bg-brand text-white'
        : 'text-gray-600 hover:bg-brand-light hover:text-brand'
    }`;

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <aside
        className={`flex flex-col bg-white border-r border-gray-200 transition-all duration-200 ${
          collapsed ? 'w-16' : 'w-60'
        }`}
      >
        {/* Logo */}
        <div className="flex items-center justify-between h-16 px-3 border-b border-gray-200">
          {!collapsed && (
            <img
              src={logoUrl}
              alt="Calbridge"
              className="h-8 object-contain"
              onError={e => { e.target.src = '/calbridge-logo.png'; }}
            />
          )}
          <button
            onClick={() => setCollapsed(c => !c)}
            className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors ml-auto"
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            )}
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-4 px-2 space-y-1">
          {NAV_ITEMS.map(item => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.exact}
              className={navLinkClass(item.path, item.exact)}
              title={collapsed ? item.label : undefined}
            >
              <span className="text-base flex-shrink-0">{item.icon}</span>
              {!collapsed && <span>{item.label}</span>}
            </NavLink>
          ))}

          <div className="pt-4 pb-1">
            {!collapsed && (
              <p className="px-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                Coming Soon
              </p>
            )}
          </div>

          {V2_ITEMS.map(item => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors opacity-60 ${
                  isActive
                    ? 'bg-gray-100 text-gray-700'
                    : 'text-gray-400 hover:bg-gray-50 hover:text-gray-500'
                }`
              }
              title={collapsed ? item.label : undefined}
            >
              <span className="text-base flex-shrink-0">{item.icon}</span>
              {!collapsed && (
                <>
                  <span className="flex-1">{item.label}</span>
                  <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded font-semibold">
                    V2
                  </span>
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className="p-3 border-t border-gray-100">
          {!collapsed && (
            <p className="text-xs text-gray-400 text-center">Calbridge v2</p>
          )}
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <header className="flex items-center justify-between h-16 px-6 bg-white border-b border-gray-200 gap-4">
          <h1 className="text-lg font-semibold text-gray-900 flex-shrink-0">{pageTitle}</h1>
          <div className="flex-1 overflow-x-auto">
            <DateRangePicker />
          </div>
          <button
            onClick={handleSignOut}
            className="flex-shrink-0 text-sm text-gray-500 hover:text-gray-700 transition-colors"
          >
            Sign Out
          </button>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
