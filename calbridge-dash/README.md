# Calbridge Analytics Dashboard

Private client analytics dashboard for Calbridge — a React + Tremor app serving CyberPower vendor data from Snowflake sandbox.

## Stack

- **React 19** + Vite 8
- **Tremor v3** UI components
- **Tailwind CSS 3**
- **React Query** (TanStack Query v5) — data fetching + caching
- **Recharts** — line/bar charts
- **React Router v6** — client-side routing
- Express backend at `localhost:3000` (existing Calbridge server)

## Running

```bash
# 1. Make sure the backend is running (in workspace root)
npm start   # or: node src/server.js

# 2. Start the React dev server
cd calbridge-dash
npm run dev
# → http://localhost:5173
```

Vite proxies `/vendor-analytics/*` → `localhost:3000`.

## Pages

### Overview (`/`)
- KPI cards: Shipped Revenue, Shipped COGS, Glance Views, Net PPM % — each with WoW delta badge
- Line chart: weekly shipped + ordered revenue (configurable: 4/8/12/26 weeks)
- Horizontal bar chart: top 10 ASINs by shipped revenue (last 4 weeks)
- Demand forecast table: top 20 ASINs by mean forecast (next 4 weeks) with P70/P80/P90

### Vendor Performance (`/vendor`)
- KPI cards: Sell-Through Rate, Vendor Confirmation Rate, Receive Fill Rate, Avg Lead Time
- Secondary cards: Sellable On Hand, Aged 90+ Days, OOS / Unfilled Orders
- Line chart: weekly sell-through / confirmation / fill rate trends
- Stacked bar chart: ordered vs shipped units by week
- ASIN inventory health table with health badges and sortable columns

### Advertising (`/advertising`)
- Combined KPI cards: Total Spend, Total Sales (attributed), Blended ACoS, Blended ROAS
- Per-type summary cards: SP · SB · SD · DSP (each shows spend, sales, ACoS, ROAS, NTB metrics)
- **Tab switcher**: All | SP | SB | SD | DSP
  - Per-tab weekly spend vs sales line chart
  - Per-tab campaign table (top 20 by spend with ACoS column)
  - DSP tab: viewable impressions + detail page views columns; attribution explanation banner
- Spend mix visualization: proportional bar showing % share by ad type

**Ad type data sources:**
| Type | Table | Date column | Attribution |
|------|-------|-------------|-------------|
| SP | `SP_CAMPAIGN_REPORT` | `date` | 14-day click |
| SB | `SB_CAMPAIGN_REPORT` | `report_date` | click + NTB |
| SD | `SD_CAMPAIGN_REPORT` | `date` | click + view + NTB |
| DSP | `DSP_CAMPAIGN_REPORT` | `date` | view-through + click |

### Forecasting (`/forecasting`)
- Horizon selector: 1 / 2 / 4 / 8 weeks
- Summary stat cards: total forecasted units, P90 scenario, low coverage ASINs, OOS ASINs
- Horizontal bar chart: top 20 ASINs by mean forecast with on-hand overlay (red = forecast > inventory)
- Full 340-ASIN table: mean / P70 / P80 / P90 forecast + on-hand + coverage-in-weeks
  - Searchable by ASIN or product name
  - Color-coded coverage: red < 1w, orange < 2w, yellow < 4w, green 4w+

## API Routes (Express backend)

All routes are in `src/routes/vendorAnalytics.js`, mounted at `/vendor-analytics` in `src/app.js`.

Client scope: `client_id = '7d88ea17-002b-4a02-97fc-bcab1292d57e'` (CyberPower).
Data source: `CALBRIDGE.SANDBOX` schema.

| Route | Returns |
|-------|---------|
| `GET /vendor-analytics/overview?weeks=N` | Aggregated KPIs, weekly trend, top ASINs, forecast table |
| `GET /vendor-analytics/vendor?weeks=N` | Inventory health KPIs, weekly sell-through trend, weekly units |
| `GET /vendor-analytics/vendor/asins?weeks=N` | ASIN-level inventory health table |
| `GET /vendor-analytics/advertising?weeks=N` | Combined + per-type (SP/SB/SD/DSP) metrics, weekly trends, campaign tables |
| `GET /vendor-analytics/forecasting?weeks=N` | All 340 ASINs forecast + top 20 bar data + on-hand coverage |

## Live Data (sandbox smoke test results)

```
/overview:      shippedRevenue=$6.9M (4-week), 10 top ASINs, 20 forecast rows
/advertising:   totalSpend=$555K — SP $214K, SB $47K, SD $18K, DSP $275K — ACoS 12.1%
/vendor:        fillRate=15.6%, sellThrough=12.5% — 4 weekly data points
/forecasting:   340 ASINs — top ASIN B00429N19W: 13,397 mean units forecast
```

## Design

- White background, Calbridge blue (#2563eb) as primary
- Collapsible left sidebar with active-state indicators
- Loading skeletons on all data sections
- Error states with human-readable messages
- Health badges (green/yellow/red) for rate metrics
- ACoS color coding: green < 20%, red > 40%
- Forecast coverage color coding: red < 1w, orange < 2w, yellow < 4w, green 4w+
- Mobile-responsive grid layout
