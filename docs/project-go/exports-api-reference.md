# Amazon Ads Exports API Reference
_Source: https://advertising.amazon.com/API/docs/en-us/guides/exports_
_Saved 2026-03-26 for Project GO_

## Overview

Exports replace the legacy Snapshots functionality. They provide **campaign configuration metadata** (not performance data) at the time of request. Async pattern: request → poll → download (same as reports).

## Key Distinction

| | Reports | Exports |
|---|---|---|
| Contains | Performance data for a date range | Campaign structure metadata at time of request |
| Historical | Yes | No — current state only |
| Use case | Analytics, scoring | Config sync, write-back, campaign management |

## Throttling
- Queue-based: max 5 in-progress requests per endpoint per developer
- Endpoints are per entity type (campaigns, adGroups, targets, ads)

## Endpoint Pattern
```
POST /{entityType}/export         -- request export
GET  /exports/{exportId}          -- poll status
GET  download from url in response -- download when COMPLETED
```

## Content-Type Headers by Entity
```
campaigns:  application/vnd.campaignsexport.v1+json
adGroups:   application/vnd.adgroupsexport.v1+json
targets:    application/vnd.targetsexport.v1+json
ads:        application/vnd.adsexport.v1+json
```

## Export Availability by Ad Type
| Entity | SP | SB | SD |
|---|---|---|---|
| campaigns | ✅ | ✅ | ✅ |
| adGroups | ✅ | ✅ | ✅ |
| targets | ✅ | ✅ | ✅ |
| ads | ✅ | ✅ | ✅ |

## Request Body
```json
{
  "adProductFilter": "SPONSORED_PRODUCTS",  // required: SP, SB, SD, ST
  "stateFilter": "ENABLED,PAUSED"           // optional: ENABLED, PAUSED, ARCHIVED
}
```

## Response URL Expiry
- Download URL valid for 1 hour
- New URL generated on each GET /exports/{exportId} call
- Export available for download for 24 hours after completion

---

## Campaign Common Model Fields

### Core identifiers (always present)
```
campaignId              -- unique ID
adProduct               -- SPONSORED_PRODUCTS / SPONSORED_BRANDS / SPONSORED_DISPLAY
name                    -- advertiser-specified name
state                   -- ENABLED / PAUSED / ARCHIVED / OTHER
deliveryStatus          -- DELIVERING / NOT_DELIVERING / UNAVAILABLE
deliveryReasons         -- array of reason enums
creationDateTime
lastUpdatedDateTime
```

### Optional campaign fields
```
portfolioId             -- portfolio association
startDate / endDate
brandEntityId           -- required for SB campaigns (sellers)
targetingSettings       -- MANUAL / AUTO / T00020 / T00030
costType                -- CPC / VCPM
tags[]                  -- key/value pairs
```

### Budget
```
budgetCaps.recurrenceTimePeriod    -- DAILY / LIFETIME / OTHER
budgetCaps.budgetType              -- MONETARY
budgetCaps.budgetValue.monetaryBudget.currencyCode
budgetCaps.budgetValue.monetaryBudget.amount
budgetCaps.budgetValue.monetaryBudget.ruleAmount   -- when budget rule applied
```

### Optimization (bidding)
```
optimization.bidStrategy                           -- see bidStrategy enum
optimization.placementBidAdjustments[].placement   -- HOME_PAGE / TOP_OF_SEARCH / PRODUCT_PAGE / REST_OF_SEARCH
optimization.placementBidAdjustments[].percentage
optimization.shopperSegmentBidAdjustment[].shopperSegment
optimization.shopperSegmentBidAdjustment[].percentage
optimization.shopperCohortBidAdjustment[].shopperCohortType
optimization.shopperCohortBidAdjustment[].percentage
optimization.shopperCohortBidAdjustment[].audienceSegments[].audienceId
optimization.shopperCohortBidAdjustment[].audienceSegments[].audienceSegmentType
```

### Ad product field mapping differences
| Common field | SP | SB | SD |
|---|---|---|---|
| startDate | startDate | startDate | startDate |
| lastUpdatedDateTime | extendedData.lastUpdateDateTime | lastUpdatedDate | lastUpdatedDate |
| creationDateTime | extendedData.creationDateTime | extended.creationDateTime | extended.creationDateTime |
| bidStrategy | dynamicBidding.strategy | bidding.bidOptimizationStrategy | bidSetting.bidStrategy |
| placement | dynamicBidding.placementBidding | bidding.bidAdjustmentsByPlacement | bidSetting.placementBidAdjustment |
| budget amount | budget.budget | budget | budget |
| ruleAmount | budget.effectiveBudget | ruleBasedBudget.value | ruleBasedBudget.value |

---

## Ad Group Common Model Fields

```
adGroupId
campaignId
adProduct
name
state
deliveryStatus / deliveryReasons
creationDateTime / lastUpdatedDateTime
creativeType            -- IMAGE / VIDEO / PRODUCT_AD / PRODUCT_COLLECTION / STORE_SPOTLIGHT
bid.defaultBid
bid.currencyCode
optimization.goalSettings.goal    -- AWARENESS / CONSIDERATION / CONVERSIONS (SD only)
optimization.goalSettings.kpi     -- CLICKS
```

---

## Target Common Model Fields

