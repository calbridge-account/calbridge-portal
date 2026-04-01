import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card } from '@tremor/react';
import { useDateRange } from '../context/DateRangeContext';
import { getOpportunities, createAction } from '../api/v2client';
import { fmtCurrency, fmtPct } from '../utils/format';

// ── Constants ──────────────────────────────────────────────────────────────
const TYPE_ICON = {
  raise_bid:    '🎯',
  pause_waste:  '⛔',
  add_negative: '🚫',
  raise_budget: '💰',
};

const TYPE_LABEL = {
  raise_bid:    'Raise Bid',
  pause_waste:  'Pause Waste',
  add_negative: 'Add Negative',
  raise_budget: 'Raise Budget',
};

const FILTER_TABS = [
  { key: 'all',           label: 'All' },
  { key: 'raise_bid',     label: 'Quick Wins' },
  { key: 'pause_waste',   label: 'Waste Reduction' },
  { key: 'add_negative',  label: 'Negative Keywords' },
  { key: 'raise_budget',  label: 'Budget' },
];

// ── Priority badge ─────────────────────────────────────────────────────────
function PriorityBadge({ priority }) {
  const styles = {
    high:   'bg-red-600 text-white',
    medium: 'bg-yellow-400 text-gray-900',
    low:    'bg-gray-200 text-gray-700',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wide ${styles[priority] || styles.low}`}>
      {priority}
    </span>
  );
}

// ── Confidence bar ─────────────────────────────────────────────────────────
function ConfidenceBar({ value }) {
  const pct = Math.round((value || 0) * 100);
  const filled = Math.round(pct / 10);
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-gray-600">
      <span className="font-medium text-gray-800">{pct}%</span>
      <span className="tracking-widest text-base leading-none">
        {'█'.repeat(filled)}{'░'.repeat(10 - filled)}
      </span>
    </span>
  );
}

// ── Toast ──────────────────────────────────────────────────────────────────
function Toast({ message, type = 'success', onClose }) {
  const bg = type === 'success' ? 'bg-green-600' : 'bg-red-600';
  return (
    <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-5 py-3 rounded-lg shadow-lg text-white text-sm font-medium ${bg}`}>
      <span>{message}</span>
      <button onClick={onClose} className="ml-2 text-white/80 hover:text-white">✕</button>
    </div>
  );
}

// ── Stat card ──────────────────────────────────────────────────────────────
function StatCard({ label, value, colorClass = 'text-gray-900' }) {
  return (
    <Card className="flex flex-col items-center justify-center p-4 text-center min-h-[90px]">
      <div className={`text-3xl font-extrabold ${colorClass}`}>{value ?? '—'}</div>
      <div className="text-xs text-gray-500 mt-1 font-medium">{label}</div>
    </Card>
  );
}

