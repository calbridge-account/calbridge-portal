/**
 * fbaFees.js — Amazon FBA Fee Tables & Helper Functions
 *
 * Ported from the amazon-fba-calculator skill (calculator.py).
 * Source data: 2024 Amazon FBA rate tables (US marketplace).
 *
 * ⚠️  REFRESH ANNUALLY — Amazon updates FBA fees each January/February.
 *     Last updated: 2026-03-26 (reflecting 2024 published rates).
 *     Next review due: 2027-01 or when Amazon publishes new rate cards.
 *
 * ─── Contents ────────────────────────────────────────────────────────────
 *   SIZE_TIERS                — dimension/weight limits per tier
 *   FBA_FULFILLMENT_FEES      — fulfillment fee schedule by tier
 *   STORAGE_FEES              — monthly storage rate per cubic foot
 *   LONG_TERM_STORAGE_FEES    — aged inventory surcharges
 *   REFERRAL_RATES            — category referral fee rates
 *   REMOVAL_FEES              — removal/disposal fee per unit by tier
 *
 *   getSizeTier(dims)         — classify product into a size tier
 *   getFulfillmentFee(tier, weightLbs) — lookup fulfillment fee
 *   getStorageFee(tier, cubicFt, month) — monthly storage cost
 *   getLongTermStorageFee(cubicFt, ageDays) — aged inventory surcharge
 *   getReferralFee(price, category) — referral fee in dollars
 *   getRemovalFee(tier)       — removal/disposal fee per unit
 *   calcDimWeight(l, w, h)    — dimensional weight in lbs
 *   calcBillableWeight(l, w, h, actualWeightLbs) — billable weight
 *   calcCubicFeet(l, w, h)    — volume in cubic feet
 * ─────────────────────────────────────────────────────────────────────────
 */

'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// SIZE TIER DEFINITIONS
// Dimensions: inches. Weight: lbs. Girth = 2 × (width + height).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Canonical size tier identifiers.
 * @readonly
 * @enum {string}
 */
const SIZE_TIERS = {
  SMALL_STANDARD:   'Small Standard',
  LARGE_STANDARD:   'Large Standard',
  SMALL_OVERSIZE:   'Small Oversize',
  MEDIUM_OVERSIZE:  'Medium Oversize',
  LARGE_OVERSIZE:   'Large Oversize',
  SPECIAL_OVERSIZE: 'Special Oversize',
};

/**
 * Size tier qualification limits (sorted from smallest to largest).
 * Evaluation order matters — check from top; first match wins.
 *
 * Notes:
 *   - Small Standard uses weight in oz (≤16 oz = 1 lb)
 *   - Oversize tiers use length + girth for the Medium/Large/Special check
 *   - Sort dimensions descending before comparing (longest side = L)
 */
