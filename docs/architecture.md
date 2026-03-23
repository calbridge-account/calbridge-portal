# CalBridge Portal — Architecture

## Overview

A multi-tenant client portal that allows CalBridge clients to:
1. Create an account on teamcalbridge.com
2. Self-connect their Amazon Advertising and/or Seller/Vendor Central accounts via OAuth
3. View their advertising performance and contribution margin data
4. Make data-driven decisions to maximize profitability

---

## Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js v22 |
| Framework | Express 5.x |
| Auth | Session-based (express-session) → Postgres-backed in prod |
| Amazon Auth | Login with Amazon (LWA) OAuth 2.0 |
| Data Warehouse | Snowflake (direct SDK writes, no Fivetran) |
| Email | Resend (ash@teamcalbridge.com) |
| Repo | github.com/calbridge-account/calbridge-portal (private) |

---

## Project Structure

```
src/
  app.js              — Express app setup, middleware, route mounting
  server.js           — Entry point (listen)
  routes/
    auth.js           — Signup, login, logout, /me
    amazon.js         — OAuth connect flows + callbacks (Ads + SP-API)
    dashboard.js      — Client dashboard data endpoints
  middleware/
    requireAuth.js    — Session-based auth guard
  services/
    authService.js    — Client account management (in-memory → Postgres)
    amazonAuthService.js — LWA OAuth, token exchange, token refresh
  models/             — DB models (Postgres schemas, coming Phase 3)
  jobs/               — Scheduled ingestion jobs (coming Phase 3)
docs/
  architecture.md     — This file
  api.md              — API endpoint reference
  oauth-flows.md      — Amazon OAuth setup and flows
  snowflake.md        — Data pipeline and schema docs
  runbook.md          — Ops, deployment, env vars
```

---

## Authentication Flow

1. Client signs up at `/auth/signup` → session created
2. Client clicks "Connect Amazon Ads" → redirected to `/amazon/connect/ads`
3. Server generates OAuth state token, redirects to Amazon LWA consent screen
4. Amazon redirects back to `/amazon/callback/ads` with auth code
5. Server exchanges code for access + refresh tokens
6. Tokens stored against `client_id` in DB
7. All subsequent API calls use stored tokens (auto-refreshed on expiry)

Same flow for SP-API via `/amazon/connect/spapi` → `/amazon/callback/spapi`.

---

## Multi-Tenancy

Every record in every table is scoped to a `client_id`. No client can ever see another client's data. Enforced at:
- Session layer (session stores `clientId`)
- Route layer (`requireAuth` middleware)
- Service layer (all queries filter by `clientId`)
- Snowflake layer (all tables have `client_id` column, queries always filter)

---

## Phases

| Phase | Status | Description |
|-------|--------|-------------|
| 1 | ✅ In progress | Auth portal (signup/login/session) |
| 2 | ✅ In progress | Amazon OAuth (LWA + SP-API) |
| 3 | Pending | Snowflake ingestion pipeline |
| 4 | Pending | Contribution margin decisioning layer |
