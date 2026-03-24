# CalBridge Pre-Launch Audit Report
**Date:** 2026-03-24  
**Auditor:** Ash  
**Scope:** Full codebase audit before first real Amazon client connection  
**Status:** FIXES APPLIED — see individual sections

---

## Executive Summary

The CalBridge client portal is substantially ready for first real client connection.  
One **critical bug** was found and fixed (scheduler never synced clients with real tokens).  
Two **important fixes** applied (schema migration safety, missing recommendations route).  
Several **medium-priority items** documented for Abe's attention.

**Verdict: ✅ GO — with conditions noted below**

Primary blocker (LWA scope) requires manual action by Abe in Amazon Developer Console.

---

## Section 1: OAuth Flow Audit — ✅ PASS

**File:** `src/services/amazonAuthService.js`, `src/routes/amazon.js`

### Findings:

**✅ LWA scope correctly set:**
```js
ads:    { scope: 'advertising::campaign_management' }
dsp:    { scope: 'advertising::campaign_management' }
seller: { scope: 'sellingpartnerapi::migration' }
vendor: { scope: 'sellingpartnerapi::migration' }
```
The `advertising::campaign_management` scope is correctly configured for ads/dsp connections.

**✅ SP-API correctly uses production credentials when `NODE_ENV=production`:**
```js
const SPAPI_CLIENT_ID = IS_PROD ? process.env.SPAPI_PROD_CLIENT_ID : process.env.SPAPI_CLIENT_ID;
```

**✅ Tokens stored in `clients.connections` (VARIANT/JSON column) via `authService.updateClient`:**
```js
await authService.updateClient(clientId, { connections });
```
Note: Tokens are stored on the `clients` table's `connections` column, not in the separate `amazon_connections` table. The `amazon_connections` table is defined in schema but unused. This is a structural inconsistency — functional but worth normalizing later.

**✅ Token refresh logic correct:**
Refresh triggered if token expires in <5 minutes. Logic in `getValidToken()`.

**✅ Redirect URIs correct for production:**
Constructed dynamically from `BASE_URL` env var (set to `https://app.teamcalbridge.com`).
Actual callback paths: `/amazon/callback/ads`, `/amazon/callback/dsp`, `/amazon/callback/seller`, `/amazon/callback/vendor`.

**✅ OAuth state validated on callback:**
`stateStore.get(state)` checks clientId + type match before proceeding.

**⚠️ VESTIGIAL ENV VARS (clarified, not a bug):**
`.env` had `LWA_REDIRECT_URI=http://localhost:3000/auth/amazon/callback` — misleading, unused.  
**Fix applied:** Replaced with a comment block documenting the actual redirect URIs needed in Amazon Developer Console.

### Manual Action Required:
- **Abe must register these redirect URIs in Amazon Developer Console (LWA App):**
  - `https://app.teamcalbridge.com/amazon/callback/ads`
  - `https://app.teamcalbridge.com/amazon/callback/dsp`
  - `https://app.teamcalbridge.com/amazon/callback/seller`
  - `https://app.teamcalbridge.com/amazon/callback/vendor`

---

## Section 2: Environment Variable Audit — ✅ PASS

**Files:** `.env`, `src/app.js`, `src/server.js`

### Findings:

**✅ All required env vars present:**
- Snowflake: account, user, password, warehouse, database, schema ✅
- Amazon LWA: client_id, client_secret ✅
- SP-API sandbox + production: all present ✅
- Session secret: set to 96-char hex string ✅ (non-trivial)
- BASE_URL: `https://app.teamcalbridge.com` ✅
- NODE_ENV: `production` ✅
- Resend API key: present ✅
- Stripe: test keys present ✅
- OpenRouter: present ✅

**✅ `require('dotenv').config()` called at top of app.js.**

**⚠️ SNOWFLAKE_SCHEMA=SANDBOX in production:**
The app is running against the SANDBOX Snowflake schema even with `NODE_ENV=production`.  
This is intentional for now (building against sandbox before promoting to PROD).  
**Action required:** When ready for real production data, change `SNOWFLAKE_SCHEMA=PROD`.

