import { useLocation, Link, useNavigate } from 'react-router-dom';
import { useUser } from '../../context/UserContext';

const SUB_TABS = [
  { path: '/advertising',                label: 'Overview',         exact: true  },
  { path: '/advertising/campaigns',      label: 'Campaigns',        exact: false },
  { path: '/advertising/keywords',       label: 'Keywords',         exact: false },
  { path: '/advertising/products',       label: 'Products',         exact: false },
  { path: '/advertising/targeting',      label: 'Targeting',        exact: false },
  { path: '/advertising/dsp',            label: 'DSP',              exact: false },
  { path: '/advertising/expansion',      label: 'Expansion 🌱',     exact: false },
];

export default function AdvertisingSubNav() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { hasRole } = useUser() || { hasRole: () => false };

  function isActive(tab) {
    if (tab.exact) return pathname === '/advertising' || pathname === '/advertising/';
    return pathname === tab.path || pathname.startsWith(tab.path + '/');
  }

  const isCreatePage = pathname === '/advertising/campaigns/create' || pathname.startsWith('/advertising/campaigns/create/');

  return (
    <div className="flex items-center gap-0 mb-6 border-b border-gray-200 overflow-x-auto">
      {SUB_TABS.map(tab => (
        <Link
          key={tab.path}
          to={tab.path}
          className={`px-4 py-2 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
            isActive(tab) && !isCreatePage
              ? 'border-green-700 text-green-700'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
          }`}
        >
          {tab.label}
        </Link>
      ))}
      {/* Create Campaign button — managers and above only */}
      {hasRole('manager') && (
        <div className="ml-auto pb-0.5 flex-shrink-0">
          <button
            onClick={() => navigate('/advertising/campaigns/create')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${
              isCreatePage
                ? 'bg-green-700 text-white border-green-700'
                : 'bg-white text-green-700 border-green-600 hover:bg-green-50'
            }`}
          >
            + Create Campaign
          </button>
        </div>
      )}
    </div>
  );
}
