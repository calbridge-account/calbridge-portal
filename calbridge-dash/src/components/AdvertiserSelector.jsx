import { useState, useRef, useEffect } from 'react';
import { useAdvertiser } from '../context/AdvertiserContext';
import { useMarketplace } from '../context/MarketplaceContext';

// Flag emoji map for known marketplaces
const MARKETPLACE_FLAGS = {
  US: '🇺🇸',
  CA: '🇨🇦',
  UK: '🇬🇧',
  GB: '🇬🇧',
  DE: '🇩🇪',
  FR: '🇫🇷',
  IT: '🇮🇹',
  ES: '🇪🇸',
  JP: '🇯🇵',
  AU: '🇦🇺',
  IN: '🇮🇳',
  MX: '🇲🇽',
  BR: '🇧🇷',
};

function MarketplaceSelector() {
  const { marketplaces, activeMarketplace, loading, switchMarketplace } = useMarketplace() ?? {};

  // Hidden when 0 or 1 marketplace (all clients are US-only currently)
  if (loading || !marketplaces || marketplaces.length <= 1) return null;

  function handleChange(e) {
    const val = e.target.value;
    if (val !== activeMarketplace) {
      switchMarketplace(val);
    }
  }

  return (
    <div className="flex items-center gap-1 text-sm">
      <select
        value={activeMarketplace}
        onChange={handleChange}
        className="text-xs font-medium bg-gray-100 text-gray-600 border border-gray-200 rounded px-1.5 py-0.5 cursor-pointer hover:bg-gray-200 focus:outline-none focus:ring-1 focus:ring-green-600 transition-colors"
        aria-label="Select marketplace"
      >
        <option value="all">🌐 All</option>
        {marketplaces.map(m => (
          <option key={m} value={m}>
            {(MARKETPLACE_FLAGS[m] ?? '🏳️') + ' ' + m}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * AdvertiserSelector
 *
 * Shows the current advertiser in the top bar.
 *
 * - 1 advertiser: static label "Account: {managerName} · {marketplace}"
 * - Multiple advertisers: grouped dropdown by manager, with ✓ on current selection
 *
 * On selection: navigates to current page with ?advertiserId=xxx so the server
 * can update the session's active advertiser. Phase 3D will layer in full
 * context-refresh without a page reload.
 */
export default function AdvertiserSelector() {
  const ctx = useAdvertiser();
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  // Still loading or no context — render nothing (avoids flash)
  if (!ctx || ctx.loading) return null;

  // Render the geo selector after the advertiser label

  // No advertisers at all — nothing to show
  if (!ctx.advertisers || ctx.advertisers.length === 0) return null;

  const { advertisers, current } = ctx;

  // ── Single advertiser: static label ──────────────────────────────────────
  if (advertisers.length === 1) {
    const a = current ?? advertisers[0];
    return (
      <div className="flex items-center gap-1.5 text-sm text-gray-600">
        <span className="text-xs text-gray-400">Account:</span>
        <span className="font-medium text-gray-700">{a.managerName ?? a.advertiserName}</span>
        {a.marketplace && (
          <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">
            {a.marketplace}
          </span>
        )}
        <MarketplaceSelector />
      </div>
    );
  }

  // ── Multiple advertisers: grouped dropdown ────────────────────────────────

  // Group advertisers by managerName (preserve insertion order)
  const groups = [];
  const groupMap = {};
  for (const a of advertisers) {
    const key = a.managerId ?? a.managerName ?? 'Other';
    if (!groupMap[key]) {
      groupMap[key] = { managerName: a.managerName ?? key, items: [] };
      groups.push(groupMap[key]);
    }
    groupMap[key].items.push(a);
  }

  function handleSelect(advertiser) {
    setOpen(false);
    if (advertiser.advertiserId === current?.advertiserId) return;

    // Reload the page with the selected advertiserId so the server can update
    // the active session. A full round-trip is intentional here — Phase 3D will
    // replace this with an in-place context switch.
    const url = new URL(window.location.href);
    url.searchParams.set('advertiserId', advertiser.advertiserId);
    window.location.href = url.toString();
  }

  const displayLabel = current
    ? `${current.managerName ?? current.advertiserName}${current.marketplace ? ' · ' + current.marketplace : ''}`
    : 'Select account';

  return (
    <div className="relative flex items-center gap-1.5 text-sm text-gray-600" ref={dropdownRef}>
      <span className="text-xs text-gray-400">Account:</span>
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1 font-medium text-gray-700 hover:text-gray-900 focus:outline-none focus:ring-1 focus:ring-green-600 rounded px-1.5 py-0.5 transition-colors"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span>{displayLabel}</span>
        <svg
          className={`w-3.5 h-3.5 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-lg min-w-[220px] py-1 overflow-hidden">
          {groups.map((group, gi) => (
            <div key={group.managerName}>
              {/* Group header */}
              <div className="px-3 py-1.5 text-xs font-semibold text-gray-400 uppercase tracking-wide bg-gray-50 border-b border-gray-100">
                {group.managerName}
              </div>
              {/* Group items */}
              {group.items.map(a => {
                const isCurrent = a.advertiserId === current?.advertiserId;
                return (
                  <button
                    key={a.advertiserId}
                    onClick={() => handleSelect(a)}
                    className={`w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-green-50 hover:text-green-800 transition-colors text-left ${
                      isCurrent ? 'text-green-700 font-medium' : 'text-gray-700'
                    }`}
                    role="option"
                    aria-selected={isCurrent}
                  >
                    <span>
                      {a.advertiserName}
                      {a.marketplace && (
                        <span className={`ml-1.5 text-xs px-1 py-0.5 rounded ${
                          isCurrent ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-500'
                        }`}>
                          {a.marketplace}
                        </span>
                      )}
                    </span>
                    {isCurrent && (
                      <svg className="w-4 h-4 text-green-600 flex-shrink-0 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                );
              })}
              {/* Divider between groups (not after last) */}
              {gi < groups.length - 1 && <div className="border-t border-gray-100" />}
            </div>
          ))}
        </div>
      )}
      {/* Geo/marketplace selector — hidden when single marketplace */}
      <MarketplaceSelector />
    </div>
  );
}
