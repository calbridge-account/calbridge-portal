'use strict';

/**
 * src/routes/reportBuilder.js
 *
 * Power BI-style Report Builder API
 *
 * GET    /api/report-builder/reports                — list saved reports
 * POST   /api/report-builder/reports                — create report
 * GET    /api/report-builder/reports/:id            — get report
 * PUT    /api/report-builder/reports/:id            — update report
 * DELETE /api/report-builder/reports/:id            — delete report
 * POST   /api/report-builder/reports/:id/pdf        — generate PDF (pro+)
 * GET    /api/report-builder/reports/:id/export-csv — export CSV
 * GET    /api/report-builder/templates              — list templates
 * POST   /api/report-builder/templates              — save template
 * DELETE /api/report-builder/templates/:id          — delete template
 * GET    /api/report-builder/data/:source           — fetch block data
 */

const express = require('express');
const router  = express.Router();
const { v4: uuidv4 } = require('uuid');
const jwt     = require('jsonwebtoken');
const path    = require('path');
const fs      = require('fs');
const multer  = require('multer');
const { query } = require('../services/snowflakeService');
const { requireAuth } = require('../middleware/requireAuth');
const { requirePlan }  = require('../middleware/requirePlan');

// Image upload for report builder blocks
const REPORT_IMG_DIR = path.join(__dirname, '../../public/uploads/report-images');
if (!fs.existsSync(REPORT_IMG_DIR)) fs.mkdirSync(REPORT_IMG_DIR, { recursive: true });

const imageUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, REPORT_IMG_DIR),
    filename: (req, file, cb) => {
      const ext  = path.extname(file.originalname).toLowerCase();
      const name = uuidv4() + ext;
      cb(null, name);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'];
    cb(null, allowed.includes(path.extname(file.originalname).toLowerCase()));
  },
});

const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-change-in-prod';
const PORT = process.env.PORT || 3000;

// ─── Helper: normalize Snowflake row (UPPER → lower) ───────────────────────
function norm(row) {
  if (!row) return row;
  const out = {};
  for (const k of Object.keys(row)) {
    out[k.toLowerCase()] = row[k];
  }
  return out;
}

