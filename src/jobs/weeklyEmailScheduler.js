/**
 * Weekly Email Scheduler
 * Sends performance reports to all eligible active clients.
 *
 * Eligibility:
 *   - status = 'active'
 *   - Has at least one Amazon connection (connections not null/empty)
 *   - Has data in the past 14 days
 *   - weekly_report_enabled is not FALSE
 */
require('dotenv').config();
const { query } = require('../services/snowflakeService');
const { generateAndSend } = require('../services/weeklyReport');

/**
 * Check if a client has any sales or ad data in the past 14 days
 */
async function clientHasRecentData(clientId) {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - 14);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const [salesRows, adRows] = await Promise.all([
    query(`
      SELECT COUNT(*) AS cnt FROM sales
      WHERE client_id = ? AND order_date >= ?
    `, [clientId, cutoffStr]),
    query(`
      SELECT COUNT(*) AS cnt FROM ad_performance
      WHERE client_id = ? AND report_date >= ?
    `, [clientId, cutoffStr])
  ]);

  const salesCount = Number(salesRows[0]?.CNT || 0);
  const adCount    = Number(adRows[0]?.CNT || 0);
  return (salesCount + adCount) > 0;
}

/**
 * Send weekly performance reports to all eligible active clients.
 * Returns the count of clients that were attempted.
 */
async function sendWeeklyReportsToAll() {
  console.log('[WeeklyEmail] Querying eligible clients...');

  // Fetch all active clients with report enabled
  const clients = await query(`
    SELECT client_id, email, name, company_name, connections, weekly_report_enabled
    FROM clients
    WHERE status = 'active'
      AND (weekly_report_enabled IS NULL OR weekly_report_enabled = TRUE)
    ORDER BY created_at ASC
  `);

  // Filter: must have Amazon connections
  const eligible = clients.filter(r => {
    const conn = r.CONNECTIONS;
    if (!conn) return false;
    // VARIANT column may come back as parsed object or JSON string
    let parsed = conn;
    if (typeof conn === 'string') {
      try { parsed = JSON.parse(conn); } catch { return false; }
    }
    // Has at least one connected account
    if (typeof parsed !== 'object' || parsed === null) return false;
    return Object.values(parsed).some(c => c && c.connected === true);
  });

  console.log(`[WeeklyEmail] ${clients.length} active clients, ${eligible.length} have Amazon connections`);

  let attempted = 0;
  for (const row of eligible) {
    const clientId = row.CLIENT_ID;
    try {
      // Check for recent data before sending
      const hasData = await clientHasRecentData(clientId);
      if (!hasData) {
        console.log(`[WeeklyEmail] ⏭  Skipping ${clientId} — no data in past 14 days`);
        continue;
      }

      attempted++;
      const result = await generateAndSend(clientId);

      if (result.skipped) {
        console.log(`[WeeklyEmail] ⏭  Skipped ${clientId}: ${result.reason}`);
      } else {
        console.log(`[WeeklyEmail] ✅ Sent to ${row.EMAIL} (${clientId})`);
      }
    } catch (err) {
      console.error(`[WeeklyEmail] ❌ Failed for ${clientId} (${row.EMAIL}): ${err.message}`);
      // Continue to next client — don't let one failure block the rest
    }
  }

  console.log(`[WeeklyEmail] Done. Attempted ${attempted} of ${eligible.length} eligible clients.`);
  return attempted;
}

module.exports = { sendWeeklyReportsToAll };
