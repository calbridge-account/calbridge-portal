/**
 * Import SB Campaign report CSV from Amazon Advertising console.
 * Usage: node scripts/import_sb_csv.js <path-to-csv> [client_id]
 *
 * The CSV has these columns (tab or comma separated):
 * Date, Portfolio name, Currency, Campaign Name, Cost type, Country,
 * Impressions, Clicks, CTR, CPC, Spend, ACOS, ROAS,
 * 14 Day Total Sales, 14 Day Total Orders (#), 14 Day Total Units (#),
 * 14 Day Conversion Rate, Viewable Impressions, VCPM, VTR, vCTR,
 * Video First/Mid/Third/Complete/Unmutes, 5 Second Views/Rate,
 * 14 Day Branded Searches, 14 Day Detail Page Views (DPV),
 * 14 Day New-to-brand Orders (#), 14 Day % of Orders New-to-brand,
 * 14 Day New-to-brand Sales, ...
 */

'use strict';
require('dotenv').config();

const fs   = require('fs');
const path = require('path');
const { query } = require('../src/services/snowflakeService');

const CLIENT_ID  = process.argv[3] || '7d88ea17-002b-4a02-97fc-bcab1292d57e';
const CSV_PATH   = process.argv[2];
const SCHEMA     = 'CALBRIDGE_PROD.APP';

if (!CSV_PATH) {
  console.error('Usage: node scripts/import_sb_csv.js <path-to-csv> [client_id]');
  process.exit(1);
}

// Parse money strings like "$1,234.56" or "1234.56" or "0.00" → number
function parseMoney(s) {
  if (s == null || s === '' || s === '--') return null;
  return parseFloat(String(s).replace(/[$,%]/g, '').replace(/,/g, '')) || 0;
}

function parseNum(s) {
  if (s == null || s === '' || s === '--') return null;
  return parseFloat(String(s).replace(/,/g, '')) || 0;
}

// Parse "Jan 11, 2026" → "2026-01-11"
function parseDate(s) {
  if (!s) return null;
  const d = new Date(s.trim());
  if (isNaN(d)) return null;
  return d.toISOString().split('T')[0];
}

// Parse tab-separated or comma-separated, handling quoted fields
function parseLine(line, delim) {
  const result = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQ = !inQ; }
    else if (c === delim && !inQ) { result.push(cur.trim()); cur = ''; }
    else { cur += c; }
  }
  result.push(cur.trim());
  return result;
}

