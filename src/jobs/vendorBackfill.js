/**
 * vendorBackfill.js
 *
 * Full historical backfill for vendor SP-API reports.
 * Called automatically when a vendor or seller connection is first established.
 * Can also be triggered manually via POST /admin/trigger-vendor-backfill.
 *
 * Strategy:
 *   1. Probe to find the actual earliest available date per report type
 *   2. Walk backwards in 14-day chunks from today to the earliest date
 *   3. All reports use DAY grain (matches daily ingest cadence)
 *   4. Sleep between chunks to avoid SP-API throttling
 *
 * Report types:
 *   - GET_VENDOR_SALES_REPORT        (DAY) — typically 2 years
 *   - GET_VENDOR_INVENTORY_REPORT    (DAY) — typically 2 years
 *   - GET_VENDOR_TRAFFIC_REPORT      (DAY) — typically 13 months
 *   - GET_VENDOR_NET_PURE_PRODUCT_MARGIN_REPORT (DAY) — typically 13 months
 */

'use strict';

require('dotenv').config();
// Write functions required lazily inside runVendorBackfill to avoid circular dependency
// (vendorIngestion is a large module; top-level require fires before exports are set)
const { query } = require('../services/snowflakeService');
const { getValidToken } = require('../services/amazonAuthService');
const axios  = require('axios');
const zlib   = require('zlib');

const SP_API_BASE = process.env.NODE_ENV !== 'production'
  ? 'https://sandbox.sellingpartnerapi-na.amazon.com'
  : 'https://sellingpartnerapi-na.amazon.com';

