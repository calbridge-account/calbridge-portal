/**
 * Weekly Performance Email Service
 * Generates and sends a branded weekly report for a single client.
 *
 * Data pulled from Snowflake:
 *   - Retail sales (ordered_revenue + shipped_revenue) from sales
 *   - Ad spend & attributed sales from ad_performance
 *   - Top/bottom ASINs by contribution margin
 *   - Active alerts from decision engine
 */
require('dotenv').config();
const { Resend } = require('resend');
const { query } = require('./snowflakeService');

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM_EMAIL  = 'ash@teamcalbridge.com';
const CC_EMAIL    = 'abe@teamcalbridge.com';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pct(current, prior) {
  if (!prior || prior === 0) return null;
  return ((current - prior) / Math.abs(prior)) * 100;
}

function fmt(n, prefix = '$') {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return `${prefix}${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtRoas(n) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return `${Number(n).toFixed(2)}x`;
}

function fmtPct(n) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return `${Number(n).toFixed(1)}%`;
}

function fmtChange(pctVal) {
  if (pctVal === null || pctVal === undefined || isNaN(pctVal)) return '<span style="color:#888">—</span>';
  const arrow = pctVal >= 0 ? '▲' : '▼';
  const color  = pctVal >= 0 ? '#2d7a27' : '#c0392b';
  return `<span style="color:${color};font-weight:600">${arrow} ${Math.abs(pctVal).toFixed(1)}%</span>`;
}

function weekLabel(date) {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

// ─── Snowflake Data Queries ────────────────────────────────────────────────────

async function fetchClientInfo(clientId) {
  const rows = await query(
    'SELECT client_id, email, name, company_name FROM clients WHERE client_id = ?',
    [clientId]
  );
  return rows[0] || null;
}

async function fetchSalesMetrics(clientId, startDate, endDate) {
  const rows = await query(`
    SELECT
      COALESCE(SUM(ordered_revenue), 0) + COALESCE(SUM(shipped_revenue), 0) AS total_retail_sales
    FROM sales
    WHERE client_id = ?
      AND order_date >= ?
      AND order_date <= ?
  `, [clientId, startDate, endDate]);
  return rows[0] ? Number(rows[0].TOTAL_RETAIL_SALES || 0) : 0;
}

async function fetchAdMetrics(clientId, startDate, endDate) {
  const rows = await query(`
    SELECT
      COALESCE(SUM(spend), 0)  AS total_spend,
      COALESCE(SUM(sales), 0)  AS total_attributed_sales
    FROM ad_performance
    WHERE client_id = ?
      AND report_date >= ?
      AND report_date <= ?
  `, [clientId, startDate, endDate]);
  if (!rows[0]) return { spend: 0, attributedSales: 0 };
  return {
    spend:          Number(rows[0].TOTAL_SPEND || 0),
    attributedSales: Number(rows[0].TOTAL_ATTRIBUTED_SALES || 0)
  };
}

async function fetchTopAsins(clientId, startDate, endDate, limit = 3) {
  const rows = await query(`
    SELECT
      asin,
      SUM(contribution_margin) AS total_cm,
      SUM(ad_spend)            AS total_ad_spend,
      SUM(revenue)             AS total_revenue
    FROM contribution_margin
    WHERE client_id = ?
      AND calc_date >= ?
      AND calc_date <= ?
    GROUP BY asin
    ORDER BY total_cm DESC
    LIMIT ?
  `, [clientId, startDate, endDate, limit]);
  return rows.map(r => ({
    asin:    r.ASIN,
    cm:      Number(r.TOTAL_CM || 0),
    spend:   Number(r.TOTAL_AD_SPEND || 0),
    revenue: Number(r.TOTAL_REVENUE || 0)
  }));
}

async function fetchBottomAsin(clientId, startDate, endDate) {
  const rows = await query(`
    SELECT
      asin,
      SUM(contribution_margin) AS total_cm,
      SUM(ad_spend)            AS total_ad_spend,
      SUM(revenue)             AS total_revenue
    FROM contribution_margin
    WHERE client_id = ?
      AND calc_date >= ?
      AND calc_date <= ?
    GROUP BY asin
    ORDER BY total_cm ASC
    LIMIT 1
  `, [clientId, startDate, endDate]);
  if (!rows.length) return null;
  const r = rows[0];
  return {
    asin:    r.ASIN,
    cm:      Number(r.TOTAL_CM || 0),
    spend:   Number(r.TOTAL_AD_SPEND || 0),
    revenue: Number(r.TOTAL_REVENUE || 0)
  };
}

// ─── Date Helpers ─────────────────────────────────────────────────────────────

function toDateStr(d) {
  return d.toISOString().slice(0, 10);
}

function getWeekRanges() {
  const now = new Date();
  // Current week: last 7 days (yesterday back 7)
  const curEnd   = new Date(now); curEnd.setUTCDate(curEnd.getUTCDate() - 1); // yesterday
  const curStart = new Date(curEnd); curStart.setUTCDate(curStart.getUTCDate() - 6);

  // Prior week: 8-14 days ago
  const priorEnd   = new Date(curStart); priorEnd.setUTCDate(priorEnd.getUTCDate() - 1);
  const priorStart = new Date(priorEnd); priorStart.setUTCDate(priorStart.getUTCDate() - 6);

  return {
    curStart:   toDateStr(curStart),
    curEnd:     toDateStr(curEnd),
    priorStart: toDateStr(priorStart),
    priorEnd:   toDateStr(priorEnd),
    curStartDate:   curStart,
    curEndDate:     curEnd,
  };
}

// ─── HTML Email Builder ────────────────────────────────────────────────────────

function buildEmailHtml({ client, metrics, topAsins, bottomAsin, alertText, weekOf }) {
  const { cur, prior } = metrics;

  const curRoas  = cur.spend > 0 ? cur.retailSales / cur.spend : 0;
  const priorRoas = prior.spend > 0 ? prior.retailSales / prior.spend : 0;
  const curAcos  = cur.attributedSales > 0 ? (cur.spend / cur.attributedSales) * 100 : 0;
  const priorAcos = prior.attributedSales > 0 ? (prior.spend / prior.attributedSales) * 100 : 0;

  const rows = [
    { label: 'Total Retail Sales',    cur: fmt(cur.retailSales),            prior: fmt(prior.retailSales),            change: fmtChange(pct(cur.retailSales, prior.retailSales)) },
    { label: 'Ad Spend',              cur: fmt(cur.spend),                  prior: fmt(prior.spend),                  change: fmtChange(pct(prior.spend, cur.spend)) }, // lower is better, inverted
    { label: 'Ad Attributed Sales',   cur: fmt(cur.attributedSales),        prior: fmt(prior.attributedSales),        change: fmtChange(pct(cur.attributedSales, prior.attributedSales)) },
    { label: 'ROAS',                  cur: fmtRoas(curRoas),                prior: fmtRoas(priorRoas),                change: fmtChange(pct(curRoas, priorRoas)) },
    { label: 'ACOS',                  cur: fmtPct(curAcos),                 prior: fmtPct(priorAcos),                 change: fmtChange(pct(priorAcos, curAcos)) }, // lower is better, inverted
  ];

  const metricsTableRows = rows.map(r => `
    <tr>
      <td style="padding:10px 14px;border-bottom:1px solid #f0ece6;font-size:14px;color:#333">${r.label}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #f0ece6;font-size:14px;text-align:right;font-weight:600;color:#2d5a27">${r.cur}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #f0ece6;font-size:14px;text-align:right;color:#888">${r.prior}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #f0ece6;font-size:14px;text-align:right">${r.change}</td>
    </tr>`).join('');

  const topAsinRows = topAsins.length > 0
    ? topAsins.map((a, i) => {
        const asinRoas = a.spend > 0 ? a.revenue / a.spend : 0;
        return `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #f0ece6;font-size:13px;color:#888">#${i + 1}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #f0ece6;font-size:13px;font-family:monospace;color:#2d5a27;font-weight:600">${a.asin}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #f0ece6;font-size:13px;text-align:right">${fmt(a.cm)}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #f0ece6;font-size:13px;text-align:right">${fmtRoas(asinRoas)}</td>
        </tr>`;
      }).join('')
    : '<tr><td colspan="4" style="padding:12px;text-align:center;color:#888;font-size:13px">No contribution margin data available this week</td></tr>';

  const bottomAsinHtml = bottomAsin
    ? `<div style="background:#fff5f5;border:1px solid #fecaca;border-radius:8px;padding:14px 18px;margin-bottom:20px">
        <span style="font-size:12px;font-weight:700;color:#dc2626;text-transform:uppercase;letter-spacing:.5px">⚠ Worst Performer</span>
        <div style="margin-top:6px;font-size:14px;color:#333">
          <strong style="font-family:monospace;color:#dc2626">${bottomAsin.asin}</strong> —
          CM: <strong>${fmt(bottomAsin.cm)}</strong>
          ${bottomAsin.cm < 0 ? '<span style="color:#dc2626;font-weight:600">(negative — losing money on each sale)</span>' : ''}
        </div>
      </div>`
    : '';

  const alertHtml = alertText
    ? `<div style="background:#fffbeb;border:1px solid #fcd34d;border-left:4px solid #f59e0b;border-radius:8px;padding:16px 18px;margin-bottom:20px">
        <span style="font-size:12px;font-weight:700;color:#92400e;text-transform:uppercase;letter-spacing:.5px">💡 This Week's Priority</span>
        <div style="margin-top:8px;font-size:14px;color:#333;line-height:1.5">${alertText}</div>
      </div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>Calbridge Weekly Report</title>
</head>
<body style="margin:0;padding:0;background:#f5f2ed;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;margin-top:20px;margin-bottom:20px">

    <!-- Header -->
    <div style="background:#2d5a27;padding:28px 32px">
      <div style="color:#d8d0c4;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">Calbridge Weekly Report</div>
      <div style="color:#ffffff;font-size:22px;font-weight:700">Week of ${weekOf}</div>
      <div style="color:rgba(216,208,196,.75);font-size:14px;margin-top:4px">${client.companyName || client.name}</div>
    </div>

    <!-- Body -->
    <div style="padding:28px 32px">

      <!-- Greeting -->
      <p style="font-size:16px;color:#333;margin:0 0 20px">
        Hi ${client.name ? client.name.split(' ')[0] : 'there'}, here's how
        <strong>${client.companyName || client.name}</strong> performed this past week.
      </p>

      <!-- Alert / Insight -->
      ${alertHtml}

      <!-- Metrics Summary -->
      <h2 style="font-size:15px;font-weight:700;color:#2d5a27;margin:0 0 12px;padding-bottom:8px;border-bottom:2px solid #2d5a27">
        📊 Weekly Performance Summary
      </h2>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:24px;border:1px solid #f0ece6;border-radius:8px;overflow:hidden">
        <thead>
          <tr style="background:#f5f2ed">
            <th style="padding:10px 14px;text-align:left;font-size:12px;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:.5px">Metric</th>
            <th style="padding:10px 14px;text-align:right;font-size:12px;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:.5px">This Week</th>
            <th style="padding:10px 14px;text-align:right;font-size:12px;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:.5px">Prior Week</th>
            <th style="padding:10px 14px;text-align:right;font-size:12px;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:.5px">Change</th>
          </tr>
        </thead>
        <tbody>
          ${metricsTableRows}
        </tbody>
      </table>

      <!-- Top Performers -->
      <h2 style="font-size:15px;font-weight:700;color:#2d5a27;margin:0 0 12px;padding-bottom:8px;border-bottom:2px solid #2d5a27">
        🏆 Top Performers
      </h2>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:20px;border:1px solid #f0ece6;border-radius:8px;overflow:hidden">
        <thead>
          <tr style="background:#f5f2ed">
            <th style="padding:8px 12px;text-align:left;font-size:12px;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:.5px">#</th>
            <th style="padding:8px 12px;text-align:left;font-size:12px;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:.5px">ASIN</th>
            <th style="padding:8px 12px;text-align:right;font-size:12px;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:.5px">Contribution Margin</th>
            <th style="padding:8px 12px;text-align:right;font-size:12px;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:.5px">ROAS</th>
          </tr>
        </thead>
        <tbody>
          ${topAsinRows}
        </tbody>
      </table>

      <!-- Worst Performer -->
      ${bottomAsinHtml}

    </div>

    <!-- Footer -->
    <div style="background:#d8d0c4;padding:20px 32px;border-top:1px solid #c8c0b4">
      <p style="margin:0 0 6px;font-size:13px;color:#5a4e3c">
        Questions? Just reply to this email — we read every one.
      </p>
      <p style="margin:0;font-size:11px;color:#8a7e6e">
        You're receiving this because you're a Calbridge client.
        To unsubscribe from weekly reports, log in to your
        <a href="https://app.teamcalbridge.com/account.html" style="color:#2d5a27">account settings</a>
        and toggle off "Receive weekly performance emails".
      </p>
    </div>

  </div>
</body>
</html>`;
}

// ─── Alert Generator ───────────────────────────────────────────────────────────

function buildAlertText({ cur, topAsins, bottomAsin }) {
  // Priority 1: negative CM on worst ASIN
  if (bottomAsin && bottomAsin.cm < 0) {
    return `<strong>${bottomAsin.asin}</strong> has a <strong>negative contribution margin</strong> of ${fmt(bottomAsin.cm)} this week. Every sale is losing money. Consider pausing ads on this ASIN or reviewing your pricing and COGS.`;
  }

  // Priority 2: ACOS above 50%
  if (cur.spend > 0 && cur.attributedSales > 0) {
    const acos = (cur.spend / cur.attributedSales) * 100;
    if (acos > 50) {
      return `Your overall <strong>ACOS is ${fmtPct(acos)}</strong> this week — well above typical break-even thresholds. Review your highest-spend campaigns and consider tightening bids or pausing underperforming ad groups.`;
    }
  }

  // Priority 3: ROAS below 2x
  if (cur.spend > 0) {
    const roas = cur.retailSales / cur.spend;
    if (roas < 2 && roas > 0) {
      return `Your <strong>ROAS of ${fmtRoas(roas)}</strong> is on the lower side this week. Consider reviewing your campaign targeting and bid strategy to improve ad efficiency.`;
    }
  }

  // Priority 4: top ASIN with great performance
  if (topAsins.length > 0) {
    const best = topAsins[0];
    const bestRoas = best.spend > 0 ? best.revenue / best.spend : 0;
    return `<strong>${best.asin}</strong> is your top performer this week with ${fmt(best.cm)} in contribution margin${bestRoas > 0 ? ` and a ${fmtRoas(bestRoas)} ROAS` : ''}. Consider increasing budget on campaigns driving this ASIN.`;
  }

  return null;
}

// ─── Main Export ──────────────────────────────────────────────────────────────

/**
 * Generate and send a weekly report for a single client.
 * @param {string} clientId
 * @param {object} [opts]
 * @param {string} [opts.overrideEmail] - Send to this address instead (for testing)
 * @returns {Promise<{ sent: boolean, skipped: boolean, reason?: string }>}
 */
async function generateAndSend(clientId, opts = {}) {
  const client = await fetchClientInfo(clientId);
  if (!client) return { sent: false, skipped: true, reason: 'Client not found' };

  const { curStart, curEnd, priorStart, priorEnd, curStartDate, curEndDate } = getWeekRanges();

  // Fetch current week
  const [curSales, curAd, curTopAsins, curBottomAsin] = await Promise.all([
    fetchSalesMetrics(clientId, curStart, curEnd),
    fetchAdMetrics(clientId, curStart, curEnd),
    fetchTopAsins(clientId, curStart, curEnd, 3),
    fetchBottomAsin(clientId, curStart, curEnd)
  ]);

  // Fetch prior week
  const [priorSales, priorAd] = await Promise.all([
    fetchSalesMetrics(clientId, priorStart, priorEnd),
    fetchAdMetrics(clientId, priorStart, priorEnd)
  ]);

  // Skip if no data at all
  const hasData = curSales > 0 || curAd.spend > 0 || curAd.attributedSales > 0;
  if (!hasData) {
    return { sent: false, skipped: true, reason: 'No data for current week' };
  }

  const metrics = {
    cur:   { retailSales: curSales,   spend: curAd.spend,   attributedSales: curAd.attributedSales },
    prior: { retailSales: priorSales, spend: priorAd.spend, attributedSales: priorAd.attributedSales }
  };

  const alertText = buildAlertText({ cur: metrics.cur, topAsins: curTopAsins, bottomAsin: curBottomAsin });

  const weekOf = weekLabel(curStartDate);

  const html = buildEmailHtml({
    client: { ...client, name: client.NAME, companyName: client.COMPANY_NAME || client.NAME, email: client.EMAIL },
    metrics,
    topAsins:   curTopAsins,
    bottomAsin: curBottomAsin,
    alertText,
    weekOf
  });

  const toEmail = opts.overrideEmail || client.EMAIL;

  await resend.emails.send({
    from:    `Calbridge <${FROM_EMAIL}>`,
    to:      [toEmail],
    cc:      opts.overrideEmail ? [] : [CC_EMAIL],
    replyTo: FROM_EMAIL,
    subject: `Your Calbridge Weekly Report — Week of ${weekOf}`,
    html
  });

  return { sent: true, skipped: false };
}

module.exports = { generateAndSend };
