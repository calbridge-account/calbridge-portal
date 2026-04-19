/**
 * src/jobs/stageRawData.js
 *
 * Jobs: stage_raw_data + run_quality_checks + compute_freshness + reconcile_missing_partitions
 * Schedule: hourly
 * Owner: Pipeline 🏗️
 *
 * What this does:
 *   stage_raw_data:
 *     - Moves new rows from RAW_AMAZON_ADS.* into ANALYTICS.ADS_PERFORMANCE (canonical)
 *     - Moves new rows from RAW_SP_API.* into ANALYTICS.RETAIL_PERFORMANCE + INVENTORY_SNAPSHOT
 *     - All via MERGE — idempotent, safe to re-run
 *     - Tracks rows read/written in JOB_RUNS
 *
 *   run_quality_checks:
 *     - Null key checks, spend not negative, row count > 0
 *     - Writes results to PIPELINE.QUALITY_LOG
 *     - Does NOT block downstream — just writes PASS/FAIL/WARN
 *
 *   compute_freshness:
 *     - Updates PIPELINE.FRESHNESS for every (table, account) pair
 *     - Sets is_stale = true if last_successful_load_at is older than staleness_threshold_hours
 *
 *   reconcile_missing_partitions:
 *     - Finds date gaps in ANALYTICS.ADS_PERFORMANCE by account
 *     - Logs them — the actual backfill is triggered separately via backfill_date_range
 *
 * Design notes:
 *   - Raw tables (RAW_*) are written by the Reporter jobs. This job reads them.
 *   - Canonical tables (ANALYTICS.*) are the source of truth for all downstream jobs.
 *   - We use transform_version = '1.0' — bump when the transform logic changes.
 */

'use strict';

require('dotenv').config();
const { v4: uuidv4 } = require('uuid');
const { query } = require('../services/snowflakeService');
const { startJob, completeJob, failJob } = require('../services/jobRunner');

const TRANSFORM_VERSION = '1.0';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Shared helpers ──────────────────────────────────────────────────────────

async function getActiveAccounts() {
  try {
    const rows = await query(`
      SELECT DISTINCT account_id, client_id
      FROM CALBRIDGE_PROD.PIPELINE.JOB_RUNS
      WHERE started_at >= DATEADD('day', -7, CURRENT_TIMESTAMP())
        AND account_id != 'unknown'
        AND account_id != 'system'
    `);
    return (rows || []).map(r => ({
      accountId: r.ACCOUNT_ID || r.account_id,
      clientId:  r.CLIENT_ID  || r.client_id,
    }));
  } catch (err) {
    console.warn('[stageRawData] getActiveAccounts fallback to clients table:', err.message);
    try {
      const rows = await query(`SELECT client_id FROM clients WHERE status = 'active' AND linked_client_id IS NULL`);
      return (rows || []).map(r => ({ accountId: r.CLIENT_ID || r.client_id, clientId: r.CLIENT_ID || r.client_id }));
    } catch {
      return [];
    }
  }
}

// ─── Job 1: stage_raw_data ────────────────────────────────────────────────────

// ─── Job 0: stage_ad_campaign_raw ────────────────────────────────────────────
// Merge SP / SB / SD / DSP campaign-level rows from CALBRIDGE_PROD.APP report
// tables into CALBRIDGE_PROD.RAW.AD_CAMPAIGN (canonical campaign-day table).
// This is what ADJUSTED_AD_CAMPAIGN view reads — must be current for the
// vendor analytics advertising tab to show data.

