-- ============================================================
-- Migration 002: Add missing columns to PIPELINE.JOB_RUNS
-- Date: 2026-03-26
-- Owned by: Control 🎛️
--
-- The original 001_create_schema.sql created JOB_RUNS with:
--   job_id, pipeline_run_id, job_type, account_id, client_id,
--   started_at, completed_at, duration_seconds, status,
--   error_message, retry_count, rows_read, rows_written, rows_skipped,
--   source_table, target_table, date_range_start, date_range_end
--
-- This migration adds the two columns needed by the job orchestration system:
--   metric_version  — which metric formula version ran (for scoring jobs)
--   triggered_by    — how the job was kicked off: cron / manual / dependency
--
-- Note: status values are now formally: pending/running/completed/failed/skipped
-- The existing column was VARCHAR(16) with RUNNING|SUCCESS|FAILED|RETRYING|SKIPPED.
-- We keep both sets valid — jobRunner.js uses the canonical set below.
-- ============================================================

ALTER TABLE CALBRIDGE.PIPELINE.JOB_RUNS
  ADD COLUMN IF NOT EXISTS metric_version VARCHAR(32)
  COMMENT 'Metric formula version that ran (e.g. "1.2"). Populated by scoring/KPI jobs.';

ALTER TABLE CALBRIDGE.PIPELINE.JOB_RUNS
  ADD COLUMN IF NOT EXISTS triggered_by VARCHAR(32)
  COMMENT 'What triggered this job: cron | manual | dependency | retry';
