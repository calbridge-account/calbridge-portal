import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useExpansionCandidates, useHarvestTerms, useMarketplace } from '../../hooks/useAnalytics';
import { useDateRange } from '../../context/DateRangeContext';
import PageHeader from '../../components/PageHeader';
import { SkeletonCard, SkeletonTable, ErrorState } from '../../components/Skeleton';

import ExportMenu from '../../components/ExportMenu';
import { exportToXlsx } from '../../utils/exportUtils';

// ─── Formatting helpers ───────────────────────────────────────────────────────
function makeFmtCurrency(currency = 'USD') {
  const locale = currency === 'CAD' ? 'en-CA' : 'en-US';
  return (n) => {
    if (n == null || isNaN(n)) return '—';
    return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);
  };
}
function fmtPct(n) {
  if (n == null || isNaN(n)) return '—';
  return `${(Number(n) * 100).toFixed(1)}%`;
}
function fmtPctRaw(n) {
  // n is already in 0–100 form (not 0–1)
  if (n == null || isNaN(n)) return '—';
  return `${Number(n).toFixed(1)}%`;
}
function fmtNum(n) {
  if (n == null || isNaN(n)) return '—';
  return new Intl.NumberFormat('en-US').format(Number(n));
}
function fmtMoney(n) {
  if (n == null || isNaN(n)) return '—';
  return `$${Number(n).toFixed(2)}`;
}

// ─── Strategy badge colors ───────────────────────────────────────────────────
function strategyColor(strategy) {
  switch (strategy) {
    case 'exact_asin':
    case 'model_exact':  return 'bg-purple-100 text-purple-700';
    case 'competitor':   return 'bg-red-100 text-red-700';
    case 'brand':        return 'bg-indigo-100 text-indigo-700';
    case 'head_keyword': return 'bg-gray-100 text-gray-500';
    case 'mid_tail':     return 'bg-green-100 text-green-700';
    case 'long_tail':    return 'bg-teal-100 text-teal-700';
    default:             return 'bg-gray-100 text-gray-500';
  }
}

function matchTypeColor(mt) {
  switch (mt) {
    case 'EXACT': return 'bg-blue-100 text-blue-700';
    case 'PHRASE': return 'bg-green-100 text-green-700';
    case 'BROAD':  return 'bg-gray-100 text-gray-500';
    default:       return 'bg-gray-100 text-gray-500';
  }
}

// ─── Readiness badge ─────────────────────────────────────────────────────────
function ReadinessBadge({ readiness }) {
  if (readiness === 'ready')    return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">✓ Ready to Harvest</span>;
  if (readiness === 'warming')  return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">⏳ Warming Up</span>;
  return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">📊 Low Conversion Data</span>;
}

// ─── Candidate card ──────────────────────────────────────────────────────────
function CandidateCard({ candidate, isSelected, onSelect, fmtC }) {
  const { asin, productTitle, campaignName, daysRunning, spend, orders, acos, harvestReadiness, hasManualCampaign } = candidate;

  return (
    <div
      className={`bg-white rounded-xl border p-4 flex flex-col gap-3 cursor-pointer transition-all hover:shadow-md ${
        isSelected ? 'ring-2 ring-green-500 border-green-300' : 'border-gray-200'
      }`}
      onClick={onSelect}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold text-sm text-gray-900 truncate flex-1" title={productTitle}>{productTitle}</p>
        <span className="font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded flex-shrink-0">{asin}</span>
      </div>

      {/* Campaign name */}
      <p className="text-xs text-gray-400 truncate -mt-2" title={campaignName}>{campaignName}</p>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-1 text-xs text-center">
        <div>
          <div className="font-semibold text-gray-800">{daysRunning}d</div>
          <div className="text-gray-400">Days</div>
        </div>
        <div>
          <div className="font-semibold text-gray-800">{fmtC(spend)}</div>
          <div className="text-gray-400">Spend</div>
        </div>
        <div>
          <div className="font-semibold text-gray-800">{orders}</div>
          <div className="text-gray-400">Orders</div>
        </div>
        <div>
          <div className="font-semibold text-gray-800">{acos != null ? fmtPct(acos) : '—'}</div>
          <div className="text-gray-400">ACoS</div>
        </div>
      </div>

      {/* Badges */}
      <div className="flex flex-wrap gap-1.5">
        <ReadinessBadge readiness={harvestReadiness} />
        {hasManualCampaign && (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-600">Manual Active</span>
        )}
      </div>

      {/* CTA */}
      <button
        className={`w-full mt-auto py-1.5 text-xs font-semibold rounded-lg border transition-colors ${
          isSelected
            ? 'bg-green-600 text-white border-green-600'
            : 'bg-white text-green-700 border-green-500 hover:bg-green-50'
        }`}
        onClick={(e) => { e.stopPropagation(); onSelect(); }}
      >
        {isSelected ? '▾ Reviewing Terms' : 'Review Terms →'}
      </button>
    </div>
  );
}

