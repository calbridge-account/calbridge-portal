import { useState, useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useUser } from '../context/UserContext';
import DateRangePicker from './DateRangePicker';

// ─── Nav structure ────────────────────────────────────────────────────────────

const NAV = [
  {
    group: null,
    items: [
      { path: '/', label: 'Overview', emoji: '📊', minRole: 'viewer' },
    ],
  },
  {
    group: 'Retail',
    items: [
      { path: '/vendor',      label: 'Vendor Performance', emoji: '📦', minRole: 'viewer'  },
      { path: '/forecasting', label: 'Forecasting',        emoji: '📈', minRole: 'analyst' },
      { path: '/cogs',        label: 'COGS & Margins',     emoji: '💰', minRole: 'analyst' },
    ],
  },
  {
    group: 'Advertising',
    items: [
      { path: '/advertising', label: 'Performance',   emoji: '📢', minRole: 'viewer'  },
      { path: '/pacing',      label: 'Budget Pacing', emoji: '🎯', minRole: 'analyst' },
    ],
  },
  {
    group: 'Settings',
    items: [
      { path: '/account', label: 'Account', emoji: '⚙️', minRole: 'viewer' },
    ],
  },
];

// Flat list for page title lookups
const ALL_NAV_ITEMS = NAV.flatMap(s => s.items);

// ─── Nav config hook ─────────────────────────────────────────────────────────

function useNavConfig() {
  const [navConfig, setNavConfig] = useState({});

  useEffect(() => {
    let cancelled = false;
    fetch('/nav-config', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!cancelled && data?.config) setNavConfig(data.config);
      })
      .catch(() => {}); // silently fall back to all-visible
    return () => { cancelled = true; };
  }, []);

  return navConfig;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getInitials(name = '') {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0].toUpperCase())
    .join('');
}

function usePageTitle() {
  const location = useLocation();
  const match = ALL_NAV_ITEMS.find(item =>
    item.path === '/'
      ? location.pathname === '/'
      : location.pathname.startsWith(item.path)
  );
  return match?.label ?? 'Dashboard';
}

// ─── Sidebar ─────────────────────────────────────────────────────────────────

