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
  const s = String(d).substring(0, 10);
  const [year, month, day] = s.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function StatusBadge({ status }) {
  const map = {
    on_pace: { label: 'On Pace',      bg: 'bg-green-100',  text: 'text-green-800'  },
    over:    { label: 'Overspending', bg: 'bg-red-100',    text: 'text-red-800'    },
    under:   { label: 'Under Pacing', bg: 'bg-yellow-100', text: 'text-yellow-800' },
  };
  const s = map[status] || map.on_pace;
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${s.bg} ${s.text}`}>
      {s.label}
    </span>
  );
}

function VelocityBadge({ velocity, burnRate7d, dailyBurnRate }) {
  if (!velocity) return null;
  const map = {
    accelerating: { arrow: '↗', color: 'text-green-600', label: 'Accelerating' },
    decelerating: { arrow: '↘', color: 'text-red-500',   label: 'Decelerating' },
    steady:       { arrow: '→', color: 'text-gray-400',  label: 'Steady'       },
  };
  const v = map[velocity] || map.steady;
  const tooltip = `Last 7d burn: ${fmt$(burnRate7d)}/day vs avg ${fmt$(dailyBurnRate)}/day`;
  return (
    <span className={`text-base font-bold ${v.color}`} title={tooltip}>
      {v.arrow}
    </span>
  );
}

function AlertBadges({ budget }) {
  const badges = [];
  if (budget.alert_flight_risk)   badges.push({ key: 'fr',  emoji: '🔴', label: 'Flight Risk',        cls: 'bg-red-50 text-red-700 border-red-200' });
  if (budget.alert_underdelivery) badges.push({ key: 'ud',  emoji: '🟡', label: 'Underdelivery Risk', cls: 'bg-amber-50 text-amber-700 border-amber-200' });
  if (budget.alert_spike)         badges.push({ key: 'sp',  emoji: '⚡', label: 'Spend Spike',        cls: 'bg-orange-50 text-orange-700 border-orange-200' });
  if (!badges.length) return null;
  return (
    <>
      {badges.map(b => (
        <span key={b.key} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${b.cls}`}>
          {b.emoji} {b.label}
        </span>
      ))}
    </>
  );
}

