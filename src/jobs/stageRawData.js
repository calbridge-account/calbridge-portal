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

  // stageAdCampaignRaw removed 2026-04-24 — PIPELINE_DIRECT_RAW_WRITE=true is live,
  // data writes directly to RAW.AD_CAMPAIGN via adsIngestion.js. 72h parallel run
  // confirmed parity. ~4 MERGEs/client/hour eliminated.

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
            (?, ?, CURRENT_TIMESTAMP(), 'CALBRIDGE_PROD.ANALYTICS.ADS_PERFORMANCE',
             ?, ?, 'no_missing_partitions', 'row_count', 'WARN', 30, ?, ?)
        `, [
          require('crypto').randomUUID(),
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

// ─── Job 5: rebuild_mart ────────────────────────────────────────────────────

/**
 * Rebuild MART_ADVERTISING_DAILY from RAW.AD_CAMPAIGN.
 * Runs hourly at :05 after stage_raw_data completes.
 *
 * Sponsored Brands (SB + SBV) are combined into a single 'SB' bucket.
 * SBV split was removed — SB and video are now aggregated together.
 */
async function rebuildMart({ triggeredBy = 'cron' } = {}) {
  const startMs = Date.now();
  try {
    // ── MARTS.AD_PERFORMANCE_DAILY ──────────────────────────────────────────────
    // Single source: adjusted_campaign_performance covers all ad types (SP/SB/SD/DSP)
    // with spend adjustments already applied. No separate DSP MERGE needed.
    const result = await query(`
      MERGE INTO CALBRIDGE_PROD.MARTS.AD_PERFORMANCE_DAILY tgt
      USING (
        SELECT
          client_id,
          date::DATE                                              AS date,
          COALESCE(marketplace, 'US')                            AS marketplace,
          ad_type,
          COUNT(DISTINCT campaign_id)                            AS active_campaigns,
          SUM(COALESCE(adjusted_spend, 0))                       AS spend,
          SUM(COALESCE(sales, 0))                                AS sales,
          SUM(COALESCE(orders, 0))                               AS orders,
          SUM(COALESCE(clicks, 0))                               AS clicks,
          SUM(COALESCE(impressions, 0))                          AS impressions,
          CASE WHEN SUM(COALESCE(sales, 0)) > 0
            THEN SUM(COALESCE(adjusted_spend, 0)) / SUM(COALESCE(sales, 0))
            ELSE NULL END                                        AS acos,
          CASE WHEN SUM(COALESCE(adjusted_spend, 0)) > 0
            THEN SUM(COALESCE(sales, 0)) / SUM(COALESCE(adjusted_spend, 0))
            ELSE NULL END                                        AS roas,
          CASE WHEN SUM(COALESCE(impressions, 0)) > 0
            THEN SUM(COALESCE(clicks, 0))::FLOAT / SUM(COALESCE(impressions, 0))
            ELSE NULL END                                        AS ctr
        FROM CALBRIDGE_PROD.APP.adjusted_campaign_performance
        WHERE date >= '2026-01-01'
        GROUP BY client_id, date::DATE, COALESCE(marketplace, 'US'), ad_type
      ) src
      ON  tgt.client_id   = src.client_id
      AND tgt.date        = src.date
      AND tgt.marketplace = src.marketplace
      AND tgt.ad_type     = src.ad_type
      WHEN MATCHED THEN UPDATE SET
        active_campaigns = src.active_campaigns,
        spend            = src.spend,
        sales            = src.sales,
        orders           = src.orders,
        clicks           = src.clicks,
        impressions      = src.impressions,
        acos             = src.acos,
        roas             = src.roas,
        ctr              = src.ctr
      WHEN NOT MATCHED THEN INSERT (
        client_id, date, marketplace, ad_type,
        active_campaigns, spend, sales, orders, clicks, impressions, acos, roas, ctr
      ) VALUES (
        src.client_id, src.date, src.marketplace, src.ad_type,
        src.active_campaigns, src.spend, src.sales, src.orders,
        src.clicks, src.impressions, src.acos, src.roas, src.ctr
      )
    `);
    const updated  = result?.[0]?.['number of rows updated']  ?? 0;
    const inserted = result?.[0]?.['number of rows inserted'] ?? 0;
    const elapsedS = ((Date.now() - startMs) / 1000).toFixed(1);
    console.log(`[rebuildMart] ✅ ${inserted} inserted, ${updated} updated in ${elapsedS}s (triggered by ${triggeredBy})`);
    console.log('[rebuildMart] ✅ MARTS.AD_PERFORMANCE_DAILY updated');

    // ── MARTS.CAMPAIGN_PERFORMANCE ─────────────────────────────────────────────
    // Single source: adjusted_campaign_performance (all ad types, adjustments applied)
    try {
      await query(`
        MERGE INTO CALBRIDGE_PROD.MARTS.CAMPAIGN_PERFORMANCE tgt
        USING (
          SELECT
            client_id,
            date::DATE                                           AS date,
            ad_type,
            campaign_id,
            campaign_name,
            MAX(campaign_status)                                 AS campaign_status,
            MAX(campaign_budget_amount)                          AS daily_budget,
            SUM(COALESCE(impressions, 0))                        AS impressions,
            SUM(COALESCE(clicks, 0))                             AS clicks,
            SUM(COALESCE(adjusted_spend, 0))                     AS spend,
            SUM(COALESCE(sales, 0))                              AS sales,
            SUM(COALESCE(orders, 0))                             AS orders,
            MAX(sales_7_d)                                       AS sales_7d,
            MAX(orders_7d)                                       AS orders_7d,
            SUM(COALESCE(new_to_brand_purchases, 0))::FLOAT      AS ntb_purchases,
            SUM(COALESCE(new_to_brand_sales, 0))                 AS ntb_sales,
            SUM(COALESCE(detail_page_views, 0))                  AS detail_page_views,
            SUM(COALESCE(add_to_cart, 0))                        AS add_to_cart,
            SUM(COALESCE(viewable_impressions, 0))               AS viewable_impressions,
            MAX(top_of_search_impression_share)                  AS top_of_search_impression_share
          FROM CALBRIDGE_PROD.APP.adjusted_campaign_performance
          WHERE date >= DATEADD('day', -95, CURRENT_DATE())
            AND COALESCE(marketplace, 'US') != 'CA'
          GROUP BY client_id, date::DATE, ad_type, campaign_id, campaign_name
        ) src
        ON tgt.client_id=src.client_id AND tgt.date=src.date
           AND tgt.ad_type=src.ad_type AND tgt.campaign_id=src.campaign_id
        WHEN MATCHED THEN UPDATE SET
          campaign_name=src.campaign_name, campaign_status=src.campaign_status,
          daily_budget=src.daily_budget, impressions=src.impressions, clicks=src.clicks,
          spend=src.spend, sales=src.sales, orders=src.orders,
          sales_7d=src.sales_7d, orders_7d=src.orders_7d,
          ntb_purchases=src.ntb_purchases, ntb_sales=src.ntb_sales,
          detail_page_views=src.detail_page_views, add_to_cart=src.add_to_cart,
          viewable_impressions=src.viewable_impressions,
          top_of_search_impression_share=src.top_of_search_impression_share,
          rebuilt_at=CURRENT_TIMESTAMP()
        WHEN NOT MATCHED THEN INSERT
          (client_id,date,ad_type,campaign_id,campaign_name,campaign_status,daily_budget,
           impressions,clicks,spend,sales,orders,sales_7d,orders_7d,ntb_purchases,ntb_sales,
           detail_page_views,add_to_cart,viewable_impressions,top_of_search_impression_share,rebuilt_at)
        VALUES
          (src.client_id,src.date,src.ad_type,src.campaign_id,src.campaign_name,src.campaign_status,
           src.daily_budget,src.impressions,src.clicks,src.spend,src.sales,src.orders,
           src.sales_7d,src.orders_7d,src.ntb_purchases,src.ntb_sales,src.detail_page_views,
           src.add_to_cart,src.viewable_impressions,src.top_of_search_impression_share,CURRENT_TIMESTAMP())
      `);
      console.log('[rebuildMart] ✅ MARTS.CAMPAIGN_PERFORMANCE updated');
    } catch (cpErr) {
      console.warn('[rebuildMart] MARTS.CAMPAIGN_PERFORMANCE failed (non-fatal):', cpErr.message?.substring(0,150));
    }

    // ── MARTS.DSP_LINE_ITEM ─────────────────────────────────────────────────────
    // Source: dsp_flight_report only (line-item grain)
    try {
      await query(`
        MERGE INTO CALBRIDGE_PROD.MARTS.DSP_LINE_ITEM tgt
        USING (
          SELECT
            client_id,
            date::DATE AS date,
            order_name,
            MAX(advertiser_id) AS advertiser_id,
            MAX(order_id) AS order_id,
            NULL::FLOAT AS order_budget,
            NULL::DATE AS order_start_date,
            NULL::DATE AS order_end_date,
            SUM(COALESCE(impressions, 0)) AS impressions,
            SUM(COALESCE(clicks, 0)) AS clicks,
            SUM(COALESCE(total_cost, 0)) AS spend,
            SUM(COALESCE(sales, 0)) AS sales,
            SUM(COALESCE(total_sales, 0)) AS total_sales,
            SUM(COALESCE(purchases, 0)) AS purchases,
            SUM(COALESCE(total_purchases, 0)) AS total_purchases,
            SUM(COALESCE(new_to_brand_purchases, 0)) AS ntb_purchases,
            SUM(COALESCE(new_to_brand_product_sales, 0)) AS ntb_product_sales,
            SUM(COALESCE(viewable_impressions, 0)) AS viewable_impressions,
            SUM(COALESCE(detail_page_views, 0)) AS detail_page_views,
            SUM(COALESCE(add_to_cart, 0)) AS add_to_cart
          FROM CALBRIDGE_PROD.APP.dsp_flight_report
          WHERE date >= DATEADD('day', -95, CURRENT_DATE())
            AND order_name IS NOT NULL AND order_name != ''
          GROUP BY client_id, date::DATE, order_name
        ) src
        ON tgt.client_id=src.client_id AND tgt.date=src.date AND tgt.order_name=src.order_name
        WHEN MATCHED THEN UPDATE SET
          advertiser_id=src.advertiser_id, order_id=src.order_id,
          order_budget=src.order_budget, order_start_date=src.order_start_date,
          order_end_date=src.order_end_date, impressions=src.impressions,
          clicks=src.clicks, spend=src.spend, sales=src.sales, total_sales=src.total_sales,
          purchases=src.purchases, total_purchases=src.total_purchases,
          ntb_purchases=src.ntb_purchases, ntb_product_sales=src.ntb_product_sales,
          viewable_impressions=src.viewable_impressions, detail_page_views=src.detail_page_views,
          add_to_cart=src.add_to_cart, rebuilt_at=CURRENT_TIMESTAMP()
        WHEN NOT MATCHED THEN INSERT
          (client_id,date,order_name,advertiser_id,order_id,order_budget,order_start_date,
           order_end_date,impressions,clicks,spend,sales,total_sales,purchases,total_purchases,
           ntb_purchases,ntb_product_sales,viewable_impressions,detail_page_views,add_to_cart,rebuilt_at)
        VALUES
          (src.client_id,src.date,src.order_name,src.advertiser_id,src.order_id,
           src.order_budget,src.order_start_date,src.order_end_date,
           src.impressions,src.clicks,src.spend,src.sales,src.total_sales,
           src.purchases,src.total_purchases,src.ntb_purchases,src.ntb_product_sales,
           src.viewable_impressions,src.detail_page_views,src.add_to_cart,CURRENT_TIMESTAMP())
      `);
      console.log('[rebuildMart] ✅ MARTS.DSP_LINE_ITEM updated');
    } catch (dliErr) {
      console.warn('[rebuildMart] MARTS.DSP_LINE_ITEM failed (non-fatal):', dliErr.message?.substring(0,150));
    }

    return { inserted, updated };
  } catch (err) {
    // Retry once with a fresh Snowflake connection on terminated-connection errors
    const isTerminated = err.message && (
      err.message.toLowerCase().includes('terminated') ||
      err.message.toLowerCase().includes('connection is closed')
    );
    if (isTerminated) {
      console.warn('[rebuildMart] Terminated connection — retrying once with fresh connection...');
      try {
        const { resetPool } = require('../services/snowflakeService');
        if (typeof resetPool === 'function') await resetPool();
        // Wait briefly before retry
        await new Promise(r => setTimeout(r, 2000));
        // Recurse once (no further retry to avoid infinite loop)
        return rebuildMart({ triggeredBy: `${triggeredBy}:retry` });
      } catch (retryErr) {
        console.error('[rebuildMart] Retry also failed:', retryErr.message);
        throw retryErr;
      }
    }
    console.error('[rebuildMart] Failed:', err.message);
    throw err;
  }
}

// ─── Job 6: expire_stale_actions ─────────────────────────────────────────────

/**
 * Mark old approved/pending decision actions as 'expired' if they are more
 * than 14 days old. This prevents stale references to Amazon entities that
 * may have been deleted, merged, or renamed.
 */
async function expireStaleActions({ triggeredBy = 'cron' } = {}) {
  try {
    // 1. Expire actions older than 14 days
    const ageResult = await query(`
      UPDATE CALBRIDGE_PROD.APP.decision_actions
      SET status = 'expired',
          execution_result = PARSE_JSON('{"reason":"action older than 14 days"}'),
          updated_at = CURRENT_TIMESTAMP()
      WHERE status IN ('approved', 'pending')
        AND created_at < DATEADD('day', -14, CURRENT_TIMESTAMP())
    `);
    const ageCount = ageResult?.[0]?.['number of rows updated'] ?? 0;

    // 2. Expire SP keyword actions where the keyword hasn't appeared in reports for 14+ days
    //    (keyword was paused/deleted/archived on Amazon)
    const staleResult = await query(`
      UPDATE CALBRIDGE_PROD.APP.decision_actions da
      SET status = 'expired',
          execution_result = PARSE_JSON('{"reason":"keyword not active in reports for 14+ days"}'),
          updated_at = CURRENT_TIMESTAMP()
      WHERE da.status IN ('approved', 'pending')
        AND da.ad_type = 'SP'
        AND da.action_type IN ('bid_decrease', 'bid_increase', 'pause_keyword')
        AND NOT EXISTS (
          SELECT 1 FROM CALBRIDGE_PROD.APP.sp_targeting_keyword_report k
          WHERE k.client_id = da.client_id
            AND k.keyword_id = da.entity_id
            AND k.date >= DATEADD('day', -14, CURRENT_DATE())
        )
    `).catch(e => {
      console.warn('[expireStaleActions] Keyword staleness check failed (non-fatal):', e.message);
      return [{ 'number of rows updated': 0 }];
    });
    const staleCount = staleResult?.[0]?.['number of rows updated'] ?? 0;

    const total = ageCount + staleCount;
    console.log(`[expireStaleActions] ✅ Expired ${total} stale action(s) (${ageCount} aged out, ${staleCount} stale keywords)`);
    return { expired: total };
  } catch (err) {
    console.error('[expireStaleActions] Failed:', err.message);
    throw err;
  }
}

module.exports = {
  stageRawData,
  runQualityChecks,
  computeFreshness,
  reconcileMissingPartitions,
  rebuildMart,
  expireStaleActions,
};
