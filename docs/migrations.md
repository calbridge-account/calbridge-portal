
## 2026-04-03 — vendor_purchase_orders migration to CALBRIDGE_PROD.APP

Created CALBRIDGE_PROD.APP.VENDOR_PURCHASE_ORDERS and migrated 4,608 rows from CALBRIDGE.SANDBOX.VENDOR_PURCHASE_ORDERS.

Root cause: dashboard routes and spIngestion.js use unqualified table names (no schema prefix). 
With SNOWFLAKE_DATABASE=CALBRIDGE_PROD and SNOWFLAKE_SCHEMA=APP, the table needs to exist in APP schema.
The sandbox had the data; prod did not.

Fixed by: CREATE TABLE + INSERT INTO ... SELECT FROM sandbox.

## 2026-04-03 — Full sandbox → CALBRIDGE_PROD.APP migration

All data migrated from CALBRIDGE.SANDBOX → CALBRIDGE_PROD.APP:
- VENDOR_FORECASTS: 16,320 rows ✅
- VENDOR_INVENTORY: 1,614 rows ✅  
- VENDOR_NET_PPM: 818 rows ✅
- VENDOR_SALES: 947 rows ✅
- VENDOR_TRAFFIC: 2,384 rows ✅
- VENDOR_PURCHASE_ORDERS: 4,608 rows ✅ (done 2026-04-03 earlier)
- DSP_CAMPAIGN_REPORT: 457 rows ✅ (519 sandbox rows, prod schema has 7 extra cols)

All write paths now resolve to CALBRIDGE_PROD.APP (SNOWFLAKE_DATABASE=CALBRIDGE_PROD, SNOWFLAKE_SCHEMA=APP).
Sandbox is read-only going forward — no automated jobs write there.

## Known gap: No automated vendor weekly report refresh
RETAIL_INVENTORY, RETAIL_FORECAST, RETAIL_SALES_TRAFFIC, RETAIL_TRAFFIC, RETAIL_NET_PPM 
in CALBRIDGE_PROD.RAW were loaded once manually on 2026-04-01 (null report_id/pipeline_run_id).
Latest data: week ending 2026-03-22 (inventory), 2026-03-29 (forecast generation date).
A vendorReportIngestion job needs to be built to pull these weekly via SP-API.
Report types needed: GET_VENDOR_INVENTORY_REPORT, GET_VENDOR_SALES_REPORT, 
GET_VENDOR_FORECASTING_REPORT, GET_VENDOR_TRAFFIC_REPORT, GET_VENDOR_NET_PURE_PRODUCT_MARGIN_REPORT