function ProgressBar({ pctUsed, status }) {
  const colorMap = { on_pace: 'bg-green-500', over: 'bg-red-500', under: 'bg-yellow-500' };
  const color = colorMap[status] || 'bg-green-500';
  const pct   = Math.min(100, Math.round((pctUsed || 0) * 100));
  return (
    <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
      <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function MetricBlock({ label, value, highlight }) {
  return (
    <div className="text-center">
      <div className="text-xs text-gray-400 uppercase tracking-wide mb-0.5">{label}</div>
      <div className={`text-sm font-semibold ${highlight ? 'text-indigo-700' : 'text-gray-800'}`}>{value}</div>
    </div>
  );
}

const AD_TYPE_BADGE = {
  SP:  { bg: 'bg-blue-100',   text: 'text-blue-800'   },
  SB:  { bg: 'bg-green-100',  text: 'text-green-800'  },
  SD:  { bg: 'bg-amber-100',  text: 'text-amber-800'  },
  DSP: { bg: 'bg-purple-100', text: 'text-purple-800' },
};

const AD_TYPE_COLOR = { SP: '#2563eb', SB: '#10b981', SD: '#f59e0b', DSP: '#8b5cf6' };

function AdTypeBadge({ adType }) {
  const key = (adType || '').toUpperCase();
  const style = AD_TYPE_BADGE[key] || { bg: 'bg-gray-100', text: 'text-gray-600' };
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-semibold ${style.bg} ${style.text}`}>
      {key || adType}
    </span>
  );
}

function SpendTypeBar({ spendByType, totalSpent }) {
  if (!spendByType || !totalSpent || totalSpent <= 0) return null;
  const types = ['SP', 'SB', 'SD', 'DSP'];
  const segments = types.map(t => ({ type: t, spend: spendByType[t] || 0, pct: ((spendByType[t] || 0) / totalSpent) * 100 }));
  const hasData = segments.some(s => s.spend > 0);
  if (!hasData) return null;
  return (
    <div className="space-y-1.5">
      <div className="flex w-full h-2 rounded-full overflow-hidden gap-px">
        {segments.map(s => s.pct > 0 && (
          <div key={s.type} style={{ width: `${s.pct}%`, backgroundColor: AD_TYPE_COLOR[s.type] }} title={`${s.type}: ${fmt$(s.spend)}`} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-400">
        {segments.filter(s => s.spend > 0).map(s => (
          <span key={s.type}>
            <span className="inline-block w-2 h-2 rounded-sm mr-1" style={{ backgroundColor: AD_TYPE_COLOR[s.type] }} />
            {fmt$(s.spend)} {s.type}
          </span>
        ))}
      </div>
    </div>
  );
}

function PaceCallout({ budget }) {
  const { pace_status, required_daily_rate, days_remaining, projected_total, total_amount } = budget;
  if (pace_status === 'under' && required_daily_rate > 0) {
    return (
      <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
        <span>⚠️</span>
        <span>Need <strong>{fmt$(required_daily_rate)}/day</strong> for the remaining {days_remaining} days to hit budget</span>
      </div>
    );
  }
  if (pace_status === 'over' && projected_total && total_amount) {
    const overspend = projected_total - total_amount;
    const overpct   = total_amount > 0 ? ((overspend / total_amount) * 100).toFixed(1) : 0;
    if (overspend > 0) {
      return (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">
          <span>🔴</span>
          <span>On track to overspend by <strong>{fmt$(overspend)}</strong> (+{overpct}%)</span>
        </div>
      );
    }
  }
  return null;
}

function BudgetCard({ budget }) {
  const pct = Math.round((budget.pct_used || 0) * 100);
  const hasCampaigns = Array.isArray(budget.campaigns) && budget.campaigns.length > 0;
  const [open, setOpen] = useState(false);

  // Sort campaigns by mtd_spend desc
  const sortedCampaigns = hasCampaigns
    ? [...budget.campaigns].sort((a, b) => (b.mtd_spend || 0) - (a.mtd_spend || 0))
    : [];

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
        <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
          <AlertBadges budget={budget} />
          {hasCampaigns ? (
            <button
              onClick={() => setOpen(o => !o)}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 cursor-pointer transition-colors"
              aria-expanded={open}
            >
              {budget.campaign_count} campaign{budget.campaign_count !== 1 ? 's' : ''}
              <span className="text-gray-400">{open ? '▲' : '▼'}</span>
            </button>
          ) : budget.campaign_count > 0 ? (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
              {budget.campaign_count} campaign{budget.campaign_count !== 1 ? 's' : ''}
            </span>
          ) : null}
          <VelocityBadge velocity={budget.velocity} burnRate7d={budget.burn_rate_7d} dailyBurnRate={budget.daily_burn_rate} />
          <StatusBadge status={budget.pace_status} />
        </div>
      </div>

      {/* Four metrics */}
      <div className="grid grid-cols-4 gap-2 py-3 border-y border-gray-100">
        <MetricBlock label="Total Budget"  value={fmt$(budget.total_amount)} />
        <MetricBlock label="Spent"         value={fmt$(budget.spent)} />
        <MetricBlock label="Remaining"     value={fmt$(budget.remaining)} />
        <MetricBlock label="Days Left"     value={budget.days_remaining ?? '—'} />
      </div>

      {/* Pace callout */}
      <PaceCallout budget={budget} />

      {/* Progress bar */}
      <div className="space-y-1.5">
        <div className="flex justify-between text-xs text-gray-400">
          <span>0%</span>
          <span className="font-medium text-gray-600">{pct}% used</span>
          <span>100%</span>
        </div>
        <ProgressBar pctUsed={budget.pct_used} status={budget.pace_status} />
      </div>

      {/* Per-type stacked bar */}
      <SpendTypeBar spendByType={budget.spend_by_type} totalSpent={budget.spent} />

      {/* Pace metrics row */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
        <span>Ideal pace: <strong className="text-gray-700">{fmt$(budget.ideal_spend)}</strong></span>
        <span>Projected total: <strong className="text-gray-700">{fmt$(budget.projected_total)}</strong></span>
        <span>Daily burn: <strong className="text-gray-700">{fmt$(budget.daily_burn_rate)}/day</strong></span>
        {budget.burn_rate_7d != null && (
          <span>7d burn: <strong className="text-gray-700">{fmt$(budget.burn_rate_7d)}/day</strong></span>
        )}
        {budget.required_daily_rate > 0 && budget.pace_status !== 'over' && (
          <span>Required rate: <strong className="text-indigo-700">{fmt$(budget.required_daily_rate)}/day</strong></span>
        )}
      </div>

      {/* Collapsible campaign list */}
      {hasCampaigns && open && (
        <div className="border-t border-gray-100 pt-3 space-y-2">
          {sortedCampaigns.map(c => {
            const campaignPct = budget.spent > 0 ? Math.min(100, ((c.mtd_spend || 0) / budget.spent) * 100) : 0;
            return (
              <div key={c.campaign_id} className="space-y-1">
                <div className="flex items-center gap-2">
                  <AdTypeBadge adType={c.ad_type} />
                  <span className="text-xs text-gray-700 truncate flex-1" title={c.campaign_name}>
                    {c.campaign_name}
                  </span>
                  <span className="text-xs font-semibold text-gray-700 flex-shrink-0">{fmt$(c.mtd_spend || 0)}</span>
                </div>
                {campaignPct > 0 && (
                  <div className="ml-8 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-indigo-400 rounded-full" style={{ width: `${campaignPct}%` }} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Summary header bar ───────────────────────────────────────────────────────

function SummaryBar({ budgets }) {
  const totalBudget   = budgets.reduce((s, b) => s + (b.total_amount || 0), 0);
  const totalSpent    = budgets.reduce((s, b) => s + (b.spent || 0), 0);
  const totalRemaining = budgets.reduce((s, b) => s + (b.remaining || 0), 0);
  const minDaysLeft   = Math.min(...budgets.map(b => b.days_remaining ?? 999).filter(d => d < 999));
  const reqRate       = budgets.reduce((s, b) => s + ((b.required_daily_rate || 0) * (b.days_remaining || 0)), 0)
    / (budgets.reduce((s, b) => s + (b.days_remaining || 0), 0) || 1);

  // Overall pace: if any is over → over; if any is under → under; else on_pace
  const overallStatus = budgets.some(b => b.pace_status === 'over')
    ? 'over' : budgets.some(b => b.pace_status === 'under') ? 'under' : 'on_pace';

  const pctUsed = totalBudget > 0 ? (totalSpent / totalBudget) * 100 : 0;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
      <div className="grid grid-cols-5 gap-4 divide-x divide-gray-100">
        <MetricBlock label="Total Budget"    value={fmt$(totalBudget)} />
        <MetricBlock label="Total Spent"     value={`${fmt$(totalSpent)} (${pctUsed.toFixed(1)}%)`} />
        <div className="text-center">
          <div className="text-xs text-gray-400 uppercase tracking-wide mb-1">Overall Pace</div>
          <StatusBadge status={overallStatus} />
        </div>
        <MetricBlock label="Days Left"       value={minDaysLeft < 999 ? minDaysLeft : '—'} />
        <MetricBlock label="Req. Daily Rate" value={fmt$(reqRate) + '/day'} highlight />
      </div>
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
        <>
          <SummaryBar budgets={budgets} />
          <div className="space-y-4">
            {budgets.map(b => (
              <BudgetCard key={b.budget_id} budget={b} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
