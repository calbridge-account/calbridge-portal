-- Pre-aggregated daily advertising metrics per client
-- Replaces the hot path in /advertising/summary
{{ config(materialized='incremental', unique_key=['client_id', 'date', 'ad_type', 'marketplace']) }}

SELECT
  client_id,
  date,
  ad_type,
  COALESCE(marketplace, 'US') AS marketplace,
  COUNT(DISTINCT campaign_id)     AS active_campaigns,
  SUM(adjusted_spend)             AS spend,
  SUM(sales)                      AS sales,
  SUM(orders)                     AS orders,
  SUM(clicks)                     AS clicks,
  SUM(impressions)                AS impressions,
  CASE WHEN SUM(sales) > 0 THEN SUM(adjusted_spend) / SUM(sales) ELSE NULL END AS acos,
  CASE WHEN SUM(adjusted_spend) > 0 THEN SUM(sales) / SUM(adjusted_spend) ELSE NULL END AS roas,
  CASE WHEN SUM(impressions) > 0 THEN SUM(clicks) / SUM(impressions) ELSE NULL END AS ctr
FROM CALBRIDGE_PROD.APP.adjusted_campaign_performance
{% if is_incremental() %}
  WHERE date >= (SELECT MAX(date) - 3 FROM {{ this }})  -- reprocess last 3 days for settlement
{% endif %}
GROUP BY client_id, date, ad_type, COALESCE(marketplace, 'US')
