-- ============================================================
-- Migration 003: connector_health table + ads_report_queue columns
-- Date: 2026-03-26
-- Owned by: Control 🎛️ / Connector 🔌
--
-- 1. CONNECTOR_HEALTH — per-account health registry
--    Written by connectorHealth.js on every 5-min token check.
--    Read by reportOrchestrator.js to get account_ids.
--
-- 2. ADS_REPORT_QUEUE — add columns needed by new poll/download split:
--    download_url — cached download URL from Amazon (avoids re-polling)
--    polled_at    — when we last polled this report's status
--
-- Note: ads_report_queue already exists (created by existing codebase).
--       ALTER TABLE IF NOT EXISTS handles gracefully.
-- ============================================================

-- ── 1. CONNECTOR_HEALTH ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS CALBRIDGE_PROD.SANDBOX.CONNECTOR_HEALTH (
  client_id        VARCHAR(36)   NOT NULL                              COMMENT 'Calbridge client UUID',
  connection_type  VARCHAR(32)   NOT NULL                              COMMENT 'ads | dsp | seller | vendor',
  account_id       VARCHAR(64)   NOT NULL                              COMMENT 'Amazon profile_id or sellingPartnerId',

  -- Health status
  status           VARCHAR(32)   NOT NULL  DEFAULT 'unknown'           COMMENT 'healthy | token_invalid | error | disabled | unknown',
  last_checked_at  TIMESTAMP_NTZ                                       COMMENT 'Last time health was probed',
  last_error       VARCHAR(2000)                                       COMMENT 'Last error message if status != healthy',

  -- Token metadata
  token_expires_at TIMESTAMP_NTZ                                       COMMENT 'Access token expiry (if known)',

  -- Timestamps
  created_at       TIMESTAMP_NTZ NOT NULL  DEFAULT CURRENT_TIMESTAMP(),
  updated_at       TIMESTAMP_NTZ NOT NULL  DEFAULT CURRENT_TIMESTAMP(),

  PRIMARY KEY (client_id, connection_type, account_id)
)
COMMENT = 'Per-account connector health registry. Updated every 5 minutes by check_connector_health job.';

-- ── 2. ADS_REPORT_QUEUE — new columns ────────────────────────────────────────
-- Adds download_url (cached from Amazon when report is COMPLETED)
-- and polled_at (last poll timestamp — for rate limiting).

ALTER TABLE ads_report_queue
  ADD COLUMN IF NOT EXISTS download_url VARCHAR(4000)
  COMMENT 'Cached Amazon download URL for completed reports. Expires after ~1 hour.';

ALTER TABLE ads_report_queue
  ADD COLUMN IF NOT EXISTS polled_at TIMESTAMP_NTZ
  COMMENT 'Last time this report was polled for status from Amazon API.';

-- Add 'ready' as a valid status (poll found it complete, download pending)
-- No enum constraint in Snowflake — just documenting valid values:
-- pending | ready | completed | failed
