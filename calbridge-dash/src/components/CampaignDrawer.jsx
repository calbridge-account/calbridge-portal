/**
 * CampaignDrawer
 * Slide-in panel showing per-campaign performance for a keyword, ASIN, or target.
 *
 * Props:
 *   open        — boolean
 *   onClose     — () => void
 *   title       — string (e.g. "wireless charger" or "B08XYZ")
 *   subtitle    — string (e.g. "EXACT · SP")
 *   endpoint    — string (e.g. "/advertising/keyword-campaigns?keyword=...&days=30")
 */
import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';

function makeFmtCurrency(currency = 'USD') {
  const locale = currency === 'CAD' ? 'en-CA' : 'en-US';
  return (n) => {
    if (n == null || isNaN(n)) return '—';
    return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);
  };
}
function fmtBid(n) {
  if (n == null || isNaN(n)) return '—';
  return `$${Number(n).toFixed(2)}`;
}
function fmtPct(n) {
  if (n == null || isNaN(n)) return '—';
  return `${(Number(n) * 100).toFixed(1)}%`;
}
function fmtX(n) {
  if (n == null || isNaN(n)) return '—';
  return fmt$(n);
}

const AD_TYPE_BADGE = {
  SP:  'bg-blue-100 text-blue-700',
  SB:  'bg-green-100 text-green-700',
  SD:  'bg-amber-100 text-amber-700',
};

const STATUS_COLORS = {
  ENABLED:   'bg-emerald-100 text-emerald-700',
  PAUSED:    'bg-yellow-100 text-yellow-700',
  ARCHIVED:  'bg-red-100 text-red-600',
};

function acosColor(v) {
  if (v == null) return 'text-gray-500';
  return v > 0.4 ? 'text-red-600 font-semibold' : v < 0.2 ? 'text-emerald-700 font-semibold' : 'text-gray-800';
}

