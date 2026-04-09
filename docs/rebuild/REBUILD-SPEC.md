# Calbridge Portal — Rebuild Specification
_Last updated: 2026-04-09_

## Terminology
- **Manager account** — top-level org, owns billing, can have multiple advertiser accounts
- **Advertiser account** — scoped to a specific brand/advertiser, owns all data
- **User account** — login credentials + role-based access to one or more advertiser accounts

## Non-Negotiables (must not be broken by any phase)
1. **No data truncation** — all writes must be MERGE (upsert) not INSERT+TRUNCATE. Prior data loss from truncation has caused significant issues. Every table write must be audited for TRUNCATE risk.
2. **Budget pacing** — all functionality and associated data must be preserved through the rebuild. This includes: per-campaign MTD spend, daily budget, monthly budget, pacing ratio, over/under/no_budget status, DSP inclusion.
3. **Advertiser/nav selector** — the navigation advertiser picker must continue to work at all times. Do not remove or break the brand/advertiser selection flow.
4. **Adjusted ad spend** — the spend adjustment multiplier system (SPEND_ADJUSTMENTS table, adjusted_campaign_performance view) must be preserved and carried forward. This is a core differentiator.

## Ultimate Goal
Layer in the decision engine to:
- Analyze campaign performance autonomously
- Write back bid/budget changes to the ads platform (Amazon Ads API)
- Create new campaigns/ad groups/keywords programmatically
- This requires: stable account model, clean data layer, reliable ingestion, write-back OAuth scopes

---

## Phase 1 — Stop the Bleeding (current sprint)
_Target: this week. No architecture changes, targeted fixes only._

### P1-1: Ingestion refresh guard ✅ IN PROGRESS
- **File:** src/jobs/reportOrchestrator.js
- **Fix:** DATEADD guard 6h → 1h so today's SP/SB/SD data refreshes hourly

### P1-2: B2B column mis-mapping ✅ IN PROGRESS
- **File:** src/jobs/spIngestion.js
- **Fix:** Stop writing unitsOrderedB2B → units_received and orderedProductSalesB2B → shipped_revenue

### P1-3: Vendor CM reads wrong table ✅ IN PROGRESS
- **File:** src/jobs/contributionMargin.js
- **Fix:** Vendor path reads CALBRIDGE_PROD.APP.VENDOR_SALES (start_date, shipped_units) not vendor_purchase_orders

### P1-4: Vendor revenue double-counting ✅ IN PROGRESS
- **File:** src/routes/dashboard.js
- **Fix:** totalRetailSales = shippedRevenue > 0 ? shippedRevenue : orderedRevenue (not additive)

### P1-5: Hardcoded CyberPower client ID ✅ IN PROGRESS
- **Files:** src/routes/vendorAnalytics.js, src/routes/cogsAnalytics.js
- **Fix:** getClientId() throws 401 if no session clientId instead of defaulting to CyberPower

### Post-P1: Re-run CM job
- After fixes land, re-run contributionMargin job with daysBack=90 to recompute historical data correctly

---

## Phase 2 — Unified Data Layer (2–3 weeks)
_Target: after Phase 1 is stable._

### P2-1: Single source of truth for retail revenue
- Seller accounts → vendor_purchase_orders (ordered_revenue, order_date)
- Vendor accounts → VENDOR_SALES (shipped_revenue, start_date)
- No mixing. Dashboard summary detects account type and queries accordingly.

### P2-2: DSP fully merged into adjusted_campaign_performance
- Add DSP-only columns to campaign_performance UNION ALL (NULLed for SP/SB/SD):
  video_ad_complete, video_ad_start, viewable_impressions, order_budget, order_start_date, order_end_date
- Update /dsp-summary and /dsp-orders to query adjusted_campaign_performance WHERE ad_type = 'DSP'
- Deprecate adjusted_dsp_campaign_report view

### P2-3: Standardize date columns
- Unified mapping: all retail routes use a consistent date parameter
- Document which table uses which column: order_date / start_date / calc_date / date / report_date

### P2-4: Fix cogsAnalytics legacy table references
- cogsAnalytics.js references RAW.RETAIL_SALES_TRAFFIC and RAW.RETAIL_LISTING (stale/empty)
- Point to CALBRIDGE_PROD.APP.VENDOR_SALES instead