const SIZE_TIER_LIMITS = [
  {
    tier:      SIZE_TIERS.SMALL_STANDARD,
    maxWeightOz: 16,        // ≤1 lb
    maxL:      15,           // inches (longest side)
    maxW:      12,
    maxH:      0.75,
  },
  {
    tier:      SIZE_TIERS.LARGE_STANDARD,
    maxWeightLbs: 20,
    maxL:      18,
    maxW:      14,
    maxH:      8,
  },
  {
    tier:      SIZE_TIERS.SMALL_OVERSIZE,
    maxWeightLbs: 70,
    maxL:      60,           // longest side
    maxW:      30,           // median side
    // No height constraint (oversize uses L × median × shortest)
  },
  {
    tier:      SIZE_TIERS.MEDIUM_OVERSIZE,
    maxWeightLbs: 150,
    maxLengthPlusGirth: 108, // L + 2*(W+H) ≤ 108"
  },
  {
    tier:      SIZE_TIERS.LARGE_OVERSIZE,
    maxWeightLbs: 150,
    maxLengthPlusGirth: 165,
  },
  // Special Oversize: anything exceeding Large Oversize limits
  {
    tier:      SIZE_TIERS.SPECIAL_OVERSIZE,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// FBA FULFILLMENT FEES  (2024 US rates)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fulfillment fee schedule by size tier.
 *
 * Small Standard:
 *   $3.22 base (≤4 oz), +$0.08/oz above 4 oz (max 16 oz)
 *
 * Large Standard:
 *   Weight tiers in oz; for >3 lb: $6.10 base + $0.38/lb above 3 lb
 *
 * Oversize:
 *   Base + per-lb above threshold
 */
const FBA_FULFILLMENT_FEES = {
  [SIZE_TIERS.SMALL_STANDARD]: {
    baseFee:       3.22,   // ≤4 oz
    perOzAbove4:   0.08,   // for oz 5–16
    maxWeightOz:   16,
  },

  [SIZE_TIERS.LARGE_STANDARD]: {
    // [maxWeightOz, fee] — first bracket whose maxWeightOz >= actual weight wins
    weightTiers: [
      [4,   3.86],   // 0–4 oz
      [8,   4.08],   // 4+–8 oz
      [12,  4.24],   // 8+–12 oz
      [16,  4.75],   // 12+–16 oz (1 lb)
      [32,  5.40],   // 1+–2 lb
      [48,  6.10],   // 2+–3 lb
      [320, 6.10],   // 3+–20 lb (use perLbAbove3 for overage)
    ],
    perLbAbove3: 0.38,
  },

  [SIZE_TIERS.SMALL_OVERSIZE]: {
    baseFee:        9.73,
    perLbAbove1:    0.42,
  },

  [SIZE_TIERS.MEDIUM_OVERSIZE]: {
    baseFee:        19.05,
    perLbAbove1:    0.42,
  },

  [SIZE_TIERS.LARGE_OVERSIZE]: {
    baseFee:        89.98,
    perLbAbove90:   0.83,
  },

  [SIZE_TIERS.SPECIAL_OVERSIZE]: {
    baseFee:        158.49,
    perLbAbove90:   0.83,
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// MONTHLY STORAGE FEES  (2024 US rates, per cubic foot)
// Standard season: January–September
// Peak season:     October–December
// ─────────────────────────────────────────────────────────────────────────────

const STORAGE_FEES = {
  [SIZE_TIERS.SMALL_STANDARD]:   { standard: 0.78, peak: 2.40 },
  [SIZE_TIERS.LARGE_STANDARD]:   { standard: 0.78, peak: 2.40 },
  [SIZE_TIERS.SMALL_OVERSIZE]:   { standard: 0.56, peak: 1.40 },
  [SIZE_TIERS.MEDIUM_OVERSIZE]:  { standard: 0.56, peak: 1.40 },
  [SIZE_TIERS.LARGE_OVERSIZE]:   { standard: 0.56, peak: 1.40 },
  [SIZE_TIERS.SPECIAL_OVERSIZE]: { standard: 0.56, peak: 1.40 },
};

// ─────────────────────────────────────────────────────────────────────────────
// LONG-TERM STORAGE FEES  (2024 US rates, per cubic foot)
// Assessed monthly on inventory aged > 270 days.
// ─────────────────────────────────────────────────────────────────────────────

const LONG_TERM_STORAGE_FEES = {
  days271to365: 1.50,   // per cubic foot
  daysOver365:  6.90,   // per cubic foot
};

// ─────────────────────────────────────────────────────────────────────────────
// REFERRAL FEE RATES  (2024 US rates, as decimal fractions)
// Amazon charges these as a % of the selling price (minimum $0.30 per item).
// ─────────────────────────────────────────────────────────────────────────────

const REFERRAL_RATES = {
  default:      0.15,
  electronics:  0.08,
  computers:    0.08,
  camera:       0.08,
  video_games:  0.15,
  books:        0.15,
  clothing:     0.17,
  shoes:        0.15,
  jewelry:      0.20,
  watches:      0.15,
  furniture:    0.15,
  home:         0.15,
  kitchen:      0.15,
  beauty:       0.15,
  health:       0.15,
  grocery:      0.15,
  pet:          0.15,
  toys:         0.15,
  baby:         0.15,
  sports:       0.15,
  automotive:   0.12,
};

/** Minimum referral fee per unit (most categories). */
const REFERRAL_FEE_MINIMUM = 0.30;

// ─────────────────────────────────────────────────────────────────────────────
// REMOVAL / DISPOSAL FEES  (2024 US rates, per unit)
// ─────────────────────────────────────────────────────────────────────────────

const REMOVAL_FEES = {
  [SIZE_TIERS.SMALL_STANDARD]:   0.97,
  [SIZE_TIERS.LARGE_STANDARD]:   0.97,
  [SIZE_TIERS.SMALL_OVERSIZE]:   4.15,
  [SIZE_TIERS.MEDIUM_OVERSIZE]:  4.15,
  [SIZE_TIERS.LARGE_OVERSIZE]:   6.87,
  [SIZE_TIERS.SPECIAL_OVERSIZE]: 6.87,
};

// ─────────────────────────────────────────────────────────────────────────────
// DIMENSIONAL WEIGHT CONSTANT
// Amazon uses divisor 139 (inches³ → lbs) for US domestic.
// ─────────────────────────────────────────────────────────────────────────────

const DIM_WEIGHT_DIVISOR = 139;

// ─────────────────────────────────────────────────────────────────────────────
// HELPER FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculate dimensional weight in lbs.
 * @param {number} l - Length in inches
 * @param {number} w - Width in inches
 * @param {number} h - Height in inches
 * @returns {number}
 */
function calcDimWeight(l, w, h) {
  return (l * w * h) / DIM_WEIGHT_DIVISOR;
}

/**
 * Billable weight = max(actual weight, dimensional weight).
 * @param {number} l - Length in inches
 * @param {number} w - Width in inches
 * @param {number} h - Height in inches
 * @param {number} actualWeightLbs
 * @returns {number}
 */
function calcBillableWeight(l, w, h, actualWeightLbs) {
  return Math.max(actualWeightLbs, calcDimWeight(l, w, h));
}

/**
 * Volume in cubic feet (for storage fee calculations).
 * @param {number} l - Length in inches
 * @param {number} w - Width in inches
 * @param {number} h - Height in inches
 * @returns {number}
 */
function calcCubicFeet(l, w, h) {
  return (l * w * h) / 1728;
}

/**
 * Classify a product into an Amazon FBA size tier.
 *
 * @param {{ l: number, w: number, h: number, weightLbs: number }} dims
 *   All measurements in inches and lbs.
 * @returns {{ tier: string, reason: string, billableWeightLbs: number }}
 */
function getSizeTier({ l, w, h, weightLbs }) {
  // Sort dimensions descending so L = longest, W = median, H = shortest
  const [L, W, H] = [l, w, h].sort((a, b) => b - a);
  const weightOz   = weightLbs * 16;
  const dimWeight  = calcDimWeight(L, W, H);
  const billable   = Math.max(weightLbs, dimWeight);
  const girth      = 2 * (W + H);
  const lPlusGirth = L + girth;

  // Small Standard: ≤1 lb, ≤15"×12"×0.75"
  if (weightOz <= 16 && L <= 15 && W <= 12 && H <= 0.75) {
    return {
      tier:              SIZE_TIERS.SMALL_STANDARD,
      reason:            'Weight ≤1 lb, dims ≤15×12×0.75"',
      billableWeightLbs: billable,
    };
  }

  // Large Standard: ≤20 lb, ≤18"×14"×8"
  if (weightLbs <= 20 && L <= 18 && W <= 14 && H <= 8) {
    return {
      tier:              SIZE_TIERS.LARGE_STANDARD,
      reason:            'Weight ≤20 lb, dims ≤18×14×8"',
      billableWeightLbs: billable,
    };
  }

  // Small Oversize: ≤70 lb, longest ≤60", median ≤30"
  if (weightLbs <= 70 && L <= 60 && W <= 30) {
    return {
      tier:              SIZE_TIERS.SMALL_OVERSIZE,
      reason:            'Weight ≤70 lb, longest ≤60", median ≤30"',
      billableWeightLbs: billable,
    };
  }

  // Medium Oversize: ≤150 lb, L+girth ≤108"
  if (weightLbs <= 150 && lPlusGirth <= 108) {
    return {
      tier:              SIZE_TIERS.MEDIUM_OVERSIZE,
      reason:            'Weight ≤150 lb, L+girth ≤108"',
      billableWeightLbs: billable,
    };
  }

  // Large Oversize: ≤150 lb, L+girth ≤165"
  if (weightLbs <= 150 && lPlusGirth <= 165) {
    return {
      tier:              SIZE_TIERS.LARGE_OVERSIZE,
      reason:            'Weight ≤150 lb, L+girth ≤165"',
      billableWeightLbs: billable,
    };
  }

  // Special Oversize: everything else
  return {
    tier:              SIZE_TIERS.SPECIAL_OVERSIZE,
    reason:            'Exceeds Large Oversize limits',
    billableWeightLbs: billable,
  };
}

/**
 * Look up the FBA fulfillment fee for a given size tier and billable weight.
 *
 * @param {string} sizeTier  - One of SIZE_TIERS values
 * @param {number} weightLbs - Billable weight in lbs
 * @returns {number}         - Fee in USD
 */
function getFulfillmentFee(sizeTier, weightLbs) {
  const weightOz = weightLbs * 16;

  switch (sizeTier) {
    case SIZE_TIERS.SMALL_STANDARD: {
      const { baseFee, perOzAbove4 } = FBA_FULFILLMENT_FEES[sizeTier];
      if (weightOz <= 4) return baseFee;
      const extraOz = Math.min(weightOz - 4, 12); // capped at 16 oz total
      return baseFee + extraOz * perOzAbove4;
    }

    case SIZE_TIERS.LARGE_STANDARD: {
      const { weightTiers, perLbAbove3 } = FBA_FULFILLMENT_FEES[sizeTier];
      for (const [maxOz, fee] of weightTiers) {
        if (weightOz <= maxOz) return fee;
      }
      // Above 3 lb (48 oz): base $6.10 + $0.38 per lb above 3
      return 6.10 + (weightLbs - 3) * perLbAbove3;
    }

    case SIZE_TIERS.SMALL_OVERSIZE:
    case SIZE_TIERS.MEDIUM_OVERSIZE: {
      const { baseFee, perLbAbove1 } = FBA_FULFILLMENT_FEES[sizeTier];
      if (weightLbs <= 1) return baseFee;
      return baseFee + (weightLbs - 1) * perLbAbove1;
    }

    case SIZE_TIERS.LARGE_OVERSIZE:
    case SIZE_TIERS.SPECIAL_OVERSIZE: {
      const { baseFee, perLbAbove90 } = FBA_FULFILLMENT_FEES[sizeTier];
      if (weightLbs <= 90) return baseFee;
      return baseFee + (weightLbs - 90) * perLbAbove90;
    }

    default:
      return 0;
  }
}

/**
 * Monthly storage fee for one unit over a full month.
 *
 * @param {string} sizeTier    - One of SIZE_TIERS values
 * @param {number} cubicFt     - Volume of the unit in cubic feet
 * @param {number} [month]     - Calendar month 1–12 (defaults to current month)
 * @returns {number}           - Fee in USD
 */
function getStorageFee(sizeTier, cubicFt, month) {
  const m      = month ?? new Date().getMonth() + 1; // getMonth() is 0-indexed
  const season = m >= 10 ? 'peak' : 'standard';
  const rates  = STORAGE_FEES[sizeTier];
  if (!rates) return 0;
  return cubicFt * rates[season];
}

/**
 * Long-term storage surcharge for aged inventory.
 *
 * @param {number} cubicFt   - Volume of the unit in cubic feet
 * @param {number} ageDays   - Inventory age in days
 * @returns {number}         - Fee in USD (0 if age ≤270 days)
 */
function getLongTermStorageFee(cubicFt, ageDays) {
  if (ageDays > 365) return cubicFt * LONG_TERM_STORAGE_FEES.daysOver365;
  if (ageDays > 270) return cubicFt * LONG_TERM_STORAGE_FEES.days271to365;
  return 0;
}

/**
 * Referral fee in dollars for a given selling price and category.
 * Subject to a $0.30 minimum per unit.
 *
 * @param {number} price      - Selling price in USD
 * @param {string} [category] - Amazon category key (see REFERRAL_RATES)
 * @returns {number}          - Referral fee in USD
 */
function getReferralFee(price, category = 'default') {
  const rate = REFERRAL_RATES[category.toLowerCase()] ?? REFERRAL_RATES.default;
  return Math.max(price * rate, REFERRAL_FEE_MINIMUM);
}

/**
 * Removal or disposal fee per unit.
 *
 * @param {string} sizeTier - One of SIZE_TIERS values
 * @returns {number}        - Fee in USD
 */
function getRemovalFee(sizeTier) {
  return REMOVAL_FEES[sizeTier] ?? 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// MODULE EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  // Tables
  SIZE_TIERS,
  SIZE_TIER_LIMITS,
  FBA_FULFILLMENT_FEES,
  STORAGE_FEES,
  LONG_TERM_STORAGE_FEES,
  REFERRAL_RATES,
  REFERRAL_FEE_MINIMUM,
  REMOVAL_FEES,
  DIM_WEIGHT_DIVISOR,

  // Helpers
  getSizeTier,
  getFulfillmentFee,
  getStorageFee,
  getLongTermStorageFee,
  getReferralFee,
  getRemovalFee,
  calcDimWeight,
  calcBillableWeight,
  calcCubicFeet,
};
