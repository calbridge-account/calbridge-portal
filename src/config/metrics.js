/**
 * metrics.js — Calbridge Authoritative Metrics Registry
 *
 * This is the single source of truth for all business metric definitions.
 * Every formula, every definition, every decision about what a number means
 * lives here. Changing a definition is a migration — document it below.
 *
 * Metric structure:
 *   id          — machine-readable key (snake_case)
 *   name        — human label
 *   version     — semver; bump when definition changes
 *   definedAt   — ISO date of creation or last change
 *   formula     — pure JS function (no side effects, no I/O)
 *   description — one sentence: what does this number mean for the business?
 *   unit        — 'currency' | 'ratio' | 'percent' | 'days' | 'score'
 *   notes       — edge cases, caveats, and dependencies on client data
 *
 * ─── Migration Log ──────────────────────────────────────────────────────────
 *
 *   v1.0.0 (2026-03-26)
 *     Initial registry creation.
 *     Formalized CM1/CM2/CM3 model (replacing old flat contribution_margin field).
 *     Break-even ACOS: two implementations found in codebase — flagged for decision.
 *
 *   v1.1.0 (2026-03-26)
 *     break_even_acos: confirmed by Abe. Canonical formula: cm2/revenue as ratio.
 *       Bumped to v1.1.0. Inconsistency resolved. SOUL.md and MEMORY.md updated.
 *     break_even_roas: new metric added. Formula: revenue/cm2 (inverse of break_even_acos).
 *       Confirmed by Abe 2026-03-26.
 *     fba_fulfillment_cost: new metric. Derives FBA fee from product dims + weight
 *       using 2024 US fee tables ported from amazon-fba-calculator skill → fbaFees.js.
 *     total_amazon_fees: new metric. Referral fee + FBA fulfillment fee per unit.
 *       Unlocks CM1 calculation without manual fee entry.
 *
 *   v1.2.0 (2026-03-26)
 *     METRIC_REGISTRY_VERSION constant added. getMetricVersion() exported.
 *     opportunityScorer.js created: v1 scoring engine with CM headroom formula,
 *       opportunity type classification, and override support.
 *     Scoring weights (v1 — NEEDS ABE SIGN-OFF before client use):
 *       cmHeadroom × 50% + conversionEfficiency × 30% + inventoryHealth × 20%
 *     CANONICAL.ACCOUNT_OVERRIDES table designed (migration 002).
 *     METRICS.OPPORTUNITY_SCORES table designed (migration 002).
 *     Feedback loop schema designed (migration 003).
 *
 * ─── Usage ──────────────────────────────────────────────────────────────────
 *
 *   const { METRICS, compute } = require('../config/metrics');
 *
 *   // Call a formula directly:
 *   const cm3 = METRICS.cm3.formula({ cm2: 45.00, adSpend: 12.00 });
 *
 *   // Or use the safe compute() wrapper (returns null on bad inputs):
 *   const result = compute('break_even_acos', { revenue: 100, cm2: 40 });
 */

'use strict';

const {
  getSizeTier,
  getFulfillmentFee,
  getReferralFee,
  calcBillableWeight,
} = require('./fbaFees');

// ─────────────────────────────────────────────────────────────────────────────
// CONTRIBUTION MARGIN MODEL (CM1 / CM2 / CM3)
//
// The CM1/CM2/CM3 model is confirmed by Abe (see contributionMargin.js header).
// It differs from the SOUL.md one-liner definition, which is a legacy
// simplification. The CM1/CM2/CM3 model is the authoritative version.
// ─────────────────────────────────────────────────────────────────────────────

