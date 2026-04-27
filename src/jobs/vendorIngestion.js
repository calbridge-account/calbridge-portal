/**
 * Vendor Central (SP-API) retail data ingestion
 *
 * Pulls 6 report types on a rolling basis:
 *   - GET_VENDOR_SALES_REPORT          → VENDOR_SALES (DAY grain, 15-day window)
 *   - GET_VENDOR_INVENTORY_REPORT      → VENDOR_INVENTORY (DAY grain, 15-day window)
 *   - GET_VENDOR_TRAFFIC_REPORT        → VENDOR_TRAFFIC (DAY grain, 30-day rolling window)
 *   - GET_VENDOR_NET_PURE_PRODUCT_MARGIN_REPORT → VENDOR_NET_PPM (DAY grain, 30-day rolling window)
 *   - GET_VENDOR_FORECASTING_REPORT    → VENDOR_FORECASTS (most recent week only)
 *   - GET_VENDOR_REAL_TIME_INVENTORY_REPORT → VENDOR_INVENTORY (supplemental, 24h window)
 *
 * Data lag: DAY reports available ~72h after close; WEEK available end-of-Monday.
 * All report parameters use date-only strings (YYYY-MM-DD), not ISO timestamps.
 */
require('dotenv').config();
const axios = require('axios');
const zlib  = require('zlib');
const { query, batchMerge } = require('../services/snowflakeService');
const { getValidToken } = require('../services/amazonAuthService');

const IS_SANDBOX  = process.env.NODE_ENV !== 'production';
const SP_API_BASE = IS_SANDBOX
  ? 'https://sandbox.sellingpartnerapi-na.amazon.com'
  : 'https://sellingpartnerapi-na.amazon.com';

function toDateStr(d) {
  return d instanceof Date ? d.toISOString().split('T')[0] : String(d).substring(0, 10);
}
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return toDateStr(d);
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Returns the most recent completed Saturday (end of last full week).
 * Amazon WEEK reports require Sunday→Saturday alignment, and data is available
 * ~48h after Saturday close. We use end-of-last-Saturday-with-data as the safe cutoff.
 */
function lastCompletedSaturday() {
  const now = new Date();
  const day = now.getUTCDay(); // 0=Sun, 6=Sat
  // Days since last Saturday: if today is Sun (0) → 1 day ago, Sat (6) → 7 days ago (prev week)
  const daysSinceSat = day === 0 ? 1 : (day === 6 ? 7 : day + 1);
  const sat = new Date(now);
  sat.setUTCDate(now.getUTCDate() - daysSinceSat);
  return toDateStr(sat);
}

/**
 * Returns the Sunday that starts the week containing lastCompletedSaturday().
 */
function lastCompletedSunday() {
  const satStr = lastCompletedSaturday();
  const sat = new Date(satStr);
  const sun = new Date(sat);
  sun.setUTCDate(sat.getUTCDate() - 6);
  return toDateStr(sun);
}

async function spClient(clientId) {
  let token;
  try {
    token = await getValidToken(clientId, 'vendor');
  } catch (err) {
    console.error('[vendorIngestion] Failed to get vendor token:', err.message);
    throw err;
  }
  if (!token) throw new Error('getValidToken returned empty token for vendor');
  return axios.create({
    baseURL: SP_API_BASE,
    headers: { 'x-amz-access-token': token, 'Content-Type': 'application/json' },
    timeout: 30000
  });
}

/**
 * Request a vendor report and poll until complete, then download + parse.
 * Returns array of parsed rows.
 *
 * For vendor reports: dataStartTime/dataEndTime are TOP-LEVEL params, not reportOptions.
 * reportOptions should only contain: reportPeriod, distributorView, sellingProgram, etc.
 */