// ─── System Templates ─────────────────────────────────────────────────────────
const SYSTEM_TEMPLATES = [
  {
    template_id: 'sys-monthly-performance',
    name: 'Monthly Performance',
    description: 'Ad overview, top campaigns, and budget pacing across all ad types',
    is_system: true,
    tabs: [
      {
        tabId: 'tab-1', name: 'Ad Overview',
        filters: { adType: ['SP','SB','SD','DSP'] },
        blocks: [
          { blockId: 'b1', type: 'kpi',       grid: {x:0,y:0,w:6,h:2},    metric: 'spend' },
          { blockId: 'b2', type: 'kpi',       grid: {x:6,y:0,w:6,h:2},    metric: 'sales' },
          { blockId: 'b3', type: 'kpi',       grid: {x:12,y:0,w:6,h:2},   metric: 'acos' },
          { blockId: 'b4', type: 'kpi',       grid: {x:18,y:0,w:6,h:2},   metric: 'roas' },
          { blockId: 'b5', type: 'bar_chart', grid: {x:0,y:2,w:12,h:11},  source: 'ad_performance', groupBy: 'ad_type' },
          { blockId: 'b6', type: 'table',     grid: {x:12,y:2,w:12,h:11}, source: 'campaigns', columns: ['campaign_name','spend','sales','acos'] }
        ]
      },
      {
        tabId: 'tab-2', name: 'Budget Pacing',
        filters: {},
        blocks: [
          { blockId: 'b1', type: 'kpi',   grid: {x:0,y:0,w:8,h:2},    metric: 'total_budget' },
          { blockId: 'b2', type: 'kpi',   grid: {x:8,y:0,w:8,h:2},    metric: 'total_spend' },
          { blockId: 'b3', type: 'kpi',   grid: {x:16,y:0,w:8,h:2},   metric: 'avg_pacing' },
          { blockId: 'b4', type: 'table', grid: {x:0,y:2,w:24,h:11},  source: 'budget_pacing', columns: ['campaign_name','ad_type','monthly_budget','spend_to_date','pacing_pct'] }
        ]
      }
    ],
    brand_config: { primaryColor: '#2d5a27', showFooter: true, footerText: 'Prepared by Calbridge' }
  },
  {
    template_id: 'sys-vendor-report',
    name: 'Vendor Report',
    description: 'Vendor sales trends, top ASINs, inventory, and demand forecasting',
    is_system: true,
    tabs: [
      {
        tabId: 'tab-1', name: 'Vendor Sales',
        filters: {},
        blocks: [
          { blockId: 'b1', type: 'kpi',        grid: {x:0,y:0,w:8,h:2},   metric: 'total_revenue' },
          { blockId: 'b2', type: 'kpi',        grid: {x:8,y:0,w:8,h:2},   metric: 'total_units' },
          { blockId: 'b3', type: 'line_chart', grid: {x:0,y:2,w:24,h:6},  source: 'vendor_sales', groupBy: 'date' },
          { blockId: 'b4', type: 'table',      grid: {x:0,y:8,w:24,h:5},  source: 'vendor_sales', columns: ['date','ordered_revenue','units_ordered'] }
        ]
      },
      {
        tabId: 'tab-2', name: 'Inventory & Forecasting',
        filters: {},
        blocks: [
          { blockId: 'b1', type: 'table', grid: {x:0,y:0,w:12,h:13},  source: 'inventory',   columns: ['asin','sellable_units','weeks_of_cover'] },
          { blockId: 'b2', type: 'table', grid: {x:12,y:0,w:12,h:13}, source: 'forecasting', columns: ['asin','title','mean_units','p70','p80','p90'] }
        ]
      }
    ],
    brand_config: { primaryColor: '#2d5a27', showFooter: true, footerText: 'Prepared by Calbridge' }
  },
  {
    template_id: 'sys-weekly-pacing',
    name: 'Weekly Pacing Check',
    description: 'Quick budget pacing snapshot with campaign breakdown',
    is_system: true,
    tabs: [
      {
        tabId: 'tab-1', name: 'Pacing Overview',
        filters: {},
        blocks: [
          { blockId: 'b1', type: 'kpi',       grid: {x:0,y:0,w:8,h:2},    metric: 'total_budget' },
          { blockId: 'b2', type: 'kpi',       grid: {x:8,y:0,w:8,h:2},    metric: 'total_spend' },
          { blockId: 'b3', type: 'kpi',       grid: {x:16,y:0,w:8,h:2},   metric: 'avg_pacing' },
          { blockId: 'b4', type: 'bar_chart', grid: {x:0,y:2,w:24,h:11},  source: 'budget_pacing', groupBy: 'campaign_name' }
        ]
      }
    ],
    brand_config: { primaryColor: '#2d5a27', showFooter: true, footerText: 'Prepared by Calbridge' }
  }
];

// ─── Token auth middleware (for Puppeteer JWT calls) ──────────────────────────
router.use((req, res, next) => {
  if (req.query.token) {
    try {
      const decoded = jwt.verify(req.query.token, SESSION_SECRET);
      if (!req.session) req.session = {};
      req.session.clientId = decoded.clientId;
      return next();
    } catch (e) { /* fall through to normal auth */ }
  }
  next();
});

