import { useState } from 'react';
import { Link } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import { useBudgets } from '../hooks/useAnalytics';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt$(n) {
  if (n == null) return '$0';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}

function fmtDate(d) {
  if (!d) return '';
  const date = new Date(d);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function StatusBadge({ status }) {
  const map = {
    on_pace: { label: 'On Pace',     bg: 'bg-green-100',  text: 'text-green-800'  },
    over:    { label: 'Overspending', bg: 'bg-red-100',    text: 'text-red-800'    },
    under:   { label: 'Under',       bg: 'bg-yellow-100', text: 'text-yellow-800' },
  };
  const s = map[status] || map.on_pace;
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${s.bg} ${s.text}`}>
      {s.label}
    </span>
  );
}

function ProgressBar({ pctUsed, status }) {
  const colorMap = {
    on_pace: 'bg-green-500',
    over:    'bg-red-500',
    under:   'bg-yellow-500',
  };
  const color = colorMap[status] || 'bg-green-500';
  const pct   = Math.min(100, Math.round((pctUsed || 0) * 100));
  return (
    <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
      <div
        className={`h-full rounded-full transition-all duration-500 ${color}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function MetricBlock({ label, value }) {
  return (
    <div className="text-center">
      <div className="text-xs text-gray-400 uppercase tracking-wide mb-0.5">{label}</div>
      <div className="text-sm font-semibold text-gray-800">{value}</div>
    </div>
  );
}

const AD_TYPE_BADGE = {
  SP:  { bg: 'bg-blue-100',   text: 'text-blue-800'   },
  SB:  { bg: 'bg-green-100',  text: 'text-green-800'  },
  SD:  { bg: 'bg-amber-100',  text: 'text-amber-800'  },
  DSP: { bg: 'bg-purple-100', text: 'text-purple-800' },
};

function AdTypeBadge({ adType }) {
  const key = (adType || '').toUpperCase();
  const style = AD_TYPE_BADGE[key] || { bg: 'bg-gray-100', text: 'text-gray-600' };
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-semibold ${style.bg} ${style.text}`}>
      {key || adType}
    </span>
  );
}

function BudgetCard({ budget }) {
  const pct = Math.round((budget.pct_used || 0) * 100);
  const hasCampaigns = Array.isArray(budget.campaigns) && budget.campaigns.length > 0;
  const [open, setOpen] = useState(false);

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-gray-900">{budget.name}</h3>
          <p className="text-xs text-gray-400 mt-0.5">
            {fmtDate(budget.period_start)} – {fmtDate(budget.period_end)}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {hasCampaigns ? (
            <button
              onClick={() => setOpen(o => !o)}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 cursor-pointer transition-colors"
              aria-expanded={open}
              aria-label={open ? 'Hide campaigns' : 'Show campaigns'}
            >
              {budget.campaign_count} campaign{budget.campaign_count !== 1 ? 's' : ''}
              <span className="text-gray-400">{open ? '▲' : '▼'}</span>
            </button>
          ) : budget.campaign_count > 0 ? (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
              {budget.campaign_count} campaign{budget.campaign_count !== 1 ? 's' : ''}
            </span>
          ) : null}
          <StatusBadge status={budget.pace_status} />
        </div>
      </div>

      {/* Four metrics */}
      <div className="grid grid-cols-4 gap-2 py-3 border-y border-gray-100">
        <MetricBlock label="Total Budget"  value={fmt$(budget.total_amount)} />
        <MetricBlock label="Spent"         value={fmt$(budget.spent)} />
        <MetricBlock label="Remaining"     value={fmt$(budget.remaining)} />
        <MetricBlock label="Days Left"     value={budget.days_remaining} />
      </div>

      {/* Progress bar */}
      <div className="space-y-1.5">
        <div className="flex justify-between text-xs text-gray-400">
          <span>0%</span>
          <span className="font-medium text-gray-600">{pct}% used</span>
          <span>100%</span>
        </div>
        <ProgressBar pctUsed={budget.pct_used} status={budget.pace_status} />
      </div>

      {/* Below bar: pace metrics */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
        <span>Ideal pace: <strong className="text-gray-700">{fmt$(budget.ideal_spend)}</strong></span>
        <span>Projected total: <strong className="text-gray-700">{fmt$(budget.projected_total)}</strong></span>
        <span>Daily burn: <strong className="text-gray-700">{fmt$(budget.daily_burn_rate)}/day</strong></span>
      </div>

      {/* Collapsible campaign list */}
      {hasCampaigns && open && (
        <div className="border-t border-gray-100 pt-3 space-y-1.5">
          {budget.campaigns.map(c => (
            <div key={c.campaign_id} className="flex items-center gap-2">
              <AdTypeBadge adType={c.ad_type} />
              <span className="text-xs text-gray-700 truncate" title={c.campaign_name}>
                {c.campaign_name}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Pacing() {
  const { data: budgets, isLoading, isError } = useBudgets();

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Budget Pacing"
        subtitle="Track spend vs budget across all active campaigns"
      />

      {isLoading && (
        <div className="space-y-4 mt-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-white rounded-xl border border-gray-200 p-5 space-y-3 animate-pulse">
              <div className="h-5 bg-gray-100 rounded w-1/3" />
              <div className="h-3 bg-gray-100 rounded w-1/4" />
              <div className="grid grid-cols-4 gap-2 py-3 border-y border-gray-100">
                {[1,2,3,4].map(j => <div key={j} className="h-8 bg-gray-100 rounded" />)}
              </div>
              <div className="h-3 bg-gray-100 rounded" />
            </div>
          ))}
        </div>
      )}

      {isError && (
        <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          Failed to load budgets. Please refresh and try again.
        </div>
      )}

      {!isLoading && !isError && budgets?.length === 0 && (
        <div className="mt-8 text-center py-16 bg-white rounded-xl border border-gray-200">
          <div className="text-4xl mb-3">💰</div>
          <h3 className="text-base font-semibold text-gray-800 mb-1">No budgets yet</h3>
          <p className="text-sm text-gray-400 mb-4">
            Create a budget and assign campaigns to start tracking pacing.
          </p>
          <Link
            to="/account"
            className="inline-flex items-center px-4 py-2 bg-brand text-white text-sm font-medium rounded-lg hover:bg-brand-dark transition-colors"
          >
            Go to Account → Budgets
          </Link>
        </div>
      )}

      {!isLoading && !isError && budgets?.length > 0 && (
        <div className="space-y-4 mt-2">
          {budgets.map(b => (
            <BudgetCard key={b.budget_id} budget={b} />
          ))}
        </div>
      )}
    </div>
  );
}
