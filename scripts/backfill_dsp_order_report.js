'use strict';
require('dotenv').config();
const { query } = require('../src/services/snowflakeService');

async function run() {
  console.log('Backfilling dsp_order_report...');

  // ── CyberPower: FULL OUTER JOIN flight (spend) + campaign (attribution) ──
  // JOIN on (client_id, order_name, date) — NOT profile_id.
  // SparkX attribution rows (profile 3222769947754429) must match Calbridge flight
  // rows (profile 2167357144044647) for the same order names in April.
  // Use NULLIF(x, 0) for attribution: flight returns 0 not NULL, so COALESCE
  // would pick 0 over the correct campaign value without NULLIF.
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
      COALESCE(f.advertiser_id,      c.advertiser_id),
      COALESCE(f.profile_id,         c.profile_id),
      COALESCE(f.client_id,          c.client_id),
      COALESCE(f.date,               c.date)::DATE,
      COALESCE(f.order_id,           c.order_id),
      COALESCE(f.order_name,         c.order_name),
      COALESCE(f.advertiser_name,    c.advertiser_name),
      c.order_budget, c.order_start_date, c.order_end_date, c.order_currency, c.entity_id,
      COALESCE(f.impressions,        c.impressions),
      COALESCE(f.clicks,             c.clicks),
      COALESCE(f.total_cost,         c.total_cost),
      COALESCE(f.viewable_impressions, c.viewable_impressions),
      COALESCE(f.viewability_rate,   c.viewability_rate),
      COALESCE(NULLIF(c.detail_page_views, 0),  f.detail_page_views),
      c.detail_page_view_clicks,
      COALESCE(NULLIF(c.add_to_cart, 0),        f.add_to_cart),
      c.add_to_cart_clicks,
      COALESCE(NULLIF(c.purchases, 0),          f.purchases),
      c.purchases_clicks,
      COALESCE(NULLIF(c.total_purchases, 0),    f.total_purchases),
      c.total_purchases_clicks,
      COALESCE(NULLIF(c.sales, 0),              f.sales),
      COALESCE(NULLIF(c.total_sales, 0),        f.total_sales),
      COALESCE(NULLIF(c.new_to_brand_purchases, 0), f.new_to_brand_purchases),
      c.new_to_brand_purchases_clicks,
      COALESCE(NULLIF(c.new_to_brand_product_sales, 0), f.new_to_brand_product_sales),
      f.video_ad_start, f.video_ad_complete,
      CURRENT_TIMESTAMP()
    FROM (
      SELECT * FROM CALBRIDGE_PROD.APP.dsp_raw_flight
      WHERE client_id = '7d88ea17-002b-4a02-97fc-bcab1292d57e'
      QUALIFY ROW_NUMBER() OVER (PARTITION BY client_id, order_name, date ORDER BY total_cost DESC, synced_at DESC) = 1
    ) f
    FULL OUTER JOIN (
      SELECT * FROM CALBRIDGE_PROD.APP.dsp_raw_campaign
      WHERE client_id = '7d88ea17-002b-4a02-97fc-bcab1292d57e'
      QUALIFY ROW_NUMBER() OVER (PARTITION BY client_id, order_name, date ORDER BY total_sales DESC NULLS LAST, synced_at DESC) = 1
    ) c
      ON  f.client_id  = c.client_id
      AND f.order_name = c.order_name
      AND f.date       = c.date
  `);
  const cp = r1[0]?.['number of rows inserted'] ?? JSON.stringify(r1[0]);
  console.log(`✅ CyberPower inserted: ${cp} rows`);

  // ── Acer SparkX (attribution only, from dsp_raw_campaign) ──────────────────
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
    QUALIFY ROW_NUMBER() OVER (PARTITION BY client_id, order_name, date ORDER BY synced_at DESC) = 1
  `);
  const acer = r2[0]?.['number of rows inserted'] ?? JSON.stringify(r2[0]);
  console.log(`✅ Acer inserted: ${acer} rows`);

  // Verify
  const check = await query(`
    SELECT client_id, COUNT(*) as cnt, SUM(total_cost) as spend, SUM(total_sales) as sales
    FROM CALBRIDGE_PROD.APP.dsp_order_report
    GROUP BY client_id ORDER BY client_id
  `);
  console.log('Summary:', JSON.stringify(check));
}

run().catch(e => { console.error(e.message); process.exit(1); })
     .finally(() => setTimeout(() => process.exit(0), 500));
