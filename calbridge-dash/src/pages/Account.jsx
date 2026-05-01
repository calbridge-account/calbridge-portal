import { useState, useEffect, useRef, useMemo } from 'react';
import PageHeader from '../components/PageHeader';
import { useUser } from '../context/UserContext';
import { useAdvertiser } from '../context/AdvertiserContext';
import {
  useBudgets,
  useBudgetCampaigns,
  useCreateBudget,
  useUpdateBudget,
  useDeleteBudget,
  useUpdateBudgetCampaigns,
} from '../hooks/useAnalytics';

// ─── Reusable section card ────────────────────────────────────────────────────
function Section({ title, children }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
      <h2 className="text-sm font-semibold text-gray-700 mb-4">{title}</h2>
      {children}
    </div>
  );
}

// ─── Connection badge ─────────────────────────────────────────────────────────
function ConnectionBadge({ label, connected, connectedAt }) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-gray-100 last:border-0">
      <div className="flex items-center gap-3">
        <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${connected ? 'bg-green-500' : 'bg-gray-300'}`} />
        <span className="text-sm font-medium text-gray-700">{label}</span>
      </div>
      <div className="text-right">
        {connected ? (
          <div>
            <span className="text-xs font-medium text-green-700 bg-green-50 px-2 py-0.5 rounded-full">Connected</span>
            {connectedAt && (
              <div className="text-xs text-gray-400 mt-0.5">
                {new Date(connectedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </div>
            )}
          </div>
        ) : (
          <span className="text-xs font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">Not connected</span>
        )}
      </div>
    </div>
  );
}

function ConnectButton({ label, href }) {
  return (
    <a
      href={href}
      className="flex items-center justify-between w-full px-4 py-3 rounded-lg border border-gray-200 bg-white hover:border-brand hover:bg-brand-light transition-colors group"
    >
      <span className="text-sm font-medium text-gray-700 group-hover:text-brand">{label}</span>
      <svg className="w-4 h-4 text-gray-400 group-hover:text-brand" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
      </svg>
    </a>
  );
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function Toast({ message, type = 'success', onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 3500);
    return () => clearTimeout(t);
  }, [onClose]);
  return (
    <div className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium flex items-center gap-2 ${
      type === 'success' ? 'bg-green-700 text-white' : 'bg-red-600 text-white'
    }`}>
      {type === 'success' ? '✅' : '❌'} {message}
      <button onClick={onClose} className="ml-2 opacity-70 hover:opacity-100">×</button>
    </div>
  );
}

// ─── Budget helpers ──────────────────────────────────────────────────────────

function fmt$(n) {
  if (n == null) return '$0';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}

function fmtDateShort(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const PACE_BADGE = {
  on_pace: { label: 'On Pace',      bg: 'bg-green-100',  text: 'text-green-800'  },
  over:    { label: 'Overspending', bg: 'bg-red-100',    text: 'text-red-800'    },
  under:   { label: 'Under',        bg: 'bg-yellow-100', text: 'text-yellow-800' },
};

function PaceBadge({ status }) {
  const s = PACE_BADGE[status] || PACE_BADGE.on_pace;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${s.bg} ${s.text}`}>
      {s.label}
    </span>
  );
}

function AdTypeBadge({ type }) {
  const map = { SP: 'bg-blue-100 text-blue-700', SB: 'bg-purple-100 text-purple-700', SD: 'bg-orange-100 text-orange-700', DSP: 'bg-teal-100 text-teal-700' };
  const cls = map[type] || 'bg-gray-100 text-gray-600';
  return <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${cls}`}>{type || '?'}</span>;
}

// ─── Budget Form Modal ────────────────────────────────────────────────────────

