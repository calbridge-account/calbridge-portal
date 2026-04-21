#!/usr/bin/env node
/**
 * Scrape Amazon product pages to fill in TITLE and MODEL_NUMBER
 * for CyberPower vendor ASINs missing this data.
 *
 * Uses public amazon.com/dp/{ASIN} pages via node-fetch with
 * browser-like headers + cookies to avoid bot detection.
 * Rate-limited to 1 req/3s.
 */

require('dotenv').config();
const https  = require('https');
const { query } = require('../src/services/snowflakeService');

const CLIENT_ID = '7d88ea17-002b-4a02-97fc-bcab1292d57e';
const DELAY_MS  = 3000;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const opts = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.6367.82 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'max-age=0',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1',
      },
      timeout: 20000,
    };
    const req = https.get(url, opts, (res) => {
      // Handle gzip
      let body = '';
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve({ status: res.statusCode, html: buf.toString('utf8'), url });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function parseProductPage(html) {
  let title = null;
  let model = null;

  // Title — try productTitle span first
  const titleMatch = html.match(/<span[^>]+id=["']productTitle["'][^>]*>\s*([\s\S]*?)\s*<\/span>/i);
  if (titleMatch) {
    title = titleMatch[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  }

  // Fallback: og:title / page <title> (strip " - Amazon.com" suffix)
  if (!title) {
    const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
            || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
    if (og) title = og[1].replace(/[\s:|-]+Amazon\.com.*$/i, '').trim();
  }
  if (!title) {
    const pageTitle = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (pageTitle) {
      title = pageTitle[1].replace(/[\s:|-]+Amazon\.com.*$/i, '').replace(/\s+/g, ' ').trim();
      if (title.length < 5 || /amazon\.com/i.test(title)) title = null;
    }
  }

  // Model number — try JSON-LD and tech detail table patterns
  const modelPatterns = [
    /"itemModelNumber"\s*:\s*"([^"]{2,60})"/i,
    /"modelNumber"\s*:\s*"([^"]{2,60})"/i,
    /"partNumber"\s*:\s*"([^"]{2,60})"/i,
    /<th[^>]*>\s*(?:Model Number|Item model number)\s*<\/th>[\s\S]*?<td[^>]*>\s*<span[^>]*>([^<]{2,60})<\/span>/i,
    /<th[^>]*>\s*(?:Model Number|Item model number)\s*<\/th>[\s\S]*?<td[^>]*>\s*([^<]{2,60})\s*<\/td>/i,
  ];
  for (const pat of modelPatterns) {
    const m = html.match(pat);
    if (m) {
      model = m[1].replace(/\s+/g, ' ').trim();
      if (model.length < 2) model = null;
      else break;
    }
  }

  return { title, model };
}

async function main() {
  const rows = await query(`
    SELECT DISTINCT asin FROM CALBRIDGE_PROD.APP.PRODUCTS
    WHERE client_id = '${CLIENT_ID}'
      AND (title IS NULL OR title = '')
    ORDER BY asin
  `);

  const asins = rows.map(r => r.ASIN);
  console.log(`[backfill] ${asins.length} ASINs to enrich\n`);

  let updated = 0, failed = 0, skipped = 0;

  for (let i = 0; i < asins.length; i++) {
    const asin = asins[i];
    process.stdout.write(`[${i+1}/${asins.length}] ${asin} ... `);

    try {
      const { status, html } = await fetchUrl(`https://www.amazon.com/dp/${asin}`);

      if (status !== 200 || html.length < 10000) {
        // Bot-blocked or redirect — try with /gp/product/ path
        const r2 = await fetchUrl(`https://www.amazon.com/gp/product/${asin}`);
        if (r2.html.length < 10000) {
          console.log(`bot-blocked (${html.length} bytes)`);
          skipped++;
          await sleep(DELAY_MS * 2);
          continue;
        }
      }

      const { title, model } = parseProductPage(html);

      if (!title) {
        console.log(`no title (${html.length} bytes)`);
        skipped++;
      } else {
        const setClauses = ['title = ?'];
        const params = [title];
        if (model) { setClauses.push('model_number = ?'); params.push(model); }
        params.push(CLIENT_ID, asin);

        await query(
          `UPDATE CALBRIDGE_PROD.APP.PRODUCTS SET ${setClauses.join(', ')} WHERE client_id = ? AND asin = ?`,
          params
        );
        console.log(`✅ "${title.substring(0, 60)}"${model ? ` [${model}]` : ''}`);
        updated++;
      }
    } catch (e) {
      console.log(`ERROR: ${e.message.substring(0, 80)}`);
      failed++;
    }

    if (i < asins.length - 1) await sleep(DELAY_MS);
  }

  console.log(`\n[backfill] Done — updated: ${updated}, skipped: ${skipped}, errors: ${failed}`);

  // Final stats
  const stats = await query(`
    SELECT COUNT(*) as total,
      COUNT(CASE WHEN title IS NOT NULL AND title != '' THEN 1 END) as has_title,
      COUNT(CASE WHEN model_number IS NOT NULL AND model_number != '' THEN 1 END) as has_model
    FROM CALBRIDGE_PROD.APP.PRODUCTS WHERE client_id = '${CLIENT_ID}'
  `);
  console.log('Final stats:', JSON.stringify(stats[0]));
  process.exit(0);
}

main().catch(e => { console.error(e.message); process.exit(1); });