**✅ Graceful handling of missing optional vars:**
- Missing `OPENROUTER_API_KEY`: Chat returns 503 gracefully
- Missing `STRIPE_SECRET_KEY`: Billing returns 503 gracefully
- Missing `RESEND_API_KEY`: Email failures are caught and logged, not thrown

---

## Section 3: Error Handling Audit — ✅ PASS (with fixes)

**Files:** `src/routes/`, `src/jobs/`

### Findings:

**✅ All async route handlers use try/catch + `next(err)`**

**✅ Global error handler in app.js:**
```js
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});
```
Sends message (not stack trace) to client. Stack trace logged server-side only. ✅

**✅ Ingestion runner has retry logic + failure alerting:**
- 3 retries with exponential backoff (5s/15s/45s)
- Failures logged to Snowflake `ingestion_log`
- Failure alert email sent to Abe via Resend
- Test/demo clients skip alert emails

**✅ Snowflake connection errors handled:**
Dashboard/API endpoints fall back gracefully when Snowflake returns errors (catches in query calls).

**✅ Amazon API error handling:**
Each report type in `ingestPerformance` has individual try/catch:
```js
try {
  const reportId = await job.requester(...);
  ...
} catch (err) {
  console.warn(`[performance:${job.type}] Skipping ${reportDate}...`);
}
```
App will not crash on Amazon API failures.

---

## Section 4: Security Audit — ✅ PASS

### Findings:

**✅ All dashboard/data API routes protected by `requireAuth`:**
- `/dashboard/*` — requireAuth ✅
- `/advertising/*` — requireAuth ✅
- `/brands/*` — requireAuth ✅
- `/recommendations/*` — requireAuth ✅ (new route)
- `/campaigns/*` — requireAuth ✅
- `/cogs/*` — requireAuth ✅
- `/decisions/*` — requireAuth ✅
- `/account/*` — requireAuth ✅
- `/amazon/*` — requireAuth ✅
- `/admin/*` — requireAdmin ✅ (separate admin session)
- `/chat/*` — requireAuth ✅

**Public routes (intentionally unprotected):**
- `/health` — status check ✅
- `/billing/plans` — pricing page ✅
- `/billing/webhook` — Stripe webhook (verified by HMAC signature) ✅
- Static HTML files — login/signup pages ✅

**✅ SQL injection protected:**
All queries use parameterized binds (`?` placeholders with bind arrays).  
Dynamic SET clauses in `brands.js` and `account.js` build column name arrays from code constants (not user input) — safe.

**✅ OAuth state tokens validated:**
State is validated against stored token with clientId + type matching before processing.

**✅ SESSION_SECRET is non-trivial:**
96-character random hex string. ✅

**✅ No secrets logged to console:**
Only non-secret values (clientId, job type, record counts) logged.  
Password errors logged as message strings only, not including passwords.

**✅ Helmet.js security headers enabled**

**✅ httpOnly + secure session cookies in production**

**⚠️ MemoryStore session store:**
Using default in-memory session store — not suitable for multi-instance deployments.  
For single-instance (current): acceptable.  
For future scaling: migrate to `connect-pg-simple` (already in package.json) or Redis.

---

## Section 5: Data Flow Readiness — ✅ PASS (critical bug fixed)

**Files:** `src/jobs/adsIngestion.js`, `src/jobs/spIngestion.js`, `src/jobs/scheduler.js`

### Critical Bug Found and Fixed:

**🔴 BUG (FIXED): Scheduler never synced clients with real tokens**

In `src/jobs/scheduler.js` line 73-76:
```js
// BEFORE (broken):
const hasRealTokens = Object.values(connections).some(c =>
  c.connected && c.accessToken && !c.accessToken.startsWith('demo-')
);
```
`getConnectionStatus()` returns `{ connected: bool }` — it does NOT include `accessToken`.  
Result: `c.accessToken` was always `undefined`, making `hasRealTokens` always `false`.  
**Every client was being skipped, even with real Amazon tokens.**

```js
// AFTER (fixed):
const hasRealConnections = Object.values(connections).some(c => c.connected);
```