async function stageAdCampaignRaw(clientId, pipelineRunId) {
  let totalRows = 0;

  // ── SP ──
  try {
    const r = await query(`
      MERGE INTO CALBRIDGE_PROD.RAW.AD_CAMPAIGN tgt
      USING (
        SELECT
          client_id,
          'amazon'                            AS platform,
          'ATVPDKIKX0DER'                     AS marketplace,
          CURRENT_TIMESTAMP()                 AS ingested_at,
          profile_id || '_' || campaign_id || '_SP_' || TO_VARCHAR(date,'YYYYMMDD') AS report_id,
          ?                                   AS pipeline_run_id,
          'preliminary'                       AS data_maturity,
          CURRENT_TIMESTAMP()                 AS last_refreshed_at,
          campaign_id,
          date,
          campaign_name,
          'SP'                                AS campaign_type,
          'SPONSORED_PRODUCTS'                AS ad_product,
          campaign_status                     AS status,
          campaign_budget_amount              AS daily_budget,
          COALESCE(impressions, 0)            AS impressions,
          COALESCE(clicks, 0)                 AS clicks,
          COALESCE(cost, 0)                   AS cost,
          purchases_1_d                       AS purchases_1d,
          purchases_7_d                       AS purchases_7d,
          purchases_14_d                      AS purchases_14d,
          purchases_30_d                      AS purchases_30d,
          sales_1_d                           AS sales_1d,
          sales_7_d                           AS sales_7d,
          sales_14_d                          AS sales_14d,
          sales_30_d                          AS sales_30d,
          NULL::FLOAT                         AS ntb_orders_14d,
          NULL::FLOAT                         AS ntb_sales_14d,
          NULL::FLOAT                         AS ntb_units_14d,
          top_of_search_impression_share      AS impression_share,
          NULL::FLOAT                         AS impression_share_lost_budget,
          NULL::FLOAT                         AS impression_share_lost_rank,
          NULL::FLOAT                         AS video_views_25pct,
          NULL::FLOAT                         AS video_views_50pct,
          NULL::FLOAT                         AS video_views_75pct,
          NULL::FLOAT                         AS video_views_100pct,
          NULL::FLOAT                         AS viewable_impressions
        FROM CALBRIDGE_PROD.APP.SP_CAMPAIGN_REPORT
        WHERE client_id = ?
      ) src
      ON  tgt.client_id   = src.client_id
      AND tgt.campaign_id = src.campaign_id
      AND tgt.ad_product  = src.ad_product
      AND tgt.date        = src.date
      WHEN MATCHED AND tgt.ingested_at < src.ingested_at THEN UPDATE SET
        ingested_at = src.ingested_at, last_refreshed_at = src.last_refreshed_at,
        data_maturity = src.data_maturity, pipeline_run_id = src.pipeline_run_id,
        campaign_name = src.campaign_name, status = src.status, daily_budget = src.daily_budget,
        impressions = src.impressions, clicks = src.clicks, cost = src.cost,
        purchases_1d = src.purchases_1d, purchases_7d = src.purchases_7d,
        purchases_14d = src.purchases_14d, purchases_30d = src.purchases_30d,
        sales_1d = src.sales_1d, sales_7d = src.sales_7d,
        sales_14d = src.sales_14d, sales_30d = src.sales_30d,
        impression_share = src.impression_share
      WHEN NOT MATCHED THEN INSERT (
        client_id, platform, marketplace, ingested_at, report_id, pipeline_run_id,
        data_maturity, last_refreshed_at, campaign_id, date, campaign_name, campaign_type,
        ad_product, status, daily_budget, impressions, clicks, cost,
        purchases_1d, purchases_7d, purchases_14d, purchases_30d,
        sales_1d, sales_7d, sales_14d, sales_30d,
        ntb_orders_14d, ntb_sales_14d, ntb_units_14d,
        impression_share, impression_share_lost_budget, impression_share_lost_rank,
        video_views_25pct, video_views_50pct, video_views_75pct, video_views_100pct,
        viewable_impressions
      ) VALUES (
        src.client_id, src.platform, src.marketplace, src.ingested_at, src.report_id, src.pipeline_run_id,
        src.data_maturity, src.last_refreshed_at, src.campaign_id, src.date, src.campaign_name, src.campaign_type,
        src.ad_product, src.status, src.daily_budget, src.impressions, src.clicks, src.cost,
        src.purchases_1d, src.purchases_7d, src.purchases_14d, src.purchases_30d,
        src.sales_1d, src.sales_7d, src.sales_14d, src.sales_30d,
        src.ntb_orders_14d, src.ntb_sales_14d, src.ntb_units_14d,
        src.impression_share, src.impression_share_lost_budget, src.impression_share_lost_rank,
        src.video_views_25pct, src.video_views_50pct, src.video_views_75pct, src.video_views_100pct,
        src.viewable_impressions
      )
    `, [pipelineRunId, clientId]);
    const rows = Array.isArray(r) ? r.reduce((s,x)=>s+Number(Object.values(x)[0]||0),0) : 0;
    totalRows += rows;
    if (rows > 0) console.log('[stageAdCampaignRaw] SP:', rows, 'rows for', clientId);
  } catch (err) {
    console.warn('[stageAdCampaignRaw] SP failed:', err.message);
  }

  // ── SB ──
  try {
    const r = await query(`
      MERGE INTO CALBRIDGE_PROD.RAW.AD_CAMPAIGN tgt
      USING (
        SELECT
          client_id,
          'amazon'                            AS platform,
          'ATVPDKIKX0DER'                     AS marketplace,
          CURRENT_TIMESTAMP()                 AS ingested_at,
          profile_id || '_' || campaign_id || '_SB_' || TO_VARCHAR(report_date,'YYYYMMDD') AS report_id,
          ?                                   AS pipeline_run_id,
          'preliminary'                       AS data_maturity,
          CURRENT_TIMESTAMP()                 AS last_refreshed_at,
          campaign_id,
          report_date                         AS date,
          campaign_name,
          'SB'                                AS campaign_type,
          'SPONSORED_BRANDS'                  AS ad_product,
          campaign_status                     AS status,
          campaign_budget_amount              AS daily_budget,
          COALESCE(impressions, 0)            AS impressions,
          COALESCE(clicks, 0)                 AS clicks,
          COALESCE(cost, 0)                   AS cost,
          NULL::FLOAT                         AS purchases_1d,
          NULL::FLOAT                         AS purchases_7d,
          purchases_clicks::FLOAT             AS purchases_14d,
          purchases::FLOAT                    AS purchases_30d,
          NULL::FLOAT                         AS sales_1d,
          NULL::FLOAT                         AS sales_7d,
          sales_clicks::FLOAT                 AS sales_14d,
          sales::FLOAT                        AS sales_30d,
          new_to_brand_purchases_clicks::FLOAT  AS ntb_orders_14d,
          new_to_brand_sales_clicks::FLOAT      AS ntb_sales_14d,
          new_to_brand_units_sold_clicks::FLOAT AS ntb_units_14d,
          top_of_search_impression_share      AS impression_share,
          NULL::FLOAT                         AS impression_share_lost_budget,
          NULL::FLOAT                         AS impression_share_lost_rank,
          NULL::FLOAT                         AS video_views_25pct,
          NULL::FLOAT                         AS video_views_50pct,
          NULL::FLOAT                         AS video_views_75pct,
          video_complete_views::FLOAT         AS video_views_100pct,
          viewable_impressions::FLOAT         AS viewable_impressions
        FROM CALBRIDGE_PROD.APP.SB_CAMPAIGN_REPORT
        WHERE client_id = ?
      ) src
      ON  tgt.client_id   = src.client_id
      AND tgt.campaign_id = src.campaign_id
      AND tgt.ad_product  = src.ad_product
      AND tgt.date        = src.date
      WHEN MATCHED AND tgt.ingested_at < src.ingested_at THEN UPDATE SET
        ingested_at = src.ingested_at, last_refreshed_at = src.last_refreshed_at,
        data_maturity = src.data_maturity, pipeline_run_id = src.pipeline_run_id,
        campaign_name = src.campaign_name, status = src.status, daily_budget = src.daily_budget,
        impressions = src.impressions, clicks = src.clicks, cost = src.cost,
        purchases_14d = src.purchases_14d, purchases_30d = src.purchases_30d,
        sales_14d = src.sales_14d, sales_30d = src.sales_30d,
        ntb_orders_14d = src.ntb_orders_14d, ntb_sales_14d = src.ntb_sales_14d,
        ntb_units_14d = src.ntb_units_14d,
        impression_share = src.impression_share, viewable_impressions = src.viewable_impressions
      WHEN NOT MATCHED THEN INSERT (
        client_id, platform, marketplace, ingested_at, report_id, pipeline_run_id,
        data_maturity, last_refreshed_at, campaign_id, date, campaign_name, campaign_type,
        ad_product, status, daily_budget, impressions, clicks, cost,
        purchases_1d, purchases_7d, purchases_14d, purchases_30d,
        sales_1d, sales_7d, sales_14d, sales_30d,
        ntb_orders_14d, ntb_sales_14d, ntb_units_14d,
        impression_share, impression_share_lost_budget, impression_share_lost_rank,
        video_views_25pct, video_views_50pct, video_views_75pct, video_views_100pct,
        viewable_impressions
      ) VALUES (
        src.client_id, src.platform, src.marketplace, src.ingested_at, src.report_id, src.pipeline_run_id,
        src.data_maturity, src.last_refreshed_at, src.campaign_id, src.date, src.campaign_name, src.campaign_type,
        src.ad_product, src.status, src.daily_budget, src.impressions, src.clicks, src.cost,
        src.purchases_1d, src.purchases_7d, src.purchases_14d, src.purchases_30d,
        src.sales_1d, src.sales_7d, src.sales_14d, src.sales_30d,
        src.ntb_orders_14d, src.ntb_sales_14d, src.ntb_units_14d,
        src.impression_share, src.impression_share_lost_budget, src.impression_share_lost_rank,
        src.video_views_25pct, src.video_views_50pct, src.video_views_75pct, src.video_views_100pct,
        src.viewable_impressions
      )
    `, [pipelineRunId, clientId]);
    const rows = Array.isArray(r) ? r.reduce((s,x)=>s+Number(Object.values(x)[0]||0),0) : 0;
    totalRows += rows;
    if (rows > 0) console.log('[stageAdCampaignRaw] SB:', rows, 'rows for', clientId);
  } catch (err) {
    console.warn('[stageAdCampaignRaw] SB failed:', err.message);
  }

  // ── SD ──
  try {
    const r = await query(`
      MERGE INTO CALBRIDGE_PROD.RAW.AD_CAMPAIGN tgt
      USING (
        SELECT
          client_id,
          'amazon'                            AS platform,
          'ATVPDKIKX0DER'                     AS marketplace,
          CURRENT_TIMESTAMP()                 AS ingested_at,
          profile_id || '_' || campaign_id || '_SD_' || TO_VARCHAR(date,'YYYYMMDD') AS report_id,
          ?                                   AS pipeline_run_id,
          'preliminary'                       AS data_maturity,
          CURRENT_TIMESTAMP()                 AS last_refreshed_at,
          campaign_id,
          date,
          campaign_name,
          'SD'                                AS campaign_type,
          'SPONSORED_DISPLAY'                 AS ad_product,
          campaign_status                     AS status,
          campaign_budget_amount              AS daily_budget,
          COALESCE(impressions, 0)            AS impressions,
          COALESCE(clicks, 0)                 AS clicks,
          COALESCE(cost, 0)                   AS cost,
          NULL::FLOAT                         AS purchases_1d,
          NULL::FLOAT                         AS purchases_7d,
          purchases_clicks::FLOAT             AS purchases_14d,
          purchases::FLOAT                    AS purchases_30d,
          NULL::FLOAT                         AS sales_1d,
          NULL::FLOAT                         AS sales_7d,
          sales_clicks::FLOAT                 AS sales_14d,
          sales::FLOAT                        AS sales_30d,
          new_to_brand_purchases_clicks::FLOAT  AS ntb_orders_14d,
          new_to_brand_sales_clicks::FLOAT      AS ntb_sales_14d,
          new_to_brand_units_sold_clicks::FLOAT AS ntb_units_14d,
          NULL::FLOAT                         AS impression_share,
          NULL::FLOAT                         AS impression_share_lost_budget,
          NULL::FLOAT                         AS impression_share_lost_rank,
          NULL::FLOAT                         AS video_views_25pct,
          NULL::FLOAT                         AS video_views_50pct,
          NULL::FLOAT                         AS video_views_75pct,
          video_complete_views::FLOAT         AS video_views_100pct,
          impressions_views::FLOAT            AS viewable_impressions
        FROM CALBRIDGE_PROD.APP.SD_CAMPAIGN_REPORT
        WHERE client_id = ?
      ) src
      ON  tgt.client_id   = src.client_id
      AND tgt.campaign_id = src.campaign_id
      AND tgt.ad_product  = src.ad_product
      AND tgt.date        = src.date
      WHEN MATCHED AND tgt.ingested_at < src.ingested_at THEN UPDATE SET
        ingested_at = src.ingested_at, last_refreshed_at = src.last_refreshed_at,
        data_maturity = src.data_maturity, pipeline_run_id = src.pipeline_run_id,
        campaign_name = src.campaign_name, status = src.status, daily_budget = src.daily_budget,
        impressions = src.impressions, clicks = src.clicks, cost = src.cost,
        purchases_14d = src.purchases_14d, purchases_30d = src.purchases_30d,
        sales_14d = src.sales_14d, sales_30d = src.sales_30d,
        ntb_orders_14d = src.ntb_orders_14d, ntb_sales_14d = src.ntb_sales_14d,
        ntb_units_14d = src.ntb_units_14d,
        viewable_impressions = src.viewable_impressions
      WHEN NOT MATCHED THEN INSERT (
        client_id, platform, marketplace, ingested_at, report_id, pipeline_run_id,
        data_maturity, last_refreshed_at, campaign_id, date, campaign_name, campaign_type,
        ad_product, status, daily_budget, impressions, clicks, cost,
        purchases_1d, purchases_7d, purchases_14d, purchases_30d,
        sales_1d, sales_7d, sales_14d, sales_30d,
        ntb_orders_14d, ntb_sales_14d, ntb_units_14d,
        impression_share, impression_share_lost_budget, impression_share_lost_rank,
        video_views_25pct, video_views_50pct, video_views_75pct, video_views_100pct,
        viewable_impressions
      ) VALUES (
        src.client_id, src.platform, src.marketplace, src.ingested_at, src.report_id, src.pipeline_run_id,
        src.data_maturity, src.last_refreshed_at, src.campaign_id, src.date, src.campaign_name, src.campaign_type,
        src.ad_product, src.status, src.daily_budget, src.impressions, src.clicks, src.cost,
        src.purchases_1d, src.purchases_7d, src.purchases_14d, src.purchases_30d,
        src.sales_1d, src.sales_7d, src.sales_14d, src.sales_30d,
        src.ntb_orders_14d, src.ntb_sales_14d, src.ntb_units_14d,
        src.impression_share, src.impression_share_lost_budget, src.impression_share_lost_rank,
        src.video_views_25pct, src.video_views_50pct, src.video_views_75pct, src.video_views_100pct,
        src.viewable_impressions
      )
    `, [pipelineRunId, clientId]);
    const rows = Array.isArray(r) ? r.reduce((s,x)=>s+Number(Object.values(x)[0]||0),0) : 0;
    totalRows += rows;
    if (rows > 0) console.log('[stageAdCampaignRaw] SD:', rows, 'rows for', clientId);
  } catch (err) {
    console.warn('[stageAdCampaignRaw] SD failed:', err.message);
  }

  // ── DSP ──
  try {
    // Safety check: skip DSP RAW update if DCR looks abnormally small (< 100 rows for this client).
    // Prevents a bad/partial DCR state from overwriting good RAW history.
    const dcrCount = await query(
      'SELECT COUNT(*) as cnt FROM CALBRIDGE_PROD.APP.DSP_CAMPAIGN_REPORT WHERE client_id = ?',
      [clientId]
    );
    const dcrRows = Number(dcrCount[0]?.CNT || dcrCount[0]?.cnt || 0);
    if (dcrRows < 100) {
      console.warn(`[stageAdCampaignRaw] Skipping DSP RAW update for ${clientId} — DCR only has ${dcrRows} rows (expected ≥100). DCR may be incomplete.`);
    } else {
    const r = await query(`
      MERGE INTO CALBRIDGE_PROD.RAW.AD_CAMPAIGN tgt
      USING (
        -- Aggregate by (client_id, order_name, date) using MAX(total_sales).
        -- order_name is the stable dedup key — order_id has 64-bit truncation variants.
        -- MAX(total_sales) ensures the order-level total always wins over ad-grain subsets.
        -- This is bulletproof against dspAd rows overwriting dspCampaign totals.
        SELECT
          client_id,
          'amazon'                               AS platform,
          'ATVPDKIKX0DER'                        AS marketplace,
          CURRENT_TIMESTAMP()                    AS ingested_at,
          client_id || '_' || order_name || '_DSP_' || TO_VARCHAR(date,'YYYYMMDD') AS report_id,
          ?                                      AS pipeline_run_id,
          'preliminary'                          AS data_maturity,
          CURRENT_TIMESTAMP()                    AS last_refreshed_at,
          MAX(order_id)                          AS campaign_id,
          date,
          order_name                             AS campaign_name,
          'DSP'                                  AS campaign_type,
          'DSP'                                  AS ad_product,
          'ACTIVE'                               AS status,
          MAX(order_budget)                      AS daily_budget,
          -- Use order-grain (line_item_id IS NULL) when it has spend; else ad-grain.
          -- Prevents doubling for SparkX (both grains) while keeping Calbridge Apr+ (ad-grain only).
          CASE WHEN SUM(CASE WHEN line_item_id IS NULL THEN total_cost ELSE 0 END) > 0
            THEN SUM(CASE WHEN line_item_id IS NULL THEN COALESCE(impressions,0) ELSE 0 END)
            ELSE SUM(CASE WHEN line_item_id IS NOT NULL THEN COALESCE(impressions,0) ELSE 0 END)
          END AS impressions,
          CASE WHEN SUM(CASE WHEN line_item_id IS NULL THEN total_cost ELSE 0 END) > 0
            THEN SUM(CASE WHEN line_item_id IS NULL THEN COALESCE(clicks,0) ELSE 0 END)
            ELSE SUM(CASE WHEN line_item_id IS NOT NULL THEN COALESCE(clicks,0) ELSE 0 END)
          END AS clicks,
          CASE WHEN SUM(CASE WHEN line_item_id IS NULL THEN total_cost ELSE 0 END) > 0
            THEN SUM(CASE WHEN line_item_id IS NULL THEN COALESCE(total_cost,0) ELSE 0 END)
            ELSE SUM(CASE WHEN line_item_id IS NOT NULL THEN COALESCE(total_cost,0) ELSE 0 END)
          END AS cost,
          NULL::FLOAT                            AS purchases_1d,
          NULL::FLOAT                            AS purchases_7d,
          MAX(purchases_clicks)::FLOAT           AS purchases_14d,
          MAX(total_purchases)::FLOAT            AS purchases_30d,
          NULL::FLOAT                            AS sales_1d,
          NULL::FLOAT                            AS sales_7d,
          NULL::FLOAT                            AS sales_14d,
          MAX(total_sales)::FLOAT                AS sales_30d,  -- MAX wins: order-grain > ad-grain
          MAX(new_to_brand_purchases_clicks)::FLOAT AS ntb_orders_14d,
          MAX(new_to_brand_product_sales)::FLOAT    AS ntb_sales_14d,
          NULL::FLOAT                            AS ntb_units_14d,
          NULL::FLOAT                            AS impression_share,
          NULL::FLOAT                            AS impression_share_lost_budget,
          NULL::FLOAT                            AS impression_share_lost_rank,
          NULL::FLOAT                            AS video_views_25pct,
          NULL::FLOAT                            AS video_views_50pct,
          NULL::FLOAT                            AS video_views_75pct,
          SUM(video_ad_complete)::FLOAT          AS video_views_100pct,
          SUM(viewable_impressions)::FLOAT       AS viewable_impressions
        FROM CALBRIDGE_PROD.APP.DSP_CAMPAIGN_REPORT
        WHERE client_id = ?
        GROUP BY client_id, order_name, date
      ) src
      ON  tgt.client_id   = src.client_id
      AND tgt.campaign_name = src.campaign_name
      AND tgt.ad_product  = src.ad_product
      AND tgt.date        = src.date
      WHEN MATCHED THEN UPDATE SET
        ingested_at = src.ingested_at, last_refreshed_at = src.last_refreshed_at,
        data_maturity = src.data_maturity, pipeline_run_id = src.pipeline_run_id,
        campaign_name = src.campaign_name, status = src.status, daily_budget = src.daily_budget,
        impressions = src.impressions, clicks = src.clicks, cost = src.cost,
        purchases_14d = src.purchases_14d, purchases_30d = src.purchases_30d,
        sales_30d = src.sales_30d,
        ntb_orders_14d = src.ntb_orders_14d, ntb_sales_14d = src.ntb_sales_14d,
        viewable_impressions = src.viewable_impressions
      WHEN NOT MATCHED THEN INSERT (
        client_id, platform, marketplace, ingested_at, report_id, pipeline_run_id,
        data_maturity, last_refreshed_at, campaign_id, date, campaign_name, campaign_type,
        ad_product, status, daily_budget, impressions, clicks, cost,
        purchases_1d, purchases_7d, purchases_14d, purchases_30d,
        sales_1d, sales_7d, sales_14d, sales_30d,
        ntb_orders_14d, ntb_sales_14d, ntb_units_14d,
        impression_share, impression_share_lost_budget, impression_share_lost_rank,
        video_views_25pct, video_views_50pct, video_views_75pct, video_views_100pct,
        viewable_impressions
      ) VALUES (
        src.client_id, src.platform, src.marketplace, src.ingested_at, src.report_id, src.pipeline_run_id,
        src.data_maturity, src.last_refreshed_at, src.campaign_id, src.date, src.campaign_name, src.campaign_type,
        src.ad_product, src.status, src.daily_budget, src.impressions, src.clicks, src.cost,
        src.purchases_1d, src.purchases_7d, src.purchases_14d, src.purchases_30d,
        src.sales_1d, src.sales_7d, src.sales_14d, src.sales_30d,
        src.ntb_orders_14d, src.ntb_sales_14d, src.ntb_units_14d,
        src.impression_share, src.impression_share_lost_budget, src.impression_share_lost_rank,
        src.video_views_25pct, src.video_views_50pct, src.video_views_75pct, src.video_views_100pct,
        src.viewable_impressions
      )
    `, [pipelineRunId, clientId]);
    const rows = Array.isArray(r) ? r.reduce((s,x)=>s+Number(Object.values(x)[0]||0),0) : 0;
    totalRows += rows;
    if (rows > 0) console.log('[stageAdCampaignRaw] DSP:', rows, 'rows for', clientId);
    } // end else (dcrRows >= 100)

    // NOTE: The advertiser_id dedup DELETE was removed 2026-04-16.
    // It was causing data loss by deleting valid SparkX and Calbridge rows whose
    // advertiser_ids weren't in DSP_ADVERTISER. safeParse now preserves full-precision
    // IDs, and DSP_ADVERTISER has all active advertisers. The DELETE is no longer needed.
  } catch (err) {
    console.warn('[stageAdCampaignRaw] DSP failed (non-fatal):', err.message);
  }

  return totalRows;
}

