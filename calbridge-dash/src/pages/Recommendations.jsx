import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import { SkeletonTable, ErrorState } from '../components/Skeleton';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

// ─── API ──────────────────────────────────────────────────────────────────────

async function fetchJSON(path) {
  const r = await fetch(path, { credentials: 'include' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
async function postJSON(path) {
  const r = await fetch(path, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

const getStats        = ()       => fetchJSON('/decisions/stats');
const getPending      = (type)   => fetchJSON(`/decisions/pending${type ? `?type=${type}` : ''}`);
const getHistory      = (status) => fetchJSON(`/decisions/history?status=${status}`);
const runAnalysis     = ()       => fetchJSON('/decisions/analyze');
const approveOne      = (id)     => postJSON(`/decisions/${id}/approve`);
const rejectOne       = (id)     => postJSON(`/decisions/${id}/reject`);
const snoozeOne       = (id)     => postJSON(`/decisions/${id}/snooze`);
const executeOne      = (id)     => postJSON(`/decisions/execute/${id}`);
const approveAll      = (type)   => fetch('/decisions/approve-all', { method:'POST', credentials:'include', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ type: type || null }) }).then(r=>r.json());
const executeAll      = (type)   => fetch('/decisions/execute-all',  { method:'POST', credentials:'include', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ type: type || null }) }).then(r=>r.json());

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt$(n) {
  if (n == null || isNaN(n)) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
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
  return `${Number(n).toFixed(2)}x`;
}

const ACTION_META = {
  bid_decrease:   { emoji: '🔴', label: 'Reduce Bid',       bg: 'bg-red-50',    badge: 'bg-red-100 text-red-700'     },
  bid_increase:   { emoji: '🟢', label: 'Increase Bid',     bg: 'bg-green-50',  badge: 'bg-green-100 text-green-700' },
  pause_keyword:  { emoji: '⏸',  label: 'Pause Keyword',    bg: 'bg-gray-50',   badge: 'bg-gray-100 text-gray-700'   },
  budget_increase:{ emoji: '💰', label: 'Increase Budget',  bg: 'bg-blue-50',   badge: 'bg-blue-100 text-blue-700'   },
  budget_decrease:{ emoji: '✂️', label: 'Reduce Budget',    bg: 'bg-orange-50', badge: 'bg-orange-100 text-orange-700'},
  add_keyword:    { emoji: '🔍', label: 'Add Keyword',      bg: 'bg-teal-50',   badge: 'bg-teal-100 text-teal-700'   },
  launch_campaign:{ emoji: '🚀', label: 'Launch Ads',       bg: 'bg-indigo-50', badge: 'bg-indigo-100 text-indigo-700'},
};

const AD_TYPE_BADGE = {
  SP:  'bg-blue-100 text-blue-700',
  SB:  'bg-green-100 text-green-700',
  SD:  'bg-amber-100 text-amber-700',
  DSP: 'bg-purple-100 text-purple-700',
};


// ─── Recommendation score ─────────────────────────────────────────────────────
// Higher = more impactful. Factors: spend at stake, deviation from target, order volume
function calcScore(action) {
  const m = action.metrics || {};
  const spend    = m.spend_30d   || 0;
  const orders   = m.orders_30d  || 0;
  const acos     = m.acos;
  const TARGET   = 0.1176;
  const deviation = acos != null ? Math.abs(acos - TARGET) / TARGET : 0;
  // Score = spend × deviation × (1 + orders/10)
  return spend * deviation * (1 + orders / 10);
}

// ─── Stats bar ────────────────────────────────────────────────────────────────

function StatsBar({ stats, onRunAnalysis, isRunning }) {
  return (
    <div className="flex items-center gap-6 bg-white border border-gray-200 rounded-xl px-5 py-3 mb-4">
      <div className="flex gap-6 flex-1">
        {[
          { label: 'Pending',  val: stats?.pending  ?? '—', color: 'text-amber-600' },
          { label: 'Approved', val: stats?.approved ?? '—', color: 'text-blue-600'  },
          { label: 'Executed', val: stats?.executed ?? '—', color: 'text-green-600' },
          { label: 'Rejected', val: stats?.rejected ?? '—', color: 'text-gray-400'  },
        ].map(s => (
          <div key={s.label} className="text-center">
            <div className={`text-xl font-bold ${s.color}`}>{s.val}</div>
            <div className="text-xs text-gray-400">{s.label}</div>
          </div>
        ))}
      </div>
      <button
        onClick={onRunAnalysis}
        disabled={isRunning}
        className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {isRunning ? '⏳ Analyzing…' : '⚡ Run Analysis'}
      </button>
    </div>
  );
}

// ─── Action row ───────────────────────────────────────────────────────────────

function ActionRow({ action, tab, onApprove, onReject, onSnooze, onExecute, loading }) {
  const meta = ACTION_META[action.actionType] || ACTION_META.bid_decrease;
  const m = action.metrics || {};
  const isKeyword = action.entityType === 'keyword';
  const valLabel = isKeyword ? 'Bid' : 'Budget/day';

  return (
    <tr className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
      {/* Type badge */}
      <td className="py-3 pl-4 pr-2 w-36">
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${meta.badge}`}>
          {meta.emoji} {meta.label}
        </span>
        {action.adType && (
          <span className={`ml-1 px-1.5 py-0.5 rounded text-xs font-bold ${AD_TYPE_BADGE[action.adType] || 'bg-gray-100 text-gray-600'}`}>
            {action.adType}
          </span>
        )}
      </td>

      {/* Keyword/Campaign */}
      <td className="py-3 px-2 max-w-xs">
        <div className="text-sm font-medium text-gray-800 truncate" title={action.entityName}>
          {action.entityName || action.entityId}
        </div>
        {action.campaignName && action.entityType === 'keyword' && (
          <div className="text-xs text-gray-400 truncate" title={action.campaignName}>{action.campaignName}</div>
        )}
      </td>

      {/* Bid change */}
      <td className="py-3 px-2 text-sm whitespace-nowrap">
        {action.actionType === 'add_keyword' ? (
          <span className="text-teal-700 font-semibold">New EXACT @ {fmtBid(action.proposedValue)}</span>
        ) : action.actionType === 'launch_campaign' ? (
          <span className="text-indigo-700 font-semibold">
            {action.metrics?.sellable_units?.toLocaleString()} units idle
          </span>
        ) : (
          <>
            <span className="text-gray-500">{valLabel}: </span>
            <span className="font-semibold">{fmtBid(action.currentValue)}</span>
            <span className="text-gray-400 mx-1">→</span>
            <span className={`font-bold ${action.actionType === 'bid_decrease' || action.actionType === 'budget_decrease' ? 'text-red-600' : 'text-green-600'}`}>
              {fmtBid(action.proposedValue)}
            </span>
          </>
        )}
      </td>

      {/* Metrics */}
      <td className="py-3 px-2 text-xs text-gray-600 whitespace-nowrap">
        <span className="mr-3">ACoS: <strong>{fmtPct(m.acos)}</strong></span>
        <span className="mr-3">ROAS: <strong>{fmtX(m.roas)}</strong></span>
        <span className="mr-3">Spend: <strong>{fmt$(m.spend_30d)}</strong></span>
        <span>Clicks: <strong>{m.clicks_30d ?? '—'}</strong></span>
      </td>

      {/* Reason */}
      <td className="py-3 px-2 text-xs text-gray-500 max-w-sm">
        <span title={action.reason} className="line-clamp-2">{action.reason}</span>
      </td>

      {/* Actions */}
      <td className="py-3 pl-2 pr-4 whitespace-nowrap">
        {tab === 'pending' && (
          <div className="flex gap-1">
            <button onClick={() => onApprove(action.actionId)} disabled={loading} className="px-2 py-1 bg-green-600 text-white text-xs rounded hover:bg-green-700 disabled:opacity-40">✓ Approve &amp; Execute</button>
            <button onClick={() => onReject(action.actionId)}  disabled={loading} className="px-2 py-1 bg-red-100 text-red-700 text-xs rounded hover:bg-red-200 disabled:opacity-40">✗ Reject</button>
            <button onClick={() => onSnooze(action.actionId)}  disabled={loading} className="px-2 py-1 bg-gray-100 text-gray-600 text-xs rounded hover:bg-gray-200 disabled:opacity-40">⏰ Snooze</button>
          </div>
        )}
        {tab === 'approved' && (
          <button onClick={() => onExecute(action.actionId)} disabled={loading} className="px-3 py-1 bg-indigo-600 text-white text-xs rounded hover:bg-indigo-700 disabled:opacity-40">▶ Execute</button>
        )}
        {tab === 'executed' && (
          <span className="text-xs text-green-600 font-medium">✅ Done</span>
        )}
        {tab === 'rejected' && (
          <span className="text-xs text-gray-400">Rejected</span>
        )}
      </td>
    </tr>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

const TABS = [
  { key: 'pending',  label: 'Pending'  },
  { key: 'approved', label: 'Approved' },
  { key: 'executed', label: 'Executed' },
  { key: 'rejected', label: 'Rejected' },
];

const TYPE_FILTERS = [
  { key: '',                label: 'All Types'       },
  { key: 'bid_decrease',    label: '🔴 Reduce Bid'   },
  { key: 'bid_increase',    label: '🟢 Increase Bid' },
  { key: 'pause_keyword',   label: '⏸ Pause'         },
  { key: 'budget_increase', label: '💰 Budget +'     },
  { key: 'budget_decrease', label: '✂️ Budget −'     },
  { key: 'add_keyword',     label: '🔍 Add Keyword' },
  { key: 'launch_campaign', label: '🚀 Launch Ads'  },
];

const SORT_OPTIONS = [
  { key: 'score_desc',   label: 'Highest Impact'    },
  { key: 'spend_desc',   label: 'Most Spend'        },
  { key: 'acos_desc',    label: 'Worst ACoS First'  },
  { key: 'acos_asc',     label: 'Best ACoS First'   },
  { key: 'orders_desc',  label: 'Most Orders'       },
  { key: 'newest',       label: 'Newest First'      },
];

// ─── Upgrade banner ──────────────────────────────────────────────────────────

function UpgradeBanner({ onDismiss }) {
  const navigate = useNavigate();
  return (
    <div className="flex items-center justify-between gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-4">
      <div className="flex items-center gap-2 text-sm text-amber-800">
        <span className="text-base">🔒</span>
        <span className="font-medium">AI-powered bid optimization requires Growth plan.</span>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          onClick={() => navigate('/pricing')}
          className="px-3 py-1.5 bg-amber-600 text-white text-xs font-semibold rounded-lg hover:bg-amber-700 transition-colors"
        >
          Upgrade Now →
        </button>
        <button
          onClick={onDismiss}
          className="p-1 text-amber-500 hover:text-amber-700 transition-colors"
          aria-label="Dismiss"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Recommendations() {
  const qc = useQueryClient();
  const [activeTab, setActiveTab]   = useState('pending');
  const [typeFilter, setTypeFilter] = useState('');
  const [sortBy, setSortBy] = useState('score_desc');
  const [actionLoading, setActionLoading] = useState(false);
  const [toast, setToast] = useState(null);

  // Upgrade banner state — show if on free or starter plan
  const [showUpgradeBanner, setShowUpgradeBanner] = useState(false);
  useEffect(() => {
    fetch('/billing/status', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        const plan = data?.plan || 'free';
        if (plan === 'free' || plan === 'starter') {
          setShowUpgradeBanner(true);
        }
      })
      .catch(() => {}); // silently ignore
  }, []);

  const showToast = (msg, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  };

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['decision-stats'],
    queryFn: getStats,
    staleTime: 30000,
    retry: 1,
  });

  const { data: actions, isLoading: actionsLoading, isError } = useQuery({
    queryKey: ['decisions', activeTab, typeFilter],
    queryFn: () => activeTab === 'pending' ? getPending(typeFilter) : getHistory(activeTab),
    staleTime: 30000,
    retry: 1,
  });

  const { mutateAsync: doAnalysis, isPending: isRunning } = useMutation({
    mutationFn: runAnalysis,
    onSuccess: (data) => {
      showToast(`Generated ${data.generated} recommendations (${data.total_pending} total pending)`);
      qc.invalidateQueries({ queryKey: ['decisions'] });
      qc.invalidateQueries({ queryKey: ['decision-stats'] });
    },
    onError: (e) => showToast(`Analysis failed: ${e.message}`, false),
  });

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['decisions'] });
    qc.invalidateQueries({ queryKey: ['decision-stats'] });
  }, [qc]);

  const withLoading = async (fn) => {
    setActionLoading(true);
    try { await fn(); invalidate(); }
    catch (e) { showToast(`Error: ${e.message}`, false); }
    finally { setActionLoading(false); }
  };

  const handleApproveAll = () => withLoading(async () => {
    const approved = await approveAll(typeFilter || null);
    showToast(`Approved ${approved.approved} — executing now...`);
    const executed = await executeAll(typeFilter || null);
    const failed = (executed.results || []).filter(r => !r.ok).length;
    showToast(`✅ Executed ${executed.executed ?? 0} actions${failed ? ` (${failed} failed)` : ''}`);
  });

  return (
    <div className="max-w-7xl">
      <PageHeader title="Recommendations" subtitle="AI-generated bid and budget optimizations — review and approve before execution" />

      {/* Upgrade banner */}
      {showUpgradeBanner && (
        <UpgradeBanner onDismiss={() => setShowUpgradeBanner(false)} />
      )}

      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-2 rounded-lg text-sm font-medium shadow-lg ${toast.ok ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`}>
          {toast.msg}
        </div>
      )}

      {/* Stats bar */}
      <StatsBar stats={stats} onRunAnalysis={() => doAnalysis()} isRunning={isRunning} />

      {/* Tabs + filters */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex gap-1">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                activeTab === t.key
                  ? 'bg-indigo-600 text-white'
                  : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
              }`}
            >
              {t.label}
              {t.key === 'pending' && stats?.pending > 0 && (
                <span className="ml-1.5 bg-white text-indigo-600 rounded-full text-xs px-1.5 py-0.5 font-bold">{stats.pending}</span>
              )}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <select
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 text-gray-700"
          >
            {TYPE_FILTERS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 text-gray-700"
          >
            {SORT_OPTIONS.map(s => <option key={s.key} value={s.key}>{s.key === sortBy ? '↕ ' : ''}{s.label}</option>)}
          </select>
          {activeTab === 'pending' && (
            <button
              onClick={handleApproveAll}
              disabled={actionLoading || !actions?.length}
              className="px-3 py-1.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-40 transition-colors"
              title={typeFilter ? `Approve all ${typeFilter.replace('_',' ')} recommendations` : 'Approve all pending recommendations'}
            >
              ✓ Approve {typeFilter ? typeFilter.replace(/_/g,' ') : 'All'}
            </button>
          )}
          {activeTab === 'approved' && (
            <button
              onClick={() => withLoading(async () => {
                const ids = (window.__sortedActions || actions || []).map(a => a.actionId);
                let done = 0, failed = 0;
                for (const id of ids) {
                  try { await executeOne(id); done++; } catch { failed++; }
                }
                showToast(`Executed ${done}${failed ? `, ${failed} failed` : ''}`);
              })}
              disabled={actionLoading || !actions?.length}
              className="px-3 py-1.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-40 transition-colors"
            >
              ▶ Execute All
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {(() => { window.__sortedActions = [...(actions||[])].sort((a,b) => {
          const ma=a.metrics||{},mb=b.metrics||{};
          switch(sortBy){
            case 'score_desc': return calcScore(b)-calcScore(a);
            case 'spend_desc': return (mb.spend_30d||0)-(ma.spend_30d||0);
            case 'acos_desc':  return (mb.acos||0)-(ma.acos||0);
            case 'acos_asc':   return (ma.acos||0)-(mb.acos||0);
            case 'orders_desc':return (mb.orders_30d||0)-(ma.orders_30d||0);
            case 'newest':     return new Date(b.createdAt||0)-new Date(a.createdAt||0);
            default: return 0;
          }
        }); return null; })()}
        {actionsLoading || statsLoading ? (
          <div className="p-8"><SkeletonTable /></div>
        ) : isError ? (
          <div className="p-8"><ErrorState message="Failed to load recommendations" /></div>
        ) : !actions?.length ? (
          <div className="py-16 text-center">
            <div className="text-4xl mb-3">🎯</div>
            <h3 className="text-base font-semibold text-gray-800 mb-1">
              {activeTab === 'pending' ? 'No pending recommendations' : `No ${activeTab} actions`}
            </h3>
            {activeTab === 'pending' && (
              <p className="text-sm text-gray-400 mb-4">Click "Run Analysis" to generate new recommendations</p>
            )}
          </div>
        ) : (
          <table className="w-full text-left">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="py-2 pl-4 pr-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">Type</th>
                <th className="py-2 px-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">Keyword / Campaign</th>
                <th className="py-2 px-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">Change</th>
                <th className="py-2 px-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">30d Metrics</th>
                <th className="py-2 px-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">Reason</th>
                <th className="py-2 pl-2 pr-4 text-xs font-semibold text-gray-500 uppercase tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(window.__sortedActions||actions||[]).map(a => (
                <ActionRow
                  key={a.actionId}
                  action={a}
                  tab={activeTab}
                  loading={actionLoading}
                  onApprove={(id) => withLoading(() => approveOne(id).then(() => executeOne(id)).then(() => showToast('Executed ✅')).catch(e => showToast('Approved — execute failed: ' + e.message, false)))}
                  onReject={(id)  => withLoading(() => rejectOne(id).then(()  => showToast('Rejected')))}
                  onSnooze={(id)  => withLoading(() => snoozeOne(id).then(()  => showToast('Snoozed 7 days')))}
                  onExecute={(id) => withLoading(() => executeOne(id).then(() => showToast('Executed ✅')))}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Footer note */}
      <p className="mt-3 text-xs text-gray-400">
        Target ROAS: 8.50x (11.76% ACoS) · Min bid: $1.00 · Max step: ±20% · 7-day cooldown per keyword · All changes require approval
      </p>
    </div>
  );
}
