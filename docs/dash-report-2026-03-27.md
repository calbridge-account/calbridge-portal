# Dash Debug Report — Calbridge Dashboard Date/Data Mismatches
**Generated:** 2026-03-27  
**Investigator:** Dash (sub-agent)  
**Session context:** Snowflake CURRENT_DATE = `2026-03-26` (America/Los_Angeles / PST-7), UTC wall clock = `2026-03-27 04:42 UTC`

---

## Executive Summary

Seven distinct bugs found ranging from wrong data being shown to label mismatches. The root cause cluster is a **timezone mismatch** between the browser (UTC or user local time) and Snowflake (hardcoded `America/Los_Angeles` session timezone), plus a **fundamentally broken custom date range implementation** that translates absolute dates into a rolling "days ago" offset incorrectly.

---

## Live Snowflake Data — Key Facts

| Table | Min Date | Max Date | Rows | Notes |
|---|---|---|---|---|
| `sales` | 2025-12-24 | **2026-03-23** | 2,880 | **3-day lag** behind today |
| `campaign_performance` | 2025-01-01 | **2026-03-26** | 22,315 | SP/SB/SD current; DSP -1 day |
| `sp_campaign_report` | 2025-12-21 | 2026-03-26 | 11,480 | Current |
| `sb_campaign_report` | 2025-01-01 | 2026-03-26 | 6,282 | Current (uses `report_date`) |
| `sd_campaign_report` | 2025-01-01 | 2026-03-26 | 4,070 | Current |
| `dsp_campaign_report` | 2025-12-23 | **2026-03-25** | 483 | **1-day lag** |

**Snowflake session timezone:** `America/Los_Angeles` (confirmed via `SHOW PARAMETERS LIKE 'TIMEZONE'`)

---

## Bug Inventory

---

### BUG #1 — P0 · WRONG DATA SHOWN
**"Last N days" rolling windows query N+1 days of data**

**Affects:** Every time-series query in both dashboard and advertising routes. Every KPI card, every chart, every table.

**Root cause:**  
The pattern `WHERE date >= DATEADD(day, -30, CURRENT_DATE)` uses `>=` (inclusive) against a boundary that is itself 30 days before today. This means data from BOTH the boundary date AND today are included — 31 distinct calendar dates for "last 30 days", 8 for "last 7 days".

**Confirmed live:**
```sql
-- "Last 30 days" query run 2026-03-26
SELECT COUNT(DISTINCT date) AS distinct_dates, MIN(date), MAX(date)
FROM campaign_performance
WHERE date >= DATEADD(day, -30, CURRENT_DATE);

-- RESULT: 31 distinct dates, Min=2026-02-24, Max=2026-03-26
```

```sql
-- "Last 7 days"
SELECT COUNT(DISTINCT date) FROM campaign_performance
WHERE date >= DATEADD(day, -7, CURRENT_DATE);
-- RESULT: 8 distinct dates
```

**Files affected:**
- `src/routes/dashboard.js` — lines with `DATEADD(day, -?, CURRENT_DATE)`: summary, sales-performance, tacos, forecast, budget-pacing, ntb, asin-ad-spend, profitability-trend, contribution_margin queries
- `src/routes/advertising.js` — summary, trend, by-channel, campaigns, by-campaign-type, roas-by-type, keyword-efficiency, keyword-targeting queries

**User impact:** Every KPI for "Last 30 days" is actually 31 days of data. For the 7-day filter it's 8 days. The numbers are inflated by ~3%.

**Fix:** Change `≥` to `>` on the start boundary, OR use `DATEADD(day, -(? - 1), CURRENT_DATE)` to get exactly N days.

```sql
-- BEFORE (31 days for "last 30"):
WHERE date >= DATEADD(day, -30, CURRENT_DATE)

-- AFTER (exactly 30 days):
WHERE date >= DATEADD(day, -29, CURRENT_DATE)
-- i.e., use (days - 1) as the DATEADD offset
```

Alternatively, to keep it semantically clear, use a half-open interval:
```sql
WHERE date >= DATEADD(day, -30, CURRENT_DATE)
  AND date < CURRENT_DATE
```
But this would exclude today's data, which may not be desired. The cleanest correct interpretation of "last 30 days" ending today inclusive is offset of `-(days - 1)`:
```sql
WHERE date >= DATEADD(day, -(? - 1), CURRENT_DATE)
```