/**
 * Transform RAW_AMAZON_ADS.SP_CAMPAIGNS → ANALYTICS.ADS_PERFORMANCE (SP rows).
 * Uses MERGE on (client_id, account_id, ad_type, campaign_id, date).
 * Only processes rows not yet in ANALYTICS (based on source_report_id freshness).
 */
async function stageSpCampaignsToAnalytics(clientId, accountId, pipelineRunId) {
  const result = await query(`
    MERGE INTO CALBRIDGE_PROD.ANALYTICS.ADS_PERFORMANCE tgt
    USING (
      SELECT
        r.report_id                                         AS source_report_id,
        ?                                                   AS transform_version,
        r.client_id,
        r.account_id,
        'SP'                                               AS ad_type,
        r.campaign_id,
        r.date,
        NULL                                               AS ad_group_id,
        NULL                                               AS asin,
        r.campaign_name,
        r.campaign_status,
        r.campaign_budget_amount,
        r.campaign_budget_currency_code,
        COALESCE(r.impressions, 0)                         AS impressions,
        COALESCE(r.clicks, 0)                              AS clicks,
        COALESCE(r.cost, 0)                                AS cost,
        r.purchases_30_d                                   AS purchases_30d,
        r.sales_30_d                                       AS sales_30d,
        r.units_sold_clicks_30_d                           AS units_sold_30d,
        NULL                                               AS new_to_brand_purchases,
        NULL                                               AS new_to_brand_sales,
        NULL                                               AS detail_page_views,
        NULL                                               AS add_to_cart,
        -- Derived metrics (compute at stage time)
        CASE WHEN r.sales_30_d > 0 THEN r.cost / r.sales_30_d * 100 END AS acos,
        CASE WHEN r.cost > 0       THEN r.sales_30_d / r.cost END        AS roas,
        CASE WHEN r.impressions > 0 THEN r.clicks::FLOAT / r.impressions END AS ctr,
        CASE WHEN r.clicks > 0      THEN r.cost / r.clicks END           AS cpc,
        CASE WHEN r.clicks > 0      THEN r.purchases_30_d::FLOAT / r.clicks END AS cvr,
        ?                                                   AS pipeline_run_id
      FROM CALBRIDGE_PROD.RAW.SP_CAMPAIGNS r
      WHERE r.client_id  = ?
        AND r.account_id = ?
        -- Only unprocessed rows (not yet in analytics or superseded by newer report)
        AND NOT EXISTS (
          SELECT 1 FROM CALBRIDGE_PROD.ANALYTICS.ADS_PERFORMANCE a
          WHERE a.client_id   = r.client_id
            AND a.account_id  = r.account_id
            AND a.ad_type     = 'SP'
            AND a.campaign_id = r.campaign_id
            AND a.date        = r.date
            AND a.source_report_id = r.report_id
        )
    ) src
    ON  tgt.client_id   = src.client_id
    AND tgt.account_id  = src.account_id
    AND tgt.ad_type     = src.ad_type
    AND tgt.campaign_id = src.campaign_id
    AND tgt.date        = src.date
    WHEN MATCHED THEN UPDATE SET
      source_report_id            = src.source_report_id,
      transform_version           = src.transform_version,
      updated_at                  = CURRENT_TIMESTAMP(),
      campaign_name               = src.campaign_name,
      campaign_status             = src.campaign_status,
      campaign_budget_amount      = src.campaign_budget_amount,
      campaign_budget_currency_code = src.campaign_budget_currency_code,
      impressions                 = src.impressions,
      clicks                      = src.clicks,
      cost                        = src.cost,
      purchases_30d               = src.purchases_30d,
      sales_30d                   = src.sales_30d,
      units_sold_30d              = src.units_sold_30d,
      acos                        = src.acos,
      roas                        = src.roas,
      ctr                         = src.ctr,
      cpc                         = src.cpc,
      cvr                         = src.cvr,
      pipeline_run_id             = src.pipeline_run_id
    WHEN NOT MATCHED THEN INSERT (
      source_report_id, transform_version, updated_at,
      client_id, account_id, ad_type, campaign_id, date,
      ad_group_id, asin,
      campaign_name, campaign_status, campaign_budget_amount, campaign_budget_currency_code,
      impressions, clicks, cost,
      purchases_30d, sales_30d, units_sold_30d,
      new_to_brand_purchases, new_to_brand_sales,
      detail_page_views, add_to_cart,
      acos, roas, ctr, cpc, cvr,
      pipeline_run_id
    ) VALUES (
      src.source_report_id, src.transform_version, CURRENT_TIMESTAMP(),
      src.client_id, src.account_id, src.ad_type, src.campaign_id, src.date,
      src.ad_group_id, src.asin,
      src.campaign_name, src.campaign_status, src.campaign_budget_amount, src.campaign_budget_currency_code,
      src.impressions, src.clicks, src.cost,
      src.purchases_30d, src.sales_30d, src.units_sold_30d,
      src.new_to_brand_purchases, src.new_to_brand_sales,
      src.detail_page_views, src.add_to_cart,
      src.acos, src.roas, src.ctr, src.cpc, src.cvr,
      src.pipeline_run_id
    )
  `, [TRANSFORM_VERSION, pipelineRunId, clientId, accountId]);

  // Snowflake MERGE returns number of rows in result set — not rows affected directly
  // Parse the result: [{number of rows inserted}, {number of rows updated}]
  return Array.isArray(result) ? result.reduce((sum, r) => sum + Number(Object.values(r)[0] || 0), 0) : 0;
}