async function main() {
  const raw = fs.readFileSync(CSV_PATH, 'utf8');
  const lines = raw.split('\n').filter(l => l.trim());

  // Detect delimiter
  const delim = lines[0].includes('\t') ? '\t' : ',';
  const headers = parseLine(lines[0], delim);
  console.log(`Detected ${lines.length - 1} data rows, delimiter: ${delim === '\t' ? 'TAB' : 'COMMA'}`);
  console.log('Headers:', headers.join(' | '));

  // Build column index map
  const col = {};
  headers.forEach((h, i) => { col[h.trim()] = i; });

  // Fetch existing campaign name → campaign_id mapping from Snowflake
  console.log('\nFetching existing campaign ID mappings...');
  const existing = await query(
    `SELECT DISTINCT campaign_name, campaign_id, profile_id
     FROM ${SCHEMA}.SB_CAMPAIGN_REPORT
     WHERE client_id = ?`,
    [CLIENT_ID]
  );
  const nameToId     = {};
  const nameToProfile = {};
  for (const r of existing) {
    const name = (r.CAMPAIGN_NAME || r.campaign_name || '').trim();
    if (name) {
      nameToId[name]      = r.CAMPAIGN_ID     || r.campaign_id;
      nameToProfile[name] = r.PROFILE_ID      || r.profile_id;
    }
  }
  console.log(`Found ${Object.keys(nameToId).length} known campaigns`);

  // Parse rows
  const rows = [];
  const unknown = new Set();
  for (let i = 1; i < lines.length; i++) {
    const f = parseLine(lines[i], delim);
    if (f.length < 5) continue;

    const date         = parseDate(f[col['Date']]);
    const campaignName = (f[col['Campaign Name']] || '').trim();
    if (!date || !campaignName) continue;

    const campaignId = nameToId[campaignName] || null;
    const profileId  = nameToProfile[campaignName] || null;

    if (!campaignId) {
      unknown.add(campaignName);
    }

    rows.push({
      date,
      campaignName,
      campaignId,
      profileId,
      impressions:           parseNum(f[col['Impressions']]),
      clicks:                parseNum(f[col['Clicks']]),
      cost:                  parseMoney(f[col['Spend']]),
      sales:                 parseMoney(f[col['14 Day Total Sales']]),
      purchases:             parseNum(f[col['14 Day Total Orders (#)']]),
      unitsSold:             parseNum(f[col['14 Day Total Units (#)']]),
      viewableImpressions:   parseNum(f[col['Viewable Impressions']]),
      newToBrandPurchases:   parseNum(f[col['14 Day New-to-brand Orders (#)']]),
      newToBrandSales:       parseMoney(f[col['14 Day New-to-brand Sales']]),
      detailPageViews:       parseNum(f[col['14 Day Detail Page Views (DPV)']]),
      brandedSearches:       parseNum(f[col['14 Day Branded Searches']]),
      videoComplete:         parseNum(f[col['Video Complete Views']]),
      videoFirstQ:           parseNum(f[col['Video First Quartile Views']]),
      videoMidpoint:         parseNum(f[col['Video Midpoint Views']]),
      videoThirdQ:           parseNum(f[col['Video Third Quartile Views']]),
      videoUnmutes:          parseNum(f[col['Video Unmutes']]),
      video5sec:             parseNum(f[col['5 Second Views']]),
    });
  }

  console.log(`\nParsed ${rows.length} rows`);
  if (unknown.size > 0) {
    console.warn(`\n⚠️  ${unknown.size} campaign names not found in existing data (will insert with NULL campaign_id):`);
    [...unknown].slice(0, 10).forEach(n => console.warn('  -', n));
    if (unknown.size > 10) console.warn(`  ... and ${unknown.size - 10} more`);
  }

  // Write to sb_campaign_report via MERGE
  console.log('\nWriting to Snowflake...');
  let written = 0;
  let skipped = 0;

  for (const r of rows) {
    // Skip rows where we have no campaign_id and the date already exists
    // (would create orphan rows — better to skip and warn)
    if (!r.campaignId) {
      skipped++;
      continue;
    }

    try {
      await query(`
        MERGE INTO ${SCHEMA}.SB_CAMPAIGN_REPORT t
        USING (SELECT ? AS client_id, ? AS campaign_id, ? AS report_date) s
        ON t.client_id = s.client_id AND t.campaign_id = s.campaign_id AND t.report_date = s.report_date
        WHEN MATCHED THEN UPDATE SET
          impressions             = ?,
          clicks                  = ?,
          cost                    = ?,
          sales                   = ?,
          purchases               = ?,
          units_sold              = ?,
          viewable_impressions    = ?,
          new_to_brand_purchases  = ?,
          new_to_brand_sales      = ?,
          detail_page_views       = ?,
          branded_searches        = ?,
          video_complete_views    = ?,
          video_first_quartile_views = ?,
          video_midpoint_views    = ?,
          video_third_quartile_views = ?,
          video_unmutes           = ?,
          synced_at               = CURRENT_TIMESTAMP()
        WHEN NOT MATCHED THEN INSERT
          (client_id, profile_id, campaign_id, report_date, campaign_name,
           impressions, clicks, cost, sales, purchases, units_sold,
           viewable_impressions, new_to_brand_purchases, new_to_brand_sales,
           detail_page_views, branded_searches,
           video_complete_views, video_first_quartile_views, video_midpoint_views,
           video_third_quartile_views, video_unmutes, synced_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP())
      `, [
        // MERGE key
        CLIENT_ID, r.campaignId, r.date,
        // UPDATE
        r.impressions, r.clicks, r.cost, r.sales, r.purchases, r.unitsSold,
        r.viewableImpressions, r.newToBrandPurchases, r.newToBrandSales,
        r.detailPageViews, r.brandedSearches,
        r.videoComplete, r.videoFirstQ, r.videoMidpoint, r.videoThirdQ, r.videoUnmutes,
        // INSERT
        CLIENT_ID, r.profileId, r.campaignId, r.date, r.campaignName,
        r.impressions, r.clicks, r.cost, r.sales, r.purchases, r.unitsSold,
        r.viewableImpressions, r.newToBrandPurchases, r.newToBrandSales,
        r.detailPageViews, r.brandedSearches,
        r.videoComplete, r.videoFirstQ, r.videoMidpoint, r.videoThirdQ, r.videoUnmutes,
      ]);
      written++;
      if (written % 50 === 0) process.stdout.write(`\r  ${written}/${rows.length - skipped} rows written...`);
    } catch (err) {
      console.error(`\nError on row ${i} (${r.campaignName} ${r.date}):`, err.message);
    }
  }

  console.log(`\n\n✅ Done — ${written} rows written, ${skipped} skipped (no campaign_id match)`);

  if (skipped > 0) {
    console.log('\nTo handle skipped rows, run the import again after the next scheduled ads pull,');
    console.log('which will populate campaign IDs for any new campaigns.');
  }

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
