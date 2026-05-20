/**
 * src/services/dataFreshnessReport.js
 *
 * Data Freshness Report — internal operational email.
 *
 * Sends a daily HTML table to abe@teamcalbridge.com showing, for each active
 * client, how long ago each core data source was last ingested.
 *
 * Data sources tracked (MAX(ingested_at) per client_id):
 *   - Ads SP/SB/SD   RAW.AD_CAMPAIGN
 *   - DSP             RAW.AD_CAMPAIGN WHERE ad_product LIKE 'DSP%'
 *   - Vendor Sales    RAW.RETAIL_SALES / APP.vendor_sales
 *   - Vendor Inventory APP.vendor_inventory
 *   - Vendor Traffic  APP.vendor_traffic
 *   - Vendor Forecasts APP.VENDOR_FORECASTS
 *   - Seller Sales & Traffic RAW.RETAIL_SALES_TRAFFIC
 *   - Seller Inventory       RAW.RETAIL_INVENTORY
 *   - Order Metrics          RAW.RETAIL_ORDER_METRICS
 *   - Settlement             RAW.RETAIL_SETTLEMENT
 *   - FBA Fees               RAW.RETAIL_FEE
 *
 * Colour coding (time since last update):
 *   green  < 6 h
 *   yellow 6–24 h
 *   orange 24–72 h
 *   red    > 72 h or never
 */

'use strict';

require('dotenv').config();

const { query }  = require('./snowflakeService');
const { sendEmail } = require('./graphEmailService');

const FROM_EMAIL = 'ash@teamcalbridge.com';
const TO_EMAIL   = 'abe@teamcalbridge.com';

// ─── Data source definitions ──────────────────────────────────────────────────