---

### BUG #2 — P0 · WRONG DATA SHOWN
**Snowflake CURRENT_DATE is in Pacific time — misaligns with UTC users' "today"**

**Affects:** All rolling window queries; MTD and YTD preset filters.

**Root cause:**  
Snowflake session timezone is `America/Los_Angeles`. At 04:42 UTC on 2026-03-27, Snowflake's `CURRENT_DATE` returns `2026-03-26`. Any user east of Pacific who selects "Last 30 days" is computing their day count against a different calendar day than what Snowflake uses.

**Confirmed:**
```sql
SELECT CURRENT_DATE AS sf_date, CONVERT_TIMEZONE('UTC', CURRENT_TIMESTAMP) AS utc_now;
-- sf_date: 2026-03-26
-- utc_now: 2026-03-27 04:42:51
```

**User impact (concrete example):**  
- UTC user's browser: today = Mar 27
- SF CURRENT_DATE: Mar 26
- "Last 30 days" API call: `days=30`
- Query: `DATEADD(day, -30, CURRENT_DATE)` = Feb 24
- User's expectation for "last 30 days" ending Mar 27: Feb 26 → Mar 27
- Actual data window: Feb 24 → Mar 26 — **2 days off at both ends**

**The MTD preset makes this worse** (see Bug #3).

**Fix options:**
1. **Preferred:** Add `ALTER SESSION SET TIMEZONE = 'UTC'` at Snowflake connection initialization (`src/services/snowflakeService.js`), then ensure the frontend also computes days in UTC.
2. **Partial fix:** Accept explicit `startDate`/`endDate` params from the frontend instead of a `days` integer, and use those directly in SQL.

---

### BUG #3 — P0 · WRONG DATA SHOWN
**MTD and YTD presets query wrong date ranges**

**Affects:** `public/js/dateUtils.js` lines 13–22; used by both dashboard and advertising pages via `setupDateFilter`.

**Root cause:**  
`dateUtils.js` computes `currentDays` as the number of milliseconds between the browser's local midnight and the start of the month/year, then passes that integer to the API. The API then uses `DATEADD(day, -days, CURRENT_DATE)` in Snowflake (where CURRENT_DATE is Pacific). When the browser timezone and SF timezone disagree, the computed `days` maps to the wrong start date.

**MTD concrete failure (UTC user, 2026-03-27):**
```js
// dateUtils.js:13
const today = new Date();
today.setHours(0, 0, 0, 0);  // → 2026-03-27 00:00:00 UTC

const start = new Date(today.getFullYear(), today.getMonth(), 1); // → 2026-03-01 00:00:00 UTC
const days = Math.ceil((today - start) / 86400000) || 1;
// (Mar27 - Mar1) / 86400000 = 26 → days = 26
```
API calls with `days=26`:
```sql
DATEADD(day, -26, CURRENT_DATE)  -- SF CURRENT_DATE = 2026-03-26
-- Result: 2026-02-28   ← WRONG, should be 2026-03-01
```
**MTD shows Feb 28 data when user expects Mar 1 onwards.**

**YTD concrete failure (UTC user, 2026-03-27):**
```js
const start = new Date(today.getFullYear(), 0, 1); // Jan 1
const days = Math.ceil((Mar27_00 - Jan1_00) / 86400000);
// = 85 days
```
```sql
DATEADD(day, -85, '2026-03-26') = '2025-12-31'  ← WRONG, should be 2026-01-01
```
**YTD includes Dec 31 2025 and misses data on Jan 1 2026. Also the window end is Mar 26 not Mar 27.**

**Confirmed via live SQL:**
```sql
SELECT DATEADD(day, -26, '2026-03-26');  -- 2026-02-28 (wrong for MTD)
SELECT DATEADD(day, -85, '2026-03-26');  -- 2025-12-31 (wrong for YTD)
SELECT DATEADD(day, -25, '2026-03-26');  -- 2026-03-01 (correct MTD start for PST user)
SELECT DATEADD(day, -84, '2026-03-26');  -- 2026-01-01 (correct YTD start for PST user)
```

**File:** `public/js/dateUtils.js` lines 13–22

**Fix:** Align the frontend and backend to both work in UTC, OR pass explicit ISO date strings to the backend instead of a days integer.

**Interim fix (UTC session + correct days calculation):**
```js
// dateUtils.js - Fixed MTD
case 'mtd': {
  const now = new Date();
  const year = now.getUTCFullYear(), month = now.getUTCMonth();
  const dayOfMonth = now.getUTCDate(); // 1-based
  // days = dayOfMonth - 1 gives us start=first of month when offset = -(days-1)
  // But since the API uses >= DATEADD(-days), we need days such that:
  // DATEADD(-days, UTC_TODAY) = first of month
  // UTC_TODAY = Mar 27 → days = 26 → DATEADD(-26, Mar27) = Mar 1 ✓
  // But SF TODAY = Mar 26 → days = 26 → DATEADD(-26, Mar26) = Feb 28 ✗
  // Real fix: SET SESSION TIMEZONE = UTC in snowflakeService, then:
  const days = dayOfMonth - 1 || 1;  // days-1 offset for inclusive range
  return { days, label: 'Month to Date' };
}
```

The **correct, complete fix** is a two-part change:
1. Add `ALTER SESSION SET TIMEZONE = 'UTC'` in `snowflakeService.js` after connect
2. Compute days using UTC getters in `dateUtils.js`

---

### BUG #4 — P0 · WRONG DATA SHOWN
**Custom date range in advertising.js uses incorrect days-offset translation**

**Affects:** `public/js/advertising.js` lines 73–79 (inline custom range handler).

**Root cause:**  
The advertising page handles custom date ranges inline (does not use `dateUtils.js`). It converts absolute from/to dates into a `currentDays` integer and then relies on `DATEADD(day, -currentDays, CURRENT_DATE)` to reconstruct the start. This is fundamentally the wrong approach — the offset-from-today translation does not round-trip to the original date.

```js
// advertising.js lines 73-79
applyBtn?.addEventListener('click', async () => {
  const from = el('date-from')?.value;
  const to   = el('date-to')?.value;
  if (from && to) {
    currentDays = Math.max(1, Math.ceil((new Date(to) - new Date(from)) / 86400000) + 1);
    // ...
  }
});
```

**Concrete failure (user picks Mar 1 → Mar 26):**
```
to - from = 25 days → +1 = 26 → currentDays = 26
DATEADD(day, -26, SF_CURRENT_DATE=Mar26) = Feb 28
```
**User asked for Mar 1–Mar 26, gets Feb 28–Mar 26. 2 days of wrong data at the start.**

The `+1` in `ceil((to-from)/86400)+1` is intended to make the range inclusive, but it overcorrects when combined with the Snowflake offset approach.

**Note:** `dateUtils.js`'s custom range handler (used by dashboard) has the same pattern:
```js
// dateUtils.js line 21
const days = Math.ceil((to - from) / 86400000) + 1;
```
Same bug, same result.

**Fix:** The API needs to accept explicit `startDate`/`endDate` params:

```js
// advertising.js fix
applyBtn?.addEventListener('click', async () => {
  const from = el('date-from')?.value;
  const to   = el('date-to')?.value;
  if (from && to) {
    customStartDate = from;  // e.g. '2026-03-01'
    customEndDate   = to;    // e.g. '2026-03-26'
    await loadAll();
  }
});

// API call becomes:
fetch(`/advertising/summary?startDate=${customStartDate}&endDate=${customEndDate}`)
```

And backend routes accept `startDate`/`endDate` and use:
```sql
WHERE date BETWEEN :startDate AND :endDate
```

---

### BUG #5 — P0 · WRONG DATA SHOWN
**Sales data is 3 days behind ad data — TACOS/Total ROAS distorted**

**Affects:** `/dashboard/tacos`, `/dashboard/summary` (Total ROAS), `/advertising/roas-by-type`.

**Root cause:**  
The `sales` table's most recent `order_date` is `2026-03-23` (a 3-day lag). However `campaign_performance` has ad data through `2026-03-26`. Queries that join or compare both tables within the same date window will have ad spend for Mar 24-26 with no matching sales, making TACOS, Total ROAS, and ACOS look significantly worse than reality.

**Confirmed:**
```
Sales MAX date:              2026-03-23  (3-day lag)
campaign_performance MAX:    2026-03-26  (current)
dsp_campaign_report MAX:     2026-03-25  (1-day lag)
```

**Concrete impact (last 5 days as of 2026-03-26):**
| Date | Ad Spend | Sales |
|---|---|---|
| 2026-03-26 | $5,203 | NULL |
| 2026-03-25 | $16,806 | NULL |
| 2026-03-24 | $15,577 | NULL |
| 2026-03-23 | $15,715 | $11,738 |
| 2026-03-22 | $17,780 | $10,482 |

The 3 un-matched days add ~$37,586 of spend with $0 sales to the TACOS numerator.

**This is not a code bug per se** — it's an Amazon data pipeline delay. But the UI should surface this to users rather than silently showing inflated TACOS. The data status banner only checks for missing ad or sales data, not for lag.

**Fix:** Add a data freshness warning when the lag between `MAX(order_date)` in sales and `CURRENT_DATE` exceeds 1 day:

```js
// In /dashboard/summary or a new /dashboard/freshness endpoint:
const freshnessRows = await query(`
  SELECT
    MAX(order_date) AS latest_sale,
    CURRENT_DATE AS today,
    DATEDIFF(day, MAX(order_date), CURRENT_DATE) AS sales_lag_days
  FROM sales WHERE client_id = ?
`, [clientId]);

// Return sales_lag_days in response so the frontend can show:
// "⚠️ Sales data is 3 days behind. TACOS/ROAS may be understated."
```

---

### BUG #6 — P0 · WRONG DATA SHOWN
**Budget Pacing endpoint (#dashboard/budget-pacing) only counts SP spend — SB, SD, DSP excluded**

**Affects:** `src/routes/dashboard.js` — `budget-pacing` route (lines ~300-370).

**Root cause:**  
The budget pacing query JOINs `ad_campaigns` with `sp_campaign_report` specifically, not with `campaign_performance`:

```sql
-- src/routes/dashboard.js (budget-pacing)
FROM ad_campaigns c
LEFT JOIN sp_campaign_report r      -- ← SP only!
  ON c.client_id    = r.client_id
  AND c.campaign_id = r.campaign_id
  AND r.date >= ?
```

SB, SD, and DSP spend during the month is **not counted** in `mtd_spend`. For accounts that heavily use SB or DSP, this will show dramatically less spend than reality.

**DSP note:** DSP uses `order_id` as its primary key (not `campaign_id`), so even fixing the JOIN to use `campaign_performance` won't include DSP without additional handling.

**Fix:** Switch to `campaign_performance` for a unified spend total:

```sql
FROM ad_campaigns c
LEFT JOIN (
  SELECT campaign_id, client_id, SUM(spend) AS mtd_spend_cp, COUNT(DISTINCT date) AS days_with_data
  FROM campaign_performance
  WHERE client_id = ?
    AND date >= ?
  GROUP BY campaign_id, client_id
) cp ON c.client_id = cp.client_id AND c.campaign_id = cp.campaign_id
```

---

### BUG #7 — P0 · SILENT FAILURE
**CM Breakdown queries non-existent columns — silently returns null**

**Affects:** `src/routes/dashboard.js` — `summary` route CM breakdown block (~lines 130-175), and the CM Waterfall visualization.

**Root cause:**  
The `contribution_margin` table schema (confirmed from `information_schema`) has these columns:
```
CLIENT_ID, ASIN, CALC_DATE, REVENUE, AD_SPEND, FBA_FEES, COGS, OTHER_COSTS,
CONTRIBUTION_MARGIN, CM_PERCENT
```

But the dashboard route queries these **non-existent columns**:
- `cm1` — does not exist
- `cm2` — does not exist
- `cm3` — does not exist
- `referral_fees` — does not exist
- `amazon_fees` — does not exist

```sql
-- src/routes/dashboard.js ~line 140
SELECT
  COALESCE(SUM(cm1), SUM(revenue - fba_fees - referral_fees)) AS cm1,  -- cm1 and referral_fees don't exist
  SUM(cm2) AS cm2,     -- doesn't exist
  SUM(cm3) AS cm3,     -- doesn't exist
  ...
FROM contribution_margin
```

Snowflake will throw a SQL compilation error. The entire block is wrapped in `try { } catch { /* CM data not available yet */ }` so it silently fails and `cmBreakdown` is returned as `null`. The CM Waterfall card hides itself when `cm.revenue <= 0` or when `cmBreakdown` is null.

**User impact:** The CM Waterfall is permanently invisible even if the `contribution_margin` table has data.

**Fix:** Either add the missing columns to the table via a migration, or align the query to the existing schema:

```sql
-- Aligned to ACTUAL schema:
SELECT
  COALESCE(SUM(revenue), 0)                              AS revenue,
  COALESCE(SUM(fba_fees), 0)                             AS fba_fees,
  0                                                       AS referral_fees,  -- not in schema yet
  COALESCE(SUM(cogs), 0)                                 AS cogs,
  COALESCE(SUM(ad_spend), 0)                             AS ad_spend,
  -- Derive CM1 from what we have:
  COALESCE(SUM(revenue - fba_fees), 0)                   AS cm1,
  -- CM2 needs referral_fees; use fba_fees as proxy or null
  CASE WHEN SUM(cogs) > 0 THEN SUM(revenue - fba_fees - cogs) ELSE NULL END AS cm2,
  -- CM3 = CM2 - ad_spend
  CASE WHEN SUM(cogs) > 0 THEN SUM(revenue - fba_fees - cogs - ad_spend) ELSE NULL END AS cm3
FROM contribution_margin
WHERE client_id = ?
  AND calc_date >= DATEADD(day, -?, CURRENT_DATE)
```

Or add the missing columns via DDL:
```sql
ALTER TABLE contribution_margin ADD COLUMN cm1 FLOAT;
ALTER TABLE contribution_margin ADD COLUMN cm2 FLOAT;
ALTER TABLE contribution_margin ADD COLUMN cm3 FLOAT;
ALTER TABLE contribution_margin ADD COLUMN referral_fees FLOAT;
ALTER TABLE contribution_margin ADD COLUMN amazon_fees FLOAT;
```

---

### BUG #8 — P1 · LABEL MISMATCH
**"Last 7/30/60/90 days" label shown when 8/31/61/91 days are actually queried**

This is the user-visible symptom of Bug #1. The `section-sub` text in the dashboard header reads "Last 30 days" but 31 days of data are queried. Because the off-by-one is tiny it may appear subtle, but it means:
- Comparing "Last 7 days" to "Last 30 days" has an inconsistent denominator
- Trend charts with daily granularity will show one extra data point

**Files:**
- `public/js/dashboard.js` line 78: `$('section-sub').textContent = label;`
- `public/js/dateUtils.js` line 34: `return { days: Number(filterValue) || 30, label: \`Last ${filterValue} days\` };`

The label says "30 days" but the effective SQL window is 31. Either fix the SQL (Bug #1 fix) or update the label to be accurate.

---

### BUG #9 — P1 · LABEL/DATA MISMATCH
**DSP data is 1 day behind other channels in all channel-comparison views**

**Affects:** `advertising.html` channel breakdown cards, ad-type composition chart, by-channel endpoint.

**Root cause:**  
`dsp_campaign_report` max date is `2026-03-25`. All SP/SB/SD data goes through `2026-03-26`. When viewing "by channel" breakdowns, DSP is missing one day of spend and sales.

For the current month (Mar 2026), DSP shows:
- 153 rows, $276,212 spend (through Mar 25)
- vs SP: 3,455 rows, $197,675 spend (through Mar 26)

DSP spend looks relatively lower than it actually is on a "current day" basis.

**Fix:** This is a data pipeline issue (DSP reports lag 1 day behind SP). The fix is in the DSP ingestion job. In the UI, add a "Last updated" indicator per channel type. No SQL fix needed.

---

### BUG #10 — P2 · STYLE INCONSISTENCY (No functional impact)
**Two syntaxes for DATEADD: `DATEADD(day, -X, ...)` vs `DATEADD(day, 0-X, ...)`**

**Affects:** `src/routes/dashboard.js` — tacos, ntb, asin-ad-spend routes use `0 - ?` syntax.

**Confirmed identical output:**
```sql
SELECT DATEADD(day, -30, '2026-03-26') AS a, DATEADD(day, 0-30, '2026-03-26') AS b;
-- a: 2026-02-24   b: 2026-02-24   result: SAME
```

Both produce identical results. This is purely a code style inconsistency. Standardize on `DATEADD(day, -?, CURRENT_DATE)` throughout.

**Files:** `src/routes/dashboard.js` approximately lines:
- tacos route: `DATEADD(day, 0 - ?, CURRENT_DATE)` (2 occurrences)
- ntb route: `DATEADD(day, 0 - ?, CURRENT_DATE)` (2 occurrences)

---

### BUG #11 — P2 · COSMETIC / ARCHITECTURE
**advertising.js duplicates date filter logic from dateUtils.js**

**Affects:** `public/js/advertising.js` lines 56-80 (inline date filter).

The advertising page does not call `setupDateFilter()` from `dateUtils.js`. Instead it reimplements the MTD/YTD/custom logic inline. This means any fix to `dateUtils.js` won't automatically apply to the advertising page.

Both pages should use `setupDateFilter()` for consistency. The advertising page's inline logic also has the MTD/YTD timezone bug from Bug #3.

---

## Items Verified As Non-Bugs

| Item | Status | Notes |
|---|---|---|
| `sales` table date column | ✅ Correct | Uses `order_date`; routes correctly reference `order_date` |
| `SB report_date` aliasing in view | ✅ Correct | `campaign_performance` view maps `report_date AS date` for SB — working as designed |
| `campaign_performance` column `sales` | ✅ Fixed | Was `total_sales` for DSP; fixed before this report (confirmed in VIEW DDL) |
| `DATEADD(day, -X)` vs `DATEADD(day, 0-X)` | ✅ Identical | No functional difference; style only (Bug #10) |
| `dateUtils.js` loaded on both pages | ✅ Yes | Both `dashboard.html:436` and `advertising.html:239` load it |

---

## Snowflake Data Coverage Summary

### Sales (`order_date` column)
| Month | Rows | Revenue |
|---|---|---|
| Dec 2025 | 256 | $89,096 |
| Jan 2026 | 992 | $345,916 |
| Feb 2026 | 896 | $310,472 |
| Mar 2026 (to Mar 23) | 736 | $254,450 |

**Latest sales date: 2026-03-23** (3-day lag from CURRENT_DATE=Mar 26)

### campaign_performance (all types)
| Month | Type | Rows | Spend |
|---|---|---|---|
| Mar 2026 | DSP | 153 | $276,212 |
| Mar 2026 | SP | 3,455 | $197,675 |
| Mar 2026 | SB | 594 | $42,590 |
| Mar 2026 | SD | 527 | $15,762 |
| Feb 2026 | DSP | 169 | $382,067 |
| Feb 2026 | SP | 3,420 | $181,062 |
| Feb 2026 | SB | 306 | $39,978 |
| Feb 2026 | SD | 588 | $17,599 |

---

## Priority Fix Order

| Priority | Bug | Effort | Impact |
|---|---|---|---|
| P0-A | **#7 CM columns silent failure** | Low (SQL fix) | Users can't see CM waterfall at all |
| P0-B | **#6 Budget pacing SP-only** | Medium (query fix) | Pacing shows wrong total spend |
| P0-C | **#5 Sales lag vs ads** | Low (UI warning) | TACOS/ROAS appear worse than reality |
| P0-D | **#2 Snowflake timezone** | Medium (session param) | All date filters off by 0–1 day |
| P0-E | **#3 MTD/YTD preset bug** | Low (math fix) | MTD starts 1–2 days early |
| P0-F | **#4 Custom date range** | High (API refactor) | Custom picker queries wrong dates |
| P0-G | **#1 Off-by-one (N+1 days)** | Low (offset fix) | Every window is 1 day wider than labeled |
| P1-A | **#8 Label mismatch** | Trivial (label update) | User sees "30 days" but it's 31 |
| P1-B | **#9 DSP 1-day lag** | Pipeline fix | DSP looks lower in channel splits |
| P2-A | **#10 DATEADD style** | Trivial | Code cleanup only |
| P2-B | **#11 Duplicate date logic** | Low (refactor) | Maintenance risk |

---

## Recommended Fixes — Code Snippets

### Fix 1: Snowflake session timezone (root cause of #2, #3)
**File:** `src/services/snowflakeService.js` — run after connection established:
```js
// After conn.connect() succeeds, set session timezone to UTC
conn.execute({
  sqlText: "ALTER SESSION SET TIMEZONE = 'UTC'",
  complete: (err) => { if (err) console.error('TZ set failed:', err); }
});
```

### Fix 2: MTD/YTD in dateUtils.js (fix #3)
**File:** `public/js/dateUtils.js`
```js
// Use UTC getters everywhere
case 'mtd': {
  const now = new Date();
  const dayOfMonth = now.getUTCDate(); // 1 on the 1st
  // We want DATEADD(day, -(dayOfMonth-1), CURRENT_UTC_DATE) = first of month
  const days = Math.max(dayOfMonth - 1, 1);
  return { days, label: 'Month to Date' };
}
case 'ytd': {
  const now = new Date();
  const start = Date.UTC(now.getUTCFullYear(), 0, 1);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const days = Math.max(Math.round((today - start) / 86400000), 1);
  return { days, label: 'Year to Date' };
}
```

### Fix 3: Off-by-one in rolling windows (fix #1)
Replace all occurrences of:
```sql
WHERE date >= DATEADD(day, -?, CURRENT_DATE)
```
With (for exactly N days ending today):
```sql
WHERE date >= DATEADD(day, -(? - 1), CURRENT_DATE)
```
Or if using parameterized queries, pass `days - 1` as the parameter value. Apply to both `src/routes/dashboard.js` and `src/routes/advertising.js`.

### Fix 4: CM Breakdown query (fix #7)
**File:** `src/routes/dashboard.js` — replace the cmBreakdown query:
```js
const cmRows = await query(`
  SELECT
    COALESCE(SUM(revenue), 0)                    AS revenue,
    COALESCE(SUM(fba_fees), 0)                   AS fba_fees,
    COALESCE(SUM(cogs), 0)                       AS cogs,
    COALESCE(SUM(ad_spend), 0)                   AS ad_spend,
    COALESCE(SUM(revenue - fba_fees), 0)         AS cm1,
    CASE WHEN SUM(cogs) > 0
      THEN COALESCE(SUM(revenue - fba_fees - cogs), 0)
      ELSE NULL END                               AS cm2,
    CASE WHEN SUM(cogs) > 0
      THEN COALESCE(SUM(revenue - fba_fees - cogs - ad_spend), 0)
      ELSE NULL END                               AS cm3
  FROM contribution_margin
  WHERE client_id = ?
    AND calc_date >= DATEADD(day, -?, CURRENT_DATE)
`, [clientId, days]);
```

### Fix 5: Budget pacing multi-channel spend (fix #6)
**File:** `src/routes/dashboard.js` — budget-pacing route, replace the LEFT JOIN:
```sql
LEFT JOIN (
  SELECT campaign_id, client_id,
    SUM(spend) AS mtd_spend,
    COUNT(DISTINCT date) AS days_with_data
  FROM campaign_performance
  WHERE client_id = ?
    AND date >= ?
    AND ad_type IN ('SP','SB','SD')  -- exclude DSP which uses order_id not campaign_id
  GROUP BY campaign_id, client_id
) cp
  ON c.client_id    = cp.client_id
  AND c.campaign_id = cp.campaign_id
```

### Fix 6: Sales data lag warning (fix #5)
**File:** `src/routes/dashboard.js` — add to `summary` response:
```js
const [salesRow, adsRow, freshnessRow] = await Promise.all([
  // ... existing queries ...
  query(`SELECT MAX(order_date) AS latest_sale,
         DATEDIFF(day, MAX(order_date), CURRENT_DATE) AS sales_lag_days
         FROM sales WHERE client_id = ?`, [clientId])
]);

// In response:
salesLagDays: Number(freshnessRow[0]?.SALES_LAG_DAYS || 0),
salesFreshnessWarning: Number(freshnessRow[0]?.SALES_LAG_DAYS || 0) > 1
  ? `Sales data is ${freshnessRow[0].SALES_LAG_DAYS} days behind. TACOS and Total ROAS may appear lower than actual.`
  : null,
```

---

*Report complete. All findings verified against live Snowflake data as of 2026-03-27 04:42 UTC.*
