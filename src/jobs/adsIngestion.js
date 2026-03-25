/**
 * Amazon Advertising API ingestion
 * Covers: Amazon Ads (Sponsored Products/Brands/Display) + DSP
 *
 * ASIN-level attribution (updated):
 *   - SP/SB/SD: use advertisedAsin from ad-level reports (direct attribution)
 *   - DSP: use product targeting / creative report asin field
 *   - If no ASIN on a record: bucket as "UNATTRIBUTED"
 *   - No proportional splitting — each ad row owns its own spend
 *
 * Sandbox base URL: https://advertising-api-test.amazon.com
 * Production base URL: https://advertising-api.amazon.com (NA)
 */
require('dotenv').config();
const axios = require('axios');
const { query } = require('../services/snowflakeService');
const { getValidToken } = require('../services/amazonAuthService');
const { runJob } = require('./ingestionRunner');

const IS_SANDBOX = process.env.NODE_ENV !== 'production';
const ADS_API_BASE = IS_SANDBOX
  ? 'https://advertising-api-test.amazon.com'
  : 'https://advertising-api.amazon.com';

/**
 * Build authenticated Axios instance for Advertising API
 */
async function adsClient(clientId, connectionType) {
  const accessToken = await getValidToken(clientId, connectionType);
  return axios.create({
    baseURL: ADS_API_BASE,
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Amazon-Advertising-API-ClientId': process.env.LWA_CLIENT_ID,
      'Content-Type': 'application/json'
    }
  });
}

/**
 * Fetch all advertising profiles for a client
 * A profile = one marketplace/account combination
 */
async function fetchProfiles(clientId, connectionType) {
  const client = await adsClient(clientId, connectionType);
  const res = await client.get('/v2/profiles');
  return res.data || [];
}

/**
 * Fetch campaigns for a profile
 */
async function fetchCampaigns(client, profileId, connectionType) {
  const res = await client.get('/v2/campaigns', {
    headers: { 'Amazon-Advertising-API-Scope': profileId },
    params: { stateFilter: 'enabled,paused,archived', count: 100 }
  });
  return res.data || [];
}

/**
 * Request a v3 async report for a given ad product and report type.
 * Uses the /reporting/reports endpoint (replaces deprecated v2 report endpoints).
 */
async function requestV3Report(client, profileId, startDate, reportTypeId, adProduct, groupBy, columns) {
  try {
    const res = await client.post('/reporting/reports', {
      name:      `${adProduct} ${reportTypeId} ${startDate}`,
      startDate,
      endDate:   startDate,
      configuration: {
        adProduct,
        groupBy,
        columns,
        reportTypeId,
        timeUnit: 'DAILY',
        format:   'GZIP_JSON'
      }
    }, {
      headers: {
        'Amazon-Advertising-API-Scope': profileId,
        'Content-Type': 'application/vnd.createasyncreportrequest.v3+json',
        'Accept':        'application/vnd.createasyncreportrequest.v3+json'
      },
      transformRequest: [(data, headers) => {
        headers['Content-Type'] = 'application/vnd.createasyncreportrequest.v3+json';
        return JSON.stringify(data);
      }]
    });
    return res.data?.reportId;
  } catch (err) {
    // 425 = duplicate request — Amazon returns the existing report ID in the detail message
    if (err.response?.status === 425) {
      const match = err.response?.data?.detail?.match(/duplicate of\s*:\s*([\w-]+)/i);
      if (match?.[1]) {
        console.log(`[Ads] Reusing existing report ${match[1]} for ${adProduct} ${startDate}`);
        return match[1];
      }
    }
    throw err;
  }
}

async function requestSPReport(client, profileId, reportDate) {
  const date = `${reportDate.substring(0,4)}-${reportDate.substring(4,6)}-${reportDate.substring(6,8)}`;
  return requestV3Report(client, profileId, date, 'spCampaigns', 'SPONSORED_PRODUCTS',
    ['campaign'],
    // Validated against API 2026-03-25
    ['campaignId','campaignName','impressions','clicks','cost',
     'purchases30d','sales30d','unitsSoldClicks30d']
  );
}

