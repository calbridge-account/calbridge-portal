import { useLocation, Link } from 'react-router-dom';

const SUB_TABS = [
  { path: '/advertising',           label: 'Overview',  exact: true  },
  { path: '/advertising/campaigns', label: 'Campaigns', exact: false },
  { path: '/advertising/keywords',  label: 'Keywords',  exact: false },
  { path: '/advertising/products',  label: 'Products',  exact: false },
  { path: '/advertising/targeting', label: 'Targeting', exact: false },
  { path: '/advertising/dsp',       label: 'DSP',       exact: false },
];

export default function AdvertisingSubNav() {
  const { pathname } = useLocation();

  function isActive(tab) {
    if (tab.exact) return pathname === '/advertising' || pathname === '/advertising/';
    return pathname === tab.path || pathname.startsWith(tab.path + '/');
  }

  return (
    <div className="flex gap-0 mb-6 border-b border-gray-200 overflow-x-auto">
      {SUB_TABS.map(tab => (
        <Link
          key={tab.path}
          to={tab.path}
          className={`px-4 py-2 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
            isActive(tab)
              ? 'border-green-700 text-green-700'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
