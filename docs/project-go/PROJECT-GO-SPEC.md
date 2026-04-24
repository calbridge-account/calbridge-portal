# Project GO — Production Database Build Spec
_Documented 2026-03-26. All decisions confirmed by Abe._

---

## Overview

Clean-slate production database. No data migration from sandbox. Built correctly the first time — scalable to multiple clients, multiple platforms, multiple ad types without schema changes.

**Database name:** TBD (decide at execution time — likely `CALBRIDGE_PROD`)
**Current database:** `CALBRIDGE` (becomes dev/sandbox)

---

## Core Principles

1. Row-level multi-tenancy — `client_id` on every table, always
2. Platform-agnostic — `platform` column discriminates, not table names
3. Nothing hardcoded — no client IDs, no column lists, no report types in code
4. Amazon v3 API only — no v2 field names anywhere
5. Daily grain everywhere — aggregations at query time, never in storage
6. All timestamps `TIMESTAMP_NTZ` UTC — display conversion in app
7. No derivable metrics stored — no CPC, CTR, CVR, ROAS, ACoS, CPM
8. Store what Amazon computes that we can't — impression share, NTB, viewability

---

## Schema Structure

```
CALBRIDGE_PROD
├── APP          -- operational: clients, users, credentials, config, enrollment
├── RAW          -- raw ingestion from all sources
├── ANALYTICS    -- canonical normalized models + keyword impression trends
├── CANONICAL    -- source-agnostic entities + recommendations + outcomes
├── METRICS      -- computed KPIs and opportunity scores
├── OPS          -- report queue, ingestion log, change queue, campaign builds
└── PIPELINE     -- job runs, freshness, quality log
```

---

## APP Schema

### APP.CLIENTS
```sql
client_id           UUID PRIMARY KEY DEFAULT UUID_STRING(),
client_name         VARCHAR NOT NULL,
client_type         VARCHAR NOT NULL,  -- 'brand' / 'agency'
parent_client_id    VARCHAR,           -- NULL for top-level; agency client_id for sub-clients
status              VARCHAR NOT NULL,  -- 'onboarding' / 'active' / 'grace_period' / 'suspended' / 'paused' / 'churned'
plan                VARCHAR,           -- 'starter' / 'growth' / 'pro' / 'enterprise'
billing_email       VARCHAR,
stripe_customer_id  VARCHAR,
grace_period_started_at TIMESTAMP_NTZ,
suspended_at        TIMESTAMP_NTZ,
churned_at          TIMESTAMP_NTZ,
created_at          TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP,
updated_at          TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP
```

### APP.CLIENT_PLATFORM_PROFILES
```sql
profile_uuid        UUID DEFAULT UUID_STRING(),
client_id           VARCHAR NOT NULL,
platform            VARCHAR NOT NULL,  -- 'amazon_ads' / 'amazon_sp_api' / 'amazon_dsp' / 'walmart'
profile_id          VARCHAR NOT NULL,  -- platform's identifier
profile_name        VARCHAR,
account_type        VARCHAR NOT NULL,  -- 'seller' / 'vendor' / 'agency' / 'dsp_seat' / 'dsp_advertiser'
marketplace         VARCHAR,           -- 'US' / 'UK' / 'DE' / 'JP' etc.
currency_code       VARCHAR,
timezone            VARCHAR,
parent_profile_id   VARCHAR,           -- DSP advertiser's agency seat profile_id
credential_owner_client_id VARCHAR NOT NULL,  -- which client_id owns the credential
is_managed_advertiser BOOLEAN DEFAULT FALSE,  -- TRUE = sub-advertiser, not a direct client
is_active           BOOLEAN DEFAULT TRUE,
last_synced_at      TIMESTAMP_NTZ,
created_at          TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP
```

