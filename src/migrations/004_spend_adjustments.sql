-- Migration 004: Spend Adjustments
-- Monthly per-client per-ad-type spend multipliers (admin-only, UI layer only)
-- Clients see adjusted figures as plain "spend" — no indication of adjustment

-- ============================================================
-- SPEND_ADJUSTMENTS table
-- ============================================================
CREATE TABLE IF NOT EXISTS spend_adjustments (
  id          NUMBER AUTOINCREMENT PRIMARY KEY,
  client_id   VARCHAR(36)   NOT NULL,
  year_month  VARCHAR(7)    NOT NULL,   -- 'YYYY-MM', e.g. '2026-02'
  ad_type     VARCHAR(10)   NOT NULL,   -- 'SP' | 'SB' | 'SD' | 'DSP' | 'SA' | 'ALL'
  multiplier  FLOAT         NOT NULL,   -- e.g. 0.98 for -2%, 1.15 for +15%
  note        VARCHAR(500),             -- optional admin note
  created_by  VARCHAR(255),             -- admin email
  created_at  TIMESTAMP_NTZ NOT NULL DEFAULT CURRENT_TIMESTAMP(),
  updated_at  TIMESTAMP_NTZ NOT NULL DEFAULT CURRENT_TIMESTAMP(),
  UNIQUE (client_id, year_month, ad_type)
);

-- ============================================================
-- adjusted_campaign_performance VIEW
-- Wraps campaign_performance, multiplying spend by any matching
-- adjustment. Lookup priority:
--   1. client + month + exact ad_type  (SP, SB, or SD)
--   2. client + month + 'SA'           (Sponsored Ads catch-all for SP/SB/SD)
--   3. client + month + 'ALL'          (all ad types catch-all)
--   4. default 1.0 (no adjustment)
-- All other columns pass through unchanged.
-- ============================================================
CREATE OR REPLACE VIEW adjusted_campaign_performance AS
SELECT
  cp.*,
  cp.spend * COALESCE(
    sa_exact.multiplier,      -- exact match: SP, SB, or SD
    sa_sa.multiplier,         -- SA catch-all for SP/SB/SD
    sa_all.multiplier,        -- ALL catch-all
    1.0
  ) AS adjusted_spend
FROM campaign_performance cp
LEFT JOIN spend_adjustments sa_exact
  ON  sa_exact.client_id  = cp.client_id
  AND sa_exact.year_month = TO_VARCHAR(cp.date, 'YYYY-MM')
  AND sa_exact.ad_type    = cp.ad_type
LEFT JOIN spend_adjustments sa_sa
  ON  sa_sa.client_id  = cp.client_id
  AND sa_sa.year_month = TO_VARCHAR(cp.date, 'YYYY-MM')
  AND sa_sa.ad_type    = 'SA'
  AND cp.ad_type IN ('SP', 'SB', 'SD')
LEFT JOIN spend_adjustments sa_all
  ON  sa_all.client_id  = cp.client_id
  AND sa_all.year_month = TO_VARCHAR(cp.date, 'YYYY-MM')
  AND sa_all.ad_type    = 'ALL';

-- ============================================================
-- adjusted_dsp_campaign_report VIEW
-- Same pattern for DSP (dsp_campaign_report uses 'cost' not 'spend')
-- ============================================================
CREATE OR REPLACE VIEW adjusted_dsp_campaign_report AS
SELECT
  d.*,
  d.total_cost * COALESCE(
    sa_exact.multiplier,
    sa_all.multiplier,
    1.0
  ) AS adjusted_cost
FROM dsp_campaign_report d
LEFT JOIN spend_adjustments sa_exact
  ON  sa_exact.client_id  = d.client_id
  AND sa_exact.year_month = TO_VARCHAR(d.date, 'YYYY-MM')
  AND sa_exact.ad_type    = 'DSP'
LEFT JOIN spend_adjustments sa_all
  ON  sa_all.client_id  = d.client_id
  AND sa_all.year_month = TO_VARCHAR(d.date, 'YYYY-MM')
  AND sa_all.ad_type    = 'ALL';
