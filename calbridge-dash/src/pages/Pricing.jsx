import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../components/PageHeader';

// ─── Plan definitions ─────────────────────────────────────────────────────────

// ─── Comparison table data ───────────────────────────────────────────────────

const COMPARISON_SECTIONS = [
  {
    label: 'Connections & Data',
    rows: [
      { feature: 'Amazon connections',          free: '1',          starter: '2',          growth: 'Unlimited',  pro: 'Unlimited',  agency: 'Unlimited' },
      { feature: 'Data history',                free: '30 days',    starter: '90 days',    growth: '1 year',     pro: '3 years',    agency: '3 years'   },
      { feature: 'SP / SB / SD / DSP dashboard',free: true,         starter: true,         growth: true,         pro: true,         agency: true        },
      { feature: 'Vendor analytics',            free: false,        starter: true,         growth: true,         pro: true,         agency: true        },
    ],
  },
  {
    label: 'Analytics & Margin',
    rows: [
      { feature: 'Contribution margin per campaign', free: false,  starter: true,         growth: true,         pro: true,         agency: true        },
      { feature: 'COGS tracking',               free: false,        starter: true,         growth: true,         pro: true,         agency: true        },
      { feature: 'Budget tracking & daily pacing',free: false,      starter: true,         growth: true,         pro: true,         agency: true        },
    ],
  },
  {
    label: 'Automation & AI',
    rows: [
      { feature: 'Manual recommendations',      free: false,        starter: true,         growth: true,         pro: true,         agency: true        },
      { feature: 'AI decisions + 1-click execution', free: false,   starter: false,        growth: true,         pro: true,         agency: true        },
      { feature: 'Budget automation (auto-pause / resume)', free: false, starter: false,   growth: true,         pro: true,         agency: true        },
      { feature: 'Smart alerts (spend spikes, ACoS drift)', free: false, starter: false,   growth: true,         pro: true,         agency: true        },
      { feature: 'Dayparting (hourly bid multipliers)', free: false, starter: false,       growth: true,         pro: true,         agency: true        },
      { feature: 'AI chat assistant',           free: false,        starter: false,        growth: true,         pro: true,         agency: true        },
      { feature: 'Smart campaign creation',     free: false,        starter: false,        growth: false,        pro: true,         agency: true        },
      { feature: 'Portfolio budget management', free: false,        starter: false,        growth: false,        pro: true,         agency: true        },
      { feature: 'Anomaly detection (auto-pause runaway spend)', free: false, starter: false, growth: false,     pro: true,         agency: true        },
    ],
  },
  {
    label: 'Reporting & Access',
    rows: [
      { feature: 'Report downloads (CSV / PDF)', free: false,       starter: false,        growth: false,        pro: true,         agency: true        },
      { feature: 'API access',                  free: false,        starter: false,        growth: false,        pro: true,         agency: true        },
      { feature: 'Team seats',                  free: '1',          starter: '3',          growth: '5',          pro: 'Unlimited',  agency: 'Unlimited' },
    ],
  },
  {
    label: 'Agency',
    rows: [
      { feature: 'White-label portal',          free: false,        starter: false,        growth: false,        pro: false,        agency: true        },
      { feature: 'Multi-brand switcher',        free: false,        starter: false,        growth: false,        pro: false,        agency: true        },
      { feature: 'Client login access',         free: false,        starter: false,        growth: false,        pro: false,        agency: true        },
      { feature: 'Per-client reporting exports',free: false,        starter: false,        growth: false,        pro: false,        agency: true        },
    ],
  },
  {
    label: 'Onboarding',
    rows: [
      { feature: 'Onboarding call with Abe',    free: false,        starter: false,        growth: false,        pro: true,         agency: true        },
    ],
  },
];

const PLAN_COLS = [
  { id: 'free',    label: 'Free',    price: '$0',         highlight: false },
  { id: 'starter', label: 'Starter', price: '$99/mo',     highlight: false },
  { id: 'growth',  label: 'Growth',  price: '$249/mo',    highlight: true  },
  { id: 'pro',     label: 'Pro',     price: '$499/mo',    highlight: false },
  { id: 'agency',  label: 'Agency',  price: '$549+/mo',   highlight: false },
];

