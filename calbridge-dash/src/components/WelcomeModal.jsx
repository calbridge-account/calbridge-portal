import { useState } from 'react';
import { useUser } from '../context/UserContext';

const BRAND_PLANS = [
  {
    id: 'free',
    name: 'Free',
    price: '$0',
    period: 'forever',
    description: 'Core analytics, no credit card needed.',
    highlight: false,
    cta: 'Continue on Free',
    features: ['1 connection', '30-day data', 'Ads dashboard'],
  },
  {
    id: 'starter',
    name: 'Starter',
    price: '$99',
    period: '/mo',
    description: 'Full visibility for growing brands.',
    highlight: false,
    cta: 'Start Starter',
    features: ['2 connections', '90-day data', 'Vendor analytics'],
  },
  {
    id: 'growth',
    name: 'Growth',
    price: '$249',
    period: '/mo',
    description: 'AI automation for serious sellers.',
    highlight: true,
    badge: 'Most Popular',
    cta: 'Start Growth',
    features: ['Unlimited connections', '1-year data', 'AI decisions', '5 team seats'],
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '$499',
    period: '/mo',
    description: 'Full power. White-label ready.',
    highlight: false,
    cta: 'Start Pro',
    features: ['Everything in Growth', '3-year data', 'Unlimited seats'],
  },
];

const AGENCY_PLAN = {
  id: 'agency',
  name: 'Agency / Multi-Brand',
  price: '$549',
  period: '/mo base',
  priceSub: '+ $299/mo per additional brand',
  description: 'White-label multi-brand portal for agencies.',
  highlight: true,
  cta: 'Set Up Agency Account',
  features: ['Unlimited brands', 'White-label portal', 'Client login access', 'Everything in Pro'],
};

export default function WelcomeModal({ onDismiss }) {
  const { user } = useUser() || {};
  const isAgency = user?.accountType === 'agency' || user?.account_type === 'agency';
  const [loading, setLoading] = useState(null);
  const [error, setError] = useState(null);
  const firstName = (user?.name || '').split(' ')[0] || 'there';

  async function markOnboardingComplete() {
    try {
      await fetch('/account/complete-onboarding', {
        method: 'POST',
        credentials: 'include',
      });
    } catch (e) {
      // Non-fatal — modal will still dismiss
    }
  }

  async function handlePlanSelect(planId) {
    if (planId === 'free') {
      await markOnboardingComplete();
      onDismiss();
      return;
    }

    setLoading(planId);
    setError(null);
    try {
      const res = await fetch('/billing/create-checkout', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId }),
      });
      const data = await res.json();
      if (data.checkoutUrl) {
        await markOnboardingComplete();
        window.location.href = data.checkoutUrl;
      } else {
        throw new Error(data.error || 'Could not create checkout session');
      }
    } catch (e) {
      setError(e.message);
      setLoading(null);
    }
  }

  const plans = isAgency ? [AGENCY_PLAN] : BRAND_PLANS;

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl my-8">
        {/* Header */}
        <div className="px-8 pt-8 pb-6 text-center border-b border-gray-100">
          <div className="flex justify-center mb-4">
            <img
              src="/calbridge-logo.png"
              alt="Calbridge"
              className="h-8"
              onError={e => { e.target.style.display = 'none'; }}
            />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">
            Welcome to Calbridge{firstName !== 'there' ? `, ${firstName}` : ''}! 👋
          </h1>
          <p className="text-gray-500 text-sm max-w-md mx-auto">
            {isAgency
              ? 'Set up your agency account to start managing your brands.'
              : 'Choose a plan to get started. You can upgrade or change anytime.'}
          </p>
        </div>

        {/* Plans */}
        <div className={`p-8 grid gap-4 ${isAgency ? 'grid-cols-1 max-w-md mx-auto' : 'grid-cols-2 lg:grid-cols-4'}`}>
          {plans.map(plan => (
            <div
              key={plan.id}
              className={`relative rounded-xl border-2 p-5 flex flex-col ${
                plan.highlight
                  ? 'border-green-600 bg-green-50'
                  : 'border-gray-200 bg-white hover:border-gray-300'
              }`}
            >
              {plan.badge && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="bg-green-600 text-white text-xs font-bold px-3 py-1 rounded-full">
                    {plan.badge}
                  </span>
                </div>
              )}

              <div className="mb-4">
                <h3 className="font-bold text-gray-900 text-sm">{plan.name}</h3>
                <div className="flex items-baseline gap-1 mt-1">
                  <span className="text-2xl font-bold text-gray-900">{plan.price}</span>
                  <span className="text-xs text-gray-500">{plan.period}</span>
                </div>
                {plan.priceSub && (
                  <div className="text-xs text-gray-500 mt-0.5">{plan.priceSub}</div>
                )}
                <p className="text-xs text-gray-500 mt-2">{plan.description}</p>
              </div>

              <ul className="space-y-1.5 mb-5 flex-1">
                {plan.features.map(f => (
                  <li key={f} className="flex items-center gap-2 text-xs text-gray-600">
                    <svg
                      className="w-3.5 h-3.5 text-green-600 flex-shrink-0"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2.5}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    {f}
                  </li>
                ))}
              </ul>

              <button
                onClick={() => handlePlanSelect(plan.id)}
                disabled={loading !== null}
                className={`w-full py-2.5 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 ${
                  plan.highlight
                    ? 'bg-green-700 hover:bg-green-800 text-white'
                    : plan.id === 'free'
                    ? 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
                    : 'bg-gray-900 hover:bg-gray-800 text-white'
                }`}
              >
                {loading === plan.id ? 'Loading…' : plan.cta}
              </button>
            </div>
          ))}
        </div>

        {error && (
          <div className="px-8 pb-4 text-center">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        {/* Footer */}
        {!isAgency && (
          <div className="px-8 pb-6 text-center border-t border-gray-100 pt-4">
            <p className="text-xs text-gray-400">
              All paid plans include a 14-day free trial. Cancel anytime. No contracts.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
