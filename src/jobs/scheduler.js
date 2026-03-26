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
const { Resend } = require('resend');
const { ingestCampaigns, ingestPerformance, ingestDsp, processReportQueue } = require('./adsIngestion');
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

  if (connections.ads?.connected) {
    jobs.push(ingestCampaigns(clientId, 'ads'));
    // Queue report requests — fast, non-blocking
    // processReportQueue runs separately on 5min internal timer
    jobs.push(ingestPerformance(clientId, 'ads', 30));
    // DSP disabled from auto-scheduler — run manually when ready
    // jobs.push(ingestDsp(clientId, 'ads', 14));
    // NOTE: processReportQueue is NOT called here — it runs on its own 5min timer
    // so the event loop stays free to process completed reports concurrently
  }
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

  // Trigger first-real-client notification if applicable
  await checkFirstRealClient(clientId);
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

        // Skip clients with no real Amazon connections
        // getConnectionStatus returns { connected: bool } — check connected flag
        const hasRealConnections = Object.values(connections).some(c => c.connected);
        if (!hasRealConnections) {
          console.log(`[Scheduler] Skipping ${clientId} — no real Amazon connections`);
          continue;
        }

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
  const SIX_HOURS   = 6 * 60 * 60 * 1000;
  const FIVE_MINUTES = 5 * 60 * 1000;

  console.log('[Scheduler] Started — full sync every 6h, queue poll every 5min');

  // Run full sync immediately on startup
  runFullSync();

  // Full sync every 6 hours
  setInterval(runFullSync, SIX_HOURS);

  // Poll report queue every 5 minutes — runs inside the server process
  // so Snowflake connections are warm and no external process needed
  setInterval(async () => {
    try {
      const { query } = require('../services/snowflakeService');
      // Get all active clients with ads connected
      const clients = await query(`
        SELECT client_id FROM amazon_connections
        WHERE connection_type = 'ads'
        GROUP BY client_id
      `);
      for (const row of clients) {
        const cid = row.CLIENT_ID || row.client_id;
        await processReportQueue(cid, 'ads').catch(err =>
          console.warn('[QueuePoller] Error for', cid, err.message)
        );
      }
    } catch (err) {
      console.warn('[QueuePoller] Error:', err.message);
    }
  }, FIVE_MINUTES);
}

/**
 * Check if this is the first real (non-demo/non-test) client sync ever,
 * and if so, send a notification email to Abe and mark the flag in admin_config.
 */
async function checkFirstRealClient(clientId) {
  const { query } = require('../services/snowflakeService');

  // Skip demo and test clients
  if (clientId.startsWith('test-') || clientId.startsWith('demo-')) return;

  try {
    // Check if we've already sent the first-client notification
    const flag = await query(
      "SELECT value FROM admin_config WHERE key = 'first_real_client_notified'",
      []
    ).catch(() => []);

    if (flag && flag.length > 0) return; // already notified

    // Send notification to Abe
    const resend = new Resend(process.env.RESEND_API_KEY);

    await resend.emails.send({
      from: `Ash <${process.env.EMAIL_FROM}>`,
      to: [process.env.EMAIL_CC],
      subject: '🎉 First real client connected — Calbridge',
      html: `
        <h2>First real client just synced!</h2>
        <p>Client <strong>${clientId}</strong> just completed their first real Amazon data sync.</p>
        <p>This is the moment to tackle the post-launch tech debt list:</p>
        <ol>
          <li><strong>Session store → Snowflake</strong> (prevent logouts on restart)</li>
          <li><strong>Snowflake connection pooling</strong></li>
          <li><strong>Schema migration runner</strong></li>
          <li><strong>Basic integration test suite</strong></li>
          <li><strong>Structured logging</strong> (replace console.log)</li>
          <li><strong>Sanitize error responses</strong> in production</li>
          <li><strong>Split scheduler</strong> into separate process when &gt;10 clients</li>
          <li><strong>Multi-marketplace brand grouping</strong></li>
        </ol>
        <p>Reply to this email or message Ash to get started on any of these.</p>
      `
    });

    console.log(`[Scheduler] 🎉 First real client notification sent for ${clientId}`);

    // Mark as notified (best effort)
    await query(
      `MERGE INTO admin_config USING (SELECT ? AS key, ? AS value) AS src
       ON admin_config.key = src.key
       WHEN MATCHED THEN UPDATE SET value = src.value
       WHEN NOT MATCHED THEN INSERT (key, value) VALUES (src.key, src.value)`,
      ['first_real_client_notified', new Date().toISOString()]
    ).catch(err => {
      console.warn('[Scheduler] Could not mark first-client flag (non-fatal):', err.message);
    });
  } catch (err) {
    console.warn('[Scheduler] checkFirstRealClient error (non-fatal):', err.message);
  }
}

module.exports = { startScheduler, runFullSync, syncClient };
