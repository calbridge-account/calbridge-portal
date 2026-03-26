# Metrics Audit Report
**Date:** 2026-03-26  
**Author:** Economist agent  
**Scope:** Full audit of metric logic across `src/`

---

## Summary

Metric logic was scattered across 6 files with at least **2 formula inconsistencies** and 1 incorrect SOUL.md definition. All metric formulas have been centralized into `src/config/metrics.js` as the authoritative registry. Key callsites have been updated to use `compute()` from that registry.

---

## Files Audited

| File | Metrics Found | Status |
|------|--------------|--------|
| `src/jobs/contributionMargin.js` | CM1/CM2/CM3 (canonical source) | ✅ Correct — not changed |
| `src/routes/dashboard.js` | totalRoas, tacos, breakEvenAcos, acos, roas | Updated to use metrics.js |
| `src/routes/advertising.js` | acos, roas (SQL only, no JS math) | No change needed |
| `src/routes/campaigns.js` | acos, roas (SQL only) | No change needed |
| `src/services/decisionEngine.js` | breakEvenAcos, acos, cm-based math | Updated to use metrics.js |
| `src/services/healthScore.js` | breakEvenAcos, acos | Updated to use metrics.js |
| `src/services/weeklyReport.js` | roas, acos (inline JS) | ⚠️ NOT updated — see below |

---

## What Was Found

### 1. CM1 / CM2 / CM3 Model (`contributionMargin.js`)
**Status: Correct and canonical.**

The `contributionMargin.js` job has a well-documented CM1/CM2/CM3 model confirmed by Abe:
- **CM1** (Seller): `ordered_revenue - fba_fees - referral_fees`
- **CM1** (Vendor): `shipped_cogs` (Option A — excludes deductions, flagged as estimate)
- **CM2**: `CM1 - (cogs_per_unit × units)` — `null` when COGS not uploaded
- **CM3**: `CM2 - ad_spend` — `null` when CM2 is `null`

This is the authoritative calculation. All of it is in JS, not SQL formulas.  
The legacy `contribution_margin` column = `cm3 ?? cm1` (backward compat only).

### 2. ACOS / ROAS
Consistent across SQL queries in `advertising.js`, `campaigns.js`, `dashboard.js`:
- `acos = spend / sales` (attributed)
- `roas = sales / spend` (attributed)

`weeklyReport.js` has inline JS versions:
```js
const curRoas = cur.spend > 0 ? cur.retailSales / cur.spend : 0;  // uses retailSales, not attributed
const curAcos = cur.attributedSales > 0 ? (cur.spend / cur.attributedSales) * 100 : 0;  // returns %
```

Note: `weeklyReport.js` ROAS uses **total retail sales** (not attributed), which is actually `true_roas` semantics, not `roas`. The ACOS returns a **percent** (×100) while other callsites return a **ratio**. Low severity — it's email-only display code — but should be normalized.

### 3. Total ROAS (`dashboard.js` `/summary`)
`totalRoas = totalRetailSales / totalAdSpend`  
This is the `true_roas` definition from SOUL.md. Now calls `computeMetric('true_roas', ...)`.

### 4. TACOS (`dashboard.js` `/tacos`, `/roas-by-type`)
`tacos = totalAdSpend / totalRevenue`  
Consistent across both endpoints. Now the `/tacos` route calls `computeMetric('tacos', ...)`.

---

## Inconsistencies Found

### ⚠️ INCONSISTENCY 1: Break-Even ACOS Formula (Medium Severity)
**Requires Abe's decision.**

| Location | Formula | Returns |
|----------|---------|---------|
| `decisionEngine.js:40` | `(revenue - cogs - fbaFees) / revenue` | ratio 0–1 |
| `healthScore.js:74` | `(rev - cogs - fees) / rev` | ratio 0–1 |
| `dashboard.js:885` (/profitability-trend) | `(cm2 / revenue) * 100` | **percent 0–100** |
| `SOUL.md` definition | `COGS / Revenue` | ratio — **WRONG for sellers** |

**The problem:**
- All three formulas are *mathematically equivalent for seller accounts when cm2 is correctly computed* — but `dashboard.js` returns a percent while the others return a ratio. This is a display-layer bug risk.
- SOUL.md says `COGS / Revenue` — this ignores FBA fees and referral fees, which would understate break-even ACOS for seller accounts. It would only be correct for vendors where CM1 = shipped_cogs.

**Recommended canonical formula (in `metrics.js`):**
```js
breakEvenAcos = cm2 / revenue  // returns ratio; × 100 for display
```

**Action needed:** Abe to confirm. Then update SOUL.md and normalize `dashboard.js` so it doesn't multiply by 100 before storage/comparison (only at display time).

