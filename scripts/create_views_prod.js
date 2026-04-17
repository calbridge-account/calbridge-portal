#!/usr/bin/env node
/**
 * Create views in CALBRIDGE_PROD.APP + update ADJUSTED_AD_CAMPAIGN in RAW
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { query } = require('../src/services/snowflakeService');

async function run(label, sql) {
  console.log(`  → ${label}`);
  try {
    await query(sql);
    console.log(`    ✅ done`);
  } catch (e) {
    console.error(`    ❌ ${e.message.substring(0, 200)}`);
  }
}

async function main() {
  console.log('=== Creating views in CALBRIDGE_PROD ===\n');

  // campaign_performance
  await run('CALBRIDGE_PROD.APP.CAMPAIGN_PERFORMANCE', `
    CREATE OR REPLACE VIEW CALBRIDGE_PROD.APP.CAMPAIGN_PERFORMANCE AS
    SELECT client_id, profile_id, campaign_id, campaign_name, campaign_status,
      campaign_budget_amount, campaign_budget_currency_code,
      CASE COALESCE(campaign_budget_currency_code,'USD') WHEN 'CAD' THEN 'CA' ELSE 'US' END AS marketplace,
      'SP' AS ad_type, date,
      cost AS spend, impressions, clicks,
      sales_30_d AS sales, purchases_30_d AS orders, units_sold_clicks_30_d AS units_sold,
      sales_7_d, purchases_7_d AS orders_7d,
      top_of_search_impression_share,
      NULL::FLOAT AS new_to_brand_purchases, NULL::FLOAT AS new_to_brand_sales,
      NULL::FLOAT AS new_to_brand_units_sold,
      NULL::FLOAT AS detail_page_views, NULL::FLOAT AS add_to_cart,
      NULL::FLOAT AS viewability_rate, NULL::FLOAT AS roas_direct,
      NULL::FLOAT AS video_ad_complete, NULL::FLOAT AS video_ad_start,
      NULL::FLOAT AS viewable_impressions,
      NULL::FLOAT AS order_budget, NULL::DATE AS order_start_date, NULL::DATE AS order_end_date,
      NULL::FLOAT AS total_purchases, NULL::FLOAT AS dpv_rate
    FROM CALBRIDGE_PROD.APP.sp_campaign_report
    WHERE COALESCE(campaign_budget_currency_code, 'USD') != 'CAD'

    UNION ALL

    -- CA Sponsored Products (separate account, excluded from default US view)
    SELECT client_id, profile_id, campaign_id, campaign_name, campaign_status,
      campaign_budget_amount, campaign_budget_currency_code,
      'CA' AS marketplace,
      'SP' AS ad_type, date,
      cost AS spend, impressions, clicks,
      sales_30_d AS sales, purchases_30_d AS orders, units_sold_clicks_30_d AS units_sold,
      sales_7_d, purchases_7_d AS orders_7d,
      top_of_search_impression_share,
      NULL::FLOAT AS new_to_brand_purchases, NULL::FLOAT AS new_to_brand_sales,
      NULL::FLOAT AS new_to_brand_units_sold,
      NULL::FLOAT AS detail_page_views, NULL::FLOAT AS add_to_cart,
      NULL::FLOAT AS viewability_rate, NULL::FLOAT AS roas_direct,
      NULL::FLOAT AS video_ad_complete, NULL::FLOAT AS video_ad_start,
      NULL::FLOAT AS viewable_impressions,
      NULL::FLOAT AS order_budget, NULL::DATE AS order_start_date, NULL::DATE AS order_end_date,
      NULL::FLOAT AS total_purchases, NULL::FLOAT AS dpv_rate
    FROM CALBRIDGE_PROD.APP.sp_campaign_report
    WHERE campaign_budget_currency_code = 'CAD'

    UNION ALL

    SELECT client_id, profile_id, campaign_id, campaign_name, campaign_status,
      campaign_budget_amount, campaign_budget_currency_code,
      CASE COALESCE(campaign_budget_currency_code,'USD') WHEN 'CAD' THEN 'CA' ELSE 'US' END AS marketplace,
      'SB' AS ad_type, report_date AS date,
      cost AS spend, impressions, clicks,
      sales AS sales, purchases AS orders, units_sold,
      NULL::FLOAT AS sales_7d, NULL::FLOAT AS orders_7d,
      top_of_search_impression_share,
      new_to_brand_purchases::FLOAT, new_to_brand_sales,
      new_to_brand_units_sold::FLOAT, detail_page_views::FLOAT,
      add_to_cart::FLOAT, viewability_rate, NULL::FLOAT AS roas_direct,
      NULL::FLOAT AS video_ad_complete, NULL::FLOAT AS video_ad_start,
      NULL::FLOAT AS viewable_impressions,
      NULL::FLOAT AS order_budget, NULL::DATE AS order_start_date, NULL::DATE AS order_end_date,
      NULL::FLOAT AS total_purchases, NULL::FLOAT AS dpv_rate
    FROM CALBRIDGE_PROD.APP.sb_campaign_report
    WHERE COALESCE(campaign_budget_currency_code, 'USD') != 'CAD'

    UNION ALL

    -- CA Sponsored Brands
    SELECT client_id, profile_id, campaign_id, campaign_name, campaign_status,
      campaign_budget_amount, campaign_budget_currency_code,
      'CA' AS marketplace,
      'SB' AS ad_type, report_date AS date,
      cost AS spend, impressions, clicks,
      sales AS sales, purchases AS orders, units_sold,
      NULL::FLOAT AS sales_7d, NULL::FLOAT AS orders_7d,
      top_of_search_impression_share,
      new_to_brand_purchases::FLOAT, new_to_brand_sales,
      new_to_brand_units_sold::FLOAT, detail_page_views::FLOAT,
      add_to_cart::FLOAT, viewability_rate, NULL::FLOAT AS roas_direct,
      NULL::FLOAT AS video_ad_complete, NULL::FLOAT AS video_ad_start,
      NULL::FLOAT AS viewable_impressions,
      NULL::FLOAT AS order_budget, NULL::DATE AS order_start_date, NULL::DATE AS order_end_date,
      NULL::FLOAT AS total_purchases, NULL::FLOAT AS dpv_rate
    FROM CALBRIDGE_PROD.APP.sb_campaign_report
    WHERE campaign_budget_currency_code = 'CAD'

    UNION ALL

    SELECT client_id, profile_id, campaign_id, campaign_name, campaign_status,
      campaign_budget_amount, campaign_budget_currency_code,
      'US' AS marketplace,
      'SD' AS ad_type, date,
      cost AS spend, impressions, clicks,
      sales, purchases AS orders, units_sold,
      NULL::FLOAT AS sales_7d, NULL::FLOAT AS orders_7d,
      NULL::FLOAT AS top_of_search_impression_share,
      new_to_brand_purchases::FLOAT, new_to_brand_sales,
      new_to_brand_units_sold::FLOAT, detail_page_views::FLOAT,
      add_to_cart::FLOAT, viewability_rate, NULL::FLOAT AS roas_direct,
      NULL::FLOAT AS video_ad_complete, NULL::FLOAT AS video_ad_start,
      NULL::FLOAT AS viewable_impressions,
      NULL::FLOAT AS order_budget, NULL::DATE AS order_start_date, NULL::DATE AS order_end_date,
      NULL::FLOAT AS total_purchases, NULL::FLOAT AS dpv_rate
    FROM CALBRIDGE_PROD.APP.sd_campaign_report

    UNION ALL

    -- DSP: join dsp_raw_flight (spend incl. agency fees, per source_platform)
    -- with dsp_raw_campaign (attributed sales) on (client_id, source_platform, order_name, date).
    -- This gives correct total_cost per Amazon console + correct total_sales attribution.
    -- No translations — data exactly as Amazon returns it.
    SELECT
      f.client_id,
      f.profile_id,
      f.order_id                            AS campaign_id,
      f.order_name                          AS campaign_name,
      'ACTIVE'                              AS campaign_status,
      c.order_budget::FLOAT                 AS campaign_budget_amount,
      NULL::VARCHAR                         AS campaign_budget_currency_code,
      'US'                                  AS marketplace,
      'DSP'                                 AS ad_type,
      f.date,
      f.total_cost                          AS spend,
      f.impressions,
      f.clicks,
      COALESCE(c.total_sales, f.total_sales) AS sales,
      c.total_purchases::FLOAT              AS orders,
      NULL::FLOAT                           AS units_sold,
      NULL::FLOAT                           AS sales_7d,
      NULL::FLOAT                           AS orders_7d,
      NULL::FLOAT                           AS top_of_search_impression_share,
      c.new_to_brand_purchases::FLOAT       AS new_to_brand_purchases,
      c.new_to_brand_product_sales          AS new_to_brand_sales,
      NULL::FLOAT                           AS new_to_brand_units_sold,
      c.detail_page_views::FLOAT            AS detail_page_views,
      c.add_to_cart::FLOAT                  AS add_to_cart,
      f.viewability_rate                    AS viewability_rate,
      NULL::FLOAT                           AS roas_direct,
      f.video_ad_complete::FLOAT            AS video_ad_complete,
      f.video_ad_start::FLOAT               AS video_ad_start,
      f.viewable_impressions::FLOAT         AS viewable_impressions,
      c.order_budget::FLOAT                 AS order_budget,
      c.order_start_date::DATE              AS order_start_date,
      c.order_end_date::DATE                AS order_end_date,
      c.total_purchases::FLOAT              AS total_purchases,
      (f.detail_page_views / NULLIF(f.impressions, 0))::FLOAT AS dpv_rate
    FROM CALBRIDGE_PROD.APP.dsp_raw_flight f
    LEFT JOIN (
      -- Key on (client_id, profile_id, order_id, date) — exact ID match, no name ambiguity.
      -- All rows now have canonical order_ids from the backfill and live ingestion.
      SELECT client_id, profile_id, order_id, order_name, date,
             MAX(total_sales)             AS total_sales,
             MAX(total_purchases)         AS total_purchases,
             MAX(new_to_brand_purchases)  AS new_to_brand_purchases,
             MAX(new_to_brand_product_sales) AS new_to_brand_product_sales,
             MAX(detail_page_views)       AS detail_page_views,
             MAX(add_to_cart)             AS add_to_cart,
             MAX(order_budget)            AS order_budget,
             MAX(order_start_date)        AS order_start_date,
             MAX(order_end_date)          AS order_end_date
      FROM CALBRIDGE_PROD.APP.dsp_raw_campaign
      GROUP BY client_id, profile_id, order_id, order_name, date
    ) c
      ON  c.client_id  = f.client_id
      AND c.profile_id = f.profile_id
      AND c.order_id   = f.order_id
      AND c.date       = f.date
  `);

  // adjusted_campaign_performance
  await run('CALBRIDGE_PROD.APP.ADJUSTED_CAMPAIGN_PERFORMANCE', `
    CREATE OR REPLACE VIEW CALBRIDGE_PROD.APP.ADJUSTED_CAMPAIGN_PERFORMANCE AS
    SELECT
      cp.*,
      cp.spend * COALESCE(
        sa_exact.multiplier,
        sa_sa.multiplier,
        sa_all.multiplier,
        1.0
      ) AS adjusted_spend
    FROM CALBRIDGE_PROD.APP.CAMPAIGN_PERFORMANCE cp
    LEFT JOIN CALBRIDGE_PROD.APP.SPEND_ADJUSTMENTS sa_exact
      ON  sa_exact.client_id  = cp.client_id
      AND sa_exact.year_month = TO_VARCHAR(cp.date, 'YYYY-MM')
      AND sa_exact.ad_type    = cp.ad_type
    LEFT JOIN CALBRIDGE_PROD.APP.SPEND_ADJUSTMENTS sa_sa
      ON  sa_sa.client_id  = cp.client_id
      AND sa_sa.year_month = TO_VARCHAR(cp.date, 'YYYY-MM')
      AND sa_sa.ad_type    = 'SA'
      AND cp.ad_type IN ('SP', 'SB', 'SD')
    LEFT JOIN CALBRIDGE_PROD.APP.SPEND_ADJUSTMENTS sa_all
      ON  sa_all.client_id  = cp.client_id
      AND sa_all.year_month = TO_VARCHAR(cp.date, 'YYYY-MM')
      AND sa_all.ad_type    = 'ALL'
  `);

  // adjusted_dsp_campaign_report
  await run('CALBRIDGE_PROD.APP.ADJUSTED_DSP_CAMPAIGN_REPORT', `
    CREATE OR REPLACE VIEW CALBRIDGE_PROD.APP.ADJUSTED_DSP_CAMPAIGN_REPORT AS
    SELECT
      d.*,
      d.total_cost * COALESCE(
        sa_exact.multiplier,
        sa_all.multiplier,
        1.0
      ) AS adjusted_cost
    FROM CALBRIDGE_PROD.APP.dsp_campaign_report d
    LEFT JOIN CALBRIDGE_PROD.APP.SPEND_ADJUSTMENTS sa_exact
      ON  sa_exact.client_id  = d.client_id
      AND sa_exact.year_month = TO_VARCHAR(d.date, 'YYYY-MM')
      AND sa_exact.ad_type    = 'DSP'
    LEFT JOIN CALBRIDGE_PROD.APP.SPEND_ADJUSTMENTS sa_all
      ON  sa_all.client_id  = d.client_id
      AND sa_all.year_month = TO_VARCHAR(d.date, 'YYYY-MM')
      AND sa_all.ad_type    = 'ALL'
  `);

  // Update ADJUSTED_AD_CAMPAIGN in RAW to point at CALBRIDGE_PROD.APP.SPEND_ADJUSTMENTS
  await run('CALBRIDGE_PROD.RAW.ADJUSTED_AD_CAMPAIGN (update to use PROD spend_adjustments)', `
    CREATE OR REPLACE VIEW CALBRIDGE_PROD.RAW.ADJUSTED_AD_CAMPAIGN AS
    SELECT
      ac.*,
      ac.cost * COALESCE(
        sa_exact.multiplier,
        sa_sa.multiplier,
        sa_all.multiplier,
        1.0
      ) AS adjusted_cost
    FROM CALBRIDGE_PROD.RAW.AD_CAMPAIGN ac
    LEFT JOIN CALBRIDGE_PROD.APP.SPEND_ADJUSTMENTS sa_exact
      ON  sa_exact.client_id  = ac.client_id
      AND sa_exact.year_month = TO_VARCHAR(ac.date, 'YYYY-MM')
      AND sa_exact.ad_type    = CASE ac.ad_product
            WHEN 'SPONSORED_PRODUCTS' THEN 'SP'
            WHEN 'SPONSORED_BRANDS'   THEN 'SB'
            WHEN 'SPONSORED_DISPLAY'  THEN 'SD'
            WHEN 'DSP'                THEN 'DSP'
            ELSE ac.ad_product END
    LEFT JOIN CALBRIDGE_PROD.APP.SPEND_ADJUSTMENTS sa_sa
      ON  sa_sa.client_id  = ac.client_id
      AND sa_sa.year_month = TO_VARCHAR(ac.date, 'YYYY-MM')
      AND sa_sa.ad_type    = 'SA'
      AND ac.ad_product IN ('SPONSORED_PRODUCTS','SPONSORED_BRANDS','SPONSORED_DISPLAY')
    LEFT JOIN CALBRIDGE_PROD.APP.SPEND_ADJUSTMENTS sa_all
      ON  sa_all.client_id  = ac.client_id
      AND sa_all.year_month = TO_VARCHAR(ac.date, 'YYYY-MM')
      AND sa_all.ad_type    = 'ALL'
  `);

  console.log('\n=== Views created ===');
  process.exit(0);
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