async function requestAndDownload(client, reportType, reportOptions, marketplaceId = 'ATVPDKIKX0DER', maxWaitMs = 900000) {
  // Extract top-level date params from reportOptions (they must NOT be in reportOptions)
  const { dataStartTime, dataEndTime, ...restOptions } = reportOptions;

  const body = {
    reportType,
    marketplaceIds: [marketplaceId],
    reportOptions: restOptions,
  };
  if (dataStartTime) body.dataStartTime = dataStartTime;
  if (dataEndTime)   body.dataEndTime   = dataEndTime;

  // Create report — retry up to 3x on 429
  let createRes;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      createRes = await client.post('/reports/2021-06-30/reports', body);
      break;
    } catch (err) {
      if (err.response?.status === 429 && attempt < 3) {
        const retryAfter = Number(err.response.headers?.['retry-after'] || 60);
        console.log(`[vendorIngestion] ${reportType} 429 — waiting ${retryAfter}s (attempt ${attempt}/3)`);
        await sleep(retryAfter * 1000);
      } else {
        throw err;
      }
    }
  }
  const reportId = createRes?.data?.reportId;
  if (!reportId) throw new Error(`No reportId for ${reportType}`);

  // Poll
  const start = Date.now();
  let pollCount = 0;
  while (Date.now() - start < maxWaitMs) {
    await sleep(8000);
    pollCount++;
    const poll = await client.get(`/reports/2021-06-30/reports/${reportId}`);
    const { processingStatus, reportDocumentId } = poll.data;
    if (pollCount % 5 === 0) console.log(`[vendorIngestion] ${reportType} poll #${pollCount}: ${processingStatus}`);

    if (processingStatus === 'DONE' && reportDocumentId) {
      const docRes = await client.get(`/reports/2021-06-30/documents/${reportDocumentId}`);
      const { url, compressionAlgorithm } = docRes.data;
      const dl = await axios.get(url, { responseType: 'arraybuffer', timeout: 60000 });
      let text;
      if (compressionAlgorithm === 'GZIP') {
        text = zlib.gunzipSync(Buffer.from(dl.data)).toString('utf8');
      } else {
        text = Buffer.from(dl.data).toString('utf8');
      }
      try { return JSON.parse(text); } catch { return text; }
    }
    if (['CANCELLED', 'FATAL'].includes(processingStatus)) {
      throw new Error(`${reportType} ended with: ${processingStatus}`);
    }
  }
  throw new Error(`${reportType} timed out after ${maxWaitMs / 1000}s`);
}

// ─── Writers ─────────────────────────────────────────────────────────────────

async function writeVendorSales(clientId, rows) {
  if (!Array.isArray(rows) || !rows.length) return 0;
  const moneyAmt = (v) => (v != null && typeof v === 'object') ? (v.amount ?? 0) : (v ?? 0);
  const mapped = rows
    .map(row => {
      const asin      = row.asin || row.parentAsin;
      const startDate = row.startDate || row.reportingDate;
      const endDate   = row.endDate   || row.reportingDate;
      if (!asin || !startDate) return null;
      return {
        client_id:        clientId,
        asin,
        start_date:       startDate,
        end_date:         endDate,
        ordered_units:    row.orderedUnits ?? 0,
        ordered_revenue:  moneyAmt(row.orderedRevenue),
        ordered_currency: row.orderedRevenue?.currencyCode || 'USD',
        shipped_units:    row.shippedUnits ?? 0,
        shipped_revenue:  moneyAmt(row.shippedRevenue),
        shipped_cogs:     moneyAmt(row.shippedCogs ?? row.shippedCOGS),
        shipped_currency: row.shippedRevenue?.currencyCode || 'USD',
        customer_returns: row.customerReturns ?? 0,
      };
    })
    .filter(Boolean);
  if (!mapped.length) return 0;
  return batchMerge({
    table:       'CALBRIDGE_PROD.APP.VENDOR_SALES',
    keyColumns:  ['client_id', 'asin', 'start_date'],
    dataColumns: ['end_date', 'ordered_units', 'ordered_revenue', 'ordered_currency',
                  'shipped_units', 'shipped_revenue', 'shipped_cogs', 'shipped_currency',
                  'customer_returns'],
    dateColumns: ['start_date', 'end_date'],
    rows:        mapped,
  });
}

async function writeVendorInventory(clientId, rows) {
  if (!Array.isArray(rows) || !rows.length) return 0;
  const mapped = rows
    .map(row => {
      const asin      = row.asin || row.parentAsin;
      const startDate = row.startDate || row.reportingDate;
      const endDate   = row.endDate   || row.reportingDate;
      if (!asin || !startDate) return null;
      return {
        client_id:                      clientId,
        asin,
        start_date:                     startDate,
        end_date:                       endDate,
        sellable_on_hand_units:         row.sellableOnHandInventoryUnits          || row.sellableOnHandInventory?.units        || row.sellableOnHandUnits        || 0,
        sellable_on_hand_cost:          row.sellableOnHandInventoryCost?.amount   || row.sellableOnHandInventory?.cost?.amount || row.sellableOnHandCost         || null,
        unsellable_on_hand_units:       row.unsellableOnHandInventoryUnits        || row.unsellableOnHandInventory?.units      || row.unsellableOnHandUnits      || 0,
        sell_through_rate:              row.sellThroughRate                       || null,
        vendor_confirmation_rate:       row.vendorConfirmationRate                || null,
        receive_fill_rate:              row.receiveFillRate                       || null,
        avg_vendor_lead_time_days:      row.averageVendorLeadTimeDays             || null,
        open_purchase_order_units:      row.openPurchaseOrderUnits                || null,
        net_received_units:             row.netReceivedInventoryUnits             || row.netReceivedInventory?.units           || row.netReceivedUnits           || null,
        aged_90_plus_units:             row.aged90PlusDaysSellableInventoryUnits  || row.aged90PlusInventory?.units            || row.aged90PlusUnits            || null,
        unhealthy_units:                row.unhealthyInventoryUnits               || row.unhealthyInventory?.units             || row.unhealthyUnits             || null,
        unfilled_customer_ordered_units: row.unfilledCustomerOrderedUnits         || null,
      };
    })
    .filter(Boolean);
  if (!mapped.length) return 0;
  return batchMerge({
    table:       'CALBRIDGE_PROD.APP.VENDOR_INVENTORY',
    keyColumns:  ['client_id', 'asin', 'start_date'],
    dataColumns: ['end_date', 'sellable_on_hand_units', 'sellable_on_hand_cost',
                  'unsellable_on_hand_units', 'sell_through_rate',
                  'vendor_confirmation_rate', 'receive_fill_rate',
                  'avg_vendor_lead_time_days', 'open_purchase_order_units',
                  'net_received_units', 'aged_90_plus_units',
                  'unhealthy_units', 'unfilled_customer_ordered_units'],
    dateColumns: ['start_date', 'end_date'],
    rows:        mapped,
  });
}