### APP.CLIENT_CREDENTIALS
```sql
id                  UUID DEFAULT UUID_STRING(),
client_id           VARCHAR NOT NULL,
platform            VARCHAR NOT NULL,
credential_type     VARCHAR NOT NULL,  -- 'lwa_refresh_token' / 'api_key' / 'oauth2'
credential_value    VARCHAR NOT NULL,  -- AES-256 encrypted
credential_owner_client_id VARCHAR NOT NULL,
marketplace         VARCHAR,
scopes              ARRAY,
expires_at          TIMESTAMP_NTZ,
last_refreshed_at   TIMESTAMP_NTZ,
is_active           BOOLEAN DEFAULT TRUE,
created_at          TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP,
updated_at          TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP
```

### APP.CONFIG
```sql
key                 VARCHAR PRIMARY KEY,
value               VARCHAR NOT NULL,
value_type          VARCHAR,  -- 'string' / 'number' / 'boolean' / 'json'
is_secret           BOOLEAN DEFAULT FALSE,
description         VARCHAR,
updated_at          TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP,
updated_by          VARCHAR
```

Seed values:
```
amazon_ads_api_base_url                    = 'https://advertising-api.amazon.com'
amazon_sp_api_base_url                     = 'https://sellingpartnerapi-na.amazon.com'
max_report_date_range_days                 = 31
report_queue_batch_size                    = 20
sla_report_completion_hours                = 4
sla_data_freshness_hours                   = 6
default_lookback_days                      = 95
opportunity_score_cm_weight                = 0.7
opportunity_score_mroas_weight             = 0.3
default_payback_target_days                = 60
writeback_max_bid_change_pct               = 20
writeback_max_budget_change_pct            = 30
writeback_min_data_points                  = 14
writeback_min_confidence                   = 0.7
writeback_min_keyword_bid_usd              = 0.15
writeback_max_keyword_bid_usd              = 25.00
writeback_min_daily_budget_usd             = 10.00
writeback_max_daily_budget_usd             = 10000
writeback_min_impressions_to_touch         = 1000
writeback_min_days_between_keyword_changes = 7
writeback_min_days_between_campaign_changes= 3
writeback_max_changes_per_client_per_day   = 50
rollback_trigger_acos_increase_pct         = 25
rollback_trigger_roas_decrease_pct         = 20
rollback_trigger_evaluation_days           = 7
rollback_trigger_min_spend_to_evaluate     = 50
```

### APP.CLIENT_CONFIG
Per-client overrides for any APP.CONFIG key plus:
```sql
client_id, config_key, config_value, updated_at, updated_by
```

### APP.REPORT_TYPE_REGISTRY
```sql
registry_id         UUID DEFAULT UUID_STRING(),
platform            VARCHAR NOT NULL,  -- 'amazon_ads' / 'amazon_sp_api' / 'amazon_dsp'
report_type_id      VARCHAR NOT NULL,  -- Amazon's reportTypeId (e.g. 'spCampaigns')
report_key          VARCHAR NOT NULL,  -- internal routing key
ad_product          VARCHAR,           -- 'SPONSORED_PRODUCTS' / 'SPONSORED_BRANDS' etc.
groupby             VARIANT,           -- JSON array
columns             VARIANT,           -- JSON array (v3 column names only, no derivable metrics)
max_date_range_days NUMBER DEFAULT 31,
time_unit           VARCHAR DEFAULT 'DAILY',
target_raw_table    VARCHAR NOT NULL,  -- which RAW.* table this writes to
requires_feature    VARCHAR,           -- 'ntb_metrics' / 'video' / 'dsp_seat' / 'vendor'
account_types       VARIANT,           -- JSON: ['seller'] or ['vendor'] or ['seller','vendor']
is_active           BOOLEAN DEFAULT TRUE,
api_version         VARCHAR DEFAULT 'v3',
rate_limit_rps      NUMBER,
created_at          TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP
```

