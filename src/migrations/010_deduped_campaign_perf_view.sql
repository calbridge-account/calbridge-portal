-- Migration 010: deduped_campaign_performance view
-- Wraps adjusted_campaign_performance and collapses duplicate DSP rows
-- caused by 64-bit order ID truncation (same order appearing under 2+ campaign_ids).
--
-- Root cause: Amazon DSP order IDs exceed Number.MAX_SAFE_INTEGER; JSON.parse()
-- truncates them differently across runs, creating multiple campaign_id values
-- for the same order in campaign_performance / adjusted_campaign_performance.
--
-- Fix: for DSP rows, deduplicate by (campaign_name, date) using MAX() on metrics.
-- For SP/SB/SD rows, campaign_id is stable — pass through unchanged.
-- The canonical campaign_id for DSP is set to campaign_name (stable, unique per order).
--
-- All queries should use deduped_campaign_performance in place of
-- adjusted_campaign_performance to avoid double-counting DSP spend/impressions.

CREATE OR REPLACE VIEW CALBRIDGE_PROD.APP.deduped_campaign_performance AS
SELECT
  client_id,
  -- For DSP: use campaign_name as the canonical identifier (stable, unique per order).
  -- For SP/SB/SD: keep the original campaign_id.
  CASE WHEN ad_type = 'DSP' THEN campaign_name ELSE campaign_id END AS campaign_id,
  campaign_name,
  profile_id,
  ad_type,
  COALESCE(marketplace, 'US')         AS marketplace,
  date,
  -- Campaign metadata: MAX picks any non-null value
  MAX(campaign_status)                AS campaign_status,
  MAX(campaign_budget_amount)         AS campaign_budget_amount,
  MAX(campaign_budget_currency_code)  AS campaign_budget_currency_code,
  MAX(order_budget)                   AS order_budget,
  MAX(order_start_date)               AS order_start_date,
  MAX(order_end_date)                 AS order_end_date,
  -- Spend: MAX collapses duplicates (same order, same metrics under 2 IDs)
  MAX(spend)                          AS spend,
  MAX(adjusted_spend)                 AS adjusted_spend,
  -- Performance metrics
  MAX(impressions)                    AS impressions,
  MAX(clicks)                         AS clicks,
  MAX(sales)                          AS sales,
  MAX(orders)                         AS orders,
  MAX(units_sold)                     AS units_sold,
  MAX(sales_7_d)                      AS sales_7_d,
  MAX(orders_7d)                      AS orders_7d,
  -- DSP-specific attribution
  MAX(total_purchases)                AS total_purchases,
  MAX(detail_page_views)              AS detail_page_views,
  MAX(add_to_cart)                    AS add_to_cart,
  MAX(viewable_impressions)           AS viewable_impressions,
  MAX(viewability_rate)               AS viewability_rate,
  MAX(video_ad_complete)              AS video_ad_complete,
  MAX(video_ad_start)                 AS video_ad_start,
  MAX(dpv_rate)                       AS dpv_rate,
  -- NTB (SB)
  MAX(new_to_brand_purchases)         AS new_to_brand_purchases,
  MAX(new_to_brand_sales)             AS new_to_brand_sales,
  MAX(new_to_brand_units_sold)        AS new_to_brand_units_sold,
  -- Other
  MAX(top_of_search_impression_share) AS top_of_search_impression_share,
  MAX(roas_direct)                    AS roas_direct
FROM CALBRIDGE_PROD.APP.adjusted_campaign_performance
GROUP BY
  client_id,
  CASE WHEN ad_type = 'DSP' THEN campaign_name ELSE campaign_id END,
  campaign_name,
  profile_id,
  ad_type,
  COALESCE(marketplace, 'US'),
  date;
