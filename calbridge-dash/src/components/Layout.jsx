import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useUser } from '../context/UserContext';

const NAV_ITEMS = [
  { path: '/',            label: 'Overview',           emoji: '📊', minRole: 'viewer'  },
  { path: '/vendor',      label: 'Vendor Performance', emoji: '📦', minRole: 'viewer'  },
  { path: '/advertising', label: 'Advertising',        emoji: '📢', minRole: 'viewer'  },
  { path: '/forecasting', label: 'Forecasting',        emoji: '📈', minRole: 'analyst' },
  { path: '/cogs',        label: 'COGS & Margins',     emoji: '💰', minRole: 'analyst' },
  { path: '/account',     label: 'Account',            emoji: '⚙️',  minRole: 'viewer'  },
];

function Sidebar({ collapsed, onToggle, hasRole = () => true }) {
  const location = useLocation();

  return (
    <aside
      className={`
        fixed top-0 left-0 h-full flex flex-col transition-all duration-300 z-50
        ${collapsed ? 'w-16' : 'w-60'}
      `}
      style={{ background: '#1e3a1a' }}
    >
      {/* Logo area — white background like portal */}
      <div
        className="flex items-center justify-center border-b"
        style={{ borderColor: 'rgba(0,0,0,0.08)', background: '#ffffff', minHeight: '72px', padding: '12px 16px' }}
      >
        {!collapsed ? (
          <div className="flex items-center justify-between w-full">
            <img src="/calbridge-logo.png" alt="Calbridge" className="h-10 object-contain" />
            <button
              onClick={onToggle}
              className="ml-2 p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 flex-shrink-0"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
              </svg>
            </button>
          </div>
        ) : (
          <button onClick={onToggle} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
            </svg>
          </button>
        )}
      </div>

      {/* Client badge */}
      {!collapsed && (
        <div className="px-4 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <div className="text-xs font-medium uppercase tracking-wider mb-1" style={{ color: 'rgba(255,255,255,0.45)' }}>
            Client
          </div>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded flex items-center justify-center text-xs font-bold"
              style={{ background: 'rgba(255,255,255,0.15)', color: '#fff' }}>
              CP
            </div>
            <span className="text-sm font-medium text-white">CyberPower</span>
          </div>
        </div>
      )}

      {/* Nav */}
      <nav className="flex-1 px-2 py-4 space-y-0.5">
        {NAV_ITEMS.filter(item => hasRole(item.minRole)).map((item) => {
          const isActive = item.path === '/'
            ? location.pathname === '/'
            : location.pathname.startsWith(item.path);

          return (
            <NavLink
              key={item.path}
              to={item.path}
              title={collapsed ? item.label : undefined}
              className={`
                flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium
                transition-colors duration-150
                ${collapsed ? 'justify-center' : ''}
              `}
              style={{
                color: isActive ? '#ffffff' : 'rgba(255,255,255,0.65)',
                background: isActive ? 'rgba(255,255,255,0.12)' : 'transparent',
              }}
              onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'rgba(255,255,255,0.07)'; }}
              onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
            >
              <span className="text-base leading-none flex-shrink-0">{item.emoji}</span>
              {!collapsed && <span>{item.label}</span>}
            </NavLink>
          );
        })}
      </nav>

      {/* Sign out footer */}
      {!collapsed && (
        <div className="px-4 py-3" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          <a
            href="/auth/logout"
            className="flex items-center gap-2 text-sm py-1"
            style={{ color: 'rgba(255,255,255,0.45)' }}
          >
            <span>🚪</span> Sign Out
          </a>
        </div>
      )}
    </aside>
  );
}

export default function Layout({ children }) {
  const [collapsed, setCollapsed] = useState(false);
  const { hasRole } = useUser() || { hasRole: () => true };

  return (
    <div className="min-h-screen" style={{ background: '#f9fafb' }}>
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed(c => !c)} hasRole={hasRole} />
      <main className={`transition-all duration-300 ${collapsed ? 'ml-16' : 'ml-60'}`}>
        <div className="max-w-screen-2xl mx-auto p-6">
          {children}
        </div>
      </main>
    </div>
  );
}