### APP.USERS
```sql
user_id             UUID DEFAULT UUID_STRING(),
client_id           VARCHAR NOT NULL,
email               VARCHAR NOT NULL UNIQUE,
name                VARCHAR,
role                VARCHAR NOT NULL,  -- 'viewer' / 'analyst' / 'manager' / 'admin' / 'super_admin'
is_active           BOOLEAN DEFAULT TRUE,
last_login_at       TIMESTAMP_NTZ,
invited_by          VARCHAR,
invited_at          TIMESTAMP_NTZ,
created_at          TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP
```

### APP.ALERT_ROUTING
```sql
routing_id          UUID DEFAULT UUID_STRING(),
client_id           VARCHAR NOT NULL,
alert_type          VARCHAR NOT NULL,  -- 'data_stale' / 'sla_breach' / 'credential_expired' / 'change_needs_approval' / 'payment_failed'
destination_type    VARCHAR NOT NULL,  -- 'email' / 'webhook' / 'in_app'
destination         VARCHAR NOT NULL,
send_to_role        VARCHAR,           -- 'admin' / 'manager' etc. (NULL = specific destination only)
is_active           BOOLEAN DEFAULT TRUE
```

### APP.CLIENT_AI_GROUPS
```sql
group_id            UUID DEFAULT UUID_STRING(),
client_id           VARCHAR NOT NULL,
group_name          VARCHAR NOT NULL,
strategy            VARCHAR,           -- 'maximize_roas' / 'maximize_revenue' / 'target_acos' / 'launch'
target_acos         NUMBER,
target_roas         NUMBER,
aggressiveness      VARCHAR DEFAULT 'moderate',  -- 'conservative' / 'moderate' / 'aggressive'
approval_mode       VARCHAR DEFAULT 'disabled',  -- 'manual' / 'auto_within_rules' / 'disabled'
max_bid_usd         NUMBER,
min_bid_usd         NUMBER,
max_daily_budget_usd NUMBER,
is_active           BOOLEAN DEFAULT TRUE,
created_at          TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP
```

### APP.CLIENT_AI_ENROLLMENT
```sql
enrollment_id       UUID DEFAULT UUID_STRING(),
client_id           VARCHAR NOT NULL,
platform            VARCHAR NOT NULL,
resource_type       VARCHAR NOT NULL,  -- 'campaign' / 'ad_group' / 'keyword' / 'portfolio'
resource_id         VARCHAR NOT NULL,
resource_name       VARCHAR,
enrollment_mode     VARCHAR NOT NULL,  -- 'fully_managed' / 'recommendations_only' / 'excluded'
ai_group_id         VARCHAR,
enrolled_at         TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP,
enrolled_by         VARCHAR
```

### APP.CLIENT_DAYPARTING
```sql
rule_id             UUID DEFAULT UUID_STRING(),
client_id           VARCHAR NOT NULL,
rule_name           VARCHAR NOT NULL,
action_type         VARCHAR NOT NULL,  -- 'pause_campaigns' / 'reduce_budget_pct' / 'reduce_bids_pct'
action_value        NUMBER,
days_of_week        VARIANT,           -- JSON: ["saturday","sunday"]
hours_utc           VARIANT,           -- JSON: [0,1,2,3] — future, requires Marketing Stream
applies_to          VARCHAR DEFAULT 'all_campaigns',  -- 'all_campaigns' / 'campaign_ids' / 'portfolio_ids'
applies_to_ids      VARIANT,           -- JSON array
is_active           BOOLEAN DEFAULT TRUE,
created_at          TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP
```

### APP.CAMPAIGN_TEMPLATES
```sql
template_id         UUID DEFAULT UUID_STRING(),
client_id           VARCHAR,           -- NULL = global Calbridge template
template_name       VARCHAR NOT NULL,
platform            VARCHAR NOT NULL,
ad_type             VARCHAR NOT NULL,
campaign_type       VARCHAR,
bidding_strategy    VARCHAR,
default_daily_budget_usd NUMBER,
targeting_type      VARCHAR,
match_types         VARIANT,
negative_match_types VARIANT,
structure           VARIANT,           -- full campaign structure JSON
created_by          VARCHAR,
is_active           BOOLEAN DEFAULT TRUE,
created_at          TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP
```