// ─── Plan definitions ─────────────────────────────────────────────────────────

const PLANS = [
  {
    id: 'free',
    name: 'Free',
    price: 0,
    annualPrice: 0,
    description: 'Get started with essential analytics at no cost.',
    cta: 'Get Started Free',
    ctaHref: '/signup',
    highlight: false,
    features: [
      { label: '1 Amazon connection',           included: true  },
      { label: '30-day data window',             included: true  },
      { label: 'Advertising & sales dashboard',  included: true  },
      { label: 'Read-only analytics',            included: true  },
      { label: 'AI bid optimization',            included: false },
      { label: 'Automated decisions',            included: false },
      { label: 'Vendor analytics',               included: false },
      { label: 'Team seats',                     included: false },
    ],
  },
  {
    id: 'starter',
    name: 'Starter',
    price: 99,
    annualPrice: 89,
    description: 'More data, more connections, full ad visibility.',
    cta: 'Upgrade to Starter',
    highlight: false,
    features: [
      { label: '2 Amazon connections',           included: true  },
      { label: '90-day data history',            included: true  },
      { label: 'Full advertising dashboard',     included: true  },
      { label: 'Vendor analytics',               included: true  },
      { label: 'COGS tracking',                  included: true  },
      { label: 'AI bid optimization',            included: false },
      { label: 'Automated decisions',            included: false },
      { label: 'Team seats',                     included: false },
    ],
  },
  {
    id: 'growth',
    name: 'Growth',
    price: 249,
    annualPrice: 224,
    description: 'AI recommends and executes — you control what\'s automatic.',
    cta: 'Upgrade to Growth',
    highlight: true,
    badge: 'Most Popular',
    features: [
      { label: 'Unlimited Amazon connections',      included: true  },
      { label: '1-year data history',               included: true  },
      { label: 'Everything in Starter',             included: true  },
      { label: 'AI decisions + 1-click execution',  included: true  },
      { label: 'Budget automation & smart alerts',  included: true  },
      { label: 'Dayparting (hourly bid control)',   included: true  },
      { label: 'Up to 5 team seats',               included: true  },
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    price: 499,
    annualPrice: 449,
    description: 'Full automation with smart campaign creation and anomaly protection.',
    cta: 'Upgrade to Pro',
    highlight: false,
    features: [
      { label: 'Everything in Growth',              included: true  },
      { label: '3-year data history',               included: true  },
      { label: 'Smart campaign creation',           included: true  },
      { label: 'Anomaly detection',                 included: true  },
      { label: 'Report downloads (CSV / PDF)',      included: true  },
      { label: 'Unlimited team seats',              included: true  },
      { label: 'Onboarding call with Abe',          included: true  },
    ],
  },
  {
    id: 'agency',
    name: 'Agency',
    price: 549,
    annualPrice: null,
    priceLabel: '$549 + $299/brand',
    description: 'White-label multi-brand portal for agencies managing multiple clients.',
    cta: 'Contact Us',
    ctaHref: 'mailto:abe@teamcalbridge.com',
    highlight: false,
    features: [
      { label: 'Everything in Pro (per brand)',     included: true  },
      { label: 'White-label portal — your logo',   included: true  },
      { label: 'Multi-brand switcher',              included: true  },
      { label: 'Client login access',               included: true  },
      { label: 'Per-client reporting exports',      included: true  },
      { label: 'Unlimited team seats',              included: true  },
      { label: 'Dedicated onboarding with Abe',     included: true  },
    ],
  },
];

// ─── Feature row ─────────────────────────────────────────────────────────────

function FeatureRow({ label, included }) {
  return (
    <li className="flex items-start gap-2 text-sm">
      {included ? (
        <svg className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        <svg className="w-4 h-4 text-gray-300 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      )}
      <span className={included ? 'text-gray-700' : 'text-gray-400'}>{label}</span>
    </li>
  );
}

// ─── Plan card ───────────────────────────────────────────────────────────────

function PlanCard({ plan, currentPlan, annual, onUpgrade, loading }) {
  const navigate = useNavigate();
  const isCurrentPlan = currentPlan === plan.id;
  const isFree = plan.id === 'free';
  const isAgency = plan.id === 'agency';
  const displayPrice = annual && plan.price > 0 && plan.annualPrice ? plan.annualPrice : plan.price;

  function handleCTA() {
    if (isFree) { navigate('/signup'); return; }
    if (isAgency || plan.ctaHref) { window.location.href = plan.ctaHref || 'mailto:abe@teamcalbridge.com'; return; }
    onUpgrade(plan.id);
  }

  return (
    <div
      className={`
        relative flex flex-col rounded-2xl border p-6 transition-all
        ${plan.highlight
          ? 'border-indigo-500 shadow-lg shadow-indigo-100 bg-white ring-2 ring-indigo-500'
          : 'border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm'
        }
      `}
    >
      {/* Most Popular badge */}
      {plan.badge && (
        <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
          <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-indigo-600 text-white shadow-sm">
            {plan.badge}
          </span>
        </div>
      )}

      {/* Current plan badge */}
      {isCurrentPlan && (
        <div className="absolute top-4 right-4">
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700">
            Current Plan
          </span>
        </div>
      )}

      {/* Plan header */}
      <div className="mb-4">
        <h3 className="text-lg font-bold text-gray-900">{plan.name}</h3>
        <div className="flex items-end gap-1 mt-2">
          {plan.price === 0 ? (
            <span className="text-3xl font-extrabold text-gray-900">Free</span>
          ) : plan.priceLabel ? (
            <span className="text-xl font-extrabold text-gray-900 leading-tight">{plan.priceLabel}</span>
          ) : (
            <>
              <span className="text-3xl font-extrabold text-gray-900">${displayPrice}</span>
              <span className="text-gray-400 text-sm mb-1">/mo</span>
              {annual && plan.annualPrice && (
                <span className="ml-1 text-xs text-green-600 font-medium mb-1">billed annually</span>
              )}
            </>
          )}
        </div>
        <p className="mt-2 text-sm text-gray-500">{plan.description}</p>
      </div>

      {/* CTA button */}
      <button
        onClick={handleCTA}
        disabled={isCurrentPlan || loading === plan.id}
        className={`
          w-full py-2.5 px-4 rounded-xl text-sm font-semibold transition-all mb-5
          ${isCurrentPlan
            ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
            : plan.highlight
              ? 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm hover:shadow'
              : 'bg-gray-900 text-white hover:bg-gray-700'
          }
          ${loading === plan.id ? 'opacity-60 cursor-wait' : ''}
        `}
      >
        {loading === plan.id
          ? 'Redirecting…'
          : isCurrentPlan
            ? 'Current Plan'
            : plan.cta
        }
      </button>

      {/* Divider */}
      <div className="border-t border-gray-100 mb-4" />

      {/* Features */}
      <ul className="space-y-2.5 flex-1">
        {plan.features.map((f, i) => (
          <FeatureRow key={i} label={f.label} included={f.included} />
        ))}
      </ul>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Pricing() {
  const [annual, setAnnual]           = useState(false);
  const [currentPlan, setCurrentPlan] = useState(null);
  const [loading, setLoading]         = useState(null);   // planId being loaded
  const [error, setError]             = useState(null);

  // Fetch current billing status
  useEffect(() => {
    fetch('/billing/status', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.plan) setCurrentPlan(data.plan);
      })
      .catch(() => {}); // silently ignore — UI still works
  }, []);

  async function handleUpgrade(planId) {
    setLoading(planId);
    setError(null);
    try {
      const res = await fetch('/billing/create-checkout', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
      } else {
        throw new Error('No checkout URL returned');
      }
    } catch (err) {
      setError(err.message);
      setLoading(null);
    }
  }

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Simple, transparent pricing"
        subtitle="Start free. Upgrade when you're ready."
      />

      {/* Annual toggle */}
      <div className="flex items-center justify-center gap-3 mb-8 mt-2">
        <span className={`text-sm font-medium ${!annual ? 'text-gray-900' : 'text-gray-400'}`}>Monthly</span>
        <button
          onClick={() => setAnnual(a => !a)}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${annual ? 'bg-indigo-600' : 'bg-gray-200'}`}
          aria-label="Toggle annual billing"
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${annual ? 'translate-x-6' : 'translate-x-1'}`}
          />
        </button>
        <span className={`text-sm font-medium ${annual ? 'text-gray-900' : 'text-gray-400'}`}>
          Annual
          <span className="ml-1.5 text-xs font-semibold text-green-600 bg-green-50 px-1.5 py-0.5 rounded-full">Save 10%</span>
        </span>
      </div>

      {/* Annual savings note */}
      {annual && (
        <p className="text-center text-sm text-gray-500 mb-6 -mt-4">
          Annual billing saves 10% — prices shown are monthly equivalents.
        </p>
      )}

      {/* Error */}
      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 text-center">
          ❌ {error} — please try again or contact support.
        </div>
      )}

      {/* Plan cards grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-5">
        {PLANS.map(plan => (
          <PlanCard
            key={plan.id}
            plan={plan}
            currentPlan={currentPlan}
            annual={annual}
            onUpgrade={handleUpgrade}
            loading={loading}
          />
        ))}
      </div>

      {/* Feature comparison table */}
      <div className="mt-16">
        <h2 className="text-xl font-bold text-gray-900 text-center mb-2">Compare all features</h2>
        <p className="text-sm text-gray-500 text-center mb-8">Everything included in each plan, side by side.</p>
        <div className="overflow-x-auto rounded-2xl border border-gray-200 shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left py-4 px-5 font-semibold text-gray-500 w-56 bg-gray-50">Feature</th>
                {PLAN_COLS.map(col => (
                  <th key={col.id} className={`text-center py-4 px-3 font-bold ${
                    col.highlight ? 'text-indigo-700 bg-indigo-50' : 'text-gray-800 bg-gray-50'
                  }`}>
                    <div>{col.label}</div>
                    <div className={`text-xs font-normal mt-0.5 ${
                      col.highlight ? 'text-indigo-500' : 'text-gray-400'
                    }`}>{col.price}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {COMPARISON_SECTIONS.map((section, si) => (
                <>
                  <tr key={`section-${si}`} className="bg-gray-50 border-t border-gray-100">
                    <td colSpan={6} className="py-2.5 px-5 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      {section.label}
                    </td>
                  </tr>
                  {section.rows.map((row, ri) => (
                    <tr key={`row-${si}-${ri}`} className="border-t border-gray-50 hover:bg-gray-50/50 transition-colors">
                      <td className="py-3 px-5 text-gray-700 font-medium">{row.feature}</td>
                      {PLAN_COLS.map(col => {
                        const val = row[col.id];
                        return (
                          <td key={col.id} className={`py-3 px-3 text-center ${
                            col.highlight ? 'bg-indigo-50/40' : ''
                          }`}>
                            {typeof val === 'boolean' ? (
                              val ? (
                                <svg className="w-4 h-4 text-green-500 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                </svg>
                              ) : (
                                <svg className="w-3.5 h-3.5 text-gray-200 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              )
                            ) : (
                              <span className="text-gray-700 font-medium">{val}</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Footer note */}
      <p className="mt-8 text-center text-xs text-gray-400">
        All plans include SSL-secured data, 99.9% uptime SLA, and SOC 2-compliant infrastructure.
        Prices in USD. Subscriptions auto-renew monthly unless cancelled.
        <a href="mailto:support@teamcalbridge.com" className="ml-1 underline hover:text-gray-600">Questions? Contact us.</a>
      </p>
    </div>
  );
}
