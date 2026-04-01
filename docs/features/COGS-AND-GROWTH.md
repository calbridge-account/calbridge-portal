# COGS & Growth Features — Implementation Summary

**Date:** 2026-03-31  
**Status:** ✅ Shipped & Live

---

## Feature 1: Proceeds after Ads (CM3 Proxy)

### What was built
- **New KPI card** on Overview dashboard: "Proceeds after Ads"  
  - Formula: `SUM(shipped_cogs) - SUM(AD_CAMPAIGN.cost)` for the selected date range  
  - Shows dollar value with WoW badge (green/red) vs prior period  
  - Red border on card if value is negative  
- **Top ASINs bar chart** now shows two series: `shippedRevenue` + `proceedsAfterAds`  
- **Vendor Performance ASIN table** has a new "Proceeds after Ads" column (shippedCogs per ASIN since AD_CAMPAIGN is campaign-level — see note)

### API changes
- `GET /vendor-analytics/overview` response now includes:
  - `metrics.proceedsAfterAds` — current period  
  - `metrics.prevProceedsAfterAds` — prior week (for WoW badge)  
  - `metrics.totalAdSpend` — total campaign spend for reference  
- `GET /vendor-analytics/vendor/asins` now includes:
  - `shippedCogs` — ASIN-level shipped COGS  
  - `proceedsAfterAds` — equals shippedCogs (see note below)

### ⚠️ Data model note
`CALBRIDGE_PROD.RAW.AD_CAMPAIGN` is **campaign-level** — no `asin` column exists. Per-ASIN ad spend cannot be directly joined. As a result:
- **Total** Proceeds after Ads (KPI card) = accurate: SUM(shipped_cogs) − SUM(campaign costs)  
- **Per-ASIN** Proceeds after Ads = `shippedCogs` only (ad spend not deducted at ASIN level)  
- Once an ASIN-level ad table becomes available (e.g., keyword/targeting reports with ASINs), this can be upgraded

---

## Feature 2: COGS Entry Page

### New backend route: `src/routes/cogsAnalytics.js`

Registered in `src/app.js` at `/cogs-analytics`.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/cogs-analytics/entries` | All COGS entries for client |
| POST | `/cogs-analytics/entries` | Upsert cost per unit for one ASIN |
| GET | `/cogs-analytics/margins` | Per-ASIN CM2 and CM3 calculations |

### Snowflake table
```sql
CALBRIDGE_PROD.APP.CLIENT_COGS (
  client_id      VARCHAR NOT NULL,
  asin           VARCHAR NOT NULL,
  cost_per_unit  NUMBER(18,4) NOT NULL,
  currency_code  VARCHAR DEFAULT 'USD',
  effective_date DATE DEFAULT CURRENT_DATE,
  notes          VARCHAR,
  updated_at     TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP,
  updated_by     VARCHAR,
  PRIMARY KEY (client_id, asin)
)
```
Table is auto-created on first request (`CREATE TABLE IF NOT EXISTS`).

### Frontend: `src/pages/Cogs.jsx`

**Route:** `/analytics/cogs`  
**Nav item:** 💰 COGS & Margins (added to Layout.jsx)

Features:
- Summary bar: weighted avg CM3%, COGS coverage count  
- "Upload CSV" button → toast "coming soon"  
- ASIN table with inline editing (click cost field → type → Enter or click ✓)  
- CM2 = `shipped_cogs_per_unit − cost_per_unit`  
- CM3 = CM2 (same as CM2 until ASIN-level ad spend is available)  
- Margin % = `CM3 / revenue_per_unit × 100`  
- Color coding:
  - 🟢 CM3 > 20% — green  
  - 🟡 10–20% — yellow  
  - 🟠 < 10% — orange  
  - 🔴 Negative — red  
- Search/filter by ASIN or model number  

---

## Feature 3: Growth Signals Panel

### API addition
`GET /vendor-analytics/overview` now includes a `growthSignals` object:

```json
{
  "growthSignals": {
    "revenueGrowthWoW": {
      "current": 1234567,
      "previous": 1100000,
      "pctChange": 12.2
    },
    "glanceViewGrowthWoW": {
      "current": 98000,
      "previous": 105000,
      "pctChange": -6.7
    },
    "stockoutRisk": {
      "atRiskCount": 48
    },
    "adEfficiencyTrend": {
      "currentAcos": 0.1157,
      "previousAcos": 0.0991,
      "improving": false
    }
  }
}
```

- WoW windows: current = last 7 days, prior = 7–14 days ago  
- Stockout risk: ASINs where `sellable_on_hand < 2 × weekly_mean_forecast` (next 2 weeks)  
- ACoS trend: Sponsored Products campaigns only  

### Frontend section
Added "📡 Growth Signals" row below KPI cards on Overview.jsx with 4 tiles:
1. Revenue Growth WoW — $ value + pct arrow
2. Glance View Growth WoW — count + pct arrow  
3. Stockout Risk — "X ASINs at risk" + ⚠️ / ✅ icon  
4. Ad Efficiency (ACoS) — current ACoS + "Improving/Worsening" vs prior period

---

## Files Changed

### Backend
- `src/routes/vendorAnalytics.js` — Feature 1 (proceeds_after_ads KPI + top ASIN chart + vendor ASIN table) + Feature 3 (growthSignals)
- `src/routes/cogsAnalytics.js` — **NEW** (Feature 2)
- `src/app.js` — registered `/cogs-analytics` route

### Frontend (`calbridge-dash/src/`)
- `pages/Overview.jsx` — Feature 1 (5th KPI card + dual bar chart) + Feature 3 (Growth Signals section)
- `pages/VendorPerformance.jsx` — Feature 1 (Proceeds after Ads column in ASIN table)
- `pages/Cogs.jsx` — **NEW** (Feature 2)
- `components/Layout.jsx` — Added 💰 COGS & Margins nav item
- `App.jsx` — Added `/cogs` route
- `api/client.js` — Added `getCogsEntries`, `getCogsMargins`, `upsertCogsEntry` + `/cogs-analytics` proxy calls
- `hooks/useAnalytics.js` — Added `useCogsEntries`, `useCogsMargins`, `useUpsertCogs`
- `vite.config.js` — Added `/cogs-analytics` proxy

---

## Build & Deploy
```bash
cd /home/azureuser/.openclaw/workspace/calbridge-dash && npm run build
pm2 restart calbridge-portal
```
✅ Build successful. Server online.

---

## API Test Results

| Endpoint | Status |
|----------|--------|
| `GET /vendor-analytics/overview?range=4w` | ✅ 200 — includes `proceedsAfterAds` + `growthSignals` |
| `GET /vendor-analytics/vendor/asins?range=4w` | ✅ 200 — includes `proceedsAfterAds` column |
| `GET /cogs-analytics/entries` | ✅ 401 (auth guard working) |
| `GET /cogs-analytics/margins` | ✅ 401 (auth guard working) |
| `POST /cogs-analytics/entries` | ✅ 401 (auth guard working) |