// ─── Settings panel ──────────────────────────────────────────────────────────
function SettingsPanel({ thresholds, onChange, onClose }) {
  const [local, setLocal] = useState({ ...thresholds });
  const set = (k, v) => setLocal(prev => ({ ...prev, [k]: Number(v) }));

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-sm text-gray-800">Harvest Thresholds</h3>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { key: 'minDays',   label: 'Min Days Running', min: 1,  max: 90  },
          { key: 'minSpend',  label: 'Min Spend ($)',    min: 0,  max: 500 },
          { key: 'minOrders', label: 'Min Orders',       min: 0,  max: 50  },
          { key: 'minClicks', label: 'Min Clicks (terms)', min: 0, max: 100 },
        ].map(({ key, label, min, max }) => (
          <label key={key} className="flex flex-col gap-1">
            <span className="text-xs text-gray-500">{label}</span>
            <input
              type="number"
              min={min} max={max}
              value={local[key]}
              onChange={e => set(key, e.target.value)}
              className="border border-gray-200 rounded px-2 py-1 text-sm w-full"
            />
          </label>
        ))}
      </div>
      <div className="flex gap-2 mt-4">
        <button
          onClick={() => { onChange(local); onClose(); }}
          className="px-4 py-1.5 text-xs font-semibold bg-green-600 text-white rounded-lg hover:bg-green-700"
        >
          Apply
        </button>
        <button onClick={onClose} className="px-4 py-1.5 text-xs font-medium text-gray-500 bg-gray-100 rounded-lg hover:bg-gray-200">
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function AdvertisingExpansion() {
  const navigate = useNavigate();
  const { range } = useDateRange();
  const { activeMarketplace } = useMarketplace() ?? { activeMarketplace: 'US' };
  const currency = activeMarketplace === 'CA' ? 'CAD' : 'USD';
  const fmtC = makeFmtCurrency(currency);

  // State
  const [thresholds, setThresholds] = useState({ minDays: 14, minSpend: 20, minOrders: 2, minClicks: 5 });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [termFilter, setTermFilter] = useState('all');
  const [selectedTermKeys, setSelectedTermKeys] = useState(new Set());
  const [showComingSoon, setShowComingSoon] = useState(false);

  // Data
  const { data: candidates, isLoading: candidatesLoading, isError: candidatesError } = useExpansionCandidates(thresholds);
  const { data: harvestData, isLoading: harvestLoading, isError: harvestError } = useHarvestTerms(
    selected?.asin,
    selected?.campaignId,
    thresholds,
    range,
    !!selected
  );

  const terms = harvestData?.terms ?? [];
  const pauseRec = harvestData?.pauseRecommendation;
  const autoStats = harvestData?.autoStats;

  // Filter terms by tab
  const filteredTerms = terms.filter(t => {
    if (termFilter === 'sb') return t.sbOpportunity;
    if (termFilter === 'sd') return t.sdOpportunity;
    return true;
  });

  // Stats
  const totalTerms = terms.length;
  const newOpps = terms.filter(t => !t.existsInManual).length;
  const alreadyInManual = terms.filter(t => t.existsInManual).length;
  const sbCount = terms.filter(t => t.sbOpportunity).length;
  const sdCount = terms.filter(t => t.sdOpportunity).length;

  // Selected term counts for action buttons
  const selectedArr = Array.from(selectedTermKeys);
  const selectedSbTerms = selectedArr.filter(k => {
    const t = terms.find(t => t.searchTerm === k);
    return t?.sbOpportunity;
  });
  const selectedSdTerms = selectedArr.filter(k => {
    const t = terms.find(t => t.searchTerm === k);
    return t?.sdOpportunity;
  });

  function handleSelectCard(candidate) {
    if (selected?.asin === candidate.asin && selected?.campaignId === candidate.campaignId) {
      setSelected(null);
      setSelectedTermKeys(new Set());
      setTermFilter('all');
    } else {
      setSelected(candidate);
      setSelectedTermKeys(new Set());
      setTermFilter('all');
      setShowComingSoon(false);
    }
  }

  function toggleTerm(key) {
    setSelectedTermKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function selectAllNew() {
    setSelectedTermKeys(new Set(terms.filter(t => !t.existsInManual).map(t => t.searchTerm)));
  }

  function handleBuildSP() {
    if (selectedTermKeys.size === 0) return;
    navigate('/advertising/campaigns/create', {
      state: {
        harvestMode: true,
        asin: selected.asin,
        selectedTerms: Array.from(selectedTermKeys).map(k => terms.find(t => t.searchTerm === k)).filter(Boolean),
        adType: 'SP',
      }
    });
  }

  function handleExportXlsx() {
    const rows = filteredTerms.map(t => ({
      'Search Term': t.searchTerm,
      'Clicks': t.clicks,
      'Impressions': t.impressions,
      'Spend': t.spend,
      'Orders': t.orders,
      'Sales': t.sales,
      'ACoS': t.acos != null ? (t.acos * 100).toFixed(1) + '%' : '',
      'CPC': t.cpc != null ? t.cpc.toFixed(2) : '',
      'CTR': t.ctr != null ? (t.ctr * 100).toFixed(2) + '%' : '',
      'Strategy': t.matchTypeRecommendation?.label ?? '',
      'Match Types': (t.matchTypeRecommendation?.matchTypes ?? []).join(', '),
      'Suggested Bid': t.matchTypeRecommendation?.suggestedBid ?? '',
      'Already in Manual': t.existsInManual ? 'Yes' : 'No',
      'SB Opportunity': t.sbOpportunity ? 'Yes' : 'No',
      'SD Retargeting': t.sdOpportunity ? 'Yes' : 'No',
    }));
    exportToXlsx(rows, `harvest-terms-${selected?.asin ?? 'export'}`);
  }

  // Suggested action human text
  function actionLabel(action) {
    if (action === 'pause') return 'Suggested action: Pause auto campaign';
    if (action === 'reduce_budget') return 'Suggested action: Reduce auto campaign budget';
    return 'Suggested action: Keep auto running in parallel';
  }

  return (
    <div className="px-4 sm:px-6 pb-16 max-w-screen-xl mx-auto">


      <PageHeader
        title="Advertising Expansion 🌱"
        subtitle="Harvest winning search terms from auto campaigns and build targeted manual campaigns."
        actions={
          <button
            onClick={() => setSettingsOpen(o => !o)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:border-gray-300 hover:bg-gray-50 transition-colors"
            title="Adjust harvest thresholds"
          >
            ⚙️ Thresholds
          </button>
        }
      />

      {/* Settings panel */}
      {settingsOpen && (
        <SettingsPanel
          thresholds={thresholds}
          onChange={setThresholds}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {/* ── Candidate Cards ─────────────────────────────────────────────── */}
      {candidatesError ? (
        <ErrorState message="Failed to load expansion candidates. Check your data connection." />
      ) : candidatesLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mb-8">
          {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : !candidates || candidates.length === 0 ? (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-10 text-center mb-8">
          <p className="text-gray-500 text-sm font-medium">No auto campaigns found matching harvest thresholds.</p>
          <p className="text-gray-400 text-xs mt-1">Try lowering the minimum spend or days threshold above.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mb-8">
          {candidates.map(c => (
            <CandidateCard
              key={`${c.asin}-${c.campaignId}`}
              candidate={c}
              isSelected={selected?.asin === c.asin && selected?.campaignId === c.campaignId}
              onSelect={() => handleSelectCard(c)}
              fmtC={fmtC}
            />
          ))}
        </div>
      )}

      {/* ── Harvest Workspace ───────────────────────────────────────────── */}
      {selected && (
        <div>
          {/* Divider with product title */}
          <div className="flex items-center gap-3 mb-5">
            <div className="h-px flex-1 bg-gray-200" />
            <span className="text-sm font-semibold text-gray-700 whitespace-nowrap">
              🔍 {selected.productTitle} — <span className="font-mono text-gray-500">{selected.asin}</span>
            </span>
            <div className="h-px flex-1 bg-gray-200" />
          </div>

          {/* Auto stats bar */}
          {autoStats && (
            <div className="flex flex-wrap gap-4 text-xs text-gray-500 mb-4">
              {autoStats.avgCpc > 0 && (
                <span>Avg auto CPC: <strong className="text-gray-700">{fmtMoney(autoStats.avgCpc)}</strong></span>
              )}
              {autoStats.breakEvenAcos != null && (
                <span>Break-even ACoS: <strong className="text-gray-700">{fmtPct(autoStats.breakEvenAcos)}</strong></span>
              )}
            </div>
          )}

          {/* Pausing recommendation banner */}
          {pauseRec?.shouldConsider && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 mb-4 flex items-start gap-2">
              <span className="text-amber-500 text-base flex-shrink-0 mt-0.5">⚠️</span>
              <div className="text-sm text-amber-800">
                <p>{pauseRec.reason}</p>
                <p className="text-xs text-amber-600 mt-0.5 font-medium">{actionLabel(pauseRec.suggestedAction)}</p>
              </div>
            </div>
          )}
          {pauseRec && !pauseRec.shouldConsider && pauseRec.reason && (
            <div className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-3 mb-4 flex items-start gap-2">
              <span className="text-blue-400 text-base flex-shrink-0 mt-0.5">ℹ️</span>
              <p className="text-sm text-blue-700">{pauseRec.reason}</p>
            </div>
          )}

          {/* Term filter tabs + export */}
          <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
            <div className="flex gap-1">
              {[
                { key: 'all', label: 'All' },
                { key: 'sp',  label: 'SP' },
                { key: 'sb',  label: `SB Opportunities (${sbCount})` },
                { key: 'sd',  label: `SD Retargeting (${sdCount})` },
              ].map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setTermFilter(tab.key)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                    termFilter === tab.key
                      ? 'bg-green-600 text-white border-green-600'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            {harvestData && (
              <ExportMenu onXlsx={handleExportXlsx} />
            )}
          </div>

          {/* Stats summary bar */}
          {harvestData && !harvestLoading && (
            <p className="text-xs text-gray-500 mb-3">
              <strong className="text-gray-700">{totalTerms}</strong> terms total ·{' '}
              <strong className="text-green-700">{newOpps}</strong> new opportunities ·{' '}
              <strong className="text-gray-500">{alreadyInManual}</strong> already in manual ·{' '}
              <strong className="text-indigo-700">{sbCount}</strong> SB opportunities ·{' '}
              <strong className="text-teal-700">{sdCount}</strong> SD retargeting
            </p>
          )}

          {/* Terms table */}
          {harvestError ? (
            <ErrorState message="Failed to load search terms. The campaign may not have search term data yet." />
          ) : harvestLoading ? (
            <SkeletonTable />
          ) : filteredTerms.length === 0 ? (
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-8 text-center">
              <p className="text-gray-400 text-sm">No terms found for this filter.</p>
              {totalTerms === 0 && (
                <p className="text-gray-400 text-xs mt-1">Try lowering the minimum clicks threshold in settings.</p>
              )}
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="w-8 px-3 py-2 text-left">
                        <input
                          type="checkbox"
                          className="rounded"
                          checked={selectedTermKeys.size > 0 && filteredTerms.every(t => selectedTermKeys.has(t.searchTerm))}
                          onChange={e => {
                            if (e.target.checked) {
                              setSelectedTermKeys(prev => {
                                const next = new Set(prev);
                                filteredTerms.forEach(t => next.add(t.searchTerm));
                                return next;
                              });
                            } else {
                              setSelectedTermKeys(prev => {
                                const next = new Set(prev);
                                filteredTerms.forEach(t => next.delete(t.searchTerm));
                                return next;
                              });
                            }
                          }}
                        />
                      </th>
                      <th className="px-3 py-2 text-left font-semibold text-gray-500 uppercase tracking-wide">Search Term</th>
                      <th className="px-3 py-2 text-right font-semibold text-gray-500 uppercase tracking-wide">Clicks</th>
                      <th className="px-3 py-2 text-right font-semibold text-gray-500 uppercase tracking-wide">Impr</th>
                      <th className="px-3 py-2 text-right font-semibold text-gray-500 uppercase tracking-wide">Spend</th>
                      <th className="px-3 py-2 text-right font-semibold text-gray-500 uppercase tracking-wide">Orders</th>
                      <th className="px-3 py-2 text-right font-semibold text-gray-500 uppercase tracking-wide">Sales</th>
                      <th className="px-3 py-2 text-right font-semibold text-gray-500 uppercase tracking-wide">ACoS</th>
                      <th className="px-3 py-2 text-right font-semibold text-gray-500 uppercase tracking-wide">CPC</th>
                      <th className="px-3 py-2 text-left font-semibold text-gray-500 uppercase tracking-wide">Strategy</th>
                      <th className="px-3 py-2 text-left font-semibold text-gray-500 uppercase tracking-wide">Match Types</th>
                      <th className="px-3 py-2 text-right font-semibold text-gray-500 uppercase tracking-wide">Bid</th>
                      <th className="px-3 py-2 text-center font-semibold text-gray-500 uppercase tracking-wide">SB</th>
                      <th className="px-3 py-2 text-center font-semibold text-gray-500 uppercase tracking-wide">SD</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredTerms.map((t, i) => {
                      const isManual = t.existsInManual;
                      const isChecked = selectedTermKeys.has(t.searchTerm);
                      const rec = t.matchTypeRecommendation;
                      return (
                        <tr
                          key={`${t.searchTerm}-${i}`}
                          className={`hover:bg-gray-50 transition-colors ${isManual ? 'opacity-50' : ''} ${isChecked ? 'bg-green-50' : ''}`}
                        >
                          <td className="px-3 py-2">
                            <input
                              type="checkbox"
                              className="rounded"
                              checked={isChecked}
                              onChange={() => toggleTerm(t.searchTerm)}
                            />
                          </td>
                          <td className={`px-3 py-2 max-w-[200px] ${isManual ? 'italic' : ''}`}>
                            <span className="block truncate" title={t.searchTerm}>{t.searchTerm}</span>
                            {isManual && <span className="text-[10px] text-gray-400">already in manual</span>}
                          </td>
                          <td className="px-3 py-2 text-right text-gray-700">{fmtNum(t.clicks)}</td>
                          <td className="px-3 py-2 text-right text-gray-700">{fmtNum(t.impressions)}</td>
                          <td className="px-3 py-2 text-right text-gray-700">{fmtC(t.spend)}</td>
                          <td className="px-3 py-2 text-right font-semibold text-gray-800">{t.orders}</td>
                          <td className="px-3 py-2 text-right text-gray-700">{fmtC(t.sales)}</td>
                          <td className="px-3 py-2 text-right text-gray-700">{t.acos != null ? fmtPct(t.acos) : '—'}</td>
                          <td className="px-3 py-2 text-right text-gray-700">{t.cpc != null ? fmtMoney(t.cpc) : '—'}</td>
                          <td className="px-3 py-2">
                            {rec && (
                              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${strategyColor(rec.strategy)}`}>
                                {rec.label}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex flex-wrap gap-1">
                              {(rec?.matchTypes ?? []).map(mt => (
                                <span key={mt} className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${matchTypeColor(mt)}`}>
                                  {mt}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right text-gray-700 font-mono">{rec?.suggestedBid != null ? fmtMoney(rec.suggestedBid) : '—'}</td>
                          <td className="px-3 py-2 text-center">{t.sbOpportunity ? '✓' : ''}</td>
                          <td className="px-3 py-2 text-center">{t.sdOpportunity ? '✓' : ''}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Action bar */}
          {harvestData && !harvestLoading && (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                onClick={selectAllNew}
                className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50"
              >
                Select All New
              </button>
              <button
                onClick={() => setSelectedTermKeys(new Set())}
                className="px-3 py-1.5 text-xs font-medium text-gray-500 bg-white border border-gray-200 rounded-lg hover:bg-gray-50"
              >
                Clear
              </button>

              <div className="flex-1" />

              <button
                onClick={handleBuildSP}
                disabled={selectedTermKeys.size === 0}
                className="px-4 py-1.5 text-xs font-semibold text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                → Build SP Manual Campaign{selectedTermKeys.size > 0 ? ` (${selectedTermKeys.size})` : ''}
              </button>

              <button
                onClick={() => setShowComingSoon(true)}
                disabled={selectedSbTerms.length === 0}
                className="px-4 py-1.5 text-xs font-semibold text-white bg-indigo-500 rounded-lg hover:bg-indigo-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                → SB Opportunities ({selectedSbTerms.length})
              </button>

              <button
                onClick={() => setShowComingSoon(true)}
                disabled={selectedSdTerms.length === 0}
                className="px-4 py-1.5 text-xs font-semibold text-white bg-teal-500 rounded-lg hover:bg-teal-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                → SD Retargeting ({selectedSdTerms.length})
              </button>
            </div>
          )}

          {/* Coming soon banner */}
          {showComingSoon && (
            <div className="mt-3 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 flex items-start justify-between gap-2">
              <p className="text-sm text-blue-700">
                <strong>SB and SD campaign launch</strong> from this tool is coming soon. Your terms are saved for reference.
              </p>
              <button onClick={() => setShowComingSoon(false)} className="text-blue-400 hover:text-blue-600 text-lg leading-none flex-shrink-0">×</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