async function writeVendorTraffic(clientId, rows) {
  if (!Array.isArray(rows) || !rows.length) return 0;
  // Bulk MERGE via VALUES list — avoids N×700ms round-trips
  const BATCH = 500;
  let written = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH).filter(r => (r.asin || r.parentAsin) && (r.startDate || r.reportingDate));
    if (!batch.length) continue;
    const vals = batch.map(() => '(?,?,?,?,?)').join(',');
    const params = batch.flatMap(row => [
      clientId,
      row.asin || row.parentAsin,
      row.startDate || row.reportingDate,
      row.endDate || row.reportingDate,
      row.glanceViews || row.acr || 0,
    ]);
    await query(`
      MERGE INTO CALBRIDGE_PROD.APP.VENDOR_TRAFFIC t
      USING (SELECT column1 AS client_id, column2 AS asin, column3 AS start_date, column4 AS end_date, column5 AS glance_views
             FROM VALUES ${vals}) s
      ON t.client_id = s.client_id AND t.asin = s.asin AND t.start_date = s.start_date
      WHEN MATCHED THEN UPDATE SET end_date = s.end_date, glance_views = s.glance_views, synced_at = CURRENT_TIMESTAMP()
      WHEN NOT MATCHED THEN INSERT (client_id, asin, start_date, end_date, glance_views, synced_at)
        VALUES (s.client_id, s.asin, s.start_date, s.end_date, s.glance_views, CURRENT_TIMESTAMP())
    `, params);
    written += batch.length;
  }
  return written;
}

async function writeVendorNetPpm(clientId, rows) {
  if (!Array.isArray(rows) || !rows.length) return 0;
  // Bulk MERGE via VALUES list
  const BATCH = 500;
  let written = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH).filter(r => (r.asin || r.parentAsin) && (r.startDate || r.reportingDate));
    if (!batch.length) continue;
    const vals = batch.map(() => '(?,?,?,?,?)').join(',');
    const params = batch.flatMap(row => [
      clientId,
      row.asin || row.parentAsin,
      row.startDate || row.reportingDate,
      row.endDate || row.reportingDate,
      row.netPureProductMargin ?? row.netPPM ?? null,
    ]);
    await query(`
      MERGE INTO CALBRIDGE_PROD.APP.VENDOR_NET_PPM t
      USING (SELECT column1 AS client_id, column2 AS asin, column3 AS start_date, column4 AS end_date, column5 AS net_ppm
             FROM VALUES ${vals}) s
      ON t.client_id = s.client_id AND t.asin = s.asin AND t.start_date = s.start_date
      WHEN MATCHED THEN UPDATE SET end_date = s.end_date, net_pure_product_margin = s.net_ppm, synced_at = CURRENT_TIMESTAMP()
      WHEN NOT MATCHED THEN INSERT (client_id, asin, start_date, end_date, net_pure_product_margin, synced_at)
        VALUES (s.client_id, s.asin, s.start_date, s.end_date, s.net_ppm, CURRENT_TIMESTAMP())
    `, params);
    written += batch.length;
  }
  return written;
}

