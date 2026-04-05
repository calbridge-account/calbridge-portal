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
const { query } = require('../services/snowflakeService');
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

async function spClient(clientId) {
  const token = await getValidToken(clientId, 'vendor');
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

  // Create report
  const createRes = await client.post('/reports/2021-06-30/reports', body);
  const reportId = createRes.data?.reportId;
  if (!reportId) throw new Error(`No reportId for ${reportType}`);

  // Poll
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    await sleep(8000);
    const poll = await client.get(`/reports/2021-06-30/reports/${reportId}`);
    const { processingStatus, reportDocumentId } = poll.data;

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
  let written = 0;
  for (const row of rows) {
    const asin       = row.asin || row.parentAsin;
    const startDate  = row.startDate || row.reportingDate;
    const endDate    = row.endDate   || row.reportingDate;
    if (!asin || !startDate) continue;
    const orderedAmt  = typeof row.orderedRevenue === 'object' ? (row.orderedRevenue?.amount ?? 0) : (row.orderedRevenue ?? 0);
    const orderedCcy  = row.orderedRevenue?.currencyCode || 'USD';
    const shippedAmt  = typeof row.shippedRevenue === 'object' ? (row.shippedRevenue?.amount ?? 0) : (row.shippedRevenue ?? 0);
    const shippedCcy  = row.shippedRevenue?.currencyCode || 'USD';
    const cogsAmt     = typeof row.shippedCOGS === 'object'    ? (row.shippedCOGS?.amount ?? 0)    : (row.shippedCogs ?? 0);
    await query(`
      MERGE INTO CALBRIDGE_PROD.APP.VENDOR_SALES t
      USING (SELECT ? AS client_id, ? AS asin, ? AS start_date) s
      ON t.client_id = s.client_id AND t.asin = s.asin AND t.start_date = s.start_date
      WHEN MATCHED THEN UPDATE SET
        end_date = ?, ordered_units = ?, ordered_revenue = ?,
        ordered_currency = ?, shipped_units = ?, shipped_revenue = ?,
        shipped_cogs = ?, shipped_currency = ?, customer_returns = ?,
        synced_at = CURRENT_TIMESTAMP()
      WHEN NOT MATCHED THEN INSERT
        (client_id, asin, start_date, end_date,
         ordered_units, ordered_revenue, ordered_currency,
         shipped_units, shipped_revenue, shipped_cogs, shipped_currency,
         customer_returns, synced_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP())
    `, [
      clientId, asin, startDate,
      endDate,
      row.orderedUnits ?? 0, orderedAmt, orderedCcy,
      row.shippedUnits ?? 0, shippedAmt, cogsAmt, shippedCcy,
      row.customerReturns ?? 0,
      // INSERT values
      clientId, asin, startDate, endDate,
      row.orderedUnits ?? 0, orderedAmt, orderedCcy,
      row.shippedUnits ?? 0, shippedAmt, cogsAmt, shippedCcy,
      row.customerReturns ?? 0,
    ]);
    written++;
  }
  return written;
}