function Sidebar({ collapsed, onToggle, hasRole, user, navConfig }) {
  const location = useLocation();
  const clientName = user?.companyName || user?.clientName || user?.name || 'Client';
  const logoUrl = user?.logoUrl || null;
  const initials = getInitials(clientName);

  return (
    <aside
      className={`
        fixed top-0 left-0 h-full flex flex-col z-50
        bg-white border-r border-gray-200
        transition-all duration-300
        ${collapsed ? 'w-16' : 'w-56'}
      `}
    >
      {/* ── Logo area ── */}
      <div className="flex items-center h-16 px-3 border-b border-gray-200 flex-shrink-0">
        {!collapsed ? (
          <>
            <img
              src={logoUrl || '/calbridge-logo.png'}
              onError={e => { e.target.src = '/calbridge-logo.png'; }}
              alt="Calbridge"
              className="h-8 object-contain flex-1 min-w-0"
            />
            <button
              onClick={onToggle}
              title="Collapse sidebar"
              className="ml-2 p-1.5 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 flex-shrink-0 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
              </svg>
            </button>
          </>
        ) : (
          <button
            onClick={onToggle}
            title="Expand sidebar"
            className="mx-auto p-1.5 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M13 5l7 7-7 7M5 5l7 7-7 7" />
            </svg>
          </button>
        )}
      </div>

      {/* ── Client badge ── */}
      {!collapsed && (
        <div className="px-3 py-3 bg-gray-50 border-b border-gray-200 flex-shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-green-700 flex items-center justify-center flex-shrink-0">
              <span className="text-xs font-bold text-white leading-none">{initials}</span>
            </div>
            <div className="min-w-0">
              <div className="text-xs text-gray-400 leading-tight">Client</div>
              <div className="text-sm font-medium text-gray-700 truncate leading-tight">{clientName}</div>
            </div>
          </div>
        </div>
      )}

      {/* ── Nav ── */}
      <nav className="flex-1 overflow-y-auto py-2">
        {NAV.map((section, si) => {
          // Filter items by role
          const visibleItems = section.items.filter(item => hasRole(item.minRole));
          if (visibleItems.length === 0) return null;

          return (
            <div key={si} className="mb-1">
              {/* Group label */}
              {section.group && !collapsed && (
                <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-3 py-2 mt-1">
                  {section.group}
                </div>
              )}

              {/* Items */}
              {visibleItems.map(item => {
                const visibility = navConfig?.[item.path] ?? 'visible';
                if (visibility === 'hidden') return null;

                const isGrayed = visibility === 'grayed';
                const isActive = item.path === '/'
                  ? location.pathname === '/'
                  : location.pathname.startsWith(item.path);

                if (isGrayed) {
                  return (
                    <div
                      key={item.path}
                      title={collapsed ? `${item.label} (coming soon)` : 'Coming soon'}
                      className={`
                        flex items-center gap-2.5 py-2 text-sm font-medium
                        border-l-2 border-transparent
                        opacity-40 pointer-events-none cursor-not-allowed select-none
                        ${collapsed ? 'px-0 justify-center' : 'pr-3 pl-2.5'}
                        text-gray-600
                      `}
                    >
                      <span className="text-base leading-none flex-shrink-0 ml-1">{item.emoji}</span>
                      {!collapsed && (
                        <span className="flex items-center gap-1">
                          {item.label}
                          <span className="text-xs">🔒</span>
                        </span>
                      )}
                    </div>
                  );
                }

                return (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    title={collapsed ? item.label : undefined}
                    className={`
                      flex items-center gap-2.5 py-2 text-sm font-medium
                      transition-colors duration-150
                      border-l-2
                      ${collapsed ? 'px-0 justify-center' : 'pr-3 pl-2.5'}
                      ${isActive
                        ? 'border-green-700 bg-green-50 text-green-800'
                        : 'border-transparent text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                      }
                    `}
                  >
                    <span className="text-base leading-none flex-shrink-0 ml-1">{item.emoji}</span>
                    {!collapsed && <span>{item.label}</span>}
                  </NavLink>
                );
              })}
            </div>
          );
        })}
      </nav>

      {/* ── Sign out ── */}
      <div className="flex-shrink-0 border-t border-gray-200">
        <a
          href="/auth/logout"
          title={collapsed ? 'Sign Out' : undefined}
          className={`
            flex items-center gap-2 px-3 py-3 text-sm text-gray-500
            hover:bg-gray-50 hover:text-gray-700 transition-colors
            ${collapsed ? 'justify-center' : ''}
          `}
        >
          <span className="text-base leading-none">🚪</span>
          {!collapsed && <span>Sign Out</span>}
        </a>
      </div>
    </aside>
  );
}

// ─── Top Bar ─────────────────────────────────────────────────────────────────

function TopBar() {
  const pageTitle = usePageTitle();

  return (
    <header className="h-14 bg-white border-b border-gray-200 shadow-sm flex items-center px-6 gap-4">
      <h1 className="text-base font-semibold text-gray-800 flex-1 truncate">
        {pageTitle}
      </h1>
      <div className="flex-shrink-0">
        <DateRangePicker />
      </div>
    </header>
  );
}

// ─── Layout ──────────────────────────────────────────────────────────────────

export default function Layout({ children }) {
  const [collapsed, setCollapsed] = useState(false);
  const { hasRole, user } = useUser() || { hasRole: () => true, user: null };
  const navConfig = useNavConfig();

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar
        collapsed={collapsed}
        onToggle={() => setCollapsed(c => !c)}
        hasRole={hasRole}
        user={user}
        navConfig={navConfig}
      />

      {/* Main area — offset by sidebar width */}
      <div className={`transition-all duration-300 flex flex-col min-h-screen ${collapsed ? 'ml-16' : 'ml-56'}`}>
        <TopBar />
        <main className="flex-1">
          <div className="max-w-screen-2xl mx-auto p-6">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