### APP.WHITE_LABEL_CONFIG
```sql
client_id           VARCHAR NOT NULL,
custom_domain       VARCHAR UNIQUE,
brand_name          VARCHAR,
logo_url            VARCHAR,
primary_color       VARCHAR,
secondary_color     VARCHAR,
support_email       VARCHAR,
custom_domain_verified BOOLEAN DEFAULT FALSE,
ssl_provisioned     BOOLEAN DEFAULT FALSE,
is_active           BOOLEAN DEFAULT TRUE
```

### APP.BILLING_EVENTS
```sql
event_id            VARCHAR PRIMARY KEY,  -- Stripe event ID
client_id           VARCHAR NOT NULL,
event_type          VARCHAR NOT NULL,
amount_usd          NUMBER,
occurred_at         TIMESTAMP_NTZ NOT NULL,
processed_at        TIMESTAMP_NTZ,
resulting_status    VARCHAR
```

### APP.ONBOARDING_CHECKLIST
```sql
client_id           VARCHAR NOT NULL,
step                VARCHAR NOT NULL,  -- 'client_created' / 'credentials_connected' / 'credentials_validated' / 'profiles_synced' / 'backfill_queued' / 'first_data_received' / 'activated'
completed_at        TIMESTAMP_NTZ,
completed_by        VARCHAR,
notes               VARCHAR
```

---

## RAW Schema

### Column naming conventions
- Universal metrics: short canonical name (`cost`, `impressions`, `clicks`)
- Platform-specific: `{platform}_{field}` (`amazon_dsp_supply_cost`, `amazon_sb_ntb_purchases`)
- Attribution windows: `{metric}_{window}` (`purchases_1d`, `purchases_7d`, `purchases_14d`, `purchases_30d`)
- Never store: CPC, CTR, CVR, ROAS, ACoS, CPM, eCPCV (all derivable)
- Always store: impression share, NTB metrics, viewability, video completion (Amazon-computed)

### Standard columns on every RAW table
```sql
client_id           VARCHAR NOT NULL,
platform            VARCHAR NOT NULL,
marketplace         VARCHAR NOT NULL DEFAULT 'US',
ingested_at         TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP,
report_id           VARCHAR,           -- source report ID for traceability
pipeline_run_id     VARCHAR
```

### RAW.AD_CAMPAIGN
Campaign-level daily performance across all ad types.
Key: `(client_id, platform, marketplace, campaign_id, date)`

### RAW.AD_GROUP
Ad group / line item daily performance.
Key: `(client_id, platform, marketplace, ad_group_id, date)`

### RAW.AD_KEYWORD_TARGET
Keyword and targeting expression daily performance.
Key: `(client_id, platform, marketplace, keyword_id, target_id, date)`

### RAW.AD_SEARCH_TERM
Customer search query performance.
Key: `(client_id, platform, marketplace, keyword_id, search_term, date)`

### RAW.AD_NEGATIVE_KEYWORD
Negative keyword configuration (not performance).
Key: `(client_id, platform, marketplace, campaign_id, ad_group_id, keyword_id)`

### RAW.AD_NEGATIVE_TARGET
Negatively targeted ASINs and categories.
Key: `(client_id, platform, marketplace, campaign_id, ad_group_id, target_id)`

### RAW.AD_PLACEMENT
Placement breakdown (top of search, product pages, rest of search).
Key: `(client_id, platform, marketplace, campaign_id, placement, date)`

### RAW.AD_ADVERTISED_PRODUCT
ASIN-level ad performance.
Key: `(client_id, platform, marketplace, asin, campaign_id, ad_group_id, date)`

### RAW.AD_PURCHASED_PRODUCT
Cross-ASIN attribution — what was bought vs what was advertised.
Key: `(client_id, platform, marketplace, advertised_asin, purchased_asin, campaign_id, date)`

