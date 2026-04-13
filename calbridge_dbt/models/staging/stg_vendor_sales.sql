SELECT
  client_id,
  asin,
  start_date,
  end_date,
  ordered_units,
  ordered_revenue,
  shipped_units,
  shipped_revenue,
  shipped_cogs,
  customer_returns,
  CASE WHEN shipped_revenue > 0 AND shipped_cogs > 0
    THEN (shipped_revenue - shipped_cogs) / shipped_revenue
    ELSE NULL END AS gross_margin_pct
FROM CALBRIDGE_PROD.APP.vendor_sales