function BudgetModal({ budget, onClose, onCreate, onUpdate }) {
  const [name, setName]               = useState(budget?.name || '');
  const [totalAmount, setTotalAmount] = useState(budget?.total_amount || '');
  const [currency, setCurrency]       = useState(budget?.currency || 'USD');
  const [marketplace, setMarketplace] = useState(budget?.marketplace || 'US');
  const [periodStart, setPeriodStart] = useState(budget?.period_start ? budget.period_start.split('T')[0] : '');
  const [periodEnd, setPeriodEnd]     = useState(budget?.period_end   ? budget.period_end.split('T')[0]   : '');
  const [notes, setNotes]             = useState(budget?.notes || '');
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState(null);

  const isEdit = !!budget;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name || !totalAmount || !periodStart || !periodEnd) return;
    setSaving(true);
    setError(null);
    try {
      const body = { name, total_amount: Number(totalAmount), currency, marketplace, period_start: periodStart, period_end: periodEnd, notes: notes || null };
      if (isEdit) {
        await onUpdate(budget.budget_id, body);
      } else {
        await onCreate(body);
      }
      onClose();
    } catch (err) {
      console.error(err);
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  const inputCls = 'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent';
  const btnPrimary = 'px-4 py-2 bg-brand text-white text-sm font-medium rounded-lg hover:bg-brand-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-gray-900">{isEdit ? 'Edit Budget' : 'New Budget'}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Budget Name *</label>
            <input value={name} onChange={e => setName(e.target.value)} className={inputCls} placeholder="Q1 2026 Brand Budget" required />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Marketplace</label>
            <select value={marketplace} onChange={e => setMarketplace(e.target.value)} className={inputCls}>
              <option value="US">🇺🇸 United States</option>
              <option value="CA">🇨🇦 Canada</option>
              <option value="UK">🇬🇧 United Kingdom</option>
              <option value="DE">🇩🇪 Germany</option>
            </select>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-500 mb-1">Total Amount *</label>
              <input type="number" min="0" step="0.01" value={totalAmount} onChange={e => setTotalAmount(e.target.value)} className={inputCls} placeholder="50000" required />
            </div>
            <div className="w-24">
              <label className="block text-xs font-medium text-gray-500 mb-1">Currency</label>
              <select value={currency} onChange={e => setCurrency(e.target.value)} className={inputCls}>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
                <option value="GBP">GBP</option>
                <option value="CAD">CAD</option>
              </select>
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-500 mb-1">Period Start *</label>
              <input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} className={inputCls} required />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-500 mb-1">Period End *</label>
              <input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} className={inputCls} required />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} className={inputCls} rows={2} placeholder="Optional notes..." />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            {error && (
              <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 col-span-2">
                {error}
              </div>
            )}
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800">Cancel</button>
            <button type="submit" disabled={saving || !name || !totalAmount || !periodStart || !periodEnd} className={btnPrimary}>
              {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Budget'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Campaign Assignment Modal ─────────────────────────────────────────────────

function CampaignAssignModal({ budget, allCampaigns, onClose, onSave }) {
  const assigned = useMemo(() => new Set((budget.campaigns || []).map(c => c.campaign_id)), [budget]);
  const [selected, setSelected] = useState(new Set(assigned));
  const [search, setSearch]     = useState('');
  const [saving, setSaving]     = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const filtered = useMemo(() => {
    let list = allCampaigns;
    // Hide archived unless toggled — but always show already-assigned campaigns
    if (!showArchived) {
      list = list.filter(c => c.status !== 'archived' || assigned.has(c.campaign_id));
    }
    if (!search.trim()) return list;
    const terms = search.trim().toLowerCase().split(/\s+/);
    return list.filter(c => {
      const name = (c.campaign_name || '').toLowerCase();
      return terms.every(t => name.includes(t));
    });
  }, [allCampaigns, search, showArchived, assigned]);

  const archivedCount = useMemo(() => allCampaigns.filter(c => c.status === 'archived').length, [allCampaigns]);

  function toggle(cid) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(cid)) next.delete(cid);
      else next.add(cid);
      return next;
    });
  }

  const [saveError, setSaveError] = useState(null);

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      const campaigns = allCampaigns.filter(c => selected.has(c.campaign_id)).map(c => ({
        campaign_id:   c.campaign_id,
        campaign_name: c.campaign_name,
        ad_type:       c.ad_type,
      }));
      await onSave(budget.budget_id, campaigns);
      onClose();
    } catch (err) {
      console.error(err);
      setSaveError(err.message || 'Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 flex flex-col" style={{ maxHeight: '85vh' }}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h3 className="text-base font-semibold text-gray-900">Assign Campaigns</h3>
            <p className="text-xs text-gray-400 mt-0.5">{budget.name}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>
        <div className="px-6 py-3 border-b border-gray-100">
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search campaigns…"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand"
          />
          <div className="flex items-center justify-between mt-1.5">
            <p className="text-xs text-gray-400">{selected.size} selected · {filtered.length} shown</p>
            <div className="flex gap-3">
              {archivedCount > 0 && (
                <button type="button" onClick={() => setShowArchived(v => !v)}
                  className="text-xs text-gray-400 hover:text-gray-600 hover:underline">
                  {showArchived ? `Hide archived` : `+${archivedCount} archived`}
                </button>
              )}
              <button
                type="button"
                onClick={() => setSelected(new Set(filtered.map(c => c.campaign_id)))}
                className="text-xs text-brand hover:underline font-medium"
              >
                Select all {filtered.length}
              </button>
              {selected.size > 0 && (
                <button
                  type="button"
                  onClick={() => setSelected(new Set())}
                  className="text-xs text-gray-400 hover:text-gray-600 hover:underline"
                >
                  Clear all
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-2 space-y-0.5">
          {filtered.length === 0 && (
            <p className="text-sm text-gray-400 py-4 text-center">No campaigns match your search.</p>
          )}
          {filtered.map(c => (
            <label key={c.campaign_id} className="flex items-center gap-3 py-2.5 cursor-pointer hover:bg-gray-50 rounded-lg px-2 -mx-2">
              <input
                type="checkbox"
                checked={selected.has(c.campaign_id)}
                onChange={() => toggle(c.campaign_id)}
                className="w-4 h-4 text-brand rounded border-gray-300 flex-shrink-0"
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-800 truncate">{c.campaign_name || c.campaign_id}</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {c.ad_type && <AdTypeBadge type={c.ad_type} />}
              </div>
            </label>
          ))}
        </div>
        {saveError && (
          <div className="mx-6 mb-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {saveError}
          </div>
        )}
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-100">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800">Cancel</button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-brand text-white text-sm font-medium rounded-lg hover:bg-brand-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving…' : `Save (${selected.size} campaigns)`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Budgets Tab ───────────────────────────────────────────────────────────────

function BudgetsTab({ showToast }) {
  const { data: budgets = [], isLoading } = useBudgets();
  const { data: availCampaigns = [] }     = useBudgetCampaigns();
  const createMutation                    = useCreateBudget();
  const updateMutation                    = useUpdateBudget();
  const deleteMutation                    = useDeleteBudget();
  const assignMutation                    = useUpdateBudgetCampaigns();

  const [showBudgetModal, setShowBudgetModal]   = useState(false);
  const [editingBudget, setEditingBudget]       = useState(null); // null = new
  const [assigningBudget, setAssigningBudget]   = useState(null);

  async function handleCreate(body) {
    await createMutation.mutateAsync(body);
    showToast('Budget created');
  }

  async function handleUpdate(id, body) {
    await updateMutation.mutateAsync({ id, body });
    showToast('Budget updated');
  }

  async function handleDelete(budget) {
    if (!confirm(`Delete budget "${budget.name}"? This cannot be undone.`)) return;
    await deleteMutation.mutateAsync(budget.budget_id);
    showToast('Budget deleted');
  }

  async function handleAssign(id, campaigns) {
    try {
      await assignMutation.mutateAsync({ id, campaigns });
      showToast(`${campaigns.length} campaign${campaigns.length !== 1 ? 's' : ''} assigned`);
    } catch (err) {
      throw err; // re-throw so CampaignAssignModal can surface the error
    }
  }

  const btnPrimary = 'px-4 py-2 bg-brand text-white text-sm font-medium rounded-lg hover:bg-brand-dark transition-colors';

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-500">Manage budgets and track campaign pacing.</p>
        <button onClick={() => { setEditingBudget(null); setShowBudgetModal(true); }} className={btnPrimary}>
          + New Budget
        </button>
      </div>

      {isLoading && (
        <div className="space-y-3">
          {[1,2].map(i => <div key={i} className="h-24 bg-gray-100 rounded-xl animate-pulse" />)}
        </div>
      )}

      {!isLoading && budgets.length === 0 && (
        <div className="text-center py-10 text-sm text-gray-400">
          No budgets yet. Click “+ New Budget” to get started.
        </div>
      )}

      {!isLoading && budgets.length > 0 && (
        <div className="space-y-3">
          {budgets.map(b => (
            <div key={b.budget_id} className="border border-gray-200 rounded-xl p-4">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-semibold text-gray-900">{b.name}</h4>
                    <PaceBadge status={b.pace_status} />
                    {b.marketplace && b.marketplace !== 'US' && (
                      <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">{b.marketplace}</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {fmtDateShort(b.period_start)} – {fmtDateShort(b.period_end)}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => setAssigningBudget(b)}
                    className="text-xs px-2.5 py-1 rounded-lg border border-gray-200 text-gray-600 hover:border-brand hover:text-brand transition-colors"
                  >
                    Manage Campaigns
                  </button>
                  <button
                    onClick={() => { setEditingBudget(b); setShowBudgetModal(true); }}
                    className="text-xs px-2.5 py-1 rounded-lg border border-gray-200 text-gray-600 hover:border-brand hover:text-brand transition-colors"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(b)}
                    className="text-xs px-2.5 py-1 rounded-lg border border-red-200 text-red-500 hover:bg-red-50 transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3 text-xs">
                <div>
                  <span className="text-gray-400">Total</span>
                  <p className="font-semibold text-gray-800">{fmt$(b.total_amount)}</p>
                </div>
                <div>
                  <span className="text-gray-400">Spent</span>
                  <p className="font-semibold text-gray-800">{fmt$(b.spent)}</p>
                </div>
                <div>
                  <span className="text-gray-400">Remaining</span>
                  <p className="font-semibold text-gray-800">{fmt$(b.remaining)}</p>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-3">
                <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${ b.pace_status === 'over' ? 'bg-red-500' : b.pace_status === 'under' ? 'bg-yellow-500' : 'bg-green-500'}`}
                    style={{ width: `${Math.min(100, Math.round((b.pct_used || 0) * 100))}%` }}
                  />
                </div>
                <span className="text-xs text-gray-500 flex-shrink-0">{Math.round((b.pct_used || 0) * 100)}% used</span>
              </div>
              {b.campaign_count > 0 && (
                <p className="text-xs text-gray-400 mt-2">{b.campaign_count} campaign{b.campaign_count !== 1 ? 's' : ''} assigned</p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Budget create/edit modal */}
      {showBudgetModal && (
        <BudgetModal
          budget={editingBudget}
          onClose={() => { setShowBudgetModal(false); setEditingBudget(null); }}
          onCreate={handleCreate}
          onUpdate={handleUpdate}
        />
      )}

      {/* Campaign assignment modal */}
      {assigningBudget && (
        <CampaignAssignModal
          budget={assigningBudget}
          allCampaigns={availCampaigns}
          onClose={() => setAssigningBudget(null)}
          onSave={handleAssign}
        />
      )}
    </div>
  );
}

// ─── Plan badge colours ─────────────────────────────────────────────────────
const PLAN_BADGE = {
  free:    { bg: 'bg-gray-100',   text: 'text-gray-600'   },
  starter: { bg: 'bg-blue-100',   text: 'text-blue-700'   },
  growth:  { bg: 'bg-indigo-100', text: 'text-indigo-700' },
  pro:     { bg: 'bg-purple-100', text: 'text-purple-700' },
};

const PLAN_LIMITS_SUMMARY = {
  free:    { connections: '1 connection',       dataWindow: '30-day data',   extras: 'Read-only analytics' },
  starter: { connections: '2 connections',      dataWindow: '90-day data',   extras: 'Vendor analytics, COGS' },
  growth:  { connections: '5 connections',      dataWindow: '1-year data',   extras: 'AI bids, 3 team seats' },
  pro:     { connections: 'Unlimited',          dataWindow: '2-year data',   extras: 'Unlimited seats, white-label' },
};

// ─── Billing Section ─────────────────────────────────────────────────────────
function BillingSection({ showToast }) {
  const [billing, setBilling]       = useState(null);
  const [billingLoading, setBillingLoading] = useState(true);
  const [portalLoading, setPortalLoading]   = useState(false);

  useEffect(() => {
    fetch('/billing/status', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(data => { setBilling(data); setBillingLoading(false); })
      .catch(() => setBillingLoading(false));
  }, []);

  async function openPortal() {
    setPortalLoading(true);
    try {
      const res = await fetch('/billing/portal', {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Portal unavailable');
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        throw new Error('No portal URL returned');
      }
    } catch (err) {
      showToast(err.message, 'error');
      setPortalLoading(false);
    }
  }

  if (billingLoading) {
    return (
      <div className="space-y-3">
        {[1,2,3].map(i => <div key={i} className="h-9 bg-gray-100 rounded-lg animate-pulse" />)}
      </div>
    );
  }

  const planId    = billing?.plan || 'free';
  const planName  = planId.charAt(0).toUpperCase() + planId.slice(1);
  const badge     = PLAN_BADGE[planId] || PLAN_BADGE.free;
  const limits    = PLAN_LIMITS_SUMMARY[planId] || PLAN_LIMITS_SUMMARY.free;
  const isPaid    = ['starter', 'growth', 'pro'].includes(planId) && billing?.hasSubscription;

  // Trial days remaining
  let trialDaysLeft = null;
  if (billing?.trialEndsAt) {
    const diff = new Date(billing.trialEndsAt) - Date.now();
    trialDaysLeft = Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
  }

  return (
    <div className="space-y-4">
      {/* Plan badge + name */}
      <div className="flex items-center gap-3">
        <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold ${badge.bg} ${badge.text}`}>
          {planName}
        </span>
        {billing?.status === 'trialing' && trialDaysLeft !== null && (
          <span className="text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full font-medium">
            Trial: {trialDaysLeft} day{trialDaysLeft !== 1 ? 's' : ''} left
          </span>
        )}
        {billing?.status === 'past_due' && (
          <span className="text-xs text-red-600 bg-red-50 px-2 py-0.5 rounded-full font-medium">
            ⚠️ Payment past due
          </span>
        )}
      </div>

      {/* Limits summary */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-gray-50 rounded-lg p-3 text-center">
          <p className="text-xs text-gray-400 mb-0.5">Connections</p>
          <p className="text-sm font-semibold text-gray-800">{limits.connections}</p>
        </div>
        <div className="bg-gray-50 rounded-lg p-3 text-center">
          <p className="text-xs text-gray-400 mb-0.5">Data Window</p>
          <p className="text-sm font-semibold text-gray-800">{limits.dataWindow}</p>
        </div>
        <div className="bg-gray-50 rounded-lg p-3 text-center">
          <p className="text-xs text-gray-400 mb-0.5">Features</p>
          <p className="text-sm font-semibold text-gray-800 text-xs leading-tight">{limits.extras}</p>
        </div>
      </div>

      {/* CTA */}
      {isPaid ? (
        <button
          onClick={openPortal}
          disabled={portalLoading}
          className="px-4 py-2 bg-brand text-white text-sm font-medium rounded-lg hover:bg-brand-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {portalLoading ? 'Opening…' : 'Manage Billing'}
        </button>
      ) : (
        <a
          href="/analytics/pricing"
          className="inline-flex items-center px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 transition-colors"
        >
          ⬆️ Upgrade Plan
        </a>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
// ─── Profile Picker Modal ────────────────────────────────────────────────────
function ProfilePickerModal({ pendingId, type, onComplete }) {
  const [profiles, setProfiles]     = useState([]);
  const [selected, setSelected]     = useState(new Set());
  const [loading, setLoading]       = useState(true);
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState(null);

  useEffect(() => {
    // Fetch profiles from the pending store via a lightweight endpoint
    fetch(`/amazon/pending-profiles?pendingId=${encodeURIComponent(pendingId)}`, { credentials: 'include' })
      .then(r => {
        if (r.status === 404) throw Object.assign(new Error('expired'), { expired: true });
        if (!r.ok) throw new Error(r.statusText);
        return r.json();
      })
      .then(data => {
        setProfiles(data.profiles || []);
        // Pre-select any profiles already active for this client
        const preSelected = new Set((data.profiles || []).filter(p => p.currentlyActive).map(p => p.profileId));
        setSelected(preSelected);
        setLoading(false);
      })
      .catch(e => { setError(e.expired ? 'expired' : 'Failed to load profiles: ' + e.message); setLoading(false); });
  }, [pendingId]);

  function toggle(profileId) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(profileId)) next.delete(profileId);
      else next.add(profileId);
      return next;
    });
  }

  async function handleConfirm() {
    if (selected.size === 0) { setError('Please select at least one profile.'); return; }
    setSaving(true); setError(null);
    try {
      const res = await fetch('/amazon/confirm-profile', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pendingId, selectedProfileIds: [...selected] }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || res.statusText); }
      onComplete();
    } catch (e) { setError(e.message); setSaving(false); }
  }

  const typeLabel = type === 'dsp' ? 'DSP' : 'Sponsored Ads';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 p-6">
        <h2 className="text-lg font-bold text-gray-900 mb-1">Select Amazon Ads Profile</h2>
        <p className="text-sm text-gray-500 mb-5">
          Choose the <strong>{typeLabel}</strong> profile to link to this brand account.
          Your Amazon login has access to multiple profiles — select the right one.
        </p>

        {loading && <div className="h-32 flex items-center justify-center text-gray-400 text-sm">Loading profiles…</div>}

        {!loading && error === 'expired' && (
          <div className="text-center py-6">
            <p className="text-sm font-medium text-gray-700 mb-1">Session expired</p>
            <p className="text-xs text-gray-400 mb-4">The authorization session timed out. Please reconnect to try again.</p>
            <a
              href={`/amazon/connect/${type}`}
              className="inline-flex items-center px-4 py-2 bg-brand text-white text-sm font-medium rounded-lg hover:bg-brand-dark transition-colors"
            >
              Reconnect {type === 'dsp' ? 'DSP' : 'Sponsored Ads'}
            </a>
          </div>
        )}

        {!loading && error !== 'expired' && profiles.length === 0 && (
          <div className="text-sm text-red-500 mb-4">No profiles found for this token. Please try reconnecting.</div>
        )}

        {!loading && profiles.length > 0 && (
          <div className="space-y-2 max-h-80 overflow-y-auto mb-5">
            {profiles.map(p => {
              const isSelected = selected.has(p.profileId);
              return (
                <button
                  key={p.profileId}
                  onClick={() => toggle(p.profileId)}
                  className={`w-full flex items-center gap-3 p-3 rounded-xl border-2 text-left transition-colors ${
                    isSelected ? 'border-green-600 bg-green-50' : 'border-gray-200 hover:border-gray-300 bg-white'
                  }`}
                >
                  <div className={`w-5 h-5 rounded flex-shrink-0 flex items-center justify-center border-2 ${
                    isSelected ? 'bg-green-600 border-green-600' : 'border-gray-300'
                  }`}>
                    {isSelected && <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-gray-800 text-sm">{p.name}</div>
                    <div className="text-xs text-gray-400">{p.type} · {p.countryCode} · {p.currency}</div>
                  </div>
                  {p.currentlyActive && (
                    <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full flex-shrink-0">Current</span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {error && error !== 'expired' && <p className="text-sm text-red-500 mb-3">{error}</p>}

        <div className="flex gap-3 justify-end">
          <a href="/account" className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</a>
          <button
            onClick={handleConfirm}
            disabled={saving || loading || selected.size === 0}
            className="px-5 py-2 text-sm font-semibold bg-green-700 text-white rounded-lg hover:bg-green-800 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Connecting…' : 'Connect Profile'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Account() {
  const [activeTab, setActiveTab]     = useState('profile');
  const [profile, setProfile]         = useState(null);
  const [connStatus, setConnStatus]   = useState(null);
  const [loading, setLoading]         = useState(true);
  const [toast, setToast]             = useState(null);
  const { hasRole, user } = useUser() || { hasRole: () => true, user: null };
  const { isAgencyView } = useAdvertiser() || {};
  const isAgency = user?.accountType === 'agency' || user?.account_type === 'agency';
  const canManage = hasRole('manager');

  // Profile picker — shown when redirected back from OAuth with ?selectProfile=1
  const urlParams = new URLSearchParams(window.location.search);
  const [pickerPendingId]  = useState(urlParams.get('pendingId'));
  const [pickerType]       = useState(urlParams.get('type'));
  const [showPicker, setShowPicker] = useState(!!urlParams.get('selectProfile') && !!urlParams.get('pendingId'));

  // Show OAuth error if Amazon redirected back with ?oauth_error=...
  const oauthError = urlParams.get('oauth_error');

  // Profile form state
  const [companyName, setCompanyName] = useState('');
  const [contactName, setContactName] = useState('');
  const [weeklyReport, setWeeklyReport] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);

  // Password form state
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw]         = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [savingPw, setSavingPw]   = useState(false);

  // Logo state
  const [logoUrl, setLogoUrl]     = useState(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const logoInputRef = useRef(null);

  // Team members
  const [team, setTeam]           = useState([]);
  const [newEmail, setNewEmail]   = useState('');
  const [newName, setNewMemberName] = useState('');
  const [newRole, setNewRole]     = useState('viewer');
  const [addingMember, setAddingMember] = useState(false);

  function showToast(message, type = 'success') {
    setToast({ message, type });
  }

  useEffect(() => {
    Promise.all([
      fetch('/account/profile',  { credentials: 'include' }).then(r => r.ok ? r.json() : null),
      fetch('/amazon/status',    { credentials: 'include' }).then(r => r.ok ? r.json() : null),
      fetch('/account/team',     { credentials: 'include' }).then(r => r.ok ? r.json() : []),
    ]).then(([prof, conn, teamData]) => {
      if (prof) {
        setProfile(prof);
        setCompanyName(prof.companyName || '');
        setContactName(prof.name || '');
        setWeeklyReport(prof.weeklyReportEnabled !== false);
        setLogoUrl(prof.logoUrl || null);
      }
      if (conn) setConnStatus(conn);
      // API returns array directly
      if (Array.isArray(teamData)) setTeam(teamData);
      setLoading(false);
    });
  }, []);

  // ── Profile save ────────────────────────────────────────────────────────────
  async function saveProfile(e) {
    e.preventDefault();
    setSavingProfile(true);
    try {
      const res = await fetch('/account/profile', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: contactName, companyName, weeklyReportEnabled: weeklyReport }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Save failed');
      showToast('Profile updated');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSavingProfile(false);
    }
  }

  // ── Password change ─────────────────────────────────────────────────────────
  async function changePassword(e) {
    e.preventDefault();
    if (newPw !== confirmPw) { showToast('Passwords do not match', 'error'); return; }
    if (newPw.length < 8)    { showToast('Password must be at least 8 characters', 'error'); return; }
    setSavingPw(true);
    try {
      const res = await fetch('/account/change-password', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: currentPw, newPassword: newPw }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Change failed');
      showToast('Password updated');
      setCurrentPw(''); setNewPw(''); setConfirmPw('');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSavingPw(false);
    }
  }

  // ── Logo upload ─────────────────────────────────────────────────────────────
  async function uploadLogo(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingLogo(true);
    const form = new FormData();
    form.append('logo', file);
    try {
      const res = await fetch('/account/logo', {
        method: 'POST',
        credentials: 'include',
        body: form,
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Upload failed');
      const data = await res.json();
      setLogoUrl(data.logoUrl);
      showToast('Logo updated');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setUploadingLogo(false);
      if (logoInputRef.current) logoInputRef.current.value = '';
    }
  }

  async function deleteLogo() {
    try {
      const res = await fetch('/account/logo', { method: 'DELETE', credentials: 'include' });
      if (!res.ok) throw new Error('Delete failed');
      setLogoUrl(null);
      showToast('Logo removed');
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  // ── Team members ────────────────────────────────────────────────────────────
  async function addTeamMember(e) {
    e.preventDefault();
    if (!newEmail) return;
    setAddingMember(true);
    try {
      const res = await fetch('/account/team', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: newEmail, name: newName, role: newRole }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to add member');
      // API returns { message, member } — refetch full list
      const list = await fetch('/account/team', { credentials: 'include' }).then(r => r.json()).catch(() => []);
      setTeam(Array.isArray(list) ? list : []);
      setNewEmail(''); setNewMemberName(''); setNewRole('viewer');
      showToast('Team member added');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setAddingMember(false);
    }
  }

  async function removeTeamMember(memberId) {
    if (!confirm('Remove this team member?')) return;
    try {
      const res = await fetch(`/account/team/${memberId}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) throw new Error('Remove failed');
      // Refetch updated list
      const list = await fetch('/account/team', { credentials: 'include' }).then(r => r.json()).catch(() => []);
      setTeam(Array.isArray(list) ? list : []);
      showToast('Team member removed');
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  const inputClass = "w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent";
  const btnPrimary = "px-4 py-2 bg-brand text-white text-sm font-medium rounded-lg hover:bg-brand-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

  const TABS = [
    { id: 'profile', label: 'Profile & Team' },
    { id: 'billing', label: '💳 Billing' },
    { id: 'budgets', label: '💰 Budgets' },
  ];

  return (
    <div className="max-w-2xl">
      {/* OAuth error banner — shown when Amazon redirects back with ?oauth_error= */}
      {oauthError && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-red-50 border border-red-200 rounded-xl px-6 py-4 shadow-lg max-w-lg w-full mx-4">
          <p className="text-sm font-semibold text-red-700 mb-1">Amazon authorization failed</p>
          <p className="text-xs text-red-500">{decodeURIComponent(oauthError)}</p>
          <button
            className="mt-3 text-xs text-red-600 underline"
            onClick={() => window.history.replaceState({}, '', '/analytics/account')}
          >Dismiss</button>
        </div>
      )}

      {/* Profile picker modal — shown after OAuth redirect */}
      {showPicker && pickerPendingId && (
        <ProfilePickerModal
          pendingId={pickerPendingId}
          type={pickerType}
          onComplete={() => {
            // Strip picker params from URL and reload connections
            window.history.replaceState({}, '', '/analytics/account?connected=' + pickerType);
            setShowPicker(false);
            // Refresh connection status
            fetch('/amazon/status', { credentials: 'include' })
              .then(r => r.ok ? r.json() : null)
              .then(conn => { if (conn) setConnStatus(conn); });
          }}
        />
      )}

      {/* Agency view — completely different layout */}
      {isAgency && isAgencyView ? (
        <AgencyAccountView
          user={user}
          profile={profile}
          loading={loading}
          logoUrl={logoUrl}
          uploadingLogo={uploadingLogo}
          logoInputRef={logoInputRef}
          uploadLogo={uploadLogo}
          deleteLogo={deleteLogo}
          companyName={companyName}
          setCompanyName={setCompanyName}
          contactName={contactName}
          setContactName={setContactName}
          saveProfile={saveProfile}
          savingProfile={savingProfile}
          showToast={showToast}
          canManage={canManage}
          inputClass={inputClass}
          btnPrimary={btnPrimary}
          team={team}
          newEmail={newEmail}
          setNewEmail={setNewEmail}
          newName={newName}
          setNewMemberName={setNewMemberName}
          newRole={newRole}
          setNewRole={setNewRole}
          addingMember={addingMember}
          addTeamMember={addTeamMember}
          removeTeamMember={removeTeamMember}
        />
      ) : (<>

      <PageHeader title="Account" subtitle="Manage your profile, connections, and team" />

      {/* ── Tab navigation ───────────────────────────────────────────────── */}
      <div className="flex gap-1 mb-6 border-b border-gray-200">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === tab.id
                ? 'border-brand text-brand'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Billing tab ──────────────────────────────────────────────────── */}
      {activeTab === 'billing' && (
        <Section title="💳 Billing & Plan">
          <BillingSection showToast={showToast} />
        </Section>
      )}

      {/* ── Budgets tab ──────────────────────────────────────────────────── */}
      {activeTab === 'budgets' && (
        <Section title="💰 Budget Tracker">
          <BudgetsTab showToast={showToast} />
        </Section>
      )}

      {/* ── Profile tab ──────────────────────────────────────────────────── */}
      {activeTab === 'profile' && <>

      {/* ── Branding ─────────────────────────────────────────────────────────── */}
      {canManage && <Section title="🖼️ Branding">
        <div className="flex items-center gap-4">
          <div className="w-20 h-20 rounded-lg border border-gray-200 bg-gray-50 flex items-center justify-center overflow-hidden flex-shrink-0">
            {logoUrl
              ? <img src={logoUrl} alt="Logo" className="w-full h-full object-contain p-1" />
              : <span className="text-xs text-gray-400 text-center px-1">No logo</span>
            }
          </div>
          <div className="space-y-2">
            <input type="file" ref={logoInputRef} accept="image/*" onChange={uploadLogo} className="hidden" />
            <button
              onClick={() => logoInputRef.current?.click()}
              disabled={uploadingLogo}
              className={btnPrimary}
            >
              {uploadingLogo ? 'Uploading…' : 'Upload Logo'}
            </button>
            {logoUrl && (
              <button onClick={deleteLogo} className="ml-2 text-sm text-red-600 hover:text-red-700">
                Remove
              </button>
            )}
            <p className="text-xs text-gray-400">PNG, JPG or SVG. Appears in the sidebar and reports.</p>
          </div>
        </div>
      </Section>}

      {/* ── Profile ──────────────────────────────────────────────────────────── */}
      <Section title="👤 Profile">
        {loading ? (
          <div className="space-y-3">
            {[1,2,3].map(i => <div key={i} className="h-9 bg-gray-100 rounded-lg animate-pulse" />)}
          </div>
        ) : (
          <form onSubmit={saveProfile} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Email</label>
              <input value={profile?.email || ''} disabled className={`${inputClass} bg-gray-50 text-gray-500`} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Contact Name</label>
              <input value={contactName} onChange={e => canManage && setContactName(e.target.value)} readOnly={!canManage} className={`${inputClass} ${!canManage ? 'bg-gray-50 text-gray-500' : ''}`} placeholder="Jane Smith" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Company Name</label>
              <input value={companyName} onChange={e => canManage && setCompanyName(e.target.value)} readOnly={!canManage} className={`${inputClass} ${!canManage ? 'bg-gray-50 text-gray-500' : ''}`} placeholder="Acme Brands LLC" />
            </div>
            <div className="flex items-center gap-2 pt-1">
              <input
                type="checkbox"
                id="weekly-report"
                checked={weeklyReport}
                onChange={e => setWeeklyReport(e.target.checked)}
                className="w-4 h-4 text-brand rounded border-gray-300"
              />
              <label htmlFor="weekly-report" className="text-sm text-gray-600">Receive weekly performance email</label>
            </div>
            {canManage && (
              <button type="submit" disabled={savingProfile} className={btnPrimary}>
                {savingProfile ? 'Saving…' : 'Save Profile'}
              </button>
            )}
          </form>
        )}
      </Section>

      {/* ── Password ─────────────────────────────────────────────────────────── */}
      <Section title="🔒 Change Password">
        <form onSubmit={changePassword} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Current Password</label>
            <input type="password" value={currentPw} onChange={e => setCurrentPw(e.target.value)} className={inputClass} placeholder="••••••••" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">New Password</label>
            <input type="password" value={newPw} onChange={e => setNewPw(e.target.value)} className={inputClass} placeholder="••••••••" minLength={8} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Confirm New Password</label>
            <input type="password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)} className={inputClass} placeholder="••••••••" />
          </div>
          <button type="submit" disabled={savingPw || !currentPw || !newPw || !confirmPw} className={btnPrimary}>
            {savingPw ? 'Updating…' : 'Update Password'}
          </button>
        </form>
      </Section>

      {/* ── Amazon Connections ───────────────────────────────────────────────── */}
      <Section title="🔗 Amazon Connections">
        {loading ? (
          <div className="space-y-3">
            {[1,2,3,4].map(i => <div key={i} className="h-10 bg-gray-100 rounded animate-pulse" />)}
          </div>
        ) : (
          <div>
            {/* US connections */}
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">🇺🇸 United States</p>
            <ConnectionBadge label="Advertising API (SP / SB / SD)" connected={connStatus?.ads?.connected}    connectedAt={connStatus?.ads?.connectedAt} />
            <ConnectionBadge label="DSP"                             connected={connStatus?.dsp?.connected}    connectedAt={connStatus?.dsp?.connectedAt} />
            <ConnectionBadge label="Vendor Central"                  connected={connStatus?.vendor?.connected} connectedAt={connStatus?.vendor?.connectedAt} />
            <ConnectionBadge label="Seller Central"                  connected={connStatus?.seller?.connected} connectedAt={connStatus?.seller?.connectedAt} />

            {/* CA connections — same OAuth token, separate marketplace profile */}
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mt-4 mb-2">🇨🇦 Canada</p>
            <ConnectionBadge label="Advertising API (SP / SB / SD)" connected={connStatus?.ads?.connected}    connectedAt={connStatus?.ads?.connectedAt} />
            <p className="text-xs text-gray-400 mt-1 mb-2 italic">Note: CA advertising shares the same connection as US. Retail data (Seller/Vendor) is US-only.</p>

            <div className="pt-3 mt-3 border-t border-gray-100 space-y-2">
              <ConnectButton label="Connect / Reconnect Advertising (US + CA)"  href="/amazon/connect/ads" />
              <ConnectButton label="Connect / Reconnect DSP"                    href="/amazon/connect/dsp" />
              <ConnectButton label="Connect / Reconnect Vendor Central"         href="/amazon/connect/vendor" />
              <ConnectButton label="Connect / Reconnect Seller Central"         href="/amazon/connect/seller" />
            </div>
          </div>
        )}
      </Section>

      {/* ── Team Members ─────────────────────────────────────────────────────── */}
      <Section title="👥 Team Members">
        {team.length > 0 && (
          <div className="mb-4 divide-y divide-gray-100">
            {team.map(m => (
              <div key={m.id} className="flex items-center justify-between py-2.5">
                <div>
                  <p className="text-sm font-medium text-gray-800">{m.name || m.email}</p>
                  <p className="text-xs text-gray-400">{m.email} · <span className="capitalize">{m.role}</span></p>
                </div>
                {canManage && (
                  <button onClick={() => removeTeamMember(m.id)} className="text-xs text-red-500 hover:text-red-700">
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        {canManage && <form onSubmit={addTeamMember} className="space-y-2 pt-2 border-t border-gray-100">
          <p className="text-xs font-medium text-gray-500 mb-2">Add team member</p>
          <div className="flex gap-2">
            <input value={newName}  onChange={e => setNewMemberName(e.target.value)} className={`${inputClass} flex-1`} placeholder="Name" />
            <input value={newEmail} onChange={e => setNewEmail(e.target.value)}      className={`${inputClass} flex-1`} placeholder="Email" type="email" required />
          </div>
          <div className="flex gap-2">
            <select value={newRole} onChange={e => setNewRole(e.target.value)} className={`${inputClass} flex-1`}>
              <option value="viewer">Viewer</option>
              <option value="analyst">Analyst</option>
              <option value="manager">Manager</option>
            </select>
            <button type="submit" disabled={addingMember || !newEmail} className={`${btnPrimary} flex-shrink-0`}>
              {addingMember ? 'Adding…' : 'Add'}
            </button>
          </div>
        </form>}
      </Section>

      {/* ── Sign Out ─────────────────────────────────────────────────────────── */}
      <div className="pt-2">
        <a href="/auth/logout" className="text-sm text-red-600 hover:text-red-700 font-medium">
          Sign out
        </a>
      </div>

      </> /* end profile tab */}

      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
      )}

      </> /* end brand view */
      )} {/* end isAgency && isAgencyView ternary */}
    </div>
  );
}

// ─── Agency-only Account layout ───────────────────────────────────────────────

function AgencyAccountView({
  profile, loading,
  logoUrl, uploadingLogo, logoInputRef, uploadLogo, deleteLogo,
  companyName, setCompanyName, contactName, setContactName,
  saveProfile, savingProfile,
  showToast, canManage, inputClass, btnPrimary,
  team, newEmail, setNewEmail, newName, setNewMemberName,
  newRole, setNewRole, addingMember, addTeamMember, removeTeamMember,
}) {
  return (
    <div className="max-w-2xl">
      <PageHeader
        title="Agency Settings"
        subtitle="Manage your agency account, billing, and team"
      />

      {/* ── Agency Settings (name + logo) ─────────────────────────────────── */}
      {canManage && (
        <Section title="🏢 Agency Settings">
          <div className="space-y-4">
            <form onSubmit={saveProfile} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Agency Name</label>
                <input
                  value={companyName}
                  onChange={e => setCompanyName(e.target.value)}
                  className={inputClass}
                  placeholder="Acme Agency LLC"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Contact Name</label>
                <input
                  value={contactName}
                  onChange={e => setContactName(e.target.value)}
                  className={inputClass}
                  placeholder="Jane Smith"
                />
              </div>
              <button type="submit" disabled={savingProfile} className={btnPrimary}>
                {savingProfile ? 'Saving…' : 'Save'}
              </button>
            </form>

            <div className="pt-3 border-t border-gray-100">
              <p className="text-xs font-medium text-gray-500 mb-2">Agency Logo</p>
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-lg border border-gray-200 bg-gray-50 flex items-center justify-center overflow-hidden flex-shrink-0">
                  {logoUrl
                    ? <img src={logoUrl} alt="Logo" className="w-full h-full object-contain p-1" />
                    : <span className="text-xs text-gray-400 text-center px-1">No logo</span>
                  }
                </div>
                <div className="space-y-1">
                  <input type="file" ref={logoInputRef} accept="image/*" onChange={uploadLogo} className="hidden" />
                  <button
                    onClick={() => logoInputRef.current?.click()}
                    disabled={uploadingLogo}
                    className={btnPrimary}
                  >
                    {uploadingLogo ? 'Uploading…' : 'Upload Logo'}
                  </button>
                  {logoUrl && (
                    <button onClick={deleteLogo} className="ml-2 text-sm text-red-600 hover:text-red-700">
                      Remove
                    </button>
                  )}
                  <p className="text-xs text-gray-400">Appears in the sidebar and reports.</p>
                </div>
              </div>
            </div>
          </div>
        </Section>
      )}

      {/* ── Billing ───────────────────────────────────────────────────────── */}
      <Section title="💳 Billing & Plan">
        <BillingSection showToast={showToast} />
      </Section>

      {/* ── Team ──────────────────────────────────────────────────────────── */}
      <Section title="👥 Team Members">
        {team.length > 0 && (
          <div className="mb-4 divide-y divide-gray-100">
            {team.map(m => (
              <div key={m.id} className="flex items-center justify-between py-2.5">
                <div>
                  <p className="text-sm font-medium text-gray-800">{m.name || m.email}</p>
                  <p className="text-xs text-gray-400">{m.email} · <span className="capitalize">{m.role}</span></p>
                </div>
                {canManage && (
                  <button onClick={() => removeTeamMember(m.id)} className="text-xs text-red-500 hover:text-red-700">
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        {team.length === 0 && <p className="text-sm text-gray-400 mb-3">No team members yet.</p>}
        {canManage && (
          <form onSubmit={addTeamMember} className="space-y-2 pt-2 border-t border-gray-100">
            <p className="text-xs font-medium text-gray-500 mb-2">Add team member</p>
            <div className="flex gap-2">
              <input value={newName}  onChange={e => setNewMemberName(e.target.value)} className={`${inputClass} flex-1`} placeholder="Name" />
              <input value={newEmail} onChange={e => setNewEmail(e.target.value)}      className={`${inputClass} flex-1`} placeholder="Email" type="email" required />
            </div>
            <div className="flex gap-2">
              <select value={newRole} onChange={e => setNewRole(e.target.value)} className={`${inputClass} flex-1`}>
                <option value="viewer">Viewer</option>
                <option value="analyst">Analyst</option>
                <option value="manager">Manager</option>
              </select>
              <button type="submit" disabled={addingMember || !newEmail} className={`${btnPrimary} flex-shrink-0`}>
                {addingMember ? 'Adding…' : 'Add'}
              </button>
            </div>
          </form>
        )}
      </Section>

      {/* ── Sign out ──────────────────────────────────────────────────────── */}
      <div className="pt-2">
        <a href="/auth/logout" className="text-sm text-red-600 hover:text-red-700 font-medium">
          Sign out
        </a>
      </div>
    </div>
  );
}