async function requestSBReport(client, profileId, reportDate) {
  const date = `${reportDate.substring(0,4)}-${reportDate.substring(4,6)}-${reportDate.substring(6,8)}`;
  return requestV3Report(client, profileId, date, 'sbCampaigns', 'SPONSORED_BRANDS',
    ['campaign'],
    // Validated against API 2026-03-25 (NTB no window suffix at campaign level)
    ['campaignId','campaignName','impressions','clicks','cost',
     'purchases','sales','unitsSold',
     'newToBrandPurchases','newToBrandSales','newToBrandUnitsSold']
  );
}

async function requestSDReport(client, profileId, reportDate) {
  const date = `${reportDate.substring(0,4)}-${reportDate.substring(4,6)}-${reportDate.substring(6,8)}`;
  return requestV3Report(client, profileId, date, 'sdCampaigns', 'SPONSORED_DISPLAY',
    ['campaign'],
    // Validated against API 2026-03-25
    ['campaignId','campaignName','impressions','clicks','cost',
     'purchases','sales']
  );
}

/**
 * Poll v3 report for completion and download (GZIP_JSON → parsed array)
 */
async function downloadReport(client, profileId, reportId, maxWaitMs = 300000) {
  const zlib = require('zlib');
  const start = Date.now();
  let pollCount = 0;
  while (Date.now() - start < maxWaitMs) {
    const res = await client.get(`/reporting/reports/${reportId}`, {
      headers: { 'Amazon-Advertising-API-Scope': profileId }
    });
    const { status, url } = res.data;
    if (status === 'COMPLETED' && url) {
      const download = await axios.get(url, { responseType: 'arraybuffer' });
      const decompressed = zlib.gunzipSync(Buffer.from(download.data));
      return JSON.parse(decompressed.toString('utf8'));
    }
    if (status === 'FAILURE') throw new Error(`Report ${reportId} failed: ${res.data.failureReason || 'unknown'}`);
    if (status === 'PENDING' || status === 'PROCESSING') {
      pollCount++;
      // Back off: 8s for first 10 polls, 15s after that
      const delay = pollCount <= 10 ? 8000 : 15000;
      await new Promise(r => setTimeout(r, delay));
      continue;
    }
    throw new Error(`Report ${reportId} unknown status: ${status}`);
  }
  throw new Error(`Report ${reportId} timed out after ${maxWaitMs/1000}s`);
}

/**
 * Upsert campaigns into Snowflake
 */
async function writeCampaigns(clientId, connectionType, profileId, campaigns) {
  if (!campaigns.length) return 0;
  let written = 0;
  for (const c of campaigns) {
    await query(`
      MERGE INTO ad_campaigns t
      USING (SELECT ? AS client_id, ? AS connection_type, ? AS campaign_id) s
      ON t.client_id = s.client_id AND t.connection_type = s.connection_type AND t.campaign_id = s.campaign_id
      WHEN MATCHED THEN UPDATE SET
        campaign_name = ?, campaign_type = ?, status = ?,
        budget = ?, budget_type = ?, synced_at = CURRENT_TIMESTAMP
      WHEN NOT MATCHED THEN INSERT
        (client_id, connection_type, campaign_id, campaign_name, campaign_type, status, budget, budget_type, synced_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `, [
      clientId, connectionType, String(c.campaignId),
      c.name, c.campaignType, c.state,
      c.dailyBudget || null, c.budgetType || null,
      clientId, connectionType, String(c.campaignId),
      c.name, c.campaignType, c.state,
      c.dailyBudget || null, c.budgetType || null
    ]);
    written++;
  }
  return written;
}

