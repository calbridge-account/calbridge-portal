/**
 * Load cyberpower_backfill.csv into CALBRIDGE_PROD.APP.sb_campaign_report
 * and CALBRIDGE_PROD.APP.sd_campaign_report.
 *
 * CSV format: Date,Advertiser account ID,Advertiser account name,Entity ID,
 *             Type,Campaign ID,Campaign name,Budget currency,
 *             Impressions,Clicks,Total cost,Purchases (combined),Sales (combined)
 *
 * Usage: node scripts/load_backfill_csv.js [path-to-csv]
 */
'use strict';
require('dotenv').config();

const fs       = require('fs');
const path     = require('path');
const { query } = require('../src/services/snowflakeService');

const CSV_PATH  = process.argv[2] || path.join(__dirname, '../cyberpower_backfill.csv');
const CLIENT_ID = process.argv[3] || '7d88ea17-002b-4a02-97fc-bcab1292d57e';
const SCHEMA    = 'CALBRIDGE_PROD.APP';

function parseMoney(s) {
  if (!s || s === '--' || s === '') return 0;
  return parseFloat(String(s).replace(/[$,%]/g, '').replace(/,/g, '')) || 0;
}
function parseNum(s) {
  if (!s || s === '--' || s === '') return 0;
  return parseFloat(String(s).replace(/,/g, '')) || 0;
}

// Parse "1-Dec-25" or "10-Jan-26" → "2025-12-01" / "2026-01-10"
function parseDate(s) {
  if (!s) return null;
  // Try direct parse first
  const d = new Date(s.trim());
  if (!isNaN(d)) return d.toISOString().split('T')[0];
  // Try "D-Mon-YY" format
  const m = s.trim().match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2})$/);
  if (m) {
    const months = { Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12 };
    const day   = m[1].padStart(2, '0');
    const mon   = String(months[m[2]]).padStart(2, '0');
    const year  = parseInt(m[3]) >= 50 ? '19' + m[3] : '20' + m[3];
    return `${year}-${mon}-${day}`;
  }
  return null;
}

