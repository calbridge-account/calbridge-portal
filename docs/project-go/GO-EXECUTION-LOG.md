# Project GO — Execution Log

**Executed:** 2026-03-31  
**Executed by:** Ash  
**Status:** ✅ COMPLETE

---

## Database

**CALBRIDGE_PROD** created and fully built.

---

## Schemas & Tables

| Schema | Tables | Description |
|--------|--------|-------------|
| APP | 16 | Operational — clients, credentials, config, enrollment, billing |
| RAW | 30 | Raw ingestion — ads (19) + retail/vendor (11) |
| OPS | 5 | Report queue, ingestion log, change queue, campaign builds |
| ANALYTICS | 2 | Attribution profiles, keyword impression trends |
| CANONICAL | 11 | Normalized entities, opportunity scores, recommendations |
| METRICS | 1 | Opportunity scores |
| PIPELINE | 3 | Job runs, freshness, quality log |
| **TOTAL** | **68** | |

---

## Seeded Data

### APP.CONFIG — 26 values
All default configuration values from spec including write-back guardrails, scoring weights, SLA thresholds, lookback windows.

### APP.REPORT_TYPE_REGISTRY — 27 report types

**Ads (20 active):**
- SP: spCampaigns, spAdGroups, spTargeting, spSearchTerm, spAdvertisedProduct, spPurchasedProduct, spCampaignPlacement, spGrossAndInvalids
- SB: sbCampaigns, sbTargeting, sbSearchTerms, sbPlacements, sbGrossAndInvalids
- SD: sdCampaigns, sdAdGroups, sdTargeting, sdAdvertisedProduct, sdGrossAndInvalids
- DSP: dspHierarchy, dspAudience

**Vendor Retail (7):**
- GET_VENDOR_SALES_REPORT → RAW.RETAIL_SALES_TRAFFIC
- GET_VENDOR_INVENTORY_REPORT → RAW.RETAIL_INVENTORY
- GET_VENDOR_TRAFFIC_REPORT → RAW.RETAIL_TRAFFIC
- GET_VENDOR_NET_PURE_PRODUCT_MARGIN_REPORT → RAW.RETAIL_NET_PPM
- GET_VENDOR_FORECASTING_REPORT → RAW.RETAIL_FORECAST
- GET_VENDOR_REAL_TIME_INVENTORY_REPORT → RAW.RETAIL_REAL_TIME_INVENTORY
- GET_VENDOR_REAL_TIME_SALES_REPORT → RAW.RETAIL_REAL_TIME_SALES

---

## Schema Additions vs Original Spec

- `RAW.RETAIL_SALES_TRAFFIC`: added `distributor_view`, `selling_program` columns (vendor data distinction)
- `RAW.RETAIL_INVENTORY`: added `distributor_view`, `selling_program` columns
- Added 7 new RAW tables for vendor retail data not in original spec: RETAIL_REAL_TIME_INVENTORY, RETAIL_REAL_TIME_SALES, RETAIL_TRAFFIC, RETAIL_NET_PPM (original spec had RETAIL_SALES_TRAFFIC, RETAIL_INVENTORY, RETAIL_FORECAST, RETAIL_LISTING, RETAIL_ORDER, RETAIL_FEE, RETAIL_SETTLEMENT)

---

## Next Steps (Phase 2)

1. Wire app Snowflake connection to CALBRIDGE_PROD
2. Backfill CyberPower historical data into RAW tables
3. Build new dashboards against CALBRIDGE_PROD canonical models
4. Migrate APP.CLIENTS / APP.USERS from sandbox
5. Re-auth CyberPower connections to pick up Product Listing role for catalog API

---

_Production database is live and ready for data ingestion._