async function writeVendorForecasts(clientId, rows) {
  if (!Array.isArray(rows) || !rows.length) return 0;
  // Fixed 2026-04-27: was doing one MERGE per row (16,320 individual queries/run = ~$1,400/mo).
  // Now batches 500 rows per MERGE using VALUES list — same pattern as writeVendorTraffic/NetPpm.
  const genDate = new Date().toISOString().split('T')[0];
  const BATCH = 500;
  let written = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH).filter(r => (r.asin || r.parentAsin) && r.startDate);
    if (!batch.length) continue;
    const vals = batch.map(() => '(?,?,?,?,?,?,?,?,?,?)').join(',');
    const params = batch.flatMap(row => [
      clientId,
      'vendor',
      row.asin || row.parentAsin,
      genDate,
      row.startDate,
      row.endDate || row.startDate,
      row.meanForecastUnits || row.p50ForecastUnits || 0,
      row.p70ForecastUnits  || null,
      row.p80ForecastUnits  || null,
      row.p90ForecastUnits  || null,
    ]);
    await query(`
      MERGE INTO CALBRIDGE_PROD.APP.VENDOR_FORECASTS t
      USING (
        SELECT column1 AS client_id, column2 AS connection_type, column3 AS asin,
               column4 AS forecast_generation_date, column5 AS start_date, column6 AS end_date,
               column7 AS mean_forecast_units, column8 AS p70_forecast_units,
               column9 AS p80_forecast_units, column10 AS p90_forecast_units
        FROM VALUES ${vals}
      ) s
      ON  t.client_id = s.client_id
      AND t.asin = s.asin
      AND t.forecast_generation_date = s.forecast_generation_date
      AND t.start_date = s.start_date
      WHEN MATCHED THEN UPDATE SET
        end_date = s.end_date,
        mean_forecast_units = s.mean_forecast_units,
        p70_forecast_units  = s.p70_forecast_units,
        p80_forecast_units  = s.p80_forecast_units,
        p90_forecast_units  = s.p90_forecast_units,
        synced_at = CURRENT_TIMESTAMP()
      WHEN NOT MATCHED THEN INSERT
        (client_id, connection_type, asin, forecast_generation_date, start_date, end_date,
         mean_forecast_units, p70_forecast_units, p80_forecast_units, p90_forecast_units, synced_at)
        VALUES (s.client_id, s.connection_type, s.asin, s.forecast_generation_date, s.start_date,
                s.end_date, s.mean_forecast_units, s.p70_forecast_units, s.p80_forecast_units,
                s.p90_forecast_units, CURRENT_TIMESTAMP())
    `, params);
    written += batch.length;
  }
  return written;
}

// ─── Main ingestion function ──────────────────────────────────────────────────

/**
 * Ingest all vendor retail reports for a client.
 * Safe to call daily — uses MERGE (idempotent).
 *
 * Phase 2c: resolves account_id from client_accounts for logging.
 */
// ─── Timeout wrapper helper ──────────────────────────────────────────────────
function withTimeout(fn, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`[vendorIngestion] Hard timeout after ${ms/60000}min — ${label}`)), ms);
    fn().then(r => { clearTimeout(timer); resolve(r); })
       .catch(e => { clearTimeout(timer); reject(e); });
  });
}

/**
 * REAL-TIME only — runs every 6h.
 * GET_VENDOR_REAL_TIME_SALES_REPORT + GET_VENDOR_REAL_TIME_INVENTORY_REPORT
 */
async function ingestVendorRealtimeReports(clientId, marketplaceId = 'ATVPDKIKX0DER') {
  return withTimeout(() => _ingestVendorRealtimeReports(clientId, marketplaceId), 10 * 60 * 1000, 'ingestVendorRealtimeReports');
}