async function fetchCampaigns(endpoint) {
  const r = await fetch(endpoint, { credentials: 'include' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

export default function CampaignDrawer({ open, onClose, title, subtitle, endpoint, currency = 'USD' }) {
  const fmt$ = makeFmtCurrency(currency);
  const overlayRef = useRef(null);

  const { data = [], isLoading, isError, error } = useQuery({
    queryKey: ['campaign-drill', endpoint],
    queryFn:  () => fetchCampaigns(endpoint),
    enabled:  open && !!endpoint,
    staleTime: 5 * 60 * 1000,
  });

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // Close on overlay click
  const handleOverlay = (e) => {
    if (e.target === overlayRef.current) onClose();
  };

  if (!open) return null;

  const activeCampaigns  = data.filter(r => (r.campaignStatus || '').toUpperCase() === 'ENABLED').length;
  const pausedCampaigns  = data.filter(r => (r.campaignStatus || '').toUpperCase() === 'PAUSED').length;
  const totalSpend       = data.reduce((s, r) => s + (r.spend || 0), 0);
  const totalSales       = data.reduce((s, r) => s + (r.sales || 0), 0);
  const blendedAcos      = totalSales > 0 ? totalSpend / totalSales : null;

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlay}
      className="fixed inset-0 z-50 bg-black/30 flex justify-end"
      aria-modal="true"
      role="dialog"
    >
      <div className="w-full max-w-3xl bg-white h-full shadow-2xl flex flex-col overflow-hidden animate-slide-in-right">

        {/* Header */}
        <div className="flex items-start justify-between px-6 py-5 border-b border-gray-200 bg-gray-50">
          <div className="min-w-0">
            <div className="text-xs text-gray-400 uppercase tracking-wide mb-1">Campaign Breakdown</div>
            <h2 className="text-base font-semibold text-gray-900 truncate max-w-lg" title={title}>{title}</h2>
            {subtitle && <p className="text-sm text-gray-500 mt-0.5">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            className="ml-4 p-1.5 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors flex-shrink-0"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Summary bar */}
        {!isLoading && data.length > 0 && (
          <div className="flex flex-wrap gap-5 px-6 py-3 bg-white border-b border-gray-100 text-sm">
            <span>
              <span className="text-gray-400">Campaigns&nbsp;</span>
              <strong className="text-gray-800">{data.length}</strong>
              {activeCampaigns > 0 && <span className="ml-1 text-xs text-emerald-600">({activeCampaigns} active)</span>}
              {pausedCampaigns > 0 && <span className="ml-1 text-xs text-yellow-600">({pausedCampaigns} paused)</span>}
            </span>
            <span><span className="text-gray-400">Spend&nbsp;</span><strong>{fmt$(totalSpend)}</strong></span>
            <span><span className="text-gray-400">Sales&nbsp;</span><strong>{fmt$(totalSales)}</strong></span>
            <span><span className="text-gray-400">Blended ACoS&nbsp;</span><strong className={acosColor(blendedAcos)}>{fmtPct(blendedAcos)}</strong></span>
            <span><span className="text-gray-400">ROAS&nbsp;</span><strong>{totalSpend > 0 ? fmtX(totalSales / totalSpend) : '—'}</strong></span>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {isLoading ? (
            <div className="space-y-3 pt-4">
              {[1,2,3].map(i => (
                <div key={i} className="h-20 bg-gray-100 rounded-xl animate-pulse" />
              ))}
            </div>
          ) : isError ? (
            <div className="text-red-500 text-sm py-8 text-center">{error?.message || 'Failed to load'}</div>
          ) : data.length === 0 ? (
            <div className="text-gray-400 text-sm py-12 text-center">No campaign data found for this period</div>
          ) : (
            <div className="space-y-3">
              {data.map((r, i) => {
                const status = (r.campaignStatus || '').toUpperCase();
                const isActive = status === 'ENABLED';
                return (
                  <div
                    key={r.campaignId || i}
                    className={`rounded-xl border p-4 ${isActive ? 'border-gray-200 bg-white' : 'border-gray-100 bg-gray-50/60'}`}
                  >
                    {/* Campaign header row */}
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          {r.adType && (
                            <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${AD_TYPE_BADGE[r.adType] || 'bg-gray-100 text-gray-600'}`}>
                              {r.adType}
                            </span>
                          )}
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_COLORS[status] || 'bg-gray-100 text-gray-500'}`}>
                            {status || 'UNKNOWN'}
                          </span>
                          {r.matchType && r.matchType !== '—' && (
                            <span className="text-xs text-gray-400 font-medium">{r.matchType}</span>
                          )}
                        </div>
                        <p className="mt-1 text-sm font-semibold text-gray-800 leading-snug" title={r.campaignName}>
                          {r.campaignName}
                        </p>
                        {r.adGroupName && r.adGroupName !== '—' && (
                          <p className="text-xs text-gray-400 mt-0.5 truncate">Ad Group: {r.adGroupName}</p>
                        )}
                      </div>
                      <div className="text-right flex-shrink-0">
                        {r.campaignBudget != null && (
                          <div className="text-xs text-gray-400">Budget: <span className="font-medium text-gray-600">{fmt$(r.campaignBudget)}/day</span></div>
                        )}
                        {r.keywordBid != null && (
                          <div className="text-xs text-gray-400 mt-0.5">Bid: <span className="font-medium text-gray-600">{fmtBid(r.keywordBid)}</span></div>
                        )}
                        {r.keywordStatus && r.keywordStatus !== '—' && (
                          <div className="text-xs text-gray-400 mt-0.5">KW: <span className="font-medium">{r.keywordStatus}</span></div>
                        )}
                      </div>
                    </div>

                    {/* Metrics grid */}
                    <div className="grid grid-cols-4 gap-2 text-center">
                      {[
                        { label: 'Spend',  value: fmt$(r.spend)  },
                        { label: 'Sales',  value: fmt$(r.sales)  },
                        { label: 'ACoS',   value: fmtPct(r.acos), color: acosColor(r.acos) },
                        { label: 'ROAS',   value: fmtX(r.roas)   },
                        { label: 'Orders', value: (r.orders || 0).toLocaleString() },
                        { label: 'Clicks', value: (r.clicks || 0).toLocaleString() },
                        { label: 'Impr.',  value: new Intl.NumberFormat('en-US', { notation: 'compact' }).format(r.impressions || 0) },
                        { label: 'CPC',    value: r.cpc != null ? fmtBid(r.cpc) : '—' },
                      ].map(m => (
                        <div key={m.label} className="bg-gray-50 rounded-lg px-2 py-1.5">
                          <div className="text-[10px] text-gray-400 uppercase tracking-wide">{m.label}</div>
                          <div className={`text-sm font-semibold mt-0.5 ${m.color || 'text-gray-800'}`}>{m.value}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