const METRICS = {

  // ── CM1: Net Amazon Proceeds ──────────────────────────────────────────────

  cm1_seller: {
    id:          'cm1_seller',
    name:        'CM1 — Net Amazon Proceeds (Seller)',
    version:     '1.0.0',
    definedAt:   '2026-03-26',
    /**
     * @param {object} p
     * @param {number} p.revenue       - ordered_revenue from sales table
     * @param {number} p.fbaFees       - FBA fulfillment fee per ASIN
     * @param {number} p.referralFees  - Amazon referral fee per ASIN
     * @returns {number}
     */
    formula: ({ revenue, fbaFees, referralFees }) =>
      revenue - fbaFees - referralFees,
    description: 'Net cash received from Amazon after all Amazon-side fees, before brand COGS. Seller accounts only.',
    unit:        'currency',
    notes:       'FBA fees and referral fees come from the products table. Revenue is ordered_revenue from sales table. Does NOT include ad spend — that is CM3.'
  },

  cm1_vendor: {
    id:          'cm1_vendor',
    name:        'CM1 — Net Amazon Proceeds (Vendor)',
    version:     '1.0.0',
    definedAt:   '2026-03-26',
    /**
     * @param {object} p
     * @param {number} p.shippedCogs   - shipped_cogs from vendor sales table (what Amazon paid)
     * @returns {number}
     */
    formula: ({ shippedCogs }) => shippedCogs,
    description: 'What Amazon actually paid the vendor. Vendor Option A: excludes deductions (damages, co-op, chargebacks).',
    unit:        'currency',
    notes:       'IMPORTANT: vendor_cm1_is_estimate = true because full remittance data is not yet integrated. ' +
                 'This excludes Amazon deductions. Real CM1 for vendors will be lower when remittance data is available. ' +
                 'FBA and referral fees are 0 for vendor accounts (vendor bears no direct Amazon fees).'
  },

  // ── CM2: Gross Profit ─────────────────────────────────────────────────────

  cm2: {
    id:          'cm2',
    name:        'CM2 — Gross Profit',
    version:     '1.0.0',
    definedAt:   '2026-03-26',
    /**
     * @param {object} p
     * @param {number}      p.cm1          - Net Amazon proceeds (from cm1_seller or cm1_vendor)
     * @param {number|null} p.cogsPerUnit  - Brand's internal COGS per unit (from products.cogs). null if not uploaded.
     * @param {number}      p.units        - Units sold in the period
     * @returns {number|null}              - null if COGS not available
     */
    formula: ({ cm1, cogsPerUnit, units }) => {
      if (cogsPerUnit == null) return null; // Never show $0 — null means "unknown"
      const totalCogs = cogsPerUnit * (units || 0);
      return cm1 - totalCogs;
    },
    description: 'Net Amazon proceeds minus brand\'s cost of goods. "Is this product worth selling?" before advertising.',
    unit:        'currency',
    notes:       'Returns null (not 0) when COGS has not been uploaded. A null CM2 must be displayed as "—" in the UI, ' +
                 'never as $0.00. COGS is client-supplied via the /cogs/upload endpoint and stored in products.cogs.'
  },

  // ── CM3: True Profitability ───────────────────────────────────────────────

  cm3: {
    id:          'cm3',
    name:        'CM3 — True Profitability',
    version:     '1.0.0',
    definedAt:   '2026-03-26',
    /**
     * @param {object} p
     * @param {number|null} p.cm2      - Gross profit. null if COGS not available.
     * @param {number}      p.adSpend  - Direct ASIN-attributed ad spend (UNATTRIBUTED rows excluded)
     * @returns {number|null}          - null if CM2 is null
     */
    formula: ({ cm2, adSpend }) => {
      if (cm2 == null) return null;
      return cm2 - adSpend;
    },
    description: 'Gross profit minus advertising spend. "Is advertising this product profitable?" — the primary decision metric.',
    unit:        'currency',
    notes:       'If CM3 < 0, the brand is losing money on every sale after all costs and ads. ' +
                 'Ad spend uses DIRECT ASIN attribution only (advertised_asin column). ' +
                 'NEVER use proportional spend splitting. UNATTRIBUTED rows are excluded from per-ASIN attribution. ' +
                 'Returns null if CM2 is null (COGS not uploaded).'
  },

  // ─────────────────────────────────────────────────────────────────────────
  // BREAK-EVEN ACOS
  //
  // ✅ CONFIRMED by Abe 2026-03-26
  //
  // Canonical formula: cm2 / revenue → ratio (0.0 to 1.0)
  // Multiply by 100 at display time only. Never store or pass as percent.
  //
  // Historical note: two formulas previously existed in the codebase:
  //   Version A (decisionEngine.js, healthScore.js): (revenue - cogs - fbaFees) / revenue
  //   Version B (dashboard.js): (cm2 / revenue) * 100  [percent, now deprecated]
  // Both are mathematically equivalent for seller accounts. Version B's ×100
  // is removed from the canonical formula — display layer handles it.
  // ─────────────────────────────────────────────────────────────────────────

  break_even_acos: {
    id:          'break_even_acos',
    name:        'Break-Even ACOS',
    version:     '1.1.0',
    definedAt:   '2026-03-26',
    confirmedAt: '2026-03-26',
    /**
     * CANONICAL formula — confirmed by Abe 2026-03-26.
     * Returns a RATIO (0.0 to 1.0), NOT a percentage.
     * Multiply by 100 for display only.
     *
     * @param {object} p
     * @param {number|null} p.cm2      - Gross profit (CM2). null if COGS not available.
     * @param {number}      p.revenue  - Total revenue for the period
     * @returns {number|null}          - Ratio 0–1. null if revenue = 0 or cm2 = null.
     */
    formula: ({ cm2, revenue }) => {
      if (cm2 == null || !revenue || revenue <= 0) return null;
      return cm2 / revenue;
    },
    description: 'Maximum ACOS at which advertising breaks even. Spending above this destroys margin.',
    unit:        'ratio',
    notes:       'Confirmed by Abe 2026-03-26. Formula: cm2/revenue as ratio. Multiply by 100 for display only. ' +
                 'Returns null when COGS is not uploaded (cm2 = null). ' +
                 'Prior inconsistency (two formulas in codebase) resolved — cm2/revenue is canonical. ' +
                 'dashboard.js callsite at line ~885 still multiplies by 100 — that is correct display behavior, ' +
                 'but the formula itself must never return a percent.'
  },

  // ── Break-Even ROAS ──────────────────────────────────────────────────────

  break_even_roas: {
    id:          'break_even_roas',
    name:        'Break-Even ROAS',
    version:     '1.0.0',
    definedAt:   '2026-03-26',
    confirmedAt: '2026-03-26',
    /**
     * CANONICAL formula — confirmed by Abe 2026-03-26.
     * Inverse of break_even_acos. Returns a RATIO (e.g. 2.5 = 2.5× ROAS).
     *
     * @param {object} p
     * @param {number}      p.revenue  - Total revenue for the period
     * @param {number|null} p.cm2      - Gross profit (CM2). null if COGS not available.
     * @returns {number|null}          - Ratio ≥ 1. null if cm2 = 0/null or revenue = 0.
     */
    formula: ({ revenue, cm2 }) => {
      if (cm2 == null || cm2 <= 0 || !revenue || revenue <= 0) return null;
      return revenue / cm2;
    },
    description: 'Minimum ROAS required for advertising to break even. Ad ROAS below this destroys margin.',
    unit:        'ratio',
    notes:       'Inverse of break_even_acos. Confirmed by Abe 2026-03-26. ' +
                 'If break_even_acos = 0.40, then break_even_roas = 2.5 (must return $2.50 per $1 spent). ' +
                 'Returns null when COGS is not uploaded (cm2 = null) or cm2 ≤ 0 (loss-making ASIN). ' +
                 'Display as "2.5×" — no percent conversion needed.'
  },

  // ── ACOS ─────────────────────────────────────────────────────────────────

  acos: {
    id:          'acos',
    name:        'ACOS — Advertising Cost of Sale',
    version:     '1.0.0',
    definedAt:   '2026-03-26',
    /**
     * @param {object} p
     * @param {number} p.adSpend        - Total ad spend
     * @param {number} p.adAttributedSales - Ad-attributed sales (NOT total retail sales)
     * @returns {number|null}
     */
    formula: ({ adSpend, adAttributedSales }) => {
      if (!adAttributedSales || adAttributedSales <= 0) return null;
      return adSpend / adAttributedSales;
    },
    description: 'Ad spend as a fraction of ad-attributed sales. The campaign-level efficiency metric.',
    unit:        'ratio',
    notes:       'Uses ad-attributed sales only (from ad_performance / campaign_performance). ' +
                 'NOT total retail sales — that is TACOS. ' +
                 'A ratio (e.g. 0.25 = 25%). Multiply by 100 for display.'
  },

  // ── ROAS / True ROAS ─────────────────────────────────────────────────────

  roas: {
    id:          'roas',
    name:        'ROAS — Return on Ad Spend (Campaign-Level)',
    version:     '1.0.0',
    definedAt:   '2026-03-26',
    /**
     * @param {object} p
     * @param {number} p.adAttributedSales - Ad-attributed sales
     * @param {number} p.adSpend           - Ad spend
     * @returns {number|null}
     */
    formula: ({ adAttributedSales, adSpend }) => {
      if (!adSpend || adSpend <= 0) return null;
      return adAttributedSales / adSpend;
    },
    description: 'Revenue returned per dollar of ad spend (attributed sales basis). Campaign-level metric.',
    unit:        'ratio',
    notes:       'Inverse of ACOS. Uses attributed sales, not total retail sales. ' +
                 'e.g. 4.0 = $4 in attributed sales per $1 spent.'
  },

  true_roas: {
    id:          'true_roas',
    name:        'True ROAS — Blended Return on Ad Spend',
    version:     '1.0.0',
    definedAt:   '2026-03-26',
    /**
     * @param {object} p
     * @param {number} p.totalRetailSales - ALL retail sales (ordered + shipped revenue), not just attributed
     * @param {number} p.totalAdSpend     - ALL ad spend across all ad types (SP + SB + SD + DSP)
     * @returns {number|null}
     */
    formula: ({ totalRetailSales, totalAdSpend }) => {
      if (!totalAdSpend || totalAdSpend <= 0) return null;
      return totalRetailSales / totalAdSpend;
    },
    description: 'Total retail revenue divided by total ad spend across all channels. The blended business-level ROAS.',
    unit:        'ratio',
    notes:       'This is SOUL.md\'s "True ROAS" definition: Revenue / Total Ad Spend, all ad types combined. ' +
                 'Uses TOTAL retail revenue (organic + attributed), not just attributed sales. ' +
                 'Compare to campaign-level ROAS (attributed only) to understand halo effect.'
  },

  // ── TACOS ─────────────────────────────────────────────────────────────────

  tacos: {
    id:          'tacos',
    name:        'TACOS — Total Advertising Cost of Sale',
    version:     '1.0.0',
    definedAt:   '2026-03-26',
    /**
     * @param {object} p
     * @param {number} p.totalAdSpend     - All ad spend
     * @param {number} p.totalRetailSales - ALL retail sales (not just attributed)
     * @returns {number|null}
     */
    formula: ({ totalAdSpend, totalRetailSales }) => {
      if (!totalRetailSales || totalRetailSales <= 0) return null;
      return totalAdSpend / totalRetailSales;
    },
    description: 'Total ad spend as a fraction of total retail sales. The true advertising efficiency metric for the whole business.',
    unit:        'ratio',
    notes:       'Unlike ACOS (which uses only attributed revenue), TACOS uses ALL revenue. ' +
                 'TACOS < ACOS is normal and expected (organic sales dilute it). ' +
                 'Multiply by 100 for display as percentage.'
  },

  // ── CAC ───────────────────────────────────────────────────────────────────

  cac: {
    id:          'cac',
    name:        'CAC — Customer Acquisition Cost',
    version:     '1.0.0',
    definedAt:   '2026-03-26',
    /**
     * @param {object} p
     * @param {number} p.adSpendOnNewBuyers - Ad spend attributable to new-to-brand purchases
     * @param {number} p.newBuyerCount      - Count of new-to-brand buyers in period
     * @returns {number|null}
     */
    formula: ({ adSpendOnNewBuyers, newBuyerCount }) => {
      if (!newBuyerCount || newBuyerCount <= 0) return null;
      return adSpendOnNewBuyers / newBuyerCount;
    },
    description: 'Ad cost to acquire one new customer. Drives LTV and payback period calculations.',
    unit:        'currency',
    notes:       '⚠️ NOT YET COMPUTABLE: Requires NTB (new-to-brand) attribution data from Sponsored Brands API. ' +
                 'NTB data only available for SB campaigns on eligible account types. ' +
                 'new_to_brand_purchases column in campaign_performance table is the source. ' +
                 'adSpendOnNewBuyers is an estimate: total SB spend × (ntb_purchases / total_purchases). ' +
                 'Full NTB attribution requires separate NTB spend column which SP-API does not provide directly.'
  },

  // ── Payback Period ────────────────────────────────────────────────────────

  payback_period: {
    id:          'payback_period',
    name:        'Payback Period',
    version:     '1.0.0',
    definedAt:   '2026-03-26',
    /**
     * @param {object} p
     * @param {number} p.cac              - Customer Acquisition Cost
     * @param {number} p.avgMonthlyCmPerCustomer - Average monthly CM3 per repeat customer
     * @returns {number|null}             - Months to recoup CAC
     */
    formula: ({ cac, avgMonthlyCmPerCustomer }) => {
      if (!avgMonthlyCmPerCustomer || avgMonthlyCmPerCustomer <= 0) return null;
      return cac / avgMonthlyCmPerCustomer;
    },
    description: 'Months required to recoup the cost of acquiring a customer through contribution margin.',
    unit:        'days',
    notes:       '⚠️ NOT YET COMPUTABLE: Requires CAC (which requires NTB data) and repeat purchase tracking. ' +
                 'avgMonthlyCmPerCustomer requires customer-level revenue data, not available via SP-API. ' +
                 'Pending: customer cohort analysis from order history. ' +
                 'Unit is months despite field name "days" — rename in v1.1.0.'
  },

  // ── FBA Fulfillment Cost ─────────────────────────────────────────────────

  fba_fulfillment_cost: {
    id:          'fba_fulfillment_cost',
    name:        'FBA Fulfillment Cost',
    version:     '1.0.0',
    definedAt:   '2026-03-26',
    confirmedAt: '2026-03-26',
    /**
     * Returns the FBA fulfillment fee for a product based on its dimensions
     * and weight, using the 2024 Amazon US fee tables in fbaFees.js.
     *
     * Billable weight = max(actual weight, dimensional weight).
     * Dimensional weight = (L × W × H) / 139.
     *
     * @param {object} p
     * @param {number}  p.lengthIn    - Product length in inches
     * @param {number}  p.widthIn     - Product width in inches
     * @param {number}  p.heightIn    - Product height in inches
     * @param {number}  p.weightLbs   - Product actual weight in lbs
     * @returns {number|null}         - Fee in USD, or null if inputs missing
     */
    formula: ({ lengthIn, widthIn, heightIn, weightLbs }) => {
      if (!lengthIn || !widthIn || !heightIn || !weightLbs) return null;
      const { tier } = getSizeTier({ l: lengthIn, w: widthIn, h: heightIn, weightLbs });
      const billable  = calcBillableWeight(lengthIn, widthIn, heightIn, weightLbs);
      return getFulfillmentFee(tier, billable);
    },
    description: 'Amazon FBA pick-pack-ship fee based on product size tier and billable weight (2024 US rates).',
    unit:        'currency',
    notes:       'Uses 2024 Amazon US fee tables from src/config/fbaFees.js. Refresh annually. ' +
                 'Billable weight = max(actual weight, dim weight). Dim weight = L×W×H / 139. ' +
                 'Size tier classification follows Amazon\'s official size tier hierarchy. ' +
                 'Returns null if any dimension or weight is missing. ' +
                 'This is the fulfillment fee only — does not include referral fee or storage.'
  },

  // ── Total Amazon Fees ─────────────────────────────────────────────────────

  total_amazon_fees: {
    id:          'total_amazon_fees',
    name:        'Total Amazon Fees (Referral + FBA)',
    version:     '1.0.0',
    definedAt:   '2026-03-26',
    confirmedAt: '2026-03-26',
    /**
     * The two fees Amazon deducts from every sale: referral fee + FBA
     * fulfillment fee. These are the inputs to CM1 (Net Amazon Proceeds)
     * for seller accounts.
     *
     * @param {object} p
     * @param {number}  p.sellingPrice  - Selling price in USD
     * @param {string}  [p.category]    - Amazon category key (defaults to 'default' = 15%)
     * @param {number}  p.lengthIn      - Product length in inches
     * @param {number}  p.widthIn       - Product width in inches
     * @param {number}  p.heightIn      - Product height in inches
     * @param {number}  p.weightLbs     - Product actual weight in lbs
     * @returns {{ referralFee: number, fulfillmentFee: number, total: number }|null}
     */
    formula: ({ sellingPrice, category = 'default', lengthIn, widthIn, heightIn, weightLbs }) => {
      if (!sellingPrice || !lengthIn || !widthIn || !heightIn || !weightLbs) return null;
      const { tier }    = getSizeTier({ l: lengthIn, w: widthIn, h: heightIn, weightLbs });
      const billable     = calcBillableWeight(lengthIn, widthIn, heightIn, weightLbs);
      const referralFee  = getReferralFee(sellingPrice, category);
      const fulfillmentFee = getFulfillmentFee(tier, billable);
      return {
        referralFee:     Math.round(referralFee * 100) / 100,
        fulfillmentFee:  Math.round(fulfillmentFee * 100) / 100,
        total:           Math.round((referralFee + fulfillmentFee) * 100) / 100,
      };
    },
    description: 'Combined Amazon referral fee + FBA fulfillment fee per unit. The two fees deducted in every CM1 calculation for seller accounts.',
    unit:        'currency',
    notes:       'Returns an object { referralFee, fulfillmentFee, total } — not a scalar. ' +
                 'Use .total for a single fee figure, or destructure for CM1 breakdown. ' +
                 'Referral fee subject to $0.30 minimum per unit. ' +
                 'Category defaults to "default" (15% rate) if omitted. ' +
                 'Fee tables from src/config/fbaFees.js (2024 US rates — refresh annually). ' +
                 'Does NOT include storage fees — use fba_fulfillment_cost + getStorageFee() for full carrying cost.'
  },

  // ── Opportunity Score ─────────────────────────────────────────────────────

  opportunity_score: {
    id:          'opportunity_score',
    name:        'Opportunity Score',
    version:     '1.0.0',
    definedAt:   '2026-03-26',
    /**
     * PLACEHOLDER formula — not production-ready. Abe to define weights.
     *
     * Inputs (all normalized 0–1):
     *   cmHeadroom    = (breakEvenAcos - actualAcos) / breakEvenAcos  [margin headroom]
     *   convEff       = conversionRate / categoryBenchmarkConvRate    [conversion efficiency vs benchmark]
     *   rankTrajectory = slope of rank improvement (normalized, TBD)  [search rank momentum]
     *
     * @param {object} p
     * @param {number|null} p.breakEvenAcos   - Break-even ACOS ratio (0–1)
     * @param {number|null} p.actualAcos      - Actual ACOS ratio (0–1)
     * @param {number|null} p.conversionRate  - CVR for this ASIN
     * @param {number|null} p.rankSlope       - Linear regression slope of search rank (positive = improving)
     * @returns {number|null}                 - Score 0–100, or null if inputs insufficient
     */
    formula: ({ breakEvenAcos, actualAcos, conversionRate, rankSlope }) => {
      // Placeholder: equally weighted, no benchmark for conversionRate yet
      if (breakEvenAcos == null || actualAcos == null) return null;

      // Margin headroom component (0–1, clamped)
      const headroom = breakEvenAcos > 0
        ? Math.max(0, Math.min(1, (breakEvenAcos - actualAcos) / breakEvenAcos))
        : 0;

      // Conversion component (placeholder — no benchmark yet, use 0.1 as naive benchmark)
      const convScore = conversionRate != null
        ? Math.max(0, Math.min(1, conversionRate / 0.1))
        : 0.5; // neutral when unknown

      // Rank trajectory component (placeholder — sign-based, magnitude TBD)
      const rankScore = rankSlope != null
        ? Math.max(0, Math.min(1, 0.5 + rankSlope * 10)) // naive scaling
        : 0.5; // neutral when unknown

      // Equal weights: 40% headroom, 30% conversion, 30% rank
      const raw = (headroom * 0.4) + (convScore * 0.3) + (rankScore * 0.3);
      return Math.round(raw * 100);
    },
    description: 'Composite 0–100 score combining margin headroom, conversion efficiency, and rank trajectory. Higher = better scaling opportunity.',
    unit:        'score',
    notes:       '⚠️ PLACEHOLDER FORMULA — weights and benchmarks not yet defined. ' +
                 'See MEMORY.md: "Opportunity Score formula: needs definition before first client." ' +
                 'Components: CM headroom (40%), conversion efficiency vs benchmark (30%), rank trajectory (30%). ' +
                 'Requires keyword rank data (not yet ingested) for full computation. ' +
                 'Do not surface to clients until formula is finalized with Abe.'
  },

  // ── Inventory-Adjusted Margin ─────────────────────────────────────────────

  inventory_adjusted_margin: {
    id:          'inventory_adjusted_margin',
    name:        'Inventory-Adjusted Margin',
    version:     '1.0.0',
    definedAt:   '2026-03-26',
    /**
     * @param {object} p
     * @param {number|null} p.cm3              - True profitability (CM3)
     * @param {number}      p.monthlyStorageFee - Estimated monthly FBA storage cost for excess inventory
     * @param {number}      p.stockoutRiskAdj   - Revenue at risk from stockouts (penalty, negative value)
     * @returns {number|null}
     */
    formula: ({ cm3, monthlyStorageFee, stockoutRiskAdj }) => {
      if (cm3 == null) return null;
      return cm3 - (monthlyStorageFee || 0) + (stockoutRiskAdj || 0);
    },
    description: 'CM3 adjusted for inventory carrying cost (storage fees) and stockout risk. True economic margin.',
    unit:        'currency',
    notes:       '⚠️ NOT YET COMPUTABLE: Requires FBA storage fee table integration (SP-API Inventory API). ' +
                 'monthlyStorageFee from FBA inventory reports — not yet ingested. ' +
                 'stockoutRiskAdj is a revenue-at-risk estimate requiring inventory level + sales velocity data. ' +
                 'FBA fee tables pulled via SP-API, updated periodically per SOUL.md.'
  }

};