async function _ingestVendorRealtimeReports(clientId, marketplaceId) {
  const client = await spClient(clientId);
  const results = {};
  let totalWritten = 0;

  // ── RT Sales (hourly ordered units/revenue, last 24h) ──────────────────────
  try {
    const rtSalesEnd   = new Date().toISOString().slice(0, 10);
    const rtSalesStart = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const rtSalesData  = await requestAndDownload(client, 'GET_VENDOR_REAL_TIME_SALES_REPORT', {
      dataStartTime:  rtSalesStart,
      dataEndTime:    rtSalesEnd,
      sellingProgram: 'RETAIL',
    }, marketplaceId);
    const rtRows = (rtSalesData?.reportData || []).filter(r => r.asin && r.startTime);
    // Batch MERGE — fixed from row-at-a-time
    const BATCH = 500;
    let rtWritten = 0;
    for (let i = 0; i < rtRows.length; i += BATCH) {
      const batch = rtRows.slice(i, i + BATCH);
      const vals = batch.map(() => '(?,?,?,?,?,?)').join(',');
      const params = batch.flatMap(r => [clientId, r.asin, r.startTime, r.endTime, r.orderedUnits||0, r.orderedRevenue||0]);
      await query(`
        MERGE INTO CALBRIDGE_PROD.APP.vendor_sales t
        USING (SELECT column1 AS client_id, column2 AS asin, column3::TIMESTAMP AS start_date,
                      column4 AS end_date, column5 AS ordered_units, column6 AS ordered_revenue
               FROM VALUES ${vals}) s
        ON t.client_id=s.client_id AND t.asin=s.asin AND t.start_date=s.start_date
        WHEN MATCHED THEN UPDATE SET ordered_units=s.ordered_units, ordered_revenue=s.ordered_revenue, synced_at=CURRENT_TIMESTAMP()
        WHEN NOT MATCHED THEN INSERT (client_id,asin,start_date,end_date,ordered_units,ordered_revenue,ordered_currency,synced_at)
          VALUES (s.client_id,s.asin,s.start_date,s.end_date,s.ordered_units,s.ordered_revenue,'USD',CURRENT_TIMESTAMP())
      `, params).catch(() => {});
      rtWritten += batch.length;
    }
    results.vendorRealtimeSales = rtWritten;
    totalWritten += rtWritten;
    console.log(`[vendorIngestion] RT_SALES: ${rtWritten} hourly rows written`);
  } catch (err) {
    console.warn('[vendorIngestion] RT_SALES failed (non-fatal):', err.message.slice(0, 100));
    results.vendorRealtimeSales = 0;
  }

  await sleep(1000);

  // ── RT Inventory (hourly on-hand, last 24h — latest snapshot per ASIN) ─────
  try {
    const rtInvEnd   = new Date().toISOString().slice(0, 10);
    const rtInvStart = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const rtInvData  = await requestAndDownload(client, 'GET_VENDOR_REAL_TIME_INVENTORY_REPORT', {
      dataStartTime:  rtInvStart,
      dataEndTime:    rtInvEnd,
      sellingProgram: 'RETAIL',
    }, marketplaceId);
    // Keep only latest snapshot per ASIN
    const latestByAsin = {};
    for (const row of (rtInvData?.reportData || [])) {
      if (!row.asin) continue;
      if (!latestByAsin[row.asin] || row.endTime > latestByAsin[row.asin].endTime) latestByAsin[row.asin] = row;
    }
    const invRows = Object.values(latestByAsin);
    const today = new Date().toISOString().slice(0, 10);
    const BATCH = 500;
    let rtInvWritten = 0;
    for (let i = 0; i < invRows.length; i += BATCH) {
      const batch = invRows.slice(i, i + BATCH);
      const vals = batch.map(() => '(?,?,?,?)').join(',');
      const params = batch.flatMap(r => [clientId, r.asin, today, r.highlyAvailableInventory||0]);
      await query(`
        MERGE INTO CALBRIDGE_PROD.APP.vendor_inventory t
        USING (SELECT column1 AS client_id, column2 AS asin, column3::DATE AS start_date, column4 AS units
               FROM VALUES ${vals}) s
        ON t.client_id=s.client_id AND t.asin=s.asin AND t.start_date=s.start_date
        WHEN MATCHED THEN UPDATE SET sellable_on_hand_units=s.units, synced_at=CURRENT_TIMESTAMP()
        WHEN NOT MATCHED THEN INSERT (client_id,asin,start_date,sellable_on_hand_units,synced_at)
          VALUES (s.client_id,s.asin,s.start_date,s.units,CURRENT_TIMESTAMP())
      `, params).catch(() => {});
      rtInvWritten += batch.length;
    }
    results.vendorRealtimeInventory = rtInvWritten;
    totalWritten += rtInvWritten;
    console.log(`[vendorIngestion] RT_INVENTORY: ${rtInvWritten} ASINs written`);
  } catch (err) {
    console.warn('[vendorIngestion] RT_INVENTORY failed (non-fatal):', err.message.slice(0, 100));
    results.vendorRealtimeInventory = 0;
  }

  console.log(`[vendorIngestion] RT done — ${totalWritten} rows written`, results);
  return { recordsWritten: totalWritten, breakdown: results };
}

/**
 * DAILY reports — runs once/day at 06:30 UTC.
 * Sales (DAY), Inventory (DAY x2), Traffic, NetPPM
 */
async function ingestVendorDailyReports(clientId, marketplaceId = 'ATVPDKIKX0DER') {
  return withTimeout(() => _ingestVendorDailyReports(clientId, marketplaceId), 15 * 60 * 1000, 'ingestVendorDailyReports');
}