/**
 * Transform RAW_SP_API.SALES_TRAFFIC → ANALYTICS.RETAIL_PERFORMANCE.
 */
async function stageSalesTrafficToAnalytics(clientId, accountId, pipelineRunId) {
  const result = await query(`
    MERGE INTO CALBRIDGE_PROD.ANALYTICS.RETAIL_PERFORMANCE tgt
    USING (
      SELECT
        r.report_id                       AS source_report_id,
        ?                                 AS transform_version,
        r.client_id,
        r.account_id,
        r.asin,
        r.date,
        r.marketplace_id,
        r.ordered_product_sales           AS ordered_revenue,
        COALESCE(r.units_ordered, 0)      AS units_ordered,
        r.total_order_items,
        r.units_refunded,
        r.units_received,
        r.sessions,
        r.page_views,
        r.buy_box_percentage,
        r.unit_session_percentage,
        r.ordered_product_sales_b2b       AS ordered_revenue_b2b,
        COALESCE(r.units_ordered_b2b, 0)  AS units_ordered_b2b,
        r.sessions_b2b,
        ?                                 AS pipeline_run_id
      FROM CALBRIDGE_PROD.RAW.SALES_TRAFFIC r
      WHERE r.client_id  = ?
        AND r.account_id = ?
        AND NOT EXISTS (
          SELECT 1 FROM CALBRIDGE_PROD.ANALYTICS.RETAIL_PERFORMANCE a
          WHERE a.client_id     = r.client_id
            AND a.account_id    = r.account_id
            AND a.asin          = r.asin
            AND a.date          = r.date
            AND a.marketplace_id = r.marketplace_id
            AND a.source_report_id = r.report_id
        )
    ) src
    ON  tgt.client_id     = src.client_id
    AND tgt.account_id    = src.account_id
    AND tgt.asin          = src.asin
    AND tgt.date          = src.date
    AND tgt.marketplace_id = src.marketplace_id
    WHEN MATCHED THEN UPDATE SET
      source_report_id    = src.source_report_id,
      transform_version   = src.transform_version,
      updated_at          = CURRENT_TIMESTAMP(),
      ordered_revenue     = src.ordered_revenue,
      units_ordered       = src.units_ordered,
      total_order_items   = src.total_order_items,
      units_refunded      = src.units_refunded,
      units_received       = src.units_received,
      sessions            = src.sessions,
      page_views          = src.page_views,
      buy_box_percentage  = src.buy_box_percentage,
      unit_session_percentage = src.unit_session_percentage,
      ordered_revenue_b2b = src.ordered_revenue_b2b,
      units_ordered_b2b   = src.units_ordered_b2b,
      sessions_b2b        = src.sessions_b2b,
      pipeline_run_id     = src.pipeline_run_id
    WHEN NOT MATCHED THEN INSERT (
      source_report_id, transform_version, updated_at,
      client_id, account_id, asin, date, marketplace_id,
      ordered_revenue, units_ordered, total_order_items, units_refunded, units_received,
      sessions, page_views, buy_box_percentage, unit_session_percentage,
      ordered_revenue_b2b, units_ordered_b2b, sessions_b2b,
      pipeline_run_id
    ) VALUES (
      src.source_report_id, src.transform_version, CURRENT_TIMESTAMP(),
      src.client_id, src.account_id, src.asin, src.date, src.marketplace_id,
      src.ordered_revenue, src.units_ordered, src.total_order_items, src.units_refunded, src.units_received,
      src.sessions, src.page_views, src.buy_box_percentage, src.unit_session_percentage,
      src.ordered_revenue_b2b, src.units_ordered_b2b, src.sessions_b2b,
      src.pipeline_run_id
    )
  `, [TRANSFORM_VERSION, pipelineRunId, clientId, accountId]);

  return Array.isArray(result) ? result.reduce((sum, r) => sum + Number(Object.values(r)[0] || 0), 0) : 0;
}

