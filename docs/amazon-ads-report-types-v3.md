# Amazon Ads API v3 — Official Report Types
# Source: advertising.amazon.com/API/docs/en-us/reporting/v3/report-types
# Date: 2026-03-25

## Availability Matrix

| Report Type        | SP | SB | SD | ST | DSP | ALL |
|--------------------|----|----|----|----|-----|-----|
| Ad                 | ✓  |    |    |    |     |     |
| Ad group           | ✓  | ✓  |    |    |     |     |
| Advertised product | ✓  | ✓  |    |    |     |     |
| Audience           |    |    | ✓  |    |     |     |
| Audio/video (beta) |    |    |    | ✓  |     |     |
| Benchmarks (beta)  |    | ✓  |    |    |     |     |
| Bid adjustments    | ✓  |    |    |    |     |     |
| Brand suitability  |    |    |    |    | ✓   |     |
| Campaign           | ✓  | ✓  | ✓  | ✓  | ✓   |     |
| Conversion Path    |    |    |    |    |     | ✓   |
| Geo                |    |    |    |    | ✓   |     |
| Gross/invalid traf | ✓  | ✓  | ✓  |    |     |     |
| Inventory          |    |    |    |    | ✓   |     |
| Placement          | ✓  |    |    |    |     |     |
| Prompt Ad Ext      | ✓  |    |    |    |     |     |
| Product            |    |    |    | ✓  |     |     |
| Purchased product  | ✓  | ✓  | ✓  |    |     |     |
| Reach & frequency  |    |    |    |    | ✓   |     |
| Search term        | ✓  | ✓  |    |    |     |     |
| Targeting          | ✓  | ✓  | ✓  | ✓  |     |     |
| Tech               |    |    |    |    | ✓   |     |

## v3 reportTypeId mapping (inferred from Fivetran schema + API)

### Sponsored Products (SP)
- spCampaigns          → Campaign
- spAdGroup            → Ad group  
- spAdvertisedProduct  → Advertised product
- spTargeting          → Targeting
- spSearchTerm         → Search term
- spAd                 → Ad
- spCampaignPlacement  → Placement (was: CAMPAIGN_PLACEMENT_REPORT)
- spPurchasedProduct   → Purchased product (was: PURCHASED_PRODUCT_KEYWORD_REPORT)

### Sponsored Brands (SB)
- sbCampaigns          → Campaign
- sbAdGroup            → Ad group
- sbAdvertisedProduct  → Advertised product
- sbKeyword (legacy v2 only — use sbTargeting in v3)
- sbSearchTerm         → Search term
- sbTargeting          → Targeting
- sbPurchasedProduct   → Purchased product (was: SB_PURCHASED_PRODUCT)
- sbBenchmarks         → Benchmarks (beta)

### Sponsored Display (SD)
- sdCampaigns          → Campaign
- sdAdGroup            → Ad group (was: SD_AD_GROUP_REPORT)
- sdTargeting          → Targeting (was: SD_TARGET_REPORT)
- sdPurchasedProduct   → Purchased product (was: SD_PURCHASED_PRODUCTS_REPORTS)
- sdAudience           → Audience (NEW — not in legacy schema)

### Sponsored TV (ST) — NEW, not in legacy Fivetran schema
- stCampaigns
- stProduct
- stTargeting

### DSP — separate API entirely
- Not covered by SP-API / Ads API v3 reporting
- Requires separate DSP API

## Notes
- SB reports in v3 are PREVIEW — only campaigns with isMultiAdGroupsEnabled=True
- ALL report type (Conversion Path) is cross-channel
- Gross/Invalid Traffic available for SP, SB, SD — not in Fivetran schema (new)
- Sponsored TV is entirely new — not in legacy schema