async function _ingestVendorDailyReports(clientId, marketplaceId) {
  const client = await spClient(clientId);
  const results = {};
  let totalWritten = 0;

  // ── Sales (DAY grain, D-17→D-3) ──────────────────────────────────────────
  try {
    const data = await requestAndDownload(client, 'GET_VENDOR_SALES_REPORT', {
      reportPeriod: 'DAY', distributorView: 'SOURCING', sellingProgram: 'RETAIL',
      dataStartTime: daysAgo(17), dataEndTime: daysAgo(3),
    }, marketplaceId);
    const rows = Array.isArray(data) ? data : (data?.reportData || data?.salesByAsin || []);
    results.vendorSales = await writeVendorSales(clientId, rows);
    totalWritten += results.vendorSales;
    console.log(`[vendorIngestion] VENDOR_SALES: ${results.vendorSales} rows`);
  } catch (err) { console.warn('[vendorIngestion] VENDOR_SALES failed:', err.message.slice(0, 100)); results.vendorSales = 0; }

  await sleep(2000);

  // ── Inventory pass 1 (DAY grain, D-17→D-3) ───────────────────────────────
  try {
    const data = await requestAndDownload(client, 'GET_VENDOR_INVENTORY_REPORT', {
      reportPeriod: 'DAY', distributorView: 'SOURCING', sellingProgram: 'RETAIL',
      dataStartTime: daysAgo(17), dataEndTime: daysAgo(3),
    }, marketplaceId);
    const rows = Array.isArray(data) ? data : (data?.reportData || data?.inventoryByAsin || []);
    results.vendorInventory = await writeVendorInventory(clientId, rows);
    totalWritten += results.vendorInventory;
    console.log(`[vendorIngestion] VENDOR_INVENTORY: ${results.vendorInventory} rows`);
  } catch (err) { console.warn('[vendorIngestion] VENDOR_INVENTORY failed:', err.message.slice(0, 100)); results.vendorInventory = 0; }

  await sleep(2000);

  // ── Inventory pass 2 (DAY grain, D-32→D-18 — older window) ───────────────
  try {
    const data = await requestAndDownload(client, 'GET_VENDOR_INVENTORY_REPORT', {
      reportPeriod: 'DAY', distributorView: 'SOURCING', sellingProgram: 'RETAIL',
      dataStartTime: daysAgo(32), dataEndTime: daysAgo(18),
    }, marketplaceId);
    const rows = Array.isArray(data) ? data : (data?.reportData || data?.inventoryByAsin || []);
    results.vendorInventoryOlder = await writeVendorInventory(clientId, rows);
    totalWritten += results.vendorInventoryOlder;
    console.log(`[vendorIngestion] VENDOR_INVENTORY (older): ${results.vendorInventoryOlder} rows`);
  } catch (err) { console.warn('[vendorIngestion] VENDOR_INVENTORY (older) failed:', err.message.slice(0, 100)); results.vendorInventoryOlder = 0; }

  await sleep(2000);

  // ── Traffic (DAY grain, D-32→D-3) ────────────────────────────────────────
  try {
    const data = await requestAndDownload(client, 'GET_VENDOR_TRAFFIC_REPORT', {
      reportPeriod: 'DAY', dataStartTime: daysAgo(32), dataEndTime: daysAgo(3),
    }, marketplaceId);
    const rows = Array.isArray(data) ? data : (data?.reportData || data?.trafficByAsin || []);
    results.vendorTraffic = await writeVendorTraffic(clientId, rows);
    totalWritten += results.vendorTraffic;
    console.log(`[vendorIngestion] VENDOR_TRAFFIC: ${results.vendorTraffic} rows`);
  } catch (err) { console.warn('[vendorIngestion] VENDOR_TRAFFIC failed:', err.message.slice(0, 100)); results.vendorTraffic = 0; }

  await sleep(2000);

  // ── Net PPM (DAY grain, D-32→D-3) ────────────────────────────────────────
  try {
    const data = await requestAndDownload(client, 'GET_VENDOR_NET_PURE_PRODUCT_MARGIN_REPORT', {
      reportPeriod: 'DAY', dataStartTime: daysAgo(32), dataEndTime: daysAgo(3),
    }, marketplaceId);
    const rows = Array.isArray(data) ? data : (data?.netPureProductMarginByAsin || data?.reportData || data?.netPpmByAsin || []);
    results.vendorNetPpm = await writeVendorNetPpm(clientId, rows);
    totalWritten += results.vendorNetPpm;
    console.log(`[vendorIngestion] VENDOR_NET_PPM: ${results.vendorNetPpm} rows`);
  } catch (err) { console.warn('[vendorIngestion] VENDOR_NET_PPM failed:', err.message.slice(0, 100)); results.vendorNetPpm = 0; }

  console.log(`[vendorIngestion] Daily done — ${totalWritten} rows written`, results);
  return { recordsWritten: totalWritten, breakdown: results };
}

/**
 * WEEKLY reports — runs Monday 08:00 UTC (48h after Saturday Amazon SLA close).
 * GET_VENDOR_FORECASTING_REPORT only.
 */
async function ingestVendorWeeklyReports(clientId, marketplaceId = 'ATVPDKIKX0DER') {
  return withTimeout(() => _ingestVendorWeeklyReports(clientId, marketplaceId), 10 * 60 * 1000, 'ingestVendorWeeklyReports');
}

