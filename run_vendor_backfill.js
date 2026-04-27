'use strict';
/**
 * Standalone vendor historical backfill runner.
 * Runs once and exits. Intended to be launched via PM2 with autorestart: false.
 *
 * Uses vendorIngestion functions directly to avoid closure/circular-dep issues.
 */
require('dotenv').config({ path: '/home/azureuser/.openclaw/workspace/.env' });

const axios  = require('axios');
const zlib   = require('zlib');
const { query } = require('./src/services/snowflakeService');
const { getValidToken } = require('./src/services/amazonAuthService');
const {
  writeVendorSales,
  writeVendorInventory,
  writeVendorTraffic,
  writeVendorNetPpm,
} = require('./src/jobs/vendorIngestion');

const CLIENT       = '7d88ea17-002b-4a02-97fc-bcab1292d57e'; // CyberPower
const MARKETPLACE  = 'ATVPDKIKX0DER';
const SP_API_BASE  = 'https://sellingpartnerapi-na.amazon.com';
const CHUNK_DAYS   = 14;

function toDateStr(d) { return d.toISOString().split('T')[0]; }
function daysAgo(n)   { const d = new Date(); d.setDate(d.getDate() - n); return toDateStr(d); }
function sleep(ms)    { return new Promise(r => setTimeout(r, ms)); }

async function makeClient() {
  const token = await getValidToken(CLIENT, 'vendor');
  if (!token) throw new Error('No vendor token');
  return axios.create({
    baseURL: SP_API_BASE,
    headers: { 'x-amz-access-token': token, 'Content-Type': 'application/json' },
    timeout: 30000,
  });
}

async function fetchReport(reportType, reportOptions, startDate, endDate, label) {
  const client = await makeClient();
  const { dataStartTime, dataEndTime, ...restOptions } = { ...reportOptions, dataStartTime: startDate, dataEndTime: endDate };
  const body = { reportType, marketplaceIds: [MARKETPLACE], reportOptions: restOptions, dataStartTime, dataEndTime };

  let reportId;
  try {
    const res = await client.post('/reports/2021-06-30/reports', body);
    reportId = res?.data?.reportId;
    if (!reportId) throw new Error('No reportId');
  } catch (err) {
    console.warn(`[backfill] ❌ ${label} CREATE failed: ${err.message?.substring(0, 100)}`);
    return null;
  }

  // Poll up to 10 minutes
  const start = Date.now();
  while (Date.now() - start < 600000) {
    await sleep(8000);
    const poll = (await client.get(`/reports/2021-06-30/reports/${reportId}`)).data;
    if (poll.processingStatus === 'DONE' && poll.reportDocumentId) {
      const doc = (await client.get(`/reports/2021-06-30/documents/${poll.reportDocumentId}`)).data;
      const dl  = await axios.get(doc.url, { responseType: 'arraybuffer', timeout: 60000 });
      const txt = doc.compressionAlgorithm === 'GZIP'
        ? zlib.gunzipSync(Buffer.from(dl.data)).toString('utf8')
        : Buffer.from(dl.data).toString('utf8');
      try { return JSON.parse(txt); } catch { return txt; }
    }
    if (['CANCELLED', 'FATAL'].includes(poll.processingStatus)) {
      console.warn(`[backfill] ⚠️  ${label}: ${poll.processingStatus}`);
      return null;
    }
  }
  console.warn(`[backfill] ⏱  ${label}: timed out`);
  return null;
}

function buildChunks(startDate, endDate) {
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

async function main() {
  console.log(`[backfill] Starting vendor backfill for ${CLIENT}`);

  // Known limits from previous probe runs:
  //   Sales:     earliest = 2026-03-27 (~30 days)
  //   Inventory: earliest = 2026-03-27 (~30 days)
  //   Traffic:   earliest = 2026-03-27 (~30 days)
  //   Net PPM:   consistently IN_QUEUE / unavailable for this account
  // Using probed limits directly to skip slow probe phase.
  const EARLIEST = '2026-03-27';
  const END_DATE  = daysAgo(3);

  const chunks = buildChunks(EARLIEST, END_DATE);
  console.log(`[backfill] ${chunks.length} chunks (${EARLIEST} → ${END_DATE})`);

  const reports = [
    {
      type:    'GET_VENDOR_SALES_REPORT',
      opts:    { reportPeriod: 'DAY', distributorView: 'SOURCING', sellingProgram: 'RETAIL' },
      writeFn: writeVendorSales,
      keyFn:   d => d?.salesByAsin || d?.reportData || (Array.isArray(d) ? d : []),
      label:   'SALES',
    },
    {
      type:    'GET_VENDOR_INVENTORY_REPORT',
      opts:    { reportPeriod: 'DAY', distributorView: 'SOURCING', sellingProgram: 'RETAIL' },
      writeFn: writeVendorInventory,
      keyFn:   d => d?.inventoryByAsin || d?.reportData || (Array.isArray(d) ? d : []),
      label:   'INVENTORY',
    },
    {
      type:    'GET_VENDOR_TRAFFIC_REPORT',
      opts:    { reportPeriod: 'DAY' },
      writeFn: writeVendorTraffic,
      keyFn:   d => d?.trafficByAsin || d?.reportData || (Array.isArray(d) ? d : []),
      label:   'TRAFFIC',
    },
  ];

  const totals = { SALES: 0, INVENTORY: 0, TRAFFIC: 0 };

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    console.log(`[backfill] Chunk ${i + 1}/${chunks.length}: ${chunk.start} → ${chunk.end}`);

    for (const r of reports) {
      const label = `${r.label} ${chunk.start}→${chunk.end}`;
      const data  = await fetchReport(r.type, r.opts, chunk.start, chunk.end, label);
      if (data) {
        const rows    = r.keyFn(data);
        const written = await r.writeFn(CLIENT, rows).catch(e => {
          console.warn(`[backfill] ❌ ${label} write failed: ${e.message}`);
          return 0;
        });
        totals[r.label] += written;
        console.log(`[backfill] ✅ ${label}: ${written} rows`);
      }
      await sleep(2000);
    }

    if (i < chunks.length - 1) await sleep(5000);
  }

  console.log(`[backfill] ✅ Done — sales=${totals.SALES} inventory=${totals.INVENTORY} traffic=${totals.TRAFFIC}`);

  // Note Net PPM in log for reference
  console.log('[backfill] Net PPM skipped — GET_VENDOR_NET_PURE_PRODUCT_MARGIN_REPORT stays IN_QUEUE for this account (not available)');

  process.exit(0);
}

main().catch(e => { console.error('[backfill] Fatal:', e.message); process.exit(1); });
