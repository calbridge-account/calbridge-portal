# CalBridge Portal — Overnight Code Review
**Date:** 2026-03-24  
**Commits reviewed:** `4d5464b` → `94ef464` (3 commits, 1,163 lines added/changed)  
**Prepared for:** Abe Curry — go/no-go deploy decision

---

## Summary

Three significant commits landed overnight. The first fixes a long-standing bug where ad spend was being split across products using a rough estimate instead of being tied directly to the specific product each ad actually promoted. The second adds a large batch of new analytics — TACOS, revenue forecasting, budget pacing alerts, and new-to-brand customer metrics — all exposed through new API endpoints. The third wires those metrics into the client-facing dashboard with new sidebar tabs, charts, and data tables. No secrets appear to be hardcoded, and the database changes are backwards-compatible (new columns are added safely). Overall the changes look solid, but the NTB and keyword-efficiency features have partial stubs that should be noted before showing clients.

---

## Change 1: Ad Spend Attribution Fix

### What was wrong before
Ad spend was being distributed across products proportionally — meaning if Product A generated 30% of a client's revenue, it was assigned 30% of all ad spend, even if those ads were actually running for Product B. This made per-product profitability numbers unreliable.

### What it does now
Each ad record now carries the specific Amazon product (ASIN) it was advertising. When the system pulls performance data from Amazon, it reads the `advertisedAsin` field directly from Amazon's ad reports — no guessing, no splitting. If an ad can't be tied to a specific product (e.g. a broad Sponsored Brands awareness campaign), it gets bucketed as `UNATTRIBUTED` rather than spread across products. Unattributed spend still counts toward business-level TACOS but doesn't distort per-product contribution margin.

### Why this matters for the business
Contribution margin numbers per product are now accurate. Clients will see the actual profit or loss on each ASIN rather than a blended estimate. This is the core value proposition of CalBridge — without this fix, the numbers clients were making decisions on were subtly wrong.

### Risks and things to watch
- **Historical data will look different.** Once deployed and re-synced, per-ASIN contribution margin numbers will shift from what clients previously saw. If any client has been tracking these numbers, warn them before deploying.
- **Unattributed spend will appear as a new line item.** Some clients may ask why there's a bucket called "UNATTRIBUTED" — it's expected and honest; it's brand awareness ad spend that Amazon doesn't link to a single product.
- **Schema migration is automatic but irreversible.** The job adds three new database columns (`advertised_asin`, `ntb_orders`, `ntb_sales`, `ntb_units`) on first run. The migration handles the case where columns already exist, so re-running is safe.

---

## Change 2: New Metrics & Endpoints

Six new API endpoints were added (all require authentication; no public access).

---

### 2a. TACOS (Total Advertising Cost of Sale)
**What it calculates:** What percentage of your *total* business revenue is going toward ads — not just the revenue that ads directly drove, but everything. This is the most honest measure of how much you're spending on advertising relative to your whole business.

**Formula in plain English:**  
`TACOS = Total Ad Spend ÷ Total Revenue (all channels)`

Example: $10,000 in ads on $100,000 in revenue = 10% TACOS.

**Where the data comes from:** Ad spend from the `ad_performance` table; total revenue from the `sales` table (Seller + Vendor combined).

**API endpoint:** `GET /dashboard/tacos?days=30`  
Also broken out by campaign type (Sponsored Products, Sponsored Brands, Display, DSP).

---

### 2b. Revenue Forecasting
**What it calculates:** Three forward-looking revenue projections based on recent sales history.

