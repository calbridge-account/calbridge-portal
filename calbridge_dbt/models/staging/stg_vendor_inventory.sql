SELECT
  client_id,
  asin,
  end_date AS snapshot_date,
  sellable_on_hand_units,
  unsellable_on_hand_units,
  open_purchase_order_units,
  aged_90_plus_units,
  sell_through_rate,
  avg_vendor_lead_time_days,
  unfilled_customer_ordered_units
FROM CALBRIDGE_PROD.APP.vendor_inventory
-- Latest snapshot per ASIN only
QUALIFY ROW_NUMBER() OVER (PARTITION BY client_id, asin ORDER BY end_date DESC) = 1