function toDateStr(d) {
  return d instanceof Date ? d.toISOString().split('T')[0] : String(d).substring(0, 10);
}
function daysAgo(n) {
  const d = new Date(); d.setDate(d.getDate() - n); return toDateStr(d);
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function spClient(clientId) {
  const token = await getValidToken(clientId, 'vendor');
  if (!token) throw new Error('No vendor token');
  return axios.create({
    baseURL: SP_API_BASE,
    headers: { 'x-amz-access-token': token, 'Content-Type': 'application/json' },
    timeout: 30000,
  });
}

/**
 * Probe the earliest available date for a report type by binary-searching
 * backwards. Returns the earliest working startDate string, or null if
 * the report type is completely unavailable.
 *
 * Strategy: try anchor dates 30d, 90d, 180d, 365d, 2y back. First one
 * that returns DONE (not FATAL) wins. We use a short single-day window
 * for the probe to minimise data transfer.
 */
async function probeEarliestDate(client, reportType, reportOptions = {}, marketplaceId = 'ATVPDKIKX0DER') {
  const anchors = [
    daysAgo(30),
    daysAgo(90),
    daysAgo(180),
    daysAgo(365),
    daysAgo(548),  // ~18 months
    daysAgo(730),  // ~2 years
  ];

  let earliest = null;

  for (const anchor of anchors) {
    try {
      const body = {
        reportType,
        marketplaceIds: [marketplaceId],
        reportOptions: { ...reportOptions },
        dataStartTime: anchor,
        dataEndTime:   anchor,  // single-day probe
      };

      const createRes = await client.post('/reports/2021-06-30/reports', body);
      const reportId = createRes?.data?.reportId;
      if (!reportId) continue;

      // Poll up to 90 seconds per anchor — keep probes snappy
      const start = Date.now();
      let status = 'IN_QUEUE';
      while (Date.now() - start < 90000) {
        await sleep(3000);
        const poll = await client.get(`/reports/2021-06-30/reports/${reportId}`);
        status = poll.data.processingStatus;
        if (status === 'DONE') { earliest = anchor; break; }
        if (['CANCELLED', 'FATAL'].includes(status)) break;
      }

      if (earliest) {
        console.log(`[vendorProbe] ${reportType}: earliest available = ${anchor} (status=${status})`);
        break;
      } else {
        console.log(`[vendorProbe] ${reportType}: ${anchor} → ${status} — trying further back`);
        await sleep(3000);
      }
    } catch (err) {
      console.warn(`[vendorProbe] ${reportType} ${anchor}: ${err.message?.substring(0, 80)}`);
      await sleep(3000);
    }
  }

  if (!earliest) {
    console.warn(`[vendorProbe] ${reportType}: no data found in any anchor — skipping`);
  }
  return earliest;
}

/**
 * Run the full historical backfill for a client.
 * Probes limits, then walks 14-day DAY-grain chunks from earliest→today.
 * Idempotent — existing rows are upserted (MERGE), safe to re-run.
 */
async function runVendorBackfill(clientId, marketplaceId = 'ATVPDKIKX0DER') {
  console.log(`[vendorBackfill] Starting full historical backfill for client ${clientId}`);

  let client;
  try {
    client = await spClient(clientId);
  } catch (err) {
    console.error(`[vendorBackfill] Cannot get vendor token for ${clientId}: ${err.message}`);
    return { error: err.message };
  }

  // ── Step 1: Probe each report type ──────────────────────────────────────────
  console.log('[vendorBackfill] Probing earliest available dates...');

  // Sequential probes to avoid concurrent report limits and get clear per-type logging
  const salesStart     = await probeEarliestDate(client, 'GET_VENDOR_SALES_REPORT',
    { reportPeriod: 'DAY', distributorView: 'SOURCING', sellingProgram: 'RETAIL' }, marketplaceId);
  await sleep(3000);
  const inventoryStart = await probeEarliestDate(client, 'GET_VENDOR_INVENTORY_REPORT',
    { reportPeriod: 'DAY', distributorView: 'SOURCING', sellingProgram: 'RETAIL' }, marketplaceId);
  await sleep(3000);
  const trafficStart   = await probeEarliestDate(client, 'GET_VENDOR_TRAFFIC_REPORT',
    { reportPeriod: 'DAY' }, marketplaceId);
  await sleep(3000);
  const ppmStart       = await probeEarliestDate(client, 'GET_VENDOR_NET_PURE_PRODUCT_MARGIN_REPORT',
    { reportPeriod: 'DAY' }, marketplaceId);

  console.log(`[vendorBackfill] Earliest dates: sales=${salesStart} inventory=${inventoryStart} traffic=${trafficStart} ppm=${ppmStart}`);

  // ── Step 2: Record limits in Snowflake for future reference ─────────────────
  try {
    await query(`
      MERGE INTO CALBRIDGE_PROD.APP.vendor_backfill_log t
      USING (SELECT ? AS client_id) s ON t.client_id = s.client_id
      WHEN MATCHED THEN UPDATE SET
        sales_earliest=?, inventory_earliest=?, traffic_earliest=?, ppm_earliest=?,
        last_backfill_at=CURRENT_TIMESTAMP()
      WHEN NOT MATCHED THEN INSERT
        (client_id, sales_earliest, inventory_earliest, traffic_earliest, ppm_earliest, last_backfill_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP())
    `, [clientId, salesStart, inventoryStart, trafficStart, ppmStart,
        clientId, salesStart, inventoryStart, trafficStart, ppmStart]);
  } catch (e) {
    // Table may not exist yet — non-fatal, just log
    console.warn('[vendorBackfill] Could not write to vendor_backfill_log (non-fatal):', e.message?.substring(0, 80));
  }

  // ── Step 3: Build chunk list for each report ─────────────────────────────────
  const today     = toDateStr(new Date());
  const endDate   = daysAgo(3); // D-3 lag

  const CHUNK_DAYS = 14; // vendor reports max 14-day windows (ads reports allow 31)

  function buildChunks(startDate) {
    if (!startDate) return [];
    const chunks = [];
    let cursor = new Date(startDate + 'T00:00:00Z');
    const end   = new Date(endDate   + 'T00:00:00Z');
    while (cursor <= end) {
      const chunkEnd = new Date(cursor);
      chunkEnd.setUTCDate(chunkEnd.getUTCDate() + CHUNK_DAYS - 1);
      if (chunkEnd > end) chunkEnd.setTime(end.getTime());
      chunks.push({ start: toDateStr(cursor), end: toDateStr(chunkEnd) });
      cursor = new Date(chunkEnd);
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return chunks;
  }

  const salesChunks     = buildChunks(salesStart);
  const inventoryChunks = buildChunks(inventoryStart);
  const trafficChunks   = buildChunks(trafficStart);
  const ppmChunks       = buildChunks(ppmStart);

  const totalChunks = salesChunks.length + inventoryChunks.length + trafficChunks.length + ppmChunks.length;
  console.log(`[vendorBackfill] Chunks: sales=${salesChunks.length} inventory=${inventoryChunks.length} traffic=${trafficChunks.length} ppm=${ppmChunks.length} total=${totalChunks}`);
  console.log(`[vendorBackfill] Estimated time: ~${Math.ceil(totalChunks * 35 / 60)} minutes`);

  // ── Step 4: Process all chunks ───────────────────────────────────────────────
  // Lazy require avoids circular dependency (vendorIngestion exports set after init)
  const { writeVendorSales, writeVendorInventory, writeVendorTraffic, writeVendorNetPpm } =
    require('./vendorIngestion');


  let written = { sales: 0, inventory: 0, traffic: 0, ppm: 0 };
  let chunkNum = 0;

  async function processChunk(reportType, reportOptions, writeFn, chunk, label) {
    chunkNum++;
    client = await spClient(clientId); // fresh token each chunk
    try {
      console.log(`[vendorBackfill] [${chunkNum}/${totalChunks}] ${label} ${chunk.start}→${chunk.end}`);
      const createRes = await client.post('/reports/2021-06-30/reports', {
        reportType,
        marketplaceIds: [marketplaceId],
        reportOptions: { ...reportOptions },
        dataStartTime: chunk.start,
        dataEndTime:   chunk.end,
      });
      const reportId = createRes?.data?.reportId;
      if (!reportId) throw new Error('No reportId');

      // Poll up to 10 minutes (fast 3s intervals — reports typically finish in ~5s)
      const start = Date.now();
      while (Date.now() - start < 600000) {
        await sleep(3000);
        const poll = await client.get(`/reports/2021-06-30/reports/${reportId}`);
        const { processingStatus, reportDocumentId } = poll.data;
        if (processingStatus === 'DONE' && reportDocumentId) {
          const docRes = await client.get(`/reports/2021-06-30/documents/${reportDocumentId}`);
          const { url, compressionAlgorithm } = docRes.data;
          const dl = await axios.get(url, { responseType: 'arraybuffer', timeout: 60000 });
          let text = compressionAlgorithm === 'GZIP'
            ? zlib.gunzipSync(Buffer.from(dl.data)).toString('utf8')
            : Buffer.from(dl.data).toString('utf8');
          let data;
          try { data = JSON.parse(text); } catch { data = text; }
          const rows = Array.isArray(data) ? data : (data?.reportData || data?.salesByAsin || data?.inventoryByAsin || data?.trafficByAsin || data?.netPpmByAsin || []);
          const n = await writeFn(clientId, rows);
          console.log(`[vendorBackfill] ✅ ${label} ${chunk.start}→${chunk.end}: ${n} rows`);
          return n;
        }
        if (['CANCELLED', 'FATAL'].includes(processingStatus)) {
          console.warn(`[vendorBackfill] ⚠️  ${label} ${chunk.start}→${chunk.end}: ${processingStatus} — skipping`);
          return 0;
        }
      }
      throw new Error('Timed out');
    } catch (err) {
      console.warn(`[vendorBackfill] ❌ ${label} ${chunk.start}→${chunk.end}: ${err.message?.substring(0, 100)}`);
      return 0;
    }
  }

  // Interleave all 4 report types per chunk window to minimise total elapsed time.
  // All 4 cover the same date ranges, so we can zip them together.
  const maxChunks = Math.max(salesChunks.length, inventoryChunks.length, trafficChunks.length, ppmChunks.length);

  for (let i = 0; i < maxChunks; i++) {
    if (salesChunks[i]) {
      written.sales += await processChunk(
        'GET_VENDOR_SALES_REPORT',
        { reportPeriod: 'DAY', distributorView: 'SOURCING', sellingProgram: 'RETAIL' },
        writeVendorSales, salesChunks[i], 'SALES');
      await sleep(2000);
    }
    if (inventoryChunks[i]) {
      written.inventory += await processChunk(
        'GET_VENDOR_INVENTORY_REPORT',
        { reportPeriod: 'DAY', distributorView: 'SOURCING', sellingProgram: 'RETAIL' },
        writeVendorInventory, inventoryChunks[i], 'INVENTORY');
      await sleep(2000);
    }
    if (trafficChunks[i]) {
      written.traffic += await processChunk(
        'GET_VENDOR_TRAFFIC_REPORT',
        { reportPeriod: 'DAY' },
        writeVendorTraffic, trafficChunks[i], 'TRAFFIC');
      await sleep(2000);
    }
    if (ppmChunks[i]) {
      written.ppm += await processChunk(
        'GET_VENDOR_NET_PURE_PRODUCT_MARGIN_REPORT',
        { reportPeriod: 'DAY' },
        writeVendorNetPpm, ppmChunks[i], 'NET_PPM');
      await sleep(2000);
    }
    // Throttle between date windows
    if (i < maxChunks - 1) await sleep(5000);
  }

  console.log(`[vendorBackfill] ✅ Complete — sales=${written.sales} inventory=${written.inventory} traffic=${written.traffic} ppm=${written.ppm}`);
  return { ...written, salesStart, inventoryStart, trafficStart, ppmStart };
}

module.exports = { runVendorBackfill };
