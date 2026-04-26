/**
 * vendorFullBackfill.js
 *
 * Traffic + NetPPM backfill — DAY grain, 14-day chunks, 13-month window.
 * Robust poll loop with per-request client refresh to avoid stale connections.
 */

'use strict';

require('dotenv').config();
const { getValidToken } = require('../services/amazonAuthService');
const { writeVendorTraffic, writeVendorNetPpm } = require('./vendorIngestion');
const axios = require('axios');
const zlib  = require('zlib');

const CLIENT_ID   = '7d88ea17-002b-4a02-97fc-bcab1292d57e';
const MARKETPLACE = 'ATVPDKIKX0DER';
const BASE_URL    = 'https://sellingpartnerapi-na.amazon.com';

function toDateStr(d) {
  return d instanceof Date ? d.toISOString().split('T')[0] : String(d).substring(0, 10);
}
function daysAgo(n) {
  const d = new Date(); d.setUTCDate(d.getUTCDate() - n); return toDateStr(d);
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function thirteenMonthsAgo() {
  const d = new Date(); d.setMonth(d.getMonth() - 13); return toDateStr(d);
}

async function freshClient() {
  const token = await getValidToken(CLIENT_ID, 'vendor');
  if (!token) throw new Error('No vendor token');
  return axios.create({
    baseURL: BASE_URL,
    headers: { 'x-amz-access-token': token, 'Content-Type': 'application/json' },
    timeout: 20000,
  });
}

async function fetchReport(reportType, startDate, endDate) {
  // Step 1: create
  let client = await freshClient();
  const body = {
    reportType,
    marketplaceIds: [MARKETPLACE],
    reportOptions: { reportPeriod: 'DAY' },
    dataStartTime: startDate,
    dataEndTime:   endDate,
  };
  const createRes = await client.post('/reports/2021-06-30/reports', body);
  const reportId  = createRes.data.reportId;
  console.log(`    [${reportType}] created ${reportId}`);

  // Step 2: poll — refresh client each attempt to avoid stale connections
  let docId = null;
  // Poll aggressively: 5s intervals for first 2 min, then 15s up to 15 min total
  const pollIntervals = [...Array(24).fill(5000), ...Array(54).fill(15000)];
  for (const interval of pollIntervals) {
    await sleep(interval);
    try {
      client = await freshClient();
      const poll = await client.get(`/reports/2021-06-30/reports/${reportId}`);
      const status = poll.data.processingStatus;
      if (status === 'DONE') { docId = poll.data.reportDocumentId; break; }
      if (status === 'FATAL' || status === 'CANCELLED') throw new Error(`${reportType} ${status}`);
      if (interval === 15000) console.log(`    still waiting: ${status}`);
    } catch (pollErr) {
      if (pollErr.message.includes('FATAL') || pollErr.message.includes('CANCELLED')) throw pollErr;
      console.warn(`    poll error (retry): ${pollErr.message?.substring(0, 80)}`);
    }
  }
  if (!docId) throw new Error(`Timeout waiting for ${reportId}`);

  // Step 3: download
  client = await freshClient();
  const docRes = await client.get(`/reports/2021-06-30/documents/${docId}`);
  const dlRes  = await axios.get(docRes.data.url, { responseType: 'arraybuffer', timeout: 120000 });
  let raw = Buffer.from(dlRes.data);
  if (docRes.data.compressionAlgorithm === 'GZIP') {
    raw = await new Promise((res, rej) => zlib.gunzip(raw, (e, d) => e ? rej(e) : res(d)));
  }
  return JSON.parse(raw.toString('utf8'));
}

function toRows(data, ...keys) {
  if (Array.isArray(data)) return data;
  for (const k of keys) { if (Array.isArray(data?.[k])) return data[k]; }
  return [];
}

function buildChunks(start, end) {
  const chunks = [];
  let cursor = new Date(start + 'T00:00:00Z');
  const endD = new Date(end   + 'T00:00:00Z');
  while (cursor <= endD) {
    const ce = new Date(cursor);
    ce.setUTCDate(ce.getUTCDate() + 13);
    if (ce > endD) ce.setTime(endD.getTime());
    chunks.push({ start: toDateStr(cursor), end: toDateStr(ce) });
    cursor = new Date(ce);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return chunks;
}

(async () => {
  const START = thirteenMonthsAgo();
  const END   = daysAgo(3);

  console.log('[trafficPpmBackfill] ==========================================');
  console.log(`[trafficPpmBackfill] Range: ${START} → ${END}`);

  const chunks = buildChunks(START, END);
  console.log(`[trafficPpmBackfill] ${chunks.length} chunks\n`);

  let trafficTotal = 0;
  let ppmTotal     = 0;

  for (let i = 0; i < chunks.length; i++) {
    const { start, end } = chunks[i];
    console.log(`[trafficPpmBackfill] Chunk ${i+1}/${chunks.length}: ${start} → ${end}`);

    // Traffic
    try {
      const data    = await fetchReport('GET_VENDOR_TRAFFIC_REPORT', start, end);
      const rows    = toRows(data, 'trafficByAsin', 'reportData');
      const written = await writeVendorTraffic(CLIENT_ID, rows);
      trafficTotal += (written || 0);
      console.log(`  TRAFFIC: ${written} rows (total: ${trafficTotal})`);
    } catch (e) {
      console.warn(`  TRAFFIC failed: ${e.message?.substring(0, 150)}`);
    }

    await new Promise(r => setTimeout(r, 4000));

    // NetPPM
    try {
      const data    = await fetchReport('GET_VENDOR_NET_PURE_PRODUCT_MARGIN_REPORT', start, end);
      const rows    = toRows(data, 'netPureProductMarginByAsin', 'netPpmByAsin', 'reportData');
      const written = await writeVendorNetPpm(CLIENT_ID, rows);
      ppmTotal += (written || 0);
      console.log(`  NET_PPM: ${written} rows (total: ${ppmTotal})`);
    } catch (e) {
      console.warn(`  NET_PPM failed: ${e.message?.substring(0, 150)}`);
    }

    if (i < chunks.length - 1) {
      console.log('  Waiting 30s...\n');
      await sleep(30000);
    }
  }

  console.log(`\n[trafficPpmBackfill] ✅ Complete! traffic=${trafficTotal} netPpm=${ppmTotal}`);
  process.exit(0);
})().catch(e => {
  console.error('[trafficPpmBackfill] FATAL:', e.message);
  process.exit(1);
});
