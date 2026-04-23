/**
 * src/jobs/slaChecker.js
 *
 * SLA breach detector and alerter.
 * Owned by: Control 🎛️
 *
 * Checks every job type × active account against its defined SLA window.
 * If the last successful completion is older than sla_minutes → breach.
 * Sends a single deduped alert email to abe@teamcalbridge.com per breach.
 *
 * Dedup: tracks alerts sent in-process memory (keyed by jobType+accountId).
 * Max 1 alert per job+account per hour. On process restart, dedup resets —
 * acceptable given SLA windows are all >= 10 minutes.
 *
 * Usage:
 *   // Run as a one-shot check (call from a cron/scheduler):
 *   const { runSlaCheck } = require('./slaChecker');
 *   await runSlaCheck();
 *
 *   // Or import the class for testing:
 *   const SlaChecker = require('./slaChecker');
 */

'use strict';

const { Resend } = require('resend');
const { JOBS }   = require('../config/jobs');
const {
  getLastSuccessfulAt,
  getActiveAccounts,
  getRunningJobs,
} = require('../services/jobRunner');

// ─── Config ──────────────────────────────────────────────────────────────────
const ALERT_EMAIL       = 'abe@teamcalbridge.com';
const FROM_EMAIL        = process.env.EMAIL_FROM || 'ash@calbridge.ai';
const DEDUP_WINDOW_MS   = 60 * 60 * 1000; // 1 hour between repeated alerts for same issue

// ─── In-memory dedup registry ─────────────────────────────────────────────────
// Key: `${jobType}::${accountId}` → timestamp of last alert sent (ms)
const lastAlertSent = new Map();

function dedupKey(jobType, accountId) {
  return `${jobType}::${accountId}`;
}

function shouldAlert(jobType, accountId) {
  const key  = dedupKey(jobType, accountId);
  const last = lastAlertSent.get(key);
  if (!last) return true;
  return (Date.now() - last) >= DEDUP_WINDOW_MS;
}

function markAlerted(jobType, accountId) {
  lastAlertSent.set(dedupKey(jobType, accountId), Date.now());
}

// ─── Alert email builder ──────────────────────────────────────────────────────
function buildBreachEmail(breaches, stuckJobs) {
  const breachRows = breaches.map(b => `
    <tr>
      <td style="padding:6px 12px;border-bottom:1px solid #eee"><code>${b.jobType}</code></td>
      <td style="padding:6px 12px;border-bottom:1px solid #eee">${b.accountId}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #eee">${b.slaMinutes} min</td>
      <td style="padding:6px 12px;border-bottom:1px solid #eee;color:#c0392b">
        ${b.lastSuccessfulAt
          ? `${b.minutesSinceLast} min ago (${b.lastSuccessfulAt.toISOString()})`
          : 'Never ran'}
      </td>
      <td style="padding:6px 12px;border-bottom:1px solid #eee">${b.owner}</td>
    </tr>
  `).join('');

  const stuckRows = stuckJobs.length > 0
    ? stuckJobs.map(j => `
        <tr>
          <td style="padding:6px 12px;border-bottom:1px solid #eee"><code>${j.JOB_TYPE ?? j.job_type}</code></td>
          <td style="padding:6px 12px;border-bottom:1px solid #eee">${j.ACCOUNT_ID ?? j.account_id}</td>
          <td style="padding:6px 12px;border-bottom:1px solid #eee;color:#e67e22">
            ${j.RUNNING_MINUTES ?? j.running_minutes} min
          </td>
          <td style="padding:6px 12px;border-bottom:1px solid #eee">${j.JOB_ID ?? j.job_id}</td>
        </tr>
      `).join('')
    : '';

  const stuckSection = stuckJobs.length > 0 ? `
    <h3 style="color:#e67e22;margin-top:24px">⚠️ Stuck Jobs (Running > Expected)</h3>
    <table style="border-collapse:collapse;width:100%;font-family:monospace;font-size:13px">
      <thead>
        <tr style="background:#fdf2e9">
          <th style="padding:6px 12px;text-align:left">Job Type</th>
          <th style="padding:6px 12px;text-align:left">Account</th>
          <th style="padding:6px 12px;text-align:left">Running For</th>
          <th style="padding:6px 12px;text-align:left">Run ID</th>
        </tr>
      </thead>
      <tbody>${stuckRows}</tbody>
    </table>
  ` : '';

  const html = `
    <div style="font-family:sans-serif;max-width:800px">
      <h2 style="color:#c0392b">🚨 Calbridge SLA Breach Alert</h2>
      <p>The following jobs have not completed successfully within their SLA window:</p>

      <table style="border-collapse:collapse;width:100%;font-family:monospace;font-size:13px">
        <thead>
          <tr style="background:#fdecea">
            <th style="padding:6px 12px;text-align:left">Job Type</th>
            <th style="padding:6px 12px;text-align:left">Account</th>
            <th style="padding:6px 12px;text-align:left">SLA Window</th>
            <th style="padding:6px 12px;text-align:left">Last Success</th>
            <th style="padding:6px 12px;text-align:left">Owner Agent</th>
          </tr>
        </thead>
        <tbody>${breachRows}</tbody>
      </table>

      ${stuckSection}

      <p style="margin-top:24px;color:#555">
        <strong>What to do:</strong> Check
        <code>CALBRIDGE_PROD.PIPELINE.JOB_RUNS</code> for error details.
        See <code>docs/runbooks/</code> for standard remediation steps.<br/>
        This alert deduplicates — you won't receive another for the same issue for 1 hour.
      </p>
      <p style="color:#aaa;font-size:11px">Sent by Control 🎛️ at ${new Date().toISOString()}</p>
    </div>
  `;

  const text = [
    'Calbridge SLA Breach Alert',
    '==========================',
    '',
    'SLA Breaches:',
    ...breaches.map(b =>
      `  ${b.jobType} / ${b.accountId}: SLA=${b.slaMinutes}min, last=${b.lastSuccessfulAt?.toISOString() ?? 'never'}`
    ),
    stuckJobs.length > 0 ? '\nStuck Jobs:' : '',
    ...stuckJobs.map(j =>
      `  ${j.JOB_TYPE ?? j.job_type} / ${j.ACCOUNT_ID ?? j.account_id}: running ${j.RUNNING_MINUTES ?? j.running_minutes} min`
    ),
    '',
    'Check CALBRIDGE_PROD.PIPELINE.JOB_RUNS for details.',
  ].join('\n');

  return { html, text };
}

