# Developer Setup Guide

## Prerequisites

- Node.js v22+
- npm
- Access to a Snowflake account (see credentials section)
- Git access to `github.com/calbridge-account/calbridge-portal`

---

## 1. Clone and Install

```bash
git clone https://github.com/calbridge-account/calbridge-portal.git
cd calbridge-portal
npm install
```

---

## 2. Environment Variables

Copy the example and fill in credentials:

```bash
cp .env.example .env
```

All required variables are documented in `.env.example`. Contact Abe (abe@teamcalbridge.com) for production credentials.

For local development, you can use:
- `NODE_ENV=development` — uses sandbox Amazon endpoints
- Sandbox SP-API credentials (separate from production)
- `BASE_URL=http://localhost:3000`

---

## 3. Initialize Snowflake Schema

Run once per environment (SANDBOX and PROD schemas):

```bash
SNOWFLAKE_SCHEMA=SANDBOX node src/models/initSchema.js
```

---

## 4. Seed Test Data (optional)

Populates the sandbox with 90 days of fake data for `test-client-001`:

```bash
node src/models/seedData.js
```

---

## 5. Run Locally

```bash
# Development (auto-restart on file changes)
npm run dev

# Production
npm start
```

Server runs on `http://localhost:3000`

**Test login:**
- Email: `demo@teamcalbridge.com`
- Password: `<PASSWORD>`

**Admin panel:**
- URL: `http://localhost:3000/admin.html`
- Email: `abe@teamcalbridge.com`
- Password: `<PASSWORD>`

---

## 6. Production Deployment

The app runs on an Azure VM at `172.179.10.131` behind Nginx.

```bash
# SSH into server
ssh azureuser@172.179.10.131

# Pull latest
cd /home/azureuser/.openclaw/workspace
git pull

# Restart with updated env
pm2 restart calbridge-portal --update-env
pm2 save

# Check status
pm2 status
pm2 logs calbridge-portal --lines 50
```

See [runbook.md](runbook.md) for the full production deployment checklist.

---

## Environment Variables Reference

```bash
# App
NODE_ENV=production
BASE_URL=https://app.teamcalbridge.com
SESSION_SECRET=<64-char random hex>
ENABLE_SCHEDULER=true   # set to false to disable background sync

# Amazon LWA (Advertising API)
LWA_CLIENT_ID=amzn1.application-oa2-client.6dd6919d58f146128c7c5c1a393ae43f
LWA_CLIENT_SECRET=<secret>

# Amazon SP-API — Sandbox
SPAPI_CLIENT_ID=amzn1.application-oa2-client.26f218aef57945bf95d0b0930a6f7fac
SPAPI_CLIENT_SECRET=<secret>

# Amazon SP-API — Production (pending Amazon review)
SPAPI_PROD_CLIENT_ID=amzn1.application-oa2-client.72192d0cf9bc405daaffb1d3cef78051
SPAPI_PROD_CLIENT_SECRET=<secret>

# Snowflake
SNOWFLAKE_ACCOUNT=<SNOWFLAKE_ACCOUNT>
SNOWFLAKE_USER=CALBRIDGE_SVC
SNOWFLAKE_PASSWORD=<password>
SNOWFLAKE_WAREHOUSE=CALBRIDGE_WH
SNOWFLAKE_DATABASE=CALBRIDGE
SNOWFLAKE_SCHEMA=SANDBOX   # or PROD

# Email (Resend)
RESEND_API_KEY=<api-key>
EMAIL_FROM=ash@teamcalbridge.com
EMAIL_CC=abe@teamcalbridge.com

# Admin
ADMIN_SECRET=<legacy — no longer required, kept for backward compat>
```

---

## Key Architectural Decisions

### Why no Fivetran?
Fivetran is designed for connecting standard data sources with your own credentials. This portal needs per-client OAuth tokens — each client's Amazon account connects independently. Custom ingestion gives full control over the token lifecycle and data transformation.

### Why Snowflake VARIANT for connections?
Each client's Amazon connection tokens (4 types: ads, dsp, seller, vendor) are stored as a VARIANT JSON column on the clients table. This avoids a separate join table for a small, well-defined structure and makes token reads a single query.

### Why session-based auth instead of JWT?
Simpler for this use case — server-side sessions work well for a portal where users stay logged in. JWTs would add complexity without meaningful benefit at this scale.

### Sandbox vs Production
The app switches between sandbox and production Amazon endpoints based on `NODE_ENV`. Set `NODE_ENV=production` on the server, `NODE_ENV=development` locally. Production SP-API requires Amazon app approval (submitted 2026-03-23, pending review).

---

## Testing

No automated test suite yet. Manual testing flow:

1. Log in as `demo@teamcalbridge.com` — full dashboard with seed data
2. Log in as `abe@teamcalbridge.com` — empty dashboard (no Amazon connections)
3. Admin panel at `/admin.html` — client management

To test OAuth flows, Amazon connections require registered redirect URIs. Local testing redirects to `http://localhost:3000/amazon/callback/:type`.
