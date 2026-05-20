'use strict';

/**
 * anomalyAlerts.js
 * Detects advertising anomalies for active clients and sends alert emails.
 *
 * Anomalies detected (per client, aggregated across ad types):
 *   1. ACoS Spike        — today's ACoS > 7-day avg by >20 percentage points
 *   2. Spend Surge       — today's spend > 30% above 7-day daily average
 *   3. Budget Exhaustion — if daily spend rate continues, monthly budget runs out before EOM
 *   4. Zero Spend Day    — a campaign active last week has $0 spend today
 *
 * Budget Pacing Check (sent to Abe only):
 *   - MTD spend on pace to exceed last month's total by >20%
 *
 * Runs daily at 10:00 UTC via cron in worker.js.
 */

require('dotenv').config();
const { query } = require('../services/snowflakeService');
const { sendEmail } = require('../services/graphEmailService');

const ABE_EMAIL = 'abe@teamcalbridge.com';
const DASHBOARD_URL = 'https://app.calbridge.ai';

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmt$(n) {
  return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPct(n) {
  return (Number(n || 0) * 100).toFixed(1) + '%';
}

function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

/** Return YYYY-MM-DD string for N days ago (UTC) */
function daysAgo(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/** Day 1 of current month (UTC) */
function startOfMonth() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

/** Day 1 of last month (UTC) */
function startOfLastMonth() {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - 1);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

/** Day 1 of current month — as a Date object for day-counting */
function currentMonthStart() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

/** Total days in current month */
function daysInCurrentMonth() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
}

// ─── Fetch eligible clients ──────────────────────────────────────────────────

async function getEligibleClients() {
  const rows = await query(`
    SELECT client_id, name, email, connections
    FROM CALBRIDGE_PROD.APP.clients
    WHERE status = 'active'
    ORDER BY name
  `);

  return rows.filter(r => {
    const conn = r.CONNECTIONS;
    if (!conn) return false;
    let parsed = conn;
    if (typeof conn === 'string') {
      try { parsed = JSON.parse(conn); } catch { return false; }
    }
    if (typeof parsed !== 'object' || parsed === null) return false;
    return Object.values(parsed).some(c => c && c.connected === true);
  });
}

// ─── Anomaly detection queries ───────────────────────────────────────────────

/**
 * Get daily aggregated spend/acos for the past 8 days (today + 7-day window)
 * Returns rows: { DATE, SPEND, ACOS }
 */
async function getDailyRollup(clientId, since) {
  return query(`
    SELECT
      DATE,
      SUM(SPEND) AS SPEND,
      SUM(SALES) AS SALES,
      CASE WHEN SUM(SALES) > 0 THEN SUM(SPEND) / SUM(SALES) ELSE NULL END AS ACOS
    FROM CALBRIDGE_PROD.MARTS.AD_PERFORMANCE_DAILY
    WHERE CLIENT_ID = ?
      AND DATE >= ?
    GROUP BY DATE
    ORDER BY DATE DESC
  `, [clientId, since]);
}

/**
 * Get per-campaign data: active campaigns last week vs today
 * Returns rows: { CAMPAIGN_ID, CAMPAIGN_NAME, AD_TYPE, TODAY_SPEND, LAST_WEEK_SPEND }
 */
async function getCampaignZeroSpend(clientId, today, lastWeekStart) {
  // campaigns that had spend in the past 7 days but have $0 today
  return query(`
    WITH today_campaigns AS (
      SELECT CAMPAIGN_ID, CAMPAIGN_NAME, AD_TYPE, SUM(SPEND) AS TODAY_SPEND
      FROM CALBRIDGE_PROD.MARTS.CAMPAIGN_PERFORMANCE
      WHERE CLIENT_ID = ? AND DATE = ?
      GROUP BY CAMPAIGN_ID, CAMPAIGN_NAME, AD_TYPE
    ),
    last_week_campaigns AS (
      SELECT CAMPAIGN_ID, SUM(SPEND) AS LAST_WEEK_SPEND
      FROM CALBRIDGE_PROD.MARTS.CAMPAIGN_PERFORMANCE
      WHERE CLIENT_ID = ?
        AND DATE >= ? AND DATE < ?
        AND CAMPAIGN_STATUS = 'ENABLED'
      GROUP BY CAMPAIGN_ID
      HAVING SUM(SPEND) > 0
    )
    SELECT
      lw.CAMPAIGN_ID,
      COALESCE(tc.CAMPAIGN_NAME, lw.CAMPAIGN_ID) AS CAMPAIGN_NAME,
      COALESCE(tc.AD_TYPE, 'SP') AS AD_TYPE,
      COALESCE(tc.TODAY_SPEND, 0) AS TODAY_SPEND,
      lw.LAST_WEEK_SPEND
    FROM last_week_campaigns lw
    LEFT JOIN today_campaigns tc ON lw.CAMPAIGN_ID = tc.CAMPAIGN_ID
    WHERE COALESCE(tc.TODAY_SPEND, 0) = 0
    ORDER BY lw.LAST_WEEK_SPEND DESC
  `, [clientId, today, clientId, lastWeekStart, today]);
}

/**
 * Get MTD spend + last month total for budget pacing
 */
async function getBudgetPacingData(clientId) {
  const som = startOfMonth();
  const solm = startOfLastMonth();
  const today = todayUTC();

  const [mtd, lastMonth] = await Promise.all([
    query(`
      SELECT SUM(SPEND) AS MTD_SPEND
      FROM CALBRIDGE_PROD.MARTS.AD_PERFORMANCE_DAILY
      WHERE CLIENT_ID = ? AND DATE >= ? AND DATE <= ?
    `, [clientId, som, today]),
    query(`
      SELECT SUM(SPEND) AS LAST_MONTH_SPEND
      FROM CALBRIDGE_PROD.MARTS.AD_PERFORMANCE_DAILY
      WHERE CLIENT_ID = ? AND DATE >= ? AND DATE < ?
    `, [clientId, solm, som]),
  ]);

  return {
    mtdSpend: Number(mtd[0]?.MTD_SPEND || 0),
    lastMonthSpend: Number(lastMonth[0]?.LAST_MONTH_SPEND || 0),
  };
}

// ─── Core anomaly detection ───────────────────────────────────────────────────

/**
 * Detect anomalies for a single client.
 * Returns an array of anomaly objects.
 */
async function detectClientAnomalies(clientId) {
  const today = todayUTC();
  const sevenDaysAgo = daysAgo(7);
  const anomalies = [];

  // --- Get daily rollup (today + prior 7 days) ---
  const dailyRows = await getDailyRollup(clientId, sevenDaysAgo);
  if (!dailyRows.length) return anomalies;

  // Sort: most recent first
  dailyRows.sort((a, b) => String(b.DATE).localeCompare(String(a.DATE)));

  const latestDate = String(dailyRows[0].DATE).slice(0, 10);
  const isToday = latestDate === today;
  // Use most recent day as "today" (data may lag by 1 day)
  const todayRow = dailyRows[0];
  const priorRows = dailyRows.slice(1); // up to 7 prior days

  if (!priorRows.length) return anomalies; // not enough history

  const todaySpend = Number(todayRow.SPEND || 0);
  const todayACoS  = Number(todayRow.ACOS  || 0);

  const priorSpends = priorRows.map(r => Number(r.SPEND || 0));
  const priorACoSes = priorRows.filter(r => r.ACOS != null).map(r => Number(r.ACOS));

  const avgSpend = priorSpends.length
    ? priorSpends.reduce((a, b) => a + b, 0) / priorSpends.length
    : 0;
  const avgACoS = priorACoSes.length
    ? priorACoSes.reduce((a, b) => a + b, 0) / priorACoSes.length
    : 0;

  const reportDate = latestDate;

  // 1. ACoS spike: today ACoS > avg by >20 percentage points
  if (todayRow.SALES > 0 && priorACoSes.length >= 3) {
    const acosSpike = todayACoS - avgACoS;
    if (acosSpike > 0.20) {
      anomalies.push({
        type: 'ACOS_SPIKE',
        severity: acosSpike > 0.40 ? 'HIGH' : 'MEDIUM',
        label: 'ACoS Spike',
        date: reportDate,
        todayACoS,
        avgACoS,
        spike: acosSpike,
        message: `ACoS is ${fmtPct(todayACoS)} vs 7-day avg of ${fmtPct(avgACoS)} (+${fmtPct(acosSpike)})`,
      });
    }
  }

  // 2. Spend surge: today spend > 30% above 7-day daily avg
  if (avgSpend > 0) {
    const spendPct = (todaySpend - avgSpend) / avgSpend;
    if (spendPct > 0.30) {
      anomalies.push({
        type: 'SPEND_SURGE',
        severity: spendPct > 0.75 ? 'HIGH' : 'MEDIUM',
        label: 'Spend Surge',
        date: reportDate,
        todaySpend,
        avgSpend,
        pctAbove: spendPct,
        message: `Today's spend is ${fmt$(todaySpend)} vs 7-day avg of ${fmt$(avgSpend)} (+${(spendPct * 100).toFixed(0)}%)`,
      });
    }
  }

  // 3. Budget exhaustion risk (estimate MTD + project to EOM)
  {
    const som = startOfMonth();
    const daysElapsed = Math.max(1,
      Math.floor((new Date(reportDate) - new Date(som)) / 86400000) + 1
    );
    const totalDays = daysInCurrentMonth();
    const daysRemaining = totalDays - daysElapsed;

    // Get MTD spend
    const mtdRows = await query(`
      SELECT SUM(SPEND) AS MTD_SPEND
      FROM CALBRIDGE_PROD.MARTS.AD_PERFORMANCE_DAILY
      WHERE CLIENT_ID = ? AND DATE >= ? AND DATE <= ?
    `, [clientId, som, reportDate]);
    const mtdSpend = Number(mtdRows[0]?.MTD_SPEND || 0);

    if (daysRemaining > 0 && daysElapsed > 0) {
      const dailyRate = mtdSpend / daysElapsed;
      const projectedMonthly = mtdSpend + dailyRate * daysRemaining;

      // Get last month total for comparison
      const solm = startOfLastMonth();
      const lastMonthRows = await query(`
        SELECT SUM(SPEND) AS LAST_MONTH_SPEND
        FROM CALBRIDGE_PROD.MARTS.AD_PERFORMANCE_DAILY
        WHERE CLIENT_ID = ? AND DATE >= ? AND DATE < ?
      `, [clientId, solm, som]);
      const lastMonthSpend = Number(lastMonthRows[0]?.LAST_MONTH_SPEND || 0);

      // Warn if projected > last month * 1.2, or if we're >80% through month and projected EOM is >120% of budget
      if (lastMonthSpend > 0) {
        const projectedRatio = projectedMonthly / lastMonthSpend;
        if (projectedRatio > 1.20 && daysElapsed >= 7) {
          anomalies.push({
            type: 'BUDGET_EXHAUSTION',
            severity: projectedRatio > 1.50 ? 'HIGH' : 'MEDIUM',
            label: 'Budget Exhaustion Risk',
            date: reportDate,
            mtdSpend,
            projectedMonthly,
            lastMonthSpend,
            projectedRatio,
            daysRemaining,
            message: `MTD spend ${fmt$(mtdSpend)}, projected EOM ${fmt$(projectedMonthly)} — ${((projectedRatio - 1) * 100).toFixed(0)}% above last month (${fmt$(lastMonthSpend)})`,
          });
        }
      }
    }
  }

  // 4. Zero spend day: campaigns active last week with $0 today
  {
    const lastWeekStart = daysAgo(7);
    const zeroRows = await getCampaignZeroSpend(clientId, reportDate, lastWeekStart);
    if (zeroRows.length > 0) {
      // Only flag if >0 and limit to top 5 for the email
      const top = zeroRows.slice(0, 5);
      anomalies.push({
        type: 'ZERO_SPEND',
        severity: zeroRows.length >= 3 ? 'HIGH' : 'LOW',
        label: 'Zero Spend Day',
        date: reportDate,
        campaigns: top.map(r => ({
          name: r.CAMPAIGN_NAME,
          adType: r.AD_TYPE,
          lastWeekSpend: Number(r.LAST_WEEK_SPEND || 0),
        })),
        totalAffected: zeroRows.length,
        message: `${zeroRows.length} campaign(s) that were spending last week had $0 spend today`,
      });
    }
  }

  return anomalies;
}

// ─── Email HTML builder ───────────────────────────────────────────────────────

const SEVERITY_COLOR = { HIGH: '#dc2626', MEDIUM: '#d97706', LOW: '#2563eb' };
const SEVERITY_BG    = { HIGH: '#fef2f2', MEDIUM: '#fffbeb', LOW: '#eff6ff' };

function buildAnomalyEmailHtml(clientName, anomalies) {
  const date = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
  });

  const anomalyBlocks = anomalies.map(a => {
    const color = SEVERITY_COLOR[a.severity] || '#374151';
    const bg    = SEVERITY_BG[a.severity]    || '#f9fafb';

    let detail = `<p style="margin:4px 0 0 0;color:#374151;">${a.message}</p>`;

    if (a.type === 'ZERO_SPEND' && a.campaigns?.length) {
      const rows = a.campaigns.map(c =>
        `<tr><td style="padding:3px 8px;border-bottom:1px solid #e5e7eb;">${c.name}</td>` +
        `<td style="padding:3px 8px;border-bottom:1px solid #e5e7eb;text-align:center;">${c.adType}</td>` +
        `<td style="padding:3px 8px;border-bottom:1px solid #e5e7eb;text-align:right;">${fmt$(c.lastWeekSpend)}/wk avg</td></tr>`
      ).join('');
      detail += `
        <table style="margin-top:8px;width:100%;border-collapse:collapse;font-size:13px;">
          <thead><tr style="background:#f3f4f6;">
            <th style="padding:4px 8px;text-align:left;color:#6b7280;">Campaign</th>
            <th style="padding:4px 8px;text-align:center;color:#6b7280;">Type</th>
            <th style="padding:4px 8px;text-align:right;color:#6b7280;">Prev. Avg Spend</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
        ${a.totalAffected > 5 ? `<p style="font-size:12px;color:#9ca3af;margin:4px 0 0 0;">… and ${a.totalAffected - 5} more campaign(s)</p>` : ''}
      `;
    }

    return `
      <div style="background:${bg};border-left:4px solid ${color};border-radius:6px;padding:12px 16px;margin-bottom:14px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
          <span style="font-weight:700;color:${color};font-size:15px;">${a.label}</span>
          <span style="font-size:11px;font-weight:600;color:${color};background:${color}22;padding:2px 7px;border-radius:999px;">${a.severity}</span>
          <span style="font-size:12px;color:#9ca3af;margin-left:auto;">${a.date}</span>
        </div>
        ${detail}
      </div>
    `;
  }).join('');

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:600px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1);">
    <!-- Header -->
    <div style="background:#111827;padding:24px 32px;">
      <div style="display:flex;align-items:center;gap:12px;">
        <span style="font-size:22px;font-weight:800;color:#fff;letter-spacing:-0.5px;">Calbridge</span>
        <span style="color:#dc2626;font-size:13px;font-weight:600;background:#7f1d1d33;padding:3px 10px;border-radius:999px;">⚠ Anomaly Alert</span>
      </div>
      <p style="margin:6px 0 0 0;color:#9ca3af;font-size:13px;">${date}</p>
    </div>

    <!-- Body -->
    <div style="padding:28px 32px;">
      <h2 style="margin:0 0 6px 0;font-size:18px;color:#111827;">Anomalies detected for ${clientName}</h2>
      <p style="margin:0 0 22px 0;color:#6b7280;font-size:14px;">
        The following issues were detected in your advertising data. Review and take action to stay on track.
      </p>

      ${anomalyBlocks}

      <!-- CTA -->
      <div style="text-align:center;margin-top:28px;">
        <a href="${DASHBOARD_URL}"
           style="display:inline-block;background:#111827;color:#fff;font-weight:600;font-size:14px;
                  padding:12px 28px;border-radius:8px;text-decoration:none;letter-spacing:0.2px;">
          View Dashboard →
        </a>
      </div>
    </div>

    <!-- Footer -->
    <div style="background:#f9fafb;padding:16px 32px;border-top:1px solid #e5e7eb;">
      <p style="margin:0;font-size:12px;color:#9ca3af;text-align:center;">
        Calbridge · <a href="${DASHBOARD_URL}" style="color:#6b7280;">app.calbridge.ai</a> · Automated alert — review within 24h
      </p>
    </div>
  </div>