### P2-5: Wire DSP through reportOrchestrator
- DSP currently runs its own 6h cron path (adsIngestion.ingestDsp)
- Wire DSP into the same 15-min submit/poll/download cycle as SP/SB/SD

---

## Phase 3 — Account Model Rebuild (3–6 weeks)
_Can run in parallel with Phase 2. Required before multi-advertiser launch._

### New schema (additive — no drops until migration verified)

```sql
-- Manager account (billing owner, org root)
CREATE TABLE manager_accounts (
  manager_id           VARCHAR(36) PRIMARY KEY,
  name                 VARCHAR(255),
  stripe_customer_id   VARCHAR,
  stripe_subscription_id VARCHAR,
  subscription_plan    VARCHAR(20),
  subscription_status  VARCHAR(20),
  created_at           TIMESTAMP
);

-- Advertiser account (brand/marketplace, data-scoped)
CREATE TABLE advertiser_accounts (
  advertiser_id        VARCHAR(36) PRIMARY KEY,
  manager_id           VARCHAR(36) REFERENCES manager_accounts,
  name                 VARCHAR(255),
  marketplace          TEXT DEFAULT 'US',
  ads_profile_id       TEXT,
  sp_seller_id         TEXT,
  sp_vendor_id         TEXT,
  dsp_advertiser_id    TEXT,
  is_active            BOOLEAN DEFAULT TRUE,
  created_at           TIMESTAMP
);

-- Users (login, decoupled from client/billing)
CREATE TABLE users (
  user_id              VARCHAR(36) PRIMARY KEY,
  email                VARCHAR(255) UNIQUE,
  password_hash        VARCHAR(255),
  name                 VARCHAR(255),
  created_at           TIMESTAMP
);

-- RBAC join: which users can access which advertiser accounts and at what role
CREATE TABLE user_advertiser_access (
  user_id              VARCHAR(36) REFERENCES users,
  advertiser_id        VARCHAR(36) REFERENCES advertiser_accounts,
  role                 VARCHAR(20), -- viewer / analyst / manager / owner
  PRIMARY KEY (user_id, advertiser_id)
);
```

### Migration path
- Phase 3a: Add new tables alongside existing clients table (no behavior change)
- Phase 3b: Migrate auth — new session model (userId, managerId, advertiserId, role)
- Phase 3c: Migrate data tables — add advertiser_id column to all data tables, backfill from client_id
- Phase 3d: Migrate billing — move Stripe customer/subscription to manager_accounts
- Phase 3e: Frontend — advertiser picker, role-scoped UI, manager dashboard
- Phase 3f: Deprecate clients table + linked_client_id hack

### Session model target
```js
req.session.userId          // authenticated user
req.session.managerId       // their org
req.session.advertiserId    // currently selected advertiser
req.session.role            // role on THIS advertiser: viewer/analyst/manager/owner
```

---

## Phase 4 — Decision Engine Write-Back
_After Phase 2+3 stable. This is the product differentiator._

### Requirements
- Amazon Ads API write scopes (bid changes, budget changes, campaign create/pause)
- OAuth tokens must be scoped per advertiser_account
- Decision engine actions must be logged with before/after state (audit trail)
- Human confirmation gate for new campaign creation (can be toggled per advertiser)
- Write-back rules: 6-layer hierarchy already defined in MEMORY.md

### Architecture
- Decision engine reads from adjusted_campaign_performance + contribution_margin
- Produces action recommendations with confidence scores
- Actions queue in a `decision_actions` table (pending → approved → executed → rolled_back)
- Executor service calls Amazon Ads API write endpoints
- Results fed back into ingestion pipeline on next refresh cycle

---

## Key Constraints (carry through all phases)
- All DB writes: MERGE only, never TRUNCATE
- Budget pacing: always powered by adjusted_campaign_performance (not ad_campaigns)
- Adjusted spend: SPEND_ADJUSTMENTS + adjusted_campaign_performance view preserved at all times
- Advertiser nav: always functional, never broken by migrations
- No hardcoded client IDs anywhere in route code
