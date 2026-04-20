/**
 * Vendor Central (SP-API) retail data ingestion
 *
 * Pulls 6 report types on a rolling basis:
 *   - GET_VENDOR_SALES_REPORT          → VENDOR_SALES (DAY grain, 15-day window)
 *   - GET_VENDOR_INVENTORY_REPORT      → VENDOR_INVENTORY (DAY grain, 15-day window)
 *   - GET_VENDOR_TRAFFIC_REPORT        → VENDOR_TRAFFIC (WEEK grain, 8-week window)
 *   - GET_VENDOR_NET_PURE_PRODUCT_MARGIN_REPORT → VENDOR_NET_PPM (WEEK grain, 8-week window)
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
  let written = 0;
  for (const row of rows) {
    const asin      = row.asin || row.parentAsin;
    const startDate = row.startDate || row.reportingDate;
    const endDate   = row.endDate   || row.reportingDate;
    if (!asin || !startDate) continue;
    await query(`
      MERGE INTO CALBRIDGE_PROD.APP.VENDOR_TRAFFIC t
      USING (SELECT ? AS client_id, ? AS asin, ? AS start_date) s
      ON t.client_id = s.client_id AND t.asin = s.asin AND t.start_date = s.start_date
      WHEN MATCHED THEN UPDATE SET end_date = ?, glance_views = ?, synced_at = CURRENT_TIMESTAMP()
      WHEN NOT MATCHED THEN INSERT (client_id, asin, start_date, end_date, glance_views, synced_at)
        VALUES (?,?,?,?,?,CURRENT_TIMESTAMP())
    `, [
      clientId, asin, startDate,
      endDate, row.glanceViews || row.acr || 0,
      clientId, asin, startDate, endDate, row.glanceViews || row.acr || 0,
    ]);
    written++;
  }
  return written;
}

async function writeVendorNetPpm(clientId, rows) {
  if (!Array.isArray(rows) || !rows.length) return 0;
  let written = 0;
  for (const row of rows) {
    const asin      = row.asin || row.parentAsin;
    const startDate = row.startDate || row.reportingDate;
    const endDate   = row.endDate   || row.reportingDate;
    if (!asin || !startDate) continue;
    await query(`
      MERGE INTO CALBRIDGE_PROD.APP.VENDOR_NET_PPM t
      USING (SELECT ? AS client_id, ? AS asin, ? AS start_date) s
      ON t.client_id = s.client_id AND t.asin = s.asin AND t.start_date = s.start_date
      WHEN MATCHED THEN UPDATE SET end_date = ?, net_pure_product_margin = ?, synced_at = CURRENT_TIMESTAMP()
      WHEN NOT MATCHED THEN INSERT (client_id, asin, start_date, end_date, net_pure_product_margin, synced_at)
        VALUES (?,?,?,?,?,CURRENT_TIMESTAMP())
    `, [
      clientId, asin, startDate,
      endDate, row.netPureProductMargin ?? row.netPPM ?? null,
      clientId, asin, startDate, endDate, row.netPureProductMargin ?? row.netPPM ?? null,
    ]);
    written++;
  }
  return written;
}

async function writeVendorForecasts(clientId, rows) {
  if (!Array.isArray(rows) || !rows.length) return 0;
  let written = 0;
  const genDate = new Date().toISOString().split('T')[0];
  for (const row of rows) {
    const asin      = row.asin || row.parentAsin;
    const startDate = row.startDate;
    const endDate   = row.endDate;
    if (!asin || !startDate) continue;
    await query(`
      MERGE INTO CALBRIDGE_PROD.APP.VENDOR_FORECASTS t
      USING (SELECT ? AS client_id, ? AS connection_type, ? AS asin, ? AS forecast_generation_date, ? AS start_date) s
      ON t.client_id = s.client_id AND t.asin = s.asin
        AND t.forecast_generation_date = s.forecast_generation_date AND t.start_date = s.start_date
      WHEN MATCHED THEN UPDATE SET
        end_date = ?, mean_forecast_units = ?, p70_forecast_units = ?,
        p80_forecast_units = ?, p90_forecast_units = ?, synced_at = CURRENT_TIMESTAMP()
      WHEN NOT MATCHED THEN INSERT
        (client_id, connection_type, asin, forecast_generation_date, start_date, end_date,
         mean_forecast_units, p70_forecast_units, p80_forecast_units, p90_forecast_units, synced_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP())
    `, [
      clientId, 'vendor', asin, genDate, startDate,
      endDate,
      row.meanForecastUnits      || row.p50ForecastUnits || 0,
      row.p70ForecastUnits       || null,
      row.p80ForecastUnits       || null,
      row.p90ForecastUnits       || null,
      clientId, 'vendor', asin, genDate, startDate, endDate,
      row.meanForecastUnits      || row.p50ForecastUnits || 0,
      row.p70ForecastUnits       || null,
      row.p80ForecastUnits       || null,
      row.p90ForecastUnits       || null,
    ]);
    written++;
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
async function ingestVendorReports(clientId, marketplaceId = 'ATVPDKIKX0DER') {
  // Resolve account_id from client_accounts (Phase 2c) for logging/audit
  let accountId = null;
  try {
    const acctRows = await query(`
      SELECT account_id
      FROM   CALBRIDGE_PROD.APP.client_accounts
      WHERE  client_id = ?
        AND  channel   = 'vendor'
        AND  is_active = TRUE
      LIMIT  1
    `, [clientId]);
    if (acctRows.length > 0) accountId = acctRows[0].ACCOUNT_ID || acctRows[0].account_id;
  } catch (err) {
    console.warn('[vendorIngestion] account_id lookup failed (non-fatal):', err.message);
  }
  if (accountId) console.log(`[vendorIngestion] client=${clientId} account_id=${accountId}`);

  const client = await spClient(clientId);
  const results = {};
  let totalWritten = 0;

  // ── 1. Vendor Sales (DAY grain, max 14 days per request) ──────────────────
  try {
    console.log('[vendorIngestion] Requesting GET_VENDOR_SALES_REPORT...');
    // DAY grain: confirmed D-3 lag (same as inventory). daysAgo(2) caused FATAL.
    const endDate   = daysAgo(3);   // D-3 confirmed available
    const startDate = daysAgo(17);  // 14-day window ending at D-3
    const data = await requestAndDownload(client, 'GET_VENDOR_SALES_REPORT', {
      reportPeriod:     'DAY',
      distributorView:  'SOURCING',
      sellingProgram:   'RETAIL',
      dataStartTime:    startDate,
      dataEndTime:      endDate,
    }, marketplaceId);
    const rows = Array.isArray(data) ? data : (data?.reportData || data?.salesByAsin || []);
    const written = await writeVendorSales(clientId, rows);
    results.vendorSales = written;
    totalWritten += written;
    console.log(`[vendorIngestion] VENDOR_SALES: ${written} rows written`);
  } catch (err) {
    console.warn('[vendorIngestion] VENDOR_SALES failed:', err.message, (err.stack||'').split('\n')[1]);
    results.vendorSales = 0;
  }

  await sleep(2000);

  // ── 2. Vendor Inventory (DAY grain, max 14 days per request) ───────────────
  try {
    console.log('[vendorIngestion] Requesting GET_VENDOR_INVENTORY_REPORT...');
    // DAY grain: inventory data available at D-3 (confirmed empirically 2026-04-20)
    const endDate   = daysAgo(3);   // D-3: inventory data lag is ~72h
    const startDate = daysAgo(17);  // 14-day window ending at D-3
    const data = await requestAndDownload(client, 'GET_VENDOR_INVENTORY_REPORT', {
      reportPeriod:     'DAY',
      distributorView:  'SOURCING',
      sellingProgram:   'RETAIL',
      dataStartTime:    startDate,
      dataEndTime:      endDate,
    }, marketplaceId);
    const rows = Array.isArray(data) ? data : (data?.reportData || data?.inventoryByAsin || []);
    const written = await writeVendorInventory(clientId, rows);
    results.vendorInventory = written;
    totalWritten += written;
    console.log(`[vendorIngestion] VENDOR_INVENTORY: ${written} rows written`);
  } catch (err) {
    console.warn('[vendorIngestion] VENDOR_INVENTORY failed:', err.message, (err.stack||'').split('\n')[1]);
    results.vendorInventory = 0;
  }

  await sleep(2000);

  // ── 3. Vendor Traffic (WEEK grain, Sun→Sat aligned, no distributorView/sellingProgram) ─
  try {
    console.log('[vendorIngestion] Requesting GET_VENDOR_TRAFFIC_REPORT...');
    // WEEK reports require Sunday→Saturday alignment.
    // Traffic/NetPPM data SLA: ~96h after Saturday close (4 days to be safe).
    // Use prior week if current week's Saturday was < 4 days ago.
    const rawSat = lastCompletedSaturday();
    const daysSinceSat = Math.round((new Date() - new Date(rawSat + 'T00:00:00Z')) / 86400000);
    const endDate = daysSinceSat >= 4 ? rawSat : (() => {
      const d = new Date(rawSat + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 7); return d.toISOString().substring(0,10);
    })();
    const endSat = new Date(endDate + 'T00:00:00Z');
    const startSun = new Date(endSat); startSun.setUTCDate(endSat.getUTCDate() - 6);
    const startDate = startSun.toISOString().substring(0,10);
    const data = await requestAndDownload(client, 'GET_VENDOR_TRAFFIC_REPORT', {
      reportPeriod:     'WEEK',
      // NOTE: distributorView and sellingProgram are NOT supported for traffic/netPPM reports
      dataStartTime:    startDate,
      dataEndTime:      endDate,
    }, marketplaceId);
    const rows = Array.isArray(data) ? data : (data?.reportData || data?.trafficByAsin || []);
    const written = await writeVendorTraffic(clientId, rows);
    results.vendorTraffic = written;
    totalWritten += written;
    console.log(`[vendorIngestion] VENDOR_TRAFFIC: ${written} rows written`);
  } catch (err) {
    console.warn('[vendorIngestion] VENDOR_TRAFFIC failed:', err.message?.substring(0, 120));
    results.vendorTraffic = 0;
  }

  await sleep(2000);

  // ── 4. Vendor Net PPM (WEEK grain, Sun→Sat aligned) ─────────────────────────
  try {
    console.log('[vendorIngestion] Requesting GET_VENDOR_NET_PURE_PRODUCT_MARGIN_REPORT...');
    // Same 96h lag rule as traffic report
    const rawSat2 = lastCompletedSaturday();
    const daysSinceSat2 = Math.round((new Date() - new Date(rawSat2 + 'T00:00:00Z')) / 86400000);
    const endDate = daysSinceSat2 >= 4 ? rawSat2 : (() => {
      const d = new Date(rawSat2 + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 7); return d.toISOString().substring(0,10);
    })();
    const endSat2 = new Date(endDate + 'T00:00:00Z');
    const startSun2 = new Date(endSat2); startSun2.setUTCDate(endSat2.getUTCDate() - 6);
    const startDate = startSun2.toISOString().substring(0,10);
    const data = await requestAndDownload(client, 'GET_VENDOR_NET_PURE_PRODUCT_MARGIN_REPORT', {
      reportPeriod:     'WEEK',
      // NOTE: distributorView and sellingProgram are NOT supported for netPPM reports
      dataStartTime:    startDate,
      dataEndTime:      endDate,
    }, marketplaceId);
    const rows = Array.isArray(data) ? data : (data?.reportData || data?.netPpmByAsin || []);
    const written = await writeVendorNetPpm(clientId, rows);
    results.vendorNetPpm = written;
    totalWritten += written;
    console.log(`[vendorIngestion] VENDOR_NET_PPM: ${written} rows written`);
  } catch (err) {
    console.warn('[vendorIngestion] VENDOR_NET_PPM failed:', err.message?.substring(0, 120));
    results.vendorNetPpm = 0;
  }

  await sleep(2000);

  // ── 5. Vendor Forecasts (most recent week only) ──────────────────────────────
  try {
    console.log('[vendorIngestion] Requesting GET_VENDOR_FORECASTING_REPORT...');
    const data = await requestAndDownload(client, 'GET_VENDOR_FORECASTING_REPORT', {
      sellingProgram: 'RETAIL',
    }, marketplaceId);
    const rows = Array.isArray(data) ? data : (data?.reportData || data?.forecastByAsin || []);
    const written = await writeVendorForecasts(clientId, rows);
    results.vendorForecasts = written;
    totalWritten += written;
    console.log(`[vendorIngestion] VENDOR_FORECASTS: ${written} rows written`);
  } catch (err) {
    console.warn('[vendorIngestion] VENDOR_FORECASTS failed:', err.message?.substring(0, 120));
    results.vendorForecasts = 0;
  }

  console.log(`[vendorIngestion] Done — ${totalWritten} total rows written`, results);
  return { recordsWritten: totalWritten, breakdown: results };
}

/**
 * Backfill vendor reports for a given date range.
 *
 * DAY reports (sales, inventory): max 14-day windows per Amazon limit.
 * WEEK reports (traffic, netPPM): must align to Sunday start → Saturday end.
 *   No distributorView/sellingProgram options allowed.
 *
 * @param {string} clientId
 * @param {string} startDate  YYYY-MM-DD  (for DAY: any date; for WEEK: snapped to prev Sunday)
 * @param {string} endDate    YYYY-MM-DD  (for DAY: any date; for WEEK: snapped to prev Saturday)
 * @param {string} marketplaceId
 */
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

  // ── WEEK chunks: align to Sunday→Saturday ────────────────────────────────
  // Snap startDate back to nearest Sunday
  const wkStart = new Date(startDate + 'T00:00:00Z');
  const wkStartDay = wkStart.getUTCDay(); // 0=Sun
  if (wkStartDay !== 0) wkStart.setUTCDate(wkStart.getUTCDate() - wkStartDay);

  // Snap endDate forward to nearest Saturday, but cap at last completed Saturday
  const lastSat = new Date(lastCompletedSaturday() + 'T00:00:00Z');
  const wkEnd = new Date(endDate + 'T00:00:00Z');
  const wkEndDay = wkEnd.getUTCDay();
  if (wkEndDay !== 6) wkEnd.setUTCDate(wkEnd.getUTCDate() + (6 - wkEndDay));
  if (wkEnd > lastSat) wkEnd.setTime(lastSat.getTime());

  const weekChunks = [];
  let wkCursor = new Date(wkStart);
  while (wkCursor <= wkEnd) {
    const chunkSat = new Date(wkCursor);
    chunkSat.setUTCDate(chunkSat.getUTCDate() + 6); // Sun + 6 = Sat
    if (chunkSat > wkEnd) chunkSat.setTime(wkEnd.getTime());
    weekChunks.push({ start: toDateStr(wkCursor), end: toDateStr(chunkSat) });
    wkCursor = new Date(chunkSat);
    wkCursor.setUTCDate(wkCursor.getUTCDate() + 1); // next Sunday
  }
  console.log(`[vendorBackfill] WEEK: ${weekChunks.length} chunks (${toDateStr(wkStart)} → ${toDateStr(wkEnd)})`);

  // Batch week chunks: each chunk is one week, combine into groups of 8 to reduce API calls
  // Amazon allows multi-week ranges as long as start=Sunday and end=Saturday within the lookback
  const WEEKS_PER_REQUEST = 8; // stay well within any undocumented limits
  const weekBatches = [];
  for (let i = 0; i < weekChunks.length; i += WEEKS_PER_REQUEST) {
    const batch = weekChunks.slice(i, i + WEEKS_PER_REQUEST);
    weekBatches.push({ start: batch[0].start, end: batch[batch.length - 1].end });
  }
  console.log(`[vendorBackfill] WEEK batches: ${weekBatches.length} (${WEEKS_PER_REQUEST} weeks each)`);

  for (const batch of weekBatches) {
    results.weekChunks++;
    const client = await spClient(clientId);
    console.log(`[vendorBackfill] WEEK batch ${results.weekChunks}/${weekBatches.length}: ${batch.start} → ${batch.end}`);

    // Traffic (WEEK) — no distributorView/sellingProgram
    try {
      const data = await requestAndDownload(client, 'GET_VENDOR_TRAFFIC_REPORT', {
        reportPeriod: 'WEEK',
        dataStartTime: batch.start, dataEndTime: batch.end,
      }, marketplaceId, 600000);
      const rows = toRows(data, 'trafficByAsin', 'reportData');
      const written = await writeVendorTraffic(clientId, rows);
      results.vendorTraffic += written;
      console.log(`[vendorBackfill] TRAFFIC: ${written} rows`);
    } catch (err) {
      console.warn(`[vendorBackfill] TRAFFIC failed:`, err.message?.substring(0, 200));
    }
    await sleep(2000);

    // Net PPM (WEEK) — no distributorView/sellingProgram
    try {
      const data = await requestAndDownload(client, 'GET_VENDOR_NET_PURE_PRODUCT_MARGIN_REPORT', {
        reportPeriod: 'WEEK',
        dataStartTime: batch.start, dataEndTime: batch.end,
      }, marketplaceId, 600000);
      const rows = toRows(data, 'netPpmByAsin', 'reportData');
      const written = await writeVendorNetPpm(clientId, rows);
      results.vendorNetPpm += written;
      console.log(`[vendorBackfill] NET_PPM: ${written} rows`);
    } catch (err) {
      console.warn(`[vendorBackfill] NET_PPM failed:`, err.message?.substring(0, 200));
    }

    if (results.weekChunks < weekBatches.length) {
      console.log(`[vendorBackfill] Waiting 30s before next week batch...`);
      await sleep(30000);
    }
  }

  console.log(`[vendorBackfill] Done — sales=${results.vendorSales} inventory=${results.vendorInventory} traffic=${results.vendorTraffic} netPpm=${results.vendorNetPpm}`);
  return results;
}

module.exports = { ingestVendorReports, backfillVendorReports };
