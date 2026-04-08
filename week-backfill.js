#!/usr/bin/env node
'use strict';
require('dotenv').config();

const axios = require('axios');
const zlib = require('zlib');
const { query } = require('./src/services/snowflakeService');
const { getValidToken } = require('./src/services/amazonAuthService');

const CLIENT_ID = '7d88ea17-002b-4a02-97fc-bcab1292d57e';
const SP_API_BASE = 'https://sellingpartnerapi-na.amazon.com';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function requestReport(type, options, maxWaitMs = 300000) {
  const token = await getValidToken(CLIENT_ID, 'vendor');
  const client = axios.create({
    baseURL: SP_API_BASE,
    headers: { 'x-amz-access-token': token, 'Content-Type': 'application/json' },
    timeout: 30000
  });

  const { dataStartTime, dataEndTime, ...rest } = options;
  const body = { reportType: type, marketplaceIds: ['ATVPDKIKX0DER'], reportOptions: rest };
  if (dataStartTime) body.dataStartTime = dataStartTime;
  if (dataEndTime) body.dataEndTime = dataEndTime;

  const createRes = await client.post('/reports/2021-06-30/reports', body);
  const reportId = createRes.data.reportId;
  console.log(`[${new Date().toISOString()}] Created ${type}: ${reportId}`);

  const start = Date.now();
  let poll = 0;
  while (Date.now() - start < maxWaitMs) {
    await sleep(8000);
    poll++;
    const r = await client.get(`/reports/2021-06-30/reports/${reportId}`);
    const { processingStatus, reportDocumentId } = r.data;
    if (poll % 3 === 0) console.log(`  poll ${poll}: ${processingStatus}`);

    if (processingStatus === 'DONE' && reportDocumentId) {
      const docRes = await client.get(`/reports/2021-06-30/documents/${reportDocumentId}`);
      const dl = await axios.get(docRes.data.url, { responseType: 'arraybuffer', timeout: 60000 });
      const text = docRes.data.compressionAlgorithm === 'GZIP'
        ? zlib.gunzipSync(Buffer.from(dl.data)).toString('utf8')
        : Buffer.from(dl.data).toString('utf8');
      console.log(`  DONE in ${Math.round((Date.now()-start)/1000)}s`);
      return JSON.parse(text);
    }
    if (['CANCELLED','FATAL'].includes(processingStatus)) {
      if (reportDocumentId) {
        try {
          const docRes = await client.get(`/reports/2021-06-30/documents/${reportDocumentId}`);
          const dl = await axios.get(docRes.data.url, { responseType: 'arraybuffer', timeout: 30000 });
          const text = zlib.gunzipSync(Buffer.from(dl.data)).toString('utf8');
          const e = JSON.parse(text);
          throw new Error(e.errorDetails || processingStatus);
        } catch(e2) { throw e2; }
      }
      throw new Error(processingStatus);
    }
  }
  throw new Error('TIMEOUT');
}

function toRows(data, ...keys) {
  if (Array.isArray(data)) return data;
  for (const k of keys) { if (Array.isArray(data?.[k])) return data[k]; }
  return [];
}

