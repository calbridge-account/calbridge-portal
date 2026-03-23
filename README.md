# CalBridge Client Portal

A multi-tenant client portal for Amazon sellers and vendors managed by Calbridge, a Seattle-based eCommerce management consulting firm.

**Live URL:** https://app.teamcalbridge.com
**Admin Panel:** https://app.teamcalbridge.com/admin.html
**Repo:** https://github.com/calbridge-account/calbridge-portal (private)

---

## What It Does

Clients log in and connect their Amazon accounts (Advertising, DSP, Seller Central, Vendor Central) via OAuth. The portal then:

1. Pulls advertising performance and sales data via Amazon APIs
2. Writes it to a multi-tenant Snowflake data warehouse
3. Calculates contribution margin at the ASIN level (CM1, CM2, CM3)
4. Surfaces automated insights — spend alerts, break-even ACOS analysis, scaling opportunities
5. Displays everything in a branded client dashboard

---

## Quick Start (Developer)

See [docs/developer-setup.md](docs/developer-setup.md) for full setup instructions.

```bash
git clone https://github.com/calbridge-account/calbridge-portal.git
cd calbridge-portal
npm install
cp .env.example .env   # fill in credentials
node src/models/initSchema.js   # initialize Snowflake tables
npm run dev
```

---

## Documentation

| Doc | Description |
|-----|-------------|
| [docs/architecture.md](docs/architecture.md) | System architecture, stack, project structure |
| [docs/api.md](docs/api.md) | Full API endpoint reference |
| [docs/oauth-flows.md](docs/oauth-flows.md) | Amazon OAuth setup and flows |
| [docs/snowflake.md](docs/snowflake.md) | Data pipeline, schema, CM formula |
| [docs/runbook.md](docs/runbook.md) | Deployment checklist, ops, common issues |
| [docs/developer-setup.md](docs/developer-setup.md) | Local development setup guide |
| [docs/decisioning.md](docs/decisioning.md) | Decision engine logic and formulas |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js v22 |
| Framework | Express 5.x |
| Database | Snowflake (snowflake-sdk) |
| Auth | express-session (Snowflake-backed) |
| Amazon Auth | Login with Amazon (LWA) OAuth 2.0 |
| Email | Resend (ash@teamcalbridge.com) |
| Process Manager | PM2 |
| Reverse Proxy | Nginx + Let's Encrypt SSL |
| Image Processing | Jimp + ImageMagick |

---

## Repository Structure

```
src/
  app.js                  — Express app, middleware, routes
  server.js               — Entry point
  routes/
    auth.js               — Signup, login, logout, /me
    amazon.js             — OAuth connect + callbacks (4 types)
    dashboard.js          — Dashboard data endpoints
    advertising.js        — Unified Ads + DSP endpoints
    decisions.js          — Decision engine endpoint
    cogs.js               — COGS upload + template
    account.js            — Profile, logo, password, team
    admin.js              — Admin panel API
  middleware/
    requireAuth.js        — Client session guard
  services/
    authService.js        — Client account management (Snowflake)
    amazonAuthService.js  — LWA OAuth, token management
    snowflakeService.js   — Snowflake connection + query helper
    decisionEngine.js     — Break-even ACOS, insights, alerts
    removeBackground.js   — Auto background removal for logos
  jobs/
    adsIngestion.js       — Amazon Advertising API ingestion
    spIngestion.js        — SP-API ingestion (Seller/Vendor)
    contributionMargin.js — CM calculation + ASIN analysis
    ingestionRunner.js    — Retry logic, Snowflake logging, alerts
    scheduler.js          — 6-hour sync scheduler
  models/
    schema.sql            — Snowflake table definitions
    initSchema.js         — Schema initialization script
    seedData.js           — Test data seeder

public/
  index.html              — Login page
  signup.html             — Signup page
  dashboard.html          — Main client dashboard
  advertising.html        — Unified advertising page
  account.html            — Account settings
  admin.html              — Admin panel
  css/style.css           — All styles
  js/
    auth.js               — Login/signup logic
    dashboard.js          — Dashboard JS
    advertising.js        — Advertising page JS
    account.js            — Account settings JS
    admin.js              — Admin panel JS
    dateUtils.js          — Date range utilities
    chart.umd.min.js      — Chart.js (local copy)
  images/
    calbridge-logo.png    — Main logo
    calbridge-logo-*.png  — Amazon app store sized logos

docs/                     — Developer documentation
```
