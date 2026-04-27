/**
 * src/jobs/sellerIngestion.js
 *
 * Seller Central SP-API data ingestion.
 * Writes to Project GO RAW schema:
 *   - RETAIL_SALES_TRAFFIC  (GET_SALES_AND_TRAFFIC_REPORT — sessions, orders, revenue, Buy Box)
 *   - RETAIL_INVENTORY      (GET_FBA_MYI_UNSUPPRESSED_INVENTORY_DATA — FBA on-hand, inbound)
 *   - RETAIL_LISTING        (GET_MERCHANT_LISTINGS_ALL_DATA — ASIN catalog enrichment)
 *   - RETAIL_FEE            (GET_FBA_ESTIMATED_FBA_FEES_TXT_DATA — FBA fee estimates)
 *   - RETAIL_FORECAST       (GET_RESTOCK_INVENTORY_RECOMMENDATIONS_REPORT — restock/demand forecast)
 *   - RETAIL_RETURN           (GET_FBA_FULFILLMENT_CUSTOMER_RETURNS_DATA — customer returns)
 *   - RETAIL_SHIPMENT         (GET_AMAZON_FULFILLED_SHIPMENTS_DATA_GENERAL — fulfilled shipments, no PII)
 *   - RETAIL_ORDER_METRICS    (Sales API getOrderMetrics — hourly unit/order counts, intraday)
 *
 * Cadence:
 *   - ingestSellerRealtimeReports  every 6h  — orderMetrics only
 *   - ingestSellerDailyReports     daily 07:00 UTC — sales traffic, FBA inventory, restock, returns, shipments
 *   - ingestSellerWeeklyReports    weekly Sunday 07:00 UTC — FBA fees + listing snapshot
 *   - ingestSellerReports          legacy wrapper (calls all three, for backfill/manual triggers)
 */

'use strict';

require('dotenv').config();

const axios  = require('axios');
const zlib   = require('zlib');
const { query } = require('../services/snowflakeService');
const { getValidToken, getConnectionStatus } = require('../services/amazonAuthService');

const SP_API_BASE = 'https://sellingpartnerapi-na.amazon.com';

async function spClient(clientId) {
  const token = await getValidToken(clientId, 'seller');
  return axios.create({
    baseURL: SP_API_BASE,
    headers: { 'x-amz-access-token': token, 'Content-Type': 'application/json' },
    timeout: 30000,
  });
}

/**
 * Retry wrapper with exponential backoff for Amazon SP-API 429 rate limits.
 */
async function withRetry(fn, refreshFn, clientRef, retries = 3, baseDelayMs = 10000) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (e) {
      const is429 = e?.response?.status === 429 || e?.message?.includes('429');
      if (is429 && i < retries - 1) {
        const delay = baseDelayMs * Math.pow(2, i);
        console.warn(`[sellerIngestion] 429 rate limit — retrying in ${delay / 1000}s (attempt ${i + 1}/${retries})`);
        await new Promise(r => setTimeout(r, delay));
        try { clientRef.current = await refreshFn(); } catch (_) {}
      } else {
        throw e;
      }
    }
  }
}

// ─── SP-API Token Bucket ─────────────────────────────────────────────────────
// GET_SALES_AND_TRAFFIC_REPORT createReport limit: burst=15, restore=1/60s.
// All other seller report types share the same /reports endpoint bucket.
// This bucket is process-global — prevents multi-client runs from exhausting quota.
const SP_API_BUCKET = {
  tokens: 15,
  max: 15,
  restoreRateMs: 60000, // 1 token per 60s
  lastRestoreMs: Date.now(),
};
async function acquireSpApiToken(reportType) {
  // Restore tokens since last call
  const now = Date.now();
  const elapsed = now - SP_API_BUCKET.lastRestoreMs;
  const restored = Math.floor(elapsed / SP_API_BUCKET.restoreRateMs);
  if (restored > 0) {
    SP_API_BUCKET.tokens = Math.min(SP_API_BUCKET.max, SP_API_BUCKET.tokens + restored);
    SP_API_BUCKET.lastRestoreMs += restored * SP_API_BUCKET.restoreRateMs;
  }
  // Wait if bucket is empty
  if (SP_API_BUCKET.tokens <= 0) {
    const waitMs = SP_API_BUCKET.restoreRateMs - (Date.now() - SP_API_BUCKET.lastRestoreMs);
    if (waitMs > 0) {
      console.log(`[sellerIngestion] SP-API token bucket empty for ${reportType} — waiting ${Math.ceil(waitMs/1000)}s`);
      await new Promise(r => setTimeout(r, waitMs + 500));
      // Restore after wait
      SP_API_BUCKET.tokens = Math.min(SP_API_BUCKET.max, SP_API_BUCKET.tokens + 1);
      SP_API_BUCKET.lastRestoreMs = Date.now();
    }
  }
  SP_API_BUCKET.tokens--;
}

async function requestAndPoll(client, reportType, body = {}, maxWaitMs = 600000) {
  await acquireSpApiToken(reportType);
  const res = await client.post('/reports/2021-06-30/reports', {
    reportType,
    marketplaceIds: ['ATVPDKIKX0DER'],
    ...body,
  });
  const reportId = res.data.reportId;
  if (!reportId) throw new Error(`No reportId for ${reportType}`);

  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    await new Promise(r => setTimeout(r, 10000));
    const poll = await client.get(`/reports/2021-06-30/reports/${reportId}`);
    const { processingStatus, reportDocumentId } = poll.data;
    if (processingStatus === 'DONE' && reportDocumentId) {
      const docRes = await client.get(`/reports/2021-06-30/documents/${reportDocumentId}`);
      const dl = await axios.get(docRes.data.url, { responseType: 'arraybuffer', timeout: 60000 });
      let text;
      if (docRes.data.compressionAlgorithm === 'GZIP') {
        text = zlib.gunzipSync(Buffer.from(dl.data)).toString('utf8');
      } else {
        text = Buffer.from(dl.data).toString('utf8');
      }
      try { return JSON.parse(text); } catch { return text; }
    }
    if (['CANCELLED', 'FATAL'].includes(processingStatus)) {
      if (reportDocumentId) {
        try {
          const docRes = await client.get(`/reports/2021-06-30/documents/${reportDocumentId}`);
          const dl = await axios.get(docRes.data.url, { responseType: 'arraybuffer' });
          const errText = Buffer.from(dl.data).toString('utf8');
          throw new Error(`${reportType} FATAL: ${errText.slice(0, 200)}`);
        } catch (e2) { if (e2.message.includes(reportType)) throw e2; }
      }
      throw new Error(`${reportType} ended with: ${processingStatus}`);
    }
  }
  throw new Error(`${reportType} timed out`);
}

/**
 * Parse a TSV flat-file string into an array of objects.
 * First line = headers (lowercased, trimmed).
 */
function parseTsv(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return { headers: [], rows: [] };
  const headers = lines[0].split('\t').map(h => h.trim().toLowerCase());
  const rows = lines.slice(1).map(line => {
    const vals = line.split('\t');
    const o = {};
    headers.forEach((h, i) => { o[h] = vals[i]?.trim() ?? null; });
    return o;
  });
  return { headers, rows };
}

/**
 * Bulk MERGE helper using VALUES(...),(...),...  batches of up to batchSize rows.
 * buildMergeSql(batch) → { sql, binds } for each batch.
 */
async function bulkMerge(rows, batchSize, buildMergeSql) {
  let written = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    try {
      const { sql, binds } = buildMergeSql(batch);
      await query(sql, binds);
      written += batch.length;
    } catch (e) {
      console.warn(`[sellerIngestion] bulkMerge batch failed:`, e.message.slice(0, 120));
    }
  }
  return written;
}

// ─── 1. Sales & Traffic ───────────────────────────────────────────────────────

