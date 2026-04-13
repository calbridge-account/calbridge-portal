-- Staging: clean + normalize adjusted_campaign_performance
SELECT
  client_id,
  profile_id,
  campaign_id,
  campaign_name,
  ad_type,
  date,
  spend,
  adjusted_spend,
  impressions,
  clicks,
  sales,
  orders,
  units_sold,
  CASE WHEN sales > 0 THEN adjusted_spend / sales ELSE NULL END AS acos,
  CASE WHEN adjusted_spend > 0 THEN sales / adjusted_spend ELSE NULL END AS roas,
  CASE WHEN impressions > 0 THEN clicks / impressions ELSE NULL END AS ctr,
  CASE WHEN clicks > 0 THEN adjusted_spend / clicks ELSE NULL END AS cpc
FROM CALBRIDGE_PROD.APP.adjusted_campaign_performance