**Fix applied in:** `src/jobs/scheduler.js`

### Data Flow Status:

**✅ adsIngestion.js correctly uses stored access token:**
```js
const accessToken = await getValidToken(clientId, connectionType);
```
`getValidToken` auto-refreshes if <5 min from expiry. ✅

**✅ spIngestion.js correctly uses stored access token:**
Same pattern as adsIngestion. ✅

**✅ Scheduler correctly identifies connected clients:**
After fix, `hasRealConnections` checks `c.connected` from `getConnectionStatus()`. ✅

**✅ CM calculation triggered after sales + ads data sync:**
```js
if (hasAdData && hasSalesData) {
  await calculateContributionMargin(clientId, 30);
}
```

**⚠️ Gap: Amazon connections stored on `clients` table, not `amazon_connections` table:**
The `amazon_connections` table is defined in schema but the actual OAuth flow stores tokens in `clients.connections` (a VARIANT JSON column). The scheduler reads connection status via `getConnectionStatus()` which reads from `clients.connections`. This works, but is inconsistent with the schema design.  
**No functional impact on first sync — document for future refactoring.**

---

## Section 6: CM Calculation Verification — ✅ PASS

**File:** `src/jobs/contributionMargin.js`

### Formula Verification:

**✅ CM1 (Seller) = ordered_revenue - FBA fees - referral fees:**
```js
cm1 = revenue - fbaFees - referralFees;
```

**✅ CM1 (Vendor) = shipped_cogs (what Amazon paid the vendor):**
```js
cm1 = Number(row.SHIPPED_COGS || 0);
```

**✅ CM2 = CM1 - COGS:**
```js
const cm2 = totalCogs != null ? cm1 - totalCogs : null;
```

**✅ CM3 = CM2 - ad_spend (direct ASIN attribution only):**
```js
const cm3 = cm2 != null ? cm2 - adSpend : null;
```

**✅ vendor_cm1_is_estimate correctly set:**
```js
const vendorEstimate = isVendorRow ? 'TRUE' : 'FALSE';
```

**✅ COGS null handling — shows null, not $0:**
```js
const cogsPerUnit = row.COGS != null ? Number(row.COGS) : null;
const cm2 = totalCogs != null ? cm1 - totalCogs : null;
```
When COGS is not uploaded, CM2 and CM3 are null (not $0). ✅

**✅ UNATTRIBUTED ad spend excluded from per-ASIN attribution:**
```sql
AND advertised_asin != 'UNATTRIBUTED'
AND TRIM(advertised_asin) != ''
```

---

## Section 7: Schema Migration Safety — ✅ PASS (after fix)

**File:** `src/models/initSchema.js`

### Bug Found and Fixed:

**🔴 BUG (FIXED): Schema migration failed with "ambiguous column name 'PLAN'" error**

The `plan` column was already present on the `clients` table (added in a prior migration).  
The `initSchema.js` called `process.exit(1)` on any error, stopping all subsequent migrations.  
This meant `brands`, `ad_profiles`, `dsp_advertisers`, and other tables might not be created  
if run on an existing database.

**Fix applied:** `initSchema.js` now treats ALTER TABLE errors gracefully:
```js
if (isAlter && isAlreadyApplied) {
  console.log(`⚠️  Skipped (already applied): ${firstLine}`);
} else {
  console.error(`❌ Failed: ${firstLine}`);
  process.exit(1);
}
```

