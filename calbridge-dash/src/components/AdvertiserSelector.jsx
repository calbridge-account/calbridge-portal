import { useAdvertiser } from '../context/AdvertiserContext';

/**
 * AdvertiserSelector
 *
 * Shows the current advertiser in the top bar.
 * - 1 advertiser: displays name as a static label (no dropdown)
 * - Multiple advertisers: renders a select dropdown to switch accounts
 *
 * On switch: calls setCurrent() from AdvertiserContext.
 * Phase 3D will wire this into data-fetching hooks so all queries
 * re-run with the new advertiserId.
 */
export default function AdvertiserSelector() {
  const ctx = useAdvertiser();

  // Still loading or no context — render nothing (avoids flash)
  if (!ctx || ctx.loading) return null;

  // No advertisers at all — nothing to show
  if (!ctx.advertisers || ctx.advertisers.length === 0) return null;

  const { advertisers, current, setCurrent } = ctx;

  // Single advertiser — just show the name
  if (advertisers.length === 1) {
    return (
      <div className="flex items-center gap-1.5 text-sm text-gray-600">
        <span className="text-xs text-gray-400">Account:</span>
        <span className="font-medium text-gray-700">
          {current?.name ?? advertisers[0].name}
        </span>
        {current?.marketplace && (
          <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">
            {current.marketplace}
          </span>
        )}
      </div>
    );
  }

  // Multiple advertisers — show a select dropdown
  return (
    <div className="flex items-center gap-1.5 text-sm text-gray-600">
      <span className="text-xs text-gray-400">Account:</span>
      <select
        value={current?.advertiserId ?? ''}
        onChange={e => {
          const selected = advertisers.find(a => a.advertiserId === e.target.value);
          if (selected) setCurrent(selected);
        }}
        className="text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-green-600 focus:border-green-600 cursor-pointer"
      >
        {advertisers.map(a => (
          <option key={a.advertiserId} value={a.advertiserId}>
            {a.name}{a.marketplace ? ` (${a.marketplace})` : ''}
          </option>
        ))}
      </select>
    </div>
  );
}