async function _ingestVendorWeeklyReports(clientId, marketplaceId) {
  const client = await spClient(clientId);
  try {
    const data = await requestAndDownload(client, 'GET_VENDOR_FORECASTING_REPORT', {
      sellingProgram: 'RETAIL',
    }, marketplaceId);
    const rows = Array.isArray(data) ? data : (data?.reportData || data?.forecastByAsin || []);
    const written = await writeVendorForecasts(clientId, rows);
    console.log(`[vendorIngestion] VENDOR_FORECASTS (weekly): ${written} rows written`);
    return { recordsWritten: written, breakdown: { vendorForecasts: written } };
  } catch (err) {
    console.warn('[vendorIngestion] VENDOR_FORECASTS failed:', err.message.slice(0, 120));
    return { recordsWritten: 0, breakdown: { vendorForecasts: 0 } };
  }
}

/**
 * Legacy wrapper — kept for backfill and manual triggers.
 * Runs all three tiers in sequence.
 */
async function ingestVendorReports(clientId, marketplaceId = 'ATVPDKIKX0DER') {
  return withTimeout(() => _ingestVendorReports(clientId, marketplaceId), 20 * 60 * 1000, 'ingestVendorReports');
}

async function _ingestVendorReports(clientId, marketplaceId) {
  // Delegates to the three cadence-specific functions in sequence
  const results = { recordsWritten: 0, breakdown: {} };
  try {
    const rt = await _ingestVendorRealtimeReports(clientId, marketplaceId);
    results.recordsWritten += rt.recordsWritten || 0;
    Object.assign(results.breakdown, rt.breakdown || {});
  } catch (e) { console.warn('[vendorIngestion] RT phase failed:', e.message.slice(0, 80)); }

  try {
    const daily = await _ingestVendorDailyReports(clientId, marketplaceId);
    results.recordsWritten += daily.recordsWritten || 0;
    Object.assign(results.breakdown, daily.breakdown || {});
  } catch (e) { console.warn('[vendorIngestion] Daily phase failed:', e.message.slice(0, 80)); }

  try {
    const weekly = await _ingestVendorWeeklyReports(clientId, marketplaceId);
    results.recordsWritten += weekly.recordsWritten || 0;
    Object.assign(results.breakdown, weekly.breakdown || {});
  } catch (e) { console.warn('[vendorIngestion] Weekly phase failed:', e.message.slice(0, 80)); }

  console.log(`[vendorIngestion] Done — ${results.recordsWritten} total rows written`, results.breakdown);
  return results;
}