async function ingestSalesTraffic(clientId, client, daysBack = 14, startDateOverride = null, endDateOverride = null) {
  const endDate   = endDateOverride   || new Date(Date.now() - 2 * 86400000).toISOString().split('T')[0];
  const startDate = startDateOverride || new Date(Date.now() - (daysBack + 2) * 86400000).toISOString().split('T')[0];

  const data = await requestAndPoll(client, 'GET_SALES_AND_TRAFFIC_REPORT', {
    dataStartTime: startDate + 'T00:00:00Z',
    dataEndTime:   endDate   + 'T23:59:59Z',
    reportOptions: { dateGranularity: 'DAY', asinGranularity: 'CHILD' },
  }, 240000);

  const endDateSnapshot = endDate;

  const byAsinRows = (data?.salesAndTrafficByAsin || []).map(item => {
    const asin = item.parentAsin || item.childAsin;
    if (!asin) return null;
    const s = item.salesByAsin   || {};
    const t = item.trafficByAsin || {};
    return {
      client_id:           clientId,
      platform:            'amazon',
      marketplace:         'US',
      asin,
      date:                endDateSnapshot,
      ordered_units:       s.unitsOrdered ?? 0,
      ordered_revenue:     s.orderedProductSales?.amount ?? 0,
      currency_code:       s.orderedProductSales?.currencyCode || 'USD',
      shipped_units:       s.unitsShipped ?? 0,
      shipped_revenue:     0,
      sessions:            t.sessions ?? 0,
      page_views:          t.pageViews ?? 0,
      buy_box_pct:         t.buyBoxPercentage ?? null,
      unit_session_pct:    t.unitSessionPercentage ?? null,
      b2b_ordered_units:   s.unitsOrderedB2B ?? 0,
      b2b_ordered_revenue: s.orderedProductSalesB2B?.amount ?? 0,
      selling_program:     'RETAIL',
      distributor_view:    'SOURCING',
    };
  }).filter(Boolean);

  const byDateRows = (data?.salesAndTrafficByDate || []).map(item => {
    const date = item.date;
    if (!date) return null;
    const s = item.salesByDate   || {};
    const t = item.trafficByDate || {};
    return {
      client_id:           clientId,
      platform:            'amazon',
      marketplace:         'US',
      asin:                '__ACCOUNT__',
      date,
      ordered_units:       s.unitsOrdered ?? 0,
      ordered_revenue:     s.orderedProductSales?.amount ?? 0,
      currency_code:       s.orderedProductSales?.currencyCode || 'USD',
      shipped_units:       s.unitsShipped ?? 0,
      shipped_revenue:     0,
      sessions:            t.sessions ?? 0,
      page_views:          t.pageViews ?? 0,
      buy_box_pct:         t.buyBoxPercentage ?? null,
      unit_session_pct:    t.unitSessionPercentage ?? null,
      b2b_ordered_units:   s.unitsOrderedB2B ?? 0,
      b2b_ordered_revenue: s.orderedProductSalesB2B?.amount ?? 0,
      selling_program:     'RETAIL',
      distributor_view:    'SOURCING',
    };
  }).filter(Boolean);

  // Deduplicate: last write wins for same (asin, date, marketplace)
  const rowMap = new Map();
  for (const r of [...byAsinRows, ...byDateRows]) {
    const key = `${r.asin}|${r.date}|${r.marketplace}`;
    rowMap.set(key, r);
  }
  const rows = Array.from(rowMap.values());
  if (!rows.length) return 0;

  // Bulk MERGE for RETAIL_SALES_TRAFFIC
  return bulkMerge(rows, 500, (batch) => {
    const placeholders = batch.map(() =>
      '(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
    ).join(',');
    const binds = [];
    for (const r of batch) {
      binds.push(
        r.client_id, r.asin, r.date, r.marketplace, r.platform,
        r.ordered_units, r.ordered_revenue, r.currency_code,
        r.shipped_units, r.sessions, r.page_views,
        r.buy_box_pct, r.unit_session_pct, r.selling_program, r.distributor_view,
        r.ordered_units, r.ordered_revenue, r.currency_code,
        r.shipped_units
      );
    }
    const sql = `
      MERGE INTO CALBRIDGE_PROD.RAW.RETAIL_SALES_TRAFFIC t
      USING (
        SELECT v.col1 AS client_id, v.col2 AS asin, v.col3::DATE AS dt,
               v.col4 AS marketplace, v.col5 AS platform,
               v.col6::NUMBER AS ordered_units, v.col7::FLOAT AS ordered_revenue,
               v.col8 AS currency_code, v.col9::NUMBER AS shipped_units,
               v.col10::NUMBER AS sessions, v.col11::NUMBER AS page_views,
               v.col12::FLOAT AS buy_box_pct, v.col13::FLOAT AS unit_session_pct,
               v.col14 AS selling_program, v.col15 AS distributor_view,
               v.col16::NUMBER AS ordered_units_upd, v.col17::FLOAT AS ordered_revenue_upd,
               v.col18 AS currency_code_upd, v.col19::NUMBER AS shipped_units_upd
        FROM VALUES ${placeholders} AS v(col1,col2,col3,col4,col5,col6,col7,col8,col9,col10,col11,col12,col13,col14,col15,col16,col17,col18,col19)
      ) s ON t.client_id=s.client_id AND t.asin=s.asin AND t.date=s.dt AND t.marketplace=s.marketplace
      WHEN MATCHED THEN UPDATE SET
        ordered_units=s.ordered_units_upd, ordered_revenue=s.ordered_revenue_upd,
        currency_code=s.currency_code_upd, shipped_units=s.shipped_units_upd,
        sessions=s.sessions, page_views=s.page_views,
        buy_box_pct=s.buy_box_pct, unit_session_pct=s.unit_session_pct,
        selling_program=s.selling_program, distributor_view=s.distributor_view,
        ingested_at=CURRENT_TIMESTAMP()
      WHEN NOT MATCHED THEN INSERT
        (client_id,asin,date,marketplace,platform,ordered_units,ordered_revenue,currency_code,
         shipped_units,sessions,page_views,buy_box_pct,unit_session_pct,selling_program,distributor_view,ingested_at)
        VALUES (s.client_id,s.asin,s.dt,s.marketplace,s.platform,s.ordered_units,s.ordered_revenue,s.currency_code,
                s.shipped_units,s.sessions,s.page_views,s.buy_box_pct,s.unit_session_pct,s.selling_program,s.distributor_view,CURRENT_TIMESTAMP())
    `;
    return { sql, binds };
  });
}

// ─── 2. FBA Inventory ─────────────────────────────────────────────────────────

async function ingestFbaInventory(clientId, client) {
  let data;
  try {
    data = await requestAndPoll(client, 'GET_FBA_MYI_UNSUPPRESSED_INVENTORY_DATA', {}, 240000);
  } catch (e) {
    if (e.message.includes('FATAL')) {
      console.log('[sellerIngestion] FBA report FATAL — account may not use FBA, trying MFN listings');
      data = await requestAndPoll(client, 'GET_FLAT_FILE_OPEN_LISTINGS_DATA', {}, 240000);
    } else {
      throw e;
    }
  }
  const today = new Date().toISOString().split('T')[0];

  if (typeof data !== 'string') {
    console.warn('[sellerIngestion] FBA inventory: unexpected non-TSV response');
    return 0;
  }

  const { rows } = parseTsv(data);
  const validRows = rows.filter(r => r.asin);
  if (!validRows.length) return 0;

  const mapped = validRows.map(r => ({
    client_id:                 clientId,
    platform:                  'amazon',
    marketplace:               'US',
    asin:                      r.asin,
    date:                      today,
    sellable_on_hand_units:    Number(r['afn-fulfillable-quantity'] ?? r['afn_fulfillable_quantity'] ?? r.quantity_available ?? 0),
    unsellable_on_hand_units:  Number(r['afn-unsellable-quantity'] ?? r['afn_unsellable_quantity'] ?? 0),
    open_purchase_order_units: Number(r['afn-inbound-working-quantity'] ?? r['afn_inbound_working_quantity'] ?? r.quantity_in_transit ?? 0),
    net_received_units:        Number(r['afn-inbound-receiving-quantity'] ?? r['afn_inbound_receiving_quantity'] ?? 0),
    selling_program:           'RETAIL',
    distributor_view:          'SOURCING',
  }));

  return bulkMerge(mapped, 500, (batch) => {
    const placeholders = batch.map(() => '(?,?,?,?,?,?,?,?,?,?,?)').join(',');
    const binds = [];
    for (const r of batch) {
      binds.push(
        r.client_id, r.asin, r.date, r.marketplace, r.platform,
        r.sellable_on_hand_units, r.unsellable_on_hand_units,
        r.open_purchase_order_units, r.net_received_units,
        r.selling_program, r.distributor_view
      );
    }
    const sql = `
      MERGE INTO CALBRIDGE_PROD.RAW.RETAIL_INVENTORY t
      USING (
        SELECT v.col1 AS client_id, v.col2 AS asin, v.col3::DATE AS dt,
               v.col4 AS marketplace, v.col5 AS platform,
               v.col6::NUMBER AS sellable_units, v.col7::NUMBER AS unsellable_units,
               v.col8::NUMBER AS open_po_units, v.col9::NUMBER AS net_rcv_units,
               v.col10 AS selling_program, v.col11 AS distributor_view
        FROM VALUES ${placeholders} AS v(col1,col2,col3,col4,col5,col6,col7,col8,col9,col10,col11)
      ) s ON t.client_id=s.client_id AND t.asin=s.asin AND t.date=s.dt AND t.marketplace=s.marketplace
      WHEN MATCHED THEN UPDATE SET
        sellable_on_hand_units=s.sellable_units, unsellable_on_hand_units=s.unsellable_units,
        open_purchase_order_units=s.open_po_units, net_received_units=s.net_rcv_units,
        selling_program=s.selling_program, distributor_view=s.distributor_view,
        ingested_at=CURRENT_TIMESTAMP()
      WHEN NOT MATCHED THEN INSERT
        (client_id,asin,date,marketplace,platform,sellable_on_hand_units,
         unsellable_on_hand_units,open_purchase_order_units,net_received_units,
         selling_program,distributor_view,ingested_at)
        VALUES (s.client_id,s.asin,s.dt,s.marketplace,s.platform,s.sellable_units,
                s.unsellable_units,s.open_po_units,s.net_rcv_units,
                s.selling_program,s.distributor_view,CURRENT_TIMESTAMP())
    `;
    return { sql, binds };
  });
}

