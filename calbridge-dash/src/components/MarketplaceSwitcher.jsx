/**
 * MarketplaceSwitcher
 *
 * Renders a compact dropdown to switch between marketplaces.
 * Only shows when the client has more than one marketplace.
 * Reads from / writes to MarketplaceContext.
 */
import { useMarketplace } from '../context/MarketplaceContext';

const MARKETPLACE_LABELS = {
  US: '🇺🇸 US',
  CA: '🇨🇦 CA',
  UK: '🇬🇧 UK',
  DE: '🇩🇪 DE',
  FR: '🇫🇷 FR',
  IT: '🇮🇹 IT',
  ES: '🇪🇸 ES',
  JP: '🇯🇵 JP',
  AU: '🇦🇺 AU',
  MX: '🇲🇽 MX',
  IN: '🇮🇳 IN',
  BR: '🇧🇷 BR',
  all: '🌎 All',
};

export default function MarketplaceSwitcher({ showAll = false }) {
  const ctx = useMarketplace();
  if (!ctx || ctx.loading) return null;

  const { marketplaces, activeMarketplace, switchMarketplace } = ctx;

  // Only render if there's more than one marketplace to switch between
  if (!marketplaces || marketplaces.length <= 1) return null;

  const options = showAll
    ? ['all', ...marketplaces]
    : marketplaces;

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-gray-400 font-medium hidden sm:inline">Marketplace</span>
      <div className="flex rounded-lg border border-gray-200 overflow-hidden bg-white shadow-sm">
        {options.map(mp => {
          const isActive = activeMarketplace === mp;
          return (
            <button
              key={mp}
              onClick={() => !isActive && switchMarketplace(mp)}
              className={`
                px-3 py-1.5 text-xs font-semibold transition-colors
                ${isActive
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-600 hover:bg-gray-50'}
                ${mp !== options[options.length - 1] ? 'border-r border-gray-200' : ''}
              `}
            >
              {MARKETPLACE_LABELS[mp] ?? mp}
            </button>
          );
        })}
      </div>
    </div>
  );
}