```
targetId
adGroupId
campaignId              -- only for campaign-level targets
adProduct
state
negative                -- BOOLEAN: false=include, true=exclude
deliveryStatus / deliveryReasons
creationDateTime / lastUpdatedDateTime
bid.bid
bid.currencyCode
targetType              -- AUTO / KEYWORD / PRODUCT_CATEGORY / PRODUCT / PRODUCT_CATEGORY_AUDIENCE / PRODUCT_AUDIENCE / AUDIENCE / THEME
```

### targetDetails (varies by targetType)
```
matchType               -- see matchType enum
keyword                 -- keyword text
nativeLanguageKeyword   -- unlocalized keyword
nativeLanguageLocale    -- e.g. zh_CN
productCategoryId
productCategoryResolved -- human-readable category name
productBrand / productBrandResolved
productGenre / productGenreResolved
productPriceLessThan / productPriceGreaterThan
productRatingLessThan / productRatingGreaterThan
productAgeRange / productAgeRangeResolved
productPrimeShippingEligible
asin                    -- for PRODUCT targets
event                   -- VIEW / PURCHASE (for audience targets)
lookback                -- days lookback for audience targets
audienceId              -- for AUDIENCE targets
```

### Negative target handling
- `negative: false` = positive target (include)
- `negative: true` = negative target (exclude)
- Campaign-level negatives have `campaignId` set, `adGroupId` null
- Ad group-level negatives have both set

---

## Ad Common Model Fields

```
adId
adGroupId
adProduct
state
name
adType              -- PRODUCT_AD / IMAGE / VIDEO / PRODUCT_COLLECTION / STORE_SPOTLIGHT
deliveryStatus / deliveryReasons
creationDateTime / lastUpdatedDateTime
adVersionId         -- version of the creative
```

### creative object
```
creative.products[].productIdType    -- ASIN / SKU
creative.products[].productId
creative.headline
creative.brandName
creative.brandLogo.assetId / assetVersion
creative.brandLogo.formatProperties.top/left/width/height
creative.customImages[].assetId / assetVersion
creative.customImages[].formatProperties.top/left/width/height
creative.videos[].assetId / assetVersion
creative.landingPage.landingPageType   -- PRODUCT_LIST / STORE / CUSTOM_URL / DETAIL_PAGE / OFF_AMAZON_LINK
creative.landingPage.landingPageUrl
creative.cards[].headline
creative.cards[].landingPage.landingPageType / landingPageUrl
creative.cards[].product.productIdType / productId
```

---

## Key Enums

### bidStrategy
| Common | SP (dynamicBidding) | SB (bidOptimizationStrategy) |
|---|---|---|
| SALES_DOWN_ONLY | LEGACY_FOR_SALES | — |
| SALES | AUTO_FOR_SALES | MAXIMIZE_IMMEDIATE_SALES |
| NEW_TO_BRAND | — | MAXIMIZE_NEW_TO_BRAND_CUSTOMERS |
| RULE_BASED | RULE_BASED | — |

### matchType (keyword)
- BROAD, PHRASE, EXACT

### matchType (product target)
- PRODUCT_EXACT, PRODUCT_SIMILAR

### matchType (auto)
- SEARCH_LOOSE_MATCH, SEARCH_CLOSE_MATCH, PRODUCT_SUBSTITUTES, PRODUCT_COMPLEMENTS
- SEARCH_RELATED_TO_YOUR_BRAND, SEARCH_RELATED_TO_YOUR_LANDING_PAGES

### placement
- HOME_PAGE, TOP_OF_SEARCH, PRODUCT_PAGE, REST_OF_SEARCH

### deliveryReasons (key ones)
- CAMPAIGN_PAUSED, CAMPAIGN_OUT_OF_BUDGET, PORTFOLIO_OUT_OF_BUDGET
- AD_GROUP_LOW_BID, TARGET_PAUSED, TARGET_ARCHIVED
- AD_PAUSED, NOT_IN_BUYBOX, OUT_OF_STOCK, NOT_BUYABLE

---

## Project GO Integration Notes

### Which tables the Exports API populates
```
RAW.AD_CAMPAIGN_CONFIG  ← campaigns/export (SP + SB + SD, run 1-2x/day)
RAW.AD_GROUP_CONFIG     ← adGroups/export (SP + SB + SD, run 1-2x/day)
RAW.AD_KEYWORD_CONFIG   ← targets/export with targetType=KEYWORD (run 1-2x/day)
RAW.AD_NEGATIVE_KEYWORD ← targets/export where negative=true and targetType=KEYWORD
RAW.AD_NEGATIVE_TARGET  ← targets/export where negative=true and targetType=PRODUCT/PRODUCT_CATEGORY
RAW.AD_CREATIVE         ← ads/export (SP + SB + SD, run 1-2x/day)
```

### Scheduler recommendation
- Run exports 1-2x per day (Amazon recommendation: not for real-time data)
- Suggested: 2am and 2pm UTC
- Stagger by ad product to stay within 5-job throttle limit

### Write-back dependency
All bid/budget change submissions require current config from these exports.
Before submitting any change: verify config is fresh (< 6 hours old) from RAW.AD_CAMPAIGN_CONFIG.

### negative field handling
The `negative` boolean on targets maps cleanly to our table split:
- `negative: false` → RAW.AD_KEYWORD_TARGET or RAW.AD_ADVERTISED_PRODUCT (positive)
- `negative: true` → RAW.AD_NEGATIVE_KEYWORD or RAW.AD_NEGATIVE_TARGET
This eliminates ambiguity — no need to check a flag when querying.
