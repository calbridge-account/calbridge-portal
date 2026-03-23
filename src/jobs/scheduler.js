/**
 * Ingestion Scheduler
 * Runs all ingestion jobs on a schedule for all connected clients
 *
 * Schedule:
 * - Campaigns:            Every 6 hours
 * - Performance (Ads):    Every 6 hours (yesterday's data)
 * - Products:             Every 24 hours
 * - Sales:                Every 6 hours
 * - Contribution Margin:  Every 6 hours (after sales + ads sync)
 */
require('dotenv').config();
const { ingestCampaigns, ingestPerformance } = require('./adsIngestion');
const { ingestProducts, ingestSales } = require('./spIngestion');
const { calculateContributionMargin } = require('./contributionMargin');
const authService = require('../services/authService');

// In-memory client registry for dev (replace with DB query in prod)
// getActiveClients() will be swapped to query Snowflake clients table
async function getActiveClients() {
  // TODO: Replace with: SELECT client_id FROM clients WHERE active = TRUE
  // For now returns all in-memory clients
  const allClients = [];
  // Access the in-memory map via authService (dev only)
  return allClients;
}

/**
 * Run all ingestion jobs for a single client
 */
async function syncClient(clientId, connections) {
  console.log(`[Scheduler] Syncing client ${clientId}...`);

  const jobs = [];

  if (connections.ads?.connected)    jobs.push(ingestCampaigns(clientId, 'ads'), ingestPerformance(clientId, 'ads', 2));
  if (connections.dsp?.connected)    jobs.push(ingestCampaigns(clientId, 'dsp'), ingestPerformance(clientId, 'dsp', 2));
  if (connections.seller?.connected) jobs.push(ingestProducts(clientId, 'seller'), ingestSales(clientId, 'seller', 7));
  if (connections.vendor?.connected) jobs.push(ingestProducts(clientId, 'vendor'), ingestSales(clientId, 'vendor', 7));

  // Run all connection jobs in parallel
  await Promise.allSettled(jobs);

  // Calculate contribution margin after all data is in
  const hasAdData = connections.ads?.connected || connections.dsp?.connected;
  const hasSalesData = connections.seller?.connected || connections.vendor?.connected;
  if (hasAdData && hasSalesData) {
    await calculateContributionMargin(clientId, 30);
  }

  console.log(`[Scheduler] ✅ Client ${clientId} sync complete`);
}

/**
 * Run a full sync cycle for all active clients
 */
async function runFullSync() {
  console.log('[Scheduler] Starting full sync cycle...');
  const { query } = require('../services/snowflakeService');

  try {
    // Query active clients from Snowflake
    const clients = await query(`SELECT client_id FROM clients`);
    console.log(`[Scheduler] Found ${clients.length} clients`);

    for (const row of clients) {
      try {
        const clientId = row.CLIENT_ID;
        const { getConnectionStatus } = require('../services/amazonAuthService');
        const connections = await getConnectionStatus(clientId);
        await syncClient(clientId, connections);
      } catch (err) {
        console.error(`[Scheduler] Client ${row.CLIENT_ID} sync failed:`, err.message);
      }
    }
  } catch (err) {
    console.error('[Scheduler] Full sync failed:', err.message);
  }

  console.log('[Scheduler] Full sync cycle complete');
}

/**
 * Start the scheduler
 * Uses setInterval — swap for a proper cron library (node-cron) in production
 */
function startScheduler() {
  const SIX_HOURS = 6 * 60 * 60 * 1000;

  console.log('[Scheduler] Started — full sync every 6 hours');

  // Run immediately on startup
  runFullSync();

  // Then every 6 hours
  setInterval(runFullSync, SIX_HOURS);
}

module.exports = { startScheduler, runFullSync, syncClient };
