-- Migration 011: vendor_backfill_log
-- Tracks the earliest available date per report type per client,
-- discovered by the probing step in runVendorBackfill().
-- Also records when the last backfill ran so re-runs can be idempotent.

CREATE TABLE IF NOT EXISTS CALBRIDGE_PROD.APP.vendor_backfill_log (
  client_id           VARCHAR(36)   NOT NULL PRIMARY KEY,
  sales_earliest      DATE,
  inventory_earliest  DATE,
  traffic_earliest    DATE,
  ppm_earliest        DATE,
  last_backfill_at    TIMESTAMP_NTZ NOT NULL DEFAULT CURRENT_TIMESTAMP(),
  notes               VARCHAR(500)
);
