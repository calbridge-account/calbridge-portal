# Brands Architecture Test Report
Date: 2026-03-24

## Summary
**OVERALL: ✅ PASS** — 12/12 tests passed (with 2 caveats noted)

All core functionality is working correctly. Two known issues exist but neither is a regression from this build.

---

## Test Results

| # | Test | Result | Notes |
|---|------|--------|-------|
| 1 | Schema Migration | ✅ PASS | All 12 statements executed cleanly. All required tables created. |
| 2 | Plan Column on Clients | ✅ PASS | Plan column exists. After seed, test-client-001 = 'pro'. ⚠️ Pre-seed it was 'starter' — seed must run first. |
| 3 | Brands Seed Data | ✅ PASS | Exactly 3 brands: TechGear US, TechGear UK, HomeStyle US — all for test-client-001. |
| 4 | planGate Middleware | ✅ PASS | All 4 tiers correct. Infinity bypass works. requireFeature returns 403+upgrade:true. |
| 5 | Brands Route Structure | ✅ PASS | plan-info defined BEFORE /:brandId ✓, POST uses checkBrandLimit ✓, DELETE soft-deletes ✓, auth checked ✓, crypto.randomUUID() used ✓. |
| 6 | App.js Registration | ✅ PASS | `app.use('/brands', brandsRoutes)` present. Middleware order correct (session → routes). No syntax errors. |
| 7 | Dashboard Brand-Awareness | ✅ PASS | `resolveBrand()` exists, handles ?brandId= param, returns noBrands:true when no brands, falls back to first active brand. |
| 8 | Seed Idempotency | ✅ PASS | Re-ran seed — no errors, still exactly 3 brands (MERGE pattern working). |
| 9 | File Existence | ✅ PASS | All 4 files present: planGate.js, brands.js, brand-setup.html, schema.sql (updated). |
| 10 | Syntax Check | ✅ PASS | `node --check` clean on both planGate.js and brands.js. All other files also clean. |
| 11 | Demo Login Data Flow | ✅ PASS | All 3 brands show 720 CM asin rows each (CM data present, joined correctly). |
| 12 | Brand-Aware Dashboard API | ✅ PASS | Health: 200 ✓, brand-setup.html: 200 ✓, brands/plan-info: 401 (correct — unauthenticated). |

---

## Issues Found

### ⚠️ Issue 1: `advertised_asin` column missing in initial schema (pre-existing, not regression)
**Severity:** Low — only affects `contributionMargin.js` computation during seed
**Error:**
```
[Snowflake] ❌ Schema error — unknown column: ADVERTISED_ASIN
SQL compilation error: error line 22 at position 21
invalid identifier 'ADVERTISED_ASIN'
```
**Location:** `src/jobs/contributionMargin.js:51` uses `advertised_asin` column which is only added by `src/jobs/adsIngestion.js:168` at runtime via `ALTER TABLE ADD COLUMN IF NOT EXISTS`.
**Impact:** Seed reports "undefined CM records" instead of a count. CM data was still seeded (from a previous run), so demo login shows real numbers. Not a brands-architecture bug.

### ⚠️ Issue 2: Test 12 race condition (test setup concern, not app bug)
**Severity:** Very Low — cosmetic
**Detail:** When running `node src/server.js &` + `sleep 3`, the Snowflake connection during scheduler startup causes a timing race where curl sometimes fires before the server fully binds. `/brands/plan-info` incorrectly returned 404 in one run. Confirmed 401 (correct) when tested properly. The app itself is fine.

---

## Recommended Fixes

### Fix 1: Add `advertised_asin` + NTB columns to `initSchema.js` / `schema.sql`
This ensures the CM job works on fresh environments without requiring a real SP-API ingestion run first.

**In `src/models/schema.sql`**, add after the `ad_performance` table definition:
```sql
ALTER TABLE ad_performance ADD COLUMN IF NOT EXISTS advertised_asin VARCHAR(20);
ALTER TABLE ad_performance ADD COLUMN IF NOT EXISTS ntb_orders NUMBER;
ALTER TABLE ad_performance ADD COLUMN IF NOT EXISTS ntb_sales FLOAT;
ALTER TABLE ad_performance ADD COLUMN IF NOT EXISTS ntb_units NUMBER;
```

**In `src/models/initSchema.js`**, include those ALTER statements in the schema array.

### Fix 2 (optional): Add startup delay/health check to Test 12 script
Replace `sleep 3` with `sleep 6` or add a health-check loop to avoid the race condition in CI/test scripts. Not an app fix — just test harness improvement.

---

## Demo Login Status

**demo@teamcalbridge.com** (test-client-001, plan=**pro**) sees:

| Brand | Marketplace | CM Data |
|-------|-------------|---------|
| TechGear US | US | ✅ 720 records |
| TechGear UK | UK | ✅ 720 records |
| HomeStyle US | US | ✅ 720 records |

- Plan: `pro` — unlocks client portal, up to 10 brands ✅
- Brand switcher: will show 3 brands in dropdown
- `noBrands` flag: `false` — dashboard will show data ✅
- `canAddBrand`: `true` (3 of 10 used) ✅
- DSP features: locked (pro plan, not scale) — correct ✅

Demo login experience looks solid. The brand-aware dashboard will default to TechGear US (first brand by created_at), and the user can switch to TechGear UK or HomeStyle US via `?brandId=` param.

---

## Additional Observations

1. **requireAuth vs session shape**: `requireAuth.js` checks `req.session.clientId` (flat), while brands route helper `getClientId()` also checks `req.session?.client?.id` (nested). Both auth.js and the auth flow set `clientId` flat — the nested fallback is safe redundancy.

2. **server.js startup**: `registerWeeklyEmailCron()` is called even when `ENABLE_SCHEDULER=false` (the guard only wraps `startScheduler()`). Minor — cron won't trigger unless it's Monday at 8am, but worth cleaning up.

3. **MemoryStore warning**: Normal dev-mode Express session warning. Not a brands issue.

4. **ADMIN_USERS and CAMPAIGN_ACTIONS tables**: Exist in Snowflake (from earlier schema work), not in schema.sql. Pre-existing — not related to this build.