// ─── 3. FBA Fees ──────────────────────────────────────────────────────────────

async function ingestFbaFees(clientId, client) {
  let data;
  try {
    data = await requestAndPoll(client, 'GET_FBA_ESTIMATED_FBA_FEES_TXT_DATA', {}, 300000);
  } catch (e) {
    // Some accounts (e.g., MFN-only) get FATAL on this report — treat as no-op
    if (e.message.includes('FATAL') || e.message.includes('CANCELLED')) {
      console.log('[sellerIngestion] FBA_FEES report not available for this account — skipping');
      return 0;
    }
    throw e;
  }

  if (typeof data !== 'string') {
    console.warn('[sellerIngestion] FBA_FEES: unexpected non-TSV response');
    return 0;
  }

  const { rows } = parseTsv(data);
  const today = new Date().toISOString().split('T')[0];

  const validRows = rows.filter(r => r.asin && r['estimated-fee-total']);
  if (!validRows.length) return 0;

  const mapped = validRows.map(r => ({
    client_id:    clientId,
    platform:     'amazon',
    marketplace:  'US',
    asin:         r.asin,
    fee_type:     'fba_total',
    fee_amount:   parseFloat(r['estimated-fee-total']) || 0,
    currency_code: 'USD',
    synced_at:    today,
  }));

  return bulkMerge(mapped, 500, (batch) => {
    const placeholders = batch.map(() => '(?,?,?,?,?,?,?,?)').join(',');
    const binds = [];
    for (const r of batch) {
      binds.push(
        r.client_id, r.platform, r.marketplace, r.asin,
        r.fee_type, r.fee_amount, r.currency_code, r.synced_at
      );
    }
    const sql = `
      MERGE INTO CALBRIDGE_PROD.RAW.RETAIL_FEE t
      USING (
        SELECT v.col1 AS client_id, v.col2 AS platform, v.col3 AS marketplace,
               v.col4 AS asin, v.col5 AS fee_type, v.col6::FLOAT AS fee_amount,
               v.col7 AS currency_code, v.col8::DATE AS synced_at
        FROM VALUES ${placeholders} AS v(col1,col2,col3,col4,col5,col6,col7,col8)
      ) s ON t.client_id=s.client_id AND t.asin=s.asin AND t.fee_type=s.fee_type AND t.marketplace=s.marketplace
      WHEN MATCHED THEN UPDATE SET
        fee_amount=s.fee_amount, currency_code=s.currency_code,
        synced_at=s.synced_at, ingested_at=CURRENT_TIMESTAMP()
      WHEN NOT MATCHED THEN INSERT
        (client_id,platform,marketplace,asin,fee_type,fee_amount,currency_code,synced_at,ingested_at)
        VALUES (s.client_id,s.platform,s.marketplace,s.asin,s.fee_type,s.fee_amount,s.currency_code,s.synced_at,CURRENT_TIMESTAMP())
    `;
    return { sql, binds };
  });
}

// ─── 4. Restock / Forecast ────────────────────────────────────────────────────
// RETAIL_FORECAST columns:
//   CLIENT_ID, PLATFORM, MARKETPLACE, INGESTED_AT, REPORT_ID, PIPELINE_RUN_ID,
//   DATA_MATURITY, LAST_REFRESHED_AT, ASIN, FORECAST_GENERATION_DATE,
//   START_DATE, END_DATE, MEAN_FORECAST_UNITS, P70_FORECAST_UNITS,
//   P80_FORECAST_UNITS, P90_FORECAST_UNITS, SELLING_PROGRAM
//
// Report columns (from actual download):
//   Country, Product Name, FNSKU, Merchant SKU, ASIN, Condition, Supplier,
//   Supplier part no., Currency code, Price, Sales last 30 days,
//   Units Sold Last 30 Days, Total Units, Inbound, Available, FC transfer,
//   FC Processing, Customer Order, Unfulfillable, Working, Shipped, Receiving,
//   Fulfilled by, Total Days of Supply (including units from open shipments),
//   Days of Supply at Amazon Fulfillment Network, Alert, Recommended replenishment qty,
//   Recommended ship date, Recommended action, Unit storage size

async function ingestRestockRecommendations(clientId, client) {
  let data;
  try {
    data = await requestAndPoll(client, 'GET_RESTOCK_INVENTORY_RECOMMENDATIONS_REPORT', {}, 300000);
  } catch (e) {
    if (e.message.includes('FATAL') || e.message.includes('CANCELLED')) {
      console.log('[sellerIngestion] RESTOCK report not available — skipping');
      return 0;
    }
    throw e;
  }

  if (typeof data !== 'string') {
    console.warn('[sellerIngestion] RESTOCK: unexpected non-TSV response');
    return 0;
  }

  const { rows } = parseTsv(data);
  const today = new Date().toISOString().split('T')[0];

  const validRows = rows.filter(r => r.asin);
  if (!validRows.length) return 0;

  // Map restock report columns → RETAIL_FORECAST schema.
  // "Units Sold Last 30 Days" is the closest to MEAN_FORECAST_UNITS (actual demand).
  // "Recommended replenishment qty" maps to P70/P80/P90 (same value — best available).
  const mapped = validRows.map(r => {
    const unitsSold30  = parseInt(r['units sold last 30 days'] ?? '0', 10) || 0;
    const restockQty   = parseInt(r['recommended replenishment qty'] ?? '0', 10) || 0;
    // Ship date can be 'none', a date string, or null — normalize to today if not a real date
    const rawShipDate  = r['recommended ship date'] || '';
    const shipDate     = /^\d{4}-\d{2}-\d{2}/.test(rawShipDate) ? rawShipDate : today;
    return {
      client_id:              clientId,
      platform:               'amazon',
      marketplace:            'US',
      asin:                   r.asin,
      forecast_generation_date: today,
      start_date:             today,
      end_date:               shipDate,
      mean_forecast_units:    unitsSold30,
      p70_forecast_units:     restockQty,
      p80_forecast_units:     restockQty,
      p90_forecast_units:     restockQty,
      selling_program:        'RETAIL',
    };
  });

  return bulkMerge(mapped, 500, (batch) => {
    const placeholders = batch.map(() => '(?,?,?,?,?,?,?,?,?,?,?,?)').join(',');
    const binds = [];
    for (const r of batch) {
      binds.push(
        r.client_id, r.platform, r.marketplace, r.asin,
        r.forecast_generation_date, r.start_date, r.end_date,
        r.mean_forecast_units, r.p70_forecast_units, r.p80_forecast_units,
        r.p90_forecast_units, r.selling_program
      );
    }
    const sql = `
      MERGE INTO CALBRIDGE_PROD.RAW.RETAIL_FORECAST t
      USING (
        SELECT v.col1 AS client_id, v.col2 AS platform, v.col3 AS marketplace,
               v.col4 AS asin, v.col5::DATE AS forecast_gen_date,
               v.col6::DATE AS start_date, v.col7::DATE AS end_date,
               v.col8::NUMBER AS mean_units, v.col9::NUMBER AS p70_units,
               v.col10::NUMBER AS p80_units, v.col11::NUMBER AS p90_units,
               v.col12 AS selling_program
        FROM VALUES ${placeholders} AS v(col1,col2,col3,col4,col5,col6,col7,col8,col9,col10,col11,col12)
      ) s ON t.client_id=s.client_id AND t.asin=s.asin
             AND t.marketplace=s.marketplace AND t.forecast_generation_date=s.forecast_gen_date
      WHEN MATCHED THEN UPDATE SET
        mean_forecast_units=s.mean_units, p70_forecast_units=s.p70_units,
        p80_forecast_units=s.p80_units, p90_forecast_units=s.p90_units,
        start_date=s.start_date, end_date=s.end_date,
        selling_program=s.selling_program, ingested_at=CURRENT_TIMESTAMP()
      WHEN NOT MATCHED THEN INSERT
        (client_id,platform,marketplace,asin,forecast_generation_date,start_date,end_date,
         mean_forecast_units,p70_forecast_units,p80_forecast_units,p90_forecast_units,
         selling_program,ingested_at)
        VALUES (s.client_id,s.platform,s.marketplace,s.asin,s.forecast_gen_date,s.start_date,s.end_date,
                s.mean_units,s.p70_units,s.p80_units,s.p90_units,s.selling_program,CURRENT_TIMESTAMP())
    `;
    return { sql, binds };
  });
}