async function main() {
  console.log('=== WEEK BACKFILL: Traffic + NetPPM ===');
  console.log('Range: 2026-03-22 (Sun) → 2026-04-04 (Sat)');

  // ── Traffic ─────────────────────────────────────────────────────────────────
  try {
    const data = await requestReport('GET_VENDOR_TRAFFIC_REPORT', {
      reportPeriod: 'WEEK',
      dataStartTime: '2026-03-22',
      dataEndTime: '2026-04-04',
    });
    const rows = toRows(data, 'trafficByAsin', 'reportData');
    console.log(`Traffic: ${rows.length} rows, keys: ${Object.keys(data).join(',')}`);
    if (rows.length > 0) console.log('First row:', JSON.stringify(rows[0]));

    let written = 0;
    for (const row of rows) {
      const asin = row.asin || row.parentAsin;
      const startDate = row.startDate || row.reportingDate;
      const endDate = row.endDate || row.reportingDate;
      if (!asin || !startDate) continue;
      const gv = row.glanceViews || row.acr || 0;
      await query(`
        MERGE INTO CALBRIDGE_PROD.APP.VENDOR_TRAFFIC t
        USING (SELECT ? AS client_id, ? AS asin, ? AS start_date) s
        ON t.client_id=s.client_id AND t.asin=s.asin AND t.start_date=s.start_date
        WHEN MATCHED THEN UPDATE SET end_date=?,glance_views=?,synced_at=CURRENT_TIMESTAMP()
        WHEN NOT MATCHED THEN INSERT(client_id,asin,start_date,end_date,glance_views,synced_at)
          VALUES(?,?,?,?,?,CURRENT_TIMESTAMP())
      `, [CLIENT_ID,asin,startDate,endDate,gv,CLIENT_ID,asin,startDate,endDate,gv]);
      written++;
    }
    console.log(`Traffic written: ${written}`);
  } catch(err) {
    console.error('Traffic FAILED:', err.message.substring(0, 300));
  }

  await sleep(3000);

  // ── Net PPM ──────────────────────────────────────────────────────────────────
  try {
    const data = await requestReport('GET_VENDOR_NET_PURE_PRODUCT_MARGIN_REPORT', {
      reportPeriod: 'WEEK',
      dataStartTime: '2026-03-22',
      dataEndTime: '2026-04-04',
    });
    const rows = toRows(data, 'netPpmByAsin', 'reportData');
    console.log(`NetPPM: ${rows.length} rows, keys: ${Object.keys(data).join(',')}`);
    if (rows.length > 0) console.log('First row:', JSON.stringify(rows[0]));

    let written = 0;
    for (const row of rows) {
      const asin = row.asin || row.parentAsin;
      const startDate = row.startDate || row.reportingDate;
      const endDate = row.endDate || row.reportingDate;
      if (!asin || !startDate) continue;
      const ppm = row.netPureProductMargin ?? row.netPPM ?? null;
      await query(`
        MERGE INTO CALBRIDGE_PROD.APP.VENDOR_NET_PPM t
        USING (SELECT ? AS client_id, ? AS asin, ? AS start_date) s
        ON t.client_id=s.client_id AND t.asin=s.asin AND t.start_date=s.start_date
        WHEN MATCHED THEN UPDATE SET end_date=?,net_pure_product_margin=?,synced_at=CURRENT_TIMESTAMP()
        WHEN NOT MATCHED THEN INSERT(client_id,asin,start_date,end_date,net_pure_product_margin,synced_at)
          VALUES(?,?,?,?,?,CURRENT_TIMESTAMP())
      `, [CLIENT_ID,asin,startDate,endDate,ppm,CLIENT_ID,asin,startDate,endDate,ppm]);
      written++;
    }
    console.log(`NetPPM written: ${written}`);
  } catch(err) {
    console.error('NetPPM FAILED:', err.message.substring(0, 300));
  }

  // ── Also get Apr 6 sales (single day) ────────────────────────────────────────
  try {
    const data = await requestReport('GET_VENDOR_SALES_REPORT', {
      reportPeriod: 'DAY',
      distributorView: 'MANUFACTURING',
      sellingProgram: 'RETAIL',
      dataStartTime: '2026-04-06',
      dataEndTime: '2026-04-06',
    });
    const rows = toRows(data, 'salesByAsin', 'reportData');
    console.log(`Sales Apr 6: ${rows.length} rows`);
    let written = 0;
    for (const row of rows) {
      const asin = row.asin || row.parentAsin;
      const startDate = row.startDate || row.reportingDate;
      const endDate = row.endDate || row.reportingDate;
      if (!asin || !startDate) continue;
      const moneyAmt = (v) => v != null && typeof v==='object' ? (v.amount??0) : (v??0);
      const orderedAmt = moneyAmt(row.orderedRevenue);
      const orderedCcy = row.orderedRevenue?.currencyCode || 'USD';
      const shippedAmt = moneyAmt(row.shippedRevenue);
      const cogsAmt = moneyAmt(row.shippedCogs ?? row.shippedCOGS);
      const shippedCcy = row.shippedRevenue?.currencyCode || 'USD';
      await query(`
        MERGE INTO CALBRIDGE_PROD.APP.VENDOR_SALES t
        USING (SELECT ? AS client_id, ? AS asin, ? AS start_date) s
        ON t.client_id=s.client_id AND t.asin=s.asin AND t.start_date=s.start_date
        WHEN MATCHED THEN UPDATE SET end_date=?,ordered_units=?,ordered_revenue=?,ordered_currency=?,shipped_units=?,shipped_revenue=?,shipped_cogs=?,shipped_currency=?,customer_returns=?,synced_at=CURRENT_TIMESTAMP()
        WHEN NOT MATCHED THEN INSERT(client_id,asin,start_date,end_date,ordered_units,ordered_revenue,ordered_currency,shipped_units,shipped_revenue,shipped_cogs,shipped_currency,customer_returns,synced_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP())
      `, [
        CLIENT_ID,asin,startDate,
        endDate,row.orderedUnits??0,orderedAmt,orderedCcy,row.shippedUnits??0,shippedAmt,cogsAmt,shippedCcy,row.customerReturns??0,
        CLIENT_ID,asin,startDate,endDate,row.orderedUnits??0,orderedAmt,orderedCcy,row.shippedUnits??0,shippedAmt,cogsAmt,shippedCcy,row.customerReturns??0,
      ]);
      written++;
    }
    console.log(`Sales Apr 6 written: ${written}`);
  } catch(err) {
    console.error('Sales Apr 6 FAILED:', err.message.substring(0, 300));
  }

  // ── Final state ───────────────────────────────────────────────────────────────
  const tables = ['VENDOR_SALES', 'VENDOR_INVENTORY', 'VENDOR_TRAFFIC', 'VENDOR_NET_PPM'];
  const res = await Promise.all(tables.map(t =>
    query(`SELECT COUNT(*) as cnt, MIN(start_date) as min_d, MAX(start_date) as max_d FROM CALBRIDGE_PROD.APP.${t} WHERE client_id=?`, [CLIENT_ID])
  ));
  console.log('\n=== FINAL STATE ===');
  res.forEach((r,i) => console.log(`  ${tables[i]}:`, JSON.stringify(r[0])));
  process.exit(0);
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
