/**
 * fix-dsp-total-sales-apr.js
 *
 * Backfill total_sales and total_purchases in dsp_campaign_report for the
 * Calbridge advertiser (591210185781978252) for April 1-13 2026.
 *
 * Problem: dsp_campaign_report rows for client_id='7d88ea17-002b-4a02-97fc-bcab1292d57e'
 * have total_sales=0 for April. CAMPAIGN_PERFORMANCE VIEW uses COALESCE(total_sales, sales)
 * so it falls back to click-only sales ($129K) instead of full halo sales (~$763K).
 *
 * Fix:
 *  1. Request a fresh dspCampaign report from Amazon for Apr 1-13
 *  2. Poll until COMPLETED, download + parse GZIP_JSON
 *  3. Aggregate total_sales + total_purchases by order_name + date
 *  4. UPDATE dsp_campaign_report rows where total_cost > 0
 *  5. Verify SUM(total_sales) ≈ $763K
 *
 * Run: node scripts/fix-dsp-total-sales-apr.js
 */
'use strict';

require('dotenv').config();
const axios = require('axios');
const zlib  = require('zlib');
const { getValidToken } = require('../src/services/amazonAuthService');
const { query }         = require('../src/services/snowflakeService');

const CLIENT_ID    = '7d88ea17-002b-4a02-97fc-bcab1292d57e';
const ADVERTISER_ID = '591210185781978252';
const SCOPE         = '2167357144044647';   // Amazon-Advertising-API-Scope
const START_DATE    = '2026-04-01';
const END_DATE      = '2026-04-13';
const ADS_API_BASE  = 'https://advertising-api.amazon.com';
const SCHEMA        = 'CALBRIDGE_PROD.APP';

// Sleep helper
const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Safe JSON parse — uses reviver to keep large integers as strings.
 * Amazon returns 64-bit advertiser/order IDs that overflow JS Number.
 */
function safeParse(text) {
  // Replace large integers (>15 digits) with quoted strings before parsing
  const safe = text.replace(/:\s*(-?\d{16,})/g, ': "$1"');
  try { return JSON.parse(safe); } catch { return JSON.parse(text); }
}

