-- Latest inventory snapshot per ASIN per client
{{ config(materialized='table') }}

SELECT
  client_id,
  asin,
  MAX(end_date)                       AS snapshot_date,
  MAX(sellable_on_hand_units)         AS sellable_units,
  MAX(unsellable_on_hand_units)       AS unsellable_units,
  MAX(open_purchase_order_units)      AS open_po_units,
  MAX(aged_90_plus_units)             AS aged_90_plus_units,
  MAX(avg_vendor_lead_time_days)      AS avg_lead_time_days,
  MAX(sell_through_rate)              AS sell_through_rate
FROM CALBRIDGE_PROD.APP.vendor_inventory
GROUP BY client_id, asin
