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
 * Fetch catalog items by ASIN batch from SP-API Catalog Items v2022-04-01.
 * Max 20 ASINs per request — caller handles batching.
 *
 * Key params:
 *   identifiers      = comma-delimited ASINs (max 20)
 *   identifiersType  = 'ASIN'
 *   marketplaceIds   = single marketplace ID (max 1 per request)
 *   includedData     = 'summaries,images,salesRanks,relationships'
 *
 * Returns array of item objects.
 */
async function fetchCatalogBatch(client, asins, marketplaceId = 'ATVPDKIKX0DER') {
  const res = await client.get('/catalog/2022-04-01/items', {
    params: {
      identifiers:     asins.join(','),
      identifiersType: 'ASIN',
      marketplaceIds:  marketplaceId,
      includedData:    'summaries,images,salesRanks,relationships',
      pageSize:        20,
    }
  });
  return res.data?.items || [];
}

/**
 * Fetch all ASINs for this client via GET_MERCHANT_LISTINGS_ALL_DATA report.
 * Returns array of { asin, sku, title, price, status } objects.
 * Used to discover ASINs not yet in our PRODUCTS table.
 */
async function fetchListingsReport(client, marketplaceId = 'ATVPDKIKX0DER') {
  const createRes = await client.post('/reports/2021-06-30/reports', {
    reportType:      'GET_MERCHANT_LISTINGS_ALL_DATA',
    marketplaceIds:  [marketplaceId],
  });
  const reportId = createRes.data?.reportId;
  if (!reportId) throw new Error('No reportId from GET_MERCHANT_LISTINGS_ALL_DATA');

  // Poll up to 5 min
  const maxWait = 300000;
  const start   = Date.now();
  while (Date.now() - start < maxWait) {
    await new Promise(r => setTimeout(r, 15000));
    const status = await client.get(`/reports/2021-06-30/reports/${reportId}`);
    const { processingStatus, reportDocumentId } = status.data;
    if (processingStatus === 'DONE' && reportDocumentId) {
      const docRes  = await client.get(`/reports/2021-06-30/documents/${reportDocumentId}`);
      const dl      = await axios.get(docRes.data.url, { responseType: 'text' });
      // TSV — parse header + rows
      const lines   = dl.data.split('\n').filter(Boolean);
      const headers = lines[0].split('\t').map(h => h.trim());
      return lines.slice(1).map(line => {
        const cells = line.split('\t');
        const row   = {};
        headers.forEach((h, i) => { row[h] = cells[i]?.trim() || null; });
        return {
          asin:   row['asin1'] || row['asin'] || null,
          sku:    row['seller-sku'] || row['sku'] || null,
          title:  row['item-name'] || row['title'] || null,
          price:  row['price'] ? parseFloat(row['price']) : null,
          status: row['status'] || null,
        };
      }).filter(r => r.asin);
    }
    if (['CANCELLED', 'FATAL'].includes(processingStatus)) {
      throw new Error(`Listings report ${reportId} ended with: ${processingStatus}`);
    }
  }
  throw new Error('Listings report timed out');
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
 * Upsert catalog items into PRODUCTS table.
 * Handles the richer v2022-04-01 response shape:
 *   item.summaries[0]        → title, brand, productType, modelNumber
 *   item.images[0].images[0] → image_url (MAIN image)
 *   item.relationships       → parent_asin (variation parent)
 *
 * Only overwrites non-null fields — preserves COGS/FBA_FEES set elsewhere.
 */
async function writeProducts(clientId, connectionType, items) {
  if (!items.length) return 0;
  const { batchMerge } = require('../services/snowflakeService');
  const rows = items.map(item => {
    const asin     = item.asin;
    const summary  = (item.summaries  || [])[0] || {};
    const imgSet   = (item.images     || [])[0];
    const mainImg  = (imgSet?.images  || []).find(i => i.variant === 'MAIN');
    // Resolve parent ASIN from relationships
    const relParent = (item.relationships || []).find(r => r.type === 'VARIATION');
    const parentAsin = relParent?.parentAsin || null;

    return {
      client_id:        clientId,
      connection_type:  connectionType,
      asin,
      title:            summary.itemName       || null,
      brand:            summary.brand          || null,
      product_type:     summary.productType    || null,
      model_number:     summary.modelNumber    || null,
      image_url:        mainImg?.link          || null,
      parent_asin:      parentAsin,
      marketplace:      'US',
      is_active:        true,
    };
  });

  return batchMerge({
    table:       'CALBRIDGE_PROD.APP.products',
    keyColumns:  ['client_id', 'asin'],
    dataColumns: ['connection_type', 'title', 'brand', 'product_type', 'model_number',
                  'image_url', 'parent_asin', 'marketplace', 'is_active'],
    dateColumns: [],
    rows,
  });
}

/**
 * Upsert SKU rows from the listings report into PRODUCTS.
 * Only sets fields not already populated by the catalog API.
 */
async function writeListings(clientId, connectionType, listings) {
  if (!listings.length) return 0;
  const { batchMerge } = require('../services/snowflakeService');
  const rows = listings.map(l => ({
    client_id:       clientId,
    connection_type: connectionType,
    asin:            l.asin,
    sku:             l.sku,
    title:           l.title,
    price:           l.price,
    marketplace:     'US',
    is_active:       l.status === 'Active' ? true : false,
  }));
  return batchMerge({
    table:       'CALBRIDGE_PROD.APP.products',
    keyColumns:  ['client_id', 'asin'],
    dataColumns: ['connection_type', 'sku', 'title', 'price', 'marketplace', 'is_active'],
    dateColumns: [],
    rows,
  });
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
        -- SP-API seller reports only provide demand (ordered) data, not fulfillment data.
        -- units_received and shipped_revenue are vendor-side concepts; there is no shipped
        -- equivalent in the SP-API Sales & Traffic report. B2B ordered units/revenue must NOT
        -- be mapped here — B2B ordered ≠ received/shipped. Set both to 0 to avoid poisoning
        -- downstream queries that expect vendor fulfillment data in these columns.
        units_received = 0, shipped_revenue = 0,
        synced_at = CURRENT_TIMESTAMP
      WHEN NOT MATCHED THEN INSERT
        (client_id, connection_type, asin, order_date,
         units_ordered, ordered_revenue, units_received, shipped_revenue, synced_at)
        VALUES (?, ?, ?, ?, ?, ?, 0, 0, CURRENT_TIMESTAMP)
    `, [
      clientId, connectionType, asin, date,
      sales.unitsOrdered || 0, sales.orderedProductSales?.amount || 0,
      clientId, connectionType, asin, date,
      sales.unitsOrdered || 0, sales.orderedProductSales?.amount || 0
    ]);
    written++;
  }
  return written;
}

/**
 * Resolve account_id from client_accounts for a given channel (Phase 2c).
 * Returns null if not found or on error. For logging/audit purposes.
 */
async function resolveAccountId(clientId, channel) {
  try {
    const rows = await query(`
      SELECT account_id
      FROM   CALBRIDGE_PROD.APP.client_accounts
      WHERE  client_id = ?
        AND  channel   = ?
        AND  is_active = TRUE
      LIMIT  1
    `, [clientId, channel]);
    if (rows.length > 0) return rows[0].ACCOUNT_ID || rows[0].account_id || null;
  } catch (err) {
    console.warn(`[spIngestion] account_id lookup for channel=${channel} failed (non-fatal):`, err.message);
  }
  return null;
}

/**
 * Main ingestion job — full product catalog.
 *
 * Flow:
 *   1. GET_MERCHANT_LISTINGS_ALL_DATA report → full SKU/ASIN list, upsert into PRODUCTS
 *   2. Collect all known ASINs for this client (PRODUCTS + advertised)
 *   3. Batch-lookup catalog details (title, brand, image, parent_asin) via
 *      GET /catalog/2022-04-01/items with identifiers=ASIN (20 per request)
 *
 * Rate: 2 req/s burst for catalog items — we sleep 600ms between batches.
 */
async function ingestProducts(clientId, connectionType = 'seller') {
  return runJob(clientId, connectionType, 'products', async () => {
    const accountId = await resolveAccountId(clientId, connectionType);
    if (accountId) console.log(`[spIngestion] catalog client=${clientId} account_id=${accountId}`);

    const client = await spClient(clientId, connectionType);
    const marketplaceId = 'ATVPDKIKX0DER';
    let totalWritten = 0;

    // Step 1: listings report for full SKU→ASIN map
    console.log(`[spIngestion] Fetching listings report...`);
    let listingWritten = 0;
    try {
      const listings = await fetchListingsReport(client, marketplaceId);
      console.log(`[spIngestion] Listings report: ${listings.length} rows`);
      listingWritten = await writeListings(clientId, connectionType, listings);
      console.log(`[spIngestion] Listings upserted: ${listingWritten}`);
      totalWritten += listingWritten;
    } catch (err) {
      console.warn(`[spIngestion] Listings report failed (non-fatal): ${err.message}`);
    }

    // Step 2: collect all known ASINs
    const asinRows = await query(`
      SELECT DISTINCT asin FROM CALBRIDGE_PROD.APP.products
      WHERE client_id = ? AND asin IS NOT NULL
    `, [clientId]);
    const asins = asinRows.map(r => r.ASIN || r.asin).filter(Boolean);
    console.log(`[spIngestion] Enriching ${asins.length} ASINs via Catalog API...`);

    // Step 3: batch catalog lookups (20 per request)
    const BATCH = 20;
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    for (let i = 0; i < asins.length; i += BATCH) {
      const batch = asins.slice(i, i + BATCH);
      try {
        const items = await fetchCatalogBatch(client, batch, marketplaceId);
        if (items.length) {
          const written = await writeProducts(clientId, connectionType, items);
          totalWritten += written;
        }
        console.log(`[spIngestion] Catalog batch ${Math.floor(i/BATCH)+1}/${Math.ceil(asins.length/BATCH)}: ${batch.length} in → ${items.length} back`);
      } catch (err) {
        console.warn(`[spIngestion] Catalog batch ${i}–${i+BATCH} failed: ${err.message}`);
      }
      if (i + BATCH < asins.length) await sleep(600); // 2 req/s rate limit
    }

    console.log(`[spIngestion] Catalog sync complete — ${totalWritten} rows upserted`);
    return { recordsWritten: totalWritten };
  });
}

/**
 * Main ingestion job — sales (last N days)
 *
 * Phase 2c: resolves account_id from client_accounts for logging.
 */
async function ingestSales(clientId, connectionType, daysBack = 7) {
  return runJob(clientId, connectionType, 'sales', async () => {
    // Phase 2c: log account_id if available
    const accountId = await resolveAccountId(clientId, connectionType);
    if (accountId) console.log(`[spIngestion] sales client=${clientId} connectionType=${connectionType} account_id=${accountId}`);

    const client = await spClient(clientId, connectionType);
    const endDate = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - daysBack * 86400000).toISOString().split('T')[0];

    const salesData = await fetchSalesReport(client, startDate, endDate);
    const written = await writeSales(clientId, connectionType, salesData);
    return { recordsWritten: written };
  });
}

module.exports = { ingestProducts, ingestSales };
