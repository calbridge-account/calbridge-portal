/**
 * Amazon Advertising API ingestion
 * Covers: Amazon Ads (Sponsored Products/Brands/Display) + DSP
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
 * Request a performance report for a profile (async report flow)
 */
async function requestPerformanceReport(client, profileId, reportDate) {
  const res = await client.post('/v2/sp/campaigns/report', {
    reportDate,
    metrics: 'impressions,clicks,cost,attributedSales30d,attributedUnitsOrdered30d'
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
 * Upsert performance data into Snowflake
 */
async function writePerformance(clientId, connectionType, reportDate, rows) {
  if (!rows.length) return 0;
  let written = 0;
  for (const r of rows) {
    const spend = r.cost || 0;
    const sales = r.attributedSales30d || 0;
    const clicks = r.clicks || 0;
    const impressions = r.impressions || 0;
    const acos = sales > 0 ? spend / sales : null;
    const roas = spend > 0 ? sales / spend : null;
    const ctr = impressions > 0 ? clicks / impressions : null;
    const cpc = clicks > 0 ? spend / clicks : null;

    await query(`
      MERGE INTO ad_performance t
      USING (SELECT ? AS client_id, ? AS connection_type, ? AS campaign_id, ? AS report_date) s
      ON t.client_id = s.client_id AND t.connection_type = s.connection_type
        AND t.campaign_id = s.campaign_id AND t.report_date = s.report_date
      WHEN MATCHED THEN UPDATE SET
        impressions = ?, clicks = ?, spend = ?, sales = ?,
        orders = ?, units_sold = ?, acos = ?, roas = ?,
        ctr = ?, cpc = ?, synced_at = CURRENT_TIMESTAMP
      WHEN NOT MATCHED THEN INSERT
        (client_id, connection_type, campaign_id, report_date,
         impressions, clicks, spend, sales, orders, units_sold,
         acos, roas, ctr, cpc, synced_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `, [
      clientId, connectionType, String(r.campaignId), reportDate,
      impressions, clicks, spend, sales,
      r.attributedUnitsOrdered30d || 0, r.attributedUnitsOrdered30d || 0,
      acos, roas, ctr, cpc,
      clientId, connectionType, String(r.campaignId), reportDate,
      impressions, clicks, spend, sales,
      r.attributedUnitsOrdered30d || 0, r.attributedUnitsOrdered30d || 0,
      acos, roas, ctr, cpc
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
 */
async function ingestPerformance(clientId, connectionType, daysBack = 1) {
  return runJob(clientId, connectionType, 'performance', async () => {
    const profiles = await fetchProfiles(clientId, connectionType);
    let totalWritten = 0;

    for (const profile of profiles) {
      const client = await adsClient(clientId, connectionType);
      for (let d = daysBack; d >= 1; d--) {
        const date = new Date();
        date.setDate(date.getDate() - d);
        const reportDate = date.toISOString().split('T')[0].replace(/-/g, '');

        try {
          const reportId = await requestPerformanceReport(client, String(profile.profileId), reportDate);
          if (!reportId) continue;
          const rows = await downloadReport(client, String(profile.profileId), reportId);
          totalWritten += await writePerformance(clientId, connectionType, reportDate, Array.isArray(rows) ? rows : []);
        } catch (err) {
          console.warn(`[performance] Skipping date ${reportDate} for profile ${profile.profileId}: ${err.message}`);
        }
      }
    }
    return { recordsWritten: totalWritten };
  });
}

module.exports = { ingestCampaigns, ingestPerformance };