async function writeVendorInventory(clientId, rows) {
  if (!Array.isArray(rows) || !rows.length) return 0;
  let written = 0;
  for (const row of rows) {
    const asin      = row.asin || row.parentAsin;
    const startDate = row.startDate || row.reportingDate;
    const endDate   = row.endDate   || row.reportingDate;
    if (!asin || !startDate) continue;
    await query(`
      MERGE INTO CALBRIDGE_PROD.APP.VENDOR_INVENTORY t
      USING (SELECT ? AS client_id, ? AS asin, ? AS start_date) s
      ON t.client_id = s.client_id AND t.asin = s.asin AND t.start_date = s.start_date
      WHEN MATCHED THEN UPDATE SET
        end_date = ?,
        sellable_on_hand_units = ?, sellable_on_hand_cost = ?,
        unsellable_on_hand_units = ?, sell_through_rate = ?,
        vendor_confirmation_rate = ?, receive_fill_rate = ?,
        avg_vendor_lead_time_days = ?, open_purchase_order_units = ?,
        net_received_units = ?, aged_90_plus_units = ?,
        unhealthy_units = ?, unfilled_customer_ordered_units = ?,
        synced_at = CURRENT_TIMESTAMP()
      WHEN NOT MATCHED THEN INSERT
        (client_id, asin, start_date, end_date,
         sellable_on_hand_units, sellable_on_hand_cost,
         unsellable_on_hand_units, sell_through_rate,
         vendor_confirmation_rate, receive_fill_rate,
         avg_vendor_lead_time_days, open_purchase_order_units,
         net_received_units, aged_90_plus_units,
         unhealthy_units, unfilled_customer_ordered_units, synced_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP())
    `, [
      clientId, asin, startDate,
      endDate,
      row.sellableOnHandInventory?.units         || row.sellableOnHandUnits         || 0,
      row.sellableOnHandInventory?.cost?.amount  || row.sellableOnHandCost          || null,
      row.unsellableOnHandInventory?.units       || row.unsellableOnHandUnits       || 0,
      row.sellThroughRate                        || null,
      row.vendorConfirmationRate                 || null,
      row.receiveFillRate                        || null,
      row.averageVendorLeadTimeDays              || null,
      row.openPurchaseOrderUnits                 || null,
      row.netReceivedInventory?.units            || row.netReceivedUnits            || null,
      row.aged90PlusInventory?.units             || row.aged90PlusUnits             || null,
      row.unhealthyInventory?.units              || row.unhealthyUnits              || null,
      row.unfilledCustomerOrderedUnits           || null,
      // INSERT values
      clientId, asin, startDate, endDate,
      row.sellableOnHandInventory?.units         || row.sellableOnHandUnits         || 0,
      row.sellableOnHandInventory?.cost?.amount  || row.sellableOnHandCost          || null,
      row.unsellableOnHandInventory?.units       || row.unsellableOnHandUnits       || 0,
      row.sellThroughRate                        || null,
      row.vendorConfirmationRate                 || null,
      row.receiveFillRate                        || null,
      row.averageVendorLeadTimeDays              || null,
      row.openPurchaseOrderUnits                 || null,
      row.netReceivedInventory?.units            || row.netReceivedUnits            || null,
      row.aged90PlusInventory?.units             || row.aged90PlusUnits             || null,
      row.unhealthyInventory?.units              || row.unhealthyUnits              || null,
      row.unfilledCustomerOrderedUnits           || null,
    ]);
    written++;
  }
  return written;
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
 */
async function ingestVendorReports(clientId, marketplaceId = 'ATVPDKIKX0DER') {
  const client = await spClient(clientId);
  const results = {};
  let totalWritten = 0;

  // ── 1. Vendor Sales (DAY grain, last 15 days with 3-day lag) ────────────────
  try {
    console.log('[vendorIngestion] Requesting GET_VENDOR_SALES_REPORT...');
    const endDate   = daysAgo(3);   // 3-day lag
    const startDate = daysAgo(17);  // 15-day window + 3-day lag
    const data = await requestAndDownload(client, 'GET_VENDOR_SALES_REPORT', {
      reportPeriod:     'DAY',
      distributorView:  'MANUFACTURING',
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
    console.warn('[vendorIngestion] VENDOR_SALES failed:', err.message?.substring(0, 120));
    results.vendorSales = 0;
  }

  await sleep(2000);

  // ── 2. Vendor Inventory (DAY grain, last 15 days with 3-day lag) ────────────
  try {
    console.log('[vendorIngestion] Requesting GET_VENDOR_INVENTORY_REPORT...');
    const endDate   = daysAgo(3);
    const startDate = daysAgo(17);
    const data = await requestAndDownload(client, 'GET_VENDOR_INVENTORY_REPORT', {
      reportPeriod:     'DAY',
      distributorView:  'MANUFACTURING',
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
    console.warn('[vendorIngestion] VENDOR_INVENTORY failed:', err.message?.substring(0, 120));
    results.vendorInventory = 0;
  }

  await sleep(2000);

  // ── 3. Vendor Traffic (WEEK grain, last 8 weeks) ─────────────────────────────
  try {
    console.log('[vendorIngestion] Requesting GET_VENDOR_TRAFFIC_REPORT...');
    const endDate   = daysAgo(3);
    const startDate = daysAgo(59);  // ~8 weeks
    const data = await requestAndDownload(client, 'GET_VENDOR_TRAFFIC_REPORT', {
      reportPeriod:     'WEEK',
      distributorView:  'MANUFACTURING',
      sellingProgram:   'RETAIL',
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

  // ── 4. Vendor Net PPM (WEEK grain, last 8 weeks) ─────────────────────────────
  try {
    console.log('[vendorIngestion] Requesting GET_VENDOR_NET_PURE_PRODUCT_MARGIN_REPORT...');
    const endDate   = daysAgo(3);
    const startDate = daysAgo(59);
    const data = await requestAndDownload(client, 'GET_VENDOR_NET_PURE_PRODUCT_MARGIN_REPORT', {
      reportPeriod:     'WEEK',
      distributorView:  'MANUFACTURING',
      sellingProgram:   'RETAIL',
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

module.exports = { ingestVendorReports };