// ─── Run DDL migrations (non-blocking startup) ────────────────────────────────
async function runMigrations() {
  const stmts = [
    `CREATE TABLE IF NOT EXISTS CALBRIDGE_PROD.APP.SAVED_REPORTS (
      report_id      VARCHAR(36)  NOT NULL PRIMARY KEY,
      client_id      VARCHAR(64)  NOT NULL,
      name           VARCHAR(255) NOT NULL DEFAULT 'Untitled Report',
      template_id    VARCHAR(36),
      global_filters VARIANT,
      tabs           VARIANT      NOT NULL,
      brand_config   VARIANT,
      created_at     TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
      updated_at     TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
    )`,
    `CREATE TABLE IF NOT EXISTS CALBRIDGE_PROD.APP.REPORT_TEMPLATES (
      template_id  VARCHAR(36)  NOT NULL PRIMARY KEY,
      client_id    VARCHAR(64),
      name         VARCHAR(255) NOT NULL,
      description  VARCHAR(500),
      tabs         VARIANT      NOT NULL,
      brand_config VARIANT,
      is_system    BOOLEAN      DEFAULT FALSE,
      created_at   TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
    )`
  ];
  for (const sql of stmts) {
    try {
      await query(sql, []);
    } catch (e) {
      console.warn('[ReportBuilder] DDL warning:', e.message);
    }
  }
}
runMigrations().catch(e => console.warn('[ReportBuilder] Migration failed:', e.message));

