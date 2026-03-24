# CalBridge Portal — Architecture

## Overview

A multi-tenant client portal that allows CalBridge clients to:
1. Create an account on app.teamcalbridge.com
2. Self-connect their Amazon Advertising and/or Seller/Vendor Central accounts via OAuth
3. View their advertising performance and contribution margin data
4. Make data-driven decisions to maximize profitability

---

## Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js v22 |
| Framework | Express 5.x |
| Auth | Session-based (express-session) |
| Amazon Auth | Login with Amazon (LWA) OAuth 2.0 |
| Data Warehouse | Snowflake (direct SDK writes, no Fivetran) |
| Email | Resend (ash@teamcalbridge.com) |
| Billing | Stripe |
| Hosting | Azure VM + Nginx + PM2 |
| Repo | github.com/calbridge-account/calbridge-portal |

---

## Project Structure

```
src/
  app.js                    — Express app setup, middleware, route mounting
  server.js                 — Entry point (listen)
  routes/
    auth.js                 — Signup, login, logout, /me, password reset
    amazon.js               — OAuth connect flows + callbacks (Ads + SP-API)
    dashboard.js            — Dashboard KPIs, CM breakdown, sales performance
    advertising.js          — Ad performance overview and campaign breakdown
    campaigns.js            — Campaign management (list, pause, budget, bids)
    decisions.js            — Decision engine endpoint (/decisions)
    billing.js              — Stripe plans, checkout, webhook, status
    account.js              — Profile, settings, connections
    cogs.js                 — COGS CSV upload and management
    chat.js                 — AI assistant chat
    admin.js                — Admin: clients, health scores, invite, logs
  middleware/
    requireAuth.js          — Session-based auth guard
  services/
    authService.js          — Client account management
    amazonAuthService.js    — LWA OAuth, token exchange, token refresh
    snowflakeService.js     — Connection pool + parameterized query utility
    decisionEngine.js       — Break-even ACOS, alerts, budget pacing
    healthScore.js          — Client health scoring (0–100) for admin panel
    chatContextService.js   — AI chat context builder from Snowflake data
    weeklyReport.js         — Weekly HTML email report generator
    account.js              — Account service (profile, connections)
  jobs/
    contributionMargin.js   — CM calculator: proportional ad spend per ASIN
    ingestionRunner.js      — Retry logic, ingestion_log, failure alerts
    scheduler.js            — Scheduled sync orchestrator (6-hour cycle)
    weeklyEmailScheduler.js — Weekly report dispatcher for all active clients
docs/
  api.md                    — API endpoint reference
  architecture.md           — This file
  runbook.md                — Ops and deployment
  decisioning.md            — Decision engine reference
  developer-setup.md        — Dev environment setup
  snowflake.md              — Snowflake schema reference
public/
  dashboard.html/js         — Client dashboard (CM waterfall, performance tab)
  advertising.html/js       — Advertising analytics and campaign breakdown
  campaigns.html/js         — Campaign management
  admin.html/js             — Admin panel with client health scores
  account.html/js           — Account settings, connections, COGS upload
  billing.html              — Billing and plan selection
```

---

## Authentication Flow

1. Client signs up at `/auth/signup` → session created
2. Client clicks "Connect Amazon Ads" → redirected to `/amazon/connect/ads`
3. Server generates OAuth state token, redirects to Amazon LWA consent screen
4. Amazon redirects back to `/amazon/callback/ads` with auth code
5. Server exchanges code for access + refresh tokens
6. Tokens stored against `client_id` in `amazon_connections` table
7. All subsequent API calls use stored tokens (auto-refreshed on expiry)

Admin auth is a separate session: `req.session.adminId` / `req.session.adminRole`.

---

## Multi-Tenancy

Every record in every table is scoped to a `client_id`. No client can ever see another client's data. Enforced at:
- Session layer (`req.session.clientId` — set on login, never overridable)
- Route layer (`requireAuth` middleware on all client routes)
- Service layer (all service functions take `clientId` as first param)
- Snowflake layer (all tables have `client_id` column; all queries always filter)

---

## Contribution Margin Model

| Tier | Formula | Meaning |
|------|---------|---------|
| **CM1** | Revenue − COGS | Gross margin |
| **CM2** | CM1 − FBA Fees − Referral Fees | After Amazon's cut |
| **CM3** | CM2 − Ad Spend | True profitability |

**Proportional ad spend attribution:** Ad spend per ASIN is distributed by revenue share:
```
ASIN Ad Spend = (ASIN Revenue / Total Day Revenue) × Total Day Ad Spend
```

**Break-even ACOS:**
```
Break-Even ACOS = CM2 / Revenue = (Revenue - COGS - FBA Fees) / Revenue
```

---

## Decision Engine

`src/services/decisionEngine.js` — runs on every dashboard load.

Surfaces:
- 🔴 Negative CM3 (losing money on every sale)
- 🔴 Spend with no sales (> $100, zero attributed sales)
- 🟡 ACOS above break-even
- 🟡 High ACOS campaign (> 60%)
- 🟡 ACOS spike (3-day rolling > 120% of 7-day baseline)
- 🟡 Budget over-pacing (projected > 110% of monthly budget)
- 🟡 Budget under-pacing (projected < 70% of monthly budget)
- 🟢 Scale opportunities (CM3% > 15%, ACOS < 50% of break-even)

---

## Client Health Score

`src/services/healthScore.js` — 0–100 score per client for admin panel.

| Component | Condition | Points |
|-----------|-----------|--------|
| CM Trend | 7-day avg CM% improving vs 30-day | +20 |
| CM Trend | 7-day avg CM% declining | -10 |
| ACOS | Below break-even | +20 |
| ACOS | Above break-even | -15 |
| Data Freshness | Synced last 24h | +20 |
| Data Freshness | Synced last 48h | +10 |
| Amazon Connections | All 4 connected | +20 |
| Login Recency | Logged in last 7 days | +20 |
| Login Recency | Logged in last 30 days | +10 |

Score clamped to [0, 100].

---

## Phases

| Phase | Status | Description |
|-------|--------|-------------|
| 1 | ✅ Done | Auth portal (signup/login/session/password reset) |
| 2 | ✅ Done | Amazon OAuth (all 4 integrations) |
| 3 | ✅ Done | Snowflake ingestion pipeline (sales, ads, products) |
| 4 | ✅ Done | CM decisioning, waterfall, performance tab, budget pacing, health scores |
| 5 | ✅ Done | Admin panel, billing, weekly reports, AI chat |
| 6 | Planned | One-click ad write-back actions |
| 7 | Planned | Vendor Central full CM model |