/**
 * Ensure the ad_performance table has the advertised_asin column.
 * Safe to call multiple times — uses ADD COLUMN IF NOT EXISTS pattern.
 *
 * Also ensures ntb_orders and ntb_sales columns exist for Sponsored Brands NTB data.
 */
async function ensureAdPerformanceSchema() {
  // Snowflake supports ADD COLUMN IF NOT EXISTS in newer versions.
  // Using a try/catch per-column for compatibility with older account tiers.
  const alterStatements = [
    `ALTER TABLE ad_performance ADD COLUMN IF NOT EXISTS advertised_asin VARCHAR(20)`,
    `ALTER TABLE ad_performance ADD COLUMN IF NOT EXISTS ntb_orders    NUMBER`,
    `ALTER TABLE ad_performance ADD COLUMN IF NOT EXISTS ntb_sales     FLOAT`,
    `ALTER TABLE ad_performance ADD COLUMN IF NOT EXISTS ntb_units     NUMBER`
  ];
  for (const sql of alterStatements) {
    try {
      await query(sql);
    } catch (err) {
      // Column likely already exists — ignore duplicate column errors
      if (!err.message?.includes('already exists') && !err.message?.includes('duplicate')) {
        console.warn(`[ensureAdPerformanceSchema] ${err.message}`);
      }
    }
  }
}

/**
 * Upsert performance data into Snowflake with ASIN-level attribution.
 *
 * Each row in `rows` should have:
 *   - campaignId, cost/spend, attributedSales*, clicks, impressions, units
 *   - advertisedAsin (from SP/SD ad-level report) OR null for brand awareness/DSP
 *   - ntbOrders, ntbSales, ntbUnits (SB only)
 *
 * The MERGE key includes advertised_asin so the same campaign on the same date
 * can have multiple rows — one per ASIN targeted.
 *
 * Records with no ASIN use 'UNATTRIBUTED' as the bucket.
 */
async function writePerformance(clientId, connectionType, reportDate, rows) {
  if (!rows.length) return 0;
  let written = 0;
  for (const r of rows) {
    // v3 validated field names (confirmed 2026-03-25)
    // SP: purchases30d, sales30d, unitsSoldClicks30d
    // SB: purchases, sales, unitsSold, newToBrandPurchases, newToBrandSales, newToBrandUnitsSold
    // SD: purchases, sales
    const spend       = r.cost || 0;
    const sales       = r.sales30d || r.sales || 0;
    const clicks      = r.clicks || 0;
    const impressions = r.impressions || 0;
    const orders      = r.purchases30d || r.purchases || 0;
    const units       = r.unitsSoldClicks30d || r.unitsSold || orders;
    const acos        = sales > 0 ? spend / sales : null;
    const roas        = spend > 0 ? sales / spend : null;
    const ctr         = impressions > 0 ? clicks / impressions : null;
    const cpc         = clicks > 0 ? spend / clicks : null;

    // Campaign-level v3 reports don't include advertisedAsin
    const advertisedAsin = r.advertisedAsin || 'UNATTRIBUTED';

    // NTB metrics — SB only, no window suffix
    const ntbOrders = r.newToBrandPurchases || null;
    const ntbSales  = r.newToBrandSales     || null;
    const ntbUnits  = r.newToBrandUnitsSold || null;

    await query(`
      MERGE INTO ad_performance t
      USING (SELECT ? AS client_id, ? AS connection_type, ? AS campaign_id,
                    ? AS report_date, ? AS advertised_asin) s
      ON  t.client_id       = s.client_id
      AND t.connection_type = s.connection_type
      AND t.campaign_id     = s.campaign_id
      AND t.report_date     = s.report_date
      AND COALESCE(t.advertised_asin, 'UNATTRIBUTED') = s.advertised_asin
      WHEN MATCHED THEN UPDATE SET
        impressions     = ?,
        clicks          = ?,
        spend           = ?,
        sales           = ?,
        orders          = ?,
        units_sold      = ?,
        acos            = ?,
        roas            = ?,
        ctr             = ?,
        cpc             = ?,
        advertised_asin = ?,
        ntb_orders      = ?,
        ntb_sales       = ?,
        ntb_units       = ?,
        synced_at       = CURRENT_TIMESTAMP
      WHEN NOT MATCHED THEN INSERT
        (client_id, connection_type, campaign_id, report_date,
         impressions, clicks, spend, sales, orders, units_sold,
         acos, roas, ctr, cpc, advertised_asin,
         ntb_orders, ntb_sales, ntb_units, synced_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `, [
      // MERGE key
      clientId, connectionType, String(r.campaignId), reportDate, advertisedAsin,
      // UPDATE SET
      impressions, clicks, spend, sales,
      r.attributedUnitsOrdered30d || r.unitsSold14d || 0, units,
      acos, roas, ctr, cpc,
      advertisedAsin, ntbOrders, ntbSales, ntbUnits,
      // INSERT VALUES
      clientId, connectionType, String(r.campaignId), reportDate,
      impressions, clicks, spend, sales,
      r.attributedUnitsOrdered30d || r.unitsSold14d || 0, units,
      acos, roas, ctr, cpc,
      advertisedAsin, ntbOrders, ntbSales, ntbUnits
    ]);
    written++;
  }
  return written;
}

