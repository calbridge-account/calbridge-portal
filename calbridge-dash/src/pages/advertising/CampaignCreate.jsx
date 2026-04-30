import { useState, useEffect, useCallback } from 'react';
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

// ─── Step 1: Campaign Type ────────────────────────────────────────────────────
function StepType({ form, setForm }) {
  const types = [
    {
      key: 'SP',
      label: 'Sponsored Products',
      icon: '🛍️',
      desc: 'Drive sales for individual products',
      color: 'border-blue-500 bg-blue-50',
      badge: 'bg-blue-100 text-blue-700',
    },
    {
      key: 'SB',
      label: 'Sponsored Brands',
      icon: '🏷️',
      desc: 'Build brand awareness with headline ads',
      color: 'border-green-600 bg-green-50',
      badge: 'bg-green-100 text-green-700',
    },
  ];

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900 mb-1">Campaign Type</h2>
      <p className="text-sm text-gray-500 mb-5">Select the type of Amazon advertising campaign to create.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {types.map(t => (
          <button
            key={t.key}
            onClick={() => setForm(f => ({ ...f, adType: t.key }))}
            className={`rounded-xl border-2 p-6 text-left transition-all hover:shadow-md ${
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

  const TARGETING_TYPES = form.adType === 'SB'
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

        {/* Targeting Type */}
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

// ─── Step 3: Keywords ─────────────────────────────────────────────────────────
function StepKeywords({ form, setForm }) {
  const [kwSearch, setKwSearch] = useState('');
  const [customKw, setCustomKw] = useState('');

  const { data: suggestions = [], isLoading } = useQuery({
    queryKey: ['campaign-suggestions', form.adType],
    queryFn: () => getCampaignSuggestions(form.adType),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const filteredSuggestions = suggestions.filter(s =>
    !kwSearch || s.term.toLowerCase().includes(kwSearch.toLowerCase())
  );

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
      }],
    }));
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
      }],
    }));
    setCustomKw('');
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900 mb-1">Keywords</h2>
      <p className="text-sm text-gray-500 mb-5">Add keywords based on your historical search term data.</p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* LEFT: Suggestions */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700">Suggested Keywords</span>
            <span className="text-xs text-gray-400">{suggestions.length} suggestions</span>
          </div>
          <div className="p-3 border-b border-gray-100">
            <input
              type="text"
              placeholder="Filter keywords…"
              value={kwSearch}
              onChange={e => setKwSearch(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-green-600"
            />
          </div>
          <div className="overflow-y-auto" style={{ maxHeight: '360px' }}>
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
                    <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500 w-6"></th>
                    <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500">Keyword</th>
                    <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500">Clicks</th>
                    <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500">Orders</th>
                    <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500">Sugg. Bid</th>
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
                        <td className="py-2 px-3">
                          <input
                            type="checkbox"
                            checked={isAdded}
                            onChange={() => addKeyword(kw)}
                            onClick={e => e.stopPropagation()}
                            className="rounded accent-green-700"
                          />
                        </td>
                        <td className="py-2 px-3 text-gray-800 font-medium max-w-[160px]">
                          <span className="block truncate" title={kw.term}>{kw.term}</span>
                        </td>
                        <td className="py-2 px-3 text-right text-gray-500">{kw.clicks?.toLocaleString() || 0}</td>
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

        {/* RIGHT: Selected */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700">Selected Keywords</span>
            <span className="text-xs text-green-700 font-semibold">{form.keywords.length} added</span>
          </div>
          <div className="overflow-y-auto" style={{ maxHeight: '360px' }}>
            {form.keywords.length === 0 ? (
              <div className="text-gray-400 text-sm text-center py-8">
                Click suggestions to add keywords
              </div>
            ) : (
              <div className="divide-y divide-gray-50">
                {form.keywords.map(kw => (
                  <div key={kw.term} className="flex items-center gap-2 px-3 py-2.5">
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
                    <input
                      type="number"
                      min="0.02"
                      step="0.01"
                      value={kw.bid}
                      onChange={e => updateKeyword(kw.term, 'bid', e.target.value)}
                      className="w-16 text-xs border border-gray-200 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-green-600"
                    />
                    <button
                      onClick={() => removeKeyword(kw.term)}
                      className="text-gray-400 hover:text-red-500 text-xs flex-shrink-0"
                      title="Remove"
                    >✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>
          {/* Add custom */}
          <div className="p-3 border-t border-gray-100 bg-gray-50 flex gap-2">
            <input
              type="text"
              placeholder="Add custom keyword…"
              value={customKw}
              onChange={e => setCustomKw(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addCustomKeyword()}
              className="flex-1 text-sm border border-gray-200 rounded px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-green-600"
            />
            <button
              onClick={addCustomKeyword}
              className="px-3 py-1.5 bg-green-700 text-white text-sm rounded hover:bg-green-800 transition-colors font-medium"
            >Add</button>
          </div>
        </div>
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

function ReviewSummary({ form, profileId, strategyLabels }) {
  const rows = [
    { label: 'Campaign Type',  value: form.adType === 'SP' ? 'Sponsored Products' : 'Sponsored Brands' },
    { label: 'Campaign Name',  value: form.campaignName },
    { label: 'Daily Budget',   value: fmt$(form.budget) },
    { label: 'Start Date',     value: form.startDate },
    { label: 'End Date',       value: form.endDate || 'No end date' },
    { label: 'Targeting',      value: form.targetingType === 'auto' ? 'Automatic' : 'Manual' },
    ...(form.adType === 'SP' ? [{ label: 'Bid Strategy', value: strategyLabels[form.bidStrategy] || form.bidStrategy }] : []),
    { label: 'Default Bid',    value: fmt$(form.defaultBid) },
    { label: 'Ad Group Name',  value: form.adGroupName || '(auto)' },
    { label: 'Keywords',       value: `${form.keywords.length} keyword(s)` },
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
const STEPS = ['Type', 'Settings', 'Keywords', 'Products', 'Review'];

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

  const defaultName = useCallback(() => {
    const d = today();
    return `Brand ${form?.adType || 'SP'} ${d}`;
  }, []);

  const [form, setForm] = useState(() => ({
    adType:        'SP',
    campaignName:  `Brand SP ${today()}`,
    budget:        '50',
    startDate:     today(),
    endDate:       '',
    bidStrategy:   'legacyForSales',
    targetingType: 'manual',
    defaultBid:    '0.75',
    adGroupName:   '',
    keywords:      [],
    asins:         [],
  }));

  // Auto-update campaign name when adType changes
  useEffect(() => {
    setForm(f => ({
      ...f,
      campaignName: `Brand ${f.adType} ${today()}`,
      // SB only supports manual
      ...(f.adType === 'SB' ? { targetingType: 'manual' } : {}),
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
    if (step === 1) return !!(form.campaignName && form.budget && Number(form.budget) >= 1 && form.startDate && form.targetingType);
    if (step === 2) return true; // keywords optional for auto targeting
    if (step === 3) return true; // ASINs optional (can add later)
    return true;
  }

  // Skip keywords step for auto-targeting SP
  function getNextStep() {
    if (step === 1 && form.adType === 'SP' && form.targetingType === 'auto') {
      return 3; // skip keywords
    }
    return step + 1;
  }

  function getPrevStep() {
    if (step === 3 && form.adType === 'SP' && form.targetingType === 'auto') {
      return 1; // skip keywords going back
    }
    return step - 1;
  }

  function handleLaunch() {
    setLaunchResult(null);
    mutation.mutate({
      adType:        form.adType,
      campaignName:  form.campaignName,
      budget:        Number(form.budget),
      startDate:     form.startDate,
      endDate:       form.endDate || null,
      targetingType: form.targetingType,
      bidStrategy:   form.bidStrategy,
      defaultBid:    Number(form.defaultBid || 0.75),
      keywords:      form.keywords.map(k => ({
        term:      k.term,
        matchType: k.matchType,
        bid:       Number(k.bid || form.defaultBid || 0.75),
      })),
      asins:        form.asins,
      adGroupName:  form.adGroupName || `${form.campaignName} - Ad Group 1`,
      profileId,
    });
  }

  // Determine visible steps (skip keywords for auto-SP)
  const showKeywordsStep = form.adType === 'SB' || form.targetingType === 'manual';
  const visibleStepNames = showKeywordsStep
    ? ['Type', 'Settings', 'Keywords', 'Products', 'Review']
    : ['Type', 'Settings', 'Products', 'Review'];

  // Map real step index to visible step index
  const visibleStep = (() => {
    if (!showKeywordsStep && step >= 3) return step - 1;
    return step;
  })();

  return (
    <div>
      <PageHeader title="Create Campaign" subtitle="Launch a new Sponsored Products or Sponsored Brands campaign" />
      <AdvertisingSubNav />

      <div className="max-w-4xl">
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <StepIndicator steps={visibleStepNames} current={visibleStep} />

          {/* Step Content */}
          <div className="min-h-64">
            {step === 0 && <StepType      form={form} setForm={setForm} />}
            {step === 1 && <StepSettings  form={form} setForm={setForm} />}
            {step === 2 && showKeywordsStep && <StepKeywords form={form} setForm={setForm} />}
            {step === 3 && <StepAsins     form={form} setForm={setForm} />}
            {step === 4 && (
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
          {!(step === 4 && launchResult?.success) && (
            <div className="flex items-center justify-between mt-8 pt-6 border-t border-gray-100">
              <button
                onClick={() => step > 0 ? setStep(getPrevStep()) : navigate('/advertising/campaigns')}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
              >
                {step === 0 ? '← Back to Campaigns' : '← Previous'}
              </button>

              {step < 4 && (
                <button
                  onClick={() => setStep(getNextStep())}
                  disabled={!canProceed()}
                  className="px-5 py-2 text-sm bg-green-700 text-white rounded-lg hover:bg-green-800 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {step === 3 ? 'Review →' : 'Next →'}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
