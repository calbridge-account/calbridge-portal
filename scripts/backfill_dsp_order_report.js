'use strict';
require('dotenv').config();
const { query } = require('../src/services/snowflakeService');

async function run() {
  console.log('Backfilling dsp_order_report from dsp_raw_campaign + dsp_raw_flight...');

  // ── 3a: CyberPower (all dates — SparkX historical + Calbridge current) ──────
  // FULL OUTER JOIN flight (spend) + campaign (attribution), dedup each side first
  const r1 = await query(`
    INSERT INTO CALBRIDGE_PROD.APP.dsp_order_report
      (advertiser_id, profile_id, client_id, date, order_id, order_name, advertiser_name,
       order_budget, order_start_date, order_end_date, order_currency, entity_id,
       impressions, clicks, total_cost, viewable_impressions, viewability_rate,
       detail_page_views, detail_page_view_clicks, add_to_cart, add_to_cart_clicks,
       purchases, purchases_clicks, total_purchases, total_purchases_clicks,
       sales, total_sales, new_to_brand_purchases, new_to_brand_purchases_clicks,
       new_to_brand_product_sales, video_ad_start, video_ad_complete, synced_at)
    SELECT
      COALESCE(f.advertiser_id,     c.advertiser_id),
      COALESCE(f.profile_id,        c.profile_id),
      COALESCE(f.client_id,         c.client_id),
      COALESCE(f.date,              c.date)::DATE,
      COALESCE(f.order_id,          c.order_id),
      COALESCE(f.order_name,        c.order_name),
      COALESCE(f.advertiser_name,   c.advertiser_name),
      c.order_budget, c.order_start_date, c.order_end_date, c.order_currency, c.entity_id,
      COALESCE(f.impressions,       c.impressions),
      COALESCE(f.clicks,            c.clicks),
      COALESCE(f.total_cost,        c.total_cost),
      COALESCE(f.viewable_impressions, c.viewable_impressions),
      COALESCE(f.viewability_rate,     c.viewability_rate),
      COALESCE(f.detail_page_views,    c.detail_page_views),
      c.detail_page_view_clicks,
      COALESCE(f.add_to_cart,       c.add_to_cart),
      c.add_to_cart_clicks,
      COALESCE(f.purchases,         c.purchases),
      c.purchases_clicks,
      COALESCE(f.total_purchases,   c.total_purchases),
      c.total_purchases_clicks,
      COALESCE(f.sales,             c.sales),
      COALESCE(f.total_sales,       c.total_sales),
      COALESCE(f.new_to_brand_purchases,     c.new_to_brand_purchases),
      c.new_to_brand_purchases_clicks,
      COALESCE(f.new_to_brand_product_sales, c.new_to_brand_product_sales),
      f.video_ad_start,
      f.video_ad_complete,
      CURRENT_TIMESTAMP()
    FROM (
      SELECT * FROM CALBRIDGE_PROD.APP.dsp_raw_flight
      WHERE client_id = '7d88ea17-002b-4a02-97fc-bcab1292d57e'
      QUALIFY ROW_NUMBER() OVER (PARTITION BY client_id, profile_id, order_id, date ORDER BY synced_at DESC) = 1
    ) f
    FULL OUTER JOIN (
      SELECT * FROM CALBRIDGE_PROD.APP.dsp_raw_campaign
      WHERE client_id = '7d88ea17-002b-4a02-97fc-bcab1292d57e'
      QUALIFY ROW_NUMBER() OVER (PARTITION BY client_id, profile_id, order_id, date ORDER BY synced_at DESC) = 1
    ) c
      ON  f.client_id  = c.client_id
      AND f.profile_id = c.profile_id
      AND f.order_id   = c.order_id
      AND f.date       = c.date
  `);
  const cp_rows = r1[0]?.['number of rows inserted'] ?? r1[0]?.NUMBER_OF_ROWS_INSERTED ?? JSON.stringify(r1[0]);
  console.log(`✅ CyberPower inserted: ${cp_rows} rows`);

  // ── 3b: Acer SparkX (from dsp_raw_campaign only) ──────────────────────────
  const r2 = await query(`
    INSERT INTO CALBRIDGE_PROD.APP.dsp_order_report
      (advertiser_id, profile_id, client_id, date, order_id, order_name, advertiser_name,
       order_budget, order_start_date, order_end_date, order_currency, entity_id,
       impressions, clicks, total_cost, viewable_impressions, viewability_rate,
       detail_page_views, detail_page_view_clicks, add_to_cart, add_to_cart_clicks,
       purchases, purchases_clicks, total_purchases, total_purchases_clicks,
       sales, total_sales, new_to_brand_purchases, new_to_brand_purchases_clicks,
       new_to_brand_product_sales, video_ad_start, video_ad_complete, synced_at)
    SELECT
      advertiser_id, profile_id, client_id, date::DATE, order_id, order_name, advertiser_name,
      order_budget, order_start_date, order_end_date, order_currency, entity_id,
      impressions, clicks, total_cost, viewable_impressions, viewability_rate,
      detail_page_views, detail_page_view_clicks, add_to_cart, add_to_cart_clicks,
      purchases, purchases_clicks, total_purchases, total_purchases_clicks,
      sales, total_sales, new_to_brand_purchases, new_to_brand_purchases_clicks,
      new_to_brand_product_sales, NULL::FLOAT, NULL::FLOAT, CURRENT_TIMESTAMP()
    FROM CALBRIDGE_PROD.APP.dsp_raw_campaign
    WHERE client_id = '929cea98-38a6-49ab-bffc-1d38b1f3cc60'
    QUALIFY ROW_NUMBER() OVER (PARTITION BY client_id, profile_id, order_id, date ORDER BY synced_at DESC) = 1
  `);
  const acer_rows = r2[0]?.['number of rows inserted'] ?? r2[0]?.NUMBER_OF_ROWS_INSERTED ?? JSON.stringify(r2[0]);
  console.log(`✅ Acer inserted: ${acer_rows} rows`);

  // ── Verify ─────────────────────────────────────────────────────────────────
  const check = await query(`
    SELECT client_id, COUNT(*) as cnt, SUM(total_cost) as spend,
      MIN(date) as first_date, MAX(date) as last_date
    FROM CALBRIDGE_PROD.APP.dsp_order_report
    GROUP BY client_id
    ORDER BY client_id
  `);
  console.log('dsp_order_report summary:', JSON.stringify(check));
}

run().catch(e => { console.error('Backfill error:', e.message); process.exit(1); })
     .finally(() => setTimeout(() => process.exit(0), 500));