/**
 * Get profile IDs that have a matching brand for this client.
 * If no brands configured, fall back to all profiles (single-brand clients).
 */
async function getAuthorizedProfiles(clientId, allProfiles) {
  try {
    const brandRows = await query(
      'SELECT ads_profile_id FROM brands WHERE client_id = ? AND is_active = TRUE AND ads_profile_id IS NOT NULL',
      [clientId]
    );
    if (!brandRows.length) return allProfiles; // no brands yet — use all
    const authorizedIds = new Set(brandRows.map(r => String(r.ADS_PROFILE_ID)));
    const filtered = allProfiles.filter(p => authorizedIds.has(String(p.profileId)));
    console.log(`[Ads] Client ${clientId}: ${filtered.length}/${allProfiles.length} profiles authorized via brands`);
    return filtered;
  } catch {
    return allProfiles; // fallback to all on error
  }
}

/**
 * Main ingestion job — campaigns
 */
async function ingestCampaigns(clientId, connectionType) {
  return runJob(clientId, connectionType, 'campaigns', async () => {
    const allProfiles = await fetchProfiles(clientId, connectionType);
    const profiles = await getAuthorizedProfiles(clientId, allProfiles);
    let totalWritten = 0;
    for (const profile of profiles) {
      const client = await adsClient(clientId, connectionType);
      const campaigns = await fetchCampaigns(client, String(profile.profileId), connectionType);
      totalWritten += await writeCampaigns(clientId, connectionType, String(profile.profileId), campaigns);
    }
    return { recordsWritten: totalWritten };
  });
}

/**
 * Phase 1 — Request performance reports and store IDs in ads_report_queue.
 * Returns immediately — actual data arrives when processReportQueue() runs.
 */
