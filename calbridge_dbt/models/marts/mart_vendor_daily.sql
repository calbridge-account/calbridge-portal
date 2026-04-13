-- Pre-aggregated daily vendor sales per client
{{ config(materialized='incremental', unique_key=['client_id', 'start_date']) }}

SELECT
  client_id,
  start_date,
  COUNT(DISTINCT asin)    AS asin_count,
  SUM(ordered_units)      AS ordered_units,
  SUM(ordered_revenue)    AS ordered_revenue,
  SUM(shipped_units)      AS shipped_units,
  SUM(shipped_revenue)    AS shipped_revenue,
  SUM(shipped_cogs)       AS shipped_cogs,
  SUM(customer_returns)   AS customer_returns,
  CASE WHEN SUM(shipped_revenue) > 0
    THEN (SUM(shipped_revenue) - SUM(shipped_cogs)) / SUM(shipped_revenue)
    ELSE NULL END AS gross_margin_pct
FROM CALBRIDGE_PROD.APP.vendor_sales
{% if is_incremental() %}
  WHERE start_date >= (SELECT MAX(start_date) - 7 FROM {{ this }})
{% endif %}
GROUP BY client_id, start_date