### Migration Run Results:
```
✅ CREATE TABLE IF NOT EXISTS clients
✅ CREATE TABLE IF NOT EXISTS amazon_connections
✅ CREATE TABLE IF NOT EXISTS ad_campaigns
✅ CREATE TABLE IF NOT EXISTS ad_performance
✅ CREATE TABLE IF NOT EXISTS products
✅ CREATE TABLE IF NOT EXISTS sales
✅ CREATE TABLE IF NOT EXISTS contribution_margin
⚠️  Skipped (already applied): ALTER TABLE clients ADD COLUMN IF NOT EXISTS plan
✅ ALTER TABLE products ADD COLUMN IF NOT EXISTS referral_fees
✅ ALTER TABLE sales ADD COLUMN IF NOT EXISTS shipped_cogs
✅ ALTER TABLE contribution_margin ADD COLUMN IF NOT EXISTS referral_fees
✅ ALTER TABLE contribution_margin ADD COLUMN IF NOT EXISTS amazon_fees
✅ ALTER TABLE contribution_margin ADD COLUMN IF NOT EXISTS cm1
✅ ALTER TABLE contribution_margin ADD COLUMN IF NOT EXISTS cm2
✅ ALTER TABLE contribution_margin ADD COLUMN IF NOT EXISTS cm3
✅ ALTER TABLE contribution_margin ADD COLUMN IF NOT EXISTS cm1_per_unit
✅ ALTER TABLE contribution_margin ADD COLUMN IF NOT EXISTS cm2_per_unit
✅ ALTER TABLE contribution_margin ADD COLUMN IF NOT EXISTS cm3_per_unit
✅ ALTER TABLE contribution_margin ADD COLUMN IF NOT EXISTS vendor_cm1_is_estimate
✅ CREATE TABLE IF NOT EXISTS ad_profiles
✅ CREATE TABLE IF NOT EXISTS dsp_advertisers
✅ CREATE TABLE IF NOT EXISTS brands
✅ CREATE TABLE IF NOT EXISTS ingestion_log

✅ Schema initialized successfully
```

All new tables created. No data loss on existing tables. ✅

---

## Section 8: Seed Data Verification — ✅ PASS

**File:** `src/models/seedData.js`

### Verified:
- **test-client-001 has plan='pro'** ✅
- **3 brands exist:** TechGear US (US), TechGear UK (UK), HomeStyle US (US) ✅
- **CM data reflects correct formulas:**
  - CM1 ≠ CM2 ≠ CM3 — all different values ✅
  - CM1 = revenue minus Amazon fees ✅
  - CM2 = CM1 minus brand COGS ✅
  - CM3 = CM2 minus ad spend ✅
- **B001TEST05 (Magnetic Knife Strip) has negative CM3/unit:** `-$0.51/unit` ✅
  - Aggregate CM3 may appear positive due to random data variance — per-unit analysis is the relevant metric

**Note on recommendations seed:** The audit checklist mentioned seeding recommendations (1 critical, 2 warnings, 2 opportunities), but there is no `recommendations` table in the schema. Recommendations are generated in real-time by the decision engine from CM + advertising data. No static seed needed.

---

## Section 9: Live App Health — ✅ PASS

**Tested on port 3099 (new code) to avoid hitting stale pm2 process:**

| Endpoint | Expected | Actual | Status |
|---|---|---|---|
| `GET /health` | 200 | `{"status":"ok"}` | ✅ |
| `GET /` | 200 | 200 (index.html) | ✅ |
| `GET /dashboard.html` | 200 | 200 | ✅ |
| `GET /brand-setup.html` | 200 | 200 | ✅ |
| `GET /brands/plan-info` | 401 | 401 `{"error":"Authentication required"}` | ✅ |
| `GET /recommendations/summary` | 401 | 401 `{"error":"Authentication required"}` | ✅ |
| `GET /dashboard` (API) | 401 | 401 | ✅ |
| `GET /advertising/summary` | 401 | 401 | ✅ |

All routes return 200 or 401 (not 404 or 500). ✅

**Note:** The live pm2 server (port 3000) is running older code. A `pm2 restart` is needed to deploy fixes. (Not performed per audit scope — no pm2 restart.)

**⚠️ MemoryStore warning in logs:**
```
Warning: connect.session() MemoryStore is not designed for a production environment
```
Functional on single instance. See deploy-checklist.md for upgrade path.

---

## Section 10: PM2 Startup Command — ✅ PASS

Documented in `docs/deploy-checklist.md`.

**Correct PM2 command:**
```bash
pm2 restart calbridge-portal --update-env
```

