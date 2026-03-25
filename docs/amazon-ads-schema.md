# Amazon Ads Schema — Legacy Snowflake Reference
# Source: ATCURRYMEDIA_DWH_DB.AMAZON_ADS (via Fivetran)
# Date: 2026-03-25

## Summary: 97 tables across 4 categories

## REPORTING TABLES (time-series, daily grain — what we need for dashboards)

### Sponsored Products (SP)
| Table | Key | Rows |
|-------|-----|------|
| CAMPAIGN_LEVEL_REPORT | campaign_id + date | 88,267 |
| AD_GROUP_LEVEL_REPORT | ad_group_id + date | 15,102 |
| TARGETING_KEYWORD_REPORT | campaign_id + ad_group_id + keyword_id + date | 204,891 |
| TARGETING_REPORT | campaign_id + ad_group_id + keyword_id + date | 43,384 |
| SEARCH_TERM_AD_KEYWORD_REPORT | campaign_id + ad_group_id + keyword_id + search_term + date | 272,743 |
| SEARCH_TERM_TARGETING_REPORT | campaign_id + ad_group_id + keyword_id + search_term + date | 130,417 |
| ADVERTISED_PRODUCT_REPORT | campaign_id + ad_group_id + ad_id + date | 16,433 |
| CAMPAIGN_PLACEMENT_REPORT | campaign_id + placement + date | 43,694 |
| PURCHASED_PRODUCT_KEYWORD_REPORT | campaign_id + ad_group_id + keyword_id + purchased_asin + date | 10,543 |
| PURCHASED_PRODUCT_TARGETING_REPORT | campaign_id + ad_group_id + keyword_id + purchased_asin + date | 4,957 |

### Sponsored Brands (SB)
| Table | Key | Rows |
|-------|-----|------|
| SB_CAMPAIGN_REPORT | campaign_id + report_date | 4,674 |
| SB_AD_GROUP_REPORT | ad_group_id + report_date | 1,103 |
| SB_KEYWORD_REPORT | keyword_id + report_date | 52,703 |
| SB_SEARCH_TERM_REPORT | keyword_id + query_term + report_date | 64,780 |
| SB_AD_REPORT | ad_id + report_date | 4,674 |
| SB_PLACEMENT_REPORT | campaign_id + placement + report_date | 2,493 |
| SB_TARGET_REPORT | target_id + report_date | 1,222 |
| SB_PURCHASED_PRODUCT | date + purchased_asin (+ campaign/ad_group) | 4,487 |
| SB_BENCHMARK_BRAND_AND_CATEGORY | brand + category_id + start/end | 1,193 |
| SB_BUDGET_USAGE_HISTORY | campaign_id + usage_updated_timestamp | 24,308 |

### Sponsored Display (SD)
| Table | Key | Rows |
|-------|-----|------|
| SD_CAMPAIGN_REPORT | campaign_id + date | 1,820 |
| SD_AD_GROUP_REPORT | ad_group_id + date | 1,829 |
| SD_TARGET_REPORT | ad_group_id + campaign_id + targeting_id + date | 2,218 |
| SD_PRODUCT_AD_REPORT | ad_id + date | 1,844 |
| SD_MATCHED_TARGET_REPORT | ad_group_id + campaign_id + matched_target_asin + targeting_id + date | 8,132 |
| SD_PURCHASED_PRODUCTS_REPORTS | ad_group_id + campaign_id + asin_brand_halo + promoted_asin + promoted_sku + date | 1,863 |
| SD_BUDGET_USAGE_HISTORY | campaign_id + usage_updated_timestamp | 2,755 |

## HISTORY TABLES (entity state over time — for campaign/keyword management)

| Table | Rows |
|-------|------|
| CAMPAIGN_HISTORY | 3,538 |
| AD_GROUP_HISTORY | 2,475 |
| KEYWORD_HISTORY | 255,118 |
| NEGATIVE_KEYWORD_HISTORY | 11,215 |
| PRODUCT_AD_HISTORY | 3,316 |
| PORTFOLIO_HISTORY | 567 |
| CAMPAIGN_NEGATIVE_KEYWORD_HISTORY | 148 |
| TARGETING_CLAUSE_HISTORY | 5,064 |
| NEGATIVE_TARGETING_CLAUSE_HISTORY | 2,673 |
| SB_CAMPAIGN_HISTORY | 798 |
| SB_AD_GROUP_HISTORY | 687 |
| SB_AD_HISTORY | 939 |
| SB_KEYWORD (current state) | 82,679 |
| SB_NEGATIVE_KEYWORD | 3,583 |
| SB_CREATIVE_HISTORY | 937 |
| SD_CAMPAIGN_HISTORY | 107 |
| SD_AD_GROUP_HISTORY | 64 |
| SD_TARGETING_HISTORY | 909 |
| SD_NEGATIVE_TARGETING_HISTORY | 1 |
| SD_PRODUCT_AD_HISTORY | 323 |

## KEY COLUMNS FOR CALBRIDGE

### SP Campaign Level Report columns (most important for CM)
- campaign_id, date
- impressions, clicks, cost, cost_per_click, click_through_rate
- purchases_1_d/7_d/14_d/30_d
- purchases_same_sku_1_d/7_d/14_d/30_d
- units_sold_clicks_1_d/7_d/14_d/30_d
- sales_1_d/7_d/14_d/30_d
- attributed_sales_same_sku_1_d/7_d/14_d/30_d
- campaign_budget_amount, campaign_budget_type, campaign_budget_currency_code
- top_of_search_impression_share
- campaign_bidding_strategy

### SP Advertised Product Report (ASIN-level attribution — critical for CM)
- campaign_id + ad_group_id + ad_id + date + advertised_asin + advertised_sku
- All same purchase/sales/units metrics at ASIN level
- acos_clicks_7_d/14_d, roas_clicks_7_d/14_d

### Search Term Reports (keyword efficiency)
- search_term (what customer typed)
- keyword_id, targeting (keyword text)
- All purchase/sales metrics + acos/roas

### SB Key Columns (14d attribution window only)
- attributed_sales_14_d, attributed_conversions_14_d
- attributed_orders_new_to_brand_14_d, attributed_sales_new_to_brand_14_d
- attributed_units_ordered_new_to_brand_14_d
- search_term_impression_rank, search_term_impression_share

### SD Key Columns (click + view attribution)
- purchases, purchases_clicks, sales, sales_clicks
- new_to_brand_purchases, new_to_brand_sales, new_to_brand_units_sold
- detail_page_views, add_to_cart, branded_searches

## WHAT CALBRIDGE IS CURRENTLY MISSING vs THIS SCHEMA

1. **ADVERTISED_PRODUCT_REPORT** — ASIN-level SP performance (most critical for CM)
2. **SEARCH_TERM_AD_KEYWORD_REPORT** — what customers searched to trigger ads
3. **TARGETING_KEYWORD_REPORT** — keyword-level performance
4. **CAMPAIGN_PLACEMENT_REPORT** — top of search vs product pages vs rest of search
5. **SB reports** — full NTB, search term impression share, video metrics
6. **SD reports** — view-through attribution, detail page views, add to cart
7. **KEYWORD_HISTORY** — keyword state changes over time
8. **PORTFOLIO_HISTORY** — portfolio budget management