async function ingestPerformance(clientId, connectionType, daysBack = 1) {
  return runJob(clientId, connectionType, 'performance', async () => {
    await ensureAdPerformanceSchema();

    const allProfiles = await fetchProfiles(clientId, connectionType);
    const profiles    = await getAuthorizedProfiles(clientId, allProfiles);
    let queued = 0;

    for (const profile of profiles) {
      for (let d = daysBack; d >= 1; d--) {
        const date = new Date();
        date.setDate(date.getDate() - d);
        const reportDate = date.toISOString().split('T')[0].replace(/-/g, '');

        const reportJobs = [
          { type: 'SP', requester: requestSPReport },
          { type: 'SB', requester: requestSBReport },
          { type: 'SD', requester: requestSDReport }
        ];

        for (const job of reportJobs) {
          try {
            const freshClient = await adsClient(clientId, connectionType);
            const reportId    = await job.requester(freshClient, String(profile.profileId), reportDate);
            if (!reportId) continue;

            // Store in queue — upsert in case it already exists
            await query(`
              MERGE INTO ads_report_queue t
              USING (SELECT ? AS report_id) s ON t.report_id = s.report_id
              WHEN NOT MATCHED THEN INSERT
                (report_id, client_id, connection_type, profile_id, report_type, report_date, status, requested_at)
                VALUES (?, ?, ?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP)
            `, [reportId, reportId, clientId, connectionType, String(profile.profileId), job.type, reportDate]);

            console.log(`[performance:${job.type}] Queued report ${reportId} for ${reportDate}`);
            queued++;
          } catch (err) {
            const body = err.response?.data ? JSON.stringify(err.response.data).substring(0, 200) : '';
            console.warn(`[performance:${job.type}] Queue failed ${reportDate} profile ${profile.profileId}: ${err.message} ${body}`);
          }
        }
      }
    }
    console.log(`[performance] Queued ${queued} reports — run processReportQueue() to download`);

    // Phase 2 — process the queue in background (non-blocking)
    processReportQueue(clientId, connectionType).catch(err =>
      console.error('[performance] Queue processing error:', err.message)
    );

    return { recordsWritten: 0, queued };
  });
}

/**
 * Phase 2 — Poll and download completed reports from the queue.
 * Runs in background after ingestPerformance() queues reports.
 * Can also be called standalone to process any pending reports.
 */
async function processReportQueue(clientId, connectionType) {
  const pending = await query(`
    SELECT report_id, profile_id, report_type, report_date
    FROM ads_report_queue
    WHERE client_id = ? AND connection_type = ? AND status = 'pending'
    ORDER BY requested_at ASC
    LIMIT 50
  `, [clientId, connectionType]);

  if (!pending.length) return;
  console.log(`[ReportQueue] Processing ${pending.length} pending reports for ${clientId}`);

  for (const row of pending) {
    const { REPORT_ID: reportId, PROFILE_ID: profileId, REPORT_TYPE: reportType, REPORT_DATE: reportDate } = row;
    try {
      const pollClient = await adsClient(clientId, connectionType);

      // Check status
      const statusRes = await pollClient.get(`/reporting/reports/${reportId}`, {
        headers: { 'Amazon-Advertising-API-Scope': profileId }
      });
      const { status, url, failureReason } = statusRes.data;

      if (status === 'PENDING' || status === 'PROCESSING') {
        console.log(`[ReportQueue] ${reportId} still ${status} — skipping for now`);
        continue;
      }

      if (status === 'FAILURE') {
        await query(`UPDATE ads_report_queue SET status = 'failed', error_message = ?, completed_at = CURRENT_TIMESTAMP WHERE report_id = ?`,
          [failureReason || 'FAILURE', reportId]);
        console.warn(`[ReportQueue] Report ${reportId} failed: ${failureReason}`);
        continue;
      }

      if (status === 'COMPLETED' && url) {
        const zlib = require('zlib');
        const download = await require('axios').get(url, { responseType: 'arraybuffer' });
        const rows = JSON.parse(zlib.gunzipSync(Buffer.from(download.data)).toString('utf8'));
        const tagged = (Array.isArray(rows) ? rows : []).map(r => ({ ...r, _reportType: reportType }));
        const written = await writePerformance(clientId, connectionType, reportDate, tagged);

        await query(`UPDATE ads_report_queue SET status = 'completed', records_written = ?, completed_at = CURRENT_TIMESTAMP WHERE report_id = ?`,
          [written, reportId]);
        console.log(`[ReportQueue] ✅ ${reportId} (${reportType} ${reportDate}) — ${written} records written`);
      }
    } catch (err) {
      console.warn(`[ReportQueue] Error processing ${reportId}: ${err.message}`);
    }
  }
}

module.exports = { ingestCampaigns, ingestPerformance, processReportQueue, ensureAdPerformanceSchema };