**Formulas in plain English:**
1. **7-day rolling average:** Average daily revenue over the last 7 days.
2. **Projected monthly revenue:** Average daily revenue this calendar month × total days in the month. (If it's March 10 with $1,000/day average, it projects $31,000 for March.)
3. **Projected annual revenue:** Uses a 30-day linear trend (is revenue going up or down, and by how much per day?) applied forward 365 days. This accounts for whether the business is growing or contracting.

**Where the data comes from:** Daily sales records from the `sales` table.

**API endpoint:** `GET /dashboard/forecast?days=90`  
Returns all three projections plus a full daily series for charting.

---

### 2c. Budget Pacing
**What it calculates:** Whether each ad campaign is spending too fast, too slow, or on track for the month.

**Formula in plain English:**
- **Monthly budget** = Daily campaign budget × Days in the month
- **Expected spend so far** = Monthly budget × (Days elapsed this month ÷ Days in month)
- **Pacing ratio** = Actual MTD spend ÷ Expected MTD spend
- 🔴 **Over-pacing** = spending more than 110% of expected pace (risk of blowing budget early)
- 🟡 **Under-pacing** = spending less than 70% of expected pace (budget may be wasted or campaigns are throttled)
- 🟢 **On track** = everything else

**Where the data comes from:** Campaign budgets from `ad_campaigns`; actual spend from `ad_performance`.

**API endpoint:** `GET /dashboard/budget-pacing`  
Returns per-campaign status plus an overall summary (total campaigns, how many are over/under/on-track, total MTD spend vs total budget).

---

### 2d. New-to-Brand (NTB) Metrics
**What it calculates:** Orders and revenue from first-time customers — people who had never bought from this brand on Amazon before. This shows whether ad campaigns are growing the customer base or just re-selling to existing customers.

**Formulas in plain English:**
- **NTB Order Rate** = NTB Orders ÷ Total Orders (what fraction of buyers are new?)
- **NTB Revenue Rate** = NTB Revenue ÷ Total Ad Revenue (what fraction of ad-driven revenue is from new customers?)
- **NTB ROAS** = NTB Revenue ÷ Ad Spend (how much new-customer revenue per dollar spent?)
- **NTB ACOS** = Ad Spend ÷ NTB Revenue (inverse of NTB ROAS)

**Where the data comes from:** Amazon's Sponsored Brands reports include NTB fields. The ingestion job now pulls `newToBrandOrders14d`, `newToBrandSales14d`, and `newToBrandUnitsSold14d` and stores them in three new columns on `ad_performance`. NTB data is **only available for Sponsored Brands (SB) campaigns** — not Sponsored Products or Display.

**API endpoint:** `GET /dashboard/ntb?days=30`  
Returns aggregate totals plus a per-campaign breakdown (top 20 SB campaigns by NTB orders).

---

### 2e. Per-ASIN Ad Spend (Direct Attribution View)
**What it calculates:** A direct view of how much ad spend is going to each product, using the fixed attribution logic from Change 1.

**Formula:** Sums all ad spend grouped by `advertised_asin`. Includes a separate `UNATTRIBUTED` line for spend that can't be tied to a product.

**API endpoint:** `GET /dashboard/asin-ad-spend?days=30`  
Returns up to 50 ASINs sorted by spend, plus totals for attributed vs unattributed.

---

### 2f. ROAS by Campaign Type
**What it calculates:** Return on ad spend broken out separately for Sponsored Products, Sponsored Brands, Sponsored Display, and DSP. Lets clients see which ad type is performing best.

**Formula:** Sales ÷ Spend per campaign type. Also includes TACOS per type (that type's spend as a share of total business revenue).

**API endpoint:** `GET /advertising/roas-by-type?days=30`

---

### 2g. Keyword Efficiency (Partial / Stub)
**What it calculates:** Intended to show which search keywords are converting well and which are wasting money. **Currently implemented as ASIN-level efficiency as a proxy** — true keyword-level data would require a separate keyword report ingestion job that hasn't been built yet.

**API endpoint:** `GET /advertising/keyword-efficiency?days=30`  
The response includes a `note` field explicitly stating this limitation.

---

## Change 3: Dashboard UI Changes

### New sidebar tabs added
The main dashboard navigation now has four new tabs clients can click:

| Tab | What clients see |
|-----|-----------------|
| **📈 Forecast** | 4 KPI cards (7-day average, projected monthly revenue, projected annual revenue, trend direction) + a 90-day revenue chart |
| **⏱ Budget Pacing** | 4 KPI cards (MTD spend, monthly budget, # over-pacing, # under-pacing) + a table showing every campaign with pacing status (🟢🔴🟡) |
| **🆕 New-to-Brand** | 4 KPI cards (NTB orders, NTB revenue, NTB ROAS, NTB ACOS) + a per-campaign breakdown table. Shows a friendly "no data yet" message if the client doesn't run Sponsored Brands. |
| **TACOS card on Overview** | The main Overview page now shows a TACOS card in the KPI grid (hidden until data is available) |

### Advertising tabs (pre-existing, now linked)
The sidebar also links to `/advertising.html` and `/campaigns.html`. These appear to already exist — the overnight work didn't create them but does connect the new endpoints they'd use.

### What clients will see
- The Overview page now shows up to 7 KPI cards (was 6), with TACOS appearing once ad + sales data is synced.
- The Forecast, Pacing, and NTB tabs load lazily — they only fetch data when the client clicks into them, so the Overview page remains fast.
- Tabs are smart: if a client has no ad connections, advertising-only tabs (Pacing, NTB) are automatically hidden.

---

## Deployment Checklist

- [ ] **Review ad attribution logic** — Confirm the `advertised_asin` column is being populated correctly after first sync. Spot-check 2–3 campaigns in Snowflake: `SELECT campaign_id, advertised_asin, spend FROM ad_performance WHERE advertised_asin != 'UNATTRIBUTED' LIMIT 10`.
- [ ] **Check new endpoints return valid data** — Hit `/dashboard/tacos`, `/dashboard/forecast`, `/dashboard/budget-pacing`, and `/dashboard/ntb` in a browser or Postman after deploy and confirm JSON comes back without errors.
- [ ] **Confirm no secrets hardcoded** — ✅ Reviewed. All credentials use `process.env` / dotenv. No API keys, passwords, or tokens in source code.
- [ ] **Warn clients whose CM numbers will shift** — Per-ASIN contribution margin figures will change after the attribution fix is applied. Proactive communication recommended.
- [ ] **PM2 restart command ready** — `pm2 restart calbridge` (or whatever your process name is). After restart, trigger a manual sync via the dashboard or scheduler to rebuild contribution margin with the new attribution logic.
- [ ] **Verify DB migration runs cleanly** — The schema migration runs automatically on first ingestion job execution. Check logs for any `[ensureAdPerformanceSchema]` warnings.

---

## Known Limitations / TODOs

1. **Keyword-level efficiency is stubbed.** The `/advertising/keyword-efficiency` endpoint exists and is functional, but it returns ASIN-level data as a proxy. True search-term-level analysis requires a separate ingestion step. The endpoint includes a `note` field documenting this. Don't advertise this feature to clients yet.

2. **NTB data only covers Sponsored Brands.** Sponsored Products and Sponsored Display don't include NTB metrics in their reports. Clients without SB campaigns will see "no data" in the NTB tab — this is correct behavior, not a bug.

3. **UNATTRIBUTED spend is excluded from per-ASIN CM.** This is intentional and correct (brand awareness campaigns shouldn't be charged against specific products), but it means per-product CM3 figures don't sum to the business total. A future "business-level CM" rollup that includes unattributed spend would give a complete picture.

4. **Forecast accuracy depends on data volume.** The 30-day linear regression needs at least 30 days of consistent sales data to be meaningful. For new clients or accounts with sparse data, projections should be treated as rough estimates.

5. **Budget pacing uses daily budget × days in month.** Amazon campaigns sometimes have lifetime budgets or flexible spend caps that don't follow this formula. Campaigns with non-standard budget types may show misleading pacing figures.

6. **Historical CM data should be reprocessed.** After deploying the attribution fix, ideally re-run the contribution margin job for the last 90 days (`daysBack=90`) to get historically accurate numbers. Without this, only future syncs will use correct attribution.

---

*Review prepared by Ash (CalBridge AI assistant). All code read directly from source — no inferences made about behavior not visible in the code.*
