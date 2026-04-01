/**
 * Amazon SP-API ingestion
 * Covers: Seller Central + Vendor Central
 *
 * Sandbox base URL: https://sandbox.sellingpartnerapi-na.amazon.com
 * Production base URL: https://sellingpartnerapi-na.amazon.com
 */
require('dotenv').config();
const axios = require('axios');
const { query } = require('../services/snowflakeService');
const { getValidToken } = require('../services/amazonAuthService');
const { runJob } = require('./ingestionRunner');

const IS_SANDBOX = process.env.NODE_ENV !== 'production';
const SP_API_BASE = IS_SANDBOX
  ? 'https://sandbox.sellingpartnerapi-na.amazon.com'
  : 'https://sellingpartnerapi-na.amazon.com';

console.log(`[SP-API] Using ${IS_SANDBOX ? 'SANDBOX' : 'PRODUCTION'} endpoint`);

/**
 * Build authenticated Axios instance for SP-API
 */
async function spClient(clientId, connectionType) {
  const accessToken = await getValidToken(clientId, connectionType);
  return axios.create({
    baseURL: SP_API_BASE,
    headers: {
      'x-amz-access-token': accessToken,
      'Content-Type': 'application/json'
    }
  });
}

/**
 * Fetch catalog items (products) from SP-API
 */
async function fetchProducts(client, marketplaceId = 'ATVPDKIKX0DER') {
  const res = await client.get('/catalog/2022-04-01/items', {
    params: {
      marketplaceIds: marketplaceId,
      includedData: 'summaries,attributes,salesRanks',
      pageSize: 20
    }
  });
  return res.data?.items || [];
}

/**
 * Fetch sales traffic report (Seller Central)
 */
async function fetchSalesReport(client, startDate, endDate, marketplaceId = 'ATVPDKIKX0DER') {
  // Create report
  const createRes = await client.post('/reports/2021-06-30/reports', {
    reportType: 'GET_SALES_AND_TRAFFIC_REPORT',
    dataStartTime: `${startDate}T00:00:00Z`,
    dataEndTime: `${endDate}T23:59:59Z`,
    reportOptions: { dateGranularity: 'DAY', asinGranularity: 'PARENT' },
    marketplaceIds: [marketplaceId]
  });

  const reportId = createRes.data?.reportId;
  if (!reportId) throw new Error('No reportId returned from SP-API');

  // Poll for completion
  const reportDoc = await pollReport(client, reportId);
  return reportDoc;
}

/**
 * Poll SP-API report until done, then download
 */
async function pollReport(client, reportId, maxWaitMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const res = await client.get(`/reports/2021-06-30/reports/${reportId}`);
    const { processingStatus, reportDocumentId } = res.data;

    if (processingStatus === 'DONE' && reportDocumentId) {
      const docRes = await client.get(`/reports/2021-06-30/documents/${reportDocumentId}`);
      const { url } = docRes.data;
      const download = await axios.get(url, { responseType: 'json' });
      return download.data;
    }
    if (['CANCELLED', 'FATAL'].includes(processingStatus)) {
      throw new Error(`Report ${reportId} ended with status: ${processingStatus}`);
    }
    await new Promise(r => setTimeout(r, 10000)); // poll every 10s
  }
  throw new Error(`Report ${reportId} timed out after ${maxWaitMs/1000}s`);
}

/**
 * Upsert products into Snowflake
 */
async function writeProducts(clientId, connectionType, items) {
  if (!items.length) return 0;
  let written = 0;
  for (const item of items) {
    const asin = item.asin;
    const summary = item.summaries?.[0] || {};
    await query(`
      MERGE INTO products t
      USING (SELECT ? AS client_id, ? AS connection_type, ? AS asin) s
      ON t.client_id = s.client_id AND t.connection_type = s.connection_type AND t.asin = s.asin
      WHEN MATCHED THEN UPDATE SET
        title = ?, brand = ?, synced_at = CURRENT_TIMESTAMP
      WHEN NOT MATCHED THEN INSERT
        (client_id, connection_type, asin, title, brand, synced_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `, [
      clientId, connectionType, asin,
      summary.itemName || null, summary.brand || null,
      clientId, connectionType, asin,
      summary.itemName || null, summary.brand || null
    ]);
    written++;
  }
  return written;
}

/**
 * Upsert sales data into Snowflake
 */
async function writeSales(clientId, connectionType, salesData) {
  const rows = salesData?.salesAndTrafficByAsin || [];
  if (!rows.length) return 0;
  let written = 0;

  for (const row of rows) {
    const asin = row.parentAsin || row.childAsin;
    if (!asin) continue;
    const traffic = row.trafficByAsin || {};
    const sales = row.salesByAsin || {};
    const date = row.date || new Date().toISOString().split('T')[0];

    await query(`
      MERGE INTO vendor_purchase_orders t
      USING (SELECT ? AS client_id, ? AS connection_type, ? AS asin, ? AS order_date) s
      ON t.client_id = s.client_id AND t.connection_type = s.connection_type
        AND t.asin = s.asin AND t.order_date = s.order_date
      WHEN MATCHED THEN UPDATE SET
        units_ordered = ?, ordered_revenue = ?,
        units_received = ?, shipped_revenue = ?,
        synced_at = CURRENT_TIMESTAMP
      WHEN NOT MATCHED THEN INSERT
        (client_id, connection_type, asin, order_date,
         units_ordered, ordered_revenue, units_received, shipped_revenue, synced_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `, [
      clientId, connectionType, asin, date,
      sales.unitsOrdered || 0, sales.orderedProductSales?.amount || 0,
      sales.unitsOrderedB2B || 0, sales.orderedProductSalesB2B?.amount || 0,
      clientId, connectionType, asin, date,
      sales.unitsOrdered || 0, sales.orderedProductSales?.amount || 0,
      sales.unitsOrderedB2B || 0, sales.orderedProductSalesB2B?.amount || 0
    ]);
    written++;
  }
  return written;
}

/**
 * Main ingestion job — products
 */
async function ingestProducts(clientId, connectionType) {
  return runJob(clientId, connectionType, 'products', async () => {
    const client = await spClient(clientId, connectionType);
    const items = await fetchProducts(client);
    const written = await writeProducts(clientId, connectionType, items);
    return { recordsWritten: written };
  });
}

/**
 * Main ingestion job — sales (last N days)
 */
async function ingestSales(clientId, connectionType, daysBack = 7) {
  return runJob(clientId, connectionType, 'sales', async () => {
    const client = await spClient(clientId, connectionType);
    const endDate = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - daysBack * 86400000).toISOString().split('T')[0];

    const salesData = await fetchSalesReport(client, startDate, endDate);
    const written = await writeSales(clientId, connectionType, salesData);
    return { recordsWritten: written };
  });
}

module.exports = { ingestProducts, ingestSales };
