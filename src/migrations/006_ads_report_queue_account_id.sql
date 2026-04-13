-- ============================================================
-- Migration 006: Add account_id to ads_report_queue
-- Date: 2026-04-13
-- Phase 2b — multi-account schema refactor
--
-- account_id references client_accounts.account_id so we can trace
-- every queued report back to the canonical account record.
-- Additive only — existing rows get NULL account_id (backward compatible).
-- ============================================================

ALTER TABLE CALBRIDGE_PROD.APP.ads_report_queue
  ADD COLUMN IF NOT EXISTS account_id VARCHAR(36)
  COMMENT 'FK to client_accounts.account_id — set when report is queued via client_accounts routing (Phase 2b+)';