### ⚠️ INCONSISTENCY 2: `weeklyReport.js` ACOS returns percent, others return ratio (Low Severity)
`weeklyReport.js:curAcos` = `(spend / attributedSales) * 100` — returns percent  
All other callsites return ratio.

Not updated because it's isolated to email rendering. Low risk. Should be normalized in a future pass.

---

## What Was Centralized

`src/config/metrics.js` now defines:

| Metric ID | Formula | Status |
|-----------|---------|--------|
| `cm1_seller` | `revenue - fbaFees - referralFees` | ✅ |
| `cm1_vendor` | `shippedCogs` | ✅ (estimate flag noted) |
| `cm2` | `cm1 - (cogsPerUnit × units)` → null if no COGS | ✅ |
| `cm3` | `cm2 - adSpend` → null if cm2 null | ✅ |
| `break_even_acos` | `cm2 / revenue` (ratio) | ✅ with inconsistency flagged |
| `acos` | `adSpend / adAttributedSales` | ✅ |
| `roas` | `adAttributedSales / adSpend` | ✅ |
| `true_roas` | `totalRetailSales / totalAdSpend` | ✅ |
| `tacos` | `totalAdSpend / totalRetailSales` | ✅ |
| `cac` | `adSpendOnNewBuyers / newBuyerCount` | ⚠️ Not yet computable |
| `payback_period` | `cac / avgMonthlyCmPerCustomer` | ⚠️ Not yet computable |
| `opportunity_score` | Placeholder composite | ⚠️ Placeholder only |
| `inventory_adjusted_margin` | `cm3 - storageFee + stockoutAdj` | ⚠️ Not yet computable |

---

## What Still Needs Client Data (COGS) to Be Computable

| Metric | Blocker |
|--------|---------|
| CM2 | Client COGS upload via `/cogs/upload` |
| CM3 | CM2 (requires COGS) |
| break_even_acos | CM2 (requires COGS) |
| inventory_adjusted_margin | CM2 + FBA inventory API |
| opportunity_score | CM2 + keyword rank data (not yet ingested) |
| cac | NTB attribution (Sponsored Brands only) |
| payback_period | CAC + repeat purchase data |

---

## Callsite Updates Made

| File | Change |
|------|--------|
| `src/routes/dashboard.js` | Added `require('../config/metrics')`. Updated `totalRoas`, `tacos`, and `/profitability-trend` `breakEvenAcos` to call `computeMetric()` |
| `src/services/decisionEngine.js` | Added `require('../config/metrics')`. Updated break-even ACOS and actual ACOS computation to call `computeMetric()` with inline comments explaining Version A proxy |
| `src/services/healthScore.js` | Added `require('../config/metrics')`. Updated break-even vs actual ACOS comparison to call `computeMetric()` |

### Not Updated (rationale)

| File | Reason |
|------|--------|
| `src/routes/advertising.js` | ACOS/ROAS are SQL-computed aggregations, not JS math. Pulling to JS just to call `computeMetric()` would be over-engineering. Flag for future if query logic needs versioning. |
| `src/routes/campaigns.js` | Same as advertising.js — SQL aggregations only. |
| `src/services/weeklyReport.js` | Email-only display code, isolated. Inline ROAS/ACOS are not production decision logic. Low priority for now; noted in INCONSISTENCIES. |
| `src/jobs/contributionMargin.js` | This IS the canonical CM computation. It owns CM1/CM2/CM3 directly and should not wrap itself in a metrics.js call — it's the upstream. |

---

## Decisions Needed from Abe

1. **Break-even ACOS canonical formula** — Version A `(revenue - cogs - fbaFees) / revenue` or Version B `cm2 / revenue`? Both are equivalent for sellers if CM2 is correctly computed, but Version B is cleaner. **Must decide before exposing break-even ACOS to clients.**

2. **Opportunity Score weights** — Current formula in metrics.js is a placeholder. Needs: headroom weight, conversion efficiency benchmark (what's an "average" Amazon CVR?), rank trajectory scaling. **Must be defined before first client launch.**

3. **SOUL.md `break_even_acos` definition** — Currently says `COGS / Revenue` which is wrong for sellers. Should be updated to match the CM2/Revenue model.

4. **`weeklyReport.js` ACOS** — Returns percent vs ratio. Low urgency but should be normalized in the next email template pass.

---

## Files Changed

```
src/config/metrics.js              (CREATED — authoritative metrics registry)
src/routes/dashboard.js            (updated 3 inline formulas + require)
src/services/decisionEngine.js     (updated break-even + acos + require)
src/services/healthScore.js        (updated break-even + acos + require)
docs/metrics-audit-2026-03-26.md   (this report)
```
