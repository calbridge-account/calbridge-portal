/**
 * Client Health Score Service
 *
 * Scores each client 0–100 based on:
 *   +20  CM trend improving (30-day avg > 7-day avg in CM%)
 *   -10  CM trend declining
 *   +20  ACOS below break-even
 *   -15  ACOS above break-even
 *   +20  Data synced in last 24h
 *   +10  Data synced in last 48h (but not 24h)
 *     0  Data older than 48h
 *   +20  Has all 4 Amazon connections (ads, dsp, seller, vendor)
 *   +20  Logged in last 7 days
 *   +10  Logged in last 30 days (but not 7)
 *
 * Score clamped to [0, 100].
 */
const { query } = require('./snowflakeService');

/**
 * Calculate health score for a single client
 */
async function scoreClient(clientId) {
  const breakdown = {
    cmTrend:      0,
    acosVsBreakEven: 0,
    dataFreshness: 0,
    amazonConnections: 0,
    loginRecency: 0
  };

  try {
    // ── 1. CM Trend: compare 7-day avg CM% vs 30-day avg CM%
    const cmRows = await query(`
      SELECT
        AVG(CASE WHEN calc_date >= DATEADD(day, -7, CURRENT_DATE) THEN cm_percent END) AS avg7,
        AVG(CASE WHEN calc_date >= DATEADD(day, -30, CURRENT_DATE) THEN cm_percent END) AS avg30
      FROM contribution_margin
      WHERE client_id = ?
        AND calc_date >= DATEADD(day, -30, CURRENT_DATE)
    `, [clientId]);

    if (cmRows.length) {
      const avg7  = Number(cmRows[0].AVG7  ?? 0);
      const avg30 = Number(cmRows[0].AVG30 ?? 0);
      if (avg7 > avg30 + 0.5) {
        breakdown.cmTrend = 20;  // improving
      } else if (avg7 < avg30 - 0.5) {
        breakdown.cmTrend = -10; // declining
      }
    }
  } catch { /* no data */ }

  try {
    // ── 2. ACOS vs Break-even
    // Break-even ACOS = (revenue - cogs - fba_fees) / revenue
    const acosRows = await query(`
      SELECT
        SUM(revenue) AS rev,
        SUM(cogs) AS cogs,
        SUM(fba_fees) AS fees,
        SUM(ad_spend) AS spend
      FROM contribution_margin
      WHERE client_id = ?
        AND calc_date >= DATEADD(day, -30, CURRENT_DATE)
    `, [clientId]);

    if (acosRows.length) {
      const rev   = Number(acosRows[0].REV   || 0);
      const cogs  = Number(acosRows[0].COGS  || 0);
      const fees  = Number(acosRows[0].FEES  || 0);
      const spend = Number(acosRows[0].SPEND || 0);
      if (rev > 0) {
        const breakEven  = (rev - cogs - fees) / rev;
        const actualAcos = spend / rev;
        if (actualAcos <= breakEven) {
          breakdown.acosVsBreakEven = 20;
        } else {
          breakdown.acosVsBreakEven = -15;
        }
      }
    }
  } catch { /* no data */ }

  try {
    // ── 3. Data Freshness — when was the last successful sync?
    const freshRows = await query(`
      SELECT MAX(completed_at) AS last_sync
      FROM ingestion_log
      WHERE client_id = ?
        AND status = 'success'
    `, [clientId]);

    if (freshRows.length && freshRows[0].LAST_SYNC) {
      const lastSync = new Date(freshRows[0].LAST_SYNC instanceof Date
        ? freshRows[0].LAST_SYNC
        : freshRows[0].LAST_SYNC);
      const hoursAgo = (Date.now() - lastSync.getTime()) / 3600000;
      if (hoursAgo <= 24) {
        breakdown.dataFreshness = 20;
      } else if (hoursAgo <= 48) {
        breakdown.dataFreshness = 10;
      }
    }
  } catch { /* no data */ }

  try {
    // ── 4. Amazon Connections — check if all 4 are connected
    const connRows = await query(`
      SELECT COUNT(DISTINCT connection_type) AS cnt
      FROM amazon_connections
      WHERE client_id = ?
        AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
    `, [clientId]);

    if (connRows.length) {
      const cnt = Number(connRows[0].CNT || 0);
      if (cnt >= 4) breakdown.amazonConnections = 20;
    }
  } catch { /* no data */ }

  try {
    // ── 5. Login Recency
    const loginRows = await query(`
      SELECT last_login FROM clients WHERE client_id = ?
    `, [clientId]);

    if (loginRows.length && loginRows[0].LAST_LOGIN) {
      const lastLogin = new Date(loginRows[0].LAST_LOGIN instanceof Date
        ? loginRows[0].LAST_LOGIN
        : loginRows[0].LAST_LOGIN);
      const daysAgo = (Date.now() - lastLogin.getTime()) / 86400000;
      if (daysAgo <= 7) {
        breakdown.loginRecency = 20;
      } else if (daysAgo <= 30) {
        breakdown.loginRecency = 10;
      }
    }
  } catch { /* no data */ }

  const raw = Object.values(breakdown).reduce((a, b) => a + b, 0);
  const score = Math.max(0, Math.min(100, raw));

  return { clientId, score, breakdown };
}

/**
 * Calculate health scores for all clients
 */
async function getAllHealthScores() {
  const clients = await query(`
    SELECT client_id FROM clients WHERE status = 'active'
  `, []);

  const results = await Promise.all(
    clients.map(r => scoreClient(r.CLIENT_ID).catch(() => ({
      clientId: r.CLIENT_ID,
      score: 0,
      breakdown: { error: 'calculation failed' }
    })))
  );

  return results;
}

module.exports = { scoreClient, getAllHealthScores };
