/**
 * src/jobs/sellerIngestion.js
 *
 * Seller Central SP-API data ingestion.
 * Writes to Project GO RAW schema:
 *   - RETAIL_SALES_TRAFFIC  (GET_SALES_AND_TRAFFIC_REPORT — sessions, orders, revenue, Buy Box)
 *   - RETAIL_INVENTORY      (GET_FBA_MYI_UNSUPPRESSED_INVENTORY_DATA — FBA on-hand, inbound)
 *   - RETAIL_LISTING        (GET_MERCHANT_LISTINGS_ALL_DATA — ASIN catalog enrichment)
 *
 * Runs every 6 hours via ingest_seller_reports cron job.
 */

'use strict';

require('dotenv').config();

const axios  = require('axios');
const zlib   = require('zlib');
const { query, batchMerge } = require('../services/snowflakeService');
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

async function requestAndPoll(client, reportType, body = {}, maxWaitMs = 600000) {
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

// ─── 1. Sales & Traffic ───────────────────────────────────────────────────────

async function ingestSalesTraffic(clientId, client, daysBack = 14) {
  const endDate   = new Date(Date.now() - 2 * 86400000).toISOString().split('T')[0];
  const startDate = new Date(Date.now() - (daysBack + 2) * 86400000).toISOString().split('T')[0];

  const data = await requestAndPoll(client, 'GET_SALES_AND_TRAFFIC_REPORT', {
    dataStartTime: startDate + 'T00:00:00Z',
    dataEndTime:   endDate   + 'T23:59:59Z',
    reportOptions: { dateGranularity: 'DAY', asinGranularity: 'PARENT' },
  });

  // salesAndTrafficByAsin = ASIN-level totals over the date range (no date field)
  // salesAndTrafficByDate  = daily totals over all ASINs (has date field)
  // We write daily account totals to RETAIL_SALES_TRAFFIC using a synthetic ASIN='__ACCOUNT__'
  // and ASIN-level totals using the report end date as the snapshot date.

  const endDateSnapshot = endDate; // use report end date as the ASIN snapshot date

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
      asin:                '__ACCOUNT__', // account-level daily total
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

  const rows = [...byAsinRows, ...byDateRows];

  if (!rows.length) return 0;
  return batchMerge({
    table:       'CALBRIDGE_PROD.RAW.RETAIL_SALES_TRAFFIC',
    keyColumns:  ['client_id', 'asin', 'date', 'marketplace'],
    dataColumns: ['platform', 'ordered_units', 'ordered_revenue', 'currency_code',
                  'shipped_units', 'shipped_revenue', 'sessions', 'page_views',
                  'buy_box_pct', 'unit_session_pct', 'b2b_ordered_units',
                  'b2b_ordered_revenue', 'selling_program', 'distributor_view'],
    dateColumns: ['date'],
    rows,
  });
}

// ─── 2. FBA Inventory ─────────────────────────────────────────────────────────

async function ingestFbaInventory(clientId, client) {
  const data = await requestAndPoll(client, 'GET_FBA_MYI_UNSUPPRESSED_INVENTORY_DATA');
  const today = new Date().toISOString().split('T')[0];

  if (typeof data !== 'string') {
    console.warn('[sellerIngestion] FBA inventory: unexpected non-TSV response');
    return 0;
  }

  const lines = data.trim().split('\n');
  if (lines.length < 2) return 0;

  const headers = lines[0].split('\t').map(h => h.trim().toLowerCase().replace(/[^a-z0-9]/g, '_'));
  const rows = lines.slice(1).map(line => {
    const vals = line.split('\t');
    const o = {};
    headers.forEach((h, i) => { o[h] = vals[i]?.trim() || null; });
    return o;
  }).filter(r => r.asin);

  if (!rows.length) return 0;

  const mapped = rows.map(r => ({
    client_id:                 clientId,
    platform:                  'amazon',
    marketplace:               'US',
    asin:                      r.asin,
    date:                      today,
    sellable_on_hand_units:    Number(r.afn_fulfillable_quantity ?? r.quantity_available ?? 0),
    sellable_on_hand_cost:     null,
    unsellable_on_hand_units:  Number(r.afn_unsellable_quantity ?? 0),
    unsellable_on_hand_cost:   null,
    open_purchase_order_units: Number(r.afn_inbound_working_quantity ?? r.quantity_in_transit ?? 0),
    net_received_units:        Number(r.afn_inbound_receiving_quantity ?? 0),
    net_received_cost:         null,
    aged_90_plus_units:        null,
    aged_90_plus_cost:         null,
    unhealthy_units:           null,
    unhealthy_cost:            null,
    sell_through_rate:         null,
    selling_program:           'RETAIL',
    distributor_view:          'SOURCING',
  }));

  return batchMerge({
    table:       'CALBRIDGE_PROD.RAW.RETAIL_INVENTORY',
    keyColumns:  ['client_id', 'asin', 'date', 'marketplace'],
    dataColumns: ['platform', 'sellable_on_hand_units', 'sellable_on_hand_cost',
                  'unsellable_on_hand_units', 'unsellable_on_hand_cost',
                  'open_purchase_order_units', 'net_received_units', 'net_received_cost',
                  'aged_90_plus_units', 'aged_90_plus_cost', 'unhealthy_units', 'unhealthy_cost',
                  'sell_through_rate', 'selling_program', 'distributor_view'],
    dateColumns: ['date'],
    rows: mapped,
  });
}

// ─── Main: one client ─────────────────────────────────────────────────────────

async function ingestSellerReports(clientId) {
  const conn = await getConnectionStatus(clientId);
  if (!conn?.seller?.connected) {
    console.log(`[sellerIngestion] ${clientId}: no seller connection, skipping`);
    return { skipped: true };
  }

  console.log(`[sellerIngestion] Starting for ${clientId}`);
  const client = await spClient(clientId);
  const results = { salesTraffic: 0, fbaInventory: 0 };

  try {
    results.salesTraffic = await ingestSalesTraffic(clientId, client);
    console.log(`[sellerIngestion] SALES_TRAFFIC: ${results.salesTraffic} rows written`);
  } catch (e) {
    console.warn(`[sellerIngestion] SALES_TRAFFIC failed:`, e.message.slice(0, 120));
  }

  await new Promise(r => setTimeout(r, 2000));

  try {
    results.fbaInventory = await ingestFbaInventory(clientId, client);
    console.log(`[sellerIngestion] FBA_INVENTORY: ${results.fbaInventory} rows written`);
  } catch (e) {
    console.warn(`[sellerIngestion] FBA_INVENTORY failed:`, e.message.slice(0, 120));
  }

  const total = results.salesTraffic + results.fbaInventory;
  console.log(`[sellerIngestion] Done — ${total} total rows for ${clientId}`);
  return results;
}

// ─── All clients ──────────────────────────────────────────────────────────────

async function ingestSellerAllClients({ triggeredBy = 'cron' } = {}) {
  const clients = await query(`SELECT client_id FROM clients WHERE status = 'active' AND linked_client_id IS NULL`);
  let ran = 0;
  for (const row of (clients || [])) {
    const clientId = row.CLIENT_ID || row.client_id;
    try {
      const result = await ingestSellerReports(clientId);
      if (!result.skipped) ran++;
    } catch (e) {
      console.warn(`[sellerIngestion] ${clientId} failed:`, e.message.slice(0, 100));
    }
  }
  console.log(`[sellerIngestion] Complete — ran for ${ran} client(s)`);
}

module.exports = { ingestSellerReports, ingestSellerAllClients };