</body>
</html>`;
}

// ─── Budget pacing email ─────────────────────────────────────────────────────

function buildBudgetPacingHtml(pacingAlerts) {
  const date = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
  });

  const rows = pacingAlerts.map(a => `
    <tr style="border-bottom:1px solid #e5e7eb;">
      <td style="padding:10px 12px;font-weight:600;color:#111827;">${a.clientName}</td>
      <td style="padding:10px 12px;text-align:right;">${fmt$(a.mtdSpend)}</td>
      <td style="padding:10px 12px;text-align:right;">${fmt$(a.projectedMonthly)}</td>
      <td style="padding:10px 12px;text-align:right;">${fmt$(a.lastMonthSpend)}</td>
      <td style="padding:10px 12px;text-align:right;color:#dc2626;font-weight:700;">+${((a.ratio - 1) * 100).toFixed(0)}%</td>
    </tr>
  `).join('');

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:680px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1);">
    <div style="background:#111827;padding:24px 32px;">
      <span style="font-size:22px;font-weight:800;color:#fff;">Calbridge</span>
      <span style="color:#f59e0b;font-size:13px;font-weight:600;background:#78350f33;padding:3px 10px;border-radius:999px;margin-left:12px;">📈 Budget Pacing Alert</span>
      <p style="margin:6px 0 0 0;color:#9ca3af;font-size:13px;">${date}</p>
    </div>
    <div style="padding:28px 32px;">
      <h2 style="margin:0 0 8px 0;font-size:18px;color:#111827;">Clients pacing to exceed budget by &gt;20%</h2>
      <p style="margin:0 0 20px 0;color:#6b7280;font-size:14px;">
        The following clients are on pace to spend more than 20% above last month's total. Review before month end.
      </p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <thead>
          <tr style="background:#f3f4f6;color:#6b7280;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;">
            <th style="padding:10px 12px;text-align:left;">Client</th>
            <th style="padding:10px 12px;text-align:right;">MTD Spend</th>
            <th style="padding:10px 12px;text-align:right;">Projected EOM</th>
            <th style="padding:10px 12px;text-align:right;">Last Month</th>
            <th style="padding:10px 12px;text-align:right;">Over By</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <div style="text-align:center;margin-top:28px;">
        <a href="${DASHBOARD_URL}"
           style="display:inline-block;background:#111827;color:#fff;font-weight:600;font-size:14px;
                  padding:12px 28px;border-radius:8px;text-decoration:none;">
          View Dashboard →
        </a>
      </div>
    </div>
    <div style="background:#f9fafb;padding:16px 32px;border-top:1px solid #e5e7eb;">
      <p style="margin:0;font-size:12px;color:#9ca3af;text-align:center;">
        Calbridge · <a href="${DASHBOARD_URL}" style="color:#6b7280;">app.calbridge.ai</a> · Daily budget pacing check
      </p>
    </div>
  </div>
</body>
</html>`;
}