### RAW.AD_AUDIENCE
DSP audience segment performance.
Key: `(client_id, platform, marketplace, audience_id, order_id, date)`

### RAW.AD_GEO
Geographic performance breakdown. Cut at region level — no city, postal code, or metro.
Key: `(client_id, platform, marketplace, order_id, country_code, region_code, date)`
Columns: country_code, region_code, order_id, advertiser_id, impressions, clicks, cost, purchases, purchases_clicks, sales, date
Source: dspCampaign report, groupBy: ['geography']

### RAW.AD_GROSS_AND_INVALIDS
Invalid traffic by campaign.
Key: `(client_id, platform, marketplace, campaign_id, date)`

### RAW.AD_REACH_FREQUENCY
DSP reach and frequency metrics.
Key: `(client_id, platform, marketplace, order_id, date)`

### RAW.AD_ATTRIBUTION
Amazon Attribution — off-Amazon traffic driving Amazon sales.
Key: `(client_id, platform, marketplace, campaign_id, date)`

### RAW.AD_BRAND_METRICS
Search Frequency Rank, click share, conversion share.
Key: `(client_id, marketplace, search_term, date)`

### RAW.AD_CAMPAIGN_CONFIG
Current campaign configuration snapshot (not performance).
Key: `(client_id, platform, marketplace, campaign_id, synced_at)`

### RAW.AD_KEYWORD_CONFIG
Current keyword bid and status snapshot.
Key: `(client_id, platform, marketplace, keyword_id, synced_at)`

### RAW.AD_PORTFOLIO
Portfolio budget and date configuration.
Key: `(client_id, platform, marketplace, portfolio_id, synced_at)`

### RAW.AD_CREATIVE
Ad creative metadata.
Key: `(client_id, platform, marketplace, ad_id, synced_at)`

### RAW.RETAIL_ORDER
All orders — FBA, FBM, Vendor.
Key: `(client_id, marketplace, order_id)`

### RAW.RETAIL_INVENTORY
All inventory types (FBA, FBM, Vendor, 3PL, in-transit).
Key: `(client_id, marketplace, asin, location_type, snapshot_date)`
`location_type`: `'fba' / 'fbm' / 'vendor_warehouse' / '3pl' / 'in_transit'`

### RAW.RETAIL_FORECAST
Replenishment recommendations and inventory planning.
Key: `(client_id, marketplace, asin, forecast_date)`

### RAW.RETAIL_LISTING
Product catalog and listing data.
Key: `(client_id, marketplace, asin)`

### RAW.RETAIL_SALES_TRAFFIC
Business report — sessions, CVR, BSR by ASIN.
Key: `(client_id, marketplace, asin, date)`

### RAW.RETAIL_SETTLEMENT
Financial settlement data.
Key: `(client_id, marketplace, settlement_id)`

### RAW.RETAIL_FEE
FBA fee estimates per ASIN.
Key: `(client_id, marketplace, asin, synced_at)`

---

## OPS Schema

### OPS.REPORT_QUEUE
Platform-agnostic async report job tracking (replaces SANDBOX.ads_report_queue).
```sql
report_id, client_id, platform, marketplace, profile_id,
report_type, report_date, status, retry_count,
requested_at, completed_at, records_written, error_message,
pipeline_run_id
```

### OPS.INGESTION_LOG
Every API call logged for observability and rate limit tracking.
```sql
log_id, client_id, platform, profile_id,
endpoint, method, response_status, response_time_ms,
was_throttled, quota_remaining, requested_at
```

### OPS.CHANGE_QUEUE
Write-back audit trail — all proposed changes to Amazon.
```sql
change_id, client_id, platform, marketplace, profile_id,
resource_type, resource_id, resource_name,
current_value, proposed_value, rollback_value,
change_reason, recommendation_id,
status,  -- 'pending_approval' / 'approved' / 'rejected' / 'submitted' / 'confirmed' / 'failed' / 'pending_rollback_approval' / 'rolled_back'
batch_id, api_version,
requested_by, approved_by,
requested_at, approved_at, submitted_at, confirmed_at,
amazon_request_id, error_message
```

