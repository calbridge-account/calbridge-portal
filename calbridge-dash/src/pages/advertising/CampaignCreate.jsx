import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import PageHeader from '../../components/PageHeader';
import { SkeletonTable } from '../../components/Skeleton';
import AdvertisingSubNav from './AdvertisingSubNav';
import {
  getCampaignSuggestions,
  getCampaignAsins,
  createCampaign,
  getCampaignProfile,
  uploadSbCreative,
  getCompetitorSignals,
} from '../../api/client';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function today() {
  return new Date().toISOString().split('T')[0];
}

function fmt$(n) {
  if (n == null || isNaN(n)) return '$0.00';
  return '$' + Number(n).toFixed(2);
}

function suggestedBid(spend, clicks) {
  if (!clicks || clicks === 0) return 0.75;
  const raw = (spend / clicks) * 1.2;
  return Math.max(0.10, parseFloat(raw.toFixed(2)));
}

// ─── Step Indicator ───────────────────────────────────────────────────────────
function StepIndicator({ steps, current }) {
  return (
    <div className="flex items-center gap-0 mb-8">
      {steps.map((step, i) => {
        const isDone    = i < current;
        const isActive  = i === current;
        return (
          <div key={i} className="flex items-center flex-1 min-w-0">
            <div className="flex flex-col items-center flex-shrink-0">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-colors ${
                isDone   ? 'bg-green-700 text-white'   :
                isActive ? 'bg-green-700 text-white ring-2 ring-green-200' :
                           'bg-gray-100 text-gray-400'
              }`}>
                {isDone ? '✓' : i + 1}
              </div>
              <span className={`text-xs mt-1 whitespace-nowrap font-medium ${isActive ? 'text-green-700' : isDone ? 'text-green-600' : 'text-gray-400'}`}>
                {step}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className={`flex-1 h-0.5 mx-2 mt-[-16px] ${isDone ? 'bg-green-600' : 'bg-gray-200'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── DSP Banner ───────────────────────────────────────────────────────────────
function DspBanner() {
  return (
    <div className="mb-6 flex items-start gap-3 bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-3.5">
      <span className="text-xl flex-shrink-0 mt-0.5">📺</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-indigo-800 mb-0.5">Amazon DSP available through Team Calbridge</p>
        <p className="text-sm text-indigo-700">
          Not running DSP yet? Amazon DSP unlocks programmatic display, video, and audio across Amazon-owned and third-party inventory — including retargeting beyond Amazon.com. Team Calbridge can create and manage DSP campaigns directly on your behalf.{' '}
          <a
            href="mailto:abe@teamcalbridge.com?subject=DSP Campaign Inquiry"
            className="font-semibold underline text-indigo-800 hover:text-indigo-900"
          >
            Reach out to get started →
          </a>
        </p>
      </div>
    </div>
  );
}

// ─── Step 1: Campaign Type ────────────────────────────────────────────────────
function StepType({ form, setForm }) {
  const types = [
    {
      key: 'SP',
      label: 'Sponsored Products',
      icon: '🛍️',
      desc: 'Drive sales for individual products — keyword and product targeting',
      color: 'border-blue-500 bg-blue-50',
      badge: 'bg-blue-100 text-blue-700',
    },
    {
      key: 'SB',
      label: 'Sponsored Brands',
      icon: '🏷️',
      desc: 'Brand awareness with headline banner ads — requires Brand Registry',
      color: 'border-green-600 bg-green-50',
      badge: 'bg-green-100 text-green-700',
    },
    {
      key: 'SD',
      label: 'Sponsored Display',
      icon: '🖥️',
      desc: 'Reach shoppers on and off Amazon — product & audience retargeting',
      color: 'border-purple-500 bg-purple-50',
      badge: 'bg-purple-100 text-purple-700',
    },
  ];

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900 mb-1">Campaign Type</h2>
      <p className="text-sm text-gray-500 mb-5">Select the type of Amazon advertising campaign to create.</p>

      {/* DSP upsell banner */}
      <DspBanner />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {types.map(t => (
          <button
            key={t.key}
            onClick={() => setForm(f => ({ ...f, adType: t.key }))}
            className={`rounded-xl border-2 p-5 text-left transition-all hover:shadow-md ${
              form.adType === t.key ? t.color + ' shadow-sm' : 'border-gray-200 bg-white hover:border-gray-300'
            }`}
          >
            <div className="text-3xl mb-3">{t.icon}</div>
            <div className="flex items-center gap-2 mb-1">
              <span className="font-semibold text-gray-900 text-base">{t.label}</span>
              <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${t.badge}`}>{t.key}</span>
            </div>
            <p className="text-sm text-gray-500">{t.desc}</p>
            {form.adType === t.key && (
              <div className="mt-3 text-xs font-semibold text-green-700">✓ Selected</div>
            )}
          </button>
        ))}
      </div>

      {/* SB eligibility note */}
      {form.adType === 'SB' && (
        <div className="mt-5 p-4 bg-amber-50 border border-amber-200 rounded-xl text-sm">
          <p className="font-semibold text-amber-800 mb-1">📋 Sponsored Brands Requirements</p>
          <ul className="text-amber-700 space-y-1 list-disc list-inside">
            <li>Seller must be enrolled in <strong>Amazon Brand Registry</strong></li>
            <li>Vendors are eligible without Brand Registry</li>
            <li>A registered <strong>brand entity ID</strong> is required — Calbridge will resolve this from your connected profile</li>
            <li>Creative assets (logo + main image) must be uploaded and <strong>approved by Amazon</strong> before ads go live — allow 24–72h</li>
            <li>Headline text must comply with Amazon's <strong>creative acceptance policies</strong> (no superlatives, no pricing)</li>
            <li>Minimum budget: <strong>$1/day</strong></li>
          </ul>
        </div>
      )}

      {/* SD targeting note */}
      {form.adType === 'SD' && (
        <div className="mt-5 p-4 bg-purple-50 border border-purple-200 rounded-xl text-sm">
          <p className="font-semibold text-purple-800 mb-1">🖥️ Sponsored Display — Two Targeting Modes</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
            <div className="bg-white rounded-lg border border-purple-200 p-3">
              <p className="font-semibold text-purple-700 text-xs mb-1">Product Targeting (T00020)</p>
              <p className="text-purple-600 text-xs">Show ads to shoppers viewing similar products or categories. Best for conquest and category expansion.</p>
            </div>
            <div className="bg-white rounded-lg border border-purple-200 p-3">
              <p className="font-semibold text-purple-700 text-xs mb-1">Audience Retargeting (T00030)</p>
              <p className="text-purple-600 text-xs">Re-engage shoppers who viewed or purchased your products. Reaches them on and off Amazon.com.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Step 2: Campaign Settings ────────────────────────────────────────────────
function StepSettings({ form, setForm, brandName }) {
  const BID_STRATEGIES = [
    { key: 'legacyForSales',        label: 'Dynamic bids — down only' },
    { key: 'autoForSales',          label: 'Dynamic bids — up and down' },
    { key: 'manual',                label: 'Fixed bids' },
  ];

  const SD_TACTICS = [
    { key: 'T00020', label: 'Product Targeting', desc: 'Target similar products & categories' },
    { key: 'T00030', label: 'Audience Retargeting', desc: 'Re-engage viewers & past purchasers' },
  ];

  const SD_BID_OPTS = [
    { key: 'clicks',                label: 'Optimise for clicks' },
    { key: 'conversions',           label: 'Optimise for conversions' },
    { key: 'reach',                 label: 'Optimise for reach' },
    { key: 'viewableImpressions',   label: 'Optimise for viewable impressions (vCPM)' },
  ];

  const TARGETING_TYPES = (form.adType === 'SB' || form.adType === 'SD')
    ? [{ key: 'manual', label: 'Manual' }]
    : [
        { key: 'auto',   label: 'Automatic' },
        { key: 'manual', label: 'Manual' },
      ];

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900 mb-1">Campaign Settings</h2>
      <p className="text-sm text-gray-500 mb-5">Configure your campaign name, budget, and bidding strategy.</p>

      <div className="space-y-5">
        {/* Campaign name */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Campaign Name <span className="text-red-500">*</span></label>
          <input
            type="text"
            value={form.campaignName}
            onChange={e => setForm(f => ({ ...f, campaignName: e.target.value }))}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-600"
            placeholder="e.g. Brand SP Auto 2025-04-30"
          />
        </div>

        {/* Budget + Start Date row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Daily Budget ($) <span className="text-red-500">*</span></label>
            <input
              type="number"
              min="1"
              step="0.01"
              value={form.budget}
              onChange={e => setForm(f => ({ ...f, budget: e.target.value }))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-600"
              placeholder="50.00"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Start Date <span className="text-red-500">*</span></label>
            <input
              type="date"
              value={form.startDate}
              onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-600"
            />
          </div>
        </div>

        {/* End Date */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">End Date <span className="text-gray-400 font-normal">(optional)</span></label>
            <input
              type="date"
              value={form.endDate}
              onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-600"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Default Bid ($)</label>
            <input
              type="number"
              min="0.02"
              step="0.01"
              value={form.defaultBid}
              onChange={e => setForm(f => ({ ...f, defaultBid: e.target.value }))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-600"
              placeholder="0.75"
            />
          </div>
        </div>

        {/* SD Tactic selector */}
        {form.adType === 'SD' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Targeting Tactic</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {SD_TACTICS.map(t => (
                <button
                  key={t.key}
                  onClick={() => setForm(f => ({ ...f, sdTactic: t.key }))}
                  className={`px-4 py-3 text-sm rounded-lg border text-left transition-colors ${
                    (form.sdTactic || 'T00020') === t.key
                      ? 'border-purple-600 bg-purple-700 text-white font-medium'
                      : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                  }`}
                >
                  <div className="font-semibold">{t.label}</div>
                  <div className={`text-xs mt-0.5 ${ (form.sdTactic || 'T00020') === t.key ? 'text-purple-200' : 'text-gray-400' }`}>{t.desc}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* SD Bid Optimization */}
        {form.adType === 'SD' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Bid Optimization</label>
            <div className="flex flex-wrap gap-2">
              {SD_BID_OPTS.map(o => (
                <button
                  key={o.key}
                  onClick={() => setForm(f => ({ ...f, sdBidOptimization: o.key }))}
                  className={`px-3 py-2 text-sm rounded-lg border transition-colors ${
                    (form.sdBidOptimization || 'clicks') === o.key
                      ? 'border-purple-700 bg-purple-700 text-white font-medium'
                      : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Bid Strategy (SP only) */}
        {form.adType === 'SP' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Bid Strategy</label>
            <div className="flex flex-wrap gap-2">
              {BID_STRATEGIES.map(bs => (
                <button
                  key={bs.key}
                  onClick={() => setForm(f => ({ ...f, bidStrategy: bs.key }))}
                  className={`px-3 py-2 text-sm rounded-lg border transition-colors ${
                    form.bidStrategy === bs.key
                      ? 'border-green-700 bg-green-700 text-white font-medium'
                      : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                  }`}
                >
                  {bs.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Targeting Type (SP only — SB is always manual; SD uses tactic instead) */}
        {form.adType !== 'SD' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Targeting Type</label>
            <div className="flex gap-2">
              {TARGETING_TYPES.map(tt => (
                <button
                  key={tt.key}
                  onClick={() => setForm(f => ({ ...f, targetingType: tt.key }))}
                  className={`px-4 py-2 text-sm rounded-lg border transition-colors ${
                    form.targetingType === tt.key
                      ? 'border-green-700 bg-green-700 text-white font-medium'
                      : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                  }`}
                >
                  {tt.label}
                </button>
              ))}
            </div>
            {form.targetingType === 'auto' && (
              <p className="text-xs text-gray-400 mt-2">Amazon will automatically match your ads to relevant customer searches.</p>
            )}
          </div>
        )}

        {/* Ad Group Name */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Ad Group Name</label>
          <input
            type="text"
            value={form.adGroupName}
            onChange={e => setForm(f => ({ ...f, adGroupName: e.target.value }))}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-600"
            placeholder="Ad Group 1"
          />
        </div>
      </div>
    </div>
  );
}

// ─── Keyword bucket classifier ─────────────────────────────────────────────
// Brand: contains a known brand term. Competitive: other brand names. Non-Brand: generic.
// These three buckets are MECE (mutually exclusive + collectively exhaustive).
// Generic competitor signals — deliberately excludes client-specific brands (Acer, CyberPower)
// since they are in different categories and not competitors of each other.
// Per-brand competitor lists will be configurable in the admin panel.
const COMPETITOR_SIGNALS = [
  'apc', 'eaton', 'tripp lite', 'tripplite', 'belkin', 'anker',
  'samsung', 'apple', 'google', 'microsoft', 'sony', 'lg ', ' lg', 'panasonic', 'toshiba',
  'hp ', ' hp', 'dell', 'lenovo', 'asus', 'corsair', 'razer', 'logitech',
];

function classifyKeyword(term, brandTerms, competitorSignals = COMPETITOR_SIGNALS) {
  const lower = term.toLowerCase();
  if (brandTerms.some(b => lower.includes(b.toLowerCase()))) return 'brand';
  if (competitorSignals.some(c => lower.includes(c))) return 'competitive';
  return 'non-brand';
}

function extractBrandTerms(brandName) {
  if (!brandName) return [];
  const clean = brandName.replace(/[^a-zA-Z0-9 ]/g, '').trim();
  return [clean, clean.toLowerCase(), clean.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()].filter(Boolean);
}

const BUCKETS = [
  { key: 'brand',       label: 'Brand',       colorClass: 'text-blue-700 bg-blue-50 border-blue-200',   dot: 'bg-blue-500',   tip: 'Searches containing your brand name — highest CVR, lowest ACoS.' },
  { key: 'competitive', label: 'Competitive',  colorClass: 'text-amber-700 bg-amber-50 border-amber-200', dot: 'bg-amber-500',  tip: 'Competitor brand terms — conquest traffic, higher CPC.' },
  { key: 'non-brand',   label: 'Non-Brand',    colorClass: 'text-gray-700 bg-gray-50 border-gray-200',   dot: 'bg-gray-400',   tip: 'Generic category terms — broadest reach, highest volume.' },
];

function BucketBadge({ bucket }) {
  const b = BUCKETS.find(x => x.key === bucket);
  if (!b) return null;
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full border ${b.colorClass}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${b.dot}`} />
      {b.label}
    </span>
  );
}

// ─── Step 3: Keywords ─────────────────────────────────────────────────────────
function StepKeywords({ form, setForm, brandName, competitorSignals = COMPETITOR_SIGNALS }) {
  const [activeBucket, setActiveBucket] = useState('all');
  const [kwSearch, setKwSearch]         = useState('');
  const [customKw, setCustomKw]         = useState('');

  const brandTerms = useMemo(() => extractBrandTerms(brandName), [brandName]);

  const { data: suggestions = [], isLoading } = useQuery({
    queryKey: ['campaign-suggestions', form.adType],
    queryFn: () => getCampaignSuggestions(form.adType),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const classified = useMemo(() =>
    suggestions.map(s => ({ ...s, bucket: classifyKeyword(s.term, brandTerms, competitorSignals) })),
    [suggestions, brandTerms, competitorSignals]
  );

  const filteredSuggestions = useMemo(() => classified.filter(s => {
    if (kwSearch && !s.term.toLowerCase().includes(kwSearch.toLowerCase())) return false;
    if (activeBucket !== 'all' && s.bucket !== activeBucket) return false;
    return true;
  }), [classified, kwSearch, activeBucket]);

  const bucketCounts = useMemo(() => ({
    all:         classified.length,
    brand:       classified.filter(s => s.bucket === 'brand').length,
    competitive: classified.filter(s => s.bucket === 'competitive').length,
    'non-brand': classified.filter(s => s.bucket === 'non-brand').length,
  }), [classified]);

  const selectedTerms = new Set(form.keywords.map(k => k.term));

  function addKeyword(kw) {
    if (selectedTerms.has(kw.term)) return;
    const bid = suggestedBid(kw.spend, kw.clicks);
    setForm(f => ({
      ...f,
      keywords: [...f.keywords, {
        term:      kw.term,
        matchType: kw.matchType || 'BROAD',
        bid:       String(bid),
        bucket:    kw.bucket || 'non-brand',
      }],
    }));
  }

  function addAllInBucket(bucket) {
    const toAdd = classified
      .filter(s => s.bucket === bucket && !selectedTerms.has(s.term))
      .map(s => ({
        term:      s.term,
        matchType: s.matchType || 'BROAD',
        bid:       String(suggestedBid(s.spend, s.clicks)),
        bucket:    s.bucket,
      }));
    setForm(f => ({ ...f, keywords: [...f.keywords, ...toAdd] }));
  }

  function removeKeyword(term) {
    setForm(f => ({ ...f, keywords: f.keywords.filter(k => k.term !== term) }));
  }

  function updateKeyword(term, field, value) {
    setForm(f => ({
      ...f,
      keywords: f.keywords.map(k => k.term === term ? { ...k, [field]: value } : k),
    }));
  }

  function addCustomKeyword() {
    const trimmed = customKw.trim();
    if (!trimmed || selectedTerms.has(trimmed)) return;
    setForm(f => ({
      ...f,
      keywords: [...f.keywords, {
        term:      trimmed,
        matchType: 'BROAD',
        bid:       String(form.defaultBid || '0.75'),
        bucket:    classifyKeyword(trimmed, brandTerms, competitorSignals),
      }],
    }));
    setCustomKw('');
  }

  const selectedByBucket = useMemo(() => {
    const groups = { brand: [], competitive: [], 'non-brand': [] };
    form.keywords.forEach(k => {
      const b = k.bucket || classifyKeyword(k.term, brandTerms, competitorSignals);
      (groups[b] || groups['non-brand']).push(k);
    });
    return groups;
  }, [form.keywords, brandTerms, competitorSignals]);

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900 mb-1">Keywords</h2>
      <p className="text-sm text-gray-500 mb-4">Organize keywords into three MECE buckets for cleaner campaign structure and bidding control.</p>

      {/* Bucket legend */}
      <div className="flex flex-wrap gap-2 mb-5">
        {BUCKETS.map(b => (
          <div key={b.key} className="flex items-center gap-1.5 text-xs text-gray-600 bg-white border border-gray-200 rounded-lg px-3 py-1.5" title={b.tip}>
            <span className={`w-2 h-2 rounded-full ${b.dot}`} />
            <span className="font-medium">{b.label}</span>
            <span className="text-gray-400 hidden lg:inline"> — {b.tip}</span>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* LEFT: Suggestions with bucket tabs */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
            <div className="flex gap-1 flex-wrap">
              {[{ key: 'all', label: 'All' }, ...BUCKETS].map(b => (
                <button
                  key={b.key}
                  onClick={() => setActiveBucket(b.key)}
                  className={`px-2.5 py-1 text-xs rounded-md font-medium transition-colors ${
                    activeBucket === b.key
                      ? 'bg-green-700 text-white'
                      : 'text-gray-600 bg-white border border-gray-200 hover:bg-gray-100'
                  }`}
                >
                  {b.label} <span className="opacity-70">({bucketCounts[b.key] ?? 0})</span>
                </button>
              ))}
            </div>
          </div>
          {activeBucket !== 'all' && bucketCounts[activeBucket] > 0 && (
            <div className="px-3 py-1.5 bg-gray-50 border-b border-gray-100 flex justify-end">
              <button
                onClick={() => addAllInBucket(activeBucket)}
                className="text-xs text-green-700 hover:text-green-800 font-medium"
              >
                + Add all {BUCKETS.find(b => b.key === activeBucket)?.label} keywords
              </button>
            </div>
          )}
          <div className="p-3 border-b border-gray-100">
            <input
              type="text"
              placeholder="Filter keywords…"
              value={kwSearch}
              onChange={e => setKwSearch(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-green-600"
            />
          </div>
          <div className="overflow-y-auto" style={{ maxHeight: '320px' }}>
            {isLoading ? (
              <div className="p-4"><SkeletonTable /></div>
            ) : filteredSuggestions.length === 0 ? (
              <div className="text-gray-400 text-sm text-center py-8">
                {suggestions.length === 0 ? 'No historical keyword data available' : 'No matching keywords'}
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-white border-b border-gray-100">
                  <tr>
                    <th className="w-6" />
                    <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500">Keyword</th>
                    <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500">Type</th>
                    <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500">Orders</th>
                    <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500">Bid</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSuggestions.map((kw, i) => {
                    const isAdded = selectedTerms.has(kw.term);
                    return (
                      <tr
                        key={kw.term + i}
                        className={`border-b border-gray-50 hover:bg-gray-50 cursor-pointer ${isAdded ? 'opacity-40' : ''}`}
                        onClick={() => addKeyword(kw)}
                      >
                        <td className="py-2 pl-3">
                          <input type="checkbox" checked={isAdded} onChange={() => addKeyword(kw)}
                            onClick={e => e.stopPropagation()} className="rounded accent-green-700" />
                        </td>
                        <td className="py-2 px-3 text-gray-800 font-medium max-w-[130px]">
                          <span className="block truncate" title={kw.term}>{kw.term}</span>
                        </td>
                        <td className="py-2 px-2"><BucketBadge bucket={kw.bucket} /></td>
                        <td className="py-2 px-3 text-right text-gray-500">{kw.orders?.toLocaleString() || 0}</td>
                        <td className="py-2 px-3 text-right text-green-700 font-medium">{fmt$(suggestedBid(kw.spend, kw.clicks))}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* RIGHT: Selected — grouped by bucket */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700">Selected Keywords</span>
            <span className="text-xs text-green-700 font-semibold">{form.keywords.length} added</span>
          </div>
          <div className="overflow-y-auto" style={{ maxHeight: '360px' }}>
            {form.keywords.length === 0 ? (
              <div className="text-gray-400 text-sm text-center py-8">Click suggestions to add keywords</div>
            ) : (
              <div>
                {BUCKETS.map(b => {
                  const bkws = selectedByBucket[b.key] || [];
                  if (bkws.length === 0) return null;
                  return (
                    <div key={b.key}>
                      <div className={`px-3 py-1.5 text-xs font-semibold border-b border-gray-100 flex items-center gap-1.5 ${b.colorClass}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${b.dot}`} />
                        {b.label} <span className="opacity-60">({bkws.length})</span>
                      </div>
                      {bkws.map(kw => (
                        <div key={kw.term} className="flex items-center gap-2 px-3 py-2 border-b border-gray-50">
                          <span className="flex-1 text-sm text-gray-800 font-medium truncate min-w-0" title={kw.term}>{kw.term}</span>
                          <select
                            value={kw.matchType}
                            onChange={e => updateKeyword(kw.term, 'matchType', e.target.value)}
                            className="text-xs border border-gray-200 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-green-600"
                          >
                            <option value="BROAD">Broad</option>
                            <option value="PHRASE">Phrase</option>
                            <option value="EXACT">Exact</option>
                          </select>
                          <input type="number" min="0.02" step="0.01" value={kw.bid}
                            onChange={e => updateKeyword(kw.term, 'bid', e.target.value)}
                            className="w-16 text-xs border border-gray-200 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-green-600"
                          />
                          <button onClick={() => removeKeyword(kw.term)}
                            className="text-gray-400 hover:text-red-500 text-xs flex-shrink-0">✕</button>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          {/* Add custom */}
          <div className="p-3 border-t border-gray-100 bg-gray-50 flex gap-2">
            <input
              type="text" placeholder="Add custom keyword…" value={customKw}
              onChange={e => setCustomKw(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addCustomKeyword()}
              className="flex-1 text-sm border border-gray-200 rounded px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-green-600"
            />
            <button onClick={addCustomKeyword}
              className="px-3 py-1.5 bg-green-700 text-white text-sm rounded hover:bg-green-800 transition-colors font-medium"
            >Add</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Step 3b: SB Creatives ──────────────────────────────────────────────────
// Amazon SB creative requirements:
//   Headline:  1–200 characters
//   Brand logo: JPG/PNG, 400×400 recommended, max 1MB
//   Main image: JPG/PNG, 1200×628 recommended (1.91:1 ratio), max 5MB
const HEADLINE_MAX = 200;

function ImageUploadField({ label, spec, hint, value, onChange }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError]         = useState(null);

  async function handleFile(file) {
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const result = await uploadSbCreative(file);
      onChange(result.url);
    } catch (e) {
      setError(e.message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <p className="text-xs text-gray-400 mb-2">{spec}</p>
      <div
        className={`relative border-2 border-dashed rounded-xl p-4 text-center transition-colors ${
          value ? 'border-green-400 bg-green-50' : 'border-gray-200 bg-gray-50 hover:border-green-400'
        }`}
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); handleFile(e.dataTransfer.files[0]); }}
      >
        {value ? (
          <div className="flex items-center gap-3">
            <img src={value} alt={label} className="w-16 h-16 object-contain rounded border border-gray-200 bg-white" />
            <div className="text-left flex-1 min-w-0">
              <p className="text-sm font-medium text-green-700">✓ Uploaded</p>
              <p className="text-xs text-gray-400 truncate">{value.split('/').pop()}</p>
            </div>
            <button onClick={() => onChange('')} className="text-xs text-red-400 hover:text-red-600 flex-shrink-0">Remove</button>
          </div>
        ) : (
          <>
            <div className="text-2xl mb-1">{uploading ? '📤' : '🖼️'}</div>
            <p className="text-sm text-gray-500">
              {uploading ? 'Uploading…' : 'Click to browse or drag & drop'}
            </p>
            <p className="text-xs text-gray-400 mt-0.5">{hint}</p>
          </>
        )}
        {!value && !uploading && (
          <input
            type="file"
            accept="image/jpeg,image/png"
            onChange={e => handleFile(e.target.files[0])}
            className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
          />
        )}
      </div>
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  );
}

function StepCreative({ form, setForm }) {
  const headline   = form.sbHeadline   || '';
  const logoUrl    = form.sbLogoUrl    || '';
  const mainImgUrl = form.sbMainImgUrl || '';
  const charCount  = headline.length;

  function set(field, value) { setForm(f => ({ ...f, [field]: value })); }

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900 mb-1">SB Creatives</h2>
      <p className="text-sm text-gray-500 mb-6">Sponsored Brands ads require a headline, brand logo, and main image. Assets are stored and reusable across campaigns.</p>

      {/* Headline */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Headline <span className="text-red-500">*</span>
        </label>
        <p className="text-xs text-gray-400 mb-2">Appears above your ad. Max {HEADLINE_MAX} characters.</p>
        <div className="relative">
          <input
            type="text"
            value={headline}
            onChange={e => set('sbHeadline', e.target.value)}
            maxLength={HEADLINE_MAX}
            placeholder="e.g. Shop CyberPower UPS — Free Shipping on Orders $49+"
            className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 pr-20 ${
              charCount > 0 && charCount > HEADLINE_MAX
                ? 'border-red-300 focus:ring-red-300'
                : 'border-gray-200 focus:ring-green-600'
            }`}
          />
          <span className={`absolute right-3 top-1/2 -translate-y-1/2 text-xs font-mono pointer-events-none ${
            charCount >= HEADLINE_MAX * 0.9 ? 'text-amber-500' : 'text-gray-400'
          }`}>
            {charCount}/{HEADLINE_MAX}
          </span>
        </div>
      </div>

      {/* Images */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <ImageUploadField
          label="Brand Logo"
          spec="JPG or PNG · Recommended 400×400px · Max 1 MB"
          hint="Square format, transparent background preferred"
          value={logoUrl}
          onChange={v => set('sbLogoUrl', v)}
        />
        <ImageUploadField
          label="Main Image"
          spec="JPG or PNG · Recommended 1200×628px (1.91:1) · Max 5 MB"
          hint="Product lifestyle or brand image, no text overlay"
          value={mainImgUrl}
          onChange={v => set('sbMainImgUrl', v)}
        />
      </div>

      <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-xl text-sm text-blue-700">
        <strong>Tip:</strong> Amazon requires approved creatives before SB ads run. Upload now — they'll be submitted with the campaign and stored for future use.
      </div>
    </div>
  );
}

// ─── Step 4: Products / ASINs ─────────────────────────────────────────────────
function StepAsins({ form, setForm }) {
  const [asinSearch, setAsinSearch] = useState('');
  const [manualAsin, setManualAsin] = useState('');

  const { data: asinList = [], isLoading } = useQuery({
    queryKey: ['campaign-asins'],
    queryFn: getCampaignAsins,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const filteredAsins = asinList.filter(a =>
    !asinSearch ||
    a.asin.toLowerCase().includes(asinSearch.toLowerCase()) ||
    a.title.toLowerCase().includes(asinSearch.toLowerCase())
  );

  const selectedSet = new Set(form.asins);

  function toggleAsin(asin) {
    setForm(f => ({
      ...f,
      asins: selectedSet.has(asin)
        ? f.asins.filter(a => a !== asin)
        : [...f.asins, asin],
    }));
  }

  function addManualAsin() {
    const trimmed = manualAsin.trim().toUpperCase();
    if (!trimmed || selectedSet.has(trimmed)) return;
    setForm(f => ({ ...f, asins: [...f.asins, trimmed] }));
    setManualAsin('');
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900 mb-1">Products (ASINs)</h2>
      <p className="text-sm text-gray-500 mb-5">Choose which products to advertise.</p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* LEFT: Suggestions */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700">Suggested Products</span>
            <span className="text-xs text-gray-400">{asinList.length} products</span>
          </div>
          <div className="p-3 border-b border-gray-100">
            <input
              type="text"
              placeholder="Search ASIN or title…"
              value={asinSearch}
              onChange={e => setAsinSearch(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-green-600"
            />
          </div>
          <div className="overflow-y-auto" style={{ maxHeight: '360px' }}>
            {isLoading ? (
              <div className="p-4"><SkeletonTable /></div>
            ) : filteredAsins.length === 0 ? (
              <div className="text-gray-400 text-sm text-center py-8">
                {asinList.length === 0 ? 'No product data available' : 'No matching products'}
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-white border-b border-gray-100">
                  <tr>
                    <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500 w-6"></th>
                    <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500">ASIN</th>
                    <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500">Title</th>
                    <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500">Orders</th>
                    <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500">Sales</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAsins.map((a, i) => {
                    const isAdded = selectedSet.has(a.asin);
                    return (
                      <tr
                        key={a.asin + i}
                        className={`border-b border-gray-50 hover:bg-gray-50 cursor-pointer ${isAdded ? 'bg-green-50' : ''}`}
                        onClick={() => toggleAsin(a.asin)}
                      >
                        <td className="py-2 px-3">
                          <input
                            type="checkbox"
                            checked={isAdded}
                            onChange={() => toggleAsin(a.asin)}
                            onClick={e => e.stopPropagation()}
                            className="rounded accent-green-700"
                          />
                        </td>
                        <td className="py-2 px-3 text-gray-800 font-mono text-xs">{a.asin}</td>
                        <td className="py-2 px-3 text-gray-500 max-w-[140px]">
                          <span className="block truncate text-xs" title={a.title}>{a.title || '—'}</span>
                        </td>
                        <td className="py-2 px-3 text-right text-gray-500">{a.orders?.toLocaleString() || 0}</td>
                        <td className="py-2 px-3 text-right text-gray-500">{fmt$(a.sales)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* RIGHT: Selected */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700">Selected Products</span>
            <span className="text-xs text-green-700 font-semibold">{form.asins.length} added</span>
          </div>
          <div className="overflow-y-auto" style={{ maxHeight: '360px' }}>
            {form.asins.length === 0 ? (
              <div className="text-gray-400 text-sm text-center py-8">
                Click products to add ASINs
              </div>
            ) : (
              <div className="divide-y divide-gray-50">
                {form.asins.map(asin => {
                  const meta = asinList.find(a => a.asin === asin);
                  return (
                    <div key={asin} className="flex items-center gap-3 px-3 py-2.5">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-mono text-gray-800">{asin}</div>
                        {meta?.title && <div className="text-xs text-gray-400 truncate">{meta.title}</div>}
                      </div>
                      <button
                        onClick={() => toggleAsin(asin)}
                        className="text-gray-400 hover:text-red-500 text-xs flex-shrink-0"
                        title="Remove"
                      >✕</button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          {/* Manual ASIN input */}
          <div className="p-3 border-t border-gray-100 bg-gray-50 flex gap-2">
            <input
              type="text"
              placeholder="Enter ASIN manually…"
              value={manualAsin}
              onChange={e => setManualAsin(e.target.value.toUpperCase())}
              onKeyDown={e => e.key === 'Enter' && addManualAsin()}
              className="flex-1 text-sm border border-gray-200 rounded px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-green-600 font-mono"
              maxLength={10}
            />
            <button
              onClick={addManualAsin}
              className="px-3 py-1.5 bg-green-700 text-white text-sm rounded hover:bg-green-800 transition-colors font-medium"
            >Add</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Step 5: Review & Launch ──────────────────────────────────────────────────
function StepReview({ form, profileId, onLaunch, launching, result }) {
  const navigate = useNavigate();

  const STRATEGY_LABELS = {
    legacyForSales: 'Dynamic bids — down only',
    autoForSales:   'Dynamic bids — up and down',
    manual:         'Fixed bids',
  };

  if (result?.success) {
    return (
      <div className="text-center py-10">
        <div className="text-5xl mb-4">🎉</div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Campaign Created!</h2>
        <p className="text-gray-500 mb-1">Your campaign is live on Amazon Advertising.</p>
        <p className="text-sm text-gray-400 mb-6">Campaign ID: <span className="font-mono font-semibold text-gray-700">{result.campaignId}</span></p>
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={() => navigate('/advertising/campaigns')}
            className="px-5 py-2.5 bg-green-700 text-white rounded-lg hover:bg-green-800 transition-colors font-medium text-sm"
          >
            View Campaigns
          </button>
          <button
            onClick={() => window.location.reload()}
            className="px-5 py-2.5 border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50 transition-colors text-sm"
          >
            Create Another
          </button>
        </div>
      </div>
    );
  }

  if (result?.error) {
    return (
      <div>
        <div className="bg-red-50 border border-red-200 rounded-xl p-5 mb-5">
          <p className="text-red-700 font-medium text-sm mb-1">Campaign creation failed</p>
          <p className="text-red-600 text-sm">{result.error}</p>
        </div>
        <ReviewSummary form={form} profileId={profileId} strategyLabels={STRATEGY_LABELS} />
        <div className="mt-5">
          <button
            onClick={onLaunch}
            disabled={launching}
            className="px-6 py-2.5 bg-green-700 text-white rounded-lg hover:bg-green-800 transition-colors font-semibold text-sm disabled:opacity-50"
          >
            {launching ? 'Retrying…' : 'Try Again'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900 mb-1">Review & Launch</h2>
      <p className="text-sm text-gray-500 mb-5">Review your campaign settings before launching.</p>

      <ReviewSummary form={form} profileId={profileId} strategyLabels={STRATEGY_LABELS} />

      <div className="mt-6 p-4 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-700">
        <strong>Note:</strong> This campaign will go live immediately on Amazon Advertising. Charges begin as soon as ads are served.
      </div>

      <div className="mt-5 flex items-center gap-3">
        <button
          onClick={onLaunch}
          disabled={launching || !profileId}
          className="px-6 py-2.5 bg-green-700 text-white rounded-lg hover:bg-green-800 transition-colors font-semibold text-sm disabled:opacity-50 flex items-center gap-2"
        >
          {launching && (
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
          )}
          {launching ? 'Launching…' : '🚀 Launch Campaign'}
        </button>
        {!profileId && (
          <span className="text-xs text-amber-600">⚠ No Amazon Ads profile found — connect your account first</span>
        )}
      </div>
    </div>
  );
}

const CAMPAIGN_TYPE_LABELS = { SP: 'Sponsored Products', SB: 'Sponsored Brands', SD: 'Sponsored Display' };
const SD_TACTIC_LABELS = { T00020: 'Product Targeting', T00030: 'Audience Retargeting' };
const SD_BIDOPT_LABELS = { clicks: 'Clicks', conversions: 'Conversions', reach: 'Reach', viewableImpressions: 'Viewable Impressions (vCPM)' };

function ReviewSummary({ form, profileId, strategyLabels }) {
  const rows = [
    { label: 'Campaign Type',  value: CAMPAIGN_TYPE_LABELS[form.adType] || form.adType },
    { label: 'Campaign Name',  value: form.campaignName },
    { label: 'Daily Budget',   value: fmt$(form.budget) },
    { label: 'Start Date',     value: form.startDate },
    { label: 'End Date',       value: form.endDate || 'No end date' },
    ...(form.adType === 'SD' ? [
      { label: 'Tactic',          value: SD_TACTIC_LABELS[form.sdTactic || 'T00020'] },
      { label: 'Bid Optimization', value: SD_BIDOPT_LABELS[form.sdBidOptimization || 'clicks'] },
    ] : [
      { label: 'Targeting', value: form.targetingType === 'auto' ? 'Automatic' : 'Manual' },
    ]),
    ...(form.adType === 'SP' ? [{ label: 'Bid Strategy', value: strategyLabels[form.bidStrategy] || form.bidStrategy }] : []),
    { label: 'Default Bid',    value: fmt$(form.defaultBid) },
    { label: 'Ad Group Name',  value: form.adGroupName || '(auto)' },
    ...(form.adType !== 'SD' ? [{ label: 'Keywords', value: `${form.keywords.length} keyword(s)` }] : []),
    { label: 'Products',       value: `${form.asins.length} ASIN(s)` },
    { label: 'Profile ID',     value: profileId || 'Not found' },
  ];

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {rows.map((r, i) => (
        <div key={r.label} className={`flex items-center gap-4 px-4 py-3 text-sm ${i % 2 === 1 ? 'bg-gray-50/50' : ''} ${i < rows.length - 1 ? 'border-b border-gray-100' : ''}`}>
          <span className="text-gray-500 w-36 flex-shrink-0">{r.label}</span>
          <span className="text-gray-900 font-medium">{r.value}</span>
        </div>
      ))}
      {form.keywords.length > 0 && (
        <div className="px-4 py-3 bg-gray-50/50 border-t border-gray-100">
          <p className="text-xs font-semibold text-gray-500 mb-2">KEYWORD LIST</p>
          <div className="flex flex-wrap gap-1.5">
            {form.keywords.map(kw => (
              <span key={kw.term} className="inline-flex items-center gap-1 text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">
                {kw.term}
                <span className="text-blue-400">[{kw.matchType}]</span>
                <span className="text-blue-400">{fmt$(kw.bid)}</span>
              </span>
            ))}
          </div>
        </div>
      )}
      {form.asins.length > 0 && (
        <div className="px-4 py-3 border-t border-gray-100">
          <p className="text-xs font-semibold text-gray-500 mb-2">ASIN LIST</p>
          <div className="flex flex-wrap gap-1.5">
            {form.asins.map(asin => (
              <span key={asin} className="text-xs font-mono bg-gray-100 text-gray-700 px-2 py-0.5 rounded">{asin}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Wizard ──────────────────────────────────────────────────────────────
const STEPS = ['Type', 'Settings', 'Creatives', 'Keywords', 'Products', 'Review'];

export default function CampaignCreate() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [launchResult, setLaunchResult] = useState(null);

  // Fetch profile ID server-side
  const { data: profileData } = useQuery({
    queryKey: ['campaign-profile'],
    queryFn: getCampaignProfile,
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });
  const profileId = profileData?.profileId || null;
  const brandName = profileData?.brandName || '';

  // Fetch dynamic competitor signals (merged with hardcoded fallback)
  const { data: dynamicSignals = [] } = useQuery({
    queryKey: ['competitor-signals'],
    queryFn: getCompetitorSignals,
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });
  const mergedCompetitorSignals = useMemo(
    () => [...new Set([...COMPETITOR_SIGNALS, ...dynamicSignals])],
    [dynamicSignals]
  );

  const defaultName = useCallback(() => {
    const d = today();
    return `Brand ${form?.adType || 'SP'} ${d}`;
  }, []);

  const [form, setForm] = useState(() => ({
    adType:             'SP',
    campaignName:       `Brand SP ${today()}`,
    budget:             '50',
    startDate:          today(),
    endDate:            '',
    bidStrategy:        'legacyForSales',
    targetingType:      'manual',
    defaultBid:         '0.75',
    adGroupName:        '',
    keywords:           [],
    asins:              [],
    sbHeadline:         '',
    sbLogoUrl:          '',
    sbMainImgUrl:       '',
    // SD-specific
    sdTactic:           'T00020',
    sdBidOptimization:  'clicks',
  }));

  // Auto-update campaign name when adType changes
  useEffect(() => {
    setForm(f => ({
      ...f,
      campaignName: `Brand ${f.adType} ${today()}`,
      // SB/SD only support manual targeting type
      ...((f.adType === 'SB' || f.adType === 'SD') ? { targetingType: 'manual' } : {}),
    }));
  }, [form.adType]);

  const mutation = useMutation({
    mutationFn: createCampaign,
    onSuccess: (data) => setLaunchResult(data),
    onError: (err)  => setLaunchResult({ error: err.message }),
  });

  // Step validation
  function canProceed() {
    if (step === 0) return !!form.adType;
    if (step === 1) return !!(form.campaignName && form.budget && Number(form.budget) >= 1 && form.startDate);
    if (step === 2 && form.adType === 'SB') return !!(form.sbHeadline && form.sbHeadline.trim().length >= 1);
    return true;
  }

  // Step flows:
  //   SP manual:  0 Type → 1 Settings → 2 Keywords → 3 Products → 4 Review
  //   SP auto:    0 Type → 1 Settings → 2 Products → 3 Review
  //   SB:         0 Type → 1 Settings → 2 Creatives → 3 Keywords → 4 Products → 5 Review
  //   SD:         0 Type → 1 Settings → 2 Products → 3 Review
  function maxStep() {
    if (form.adType === 'SB') return 5;
    if (form.adType === 'SD') return 3;
    if (form.targetingType === 'auto') return 3;
    return 4;
  }

  function getNextStep() { return Math.min(step + 1, maxStep()); }
  function getPrevStep()  { return Math.max(step - 1, 0); }

  function handleLaunch() {
    setLaunchResult(null);
    mutation.mutate({
      adType:             form.adType,
      campaignName:       form.campaignName,
      budget:             Number(form.budget),
      startDate:          form.startDate,
      endDate:            form.endDate || null,
      targetingType:      form.targetingType,
      bidStrategy:        form.bidStrategy,
      defaultBid:         Number(form.defaultBid || 0.75),
      keywords:           form.keywords.map(k => ({
        term:      k.term,
        matchType: k.matchType,
        bid:       Number(k.bid || form.defaultBid || 0.75),
      })),
      asins:              form.asins,
      adGroupName:        form.adGroupName || `${form.campaignName} - Ad Group 1`,
      profileId,
      // SD
      sdTactic:           form.sdTactic           || 'T00020',
      sdBidOptimization:  form.sdBidOptimization  || 'clicks',
      // SB
      sbHeadline:         form.sbHeadline         || undefined,
      sbLogoUrl:          form.sbLogoUrl           || undefined,
      sbMainImgUrl:       form.sbMainImgUrl        || undefined,
    });
  }

  const showKeywordsStep = form.adType === 'SB' || (form.adType === 'SP' && form.targetingType === 'manual');

  const visibleStepNames =
    form.adType === 'SB' ? ['Type', 'Settings', 'Creatives', 'Keywords', 'Products', 'Review'] :
    form.adType === 'SD' ? ['Type', 'Settings', 'Products', 'Review'] :
    form.targetingType === 'auto' ? ['Type', 'Settings', 'Products', 'Review'] :
    ['Type', 'Settings', 'Keywords', 'Products', 'Review'];

  // Is current step the review step?
  const isReviewStep =
    (form.adType === 'SB' && step === 5) ||
    (form.adType === 'SD' && step === 3) ||
    (form.adType === 'SP' && form.targetingType === 'auto'  && step === 3) ||
    (form.adType === 'SP' && form.targetingType === 'manual' && step === 4);

  return (
    <div>
      <PageHeader title="Create Campaign" subtitle="Launch a new Sponsored Products, Sponsored Brands, or Sponsored Display campaign" />
      <AdvertisingSubNav />

      <div className="max-w-4xl">
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <StepIndicator steps={visibleStepNames} current={step} />

          {/* Step Content */}
          <div className="min-h-64">
            {step === 0 && <StepType form={form} setForm={setForm} />}
            {step === 1 && <StepSettings form={form} setForm={setForm} brandName={brandName} />}

            {/* SB: Creatives → Keywords → Products → Review */}
            {step === 2 && form.adType === 'SB' && <StepCreative form={form} setForm={setForm} />}
            {step === 3 && form.adType === 'SB' && <StepKeywords form={form} setForm={setForm} brandName={brandName} competitorSignals={mergedCompetitorSignals} />}
            {step === 4 && form.adType === 'SB' && <StepAsins form={form} setForm={setForm} />}

            {/* SD: Products → Review */}
            {step === 2 && form.adType === 'SD' && <StepAsins form={form} setForm={setForm} />}

            {/* SP manual: Keywords → Products → Review */}
            {step === 2 && form.adType === 'SP' && form.targetingType === 'manual' && <StepKeywords form={form} setForm={setForm} brandName={brandName} competitorSignals={mergedCompetitorSignals} />}
            {step === 3 && form.adType === 'SP' && form.targetingType === 'manual' && <StepAsins form={form} setForm={setForm} />}

            {/* SP auto: Products → Review */}
            {step === 2 && form.adType === 'SP' && form.targetingType === 'auto' && <StepAsins form={form} setForm={setForm} />}

            {/* Review (last step for all flows) */}
            {isReviewStep && (
              <StepReview
                form={form}
                profileId={profileId}
                onLaunch={handleLaunch}
                launching={mutation.isPending}
                result={launchResult}
              />
            )}
          </div>

          {/* Navigation */}
          {!(launchResult?.success) && (
            <div className="flex items-center justify-between mt-8 pt-6 border-t border-gray-100">
              <button
                onClick={() => step > 0 ? setStep(getPrevStep()) : navigate('/advertising/campaigns')}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
              >
                {step === 0 ? '← Back to Campaigns' : '← Previous'}
              </button>

              {step < maxStep() && (
                <button
                  onClick={() => setStep(getNextStep())}
                  disabled={!canProceed()}
                  className="px-5 py-2 text-sm bg-green-700 text-white rounded-lg hover:bg-green-800 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {step === maxStep() - 1 ? 'Review →' : 'Next →'}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
