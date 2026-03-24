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
    params: { state: 'enabled,paused,archived', count: 100 }
  });
  return res.data || [];
}

/**
 * Request an SP ad-level performance report for a profile (async report flow)
 * Uses the sponsored products ads report which includes advertisedAsin at the ad level.
 * Metrics include: impressions, clicks, cost, attributedSales30d, attributedUnitsOrdered30d,
 *                  newToBrandPurchases, newToBrandSales (SB only)
 */
async function requestSPReport(client, profileId, reportDate) {
  // SP report at "asin" level — returns one row per advertised ASIN
  const res = await client.post('/v2/sp/adGroups/report', {
    reportDate,
    metrics: 'impressions,clicks,cost,attributedSales30d,attributedUnitsOrdered30d,advertisedAsin'
  }, {
    headers: { 'Amazon-Advertising-API-Scope': profileId }
  });
  return res.data?.reportId;
}

/**
 * Request a Sponsored Brands report including NTB metrics
 */
async function requestSBReport(client, profileId, reportDate) {
  const res = await client.post('/v2/hsa/campaigns/report', {
    reportDate,
    metrics: [
      'impressions', 'clicks', 'cost', 'attributedSales14d',
      'unitsSold14d', 'newToBrandOrders14d', 'newToBrandSales14d',
      'newToBrandUnitsSold14d'
    ].join(',')
  }, {
    headers: { 'Amazon-Advertising-API-Scope': profileId }
  });
  return res.data?.reportId;
}

/**
 * Request a Sponsored Display report at ad level (includes advertisedAsin)
 */
async function requestSDReport(client, profileId, reportDate) {
  const res = await client.post('/v2/sd/adGroups/report', {
    reportDate,
    metrics: 'impressions,clicks,cost,attributedSales30d,attributedUnitsOrdered30d,advertisedAsin'
  }, {
    headers: { 'Amazon-Advertising-API-Scope': profileId }
  });
  return res.data?.reportId;
}

/**
 * Poll for report completion and download
 */
async function downloadReport(client, profileId, reportId, maxWaitMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const res = await client.get(`/v2/reports/${reportId}`, {
      headers: { 'Amazon-Advertising-API-Scope': profileId }
    });
    const { status, location } = res.data;
    if (status === 'SUCCESS' && location) {
      const download = await axios.get(location, { responseType: 'json' });
      return download.data;
    }
    if (status === 'FAILURE') throw new Error(`Report ${reportId} failed`);
    await new Promise(r => setTimeout(r, 5000)); // poll every 5s
  }
  throw new Error(`Report ${reportId} timed out`);
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
    const spend       = r.cost || r.spend || 0;
    const sales       = r.attributedSales30d || r.attributedSales14d || 0;
    const clicks      = r.clicks || 0;
    const impressions = r.impressions || 0;
    const units       = r.attributedUnitsOrdered30d || r.unitsSold14d || 0;
    const acos        = sales > 0 ? spend / sales : null;
    const roas        = spend > 0 ? sales / spend : null;
    const ctr         = impressions > 0 ? clicks / impressions : null;
    const cpc         = clicks > 0 ? spend / clicks : null;

    // Direct ASIN from ad-level report; fall back to 'UNATTRIBUTED' for
    // brand awareness DSP or campaigns with no product targeting
    const advertisedAsin = r.advertisedAsin || r.asin || 'UNATTRIBUTED';

    // NTB metrics (Sponsored Brands only)
    const ntbOrders = r.newToBrandOrders14d   || r.newToBrandPurchases || null;
    const ntbSales  = r.newToBrandSales14d     || null;
    const ntbUnits  = r.newToBrandUnitsSold14d || null;

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
 * Main ingestion job — campaigns
 */
async function ingestCampaigns(clientId, connectionType) {
  return runJob(clientId, connectionType, 'campaigns', async () => {
    const profiles = await fetchProfiles(clientId, connectionType);
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
 * Main ingestion job — performance (last N days)
 *
 * Requests separate SP, SB, and SD reports per profile per date.
 * Each report type returns ASIN-level data via advertisedAsin.
 * All rows are written to ad_performance with direct ASIN attribution.
 */
async function ingestPerformance(clientId, connectionType, daysBack = 1) {
  return runJob(clientId, connectionType, 'performance', async () => {
    // Ensure schema is up to date before writing
    await ensureAdPerformanceSchema();

    const profiles = await fetchProfiles(clientId, connectionType);
    let totalWritten = 0;

    for (const profile of profiles) {
      const client = await adsClient(clientId, connectionType);
      for (let d = daysBack; d >= 1; d--) {
        const date = new Date();
        date.setDate(date.getDate() - d);
        const reportDate = date.toISOString().split('T')[0].replace(/-/g, '');

        // Request SP, SB, and SD reports in parallel
        const reportJobs = [
          { type: 'SP', requester: requestSPReport  },
          { type: 'SB', requester: requestSBReport  },
          { type: 'SD', requester: requestSDReport  }
        ];

        for (const job of reportJobs) {
          try {
            const reportId = await job.requester(client, String(profile.profileId), reportDate);
            if (!reportId) continue;
            const rows = await downloadReport(client, String(profile.profileId), reportId);
            const rowArr = Array.isArray(rows) ? rows : [];
            // Tag each row with its report type so we can detect SB NTB fields
            const tagged = rowArr.map(r => ({ ...r, _reportType: job.type }));
            totalWritten += await writePerformance(clientId, connectionType, reportDate, tagged);
          } catch (err) {
            console.warn(`[performance:${job.type}] Skipping ${reportDate} profile ${profile.profileId}: ${err.message}`);
          }
        }
      }
    }
    return { recordsWritten: totalWritten };
  });
}

module.exports = { ingestCampaigns, ingestPerformance, ensureAdPerformanceSchema };
