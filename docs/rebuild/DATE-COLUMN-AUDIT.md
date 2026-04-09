# Date Column & Revenue Source Audit

**Status:** ✅ Phase 2 complete  
**Last updated:** 2026-04-09

---

## 1. Date Column Map

| Table | Date Column | Granularity | Notes |
|-------|------------|-------------|-------|
| `vendor_purchase_orders` | `order_date` | Daily | When Amazon placed the PO |
| `CALBRIDGE_PROD.APP.VENDOR_SALES` (local: `vendor_sales`) | `start_date` | Weekly | Weekly period start; authoritative P&L revenue |
| `CALBRIDGE_PROD.APP.VENDOR_INVENTORY` (local: `vendor_inventory`) | `start_date` / `end_date` | Weekly | Snapshot period; use `end_date` for latest snapshot |
| `contribution_margin` | `calc_date` | Daily | Calculation date |
| `adjusted_campaign_performance` | `date` | Daily | Ad reporting date |
| `sp_advertised_product_report` | `date` | Daily | Ad reporting date |
| `sp_search_term_report` | `date` | Daily | Ad reporting date |
| `sp_targeting_keyword_report` | `date` | Daily | Ad reporting date |
| `sb_keyword_report` | `report_date` | Daily | Ad reporting date |

---

## 2. Revenue Source of Truth

### Rule
> **For Vendor Central accounts: `VENDOR_SALES.shipped_revenue` is authoritative.**  
> It represents actual invoiced revenue that hits the P&L.  
> `vendor_purchase_orders.ordered_revenue` is a demand/PO signal — use only as fallback when shipped is zero.  
> **Never add them together** — they represent the same product at different pipeline stages and summing causes double-counting.

### Account type matrix

| Account Type | Primary Revenue | Fallback Revenue |
|---|---|---|
| Vendor Central | `vendor_sales.shipped_revenue` | `vendor_purchase_orders.ordered_revenue` |
| Seller Central | `seller_central_orders.revenue` | — |

---

## 3. Route Audit Results

### `/dashboard/summary` ✅ Correct
- Runs **two separate queries**: `vendor_purchase_orders` (ordered) + `vendor_sales` (shipped)
- Date columns correct: `order_date` and `start_date` respectively
- Computes `totalRetailSales = shippedRevenue > 0 ? shippedRevenue : orderedRevenue`
- No double-counting. This is the reference implementation.

### `/dashboard/tacos` ✅ Fixed (was broken)
- **Bug:** Was querying `SUM(ordered_revenue + COALESCE(shipped_revenue, 0))` from `vendor_purchase_orders`.  
  `vendor_purchase_orders` has no `shipped_revenue` column — this would have thrown a Snowflake error or returned wrong values via COALESCE(null, 0).
- **Fix:** Now uses same two-query pattern as `/summary`: shipped from `vendor_sales` (date: `start_date`), ordered from `vendor_purchase_orders` (date: `order_date`), then `shippedRevenue > 0 ? shippedRevenue : orderedRevenue`.

### `/dashboard/forecast` ✅ Fixed (was broken)
- **Bug:** Same as TACOS — `SUM(ordered_revenue + COALESCE(shipped_revenue, 0))` from `vendor_purchase_orders` with wrong column reference.
- **Fix:** Primary query now uses `vendor_sales.shipped_revenue` grouped by `start_date` (weekly). Falls back to `vendor_purchase_orders.ordered_revenue` grouped by `order_date` only when VENDOR_SALES returns no rows. Date column aliases to `period_date` in both branches so downstream code is uniform.

### `/dashboard/sales-performance` ✅ Correct
- Runs three separate queries: PO ordered (date: `order_date`), vendor_sales shipped (date: `start_date`), channel split (date: `order_date`)
- Merges by date into unified `dailyTrend` — each source contributes its own column, not summed for KPIs
- Legacy `revenue` field in `dailyTrend` adds ordered + shipped but this is a display artifact for an existing chart (not a reported KPI) — acceptable
- Top ASINs: correlated subquery for `vs.shipped_revenue` uses `vs.start_date` ✅

### `/vendor-analytics/overview` ✅ Correct
- All `VENDOR_SALES` queries use `start_date` ✅
- All `VENDOR_TRAFFIC` queries use `start_date` ✅
- All `VENDOR_INVENTORY` queries use `start_date` for range, `end_date` for latest snapshot ✅
- All `ADJUSTED_CAMPAIGN_PERFORMANCE` queries use `date` ✅
- Revenue KPIs (shippedRevenue, orderedRevenue, weeklyTrend) pull exclusively from `VENDOR_SALES` — no `vendor_purchase_orders` mixing ✅
- No double-counting anywhere in this endpoint

### `/dashboard/inventory-summary` ✅ Correct
- Uses `end_date` for latest snapshot: `WHERE end_date = (SELECT MAX(end_date) ...)` ✅
- Weeks-of-cover calc uses `vendor_sales.start_date` ✅

---

## 4. Known Remaining Issues

### `vendor_purchase_orders` rows for Vendor accounts
- For pure Vendor Central accounts (e.g. CyberPower), `vendor_purchase_orders` has rows with `connection_type = 'vendor'`
- These rows contain `ordered_revenue` (PO demand) which is a valid demand signal
- They are **not** the P&L signal — `VENDOR_SALES.shipped_revenue` is
- Current handling: used only as fallback when `shippedRevenue === 0` — this is correct
- No further exclusion needed unless future audits show stale/incorrect PO data for vendor rows

### `/dashboard/forecast` weekly vs daily granularity
- VENDOR_SALES is weekly (one row per `start_date` week); the old endpoint was daily via PO `order_date`
- The forecast algorithms (7-day rolling avg, 30-day regression) still work on the weekly series but the semantics change slightly: "last 7 data points" = last 7 weeks, not last 7 days
- This is actually more appropriate for vendor accounts since their data is natively weekly
- No code change needed, but the `/forecast` response field `rollingAvg7d` now means "average of last 7 weekly periods" for vendor accounts

### `sb_keyword_report.report_date` vs `date`
- SB keyword report uses `report_date` while all other ad tables use `date`
- No current route queries `sb_keyword_report` directly in the audited endpoints
- Any future route that joins `sb_keyword_report` with `sp_*` tables must use `sb.report_date` and `sp.date` separately

---

## 5. Reference Implementation

The canonical revenue-source pattern for Vendor accounts (from `/dashboard/summary`):

```js
const [vsRow, poRow] = await Promise.all([
  query(`SELECT COALESCE(SUM(shipped_revenue), 0) AS shipped_revenue
         FROM vendor_sales WHERE client_id = ?
         ${dateFilter("start_date", days, startDate, endDate)}`, [clientId]),

  query(`SELECT COALESCE(SUM(ordered_revenue), 0) AS ordered_revenue
         FROM vendor_purchase_orders WHERE client_id = ?
         ${dateFilter("order_date", days, startDate, endDate)}`, [clientId]),
]);

const shippedRevenue = Number(vsRow[0]?.SHIPPED_REVENUE || 0);
const orderedRevenue = Number(poRow[0]?.ORDERED_REVENUE  || 0);
// Prefer shipped (P&L), fall back to ordered (demand) — never add
const totalRetailSales = shippedRevenue > 0 ? shippedRevenue : orderedRevenue;
```