// ─────────────────────────────────────────────────────────────────────────────
// METRIC GROUPS — logical groupings for documentation and tooling
// ─────────────────────────────────────────────────────────────────────────────

const METRIC_GROUPS = {
  contribution_margin: ['cm1_seller', 'cm1_vendor', 'cm2', 'cm3'],
  amazon_fees: ['fba_fulfillment_cost', 'total_amazon_fees'],
  advertising_efficiency: ['acos', 'roas', 'true_roas', 'tacos', 'break_even_acos', 'break_even_roas'],
  customer_economics: ['cac', 'payback_period'],
  opportunity: ['opportunity_score', 'inventory_adjusted_margin']
};

// ─────────────────────────────────────────────────────────────────────────────
// KNOWN INCONSISTENCIES — document here, fix after Abe decides
// ─────────────────────────────────────────────────────────────────────────────

const INCONSISTENCIES = [
  {
    metric:       'break_even_acos',
    severity:     'resolved',
    description:  'Two formulas previously coexisted in the codebase.',
    resolution:   'Confirmed by Abe 2026-03-26: cm2/revenue as ratio is canonical. ' +
                  'dashboard.js ×100 at callsite is correct display behavior (not a formula change). ' +
                  'decisionEngine.js and healthScore.js use equivalent derivation — no formula change needed, ' +
                  'but should be refactored to call compute("break_even_acos") for consistency.',
    status:       'RESOLVED_2026-03-26'
  },
  {
    metric:       'contribution_margin (legacy field)',
    severity:     'low',
    description:  'The legacy contribution_margin column in the DB is cm3 ?? cm1, not the SOUL.md formula.',
    location:     'src/jobs/contributionMargin.js — legacyCm = cm3 ?? cm1',
    soulMdFormula: 'revenue - COGS - FBA fees - referral fees - ad spend',
    actual:       'Stored as cm3 (true profitability) when available, else cm1 (no COGS, no ads). Never the SOUL.md formula directly.',
    recommendation: 'The CM1/CM2/CM3 model supersedes the SOUL.md one-liner. ' +
                    'SOUL.md should be updated to reference the CM model. The legacy column is preserved for backward compat only.',
    status:       'INFORMATIONAL — no action needed, just update SOUL.md'
  },
  {
    metric:       'roas vs true_roas',
    severity:     'low',
    description:  'Codebase uses "roas" for two different things: attributed ROAS and total ROAS.',
    locationA:    'src/routes/advertising.js — roas = sales/spend (attributed)',
    locationB:    'src/routes/dashboard.js /summary — totalRoas = totalRetailSales/totalAdSpend (blended)',
    recommendation: 'Terminology is already differentiated in dashboard.js (totalRoas vs adRoas). ' +
                    'Ensure UI labels clearly distinguish "Ad ROAS" from "Total ROAS". No formula change needed.',
    status:       'INFORMATIONAL — display labeling only'
  }
];

