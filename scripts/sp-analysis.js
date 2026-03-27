require('dotenv').config();
const { query } = require('../src/services/snowflakeService');

const CLIENT_ID = '7d88ea17-002b-4a02-97fc-bcab1292d57e';

async function run() {
  const results = {};

  console.log('Running Q1: Match type efficiency...');
  try {
    results.q1 = await query(`
      SELECT
        match_type,
        SUM(impressions) AS impressions,
        SUM(clicks) AS clicks,
        SUM(cost) AS cost,
        SUM(purchases_30_d) AS purchases,
        SUM(sales_30_d) AS sales,
        CASE WHEN SUM(sales_30_d) > 0 THEN SUM(cost)/SUM(sales_30_d) ELSE NULL END AS acos,
        CASE WHEN SUM(impressions) > 0 THEN SUM(clicks)/SUM(impressions) ELSE NULL END AS ctr,
        CASE WHEN SUM(clicks) > 0 THEN SUM(purchases_30_d)/SUM(clicks) ELSE NULL END AS cvr
      FROM sp_search_term_report
      WHERE client_id = '${CLIENT_ID}'
        AND date >= DATEADD(day, -30, CURRENT_DATE)
      GROUP BY match_type
      ORDER BY cost DESC
    `);
    console.log('Q1 done:', results.q1.length, 'rows');
  } catch (e) { console.error('Q1 error:', e.message); results.q1 = []; }

  console.log('Running Q2: Top 20 converting search terms...');
  try {
    results.q2 = await query(`
      SELECT
        search_term,
        match_type,
        SUM(impressions) AS impressions,
        SUM(clicks) AS clicks,
        SUM(cost) AS cost,
        SUM(purchases_30_d) AS purchases,
        SUM(sales_30_d) AS sales,
        CASE WHEN SUM(sales_30_d) > 0 THEN SUM(cost)/SUM(sales_30_d) ELSE NULL END AS acos,
        CASE WHEN SUM(clicks) > 0 THEN SUM(purchases_30_d)/SUM(clicks) ELSE NULL END AS cvr
      FROM sp_search_term_report
      WHERE client_id = '${CLIENT_ID}'
        AND date >= DATEADD(day, -30, CURRENT_DATE)
      GROUP BY search_term, match_type
      HAVING SUM(purchases_30_d) >= 3
      ORDER BY acos ASC NULLS LAST
      LIMIT 20
    `);
    console.log('Q2 done:', results.q2.length, 'rows');
  } catch (e) { console.error('Q2 error:', e.message); results.q2 = []; }

  console.log('Running Q3: Top 20 wasted spend...');
  try {
    results.q3 = await query(`
      SELECT
        search_term,
        match_type,
        SUM(impressions) AS impressions,
        SUM(clicks) AS clicks,
        SUM(cost) AS cost,
        SUM(purchases_30_d) AS purchases
      FROM sp_search_term_report
      WHERE client_id = '${CLIENT_ID}'
        AND date >= DATEADD(day, -30, CURRENT_DATE)
      GROUP BY search_term, match_type
      HAVING SUM(cost) > 50 AND SUM(purchases_30_d) = 0
      ORDER BY cost DESC
      LIMIT 20
    `);
    console.log('Q3 done:', results.q3.length, 'rows');
  } catch (e) { console.error('Q3 error:', e.message); results.q3 = []; }

  console.log('Running Q4: Branded vs generic...');
  try {
    results.q4 = await query(`
      SELECT
        CASE WHEN LOWER(search_term) LIKE '%cyberpower%' OR LOWER(search_term) LIKE '%cyber power%'
             THEN 'Branded' ELSE 'Generic' END AS segment,
        SUM(impressions) AS impressions,
        SUM(clicks) AS clicks,
        SUM(cost) AS cost,
        SUM(purchases_30_d) AS purchases,
        SUM(sales_30_d) AS sales,
        CASE WHEN SUM(sales_30_d) > 0 THEN SUM(cost)/SUM(sales_30_d) ELSE NULL END AS acos,
        CASE WHEN SUM(impressions) > 0 THEN SUM(clicks)/SUM(impressions) ELSE NULL END AS ctr,
        CASE WHEN SUM(clicks) > 0 THEN SUM(purchases_30_d)/SUM(clicks) ELSE NULL END AS cvr
      FROM sp_search_term_report
      WHERE client_id = '${CLIENT_ID}'
        AND date >= DATEADD(day, -30, CURRENT_DATE)
      GROUP BY segment
      ORDER BY segment
    `);
    console.log('Q4 done:', results.q4.length, 'rows');
  } catch (e) { console.error('Q4 error:', e.message); results.q4 = []; }

  console.log('Running Q5: Opportunity keywords (underbidding)...');
  try {
    results.q5 = await query(`
      SELECT
        search_term,
        match_type,
        SUM(impressions) AS impressions,
        SUM(clicks) AS clicks,
        SUM(cost) AS cost,
        SUM(purchases_30_d) AS purchases,
        SUM(sales_30_d) AS sales,
        CASE WHEN SUM(sales_30_d) > 0 THEN SUM(cost)/SUM(sales_30_d) ELSE NULL END AS acos,
        CASE WHEN SUM(clicks) > 0 THEN SUM(purchases_30_d)/SUM(clicks) ELSE NULL END AS cvr
      FROM sp_search_term_report
      WHERE client_id = '${CLIENT_ID}'
        AND date >= DATEADD(day, -30, CURRENT_DATE)
      GROUP BY search_term, match_type
      HAVING SUM(purchases_30_d) >= 5 AND SUM(cost) < 50
      ORDER BY purchases DESC
      LIMIT 20
    `);
    console.log('Q5 done:', results.q5.length, 'rows');
  } catch (e) { console.error('Q5 error:', e.message); results.q5 = []; }

  console.log('Running Q6: High CTR no conversion...');
  try {
    results.q6 = await query(`
      SELECT
        search_term,
        match_type,
        SUM(impressions) AS impressions,
        SUM(clicks) AS clicks,
        SUM(cost) AS cost,
        SUM(purchases_30_d) AS purchases,
        CASE WHEN SUM(impressions) > 0 THEN SUM(clicks)/SUM(impressions) ELSE NULL END AS ctr
      FROM sp_search_term_report
      WHERE client_id = '${CLIENT_ID}'
        AND date >= DATEADD(day, -30, CURRENT_DATE)
      GROUP BY search_term, match_type
      HAVING SUM(clicks) >= 5
        AND SUM(impressions) > 0
        AND (SUM(clicks)/SUM(impressions)) > 0.01
        AND SUM(purchases_30_d) = 0
      ORDER BY cost DESC
      LIMIT 20
    `);
    console.log('Q6 done:', results.q6.length, 'rows');
  } catch (e) { console.error('Q6 error:', e.message); results.q6 = []; }

  console.log('Running Q7: YoY comparison...');
  try {
    results.q7_2025 = await query(`
      SELECT
        'Jan-Feb 2025' AS period,
        SUM(cost) AS total_spend,
        SUM(sales_30_d) AS total_sales,
        SUM(purchases_30_d) AS total_purchases,
        CASE WHEN SUM(sales_30_d) > 0 THEN SUM(cost)/SUM(sales_30_d) ELSE NULL END AS acos,
        SUM(clicks) AS clicks,
        SUM(impressions) AS impressions
      FROM sp_search_term_report
      WHERE client_id = '${CLIENT_ID}'
        AND date >= '2025-01-01' AND date <= '2025-02-28'
    `);
    results.q7_2026 = await query(`
      SELECT
        'Jan-Feb 2026' AS period,
        SUM(cost) AS total_spend,
        SUM(sales_30_d) AS total_sales,
        SUM(purchases_30_d) AS total_purchases,
        CASE WHEN SUM(sales_30_d) > 0 THEN SUM(cost)/SUM(sales_30_d) ELSE NULL END AS acos,
        SUM(clicks) AS clicks,
        SUM(impressions) AS impressions
      FROM sp_search_term_report
      WHERE client_id = '${CLIENT_ID}'
        AND date >= '2026-01-01' AND date <= '2026-02-28'
    `);
    results.q7 = [...results.q7_2025, ...results.q7_2026];
    console.log('Q7 done');
  } catch (e) { console.error('Q7 error:', e.message); results.q7 = []; }

  console.log('Running Q8: Top 20 campaigns by ACOS...');
  try {
    results.q8 = await query(`
      SELECT
        campaign_name,
        campaign_status,
        SUM(impressions) AS impressions,
        SUM(clicks) AS clicks,
        SUM(cost) AS cost,
        SUM(purchases_30_d) AS purchases,
        SUM(sales_30_d) AS sales,
        CASE WHEN SUM(sales_30_d) > 0 THEN SUM(cost)/SUM(sales_30_d) ELSE NULL END AS acos,
        CASE WHEN SUM(impressions) > 0 THEN SUM(clicks)/SUM(impressions) ELSE NULL END AS ctr,
        AVG(top_of_search_impression_share) AS avg_tos_is
      FROM sp_campaign_report
      WHERE client_id = '${CLIENT_ID}'
        AND date >= DATEADD(day, -30, CURRENT_DATE)
      GROUP BY campaign_name, campaign_status
      HAVING SUM(sales_30_d) > 0
      ORDER BY acos ASC
      LIMIT 20
    `);
    console.log('Q8 done:', results.q8.length, 'rows');
  } catch (e) {
    console.error('Q8 error:', e.message);
    // Try without date column (campaign report might be aggregated differently)
    try {
      results.q8 = await query(`
        SELECT
          campaign_name,
          campaign_status,
          impressions,
          clicks,
          cost,
          purchases_30_d AS purchases,
          sales_30_d AS sales,
          CASE WHEN sales_30_d > 0 THEN cost/sales_30_d ELSE NULL END AS acos,
          CASE WHEN impressions > 0 THEN clicks/impressions ELSE NULL END AS ctr,
          top_of_search_impression_share AS avg_tos_is
        FROM sp_campaign_report
        WHERE client_id = '${CLIENT_ID}'
          AND date >= DATEADD(day, -30, CURRENT_DATE)
          AND sales_30_d > 0
        ORDER BY acos ASC
        LIMIT 20
      `);
      console.log('Q8 retry done:', results.q8.length, 'rows');
    } catch (e2) { console.error('Q8 retry error:', e2.message); results.q8 = []; }
  }

  console.log('\n=== ALL QUERIES COMPLETE ===\n');
  console.log(JSON.stringify(results, null, 2));
  process.exit(0);
}

run().catch(e => { console.error('Fatal:', e); process.exit(1); });