/**
 * Transform RAW_SP_API.FBA_INVENTORY → ANALYTICS.INVENTORY_SNAPSHOT.
 */
async function stageFbaInventoryToAnalytics(clientId, accountId, pipelineRunId) {
  const result = await query(`
    MERGE INTO CALBRIDGE_PROD.ANALYTICS.INVENTORY_SNAPSHOT tgt
    USING (
      SELECT
        r.report_id                   AS source_report_id,
        ?                             AS transform_version,
        r.client_id,
        r.account_id,
        r.asin,
        r.sku,
        r.marketplace_id,
        r.snapshot_date,
        COALESCE(r.fulfillable_quantity, 0)                             AS fulfillable_quantity,
        COALESCE(r.inbound_working_quantity, 0)
          + COALESCE(r.inbound_shipped_quantity, 0)
          + COALESCE(r.inbound_receiving_quantity, 0)                  AS inbound_quantity,
        COALESCE(r.reserved_quantity_total, 0)                         AS reserved_quantity,
        COALESCE(r.unfulfillable_quantity, 0)                          AS unfulfillable_quantity,
        COALESCE(r.total_quantity, 0)                                  AS total_quantity,
        r.estimated_days_of_supply_30,
        r.estimated_days_of_supply_90,
        CASE WHEN COALESCE(r.estimated_days_of_supply_30, 999) < 30
             THEN TRUE ELSE FALSE END                                   AS restock_alert,
        r.your_price,
        ?                             AS pipeline_run_id
      FROM CALBRIDGE_PROD.RAW.FBA_INVENTORY r
      WHERE r.client_id  = ?
        AND r.account_id = ?
        AND NOT EXISTS (
          SELECT 1 FROM CALBRIDGE_PROD.ANALYTICS.INVENTORY_SNAPSHOT a
          WHERE a.client_id      = r.client_id
            AND a.account_id     = r.account_id
            AND a.asin           = r.asin
            AND a.sku            = r.sku
            AND a.marketplace_id = r.marketplace_id
            AND a.snapshot_date  = r.snapshot_date
            AND a.source_report_id = r.report_id
        )
    ) src
    ON  tgt.client_id      = src.client_id
    AND tgt.account_id     = src.account_id
    AND tgt.asin           = src.asin
    AND tgt.sku            = src.sku
    AND tgt.marketplace_id = src.marketplace_id
    AND tgt.snapshot_date  = src.snapshot_date
    WHEN MATCHED THEN UPDATE SET
      source_report_id          = src.source_report_id,
      transform_version         = src.transform_version,
      updated_at                = CURRENT_TIMESTAMP(),
      fulfillable_quantity      = src.fulfillable_quantity,
      inbound_quantity          = src.inbound_quantity,
      reserved_quantity         = src.reserved_quantity,
      unfulfillable_quantity    = src.unfulfillable_quantity,
      total_quantity            = src.total_quantity,
      estimated_days_of_supply_30 = src.estimated_days_of_supply_30,
      estimated_days_of_supply_90 = src.estimated_days_of_supply_90,
      restock_alert             = src.restock_alert,
      your_price                = src.your_price,
      pipeline_run_id           = src.pipeline_run_id
    WHEN NOT MATCHED THEN INSERT (
      source_report_id, transform_version, updated_at,
      client_id, account_id, asin, sku, marketplace_id, snapshot_date,
      fulfillable_quantity, inbound_quantity, reserved_quantity,
      unfulfillable_quantity, total_quantity,
      estimated_days_of_supply_30, estimated_days_of_supply_90,
      restock_alert, your_price, pipeline_run_id
    ) VALUES (
      src.source_report_id, src.transform_version, CURRENT_TIMESTAMP(),
      src.client_id, src.account_id, src.asin, src.sku, src.marketplace_id, src.snapshot_date,
      src.fulfillable_quantity, src.inbound_quantity, src.reserved_quantity,
      src.unfulfillable_quantity, src.total_quantity,
      src.estimated_days_of_supply_30, src.estimated_days_of_supply_90,
      src.restock_alert, src.your_price, src.pipeline_run_id
    )
  `, [TRANSFORM_VERSION, pipelineRunId, clientId, accountId]);

  return Array.isArray(result) ? result.reduce((sum, r) => sum + Number(Object.values(r)[0] || 0), 0) : 0;
}