### OPS.CHANGE_EVALUATION_SCHEDULE
Tracks evaluation horizons for every submitted change.
```sql
evaluation_id, change_id,
evaluation_horizon,  -- 'disaster' / 'early_signal' / 'outcome'
scheduled_at, evaluated_at,
result,  -- 'pass' / 'flag' / 'rollback_queued' / 'success'
metrics_snapshot VARIANT  -- JSON: {acos_before, acos_after, roas_before, roas_after}
```

### OPS.CAMPAIGN_BUILD_QUEUE
Campaign creation workflow.
```sql
build_id, client_id, platform, marketplace,
template_id, campaign_name,
asins VARIANT, keywords VARIANT,
daily_budget_usd, start_date,
ai_group_id,
status,  -- 'draft' / 'pending_approval' / 'submitted' / 'live' / 'failed'
created_by, approved_by,
submitted_at, amazon_campaign_id, error_message
```

---

## ANALYTICS Schema

### ANALYTICS.CLIENT_ATTRIBUTION_PROFILE
Dynamic per-client attribution window analysis. Recalculated monthly from last 90 days of final-maturity data.
```sql
client_id, marketplace, measured_at, measurement_period_days,
pct_purchases_1d, pct_purchases_7d, pct_purchases_14d,
recommended_window,          -- '1d' / '7d' / '14d' / '30d'
recommendation_confidence,   -- 'high' / 'medium' / 'low'
recommendation_reason,       -- human-readable explanation
manual_override_window,      -- NULL = use recommendation
override_set_by, override_set_at
```
Job: analyze_attribution_profile → monthly → Economist agent

### ANALYTICS.KEYWORD_IMPRESSION_TREND
```sql
client_id, platform, marketplace, keyword_id, date,
impressions, impressions_7d_avg, impressions_30d_avg,
impression_share, impression_share_lost_budget, impression_share_lost_rank,
absolute_reach_tier  -- 'high' (>10k/day) / 'medium' (1k-10k) / 'low' (<1k)
```

---

## CANONICAL Schema
_(unchanged from 002_canonical_model.sql — already built)_

ACCOUNTS, CHANNELS, CAMPAIGNS, AD_GROUPS, KEYWORD_TARGETS, PRODUCTS,
INVENTORY_SNAPSHOTS, CONTRIBUTION_MARGINS, OPPORTUNITY_SCORES,
RECOMMENDATION_LOG, RECOMMENDATION_OUTCOMES, ACCOUNT_OVERRIDES

---

## METRICS Schema
_(unchanged — OPPORTUNITY_SCORES already built)_

---

## PIPELINE Schema
_(unchanged — FRESHNESS, JOB_RUNS, QUALITY_LOG already built)_

---

## Ingestion Cadence

### API Lookback Windows (Amazon v3 — confirmed from official docs 2026-03-27)
```
Sponsored Products (SP):   95 days   groupBy: campaign, adGroup, campaignPlacement
Sponsored Brands (SB):     60 days   groupBy: campaign
Sponsored Display (SD):    65 days   groupBy: campaign, matchedTarget
Sponsored Television (ST): 95 days   groupBy: campaign, adGroup
DSP:                       95 days   groupBy: campaign, ad, creative
Max date range per request: 31 days (all types)
timeUnit: SUMMARY or DAILY (all types)
format: GZIP_JSON (all types; DSP also supports CSV)
```

### Data retention by ad type (all report types within each platform)
```
SP (spCampaigns, spAdGroups, spTargeting, spSearchTerm, spAdvertisedProduct,
    spCampaignPlacement, spPurchasedProduct, spGrossAndInvalids):  95 days
SB (sbCampaigns, sbTargeting, sbSearchTerms, sbPlacements,
    sbGrossAndInvalids):                                            60 days
SD (sdCampaigns, sdAdGroups, sdTargeting, sdAdvertisedProduct,
    sdGrossAndInvalids):                                            65 days
ST (stCampaigns, stAdGroups, stTargeting):                         95 days
DSP (dspCampaign all groupBys):                                    95 days
Audience reports (spAudiences, sbAudiences, dspAudience):          95 days (all)
```