// ─── Data source queries ──────────────────────────────────────────────────────
async function fetchDataSource(source, clientId, params) {
  const {
    startDate = '2024-01-01',
    endDate   = new Date().toISOString().slice(0,10),
    adType    = '',
    limit     = 50,
    sortCol   = '',
    sortDir   = 'DESC',
  } = params;

  const lim = Math.min(parseInt(limit, 10) || 50, 1000);
  const adTypes = adType ? adType.split(',').map(s => s.trim()).filter(Boolean) : [];

  try {
    if (source === 'campaigns') {
      let sql = `SELECT campaign_name, ad_type, spend, sales, impressions, clicks, orders,
        CASE WHEN sales>0 THEN spend/sales ELSE NULL END AS acos,
        CASE WHEN spend>0 THEN sales/spend ELSE NULL END AS roas
        FROM CALBRIDGE_PROD.MARTS.CAMPAIGN_PERFORMANCE
        WHERE client_id=? AND date BETWEEN ? AND ?`;
      const binds = [clientId, startDate, endDate];
      if (adTypes.length) {
        sql += ` AND ad_type IN (${adTypes.map(() => '?').join(',')})`;
        binds.push(...adTypes);
      }
      sql += ` ORDER BY spend DESC LIMIT ?`;
      binds.push(lim);
      const rows = await query(sql, binds);
      return rows.map(norm);
    }

    if (source === 'ad_performance') {
      const sql = `SELECT date, SUM(spend) AS spend, SUM(sales) AS sales,
        SUM(impressions) AS impressions, SUM(clicks) AS clicks, SUM(orders) AS orders
        FROM CALBRIDGE_PROD.MARTS.AD_PERFORMANCE_DAILY
        WHERE client_id=? AND date BETWEEN ? AND ?
        GROUP BY date ORDER BY date`;
      const rows = await query(sql, [clientId, startDate, endDate]);
      return rows.map(norm);
    }

    if (source === 'vendor_sales') {
      const sql = `SELECT date, SUM(ordered_revenue) AS ordered_revenue, SUM(units_ordered) AS units_ordered
        FROM CALBRIDGE_PROD.MARTS.VENDOR_SALES_DAILY
        WHERE client_id=? AND date BETWEEN ? AND ?
        GROUP BY date ORDER BY date`;
      const rows = await query(sql, [clientId, startDate, endDate]);
      return rows.map(norm);
    }

    if (source === 'seller_sales') {
      const sql = `SELECT date, SUM(ordered_revenue) AS ordered_revenue, SUM(units_ordered) AS units_ordered
        FROM CALBRIDGE_PROD.MARTS.SELLER_SALES_DAILY
        WHERE client_id=? AND date BETWEEN ? AND ?
        GROUP BY date ORDER BY date`;
      const rows = await query(sql, [clientId, startDate, endDate]);
      return rows.map(norm);
    }

    if (source === 'inventory') {
      const sql = `SELECT asin, sellable_units, open_po_units, weeks_of_cover
        FROM CALBRIDGE_PROD.MARTS.INVENTORY_SNAPSHOT
        WHERE client_id=? ORDER BY sellable_units DESC LIMIT ?`;
      const rows = await query(sql, [clientId, lim]);
      return rows.map(norm);
    }

    if (source === 'forecasting') {
      const sql = `SELECT asin, title, mean_units, p70, p80, p90
        FROM CALBRIDGE_PROD.MARTS.VENDOR_FORECAST_SUMMARY
        WHERE client_id=? ORDER BY mean_units DESC LIMIT ?`;
      const rows = await query(sql, [clientId, lim]);
      return rows.map(norm);
    }

    if (source === 'budget_pacing') {
      // Derive pacing from BUDGET_CAMPAIGN_MAP + CAMPAIGN_PERFORMANCE for current month
      const now = new Date();
      const monthStart = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;
      const today = now.toISOString().substring(0,10);
      const daysInMonth = new Date(now.getFullYear(), now.getMonth()+1, 0).getDate();
      const daysElapsed = now.getDate();
      const sql = `
        SELECT
          m.campaign_name,
          m.ad_type,
          b.total_amount        AS monthly_budget,
          SUM(COALESCE(cp.spend,0)) AS spend_to_date,
          ${daysElapsed}        AS days_elapsed,
          ${daysInMonth}        AS days_in_month,
          CASE WHEN b.total_amount > 0
            THEN SUM(COALESCE(cp.spend,0)) / b.total_amount
            ELSE NULL END       AS pacing_pct
        FROM CALBRIDGE_PROD.APP.BUDGET_CAMPAIGN_MAP m
        JOIN CALBRIDGE_PROD.APP.CLIENT_BUDGETS b
          ON b.budget_id = m.budget_id AND b.client_id = m.client_id
        LEFT JOIN CALBRIDGE_PROD.MARTS.CAMPAIGN_PERFORMANCE cp
          ON cp.client_id = m.client_id
          AND cp.campaign_name = m.campaign_name
          AND cp.date BETWEEN ? AND ?
        WHERE m.client_id = ?
        GROUP BY m.campaign_name, m.ad_type, b.total_amount
        ORDER BY spend_to_date DESC
        LIMIT ?`;
      const rows = await query(sql, [monthStart, today, clientId, lim]);
      return rows.map(norm);
    }

    return [];
  } catch (e) {
    console.warn(`[ReportBuilder] data source ${source} error:`, e.message);
    return [];
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// GET /api/report-builder/reports — list
router.get('/reports', requireAuth, async (req, res) => {
  try {
    const rows = await query(
      `SELECT report_id, name, template_id, created_at, updated_at
       FROM CALBRIDGE_PROD.APP.SAVED_REPORTS
       WHERE client_id=? ORDER BY updated_at DESC`,
      [req.session.clientId]
    );
    res.json(rows.map(norm));
  } catch (e) {
    console.error('[ReportBuilder] list reports error:', e.message);
    res.status(500).json({ error: 'Failed to list reports' });
  }
});

// POST /api/report-builder/reports — create
router.post('/reports', requireAuth, async (req, res) => {
  try {
    const { name = 'Untitled Report', template_id, global_filters, tabs, brand_config } = req.body;
    if (!tabs) return res.status(400).json({ error: 'tabs required' });
    const report_id = uuidv4();
    await query(
      `INSERT INTO CALBRIDGE_PROD.APP.SAVED_REPORTS
       (report_id, client_id, name, template_id, global_filters, tabs, brand_config)
       SELECT ?, ?, ?, ?, PARSE_JSON(?), PARSE_JSON(?), PARSE_JSON(?)`,
      [
        report_id,
        req.session.clientId,
        name,
        template_id || null,
        JSON.stringify(global_filters || {}),
        JSON.stringify(tabs),
        JSON.stringify(brand_config || {}),
      ]
    );
    res.status(201).json({ report_id, name });
  } catch (e) {
    console.error('[ReportBuilder] create report error:', e.message);
    res.status(500).json({ error: 'Failed to create report' });
  }
});

// GET /api/report-builder/reports/:id — get one
router.get('/reports/:id', requireAuth, async (req, res) => {
  try {
    const rows = await query(
      `SELECT report_id, client_id, name, template_id, global_filters, tabs, brand_config, created_at, updated_at
       FROM CALBRIDGE_PROD.APP.SAVED_REPORTS
       WHERE report_id=? AND client_id=?`,
      [req.params.id, req.session.clientId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Report not found' });
    const r = norm(rows[0]);
    // Snowflake VARIANT columns come back as strings or objects; ensure objects
    if (typeof r.global_filters === 'string') r.global_filters = JSON.parse(r.global_filters);
    if (typeof r.tabs === 'string') r.tabs = JSON.parse(r.tabs);
    if (typeof r.brand_config === 'string') r.brand_config = JSON.parse(r.brand_config);
    res.json(r);
  } catch (e) {
    console.error('[ReportBuilder] get report error:', e.message);
    res.status(500).json({ error: 'Failed to get report' });
  }
});

// PUT /api/report-builder/reports/:id — update
router.put('/reports/:id', requireAuth, async (req, res) => {
  try {
    const { name, global_filters, tabs, brand_config } = req.body;
    const updates = [];
    const binds   = [];

    if (name !== undefined)          { updates.push('name=?');           binds.push(name); }
    if (global_filters !== undefined){ updates.push('global_filters=PARSE_JSON(?)'); binds.push(JSON.stringify(global_filters)); }
    if (tabs !== undefined)          { updates.push('tabs=PARSE_JSON(?)'); binds.push(JSON.stringify(tabs)); }
    if (brand_config !== undefined)  { updates.push('brand_config=PARSE_JSON(?)'); binds.push(JSON.stringify(brand_config)); }
    updates.push('updated_at=CURRENT_TIMESTAMP()');

    binds.push(req.params.id, req.session.clientId);
    await query(
      `UPDATE CALBRIDGE_PROD.APP.SAVED_REPORTS SET ${updates.join(',')} WHERE report_id=? AND client_id=?`,
      binds
    );
    res.json({ ok: true });
  } catch (e) {
    console.error('[ReportBuilder] update report error:', e.message);
    res.status(500).json({ error: 'Failed to update report' });
  }
});

// DELETE /api/report-builder/reports/:id — delete
router.delete('/reports/:id', requireAuth, async (req, res) => {
  try {
    await query(
      `DELETE FROM CALBRIDGE_PROD.APP.SAVED_REPORTS WHERE report_id=? AND client_id=?`,
      [req.params.id, req.session.clientId]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error('[ReportBuilder] delete report error:', e.message);
    res.status(500).json({ error: 'Failed to delete report' });
  }
});

// POST /api/report-builder/reports/:id/pdf — generate PDF (Pro+)
router.post('/reports/:id/pdf', requireAuth, requirePlan('reportingDownload'), async (req, res) => {
  let browser;
  try {
    const rows = await query(
      `SELECT report_id, client_id, name, tabs FROM CALBRIDGE_PROD.APP.SAVED_REPORTS WHERE report_id=? AND client_id=?`,
      [req.params.id, req.session.clientId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Report not found' });
    const r = norm(rows[0]);
    const tabs = typeof r.tabs === 'string' ? JSON.parse(r.tabs) : r.tabs;

    // Sign JWT for Puppeteer
    const token = jwt.sign(
      { reportId: req.params.id, clientId: req.session.clientId },
      SESSION_SECRET,
      { expiresIn: '5m' }
    );

    // Launch Puppeteer
    const chromium = require('@sparticuz/chromium');
    const puppeteer = require('puppeteer-core');
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const { PDFDocument } = require('pdf-lib');
    const masterDoc = await PDFDocument.create();
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });

    for (let i = 0; i < tabs.length; i++) {
      await page.goto(
        `http://localhost:${PORT}/reports-preview/${req.params.id}?token=${token}&tab=${i}`,
        { waitUntil: 'networkidle0', timeout: 30000 }
      );
      // Wait for report ready signal
      await page.waitForFunction(() => window.__reportReady === true, { timeout: 20000 });

      const pdfBuffer = await page.pdf({
        width: '1280px',
        height: '720px',
        printBackground: true,
        landscape: true,
      });

      const srcDoc = await PDFDocument.load(pdfBuffer);
      const copiedPages = await masterDoc.copyPages(srcDoc, srcDoc.getPageIndices());
      copiedPages.forEach(p => masterDoc.addPage(p));
    }

    await browser.close();
    browser = null;

    const mergedPdf = await masterDoc.save();
    const reportName = (r.name || 'report').replace(/[^a-z0-9\-_]/gi, '_');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${reportName}.pdf"`);
    res.send(Buffer.from(mergedPdf));
  } catch (e) {
    if (browser) try { await browser.close(); } catch {}
    console.error('[ReportBuilder] PDF error:', e.message);
    res.status(500).json({ error: 'PDF generation failed: ' + e.message });
  }
});

// GET /api/report-builder/reports/:id/export-csv — export CSV
router.get('/reports/:id/export-csv', requireAuth, async (req, res) => {
  try {
    const rows = await query(
      `SELECT tabs, global_filters FROM CALBRIDGE_PROD.APP.SAVED_REPORTS WHERE report_id=? AND client_id=?`,
      [req.params.id, req.session.clientId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Report not found' });
    const r = norm(rows[0]);
    const tabs = typeof r.tabs === 'string' ? JSON.parse(r.tabs) : r.tabs;
    const globalFilters = typeof r.global_filters === 'string' ? JSON.parse(r.global_filters) : (r.global_filters || {});

    // Get active tab index from query params (default 0)
    const tabIdx = parseInt(req.query.tab || '0', 10);
    const tab = tabs[tabIdx] || tabs[0];
    if (!tab) return res.status(400).json({ error: 'No tab found' });

    // Collect all unique data sources in this tab
    const sources = [...new Set(
      (tab.blocks || []).filter(b => b.source).map(b => b.source)
    )];

    const mergedFilters = { ...globalFilters, ...(tab.filters || {}) };
    const params = {
      startDate:  mergedFilters.startDate || req.query.startDate || '2024-01-01',
      endDate:    mergedFilters.endDate   || req.query.endDate   || new Date().toISOString().slice(0,10),
      adType:     Array.isArray(mergedFilters.adType) ? mergedFilters.adType.join(',') : (mergedFilters.adType || ''),
      limit:      1000,
    };

    // Fetch first source
    const source = sources[0] || 'ad_performance';
    const data = await fetchDataSource(source, req.session.clientId, params);

    if (!data.length) {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="report-tab${tabIdx}.csv"`);
      return res.send('No data available\n');
    }

    // Build CSV
    const headers = Object.keys(data[0]);
    const csvRows = [
      headers.join(','),
      ...data.map(row =>
        headers.map(h => {
          const v = row[h];
          if (v === null || v === undefined) return '';
          const s = String(v);
          return s.includes(',') || s.includes('"') || s.includes('\n')
            ? `"${s.replace(/"/g, '""')}"` : s;
        }).join(',')
      )
    ];

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="report-tab${tabIdx}.csv"`);
    res.send(csvRows.join('\n'));
  } catch (e) {
    console.error('[ReportBuilder] CSV export error:', e.message);
    res.status(500).json({ error: 'CSV export failed' });
  }
});

// GET /api/report-builder/templates — list templates
router.get('/templates', requireAuth, async (req, res) => {
  try {
    // Fetch client's own templates from Snowflake
    let clientTemplates = [];
    try {
      const rows = await query(
        `SELECT template_id, client_id, name, description, tabs, brand_config, is_system, created_at
         FROM CALBRIDGE_PROD.APP.REPORT_TEMPLATES
         WHERE client_id=? OR is_system=TRUE ORDER BY is_system DESC, created_at DESC`,
        [req.session.clientId]
      );
      clientTemplates = rows.map(r => {
        const n = norm(r);
        if (typeof n.tabs === 'string') n.tabs = JSON.parse(n.tabs);
        if (typeof n.brand_config === 'string') n.brand_config = JSON.parse(n.brand_config);
        return n;
      });
    } catch (e) {
      // Table may not exist yet — return system templates only
    }

    // Merge: system templates first, then client-saved ones (deduplicate sys IDs)
    const dbSysIds = new Set(clientTemplates.filter(t => t.is_system).map(t => t.template_id));
    const sysTpls  = SYSTEM_TEMPLATES.filter(t => !dbSysIds.has(t.template_id));
    const clientOwn = clientTemplates.filter(t => !t.is_system);

    res.json([...SYSTEM_TEMPLATES.map(t => ({ ...t })), ...clientOwn]);
  } catch (e) {
    console.error('[ReportBuilder] list templates error:', e.message);
    // Fallback to just system templates
    res.json(SYSTEM_TEMPLATES.map(t => ({ ...t })));
  }
});

// POST /api/report-builder/templates — save template
router.post('/templates', requireAuth, async (req, res) => {
  try {
    const { name, description, tabs, brand_config } = req.body;
    if (!name || !tabs) return res.status(400).json({ error: 'name and tabs required' });
    const template_id = uuidv4();
    await query(
      `INSERT INTO CALBRIDGE_PROD.APP.REPORT_TEMPLATES
       (template_id, client_id, name, description, tabs, brand_config, is_system)
       SELECT ?, ?, ?, ?, PARSE_JSON(?), PARSE_JSON(?), FALSE`,
      [
        template_id,
        req.session.clientId,
        name,
        description || '',
        JSON.stringify(tabs),
        JSON.stringify(brand_config || {}),
      ]
    );
    res.status(201).json({ template_id, name });
  } catch (e) {
    console.error('[ReportBuilder] create template error:', e.message);
    res.status(500).json({ error: 'Failed to save template' });
  }
});

// DELETE /api/report-builder/templates/:id — delete (client's own only)
router.delete('/templates/:id', requireAuth, async (req, res) => {
  try {
    // Never allow deleting system templates
    if (req.params.id.startsWith('sys-')) {
      return res.status(403).json({ error: 'Cannot delete system templates' });
    }
    await query(
      `DELETE FROM CALBRIDGE_PROD.APP.REPORT_TEMPLATES WHERE template_id=? AND client_id=? AND is_system=FALSE`,
      [req.params.id, req.session.clientId]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error('[ReportBuilder] delete template error:', e.message);
    res.status(500).json({ error: 'Failed to delete template' });
  }
});

// GET /api/report-builder/data/:source — fetch block data
router.get('/data/:source', requireAuth, async (req, res) => {
  try {
    const data = await fetchDataSource(req.params.source, req.session.clientId, req.query);
    res.json(data);
  } catch (e) {
    console.error('[ReportBuilder] data source error:', e.message);
    res.json([]);
  }
});

// POST /api/report-builder/upload-image — upload image for image block
router.post('/upload-image', requireAuth, imageUpload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image or unsupported file type. Allowed: png, jpg, gif, webp, svg' });
  const url = `/uploads/report-images/${req.file.filename}`;
  res.json({ ok: true, url });
});

module.exports = router;