// ─── Main exported function ───────────────────────────────────────────────────

/**
 * Run anomaly detection for all eligible clients.
 * Sends alert emails to affected clients + abe@teamcalbridge.com.
 */
async function runAnomalyAlerts() {
  console.log('[AnomalyAlerts] Starting anomaly detection run...');

  const clients = await getEligibleClients();
  console.log(`[AnomalyAlerts] ${clients.length} eligible client(s)`);

  let totalAnomalies = 0;
  const budgetPacingAlerts = [];

  for (const client of clients) {
    const clientId   = client.CLIENT_ID;
    const clientName = client.NAME || client.COMPANY_NAME || clientId;
    const clientEmail = client.EMAIL;

    try {
      // ── Anomaly alerts ──────────────────────────────────────────────────
      const anomalies = await detectClientAnomalies(clientId);

      if (anomalies.length > 0) {
        totalAnomalies += anomalies.length;
        console.log(`[AnomalyAlerts] ${clientName}: ${anomalies.length} anomaly/anomalies — ${anomalies.map(a => a.type).join(', ')}`);

        const html    = buildAnomalyEmailHtml(clientName, anomalies);
        const subject = `⚠️ Ad Anomalies Detected — ${clientName} (${anomalies.length} issue${anomalies.length > 1 ? 's' : ''})`;
        const to      = clientEmail ? [clientEmail, ABE_EMAIL] : [ABE_EMAIL];
        const uniqueTo = [...new Set(to)];

        try {
          await sendEmail({ to: uniqueTo, subject, html });
          console.log(`[AnomalyAlerts] ✅ Alert email sent for ${clientName} → ${uniqueTo.join(', ')}`);
        } catch (emailErr) {
          console.error(`[AnomalyAlerts] ❌ Email failed for ${clientName}: ${emailErr.message}`);
        }
      } else {
        console.log(`[AnomalyAlerts] ✓ ${clientName}: no anomalies`);
      }

      // ── Budget pacing check ─────────────────────────────────────────────
      const { mtdSpend, lastMonthSpend } = await getBudgetPacingData(clientId);

      if (lastMonthSpend > 0 && mtdSpend > 0) {
        const som = startOfMonth();
        const today = todayUTC();
        const daysElapsed = Math.max(1,
          Math.floor((new Date(today) - new Date(som)) / 86400000) + 1
        );
        const totalDays     = daysInCurrentMonth();
        const daysRemaining = totalDays - daysElapsed;
        const dailyRate     = mtdSpend / daysElapsed;
        const projected     = mtdSpend + dailyRate * daysRemaining;
        const ratio         = projected / lastMonthSpend;

        if (ratio > 1.20 && daysElapsed >= 7) {
          budgetPacingAlerts.push({
            clientId,
            clientName,
            mtdSpend,
            projectedMonthly: projected,
            lastMonthSpend,
            ratio,
          });
        }
      }
    } catch (err) {
      console.error(`[AnomalyAlerts] ❌ Error processing ${clientName} (${clientId}): ${err.message}`);
    }
  }

  // ── Send budget pacing email to Abe ──────────────────────────────────────
  if (budgetPacingAlerts.length > 0) {
    console.log(`[AnomalyAlerts] Budget pacing: ${budgetPacingAlerts.length} client(s) over-pacing`);
    const html = buildBudgetPacingHtml(budgetPacingAlerts);
    const subject = `📈 Budget Pacing Alert — ${budgetPacingAlerts.length} client${budgetPacingAlerts.length > 1 ? 's' : ''} >20% over pace`;
    try {
      await sendEmail({ to: ABE_EMAIL, subject, html });
      console.log(`[AnomalyAlerts] ✅ Budget pacing email sent to ${ABE_EMAIL}`);
    } catch (emailErr) {
      console.error(`[AnomalyAlerts] ❌ Budget pacing email failed: ${emailErr.message}`);
    }
  } else {
    console.log('[AnomalyAlerts] Budget pacing: no clients over 20% pace');
  }

  console.log(`[AnomalyAlerts] Done. Total anomalies: ${totalAnomalies} across ${clients.length} client(s).`);
  return { clients: clients.length, anomalies: totalAnomalies, budgetAlerts: budgetPacingAlerts.length };
}

module.exports = { runAnomalyAlerts };