/**
 * Main stage_raw_data job.
 * Runs all three transforms for all active accounts.
 */
async function stageRawData({ triggeredBy = 'cron' } = {}) {
  const accounts = await getActiveAccounts();
  if (!accounts.length) {
    console.log('[stageRawData] No active accounts');
    return;
  }

  let totalRows = 0;

  // ── Stage SP/SB/SD/DSP → RAW.AD_CAMPAIGN (per client, not per account) ──
  // This is the primary feed for ADJUSTED_AD_CAMPAIGN view used by vendor analytics.
  // Deduplicate clientIds since multiple accounts may share same client.
  const seenClients = new Set();
  for (const { clientId } of accounts) {
    if (seenClients.has(clientId)) continue;
    seenClients.add(clientId);
    const pipelineRunIdAds = uuidv4();
    try {
      const adRows = await stageAdCampaignRaw(clientId, pipelineRunIdAds);
      if (adRows > 0) console.log(`[stageRawData] ✅ AD_CAMPAIGN: ${adRows} rows staged for ${clientId}`);
    } catch (err) {
      console.warn(`[stageRawData] stageAdCampaignRaw failed for ${clientId}:`, err.message);
    }
  }

  for (const { accountId, clientId } of accounts) {
    const runId = await startJob('stage_raw_data', accountId, triggeredBy, { clientId });
    const pipelineRunId = uuidv4();

    try {
      let rowsWritten = 0;

      // SP Campaigns → ADS_PERFORMANCE (legacy ANALYTICS table — kept for backwards compat)
      try {
        rowsWritten += await stageSpCampaignsToAnalytics(clientId, accountId, pipelineRunId);
      } catch (err) {
        console.warn(`[stageRawData] SP campaigns transform error for ${accountId}:`, err.message);
      }

      // Sales Traffic → RETAIL_PERFORMANCE
      try {
        rowsWritten += await stageSalesTrafficToAnalytics(clientId, accountId, pipelineRunId);
      } catch (err) {
        console.warn(`[stageRawData] Sales traffic transform error for ${accountId}:`, err.message);
      }

      // FBA Inventory → INVENTORY_SNAPSHOT
      try {
        rowsWritten += await stageFbaInventoryToAnalytics(clientId, accountId, pipelineRunId);
      } catch (err) {
        console.warn(`[stageRawData] FBA inventory transform error for ${accountId}:`, err.message);
      }

      totalRows += rowsWritten;
      await completeJob(runId, { rowsWritten });
      if (rowsWritten > 0) console.log(`[stageRawData] ${accountId}: ${rowsWritten} rows staged`);
    } catch (err) {
      await failJob(runId, err.message);
      console.error(`[stageRawData] ${accountId} failed:`, err.message);
    }

    await sleep(200);
  }

  console.log(`[stageRawData] ✅ Total rows staged: ${totalRows}`);
  return { totalRows };
}