// ─────────────────────────────────────────────────────────────────────────────
// compute() — safe wrapper with null/undefined guard
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Safely compute a metric by ID.
 *
 * @param {string} metricId    - key from METRICS object
 * @param {object} params      - inputs to the formula
 * @returns {number|null}      - computed value, or null if metric not found or inputs invalid
 */
function compute(metricId, params = {}) {
  const metric = METRICS[metricId];
  if (!metric) {
    console.warn(`[metrics] Unknown metric id: ${metricId}`);
    return null;
  }
  try {
    return metric.formula(params);
  } catch (err) {
    console.warn(`[metrics] Error computing ${metricId}:`, err.message);
    return null;
  }
}

/**
 * List all metric IDs with their names (for discovery/documentation).
 * @returns {Array<{id, name, unit, version}>}
 */
function listMetrics() {
  return Object.values(METRICS).map(({ id, name, unit, version, description }) => ({
    id, name, unit, version, description
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// METRIC REGISTRY VERSION
//
// Bump this when ANY metric definition changes (formula, inputs, weights).
// Every opportunity_score row in the warehouse must store this version so
// we can explain "why did the model recommend X?" retroactively.
//
// ─── Registry Version Log ────────────────────────────────────────────────────
//
//   1.0.0 (2026-03-26) — Initial registry: CM1/CM2/CM3, ACOS, ROAS, TACOS, CAC,
//                         break_even_acos/roas, fba fees, opportunity_score placeholder.
//
//   1.1.0 (2026-03-26) — break_even_acos confirmed (cm2/revenue ratio).
//                         break_even_roas added. fba_fulfillment_cost + total_amazon_fees added.
//
//   1.2.0 (2026-03-26) — Opportunity scorer v1 implemented in opportunityScorer.js.
//                         CM headroom formula defined. Scoring weights documented:
//                         cmHeadroom×50% + conversionEfficiency×30% + inventoryHealth×20%.
//                         METRIC_REGISTRY_VERSION constant added. getMetricVersion() exported.
//
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Semver version of this metric registry.
 * Bump on every formula/weight change. Store alongside every scored output row.
 * @type {string}
 */
const METRIC_REGISTRY_VERSION = '1.2.0';

/**
 * Returns the current metric registry version.
 * Scoring jobs must call this and stamp the result on every output row
 * so recommendations stay explainable over time.
 *
 * @returns {{ version: string, asOf: string }}
 */
function getMetricVersion() {
  return {
    version: METRIC_REGISTRY_VERSION,
    asOf:    new Date().toISOString(),
  };
}

module.exports = { METRICS, METRIC_GROUPS, INCONSISTENCIES, compute, listMetrics, METRIC_REGISTRY_VERSION, getMetricVersion };