### Initial backfill at Project GO execution
```
SP reports:        request 95 days from execution date
SB reports:        request 60 days from execution date  ← shortest window, most urgent
SD reports:        request 65 days from execution date
ST reports:        request 95 days (if client has ST)
DSP reports:       request 95 days from execution date
Audience reports:  request 95 days from execution date
```
⚠️ SB is shortest at 60 days. Every day without prod credentials = 1 day of SB history permanently lost.

### Tiered ingestion — all ads reports (ongoing after backfill)
```
Quad-daily: startDate = D-0, endDate = D-3  (4-day rolling window, every 6 hours)
            → D-0 = today's partial data (spend/impressions live, conversions accumulating)
            → D-1 to D-3 = catches impression/click revisions from invalid traffic filtering
            → data_maturity = 'preliminary' on write for D-1 to D-3
            → D-0 data shown as-is; day is clearly in-progress, no flag needed
            → runs at 00:00, 06:00, 12:00, 18:00 UTC

Weekly:     startDate = D-32, endDate = D-1 (full 30-day settlement, every Sunday)
            → fully settles all attribution windows including purchases30d / sales30d
            → data_maturity updated to 'settled' or 'final' accordingly
```

### data_maturity states
```
'preliminary'  → < 3 days old, impressions/clicks may still be revised
'settled'      → 3–30 days old, weekly sweep has run, attribution accumulating
'final'        → > 30 days old, weekly sweep has run, all metrics fully settled
```

### New client onboarding — immediate data trigger
When a client connects and completes OAuth:
1. Immediately submit full backfill report requests (all ad types, full lookback windows)
2. `poll_report_queue` picks up results on its normal cycle
3. Once all backfill reports land in RAW, trigger `build_canonical_models` → `compute_core_kpis` → `score_opportunities` immediately (event-driven, not waiting for next scheduled run)
4. Client sees data in dashboard as soon as the pipeline completes — typically within 30–60 min of connecting
This is event-driven. No special cron job — the onboarding flow fires the pipeline directly.

### Primary metric for opportunity scoring
Attribution window is dynamic per client — determined by ANALYTICS.CLIENT_ATTRIBUTION_PROFILE.
Global default for new clients: purchases14d / sales14d.
Window selection logic:
  pct_purchases_7d >= 85%  → use purchases7d   (fast converters)
  pct_purchases_14d >= 85% → use purchases14d  (typical)
  pct_purchases_14d < 70%  → use purchases30d  (slow converters / B2B)
  else                     → purchases14d      (default)
Window changes require human confirmation before applying to scorer.
Every METRICS.OPPORTUNITY_SCORES row records attribution_window_used.
purchases1d used for anomaly detection only (spike/zero signals), never scoring.

### Standard columns on every RAW performance table
```sql
data_maturity       VARCHAR DEFAULT 'preliminary'
last_refreshed_at   TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP
```
Updated on every MERGE by the pipeline.

---

## Credentials & Security

- App credentials (LWA_CLIENT_ID, LWA_CLIENT_SECRET, SP_API_CLIENT_ID, etc.) → `.env` only, never in DB
- Per-client refresh tokens → `APP.CLIENT_CREDENTIALS.credential_value` encrypted with AES-256
- Encryption key → `ENCRYPTION_KEY` in `.env`
- No client IDs hardcoded anywhere in application code or cron jobs

---

## Client Lifecycle

```
onboarding → active → grace_period → suspended → churned
                ↓
              paused → active
```

- Jobs only process `status = 'active'` clients
- `grace_period`: payment failed, collecting continues, dashboard restricted after 7 days
- `suspended`: 60 days unpaid — no dashboard, data collection stops
- `churned`: data retained 2 years, then anonymized/deleted

