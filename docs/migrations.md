
## 2026-04-03 — vendor_purchase_orders migration to CALBRIDGE_PROD.APP

Created CALBRIDGE_PROD.APP.VENDOR_PURCHASE_ORDERS and migrated 4,608 rows from CALBRIDGE.SANDBOX.VENDOR_PURCHASE_ORDERS.

Root cause: dashboard routes and spIngestion.js use unqualified table names (no schema prefix). 
With SNOWFLAKE_DATABASE=CALBRIDGE_PROD and SNOWFLAKE_SCHEMA=APP, the table needs to exist in APP schema.
The sandbox had the data; prod did not.

Fixed by: CREATE TABLE + INSERT INTO ... SELECT FROM sandbox.
