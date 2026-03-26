# Calbridge Platform Architecture
_Documented 2026-03-26. Source: Abe's architectural direction._

---

## Cron Job Strategy

**Philosophy:** Use cron mostly to trigger workflows, not to execute business logic directly.

### Every 5 Minutes
- `check_connector_health` — connector health check, token expiry
- `poll_report_status` — poll async Amazon report jobs
- `retry_transient_failures` — retry transient failed jobs
- `portal_uptime_monitor` — portal health check

### Every 15 Minutes
- `submit_amazon_reports` — ingest newly available Amazon Ads data
- `download_completed_reports` — ingest newly completed retail/report exports
- `refresh_queue_status` — refresh queue status tables
- `sync_job_metadata` — sync job metadata into operational dashboard

### Hourly
- `stage_raw_data` — normalize raw data into staging
- `run_quality_checks` — lightweight data quality tests
- `compute_freshness` — freshness/status summaries
- `reconcile_missing_partitions` — reconcile missing date partitions

### Daily (Early Morning)
- `build_canonical_models` — prior-day canonical model builds
- `compute_core_kpis` — KPIs by account / brand / campaign / ASIN
- `detect_anomalies` — detect anomalies and material changes
- `generate_operator_summary` — daily summary for operators

### Daily (After Models Complete)
- `score_opportunities` — recommendation engine:
  - underfunded opportunities
  - overspent campaigns
  - ASINs constrained by inventory
  - places where next dollar has highest expected marginal return

### Weekly
- `deep_reconciliation` — reconcile + backfill missed windows
- `regenerate_benchmarks` — trailing 8–12 week benchmarks
- `generate_exec_summary` — produce executive summary
- `archive_old_payloads` — archive old raw payloads/logs

### Monthly
- `credential_audit` — verify all API credentials still valid
- `cost_performance_audit` — audit pipeline costs and performance
- `warehouse_cleanup` — table maintenance, stale data
- `evaluate_report_coverage` — assess coverage and unused jobs

---

## Canonical Job Types

```
check_connector_health
submit_amazon_reports
poll_report_status
download_completed_reports
stage_raw_data
build_canonical_models
run_quality_checks
score_opportunities
generate_exec_summary
reconcile_missing_data
backfill_date_range
```

---

## Canonical Data Model

**Do this early. Do not tie downstream logic to Amazon naming.**

Internal entities:
- `account` — client/advertiser account
- `channel` — SP / SB / SD / DSP / retail
- `campaign` — internal campaign record (normalized from any source)
- `ad_group` — ad group / line item
- `keyword_target` — keyword or targeting expression
- `product` — ASIN / SKU (with brand, category, price metadata)
- `order` — retail order
- `inventory_snapshot` — FBA inventory by ASIN/date
- `contribution_margin_record` — CM per ASIN per period
- `opportunity_score` — scored recommendation per ASIN/campaign

This makes adding Walmart, Shopify, Meta, Google Ads a mapping exercise, not a rewrite.

---

## Job Idempotency

**Every job must be safe to rerun without duplicating data or corrupting state.**

Pattern:
- Use `(report_id, account_id, date)` composite keys
- MERGE not INSERT
- Track `pipeline_run_id` on every row
- Detect and skip already-processed windows

---

## Freshness & Completeness Metadata

For every dashboard tile and recommendation, surface:
- `last_successful_sync_time`
- `data_coverage_window`
- `expected_latency`
- `confidence_score` / `completeness_pct`

Users won't trust recommendations without knowing the data is current.
Stored in: `PIPELINE.FRESHNESS` (already created)

---

## Backfill Strategy

Clean API for targeted reprocessing:

```
backfill_date_range(account_id, report_type, start_date, end_date)
rebuild_account(account_id, days=90)
reprocess_report_type(report_type, start_date, end_date)
repair_missing_partitions(account_id)
```

---

## Source-of-Truth Hierarchy

**Decide this now. When sources disagree:**

1. Amazon Ads API > derived calculations (for spend, impressions, clicks)
2. SP-API retail data > Ads-attributed sales (for actual order revenue)
3. Client-supplied COGS > estimated COGS (for margin calculations)
4. Snowflake canonical tables > raw staging (for all reporting)
5. When Ads and Retail disagree on attributed sales → use Retail as ground truth for revenue, Ads for spend

Document any exceptions explicitly in `src/config/metrics.js`.

---

## Metric Versioning

All metrics in `src/config/metrics.js` are versioned (`version`, `definedAt`, `confirmedAt`).

**Rule:** Changing a metric formula = new version, not silent overwrite.
**Why:** Recommendations must be explainable over time. "Why did the model recommend X?" requires knowing which formula version ran.

Store metric version alongside every `opportunity_score` row.

---

## Human Override Layer

Recommendation engine must support:

```js
overrides: {
  min_spend: { campaign_id: 'X', floor: 500 },        // never cut below $500
  priority_skus: ['B0123', 'B0456'],                   // always prioritize launch SKUs
  ignore_low_inventory: true,                           // skip ASINs with < 14 days supply
  payback_target_days: 45,                              // reject recs with payback > 45d
  blacklist_campaigns: ['C001'],                        // never touch these
}
```

Store overrides in Snowflake: `account_overrides` table.
Apply before scoring, document in recommendation output.

---

## Observability

Track in `PIPELINE.OBSERVABILITY` (or equivalent):

| Metric | Description |
|--------|-------------|
| `report_request_count` | Requests submitted per account/type |
| `success_rate` | % completed without error |
| `api_quota_usage` | Amazon rate limit consumption |
| `avg_lag_by_source` | Average time from report request → write |
| `stale_jobs` | Jobs not updated in > expected window |
| `missing_partitions` | Date gaps in canonical tables |
| `recommendation_run_duration` | Time to score all opportunities |

---

## Permissions & Tenant Isolation

Design now, even before multi-tenant launch:

- **Org-level separation:** every Snowflake row tagged with `client_id`
- **User roles:** viewer / analyst / admin per client
- **Action audit log:** who ran what, when, with what result
- **Recommendation approval:** track who approved or overrode a recommendation
- **Data isolation:** no cross-client queries ever — enforce at query builder level

---

## Recommendation Feedback Loop

The platform's long-term moat. Not just:
> "Where should the next dollar go?"

But also:
> "What happened after the last recommendation? Was it correct?"

Required infrastructure:
- `recommendation_log` — every recommendation issued, with formula version + inputs
- `recommendation_outcome` — actual result N days after recommendation
- `prediction_accuracy` — predicted mROAS vs realized mROAS
- Model retraining signal — when realized diverges from predicted, flag for review

**This is where the platform gets smarter over time.**

---

## Agent Ownership Map

| Domain | Agent | Key Tables |
|--------|-------|-----------|
| API auth, transport, health | Connector 🔌 | `connector_tokens`, `connector_health` |
| Report specs, polling | Reporter 📋 | `ads_report_queue`, `src/config/reportTypes.js` |
| Raw → canonical transforms | Pipeline 🏗️ | `RAW_*`, `ANALYTICS_*`, `PIPELINE.*` |
| Metric definitions, scoring | Economist 💹 | `METRICS_*`, `src/config/metrics.js`, `src/config/fbaFees.js` |
| Job orchestration, SLAs | Control 🎛️ | `PIPELINE.JOB_RUNS`, `docs/runbooks/` |
| Narrative, summaries | Analyst 🧠 | `ANALYTICS_SUMMARIES`, `src/routes/recommendations.js` |
| Portal app, UI, auth | Dashboard 📊 | All of `/src`, all of `/public` |
| Personal assistant | Ash ⚡ | Strategy, research, coordination |