async function main() {
  console.log('=== Fix DSP total_sales April 2026 ===\n');

  // ── Step 1: Get fresh token and create axios client ─────────────────────────
  console.log('Step 1: Getting valid token for ads connection...');
  const accessToken = await getValidToken(CLIENT_ID, 'ads');
  const client = axios.create({
    baseURL: ADS_API_BASE,
    headers: {
      'Authorization':                   `Bearer ${accessToken}`,
      'Amazon-Advertising-API-ClientId': process.env.LWA_CLIENT_ID,
      'Amazon-Advertising-API-Scope':    SCOPE,
      'Content-Type':                    'application/json',
    },
    timeout: 60000,
  });
  console.log('  Token obtained.\n');

  // ── Step 2: Request DSP campaign report ─────────────────────────────────────
  console.log(`Step 2: Requesting dspCampaign report for ${START_DATE} → ${END_DATE}...`);
  const reportPayload = {
    name:      `DSP_FIX_totalSales_Calbridge_${START_DATE}_${END_DATE}`,
    startDate: START_DATE,
    endDate:   END_DATE,
    configuration: {
      adProduct:    'DEMAND_SIDE_PLATFORM',
      reportTypeId: 'dspCampaign',
      groupBy:      ['campaign'],
      timeUnit:     'DAILY',
      format:       'GZIP_JSON',
      filters:      [{ field: 'advertiserId', values: [ADVERTISER_ID] }],
      columns: [
        'date', 'orderId', 'orderName', 'orderBudget', 'orderStartDate', 'orderEndDate', 'orderCurrency',
        'advertiserId', 'advertiserName', 'entityId',
        'impressions', 'clicks', 'totalCost',
        'viewableImpressions', 'viewabilityRate',
        'detailPageViews', 'detailPageViewClicks',
        'addToCart', 'addToCartClicks',
        'purchases', 'purchasesClicks',
        'totalPurchases', 'totalPurchasesClicks',
        'sales', 'totalSales',
        'newToBrandPurchases', 'newToBrandPurchasesClicks', 'newToBrandProductSales',
      ],
    },
  };

  let reportId;
  try {
    const res = await client.post('/reporting/reports', reportPayload, {
      headers: {
        'Content-Type': 'application/vnd.createasyncreportrequest.v3+json',
        'Accept':        'application/vnd.createasyncreportrequest.v3+json',
      },
      transformRequest: [(data, headers) => {
        headers['Content-Type'] = 'application/vnd.createasyncreportrequest.v3+json';
        return JSON.stringify(data);
      }],
    });
    reportId = res.data?.reportId;
    console.log(`  Report requested. reportId = ${reportId}\n`);
  } catch (err) {
    if (err.response?.status === 425) {
      // Duplicate — extract existing ID
      const match = (err.response?.data?.detail || '').match(/duplicate of\s*:\s*([\w-]+)/i);
      if (match?.[1]) {
        reportId = match[1];
        console.log(`  425 duplicate — reusing reportId = ${reportId}\n`);
      } else {
        throw err;
      }
    } else {
      console.error('  Failed to request report:', err.response?.data || err.message);
      throw err;
    }
  }

  if (!reportId) throw new Error('No reportId returned from Amazon');

  // ── Step 3: Poll until COMPLETED ────────────────────────────────────────────
  console.log('Step 3: Polling report status...');
  let rows;
  const maxWaitMs = 600000; // 10 min
  const start = Date.now();
  let pollCount = 0;

  while (Date.now() - start < maxWaitMs) {
    const statusRes = await client.get(`/reporting/reports/${reportId}`);
    const { status, url, failureReason } = statusRes.data;
    console.log(`  Poll #${++pollCount}: status=${status}`);

    if (status === 'COMPLETED' && url) {
      console.log('  Report COMPLETED. Downloading...\n');
      const dl = await axios.get(url, { responseType: 'arraybuffer', timeout: 120000 });
      const buf = zlib.gunzipSync(Buffer.from(dl.data));
      const parsed = safeParse(buf.toString('utf8'));
      rows = Array.isArray(parsed) ? parsed : (parsed?.data || []);
      console.log(`  Downloaded ${rows.length} rows.\n`);
      break;
    }

    if (status === 'FAILURE') {
      throw new Error(`Report ${reportId} FAILED: ${failureReason || 'unknown reason'}`);
    }

    // PENDING or PROCESSING — keep polling
    const delay = pollCount <= 10 ? 10000 : 20000;
    await sleep(delay);
  }

  if (!rows) throw new Error(`Report ${reportId} timed out after ${maxWaitMs / 1000}s`);

  // ── Step 4: Aggregate by order_name + date ──────────────────────────────────
  console.log('Step 4: Aggregating total_sales + total_purchases by order_name + date...');
  // Show sample row to understand structure
  if (rows.length > 0) {
    console.log('  Sample row keys:', Object.keys(rows[0]).join(', '));
    console.log('  Sample row:', JSON.stringify(rows[0]).substring(0, 300));
  }

  // Aggregate (in case groupBy=campaign returns multiple sub-rows per order+date)
  const aggMap = new Map(); // key: "orderName|date"
  let totalSalesSum = 0;
  let totalPurchasesSum = 0;

  for (const r of rows) {
    const orderName     = r.orderName || r.order_name || '';
    const date          = String(r.date || '').substring(0, 10);
    const totalSales    = Number(r.totalSales    || r.total_sales    || 0);
    const totalPurchases = Number(r.totalPurchases || r.total_purchases || 0);

    if (!orderName || !date) continue;

    const key = `${orderName}|${date}`;
    if (!aggMap.has(key)) {
      aggMap.set(key, { orderName, date, totalSales: 0, totalPurchases: 0 });
    }
    const agg = aggMap.get(key);
    agg.totalSales     += totalSales;
    agg.totalPurchases += totalPurchases;
    totalSalesSum      += totalSales;
    totalPurchasesSum  += totalPurchases;
  }

  console.log(`  Aggregated into ${aggMap.size} unique order_name+date combinations.`);
  console.log(`  Total totalSales in report: $${totalSalesSum.toFixed(2)}`);
  console.log(`  Total totalPurchases in report: ${totalPurchasesSum}\n`);

  // Show rows with non-zero total_sales
  const nonZeroSales = [...aggMap.values()].filter(r => r.totalSales > 0);
  console.log(`  Rows with totalSales > 0: ${nonZeroSales.length}`);
  if (nonZeroSales.length > 0) {
    console.log('  Top 5 by totalSales:');
    nonZeroSales.sort((a, b) => b.totalSales - a.totalSales).slice(0, 5).forEach(r => {
      console.log(`    ${r.date} | ${r.orderName.substring(0, 50)} | $${r.totalSales.toFixed(2)}`);
    });
  }
  console.log();

  // ── Step 5: UPDATE dsp_campaign_report ──────────────────────────────────────
  console.log('Step 5: Updating dsp_campaign_report rows (where total_cost > 0)...');

  // Check current state first
  const beforeRows = await query(`
    SELECT
      COUNT(*)                    AS row_count,
      SUM(total_sales)            AS sum_total_sales,
      SUM(sales)                  AS sum_sales,
      COUNT(CASE WHEN total_sales IS NULL OR total_sales = 0 THEN 1 END) AS null_zero_count
    FROM ${SCHEMA}.dsp_campaign_report
    WHERE client_id = '${CLIENT_ID}'
      AND date >= '${START_DATE}'
      AND date <= '${END_DATE}'
  `);
  const before = beforeRows[0];
  console.log('  BEFORE:');
  console.log(`    Rows: ${before.ROW_COUNT || before.row_count}`);
  console.log(`    SUM(total_sales): $${Number(before.SUM_TOTAL_SALES || before.sum_total_sales || 0).toFixed(2)}`);
  console.log(`    SUM(sales): $${Number(before.SUM_SALES || before.sum_sales || 0).toFixed(2)}`);
  console.log(`    Rows with null/0 total_sales: ${before.NULL_ZERO_COUNT || before.null_zero_count}`);
  console.log();

  // Run updates
  let updatedCount = 0;
  let skippedCount = 0;
  const aggEntries = [...aggMap.values()];

  for (const agg of aggEntries) {
    if (agg.totalSales === 0 && agg.totalPurchases === 0) {
      skippedCount++;
      continue; // Don't zero-out rows that might have data
    }

    // UPDATE only rows where total_cost > 0 (active spend days)
    // Use order_name as key (matches writeDspCampaignReport keyColumns)
    try {
      const result = await query(`
        UPDATE ${SCHEMA}.dsp_campaign_report
        SET
          total_sales     = ${agg.totalSales},
          total_purchases = ${agg.totalPurchases}
        WHERE client_id  = '${CLIENT_ID}'
          AND order_name = '${agg.orderName.replace(/'/g, "''")}'
          AND date       = '${agg.date}'
          AND total_cost > 0
      `);
      // Snowflake UPDATE returns number-of-rows-updated in result
      const affected = result?.[0]?.['number of rows updated'] ?? result?.[0]?.NUMBER_OF_ROWS_UPDATED ?? 0;
      updatedCount += Number(affected);
    } catch (err) {
      console.warn(`  WARN: Failed to update ${agg.orderName} / ${agg.date}: ${err.message}`);
    }
  }

  console.log(`  Updates complete: ${updatedCount} rows updated, ${skippedCount} zero-value rows skipped.\n`);

  // ── Step 6: Verify ──────────────────────────────────────────────────────────
  console.log('Step 6: Verification...');

  const afterRows = await query(`
    SELECT
      COUNT(*)         AS row_count,
      SUM(total_sales) AS sum_total_sales,
      SUM(sales)       AS sum_sales
    FROM ${SCHEMA}.dsp_campaign_report
    WHERE client_id = '${CLIENT_ID}'
      AND date >= '${START_DATE}'
      AND date <= '${END_DATE}'
  `);
  const after = afterRows[0];
  console.log('  AFTER:');
  console.log(`    SUM(total_sales): $${Number(after.SUM_TOTAL_SALES || after.sum_total_sales || 0).toFixed(2)}`);
  console.log(`    SUM(sales): $${Number(after.SUM_SALES || after.sum_sales || 0).toFixed(2)}`);

  // Check adjusted_campaign_performance for DSP sales
  const perfRows = await query(`
    SELECT
      SUM(sales)  AS sum_sales,
      SUM(spend)  AS sum_spend
    FROM ${SCHEMA}.ADJUSTED_CAMPAIGN_PERFORMANCE
    WHERE client_id = '${CLIENT_ID}'
      AND ad_type   = 'DSP'
      AND date >= '${START_DATE}'
      AND date <= '${END_DATE}'
  `);
  if (perfRows.length > 0) {
    const perf = perfRows[0];
    console.log('\n  ADJUSTED_CAMPAIGN_PERFORMANCE (DSP, Apr 1-13):');
    console.log(`    SUM(sales): $${Number(perf.SUM_SALES || perf.sum_sales || 0).toFixed(2)}`);
    console.log(`    SUM(spend): $${Number(perf.SUM_SPEND || perf.sum_spend || 0).toFixed(2)}`);
  }

  const totalSalesAfter = Number(after.SUM_TOTAL_SALES || after.sum_total_sales || 0);
  const isOk = totalSalesAfter > 700000; // expect ~$763K
  console.log(`\n  ${isOk ? '✅' : '⚠️'} total_sales = $${totalSalesAfter.toFixed(2)} (expected ~$763K)`);

  return {
    updatedRows: updatedCount,
    totalSalesBefore: Number(before.SUM_TOTAL_SALES || before.sum_total_sales || 0),
    totalSalesAfter,
    reportRows: rows.length,
    ok: isOk,
  };
}

main()
  .then(result => {
    console.log('\n=== DONE ===');
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  })
  .catch(err => {
    console.error('\n=== ERROR ===', err.message);
    if (err.response?.data) console.error('API response:', JSON.stringify(err.response.data).substring(0, 500));
    process.exit(1);
  });