// ── Opportunity card ───────────────────────────────────────────────────────
function OpportunityCard({ opp, actioned, onAction }) {
  const [loading, setLoading] = useState(false);

  async function handleAddToQueue() {
    setLoading(true);
    try {
      await onAction(opp);
    } finally {
      setLoading(false);
    }
  }

  const isActioned = actioned.has(opp.id);
  const icon = TYPE_ICON[opp.type] || '📌';

  return (
    <Card className={`relative transition-opacity ${isActioned ? 'opacity-60' : ''}`}>
      {isActioned && (
        <div className="absolute top-3 right-3 flex items-center gap-1 text-green-700 text-sm font-semibold">
          <span>✓</span><span>Added</span>
        </div>
      )}
      {/* Header */}
      <div className="flex items-start gap-3 mb-3">
        <PriorityBadge priority={opp.priority} />
        <div className="flex items-start gap-2 flex-1 min-w-0">
          <span className="text-lg leading-none">{icon}</span>
          <h3 className="text-base font-semibold text-gray-900 leading-snug">{opp.title}</h3>
        </div>
      </div>

      {/* Why */}
      {opp.why && (
        <p className="text-sm text-gray-600 mb-3">
          <span className="font-medium text-gray-800">Why: </span>{opp.why}
        </p>
      )}

      {/* Evidence */}
      {opp.evidence && (
        <div className="bg-gray-50 rounded-lg p-3 mb-3">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Evidence</p>
          <div className="flex flex-wrap gap-4 text-sm mb-2">
            {opp.evidence.spend != null && (
              <div>
                <span className="text-gray-500">Spend: </span>
                <span className="font-semibold text-gray-900">{fmtCurrency(opp.evidence.spend)}</span>
              </div>
            )}
            {opp.evidence.sales != null && (
              <div>
                <span className="text-gray-500">Sales: </span>
                <span className="font-semibold text-gray-900">{fmtCurrency(opp.evidence.sales)}</span>
              </div>
            )}
            {opp.evidence.acos != null && (
              <div>
                <span className="text-gray-500">ACoS: </span>
                <span className="font-semibold text-gray-900">{fmtPct(opp.evidence.acos)}</span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">Confidence:</span>
            <ConfidenceBar value={opp.confidence} />
          </div>
        </div>
      )}

      {/* Impact + Recommendation */}
      <div className="space-y-1 mb-4 text-sm">
        {opp.expectedImpact && (
          <p className="text-gray-600">
            <span className="font-medium text-gray-800">Expected impact: </span>{opp.expectedImpact}
          </p>
        )}
        {opp.recommendedAction && (
          <p className="text-gray-600">
            <span className="font-medium text-gray-800">Recommended: </span>{opp.recommendedAction}
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={handleAddToQueue}
          disabled={loading || isActioned}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? 'Adding…' : isActioned ? '✓ In Queue' : '+ Add to Action Queue'}
        </button>
        <button
          disabled={isActioned}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-sm font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Snooze
        </button>
        <button
          disabled={isActioned}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-sm font-medium border border-gray-300 text-gray-500 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Dismiss
        </button>
      </div>
    </Card>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────
export default function Opportunities() {
  const { rangeLabel, rangeParams } = useDateRange();
  const [activeFilter, setActiveFilter] = useState('all');
  const [actioned, setActioned] = useState(new Set());
  const [toast, setToast] = useState(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['opportunities', rangeParams()],
    queryFn: () => getOpportunities(rangeParams()),
  });

  const opportunities = data?.opportunities ?? [];
  const summary = data?.summary ?? {};

  const filtered = activeFilter === 'all'
    ? opportunities
    : opportunities.filter((o) => o.type === activeFilter);

  async function handleAddToQueue(opp) {
    try {
      await createAction({
        opportunityId: opp.id,
        actionType: opp.type,
        entityType: opp.entity?.type ?? 'campaign',
        entityId: opp.entity?.id ?? '',
        entityName: opp.entity?.name ?? opp.title,
        status: 'pending',
        notes: opp.recommendedAction ?? '',
      });
      setActioned((prev) => new Set([...prev, opp.id]));
      showToast(`"${opp.entity?.name || opp.title}" added to action queue`, 'success');
    } catch (err) {
      showToast(`Failed to add action: ${err.message}`, 'error');
    }
  }

  function showToast(message, type) {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }

  return (
    <div>
      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Opportunities</h1>
        <p className="text-sm text-gray-500 mt-1">Showing data for: {rangeLabel()}</p>
      </div>

      {/* Loading / error */}
      {isLoading && (
        <div className="text-center py-12 text-gray-500 text-sm">Loading opportunities…</div>
      )}
      {isError && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          Failed to load opportunities: {error?.message}
        </div>
      )}

      {!isLoading && !isError && (
        <>
          {/* Summary strip */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <StatCard label="Total Opportunities" value={summary.total ?? opportunities.length} />
            <StatCard label="Quick Wins (Raise Bid)" value={summary.byType?.raise_bid ?? 0} colorClass="text-green-700" />
            <StatCard label="Waste to Cut (Pause)" value={summary.byType?.pause_waste ?? 0} colorClass="text-red-600" />
            <StatCard label="Negatives to Add" value={summary.byType?.add_negative ?? 0} colorClass="text-yellow-600" />
          </div>

          {/* No-data callout */}
          {opportunities.length === 0 && (
            <div className="mb-6 flex items-start gap-3 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <span className="text-blue-500 text-xl">ℹ️</span>
              <p className="text-sm text-blue-800">
                No opportunities found for this period. Adjust the date range or check back after more data is collected.
              </p>
            </div>
          )}

          {/* Filter tabs */}
          {opportunities.length > 0 && (
            <div className="flex items-center gap-1 mb-5 border-b border-gray-200">
              {FILTER_TABS.map((tab) => {
                const count = tab.key === 'all'
                  ? opportunities.length
                  : opportunities.filter((o) => o.type === tab.key).length;
                const isActive = activeFilter === tab.key;
                return (
                  <button
                    key={tab.key}
                    onClick={() => setActiveFilter(tab.key)}
                    className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap -mb-px ${
                      isActive
                        ? 'border-blue-600 text-blue-700'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    }`}
                  >
                    {tab.label}
                    {count > 0 && (
                      <span className={`ml-1.5 inline-flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold ${
                        isActive ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'
                      }`}>
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* Opportunity cards */}
          <div className="space-y-4">
            {filtered.length === 0 && opportunities.length > 0 && (
              <p className="text-sm text-gray-500 text-center py-8">No opportunities in this category.</p>
            )}
            {filtered.map((opp) => (
              <OpportunityCard
                key={opp.id}
                opp={opp}
                actioned={actioned}
                onAction={handleAddToQueue}
              />
            ))}
          </div>
        </>
      )}

      {/* Toast notification */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
}