const DATA_SOURCES = [
  {
    key:   'ads',
    label: 'Ads (SP/SB/SD)',
    table: 'CALBRIDGE_PROD.RAW.AD_CAMPAIGN',
    where: null,   // all rows
  },
  {
    key:   'dsp',
    label: 'DSP',
    table: 'CALBRIDGE_PROD.RAW.AD_CAMPAIGN',
    where: "ad_product LIKE 'DSP%'",
  },
  {
    key:   'vendor_sales',
    label: 'Vendor Sales',
    // Prefer RAW.RETAIL_SALES; fall back to APP.vendor_sales (resolved at runtime)
    table: 'CALBRIDGE_PROD.RAW.RETAIL_SALES',
    fallback: 'CALBRIDGE_PROD.APP.vendor_sales',
    where: null,
  },
  {
    key:   'vendor_inventory',
    label: 'Vendor Inventory',
    table: 'CALBRIDGE_PROD.APP.vendor_inventory',
    timestampCol: 'synced_at',
    where: null,
  },
  {
    key:   'vendor_traffic',
    label: 'Vendor Traffic (Glance Views)',
    table: 'CALBRIDGE_PROD.APP.vendor_traffic',
    timestampCol: 'synced_at',
    where: null,
  },
  {
    key:   'vendor_net_ppm',
    label: 'Vendor Net PPM',
    table: 'CALBRIDGE_PROD.APP.vendor_net_ppm',
    timestampCol: 'synced_at',
    where: null,
  },
  {
    key:   'vendor_forecasts',
    label: 'Vendor Forecasts',
    table: 'CALBRIDGE_PROD.APP.VENDOR_FORECASTS',
    timestampCol: 'synced_at',
    where: null,
  },
  {
    key:   'seller_sales_traffic',
    label: 'Seller Sales & Traffic',
    table: 'CALBRIDGE_PROD.RAW.RETAIL_SALES_TRAFFIC',
    where: null,
  },
  {
    key:   'seller_inventory',
    label: 'Seller Inventory',
    table: 'CALBRIDGE_PROD.RAW.RETAIL_INVENTORY',
    where: null,
  },
  {
    key:   'order_metrics',
    label: 'Order Metrics',
    table: 'CALBRIDGE_PROD.RAW.RETAIL_ORDER_METRICS',
    where: null,
  },
  {
    key:   'settlement',
    label: 'Settlement',
    table: 'CALBRIDGE_PROD.RAW.RETAIL_SETTLEMENT',
    where: null,
  },
  {
    key:   'fba_fees',
    label: 'FBA Fees',
    table: 'CALBRIDGE_PROD.RAW.RETAIL_FEE',
    where: null,
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Check whether a fully-qualified Snowflake table exists.
 * Returns true/false — never throws.
 */
async function tableExists(fqTable) {
  // Parse db.schema.table from a fully-qualified name like CALBRIDGE_PROD.RAW.AD_CAMPAIGN
  const parts = fqTable.split('.');
  if (parts.length !== 3) return false;
  const [db, schema, table] = parts;
  try {
    const rows = await query(
      `SELECT COUNT(*) AS CNT
         FROM ${db}.INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = ?
          AND TABLE_NAME   = ?`,
      [schema.toUpperCase(), table.toUpperCase()]
    );
    return Number(rows?.[0]?.CNT ?? rows?.[0]?.cnt ?? 0) > 0;
  } catch (_) {
    return false;
  }
}

/**
 * Query MAX(ingested_at) grouped by client_id for one data source.
 * Returns a Map<clientId, Date|null>.
 * Returns an empty Map (gracefully) if the table doesn't exist or the query fails.
 */
async function fetchFreshnessMap(source, existingTables) {
  // Resolve the table to query (prefer primary, fall back if needed)
  let table = source.table;
  if (!existingTables.has(table)) {
    if (source.fallback && existingTables.has(source.fallback)) {
      table = source.fallback;
    } else {
      // Neither table exists — return empty map
      return new Map();
    }
  }

  const whereClause = source.where ? `AND ${source.where}` : '';
  const tsCol = source.timestampCol || 'ingested_at';
  const sql = `
    SELECT client_id, MAX(${tsCol}) AS last_ingested
      FROM ${table}
     WHERE ${tsCol} IS NOT NULL
       ${whereClause}
     GROUP BY client_id
  `;

  try {
    const rows = await query(sql);
    const map = new Map();
    for (const row of (rows || [])) {
      const clientId = row.CLIENT_ID ?? row.client_id;
      const ts       = row.LAST_INGESTED ?? row.last_ingested;
      map.set(String(clientId), ts ? new Date(ts) : null);
    }
    return map;
  } catch (err) {
    console.warn(`[freshnessReport] Query failed for ${table} (${source.key}):`, err.message);
    return new Map();
  }
}

/**
 * Convert a Date (or null) to a human-readable "X ago" string.
 */
function formatAge(date, now) {
  if (!date) return 'never';
  const diffMs = now - date;
  if (diffMs < 0) return '<1m ago'; // clock skew guard
  const mins  = Math.floor(diffMs / 60_000);
  const hours = Math.floor(diffMs / 3_600_000);
  const days  = Math.floor(diffMs / 86_400_000);
  if (mins < 60)   return `${mins}m ago`;
  if (hours < 24)  return `${hours}h ago`;
  return `${days}d ago`;
}

/**
 * Pick a background colour for a freshness cell.
 */
function cellColor(date, now) {
  if (!date) return '#f8d7da'; // red — never
  const hours = (now - date) / 3_600_000;
  if (hours < 6)  return '#d4edda'; // green
  if (hours < 24) return '#fff3cd'; // yellow
  if (hours < 72) return '#ffe5b4'; // orange
  return '#f8d7da';                 // red
}

// ─── Report generation ────────────────────────────────────────────────────────

/**
 * Build the full freshness report HTML.
 *
 * @returns {{ html: string, clientCount: number }}
 */
async function generateFreshnessReport() {
  const now = new Date();

  // 1. Fetch active clients
  let clients = [];
  try {
    const rows = await query(
      `SELECT client_id, name, company_name
         FROM CALBRIDGE_PROD.APP.clients
        WHERE status = 'active'
        ORDER BY company_name, name`
    );
    clients = (rows || []).map(r => ({
      clientId:    String(r.CLIENT_ID    ?? r.client_id),
      name:        r.NAME                ?? r.name        ?? '',
      companyName: r.COMPANY_NAME        ?? r.company_name ?? '',
    }));
  } catch (err) {
    console.error('[freshnessReport] Failed to fetch clients:', err.message);
    throw err;
  }

  if (clients.length === 0) {
    console.warn('[freshnessReport] No active clients found.');
  }

  // 2. Check which tables exist (batched up-front to avoid repeated checks per source)
  const existingTables = new Set();
  for (const src of DATA_SOURCES) {
    const tables = [src.table, src.fallback].filter(Boolean);
    for (const t of tables) {
      if (await tableExists(t)) existingTables.add(t);
    }
  }
  console.log(`[freshnessReport] Tables confirmed: ${[...existingTables].join(', ') || 'none'}`);

  // 3. For each data source, fetch MAX(ingested_at) per client
  const freshnessData = {}; // { sourceKey: Map<clientId, Date|null> }
  for (const src of DATA_SOURCES) {
    freshnessData[src.key] = await fetchFreshnessMap(src, existingTables);
  }

  // 4. Build the HTML table
  const dateStr = now.toISOString().split('T')[0];

  const headerCells = DATA_SOURCES.map(s =>
    `<th style="${thStyle}">${s.label}</th>`
  ).join('');

  const bodyRows = clients.map(client => {
    const displayName = client.companyName || client.name || client.clientId;
    const dataCells = DATA_SOURCES.map(src => {
      const map  = freshnessData[src.key];
      const date = map.get(client.clientId) ?? null;
      const age  = map.size === 0 ? 'N/A' : formatAge(date, now);
      const bg   = map.size === 0 ? '#f0f0f0' : cellColor(date, now);
      return `<td style="${tdStyle}background:${bg};">${age}</td>`;
    }).join('');
    return `<tr>
      <td style="${tdStyle}font-weight:600;background:#f9f9f9;">${escHtml(displayName)}</td>
      ${dataCells}
    </tr>`;
  }).join('\n');

  // Legend
  const legendItems = [
    { color: '#d4edda', label: '< 6h' },
    { color: '#fff3cd', label: '6–24h' },
    { color: '#ffe5b4', label: '24–72h' },
    { color: '#f8d7da', label: '> 72h / never' },
    { color: '#f0f0f0', label: 'N/A (table missing)' },
  ];
  const legendHtml = legendItems.map(l =>
    `<span style="display:inline-block;margin-right:16px;">
       <span style="display:inline-block;width:14px;height:14px;background:${l.color};border:1px solid #ccc;vertical-align:middle;margin-right:4px;border-radius:3px;"></span>
       ${l.label}
     </span>`
  ).join('');

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Calbridge Data Freshness — ${dateStr}</title></head>
<body style="font-family:Arial,sans-serif;color:#333;margin:0;padding:20px;background:#fff;">
  <h2 style="margin-bottom:4px;">📊 Calbridge Data Freshness Report</h2>
  <p style="color:#666;margin-top:0;margin-bottom:20px;">${now.toUTCString()} &mdash; ${clients.length} active client(s)</p>

  <div style="margin-bottom:16px;font-size:13px;">${legendHtml}</div>

  <div style="overflow-x:auto;">
    <table style="border-collapse:collapse;min-width:900px;font-size:13px;">
      <thead>
        <tr>
          <th style="${thStyle}text-align:left;min-width:160px;">Client</th>
          ${headerCells}
        </tr>
      </thead>
      <tbody>
        ${bodyRows || '<tr><td colspan="${DATA_SOURCES.length + 1}" style="padding:12px;color:#999;">No active clients.</td></tr>'}
      </tbody>
    </table>
  </div>

  <p style="margin-top:24px;font-size:12px;color:#999;">
    Generated by Ash · Calbridge internal tooling · Do not forward.
  </p>
</body>
</html>`;

  return { html, clientCount: clients.length, dateStr };
}

// ─── Shared style strings ─────────────────────────────────────────────────────

const thStyle = `
  background:#2c3e50;
  color:#fff;
  padding:8px 10px;
  text-align:center;
  white-space:nowrap;
  border:1px solid #1a252f;
  font-size:12px;
`.replace(/\s+/g, ' ').trim() + ';';

const tdStyle = `
  padding:7px 10px;
  text-align:center;
  border:1px solid #ddd;
  white-space:nowrap;
`.replace(/\s+/g, ' ').trim() + ';';

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Generate the freshness report and send it via Resend.
 *
 * @returns {Promise<{ sent: boolean, clientCount: number }>}
 */
async function sendFreshnessReport() {
  console.log('[freshnessReport] Generating data freshness report…');
  let html, clientCount, dateStr;

  try {
    ({ html, clientCount, dateStr } = await generateFreshnessReport());
  } catch (err) {
    console.error('[freshnessReport] Report generation failed:', err.message);
    return { sent: false, clientCount: 0 };
  }

  const subject = `📊 Calbridge Data Freshness Report — ${dateStr}`;

  try {
    const result = await sendEmail({ from: FROM_EMAIL, to: TO_EMAIL, subject, html });
    console.log(`[freshnessReport] Sent to ${TO_EMAIL} — ${clientCount} client(s)`);
    return { sent: true, clientCount };
  } catch (err) {
    console.error('[freshnessReport] Graph delivery failed:', err.message);
    return { sent: false, clientCount };
  }
}

module.exports = { sendFreshnessReport, generateFreshnessReport };