// ─── 5. Customer Returns ──────────────────────────────────────────────────────
// RETAIL_RETURN — created if needed.
// Report headers: return-date, order-id, sku, asin, fnsku, product-name,
//   quantity, fulfillment-center-id, detailed-disposition, reason, status,
//   license-plate-number, customer-comments

async function ensureReturnTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS CALBRIDGE_PROD.RAW.RETAIL_RETURN (
      CLIENT_ID          VARCHAR(36)   NOT NULL,
      PLATFORM           VARCHAR(50)   NOT NULL DEFAULT 'amazon',
      MARKETPLACE        VARCHAR(10)   NOT NULL DEFAULT 'US',
      INGESTED_AT        TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
      RETURN_DATE        TIMESTAMP_NTZ,
      ORDER_ID           VARCHAR(50),
      SKU                VARCHAR(100),
      ASIN               VARCHAR(20),
      FNSKU              VARCHAR(20),
      QUANTITY           NUMBER(10,0),
      FULFILLMENT_CENTER VARCHAR(20),
      DISPOSITION        VARCHAR(100),
      REASON             VARCHAR(200),
      STATUS             VARCHAR(100),
      LICENSE_PLATE      VARCHAR(50)
    )
  `);
}

async function ingestCustomerReturns(clientId, client, daysBack = 90, startDateOverride = null, endDateOverride = null) {
  const endDate   = endDateOverride   || new Date(Date.now() - 2 * 86400000).toISOString().split('T')[0];
  const startDate = startDateOverride || new Date(Date.now() - daysBack * 86400000).toISOString().split('T')[0];

  let data;
  try {
    data = await requestAndPoll(client, 'GET_FBA_FULFILLMENT_CUSTOMER_RETURNS_DATA', {
      dataStartTime: startDate + 'T00:00:00Z',
      dataEndTime:   endDate   + 'T23:59:59Z',
    }, 300000);
  } catch (e) {
    if (e.message.includes('FATAL') || e.message.includes('CANCELLED')) {
      console.log('[sellerIngestion] CUSTOMER_RETURNS not available — skipping');
      return 0;
    }
    throw e;
  }

  if (typeof data !== 'string') {
    console.warn('[sellerIngestion] CUSTOMER_RETURNS: unexpected non-TSV response');
    return 0;
  }

  const { rows } = parseTsv(data);
  const validRows = rows.filter(r => r['return-date'] || r['order-id']);
  if (!validRows.length) return 0;

  await ensureReturnTable();

  const mapped = validRows.map(r => ({
    client_id:          clientId,
    platform:           'amazon',
    marketplace:        'US',
    return_date:        r['return-date'] || null,
    order_id:           r['order-id'] || null,
    sku:                r['sku'] || null,
    asin:               r['asin'] || null,
    fnsku:              r['fnsku'] || null,
    quantity:           parseInt(r['quantity'] ?? '0', 10) || 0,
    fulfillment_center: r['fulfillment-center-id'] || null,
    disposition:        r['detailed-disposition'] || null,
    reason:             r['reason'] || null,
    status:             r['status'] || null,
    license_plate:      r['license-plate-number'] || null,
  }));

  return bulkMerge(mapped, 500, (batch) => {
    const placeholders = batch.map(() => '(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').join(',');
    const binds = [];
    for (const r of batch) {
      binds.push(
        r.client_id, r.platform, r.marketplace,
        r.return_date, r.order_id, r.sku, r.asin, r.fnsku,
        r.quantity, r.fulfillment_center, r.disposition,
        r.reason, r.status, r.license_plate
      );
    }
    const sql = `
      MERGE INTO CALBRIDGE_PROD.RAW.RETAIL_RETURN t
      USING (
        SELECT v.col1 AS client_id, v.col2 AS platform, v.col3 AS marketplace,
               TRY_TO_TIMESTAMP(v.col4) AS return_date, v.col5 AS order_id,
               v.col6 AS sku, v.col7 AS asin, v.col8 AS fnsku,
               v.col9::NUMBER AS quantity, v.col10 AS fulfillment_center,
               v.col11 AS disposition, v.col12 AS reason,
               v.col13 AS status, v.col14 AS license_plate
        FROM VALUES ${placeholders} AS v(col1,col2,col3,col4,col5,col6,col7,col8,col9,col10,col11,col12,col13,col14)
      ) s ON t.client_id=s.client_id AND t.order_id=s.order_id AND t.asin=s.asin
             AND t.return_date=s.return_date AND t.license_plate=s.license_plate
      WHEN MATCHED THEN UPDATE SET
        quantity=s.quantity, disposition=s.disposition, reason=s.reason,
        status=s.status, ingested_at=CURRENT_TIMESTAMP()
      WHEN NOT MATCHED THEN INSERT
        (client_id,platform,marketplace,return_date,order_id,sku,asin,fnsku,
         quantity,fulfillment_center,disposition,reason,status,license_plate,ingested_at)
        VALUES (s.client_id,s.platform,s.marketplace,s.return_date,s.order_id,s.sku,s.asin,s.fnsku,
                s.quantity,s.fulfillment_center,s.disposition,s.reason,s.status,s.license_plate,CURRENT_TIMESTAMP())
    `;
    return { sql, binds };
  });
}

// ─── 6. Fulfilled Shipments ───────────────────────────────────────────────────
// RETAIL_SHIPMENT — created if needed. PII fields are dropped.
// Report headers (actual): amazon-order-id, merchant-order-id, shipment-id,
//   shipment-item-id, amazon-order-item-id, merchant-order-item-id,
//   purchase-date, payments-date, shipment-date, reporting-date,
//   buyer-email [SKIP], buyer-name [SKIP], buyer-phone-number [SKIP],
//   sku, product-name, quantity-shipped, currency, item-price, item-tax,
//   shipping-price, shipping-tax, gift-wrap-price, gift-wrap-tax,
//   ship-service-level, recipient-name [SKIP], ship-address-1/2/3 [SKIP],
//   ship-city, ship-state, ship-postal-code, ship-country, ship-phone-number [SKIP],
//   bill-address-1/2/3 [SKIP], bill-city, bill-state, bill-postal-code, bill-country,
//   item-promotion-discount, ship-promotion-discount, carrier, tracking-number,
//   estimated-arrival-date, fulfillment-center-id, fulfillment-channel, sales-channel

const PII_FIELDS = new Set([
  'buyer-email', 'buyer-name', 'buyer-phone-number', 'recipient-name',
  'ship-address-1', 'ship-address-2', 'ship-address-3', 'ship-phone-number',
  'bill-address-1', 'bill-address-2', 'bill-address-3', 'bill-phone-number',
]);

async function ensureShipmentTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS CALBRIDGE_PROD.RAW.RETAIL_SHIPMENT (
      CLIENT_ID                VARCHAR(36)    NOT NULL,
      PLATFORM                 VARCHAR(50)    NOT NULL DEFAULT 'amazon',
      MARKETPLACE              VARCHAR(10)    NOT NULL DEFAULT 'US',
      INGESTED_AT              TIMESTAMP_NTZ  DEFAULT CURRENT_TIMESTAMP(),
      AMAZON_ORDER_ID          VARCHAR(50),
      MERCHANT_ORDER_ID        VARCHAR(50),
      SHIPMENT_ID              VARCHAR(50),
      SHIPMENT_ITEM_ID         VARCHAR(50),
      AMAZON_ORDER_ITEM_ID     VARCHAR(50),
      MERCHANT_ORDER_ITEM_ID   VARCHAR(50),
      PURCHASE_DATE            TIMESTAMP_NTZ,
      PAYMENTS_DATE            TIMESTAMP_NTZ,
      SHIPMENT_DATE            TIMESTAMP_NTZ,
      REPORTING_DATE           TIMESTAMP_NTZ,
      SKU                      VARCHAR(100),
      PRODUCT_NAME             VARCHAR(500),
      QUANTITY_SHIPPED         NUMBER(10,0),
      CURRENCY                 VARCHAR(5),
      ITEM_PRICE               FLOAT,
      ITEM_TAX                 FLOAT,
      SHIPPING_PRICE           FLOAT,
      SHIPPING_TAX             FLOAT,
      GIFT_WRAP_PRICE          FLOAT,
      GIFT_WRAP_TAX            FLOAT,
      SHIP_SERVICE_LEVEL       VARCHAR(50),
      SHIP_CITY                VARCHAR(100),
      SHIP_STATE               VARCHAR(50),
      SHIP_POSTAL_CODE         VARCHAR(20),
      SHIP_COUNTRY             VARCHAR(5),
      BILL_CITY                VARCHAR(100),
      BILL_STATE               VARCHAR(50),
      BILL_POSTAL_CODE         VARCHAR(20),
      BILL_COUNTRY             VARCHAR(5),
      ITEM_PROMOTION_DISCOUNT  FLOAT,
      SHIP_PROMOTION_DISCOUNT  FLOAT,
      CARRIER                  VARCHAR(50),
      TRACKING_NUMBER          VARCHAR(100),
      ESTIMATED_ARRIVAL_DATE   TIMESTAMP_NTZ,
      FULFILLMENT_CENTER_ID    VARCHAR(20),
      FULFILLMENT_CHANNEL      VARCHAR(20),
      SALES_CHANNEL            VARCHAR(100)
    )
  `);
}