// ─── Job 2: run_quality_checks ────────────────────────────────────────────────

/**
 * Lightweight quality assertions on canonical tables.
 * Writes PASS/FAIL/WARN to PIPELINE.QUALITY_LOG.
 * Does not block downstream jobs — informational only.
 */
async function runQualityChecks({ triggeredBy = 'cron' } = {}) {
  const accounts = await getActiveAccounts();
  if (!accounts.length) return;

  const runId = await startJob('run_quality_checks', 'system', triggeredBy);
  const logRunId = uuidv4();
  let checksRun = 0;
  let failures  = 0;

  const checks = [
    // Check 1: RAW.AD_CAMPAIGN has no null campaign_ids for recent data
    {
      table:     'CALBRIDGE_PROD.RAW.AD_CAMPAIGN',
      assertion: 'no_null_campaign_id',
      checkType: 'null_check',
      sql:       (clientId, accountId) => [`
        SELECT COUNT(*) AS cnt
        FROM CALBRIDGE_PROD.RAW.AD_CAMPAIGN
        WHERE client_id = ?
          AND campaign_id IS NULL
          AND date >= DATEADD('day', -7, CURRENT_DATE())
      `, [clientId]],
      pass:      (cnt) => cnt === 0,
    },
    // Check 2: No negative spend in recent ads data
    {
      table:     'CALBRIDGE_PROD.RAW.AD_CAMPAIGN',
      assertion: 'spend_not_negative',
      checkType: 'range_check',
      sql:       (clientId, accountId) => [`
        SELECT COUNT(*) AS cnt
        FROM CALBRIDGE_PROD.RAW.AD_CAMPAIGN
        WHERE client_id = ?
          AND cost < 0
          AND date >= DATEADD('day', -7, CURRENT_DATE())
      `, [clientId]],
      pass:      (cnt) => cnt === 0,
    },
    // Check 3: RAW.AD_CAMPAIGN has at least one row in the last 3 days
    {
      table:     'CALBRIDGE_PROD.RAW.AD_CAMPAIGN',
      assertion: 'row_count_gt_0_3d',
      checkType: 'row_count',
      sql:       (clientId, accountId) => [`
        SELECT COUNT(*) AS cnt
        FROM CALBRIDGE_PROD.RAW.AD_CAMPAIGN
        WHERE client_id = ?
          AND date >= DATEADD('day', -3, CURRENT_DATE())
      `, [clientId]],
      pass:      (cnt) => cnt > 0,
      warn:      true, // WARN not FAIL — data may just be new
    },
    // Check 4: No rows with zero impressions AND zero clicks AND non-zero spend
    {
      table:     'CALBRIDGE_PROD.RAW.AD_CAMPAIGN',
      assertion: 'no_ghost_spend',
      checkType: 'anomaly',
      sql:       (clientId, accountId) => [`
        SELECT COUNT(*) AS cnt
        FROM CALBRIDGE_PROD.RAW.AD_CAMPAIGN
        WHERE client_id = ?
          AND impressions = 0 AND clicks = 0 AND cost > 0
          AND date >= DATEADD('day', -7, CURRENT_DATE())
      `, [clientId]],
      pass:      (cnt) => cnt === 0,
    },
  ];

  for (const { accountId, clientId } of accounts) {
    for (const check of checks) {
      try {
        const [sql, params] = check.sql(clientId, accountId);
        const rows = await query(sql, params);
        const cnt  = Number(rows?.[0]?.CNT || rows?.[0]?.cnt || 0);
        const pass = check.pass(cnt);
        const status = pass ? 'PASS' : (check.warn ? 'WARN' : 'FAIL');

        if (!pass) failures++;

        const logId = require('crypto').randomUUID();
        await query(`
          INSERT INTO CALBRIDGE_PROD.PIPELINE.QUALITY_LOG
            (log_id, run_id, checked_at, table_name, account_id, client_id,
             assertion, check_type, status, rows_checked, rows_failed, failure_detail)
          VALUES
            (?, ?, CURRENT_TIMESTAMP(), ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [logId,
          logRunId,
          check.table,
          accountId, clientId,
          check.assertion,
          check.checkType,
          status,
          cnt,             // rows_checked (for this check, cnt is the anomaly count)
          pass ? 0 : cnt,  // rows_failed
          pass ? null : `Found ${cnt} rows failing assertion: ${check.assertion}`,
        ]);

        checksRun++;
        if (!pass) {
          console.warn(`[qualityCheck] ${status}: ${check.assertion} on ${accountId} — ${cnt} rows`);
        }
      } catch (err) {
        // Don't fail the whole job for one bad check
        console.warn(`[qualityCheck] Check ${check.assertion} for ${accountId} error:`, err.message);
      }
    }
    await sleep(100);
  }

  await completeJob(runId, { rowsRead: checksRun, rowsWritten: checksRun });
  console.log(`[qualityCheck] ✅ ${checksRun} checks run, ${failures} failures`);
  return { checksRun, failures };
}

// ─── Job 3: compute_freshness ─────────────────────────────────────────────────

/**
 * Update PIPELINE.FRESHNESS for all active (table, account) pairs.
 * Sets is_stale based on staleness_threshold_hours.
 */
async function computeFreshness({ triggeredBy = 'cron' } = {}) {
  const accounts = await getActiveAccounts();
  if (!accounts.length) return;

  const runId = await startJob('compute_freshness', 'system', triggeredBy);

  const tables = [
    { table: 'CALBRIDGE_PROD.ANALYTICS.ADS_PERFORMANCE',    tsColumn: 'updated_at' },
    { table: 'CALBRIDGE_PROD.ANALYTICS.RETAIL_PERFORMANCE', tsColumn: 'updated_at' },
    { table: 'CALBRIDGE_PROD.ANALYTICS.INVENTORY_SNAPSHOT', tsColumn: 'updated_at' },
  ];

  let updated = 0;

  for (const { accountId, clientId } of accounts) {
    for (const { table, tsColumn } of tables) {
      try {
        // Get last successful load time and latest date for this table+account
        const rows = await query(`
          SELECT
            MAX(${tsColumn})   AS last_load_at,
            NULL AS last_report_date,  -- skipped: date col varies per table
            COUNT(*)           AS row_count
          FROM ${table}
          WHERE client_id = ? AND account_id = ?
        `, [clientId, accountId]).catch(() => null);

        if (!rows) continue;

        const lastLoadAt = rows[0]?.LAST_LOAD_AT || rows[0]?.last_load_at;

        await query(`
          MERGE INTO CALBRIDGE_PROD.PIPELINE.FRESHNESS tgt
          USING (SELECT ? AS table_name, ? AS account_id, ? AS client_id) src
          ON tgt.table_name = src.table_name AND tgt.account_id = src.account_id AND tgt.client_id = src.client_id
          WHEN MATCHED THEN UPDATE SET
            last_successful_load_at    = ?,
            last_successful_report_date = ?,
            row_count_last_run         = ?,
            is_stale                   = CASE WHEN ? IS NULL OR DATEDIFF('hour', ?, CURRENT_TIMESTAMP()) > staleness_threshold_hours THEN TRUE ELSE FALSE END,
            updated_at                 = CURRENT_TIMESTAMP()
          WHEN NOT MATCHED THEN INSERT
            (table_name, account_id, client_id, last_successful_load_at, last_successful_report_date,
             row_count_last_run, is_stale, staleness_threshold_hours, updated_at)
          VALUES
            (?, ?, ?, ?, ?, ?, CASE WHEN ? IS NULL THEN TRUE ELSE FALSE END, 25, CURRENT_TIMESTAMP())
        `, [
          table, accountId, clientId,
          // WHEN MATCHED
          lastLoadAt,
          rows[0]?.LAST_REPORT_DATE || rows[0]?.last_report_date,
          Number(rows[0]?.ROW_COUNT || rows[0]?.row_count || 0),
          lastLoadAt, lastLoadAt,
          // WHEN NOT MATCHED
          table, accountId, clientId,
          lastLoadAt,
          rows[0]?.LAST_REPORT_DATE || rows[0]?.last_report_date,
          Number(rows[0]?.ROW_COUNT || rows[0]?.row_count || 0),
          lastLoadAt,
        ]);

        updated++;
      } catch (err) {
        console.warn(`[computeFreshness] ${table}/${accountId}:`, err.message);
      }
    }
    await sleep(100);
  }

  await completeJob(runId, { rowsWritten: updated });
  console.log(`[computeFreshness] ✅ Updated ${updated} freshness entries`);
  return { updated };
}

// ─── Job 4: reconcile_missing_partitions ─────────────────────────────────────

/**
 * Find date gaps in ANALYTICS.ADS_PERFORMANCE by account.
 * Logs gaps — does not fill them (backfill_date_range does that).
 *
 * A "gap" is any calendar date in the last 30 days where an active account
 * has zero rows in ADS_PERFORMANCE.
 */
async function reconcileMissingPartitions({ triggeredBy = 'cron' } = {}) {
  const accounts = await getActiveAccounts();
  if (!accounts.length) return;

  const runId = await startJob('reconcile_missing_partitions', 'system', triggeredBy);
  let gaps = 0;

  for (const { accountId, clientId } of accounts) {
    try {
      // Find dates in last 30 days with no ADS_PERFORMANCE rows for this account
      const missing = await query(`
        WITH date_spine AS (
          SELECT DATEADD('day', SEQ4() - 30, CURRENT_DATE()) AS d
          FROM TABLE(GENERATOR(ROWCOUNT => 31))
          WHERE d <= CURRENT_DATE() - 1
        )
        SELECT d.d AS missing_date
        FROM date_spine d
        LEFT JOIN (
          SELECT DISTINCT date
          FROM CALBRIDGE_PROD.ANALYTICS.ADS_PERFORMANCE
          WHERE client_id = ? AND account_id = ?
        ) a ON a.date = d.d
        WHERE a.date IS NULL
        ORDER BY d.d
      `, [clientId, accountId]);

      if (missing?.length > 0) {
        const missingDates = missing.map(r => r.MISSING_DATE || r.missing_date).join(', ');
        console.warn(`[reconcile] ${accountId}: ${missing.length} missing date(s): ${missingDates}`);
        gaps += missing.length;

        // Log as a quality issue so it's visible
        await query(`
          INSERT INTO CALBRIDGE_PROD.PIPELINE.QUALITY_LOG
            (log_id, run_id, checked_at, table_name, account_id, client_id,
             assertion, check_type, status, rows_checked, rows_failed, failure_detail)
          VALUES
            (require('crypto').randomUUID(), ?, CURRENT_TIMESTAMP(), 'CALBRIDGE_PROD.ANALYTICS.ADS_PERFORMANCE',
             ?, ?, 'no_missing_partitions', 'row_count', 'WARN', 30, ?, ?)
        `, [
          uuidv4(),
          accountId, clientId,
          missing.length,
          `Missing ${missing.length} date(s) in last 30 days: ${missingDates.substring(0, 500)}`,
        ]).catch(() => {});
      }
    } catch (err) {
      console.warn(`[reconcile] ${accountId}:`, err.message);
    }
    await sleep(100);
  }

  await completeJob(runId, { rowsRead: accounts.length * 30, rowsWritten: gaps });
  console.log(`[reconcile] ✅ Found ${gaps} missing partition(s) across ${accounts.length} account(s)`);
  return { gaps };
}

module.exports = {
  stageRawData,
  runQualityChecks,
  computeFreshness,
  reconcileMissingPartitions,
};