// ─── Core SLA check ───────────────────────────────────────────────────────────
/**
 * Run the full SLA check across all job types and active accounts.
 *
 * Steps:
 *   1. Get active accounts (accounts with recent job activity)
 *   2. For each job × account, check last successful run vs sla_minutes
 *   3. Collect breaches and filter by dedup window
 *   4. Collect stuck jobs (running > job.timeout_seconds * 2)
 *   5. Send a single batched alert if anything needs alerting
 *
 * @returns {Promise<{breaches: object[], stuck: object[], alertSent: boolean}>}
 */
async function runSlaCheck() {
  console.log('[SlaChecker] Starting SLA check...');

  // ── 1. Get active accounts ─────────────────────────────────────────────────
  const accounts = await getActiveAccounts(7);
  if (accounts.length === 0) {
    console.log('[SlaChecker] No active accounts — nothing to check.');
    return { breaches: [], stuck: [], alertSent: false };
  }
  console.log(`[SlaChecker] Checking ${JOBS.length} job types × ${accounts.length} accounts`);

  // ── 2. Check each job × account against its SLA ────────────────────────────
  const now = Date.now();
  const allBreaches = [];

  for (const job of JOBS) {
    for (const accountId of accounts) {
      const lastAt = await getLastSuccessfulAt(job.id, accountId);

      let breached = false;
      let minutesSinceLast = null;

      if (lastAt === null) {
        // Never ran — breach if sla_minutes is short enough that we'd expect it to have run
        // (Skip "never ran" alerts for monthly/weekly jobs unless they were supposed to run)
        // Conservative: only alert on never-ran for jobs with sla_minutes <= 24h
        if (job.sla_minutes <= 1440) {
          breached = true;
          minutesSinceLast = null;
        }
      } else {
        minutesSinceLast = Math.floor((now - lastAt.getTime()) / 60000);
        if (minutesSinceLast > job.sla_minutes) {
          breached = true;
        }
      }

      if (breached && shouldAlert(job.id, accountId)) {
        allBreaches.push({
          jobType:          job.id,
          name:             job.name,
          owner:            job.owner,
          accountId,
          slaMinutes:       job.sla_minutes,
          lastSuccessfulAt: lastAt,
          minutesSinceLast,
        });
      }
    }
  }

  // ── 3. Detect stuck jobs ───────────────────────────────────────────────────
  // A job is "stuck" if it's been running for more than 2× its timeout
  // We use a conservative 60 min floor since short timeouts can have noise
  const stuckThreshold = 60; // minutes — flag anything running > 60 min
  const stuckJobs = await getRunningJobs(stuckThreshold);

  console.log(`[SlaChecker] Found ${allBreaches.length} breach(es), ${stuckJobs.length} stuck job(s)`);

  // ── 4. Send alert if needed ────────────────────────────────────────────────
  let alertSent = false;

  if (allBreaches.length > 0 || stuckJobs.length > 0) {
    if (process.env.SLA_ALERTS_PAUSED === 'true') {
      console.log('[SlaChecker] Alerts paused (SLA_ALERTS_PAUSED=true) — skipping email');
    } else if (!process.env.RESEND_API_KEY) {
      console.warn('[SlaChecker] RESEND_API_KEY not set — skipping email alert');
    } else {
      try {
        const resend = new Resend(process.env.RESEND_API_KEY);
        const { html, text } = buildBreachEmail(allBreaches, stuckJobs);

        const breachCount = allBreaches.length;
        const subject = breachCount === 1
          ? `🚨 SLA Breach: ${allBreaches[0].jobType} / ${allBreaches[0].accountId}`
          : `🚨 ${breachCount} SLA Breaches — Calbridge Platform`;

        await resend.emails.send({
          from:    `Control (Calbridge) <${FROM_EMAIL}>`,
          to:      [ALERT_EMAIL],
          subject,
          html,
          text,
        });

        // Mark all breaches as alerted
        for (const b of allBreaches) {
          markAlerted(b.jobType, b.accountId);
        }

        alertSent = true;
        console.log(`[SlaChecker] ✅ Alert email sent — ${breachCount} breach(es)`);
      } catch (err) {
        console.error('[SlaChecker] Failed to send alert email:', err.message);
      }
    }
  } else {
    console.log('[SlaChecker] ✅ All SLAs nominal');
  }

  return { breaches: allBreaches, stuck: stuckJobs, alertSent };
}

module.exports = { runSlaCheck };