async function ingestFulfilledShipments(clientId, client, daysBack = 90, startDateOverride = null, endDateOverride = null) {
  const endDate   = endDateOverride   || new Date(Date.now() - 2 * 86400000).toISOString().split('T')[0];
  const startDate = startDateOverride || new Date(Date.now() - daysBack * 86400000).toISOString().split('T')[0];

  let data;
  try {
    data = await requestAndPoll(client, 'GET_AMAZON_FULFILLED_SHIPMENTS_DATA_GENERAL', {
      dataStartTime: startDate + 'T00:00:00Z',
      dataEndTime:   endDate   + 'T23:59:59Z',
    }, 300000);
  } catch (e) {
    if (e.message.includes('FATAL') || e.message.includes('CANCELLED')) {
      console.log('[sellerIngestion] FULFILLED_SHIPMENTS not available — skipping');
      return 0;
    }
    throw e;
  }

  if (typeof data !== 'string') {
    console.warn('[sellerIngestion] FULFILLED_SHIPMENTS: unexpected non-TSV response');
    return 0;
  }

  const { rows } = parseTsv(data);
  const validRows = rows.filter(r => r['amazon-order-id'] || r['shipment-id']);
  if (!validRows.length) return 0;

  await ensureShipmentTable();

  const toFloat = v => v ? (parseFloat(v) || null) : null;
  const toInt   = v => v ? (parseInt(v, 10) || null) : null;

  const mapped = validRows.map(r => ({
    client_id:               clientId,
    platform:                'amazon',
    marketplace:             'US',
    amazon_order_id:         r['amazon-order-id'] || null,
    merchant_order_id:       r['merchant-order-id'] || null,
    shipment_id:             r['shipment-id'] || null,
    shipment_item_id:        r['shipment-item-id'] || null,
    amazon_order_item_id:    r['amazon-order-item-id'] || null,
    merchant_order_item_id:  r['merchant-order-item-id'] || null,
    purchase_date:           r['purchase-date'] || null,
    payments_date:           r['payments-date'] || null,
    shipment_date:           r['shipment-date'] || null,
    reporting_date:          r['reporting-date'] || null,
    sku:                     r['sku'] || null,
    product_name:            r['product-name'] || null,
    quantity_shipped:        toInt(r['quantity-shipped']),
    currency:                r['currency'] || null,
    item_price:              toFloat(r['item-price']),
    item_tax:                toFloat(r['item-tax']),
    shipping_price:          toFloat(r['shipping-price']),
    shipping_tax:            toFloat(r['shipping-tax']),
    gift_wrap_price:         toFloat(r['gift-wrap-price']),
    gift_wrap_tax:           toFloat(r['gift-wrap-tax']),
    ship_service_level:      r['ship-service-level'] || null,
    ship_city:               r['ship-city'] || null,
    ship_state:              r['ship-state'] || null,
    ship_postal_code:        r['ship-postal-code'] || null,
    ship_country:            r['ship-country'] || null,
    bill_city:               r['bill-city'] || null,
    bill_state:              r['bill-state'] || null,
    bill_postal_code:        r['bill-postal-code'] || null,
    bill_country:            r['bill-country'] || null,
    item_promotion_discount: toFloat(r['item-promotion-discount']),
    ship_promotion_discount: toFloat(r['ship-promotion-discount']),
    carrier:                 r['carrier'] || null,
    tracking_number:         r['tracking-number'] || null,
    estimated_arrival_date:  r['estimated-arrival-date'] || null,
    fulfillment_center_id:   r['fulfillment-center-id'] || null,
    fulfillment_channel:     r['fulfillment-channel'] || null,
    sales_channel:           r['sales-channel'] || null,
  }));

  return bulkMerge(mapped, 500, (batch) => {
    const placeholders = batch.map(() =>
      '(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
    ).join(',');
    const binds = [];
    for (const r of batch) {
      binds.push(
        r.client_id, r.platform, r.marketplace,
        r.amazon_order_id, r.merchant_order_id, r.shipment_id,
        r.shipment_item_id, r.amazon_order_item_id, r.merchant_order_item_id,
        r.purchase_date, r.payments_date, r.shipment_date, r.reporting_date,
        r.sku, r.product_name, r.quantity_shipped, r.currency,
        r.item_price, r.item_tax, r.shipping_price, r.shipping_tax,
        r.gift_wrap_price, r.gift_wrap_tax, r.ship_service_level,
        r.ship_city, r.ship_state, r.ship_postal_code, r.ship_country,
        r.bill_city, r.bill_state, r.bill_postal_code, r.bill_country,
        r.item_promotion_discount, r.ship_promotion_discount,
        r.carrier, r.tracking_number, r.estimated_arrival_date,
        r.fulfillment_center_id, r.fulfillment_channel, r.sales_channel
      );
    }
    const sql = `
      MERGE INTO CALBRIDGE_PROD.RAW.RETAIL_SHIPMENT t
      USING (
        SELECT
          v.col1 AS client_id, v.col2 AS platform, v.col3 AS marketplace,
          v.col4 AS amazon_order_id, v.col5 AS merchant_order_id, v.col6 AS shipment_id,
          v.col7 AS shipment_item_id, v.col8 AS amazon_order_item_id, v.col9 AS merchant_order_item_id,
          TRY_TO_TIMESTAMP(v.col10) AS purchase_date, TRY_TO_TIMESTAMP(v.col11) AS payments_date,
          TRY_TO_TIMESTAMP(v.col12) AS shipment_date, TRY_TO_TIMESTAMP(v.col13) AS reporting_date,
          v.col14 AS sku, v.col15 AS product_name, v.col16::NUMBER AS quantity_shipped,
          v.col17 AS currency, v.col18::FLOAT AS item_price, v.col19::FLOAT AS item_tax,
          v.col20::FLOAT AS shipping_price, v.col21::FLOAT AS shipping_tax,
          v.col22::FLOAT AS gift_wrap_price, v.col23::FLOAT AS gift_wrap_tax,
          v.col24 AS ship_service_level,
          v.col25 AS ship_city, v.col26 AS ship_state,
          v.col27 AS ship_postal_code, v.col28 AS ship_country,
          v.col29 AS bill_city, v.col30 AS bill_state,
          v.col31 AS bill_postal_code, v.col32 AS bill_country,
          v.col33::FLOAT AS item_promotion_discount, v.col34::FLOAT AS ship_promotion_discount,
          v.col35 AS carrier, v.col36 AS tracking_number,
          TRY_TO_TIMESTAMP(v.col37) AS estimated_arrival_date,
          v.col38 AS fulfillment_center_id, v.col39 AS fulfillment_channel, v.col40 AS sales_channel
        FROM VALUES ${placeholders} AS v(
          col1,col2,col3,col4,col5,col6,col7,col8,col9,col10,
          col11,col12,col13,col14,col15,col16,col17,col18,col19,col20,
          col21,col22,col23,col24,col25,col26,col27,col28,col29,col30,
          col31,col32,col33,col34,col35,col36,col37,col38,col39,col40
        )
      ) s ON t.client_id=s.client_id AND t.shipment_item_id=s.shipment_item_id
             AND t.amazon_order_id=s.amazon_order_id
      WHEN MATCHED THEN UPDATE SET
        quantity_shipped=s.quantity_shipped, item_price=s.item_price, item_tax=s.item_tax,
        shipping_price=s.shipping_price, carrier=s.carrier, tracking_number=s.tracking_number,
        fulfillment_channel=s.fulfillment_channel, ingested_at=CURRENT_TIMESTAMP()
      WHEN NOT MATCHED THEN INSERT (
        client_id,platform,marketplace,amazon_order_id,merchant_order_id,shipment_id,
        shipment_item_id,amazon_order_item_id,merchant_order_item_id,
        purchase_date,payments_date,shipment_date,reporting_date,
        sku,product_name,quantity_shipped,currency,item_price,item_tax,
        shipping_price,shipping_tax,gift_wrap_price,gift_wrap_tax,ship_service_level,
        ship_city,ship_state,ship_postal_code,ship_country,
        bill_city,bill_state,bill_postal_code,bill_country,
        item_promotion_discount,ship_promotion_discount,carrier,tracking_number,
        estimated_arrival_date,fulfillment_center_id,fulfillment_channel,sales_channel,ingested_at
      ) VALUES (
        s.client_id,s.platform,s.marketplace,s.amazon_order_id,s.merchant_order_id,s.shipment_id,
        s.shipment_item_id,s.amazon_order_item_id,s.merchant_order_item_id,
        s.purchase_date,s.payments_date,s.shipment_date,s.reporting_date,
        s.sku,s.product_name,s.quantity_shipped,s.currency,s.item_price,s.item_tax,
        s.shipping_price,s.shipping_tax,s.gift_wrap_price,s.gift_wrap_tax,s.ship_service_level,
        s.ship_city,s.ship_state,s.ship_postal_code,s.ship_country,
        s.bill_city,s.bill_state,s.bill_postal_code,s.bill_country,
        s.item_promotion_discount,s.ship_promotion_discount,s.carrier,s.tracking_number,
        s.estimated_arrival_date,s.fulfillment_center_id,s.fulfillment_channel,s.sales_channel,CURRENT_TIMESTAMP()
      )
    `;
    return { sql, binds };
  });
}

