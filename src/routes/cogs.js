const express = require('express');
const router = express.Router();
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const { requireAuth } = require('../middleware/requireAuth');
const { query } = require('../services/snowflakeService');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    cb(null, file.originalname.toLowerCase().endsWith('.csv'));
  }
});

/**
 * GET /cogs/template
 * Download the COGS CSV template
 */
router.get('/template', requireAuth, async (req, res) => {
  // Pull existing COGS data to pre-populate template
  const rows = await query(`
    SELECT asin, sku, cogs FROM products WHERE client_id = ? ORDER BY asin
  `, [req.session.clientId]).catch(() => []);

  const header = [
    '# CalBridge COGS Upload Template',
    '# ',
    '# IMPORTANT: COGS should be your production/landed cost ONLY.',
    '# Do NOT include any Amazon-specific expenses such as:',
    '#   - FBA fulfillment fees',
    '#   - Amazon referral fees',
    '#   - Shipping from Amazon warehouse to customer',
    '#   - Storage fees',
    '# These are already deducted separately by the system.',
    '# ',
    '# Required columns: SKU, COGS_USD',
    '# Optional columns: ASIN, NOTES',
    '# ',
    'SKU,ASIN,COGS_USD,NOTES'
  ].join('\n');

  const dataRows = rows.length
    ? rows.map(r => `${r.SKU || ''},${r.ASIN || ''},${r.COGS || ''},""`).join('\n')
    : [
        'EXAMPLE-SKU-001,B00EXAMPLE1,8.50,"Example: widget costs $8.50 to manufacture and ship to Amazon"',
        'EXAMPLE-SKU-002,B00EXAMPLE2,12.00,"Example: product costs $12.00 landed cost"'
      ].join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="calbridge-cogs-template.csv"');
  res.send(header + '\n' + dataRows);
});

/**
 * POST /cogs/upload
 * Upload and process COGS CSV
 */
router.post('/upload', requireAuth, upload.single('cogs'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Please upload a CSV file' });

    const csvText = req.file.buffer.toString('utf8');

    // Strip comment lines before parsing
    const stripped = csvText
      .split('\n')
      .filter(line => !line.trim().startsWith('#'))
      .join('\n');

    let records;
    try {
      records = parse(stripped, {
        columns: true,
        skip_empty_lines: true,
        trim: true
      });
    } catch (parseErr) {
      return res.status(400).json({ error: `CSV parse error: ${parseErr.message}` });
    }

    if (!records.length) return res.status(400).json({ error: 'No data rows found in CSV' });

    // Validate required columns
    const first = records[0];
    const hasSku  = 'SKU' in first || 'sku' in first;
    const hasCogs = 'COGS_USD' in first || 'cogs_usd' in first || 'COGS' in first || 'cogs' in first;
    if (!hasSku || !hasCogs) {
      return res.status(400).json({ error: 'CSV must have SKU and COGS_USD columns' });
    }

    const errors = [];
    let updated = 0;

    for (const row of records) {
      const sku  = (row.SKU || row.sku || '').trim();
      const asin = (row.ASIN || row.asin || '').trim();
      const cogsRaw = row.COGS_USD || row.cogs_usd || row.COGS || row.cogs || '';
      const cogs = parseFloat(String(cogsRaw).replace(/[$,]/g, ''));

      if (!sku) { errors.push(`Row skipped: missing SKU`); continue; }
      if (isNaN(cogs) || cogs < 0) { errors.push(`${sku}: invalid COGS value "${cogsRaw}"`); continue; }

      // Update by SKU (and ASIN if provided)
      if (asin) {
        await query(`
          MERGE INTO products t
          USING (SELECT ? AS client_id, ? AS asin) s
          ON t.client_id = s.client_id AND t.asin = s.asin
          WHEN MATCHED THEN UPDATE SET sku = ?, cogs = ?, synced_at = CURRENT_TIMESTAMP
          WHEN NOT MATCHED THEN INSERT (client_id, connection_type, asin, sku, cogs, synced_at)
            VALUES (?, 'seller', ?, ?, ?, CURRENT_TIMESTAMP)
        `, [req.session.clientId, asin, sku, cogs, req.session.clientId, asin, sku, cogs]);
      } else {
        // Update by SKU only
        await query(`
          UPDATE products SET sku = ?, cogs = ?, synced_at = CURRENT_TIMESTAMP
          WHERE client_id = ? AND sku = ?
        `, [sku, cogs, req.session.clientId, sku]);
      }
      updated++;
    }

    // Recalculate contribution margin with new COGS
    const { calculateContributionMargin } = require('../jobs/contributionMargin');
    calculateContributionMargin(req.session.clientId, 90).catch(err =>
      console.error('[COGS] CM recalc error:', err.message)
    );

    res.json({
      message: `COGS uploaded successfully`,
      updated,
      errors: errors.length ? errors : undefined,
      note: 'Contribution margin is being recalculated in the background.'
    });
  } catch (err) { next(err); }
});

/**
 * GET /cogs/current
 * Get current COGS data for the client
 */
router.get('/current', requireAuth, async (req, res, next) => {
  try {
    const rows = await query(`
      SELECT asin, sku, title, cogs, fba_fees, price
      FROM products
      WHERE client_id = ? AND cogs IS NOT NULL
      ORDER BY asin
    `, [req.session.clientId]);
    res.json(rows);
  } catch (err) { next(err); }
});

module.exports = router;