async function main() {
  const raw   = fs.readFileSync(CSV_PATH, 'utf8');
  const lines = raw.trim().split('\n');
  const header = lines[0].split(',');

  const col = {};
  header.forEach((h, i) => { col[h.trim()] = i; });

  console.log('Columns detected:', Object.keys(col).join(', '));
  console.log('Total data rows:', lines.length - 1);

  // Fetch existing profile_id for this client (needed for SB MERGE key)
  const profileRows = await query(
    `SELECT DISTINCT profile_id FROM CALBRIDGE_PROD.APP.sb_campaign_report WHERE client_id = ? LIMIT 1`,
    [CLIENT_ID]
  );
  const profileId = profileRows[0]?.PROFILE_ID || profileRows[0]?.profile_id || '';
  console.log('Using profile_id:', profileId);

  let sbWritten = 0, sdWritten = 0, sbSkipped = 0, sdSkipped = 0;

  for (let i = 1; i < lines.length; i++) {
    const f = lines[i].split(',');
    if (f.length < 10) continue;

    const dateStr    = f[col['Date']]?.trim();
    const type       = f[col['Type']]?.trim();
    const campaignId = f[col['Campaign ID']]?.trim();
    const campaignNm = f[col['Campaign name']]?.trim();
    const impressions = parseNum(f[col['Impressions']]);
    const clicks      = parseNum(f[col['Clicks']]);
    const cost        = parseMoney(f[col['Total cost']]);
    const purchases   = parseNum(f[col['Purchases (combined)']]);
    const sales       = parseMoney(f[col['Sales (combined)']]);
    const reportDate  = parseDate(dateStr);

    if (!reportDate || !campaignId || !type) {
      console.warn(`  Row ${i}: skipping — missing date/campaign/type (date=${dateStr}, type=${type}, id=${campaignId})`);
      continue;
    }

    if (type === 'SB') {
      try {
        await query(`
          MERGE INTO ${SCHEMA}.sb_campaign_report t
          USING (SELECT ? AS client_id, ? AS campaign_id, ? AS report_date) s
            ON t.client_id = s.client_id
            AND t.campaign_id = s.campaign_id
            AND t.report_date = s.report_date
          WHEN MATCHED THEN UPDATE SET
            impressions   = ?,
            clicks        = ?,
            cost          = ?,
            sales         = ?,
            purchases     = ?,
            synced_at     = CURRENT_TIMESTAMP()
          WHEN NOT MATCHED THEN INSERT
            (client_id, profile_id, campaign_id, campaign_name, report_date,
             impressions, clicks, cost, sales, purchases, synced_at)
          VALUES
            (?, ?, ?, ?, ?,  ?, ?, ?, ?, ?,  CURRENT_TIMESTAMP())
        `, [
          CLIENT_ID, campaignId, reportDate,
          impressions, clicks, cost, sales, purchases,
          CLIENT_ID, profileId, campaignId, campaignNm, reportDate,
          impressions, clicks, cost, sales, purchases,
        ]);
        sbWritten++;
      } catch (e) {
        console.error(`  SB row ${i} error: ${e.message.substring(0, 100)}`);
        sbSkipped++;
      }
    } else if (type === 'SD') {
      try {
        await query(`
          MERGE INTO ${SCHEMA}.sd_campaign_report t
          USING (SELECT ? AS client_id, ? AS campaign_id, ? AS date) s
            ON t.client_id = s.client_id
            AND t.campaign_id = s.campaign_id
            AND t.date = s.date
          WHEN MATCHED THEN UPDATE SET
            impressions   = ?,
            clicks        = ?,
            cost          = ?,
            sales         = ?,
            purchases     = ?,
            synced_at     = CURRENT_TIMESTAMP()
          WHEN NOT MATCHED THEN INSERT
            (client_id, profile_id, campaign_id, campaign_name, date,
             impressions, clicks, cost, sales, purchases, synced_at)
          VALUES
            (?, ?, ?, ?, ?,  ?, ?, ?, ?, ?,  CURRENT_TIMESTAMP())
        `, [
          CLIENT_ID, campaignId, reportDate,
          impressions, clicks, cost, sales, purchases,
          CLIENT_ID, profileId, campaignId, campaignNm, reportDate,
          impressions, clicks, cost, sales, purchases,
        ]);
        sdWritten++;
      } catch (e) {
        console.error(`  SD row ${i} error: ${e.message.substring(0, 100)}`);
        sdSkipped++;
      }
    }

    if ((sbWritten + sdWritten) % 100 === 0 && (sbWritten + sdWritten) > 0) {
      process.stdout.write(`\r  Progress: SB=${sbWritten} SD=${sdWritten} skipped=${sbSkipped+sdSkipped}`);
    }
  }

  console.log(`\n\n✅ Done`);
  console.log(`  SB: ${sbWritten} written, ${sbSkipped} skipped`);
  console.log(`  SD: ${sdWritten} written, ${sdSkipped} skipped`);

  // Verify totals
  const sbCheck = await query(
    `SELECT SUM(cost) as total FROM ${SCHEMA}.sb_campaign_report WHERE client_id = ? AND report_date < '2026-02-07'`,
    [CLIENT_ID]
  );
  const sdCheck = await query(
    `SELECT SUM(cost) as total FROM ${SCHEMA}.sd_campaign_report WHERE client_id = ? AND date < '2026-01-29'`,
    [CLIENT_ID]
  );
  console.log(`\n  SB pre-Feb-7 total in DB: $${Number(sbCheck[0]?.TOTAL || 0).toFixed(2)} (expected ~$279,869.76)`);
  console.log(`  SD pre-Jan-29 total in DB: $${Number(sdCheck[0]?.TOTAL || 0).toFixed(2)} (expected ~$114,391.41)`);

  process.exit(0);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