// ─── 7. Order Metrics (intraday, Sales API) ──────────────────────────────────
// RETAIL_ORDER_METRICS — created if needed.
// Uses SP-API Sales API: GET /sales/v1/orderMetrics
// Rolling 48h window (yesterday + today) to capture late hours.

async function ensureOrderMetricsTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS CALBRIDGE_PROD.RAW.RETAIL_ORDER_METRICS (
      CLIENT_ID                      VARCHAR(36)    NOT NULL,
      MARKETPLACE                    VARCHAR(10)    NOT NULL DEFAULT 'US',
      INTERVAL_START                 TIMESTAMP_NTZ  NOT NULL,
      INTERVAL_END                   TIMESTAMP_NTZ  NOT NULL,
      GRANULARITY                    VARCHAR(20)    NOT NULL DEFAULT 'Hour',
      UNIT_COUNT                     NUMBER(12,0),
      ORDER_ITEM_COUNT               NUMBER(12,0),
      ORDER_COUNT                    NUMBER(12,0),
      AVERAGE_UNIT_PRICE_AMOUNT      FLOAT,
      AVERAGE_UNIT_PRICE_CURRENCY    VARCHAR(5),
      TOTAL_SALES_AMOUNT             FLOAT,
      TOTAL_SALES_CURRENCY           VARCHAR(5),
      INGESTED_AT                    TIMESTAMP_NTZ  DEFAULT CURRENT_TIMESTAMP()
    )
  `);
}

async function ingestOrderMetrics(clientId, client) {
  // Rolling 48h: yesterday T00:00:00Z → now
  const now       = new Date();
  const yesterday = new Date(Date.now() - 86400000);
  const intervalStart = yesterday.toISOString().split('T')[0] + 'T00:00:00Z';
  const intervalEnd   = now.toISOString();

  await acquireSpApiToken('getOrderMetrics');

  let metricsData;
  try {
    const res = await client.get('/sales/v1/orderMetrics', {
      params: {
        marketplaceIds: 'ATVPDKIKX0DER',
        interval:       `${intervalStart}--${intervalEnd}`,
        granularity:    'Hour',
      },
    });
    metricsData = res.data?.payload || res.data || [];
  } catch (e) {
    if (e?.response?.status === 403 || e?.response?.status === 404) {
      console.log(`[sellerIngestion] getOrderMetrics not available for ${clientId} — skipping`);
      return 0;
    }
    throw e;
  }

  if (!Array.isArray(metricsData) || !metricsData.length) {
    console.log(`[sellerIngestion] getOrderMetrics: no data returned for ${clientId}`);
    return 0;
  }

  await ensureOrderMetricsTable();

  const toFloat = v => (v !== null && v !== undefined) ? (parseFloat(v) || null) : null;
  const toInt   = v => (v !== null && v !== undefined) ? (parseInt(v, 10) || null)  : null;

  const mapped = metricsData.map(item => ({
    client_id:                   clientId,
    marketplace:                 'US',
    interval_start:              item.interval?.split('--')[0] || null,
    interval_end:                item.interval?.split('--')[1] || null,
    granularity:                 'Hour',
    unit_count:                  toInt(item.unitCount),
    order_item_count:            toInt(item.orderItemCount),
    order_count:                 toInt(item.orderCount),
    average_unit_price_amount:   toFloat(item.averageUnitPrice?.amount),
    average_unit_price_currency: item.averageUnitPrice?.currencyCode || null,
    total_sales_amount:          toFloat(item.totalSales?.amount),
    total_sales_currency:        item.totalSales?.currencyCode || null,
  })).filter(r => r.interval_start);

  if (!mapped.length) return 0;

  return bulkMerge(mapped, 500, (batch) => {
    const placeholders = batch.map(() =>
      '(?,?,?,?,?,?,?,?,?,?,?,?)'
    ).join(',');
    const binds = [];
    for (const r of batch) {
      binds.push(
        r.client_id, r.marketplace,
        r.interval_start, r.interval_end, r.granularity,
        r.unit_count, r.order_item_count, r.order_count,
        r.average_unit_price_amount, r.average_unit_price_currency,
        r.total_sales_amount, r.total_sales_currency
      );
    }
    const sql = `
      MERGE INTO CALBRIDGE_PROD.RAW.RETAIL_ORDER_METRICS t
      USING (
        SELECT
          v.col1  AS client_id,
          v.col2  AS marketplace,
          TRY_TO_TIMESTAMP(v.col3)  AS interval_start,
          TRY_TO_TIMESTAMP(v.col4)  AS interval_end,
          v.col5  AS granularity,
          v.col6::NUMBER  AS unit_count,
          v.col7::NUMBER  AS order_item_count,
          v.col8::NUMBER  AS order_count,
          v.col9::FLOAT   AS avg_unit_price_amount,
          v.col10 AS avg_unit_price_currency,
          v.col11::FLOAT  AS total_sales_amount,
          v.col12 AS total_sales_currency
        FROM VALUES ${placeholders}
          AS v(col1,col2,col3,col4,col5,col6,col7,col8,col9,col10,col11,col12)
      ) s
        ON t.client_id       = s.client_id
       AND t.marketplace     = s.marketplace
       AND t.interval_start  = s.interval_start
       AND t.granularity     = s.granularity
      WHEN MATCHED THEN UPDATE SET
        interval_end                  = s.interval_end,
        unit_count                    = s.unit_count,
        order_item_count              = s.order_item_count,
        order_count                   = s.order_count,
        average_unit_price_amount     = s.avg_unit_price_amount,
        average_unit_price_currency   = s.avg_unit_price_currency,
        total_sales_amount            = s.total_sales_amount,
        total_sales_currency          = s.total_sales_currency,
        ingested_at                   = CURRENT_TIMESTAMP()
      WHEN NOT MATCHED THEN INSERT
        (client_id, marketplace, interval_start, interval_end, granularity,
         unit_count, order_item_count, order_count,
         average_unit_price_amount, average_unit_price_currency,
         total_sales_amount, total_sales_currency, ingested_at)
        VALUES
        (s.client_id, s.marketplace, s.interval_start, s.interval_end, s.granularity,
         s.unit_count, s.order_item_count, s.order_count,
         s.avg_unit_price_amount, s.avg_unit_price_currency,
         s.total_sales_amount, s.total_sales_currency, CURRENT_TIMESTAMP())
    `;
    return { sql, binds };
  });
}

// ─── Main: one client (cadence-split) ─────────────────────────────────────────

/**
 * ingestSellerRealtimeReports — every 6h.
 * Fast path: only pulls intraday order metrics.
 */
async function ingestSellerRealtimeReports(clientId) {
  const conn = await getConnectionStatus(clientId);
  if (!conn?.seller?.connected) {
    console.log(`[sellerIngestion] ${clientId}: no seller connection, skipping (realtime)`);
    return { skipped: true };
  }

  console.log(`[sellerIngestion] Realtime starting for ${clientId}`);
  const client  = await spClient(clientId);
  const results = { orderMetrics: 0 };

  try {
    results.orderMetrics = await ingestOrderMetrics(clientId, client);
    console.log(`[sellerIngestion] ORDER_METRICS: ${results.orderMetrics} rows written`);
  } catch (e) {
    console.warn(`[sellerIngestion] ORDER_METRICS failed:`, e.message.slice(0, 120));
  }

  return results;
}

/**
 * ingestSellerDailyReports — daily 07:00 UTC.
 * Sales & Traffic, FBA Inventory, Restock, Customer Returns, Fulfilled Shipments.
 */
async function ingestSellerDailyReports(clientId) {
  const conn = await getConnectionStatus(clientId);
  if (!conn?.seller?.connected) {
    console.log(`[sellerIngestion] ${clientId}: no seller connection, skipping (daily)`);
    return { skipped: true };
  }

  console.log(`[sellerIngestion] Daily starting for ${clientId}`);
  let client = await spClient(clientId);
  const results = { salesTraffic: 0, fbaInventory: 0, restock: 0, returns: 0, shipments: 0 };
  const clientRef = { current: client };

  // Sales & Traffic
  try {
    results.salesTraffic = await ingestSalesTraffic(clientId, client);
    console.log(`[sellerIngestion] SALES_TRAFFIC: ${results.salesTraffic} rows written`);
  } catch (e) {
    console.warn(`[sellerIngestion] SALES_TRAFFIC failed:`, e.message.slice(0, 120));
  }

  await new Promise(r => setTimeout(r, 2000));

  // FBA Inventory (with retry)
  try {
    clientRef.current = client;
    results.fbaInventory = await withRetry(
      () => ingestFbaInventory(clientId, clientRef.current),
      () => spClient(clientId),
      clientRef
    );
    client = clientRef.current;
    console.log(`[sellerIngestion] FBA_INVENTORY: ${results.fbaInventory} rows written`);
  } catch (e) {
    console.warn(`[sellerIngestion] FBA_INVENTORY failed:`, e.message.slice(0, 120));
  }

  await new Promise(r => setTimeout(r, 2000));

  // Restock Recommendations (with retry)
  try {
    clientRef.current = client;
    results.restock = await withRetry(
      () => ingestRestockRecommendations(clientId, clientRef.current),
      () => spClient(clientId),
      clientRef
    );
    client = clientRef.current;
    console.log(`[sellerIngestion] RESTOCK: ${results.restock} rows written`);
  } catch (e) {
    console.warn(`[sellerIngestion] RESTOCK failed:`, e.message.slice(0, 120));
  }

  await new Promise(r => setTimeout(r, 2000));

  // Customer Returns
  try {
    clientRef.current = client;
    results.returns = await withRetry(
      () => ingestCustomerReturns(clientId, clientRef.current, 7),
      () => spClient(clientId),
      clientRef
    );
    client = clientRef.current;
    console.log(`[sellerIngestion] CUSTOMER_RETURNS: ${results.returns} rows written`);
  } catch (e) {
    console.warn(`[sellerIngestion] CUSTOMER_RETURNS failed:`, e.message.slice(0, 120));
  }

  await new Promise(r => setTimeout(r, 2000));

  // Fulfilled Shipments
  try {
    clientRef.current = client;
    results.shipments = await withRetry(
      () => ingestFulfilledShipments(clientId, clientRef.current, 7),
      () => spClient(clientId),
      clientRef
    );
    client = clientRef.current;
    console.log(`[sellerIngestion] FULFILLED_SHIPMENTS: ${results.shipments} rows written`);
  } catch (e) {
    console.warn(`[sellerIngestion] FULFILLED_SHIPMENTS failed:`, e.message.slice(0, 120));
  }

  const total = Object.values(results).reduce((a, b) => a + (Number(b) || 0), 0);
  console.log(`[sellerIngestion] Daily done — ${total} total rows for ${clientId}`);
  return results;
}

/**
 * ingestSellerWeeklyReports — weekly Sunday 07:00 UTC.
 * FBA Fees + FBA Inventory listing snapshot.
 */
async function ingestSellerWeeklyReports(clientId) {
  const conn = await getConnectionStatus(clientId);
  if (!conn?.seller?.connected) {
    console.log(`[sellerIngestion] ${clientId}: no seller connection, skipping (weekly)`);
    return { skipped: true };
  }

  console.log(`[sellerIngestion] Weekly starting for ${clientId}`);
  let client = await spClient(clientId);
  const results = { fbaFees: 0, fbaInventory: 0 };
  const clientRef = { current: client };

  // FBA Fees
  try {
    clientRef.current = client;
    results.fbaFees = await withRetry(
      () => ingestFbaFees(clientId, clientRef.current),
      () => spClient(clientId),
      clientRef
    );
    client = clientRef.current;
    console.log(`[sellerIngestion] FBA_FEES: ${results.fbaFees} rows written`);
  } catch (e) {
    console.warn(`[sellerIngestion] FBA_FEES failed:`, e.message.slice(0, 120));
  }

  await new Promise(r => setTimeout(r, 2000));

  // FBA Inventory — also pulls GET_MERCHANT_LISTINGS_ALL_DATA as fallback
  try {
    clientRef.current = client;
    results.fbaInventory = await withRetry(
      () => ingestFbaInventory(clientId, clientRef.current),
      () => spClient(clientId),
      clientRef
    );
    client = clientRef.current;
    console.log(`[sellerIngestion] FBA_INVENTORY (listing snapshot): ${results.fbaInventory} rows written`);
  } catch (e) {
    console.warn(`[sellerIngestion] FBA_INVENTORY (weekly) failed:`, e.message.slice(0, 120));
  }

  const total = Object.values(results).reduce((a, b) => a + (Number(b) || 0), 0);
  console.log(`[sellerIngestion] Weekly done — ${total} total rows for ${clientId}`);
  return results;
}

// ─── Main: one client (legacy wrapper) ────────────────────────────────────────

async function ingestSellerReports(clientId) {
  // Legacy wrapper — calls all three cadence functions in sequence.
  // Retained for backfill and manual triggers.
  const realtimeRes = await ingestSellerRealtimeReports(clientId);
  if (realtimeRes.skipped) return { skipped: true };

  const results = { salesTraffic: 0, fbaInventory: 0, fbaFees: 0, restock: 0, returns: 0, shipments: 0, orderMetrics: 0 };
  results.orderMetrics = realtimeRes.orderMetrics || 0;

  const dailyRes = await ingestSellerDailyReports(clientId);
  if (!dailyRes.skipped) {
    results.salesTraffic = dailyRes.salesTraffic || 0;
    results.fbaInventory = dailyRes.fbaInventory || 0;
    results.restock      = dailyRes.restock      || 0;
    results.returns      = dailyRes.returns      || 0;
    results.shipments    = dailyRes.shipments    || 0;
  }

  const weeklyRes = await ingestSellerWeeklyReports(clientId);
  if (!weeklyRes.skipped) {
    results.fbaFees = weeklyRes.fbaFees || 0;
    // fbaInventory from weekly may overwrite daily value; use whichever is larger
    results.fbaInventory = Math.max(results.fbaInventory, weeklyRes.fbaInventory || 0);
  }

  const total = Object.values(results).reduce((a, b) => a + (Number(b) || 0), 0);
  console.log(`[sellerIngestion] Done — ${total} total rows for ${clientId}`);
  return results;
}

// ─── Backfill ─────────────────────────────────────────────────────────────────

/**
 * sellerBackfill — historical backfill for a newly connected seller.
 *
 * - Sales & Traffic: 2 years in 14-day date chunks
 * - FBA Inventory, FBA Fees, Restock: latest snapshot only
 * - Customer Returns: 1 year in 90-day chunks
 * - Fulfilled Shipments: 1 year in 30-day chunks
 */
async function sellerBackfill(clientId) {
  const conn = await getConnectionStatus(clientId);
  if (!conn?.seller?.connected) {
    console.log(`[sellerBackfill] ${clientId}: no seller connection, skipping`);
    return { skipped: true };
  }

  console.log(`[sellerBackfill] Starting historical backfill for ${clientId}`);
  let client = await spClient(clientId);
  const clientRef = { current: client };
  const results = { salesTraffic: 0, fbaInventory: 0, fbaFees: 0, restock: 0, returns: 0, shipments: 0 };

  // ── 1. Sales & Traffic: 2 years in 14-day chunks ──
  try {
    const now = Date.now();
    const twoYearsMs = 2 * 365 * 86400000;
    const chunkMs    = 14 * 86400000;
    let chunkEnd = now - 2 * 86400000; // start from 2 days ago, walk backwards

    while (chunkEnd > now - twoYearsMs) {
      const chunkStart = Math.max(chunkEnd - chunkMs, now - twoYearsMs);
      const startStr   = new Date(chunkStart).toISOString().split('T')[0];
      const endStr     = new Date(chunkEnd).toISOString().split('T')[0];
      if (startStr >= endStr) break;

      try {
        clientRef.current = client;
        const written = await withRetry(
          () => ingestSalesTraffic(clientId, clientRef.current, 14, startStr, endStr),
          () => spClient(clientId),
          clientRef
        );
        client = clientRef.current;
        results.salesTraffic += written;
        console.log(`[sellerBackfill] SALES_TRAFFIC chunk ${startStr}→${endStr}: ${written} rows`);
      } catch (e) {
        console.warn(`[sellerBackfill] SALES_TRAFFIC chunk ${startStr}→${endStr} failed:`, e.message.slice(0, 100));
      }

      chunkEnd = chunkStart - 86400000; // step back one day to avoid overlap
      await new Promise(r => setTimeout(r, 35000)); // 35s between chunks — SP-API GET_SALES_AND_TRAFFIC limit ~1 req/30s
    }
    console.log(`[sellerBackfill] SALES_TRAFFIC total: ${results.salesTraffic} rows`);
  } catch (e) {
    console.warn(`[sellerBackfill] SALES_TRAFFIC backfill error:`, e.message.slice(0, 120));
  }

  // ── 2. FBA Inventory snapshot ──
  try {
    clientRef.current = client;
    results.fbaInventory = await withRetry(
      () => ingestFbaInventory(clientId, clientRef.current),
      () => spClient(clientId),
      clientRef
    );
    client = clientRef.current;
    console.log(`[sellerBackfill] FBA_INVENTORY: ${results.fbaInventory} rows`);
  } catch (e) {
    console.warn(`[sellerBackfill] FBA_INVENTORY failed:`, e.message.slice(0, 120));
  }

  await new Promise(r => setTimeout(r, 3000));

  // ── 3. FBA Fees snapshot ──
  try {
    clientRef.current = client;
    results.fbaFees = await withRetry(
      () => ingestFbaFees(clientId, clientRef.current),
      () => spClient(clientId),
      clientRef
    );
    client = clientRef.current;
    console.log(`[sellerBackfill] FBA_FEES: ${results.fbaFees} rows`);
  } catch (e) {
    console.warn(`[sellerBackfill] FBA_FEES failed:`, e.message.slice(0, 120));
  }

  await new Promise(r => setTimeout(r, 3000));

  // ── 4. Restock snapshot ──
  try {
    clientRef.current = client;
    results.restock = await withRetry(
      () => ingestRestockRecommendations(clientId, clientRef.current),
      () => spClient(clientId),
      clientRef
    );
    client = clientRef.current;
    console.log(`[sellerBackfill] RESTOCK: ${results.restock} rows`);
  } catch (e) {
    console.warn(`[sellerBackfill] RESTOCK failed:`, e.message.slice(0, 120));
  }

  await new Promise(r => setTimeout(r, 3000));

  // ── 5. Customer Returns: 1 year in 90-day chunks ──
  try {
    const now = Date.now();
    const oneYearMs  = 365 * 86400000;
    const chunkMs    = 90 * 86400000;
    let chunkEnd = now - 2 * 86400000;

    while (chunkEnd > now - oneYearMs) {
      const chunkStart = Math.max(chunkEnd - chunkMs, now - oneYearMs);
      const startStr   = new Date(chunkStart).toISOString().split('T')[0];
      const endStr     = new Date(chunkEnd).toISOString().split('T')[0];
      if (startStr >= endStr) break;

      try {
        clientRef.current = client;
        const written = await withRetry(
          () => ingestCustomerReturns(clientId, clientRef.current, 90, startStr, endStr),
          () => spClient(clientId),
          clientRef
        );
        client = clientRef.current;
        results.returns += written;
        console.log(`[sellerBackfill] RETURNS chunk ${startStr}→${endStr}: ${written} rows`);
      } catch (e) {
        console.warn(`[sellerBackfill] RETURNS chunk ${startStr}→${endStr} failed:`, e.message.slice(0, 100));
      }

      chunkEnd = chunkStart - 86400000;
      await new Promise(r => setTimeout(r, 35000));
    }
    console.log(`[sellerBackfill] RETURNS total: ${results.returns} rows`);
  } catch (e) {
    console.warn(`[sellerBackfill] RETURNS backfill error:`, e.message.slice(0, 120));
  }

  // ── 6. Fulfilled Shipments: 1 year in 30-day chunks ──
  try {
    const now = Date.now();
    const oneYearMs = 365 * 86400000;
    const chunkMs   = 30 * 86400000;
    let chunkEnd = now - 2 * 86400000;

    while (chunkEnd > now - oneYearMs) {
      const chunkStart = Math.max(chunkEnd - chunkMs, now - oneYearMs);
      const startStr   = new Date(chunkStart).toISOString().split('T')[0];
      const endStr     = new Date(chunkEnd).toISOString().split('T')[0];
      if (startStr >= endStr) break;

      try {
        clientRef.current = client;
        const written = await withRetry(
          () => ingestFulfilledShipments(clientId, clientRef.current, 30, startStr, endStr),
          () => spClient(clientId),
          clientRef
        );
        client = clientRef.current;
        results.shipments += written;
        console.log(`[sellerBackfill] SHIPMENTS chunk ${startStr}→${endStr}: ${written} rows`);
      } catch (e) {
        console.warn(`[sellerBackfill] SHIPMENTS chunk ${startStr}→${endStr} failed:`, e.message.slice(0, 100));
      }

      chunkEnd = chunkStart - 86400000;
      await new Promise(r => setTimeout(r, 35000));
    }
    console.log(`[sellerBackfill] SHIPMENTS total: ${results.shipments} rows`);
  } catch (e) {
    console.warn(`[sellerBackfill] SHIPMENTS backfill error:`, e.message.slice(0, 120));
  }

  const total = Object.values(results).reduce((a, b) => a + (Number(b) || 0), 0);
  console.log(`[sellerBackfill] Complete — ${total} total rows written for ${clientId}`);
  return results;
}

// ─── All clients ──────────────────────────────────────────────────────────────

async function ingestSellerAllClients({ triggeredBy = 'cron' } = {}) {
  const clients = await query(`SELECT client_id FROM clients WHERE status = 'active' AND linked_client_id IS NULL`);
  let ran = 0;
  for (let i = 0; i < (clients || []).length; i++) {
    const clientId = clients[i].CLIENT_ID || clients[i].client_id;
    // Wait between clients to avoid exhausting the SP-API token bucket.
    // Each ingestSellerReports run uses ~6 tokens; bucket restores at 1/60s.
    // 90s gap leaves ~1.5 tokens restored before next client starts.
    if (i > 0) await new Promise(r => setTimeout(r, 90000));
    try {
      const result = await ingestSellerReports(clientId);
      if (!result.skipped) ran++;
    } catch (e) {
      console.warn(`[sellerIngestion] ${clientId} failed:`, e.message.slice(0, 100));
    }
  }
  console.log(`[sellerIngestion] Complete — ran for ${ran} client(s)`);
}

module.exports = {
  ingestSellerReports,
  ingestSellerRealtimeReports,
  ingestSellerDailyReports,
  ingestSellerWeeklyReports,
  ingestSellerAllClients,
  sellerBackfill,
  // Export individual functions for direct use
  ingestOrderMetrics,
  ingestFbaFees,
  ingestRestockRecommendations,
  ingestCustomerReturns,
  ingestFulfilledShipments,
};