async function backfillVendorReports(clientId, startDate, endDate, marketplaceId = 'ATVPDKIKX0DER') {
  const results = { vendorSales: 0, vendorInventory: 0, vendorTraffic: 0, vendorNetPpm: 0, dayChunks: 0, weekChunks: 0 };

  // Helper: normalise SP-API vendor report response to an array of ASIN rows
  const toRows = (data, ...keys) => {
    if (Array.isArray(data)) return data;
    for (const k of keys) { if (Array.isArray(data?.[k])) return data[k]; }
    return [];
  };

  // ── DAY chunks: max 14 days each ─────────────────────────────────────────
  const dayChunks = [];
  let cursor = new Date(startDate + 'T00:00:00Z');
  const dayEnd = new Date(endDate + 'T00:00:00Z');
  while (cursor <= dayEnd) {
    const chunkEnd = new Date(cursor);
    chunkEnd.setUTCDate(chunkEnd.getUTCDate() + 13); // 14 days (0-indexed: +13)
    if (chunkEnd > dayEnd) chunkEnd.setTime(dayEnd.getTime());
    dayChunks.push({ start: toDateStr(cursor), end: toDateStr(chunkEnd) });
    cursor = new Date(chunkEnd);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  console.log(`[vendorBackfill] DAY: ${dayChunks.length} chunks (${startDate} → ${endDate}) for client ${clientId}`);

  for (const chunk of dayChunks) {
    results.dayChunks++;
    const client = await spClient(clientId);
    console.log(`[vendorBackfill] DAY chunk ${results.dayChunks}/${dayChunks.length}: ${chunk.start} → ${chunk.end}`);

    // Sales (DAY)
    try {
      const data = await requestAndDownload(client, 'GET_VENDOR_SALES_REPORT', {
        reportPeriod: 'DAY', distributorView: 'SOURCING', sellingProgram: 'RETAIL',
        dataStartTime: chunk.start, dataEndTime: chunk.end,
      }, marketplaceId, 600000);
      const rows = toRows(data, 'salesByAsin', 'reportData');
      const written = await writeVendorSales(clientId, rows);
      results.vendorSales += written;
      console.log(`[vendorBackfill] SALES: ${written} rows`);
    } catch (err) {
      console.warn(`[vendorBackfill] SALES failed:`, err.message?.substring(0, 200));
    }
    await sleep(2000);

    // Inventory (DAY)
    try {
      const data = await requestAndDownload(client, 'GET_VENDOR_INVENTORY_REPORT', {
        reportPeriod: 'DAY', distributorView: 'SOURCING', sellingProgram: 'RETAIL',
        dataStartTime: chunk.start, dataEndTime: chunk.end,
      }, marketplaceId, 600000);
      const rows = toRows(data, 'inventoryByAsin', 'reportData');
      const written = await writeVendorInventory(clientId, rows);
      results.vendorInventory += written;
      console.log(`[vendorBackfill] INVENTORY: ${written} rows`);
    } catch (err) {
      console.warn(`[vendorBackfill] INVENTORY failed:`, err.message?.substring(0, 200));
    }

    // Rate limit: wait 65s between chunks (4 report types per chunk)
    if (results.dayChunks < dayChunks.length) {
      console.log(`[vendorBackfill] Waiting 30s before next day chunk...`);
      await sleep(30000);
    }
  }

  // ── Traffic + NetPPM: DAY grain, 14-day chunks (matches daily ingest approach) ──
  // These reports do NOT support WEEK grain for backfill — DAY grain with max 14-day
  // windows is the correct approach, same as the daily ingest rolling window.
  // No distributorView/sellingProgram allowed for traffic or netPPM.

  // Cap traffic/netPPM start at 13 months ago (API hard limit)
  const thirteenMonthsAgo = new Date();
  thirteenMonthsAgo.setMonth(thirteenMonthsAgo.getMonth() - 13);
  const trafficStart = new Date(startDate + 'T00:00:00Z') < thirteenMonthsAgo
    ? toDateStr(thirteenMonthsAgo) : startDate;

  const trafficChunks = [];
  let tCursor = new Date(trafficStart + 'T00:00:00Z');
  const tEnd = new Date(endDate + 'T00:00:00Z');
  while (tCursor <= tEnd) {
    const chunkEnd = new Date(tCursor);
    chunkEnd.setUTCDate(chunkEnd.getUTCDate() + 13); // 14 days
    if (chunkEnd > tEnd) chunkEnd.setTime(tEnd.getTime());
    trafficChunks.push({ start: toDateStr(tCursor), end: toDateStr(chunkEnd) });
    tCursor = new Date(chunkEnd);
    tCursor.setUTCDate(tCursor.getUTCDate() + 1);
  }
  console.log(`[vendorBackfill] TRAFFIC/PPM: ${trafficChunks.length} DAY chunks (${trafficStart} → ${endDate})`);

  for (const chunk of trafficChunks) {
    results.weekChunks++;
    const client = await spClient(clientId);
    console.log(`[vendorBackfill] TRAFFIC/PPM chunk ${results.weekChunks}/${trafficChunks.length}: ${chunk.start} → ${chunk.end}`);

    // Traffic (DAY) — no distributorView/sellingProgram
    try {
      const data = await requestAndDownload(client, 'GET_VENDOR_TRAFFIC_REPORT', {
        reportPeriod: 'DAY',
        dataStartTime: chunk.start, dataEndTime: chunk.end,
      }, marketplaceId, 600000);
      const rows = toRows(data, 'trafficByAsin', 'reportData');
      const written = await writeVendorTraffic(clientId, rows);
      results.vendorTraffic += written;
      console.log(`[vendorBackfill] TRAFFIC: ${written} rows`);
    } catch (err) {
      console.warn(`[vendorBackfill] TRAFFIC failed:`, err.message?.substring(0, 200));
    }
    await sleep(2000);

    // Net PPM (DAY) — no distributorView/sellingProgram
    try {
      const data = await requestAndDownload(client, 'GET_VENDOR_NET_PURE_PRODUCT_MARGIN_REPORT', {
        reportPeriod: 'DAY',
        dataStartTime: chunk.start, dataEndTime: chunk.end,
      }, marketplaceId, 600000);
      const rows = toRows(data, 'netPureProductMarginByAsin', 'netPpmByAsin', 'reportData');
      const written = await writeVendorNetPpm(clientId, rows);
      results.vendorNetPpm += written;
      console.log(`[vendorBackfill] NET_PPM: ${written} rows`);
    } catch (err) {
      console.warn(`[vendorBackfill] NET_PPM failed:`, err.message?.substring(0, 200));
    }

    if (results.weekChunks < trafficChunks.length) {
      console.log(`[vendorBackfill] Waiting 30s before next traffic/ppm chunk...`);
      await sleep(30000);
    }
  }

  console.log(`[vendorBackfill] Done — sales=${results.vendorSales} inventory=${results.vendorInventory} traffic=${results.vendorTraffic} netPpm=${results.vendorNetPpm}`);
  return results;
}

module.exports = {
  ingestVendorReports,          // legacy full run (RT + daily + weekly)
  ingestVendorRealtimeReports,  // every 6h
  ingestVendorDailyReports,     // once/day
  ingestVendorWeeklyReports,    // once/week (Monday)
  backfillVendorReports,
  writeVendorSales, writeVendorInventory, writeVendorTraffic, writeVendorNetPpm,
};