**Deploy order:**
1. `git pull` latest code
2. `npm install --production` (if package.json changed)
3. `node src/models/initSchema.js` (safe, idempotent after fix)
4. `pm2 restart calbridge-portal --update-env`
5. `pm2 save`
6. Verify: `curl https://app.teamcalbridge.com/health`

---

## All Fixes Applied

| # | File | Fix |
|---|---|---|
| 1 | `src/jobs/scheduler.js:73` | **Critical:** Fixed scheduler never syncing clients — `c.accessToken` → `c.connected` check |
| 2 | `src/models/initSchema.js` | **Important:** Schema migration now idempotent — skips already-applied ALTER statements instead of crashing |
| 3 | `src/routes/recommendations.js` | **New:** Added `/recommendations/summary` and `/recommendations` endpoints (wraps decision engine) |
| 4 | `src/app.js` | Registered recommendations route |
| 5 | `.env` | Clarified vestigial `LWA_REDIRECT_URI` — replaced with comment block documenting required Amazon Developer Console registrations |
| 6 | `docs/deploy-checklist.md` | New file: exact PM2 commands, deploy order, post-deploy verification steps |

---

## Outstanding Items Requiring Manual Action

### 🔴 Critical (Blocking Real Client Connection)

1. **LWA Scope — Amazon Developer Console**
   - **Issue:** Abe is fixing this manually. The `advertising::campaign_management` scope must be approved for the LWA app.
   - **Action:** In Amazon Developer Console → Security Profile → LWA app, request `advertising::campaign_management` scope
   - **What fails without this:** Amazon Ads (SP/SB/SD) and DSP OAuth connections fail with scope error

2. **Register OAuth Redirect URIs in Amazon Developer Console**
   - **Issue:** The Amazon LWA app must have these exact redirect URIs allowlisted:
     - `https://app.teamcalbridge.com/amazon/callback/ads`
     - `https://app.teamcalbridge.com/amazon/callback/dsp`
     - `https://app.teamcalbridge.com/amazon/callback/seller`
     - `https://app.teamcalbridge.com/amazon/callback/vendor`
   - **Action:** Add all 4 URIs to allowed return URLs in LWA security profile

3. **PM2 Restart** (deploy the fixes from this audit)
   - **Action:** `pm2 restart calbridge-portal --update-env && pm2 save`
   - **What fails without this:** Scheduler still uses old broken code; recommendations route returns 404

### 🟡 Medium (Non-blocking, Should Fix Before Scale)

4. **SNOWFLAKE_SCHEMA=SANDBOX**
   - Currently running against sandbox schema even in "production"
   - Change to `PROD` when ready to use real production Snowflake data

5. **Session Store (MemoryStore → persistent)**
   - `connect-pg-simple` already in `package.json`
   - Needs PostgreSQL instance or use Redis
   - Only an issue for multi-instance or server restart scenarios

6. **`amazon_connections` table is unused**
   - OAuth tokens stored in `clients.connections` VARIANT column
   - `amazon_connections` table is defined but not populated
   - Inconsistency with schema design — no functional impact
   - Future: migrate to use the proper tokens table

7. **In-memory OAuth state store**
   - `stateStore` Map in `amazonAuthService.js` is in-memory
   - Server restart during OAuth flow = state lost = user must retry
   - Future: migrate to Redis for high availability

### 🟢 Low (Nice to Have)

8. **Stripe live mode**
   - Currently using `sk_test_...` keys
   - Switch to live Stripe keys when billing goes live

9. **SP-API App Review Pending**
   - `SPAPI_PROD_CLIENT_ID` is set but Amazon review may be pending
   - No action needed now; apply when Amazon approves

---

## Final Verdict: ✅ GO (with conditions)

The codebase is solid and ready for first real client connection, **after**:

1. Abe completes LWA scope approval in Amazon Developer Console
2. Abe registers the 4 redirect URIs in Amazon Developer Console  
3. Abe runs `pm2 restart calbridge-portal --update-env` to deploy these fixes

The critical scheduler bug fix means the first real client connection will actually trigger data ingestion as intended. Schema migrations are now idempotent. Error handling is robust throughout.

---
*Generated by Ash — 2026-03-24*