---

## Cron Model

One cron per job type. Each iterates `APP.CLIENTS WHERE status = 'active'`. No client IDs in cron payloads.

| Job | Schedule | Owner agent |
|---|---|---|
| check_connector_health | every 5min | Connector |
| poll_report_queue | every 5min | Reporter |
| submit_amazon_reports | every 30min | Reporter |
| ingest_retail | every 30min | Connector |
| refresh_queue_status | every 15min | Control |
| stage_raw_data | hourly | Pipeline |
| run_quality_checks | hourly | Pipeline |
| compute_freshness | hourly | Pipeline |
| build_canonical_models | every 6h (00:30, 06:30, 12:30, 18:30 UTC) | Pipeline |
| compute_core_kpis | every 6h (01:00, 07:00, 13:00, 19:00 UTC) | Economist |
| score_opportunities | every 6h (01:30, 07:30, 13:30, 19:30 UTC) | Economist |
| run_dayparting_scheduler | daily 12:01am | Control |
| run_dayparting_reversion | daily 11:55pm | Control |
| generate_operator_summary | daily 05:00 UTC | Analyst |
| generate_exec_summary | weekly Mon 06:00 UTC | Analyst |
| deep_reconciliation | weekly Sun 01:00 UTC | Pipeline |
| credential_audit | monthly 1st 09:00 UTC | Control |

Notes:
- `submit_amazon_reports` slowed to 30min — report requests are batched per 6h ingestion cycle, not continuous
- `build_canonical_models` → `compute_core_kpis` → `score_opportunities` staggered by 30min each to ensure upstream completes before downstream starts
- On new client connect: pipeline triggered immediately (event-driven), independent of the above schedule
- Dashboard freshness target: ≤ 6 hours for all active clients

---

## Write-Back Rules Hierarchy

Evaluated in order. Any FAIL stops the change.

1. Global floor/ceiling guardrails (APP.CONFIG) — hard limits
2. Client-specific guardrails (APP.CLIENT_CONFIG) — stricter only
3. Account overrides (CANONICAL.ACCOUNT_OVERRIDES) — blacklists, floors
4. AI enrollment check (APP.CLIENT_AI_ENROLLMENT) — must be enrolled
5. Dayparting rules (APP.CLIENT_DAYPARTING) — day/hour suppression
6. Opportunity score threshold — minimum score to act
7. Approval mode — manual / auto_within_rules / disabled

**Never delete keywords — only pause.**
**Rollback requires human approval before execution.**

---

## Evaluation Horizons (post change-submission)

| Aggressiveness | Disaster check | Early signal | Outcome eval |
|---|---|---|---|
| conservative | 48h | 14d | 30d |
| moderate | 24h | 7d | 14d |
| aggressive | 12h | 3d | 7d |

---

## Data Retention

| Data | Retention |
|---|---|
| RAW.* | 3 years |
| OPS.REPORT_QUEUE | 1 year |
| OPS.INGESTION_LOG | 6 months |
| CANONICAL.* | Indefinite |
| METRICS.* | Indefinite |
| OPS.CHANGE_QUEUE | Indefinite |
| Churned client data | 2 years post-churn |

---

## Post-Launch Features (not in v1 build)

- PDF export
- Hour-level dayparting (requires Amazon Marketing Stream)
- White-label custom domains
- Creative fatigue signal in scalability factor
- Audience fatigue signal
- Automated rollback (human approval always required in v1)
- Per-client model calibration

---

## Outstanding Before Execution

- [ ] Column review — all 25 report types, confirm exact v3 columns for REPORT_TYPE_REGISTRY
- [ ] Production database name decision
- [ ] Amazon v3 API credentials for prod app (LWA client ID/secret)
- [ ] Encryption key generation for credential storage

---
_Last updated: 2026-03-26 by Ash. Execute when Abe says "execute Project GO"._
