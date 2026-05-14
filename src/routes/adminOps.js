/**
 * Admin Operations routes
 * Ash Operations monitor + Platform Cost tracker
 */
const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs').promises;
const { exec: cpExec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(cpExec);
const { query } = require('../services/snowflakeService');

// Admin auth middleware (mirrors admin.js)
function requireAdmin(req, res, next) {
  if (!req.session?.adminId) return res.status(401).json({ error: 'Admin authentication required' });
  next();
}

// Helper: safe exec (no shell injection — commands are hardcoded, no user input)
async function safeExec(cmd, cwd) {
  try {
    const { stdout } = await execAsync(cmd, { cwd: cwd || '/home/azureuser/.openclaw/workspace', timeout: 10000 });
    return stdout.trim();
  } catch (err) {
    return null;
  }
}

// Helper: fetch with timeout
async function safeFetch(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timer);
    return res;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

// ─────────────────────────────────────────────
// GET /admin/ash-ops/data
// Returns all Ash Operations dashboard data
// ─────────────────────────────────────────────
router.get('/ash-ops/data', requireAdmin, async (req, res, next) => {
  try {
    const workspace = '/home/azureuser/.openclaw/workspace';
    const results = {};

    // 1. OpenRouter — Ash's key (openclaw-dev) via management key
    try {
      const mgmtKey = process.env.OPENROUTER_MANAGEMENT_KEY;
      if (!mgmtKey) throw new Error('No OPENROUTER_MANAGEMENT_KEY configured');

      const [keysRes, creditsRes] = await Promise.all([
        safeFetch('https://openrouter.ai/api/v1/keys',    { headers: { Authorization: `Bearer ${mgmtKey}` } }),
        safeFetch('https://openrouter.ai/api/v1/credits', { headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` } })
      ]);

      const keysData    = keysRes.ok    ? await keysRes.json()    : null;
      const creditsData = creditsRes.ok ? await creditsRes.json() : null;

      const ashKey = (keysData?.data || []).find(k => k.name === 'openclaw-dev');
      const totalCredits = parseFloat(creditsData?.data?.total_credits || 0);
      const totalUsed    = parseFloat(creditsData?.data?.total_usage   || 0);

      results.openrouter = {
        name:         ashKey?.name || 'openclaw-dev',
        usageMonthly: parseFloat(ashKey?.usage_monthly || 0),
        usageDaily:   parseFloat(ashKey?.usage_daily   || 0),
        usageAllTime: parseFloat(ashKey?.usage         || 0),
        totalCredits,
        remaining:    totalCredits - totalUsed
      };
    } catch (err) {
      results.openrouter = { error: err.message };
    }

    results.azureVmCost = parseFloat(process.env.AZURE_VM_MONTHLY_COST || '50');

    // 2. Job Status — last 10 jobs
    try {
      const jobs = await query(`
        SELECT log_id, client_id, job_type, status, records_written, started_at, completed_at, error_message
        FROM ingestion_log
        ORDER BY started_at DESC
        LIMIT 10
      `);
      results.recentJobs = jobs.map(r => ({
        logId:          r.LOG_ID,
        clientId:       r.CLIENT_ID,
        jobType:        r.JOB_TYPE,
        status:         r.STATUS,
        recordsWritten: r.RECORDS_WRITTEN,
        startedAt:      r.STARTED_AT,
        completedAt:    r.COMPLETED_AT,
        errorMessage:   r.ERROR_MESSAGE
      }));
    } catch (err) {
      results.recentJobs = { error: err.message };
    }

    // Job counts for today
    try {
      const today = await query(`
        SELECT 
          SUM(CASE WHEN status = 'queued'  THEN 1 ELSE 0 END) as queued,
          SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) as active,
          SUM(CASE WHEN status = 'success' AND completed_at >= CURRENT_DATE THEN 1 ELSE 0 END) as completed_today,
          SUM(CASE WHEN status = 'failed'  AND started_at  >= CURRENT_DATE THEN 1 ELSE 0 END) as failed_today
        FROM ingestion_log
      `);
      results.jobCounts = today[0] ? {
        queued:         Number(today[0].QUEUED || 0),
        active:         Number(today[0].ACTIVE || 0),
        completedToday: Number(today[0].COMPLETED_TODAY || 0),
        failedToday:    Number(today[0].FAILED_TODAY || 0)
      } : { queued: 0, active: 0, completedToday: 0, failedToday: 0 };
    } catch (err) {
      results.jobCounts = { error: err.message };
    }

    // 3. Scheduler Status — last successful sync per client
    try {
      const syncRows = await query(`
        SELECT client_id, MAX(completed_at) as last_sync
        FROM ingestion_log
        WHERE status = 'success'
        GROUP BY client_id
        ORDER BY last_sync DESC
      `);
      results.lastSyncPerClient = syncRows.map(r => ({
        clientId: r.CLIENT_ID,
        lastSync: r.LAST_SYNC
      }));

      // Next scheduled run = last overall success + 6 hours
      if (syncRows.length > 0) {
        const allSyncs = syncRows.map(r => r.LAST_SYNC).filter(Boolean);
        if (allSyncs.length > 0) {
          const latestSync = new Date(Math.max(...allSyncs.map(d => new Date(d).getTime())));
          results.nextScheduledRun = new Date(latestSync.getTime() + 6 * 60 * 60 * 1000).toISOString();
        } else {
          results.nextScheduledRun = null;
        }
      } else {
        results.nextScheduledRun = null;
      }
    } catch (err) {
      results.lastSyncPerClient = { error: err.message };
      results.nextScheduledRun = null;
    }

    // 4. Documents Library
    try {
      const docsDir = path.join(workspace, 'docs');
      const files = await fs.readdir(docsDir);
      const mdFiles = files.filter(f => f.endsWith('.md'));
      const docs = await Promise.all(mdFiles.map(async (filename) => {
        try {
          const stat = await fs.stat(path.join(docsDir, filename));
          return {
            filename,
            lastModified: stat.mtime.toISOString(),
            size: stat.size,
            viewUrl: `/admin/docs/${encodeURIComponent(filename)}`
          };
        } catch {
          return { filename, lastModified: null, size: null, viewUrl: null };
        }
      }));
      results.docs = docs.sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));
    } catch (err) {
      results.docs = { error: err.message };
    }

    // 5. Memory & Activity — memory files
    try {
      const memDir = path.join(workspace, 'memory');
      const memFiles = await fs.readdir(memDir);
      const memoryFiles = await Promise.all(memFiles.map(async (filename) => {
        try {
          const stat = await fs.stat(path.join(memDir, filename));
          return { filename, lastModified: stat.mtime.toISOString(), size: stat.size };
        } catch {
          return { filename, lastModified: null, size: null };
        }
      }));
      results.memoryFiles = memoryFiles.sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));
    } catch (err) {
      results.memoryFiles = { error: err.message };
    }

    // 6. Git info
    const [commits, diskUsage, branch, gitStatus, lastPush] = await Promise.all([
      safeExec('git log --oneline -5', workspace),
      safeExec('du -sh /home/azureuser/.openclaw/workspace', workspace),
      safeExec('git branch --show-current', workspace),
      safeExec('git status --short', workspace),
      safeExec('git log -1 --format="%ar by %an — %s"', workspace)
    ]);

    results.git = {
      commits:      commits ? commits.split('\n').filter(Boolean) : [],
      diskUsage:    diskUsage ? diskUsage.split('\t')[0] : 'N/A',
      branch:       branch || 'unknown',
      status:       gitStatus || '',
      lastPush:     lastPush || 'N/A'
    };

    res.json(results);
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────
// Helper: get Azure AD bearer token
// ─────────────────────────────────────────────
async function getAzureToken(resource = 'https://management.azure.com/') {
  const { AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET } = process.env;
  if (!AZURE_TENANT_ID || !AZURE_CLIENT_ID || !AZURE_CLIENT_SECRET) throw new Error('Azure credentials not configured');

  const res = await safeFetch(
    `https://login.microsoftonline.com/${AZURE_TENANT_ID}/oauth2/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type:    'client_credentials',
        client_id:     AZURE_CLIENT_ID,
        client_secret: AZURE_CLIENT_SECRET,
        resource
      }).toString()
    },
    10000
  );
  if (!res.ok) throw new Error(`Azure auth failed: ${res.status}`);
  const data = await res.json();
  return data.access_token;
}

// ─────────────────────────────────────────────
// GET /admin/platform-costs/data
// Returns all Platform Costs data
// ─────────────────────────────────────────────
router.get('/platform-costs/data', requireAdmin, async (req, res, next) => {
  try {
    const results = {};

    // Month boundaries for cost queries
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const monthEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];

    // Manual / env var costs (fallback for anything not auto-fetched)
    results.manualCosts = {
      azureVm:   parseFloat(process.env.AZURE_VM_MONTHLY_COST || '0'),
      domainSsl: parseFloat(process.env.DOMAIN_ANNUAL_COST    || '0') / 12,
      github:    parseFloat(process.env.GITHUB_MONTHLY_COST   || '0')
    };

    // ── Azure actual cost (Cost Management API) ──
    try {
      const { AZURE_SUBSCRIPTION_ID } = process.env;
      if (!AZURE_SUBSCRIPTION_ID) throw new Error('AZURE_SUBSCRIPTION_ID not set');

      const token = await getAzureToken();
      const url = `https://management.azure.com/subscriptions/${AZURE_SUBSCRIPTION_ID}/providers/Microsoft.CostManagement/query?api-version=2023-11-01`;

      const costRes = await safeFetch(url, {
        method: 'POST',
        headers: {
          Authorization:  `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          type: 'ActualCost',
          timeframe: 'Custom',
          timePeriod: { from: `${monthStart}T00:00:00Z`, to: `${monthEnd}T23:59:59Z` },
          dataset: {
            granularity: 'None',
            aggregation: { totalCost: { name: 'Cost', function: 'Sum' } }
          }
        })
      }, 15000);

      if (!costRes.ok) {
        const errText = await costRes.text();
        throw new Error(`Azure Cost API ${costRes.status}: ${errText.substring(0, 200)}`);
      }

      const costData = await costRes.json();
      const rows = costData?.properties?.rows || [];
      const totalCost = rows.length > 0 ? parseFloat(rows[0][0] || 0) : 0;
      const currency  = rows.length > 0 ? (rows[0][1] || 'USD') : 'USD';

      results.azure = { totalCostUsd: totalCost, currency, source: 'Azure Cost Management API', period: `${monthStart} → ${monthEnd}` };
      // Override the manual fallback with real data
      results.manualCosts.azureVm = totalCost;
    } catch (err) {
      results.azure = { error: err.message };
    }

    // ── Snowflake compute cost ──
    try {
      const computeRows = await query(`
        SELECT
          SUM(CREDITS_USED) as credits_used,
          SUM(CREDITS_USED) * 2 as estimated_cost_usd
        FROM SNOWFLAKE.ACCOUNT_USAGE.WAREHOUSE_METERING_HISTORY
        WHERE START_TIME >= DATE_TRUNC('month', CURRENT_DATE)
      `);
      if (computeRows.length > 0 && computeRows[0].CREDITS_USED !== null) {
        results.snowflakeCompute = {
          creditsUsed:      parseFloat(computeRows[0].CREDITS_USED || 0),
          estimatedCostUsd: parseFloat(computeRows[0].ESTIMATED_COST_USD || 0)
        };
      } else {
        results.snowflakeCompute = { error: 'No data yet this month' };
      }
    } catch (err) {
      results.snowflakeCompute = { error: err.message };
    }

    // ── Snowflake storage cost ──
    try {
      const storageRows = await query(`
        SELECT
          STAGE_BYTES / (1024.0*1024*1024*1024) * 23 as estimated_storage_cost_usd
        FROM SNOWFLAKE.ACCOUNT_USAGE.STORAGE_USAGE
        WHERE USAGE_DATE >= DATE_TRUNC('month', CURRENT_DATE)
        ORDER BY USAGE_DATE DESC
        LIMIT 1
      `);
      if (storageRows.length > 0 && storageRows[0].ESTIMATED_STORAGE_COST_USD !== null) {
        results.snowflakeStorage = { estimatedCostUsd: parseFloat(storageRows[0].ESTIMATED_STORAGE_COST_USD || 0) };
      } else {
        results.snowflakeStorage = { error: 'No data yet this month' };
      }
    } catch (err) {
      results.snowflakeStorage = { error: err.message };
    }

    // ── OpenRouter — per-key spend via management key ──
    try {
      const mgmtKey = process.env.OPENROUTER_MANAGEMENT_KEY;
      if (!mgmtKey) throw new Error('No OPENROUTER_MANAGEMENT_KEY configured');

      // Fetch all keys + account credits in parallel
      const [keysRes, creditsRes] = await Promise.all([
        safeFetch('https://openrouter.ai/api/v1/keys',    { headers: { Authorization: `Bearer ${mgmtKey}` } }),
        safeFetch('https://openrouter.ai/api/v1/credits', { headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` } })
      ]);

      if (!keysRes.ok) throw new Error(`OpenRouter keys API returned ${keysRes.status}`);
      const keysData    = await keysRes.json();
      const creditsData = creditsRes.ok ? await creditsRes.json() : null;

      const keys = (keysData.data || []).map(k => ({
        name:         k.name,
        usageMonthly: parseFloat(k.usage_monthly || 0),
        usageDaily:   parseFloat(k.usage_daily   || 0),
        usageAllTime: parseFloat(k.usage         || 0),
        disabled:     k.disabled
      }));

      const totalCredits = parseFloat(creditsData?.data?.total_credits || 0);
      const totalUsed    = parseFloat(creditsData?.data?.total_usage   || 0);
      const remaining    = totalCredits - totalUsed;

      // Split by purpose — only calbridge-portal belongs on platform costs
      // openclaw-dev is Ash's operational key and belongs on Ash Ops only
      const appKeys  = keys.filter(k => k.name !== 'openclaw-dev');
      const ashKeys  = keys.filter(k => k.name === 'openclaw-dev');

      results.openrouter = {
        keys,
        appKeys,
        ashKeys,
        totalMonthly: appKeys.reduce((sum, k) => sum + k.usageMonthly, 0),
        totalCredits,
        totalUsed,
        remaining
      };
    } catch (err) {
      results.openrouter = { error: err.message };
    }

    // ── Resend email count + cost ──
    try {
      const resendKey = process.env.RESEND_API_KEY;
      if (!resendKey) throw new Error('No RESEND_API_KEY configured');

      const resendRes = await safeFetch('https://api.resend.com/emails?limit=100', {
        headers: { Authorization: `Bearer ${resendKey}` }
      });
      if (!resendRes.ok) throw new Error(`Resend API returned ${resendRes.status}`);

      const resendData = await resendRes.json();
      const cutoff = new Date(monthStart);
      const emails = (resendData.data || []).filter(e => new Date(e.created_at) >= cutoff);
      const emailCount = emails.length;
      const FREE_TIER  = 3000;
      const overFree   = Math.max(0, emailCount - FREE_TIER);
      results.resend = {
        emailsThisMonth:  emailCount,
        estimatedCostUsd: parseFloat((overFree * 0.001).toFixed(2)),
        freeTierUsed:     Math.min(emailCount, FREE_TIER),
        overFree
      };
    } catch (err) {
      results.resend = { error: err.message };
    }

    // ── GitHub plan ──
    try {
      const ghToken = process.env.GITHUB_BILLING_TOKEN || process.env.GITHUB_TOKEN;
      if (!ghToken) throw new Error('No GitHub token configured');
      const ghRes = await safeFetch('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${ghToken}`, Accept: 'application/vnd.github+json' }
      });
      if (!ghRes.ok) throw new Error(`GitHub API returned ${ghRes.status}`);
      const ghData = await ghRes.json();
      // GitHub Free for users = $0. Teams = $4/user/mo. Enterprise = custom.
      // We can detect plan via /user — 'plan' field on authenticated user
      const plan = ghData.plan?.name || 'free';
      const monthlyCost = plan === 'free' ? 0 : plan === 'team' ? 4 : null;
      results.github = { plan, monthlyCost, login: ghData.login };
      if (monthlyCost !== null) results.manualCosts.github = monthlyCost;
    } catch (err) {
      results.github = { error: err.message };
    }

    // ── Active clients count ──
    try {
      const clientRows = await query(`SELECT COUNT(*) as cnt FROM clients WHERE status = 'active'`);
      results.activeClients = Number(clientRows[0]?.CNT || 0);
    } catch (err) {
      results.activeClients = { error: err.message };
    }

    // ── Stripe subscriptions + MRR ──
    try {
      const stripeKey = process.env.STRIPE_SECRET_KEY;
      if (!stripeKey) throw new Error('No STRIPE_SECRET_KEY configured');

      const stripeRes = await safeFetch('https://api.stripe.com/v1/subscriptions?status=active&limit=100', {
        headers: { Authorization: `Bearer ${stripeKey}` }
      });
      if (!stripeRes.ok) throw new Error(`Stripe API returned ${stripeRes.status}`);

      const stripeData = await stripeRes.json();
      const subs = stripeData.data || [];
      const mrr  = subs.reduce((sum, sub) => {
        const item   = sub.items?.data?.[0];
        if (!item) return sum;
        const amount = item.price?.unit_amount || 0;
        const interval = item.price?.recurring?.interval;
        return sum + (interval === 'year' ? amount / 12 : amount);
      }, 0);

      const planMap = {};
      subs.forEach(sub => {
        const name = sub.items?.data?.[0]?.price?.nickname || sub.items?.data?.[0]?.price?.id || 'Unknown';
        planMap[name] = (planMap[name] || 0) + 1;
      });

      results.stripe = {
        activeSubscriptions: subs.length,
        mrr:                 mrr / 100,
        planDistribution:    planMap
      };
    } catch (err) {
      results.stripe = { error: err.message };
    }

    res.json(results);
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────
// GET /admin/docs
// List docs/ directory
// ─────────────────────────────────────────────
router.get('/docs', requireAdmin, async (req, res, next) => {
  try {
    const docsDir = path.join('/home/azureuser/.openclaw/workspace', 'docs');
    const files = await fs.readdir(docsDir);
    const mdFiles = files.filter(f => f.endsWith('.md'));
    const docs = await Promise.all(mdFiles.map(async (filename) => {
      const stat = await fs.stat(path.join(docsDir, filename));
      return { filename, lastModified: stat.mtime.toISOString(), size: stat.size };
    }));
    res.json(docs.sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified)));
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────
// GET /admin/docs/:filename
// Serve a specific doc file
// ─────────────────────────────────────────────
router.get('/docs/:filename', requireAdmin, async (req, res, next) => {
  try {
    // Sanitize: only allow alphanumeric, hyphen, underscore, dot
    const filename = req.params.filename.replace(/[^a-zA-Z0-9._-]/g, '');
    if (!filename.endsWith('.md')) return res.status(400).json({ error: 'Only .md files allowed' });

    const filePath = path.join('/home/azureuser/.openclaw/workspace', 'docs', filename);
    // Prevent path traversal
    const docsDir = path.resolve('/home/azureuser/.openclaw/workspace/docs');
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(docsDir)) return res.status(403).json({ error: 'Access denied' });

    const content = await fs.readFile(resolved, 'utf8');
    res.type('text/plain').send(content);
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'File not found' });
    next(err);
  }
});

// ─────────────────────────────────────────────
// GET /admin/git-status
// Git log and status
// ─────────────────────────────────────────────
router.get('/git-status', requireAdmin, async (req, res, next) => {
  try {
    const workspace = '/home/azureuser/.openclaw/workspace';
    const [commits, branch, status, lastPush] = await Promise.all([
      safeExec('git log --oneline -10', workspace),
      safeExec('git branch --show-current', workspace),
      safeExec('git status --short', workspace),
      safeExec('git log -1 --format="%ar by %an — %s"', workspace)
    ]);

    res.json({
      commits:  commits ? commits.split('\n').filter(Boolean) : [],
      branch:   branch || 'unknown',
      status:   status || '',
      lastPush: lastPush || 'N/A'
    });
  } catch (err) { next(err); }
});

// ─────────────────────────────
// POST /admin/trigger-sync
// Manually kick off the full ingestion pipeline for all active clients.
// Calls submit_amazon_reports → poll_report_status → download_completed_reports in sequence.
// Designed to be called from an external scheduler (e.g. OpenClaw cron) as a safety net
// so the pipeline runs even if the in-process node-cron timer drifts or the server restarts.
// Returns immediately after submitting; processing continues in the background.
// Auth: requireAdmin (session cookie) OR internal token (INTERNAL_SYNC_TOKEN in .env)
// ─────────────────────────────
router.post('/trigger-sync', async (req, res, next) => {
  // Allow admin session OR static internal token (for cron/automation)
  const internalToken = process.env.INTERNAL_SYNC_TOKEN;
  const providedToken = req.headers['x-internal-token'] || req.body?.token;
  const isAdmin       = !!req.session?.adminId;
  const isTokenValid  = internalToken && providedToken === internalToken;

  if (!isAdmin && !isTokenValid) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Respond immediately so the caller doesn't time out waiting for the full pipeline
  res.json({ ok: true, message: 'Sync triggered', triggeredAt: new Date().toISOString() });

  // Run the full ingestion pipeline in the background (non-blocking)
  setImmediate(async () => {
    const start = Date.now();
    try {
      const { submitAmazonReports, pollReportStatus, downloadCompletedReports } = require('../jobs/reportOrchestrator');
      const { clearStaleRunningJobs } = require('../services/jobRunner');

      console.log('[trigger-sync] Starting manual sync pipeline...');

      // Clear any zombie locks before running
      await clearStaleRunningJobs(5);

      // Phase 1: submit new report requests to Amazon (last 3 days)
      const submitted = await submitAmazonReports({ triggeredBy: 'manual', daysBack: 3 }).catch(e => {
        console.error('[trigger-sync] submitAmazonReports failed:', e.message);
        return null;
      });

      // Phase 2: poll status of all pending reports
      const polled = await pollReportStatus({ triggeredBy: 'manual' }).catch(e => {
        console.error('[trigger-sync] pollReportStatus failed:', e.message);
        return null;
      });

      // Phase 3: download any reports that are ready
      const downloaded = await downloadCompletedReports({ triggeredBy: 'manual' }).catch(e => {
        console.error('[trigger-sync] downloadCompletedReports failed:', e.message);
        return null;
      });

      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.log(
        `[trigger-sync] \u2705 Done in ${elapsed}s \u2014` +
        ` submitted=${submitted?.totalQueued ?? '?'}` +
        ` polled=${polled?.polled ?? '?'}` +
        ` downloaded=${downloaded?.downloaded ?? '?'}` +
        ` rows=${downloaded?.rowsWritten ?? '?'}`
      );
    } catch (err) {
      console.error('[trigger-sync] Pipeline error:', err.message);
    }
  });
});

// POST /admin/trigger-vendor-backfill
// Full historical backfill — probes earliest available date per report type,
// then walks 14-day DAY-grain chunks from earliest to today.
// Body: { clientId: '...' (optional, defaults to all active vendor clients) }
router.post('/trigger-vendor-backfill', async (req, res, next) => {
  const internalToken = process.env.INTERNAL_SYNC_TOKEN;
  const providedToken = req.headers['x-internal-token'] || req.body?.token;
  const isAdmin       = !!req.session?.adminId;
  const isTokenValid  = internalToken && providedToken === internalToken;
  if (!isAdmin && !isTokenValid) return res.status(401).json({ error: 'Unauthorized' });

  const { clientId } = req.body;
  res.json({ ok: true, message: 'Vendor backfill triggered (probes limits then runs)', triggeredAt: new Date().toISOString() });

  setImmediate(async () => {
    try {
      const { runVendorBackfill } = require('../jobs/vendorBackfill');
      const { query: _q } = require('../services/snowflakeService');
      const targetClients = clientId
        ? [{ CLIENT_ID: clientId }]
        : await _q(`SELECT DISTINCT client_id FROM CALBRIDGE_PROD.APP.amazon_connections WHERE connection_type = 'vendor' AND is_active = TRUE`);
      for (const row of targetClients) {
        const cid = row.CLIENT_ID || row.client_id;
        console.log(`[vendor-backfill] Starting full backfill for ${cid}`);
        await runVendorBackfill(cid).catch(e =>
          console.error(`[vendor-backfill] ${cid} failed:`, e.message));
      }
      console.log('[vendor-backfill] ✅ All clients done');
    } catch (err) {
      console.error('[vendor-backfill] Error:', err.message);
    }
  });
});

// POST /admin/trigger-vendor-sync
// Manually kick off vendor/retail ingestion for all active clients.
router.post('/trigger-vendor-sync', async (req, res, next) => {
  const internalToken = process.env.INTERNAL_SYNC_TOKEN;
  const providedToken = req.headers['x-internal-token'] || req.body?.token;
  const isAdmin       = !!req.session?.adminId;
  const isTokenValid  = internalToken && providedToken === internalToken;

  if (!isAdmin && !isTokenValid) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  res.json({ ok: true, message: 'Vendor sync triggered', triggeredAt: new Date().toISOString() });

  setImmediate(async () => {
    try {
      const { runJob } = require('../jobs/cron');
      console.log('[trigger-vendor-sync] Starting vendor ingestion...');
      await runJob('ingest_vendor_reports', { triggeredBy: 'manual' });
      console.log('[trigger-vendor-sync] ✅ Done');
    } catch (err) {
      console.error('[trigger-vendor-sync] Failed:', err.message);
    }
  });
});

// ─────────────────────────────────────────────
// GET /admin/traffic
// Parse nginx access logs and return traffic analytics
// ─────────────────────────────────────────────
router.get('/traffic', requireAdmin, async (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  try {
    const readline = require('readline');
    const { createReadStream } = require('fs');

    // Nginx log regex: IP - - [date] "METHOD URL PROTO" STATUS bytes "referrer" "ua" "host"
    // Supports both old format (no host) and new calbridge format (with host at end)
    const LOG_RE = /^(\S+) \S+ \S+ \[([^\]]+)\] "(\S+) (\S+) \S+" (\d+) \d+ "([^"]*)" "([^"]*)"(?:\s+"([^"]*)")?/;

    // IPs to skip
    const SKIP_IPS = new Set(['172.179.10.131']);

    // URL fragments to skip (case-insensitive)
    const SKIP_URL_PATTERNS = ['health', 'favicon', 'robots', 'wp-admin', '.env', '.git', 'xmlrpc', 'phpmyadmin', 'SDK', 'wp-login'];

    // User-agent fragments to skip (case-insensitive)
    const SKIP_UA_PATTERNS = ['bot', 'crawler', 'spider', 'curl', 'wget', 'python', 'java', 'go-http', 'check_http', 'axios'];

    // Self-referral domains to skip
    const SELF_DOMAINS = ['teamcalbridge.com', 'calbridge.ai'];

    // Month name map for nginx date format
    const MONTH_MAP = { Jan:0, Feb:1, Mar:2, Apr:3, May:4, Jun:5, Jul:6, Aug:7, Sep:8, Oct:9, Nov:10, Dec:11 };

    function parseNginxDate(dateStr) {
      // 14/May/2026:20:31:40 +0000
      const m = dateStr.match(/^(\d{2})\/(\w{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2})/);
      if (!m) return null;
      const [, day, mon, year, hh, mm, ss] = m;
      return new Date(Date.UTC(+year, MONTH_MAP[mon], +day, +hh, +mm, +ss));
    }

    function extractDomain(referer) {
      if (!referer || referer === '-') return null;
      try {
        const url = new URL(referer);
        return url.hostname.replace(/^www\./, '');
      } catch { return null; }
    }

    function shouldSkip(ip, url, ua, status) {
      if (SKIP_IPS.has(ip)) return true;
      const statusNum = parseInt(status, 10);
      if (statusNum >= 400) return true;

      const urlLower = url.toLowerCase();
      // Skip .php except /analytics
      if (urlLower.includes('.php') && !urlLower.includes('/analytics')) return true;
      for (const pat of SKIP_URL_PATTERNS) {
        if (urlLower.includes(pat.toLowerCase())) return true;
      }

      const uaLower = ua.toLowerCase();
      for (const pat of SKIP_UA_PATTERNS) {
        if (uaLower.includes(pat.toLowerCase())) return true;
      }

      return false;
    }

    function isLandingPage(url) {
      const u = url.split('?')[0];
      return u === '/' || u === '/landing.html' || u === '';
    }

    function isSignup(method, url, status) {
      const u = url.split('?')[0];
      const s = parseInt(status, 10);
      if (u === '/signup.html' && method === 'GET' && s === 200) return true;
      if (u === '/auth/register' && method === 'POST' && s === 200) return true;
      return false;
    }

    // Read up to last N lines from a file
    async function readLastLines(filePath, maxLines) {
      const lines = [];
      try {
        await fs.access(filePath);
      } catch {
        return lines; // file doesn't exist
      }
      return new Promise((resolve, reject) => {
        const stream = createReadStream(filePath, { encoding: 'utf8' });
        const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
        rl.on('line', (line) => {
          lines.push(line);
          if (lines.length > maxLines) lines.shift();
        });
        rl.on('close', () => resolve(lines));
        rl.on('error', reject);
        stream.on('error', reject);
      });
    }

    // Process log lines into structured entries
    function processLines(lines) {
      const entries = [];
      for (const line of lines) {
        if (!line.trim()) continue;
        const m = LOG_RE.exec(line);
        if (!m) continue;
        const [, ip, dateStr, method, url, status, referer, ua] = m;
        if (shouldSkip(ip, url, ua, status)) continue;
        const ts = parseNginxDate(dateStr);
        if (!ts) continue;
        const host = (m[8] || '').toLowerCase().replace(/^www\./, '') || 'unknown';
        const domain = host.includes('app.') ? 'app.calbridge.ai'
          : host.includes('calbridge.ai') ? 'calbridge.ai'
          : host.includes('teamcalbridge.com') ? 'teamcalbridge.com'
          : host || 'unknown';
        entries.push({ ip, ts, method, url: url.split('?')[0], status: parseInt(status, 10), referer, ua, domain });
      }
      return entries;
    }

    // ── Read logs ──
    const LOG_PATH  = '/var/log/nginx/access.log';
    const LOG_PATH1 = '/var/log/nginx/access.log.1';
    const MAX_LINES = 50000;

    const [mainLines, rotatedLines] = await Promise.all([
      readLastLines(LOG_PATH, MAX_LINES),
      readLastLines(LOG_PATH1, MAX_LINES)
    ]);

    const mainEntries    = processLines(mainLines);
    const rotatedEntries = processLines(rotatedLines);
    const allEntries     = [...rotatedEntries, ...mainEntries]; // older first

    // ── Date boundaries ──
    const now        = new Date();
    const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const d7Start    = new Date(todayStart.getTime() - 6 * 86400000);
    const d30Start   = new Date(todayStart.getTime() - 29 * 86400000);

    // ── Today analytics ──
    const todayEntries = mainEntries.filter(e => e.ts >= todayStart);
    const todayIPs     = new Set(todayEntries.map(e => e.ip));

    const pageCounts  = {};
    const refCounts   = {};
    const hourCounts  = {};
    let signups       = 0;
    let landingViews  = 0;

    // Skip asset-only URLs for page counting (css, js, images, fonts)
    const ASSET_RE = /\.(css|js|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|map|webp)$/i;

    for (const e of todayEntries) {
      // Skip asset files from page counts
      if (!ASSET_RE.test(e.url)) {
        pageCounts[e.url] = (pageCounts[e.url] || 0) + 1;
      }

      // Referrer
      const domain = extractDomain(e.referer);
      if (domain && !SELF_DOMAINS.some(s => domain.endsWith(s)) && !domain.match(/^172\.\d+\.\d+\.\d+$/)) {
        refCounts[domain] = (refCounts[domain] || 0) + 1;
      }

      // Hourly
      const hour = `${String(e.ts.getUTCHours()).padStart(2, '0')}:00`;
      hourCounts[hour] = (hourCounts[hour] || 0) + 1;

      // Landing page
      if (isLandingPage(e.url)) landingViews++;

      // Signups
      if (isSignup(e.method, e.url, e.status)) signups++;
    }

    // Build hourly chart (all 24 hours)
    const hourlyChart = [];
    for (let h = 0; h < 24; h++) {
      const label = `${String(h).padStart(2, '0')}:00`;
      hourlyChart.push({ hour: label, views: hourCounts[label] || 0 });
    }

    const topPages = Object.entries(pageCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([page, views]) => ({ page, views }));

    const topReferrers = Object.entries(refCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([referrer, visits]) => ({ referrer, visits }));

    // ── 7-day analytics ──
    const d7Entries = allEntries.filter(e => e.ts >= d7Start);
    const d7IPs     = new Set(d7Entries.map(e => e.ip));

    const dailyMap7 = {};
    for (const e of d7Entries) {
      const dateKey = e.ts.toISOString().slice(0, 10);
      if (!dailyMap7[dateKey]) dailyMap7[dateKey] = { views: 0, visitors: new Set() };
      dailyMap7[dateKey].views++;
      dailyMap7[dateKey].visitors.add(e.ip);
    }

    // Build 7-day chart with all days filled
    const dailyChart = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(todayStart.getTime() - i * 86400000);
      const key = d.toISOString().slice(0, 10);
      const entry = dailyMap7[key] || { views: 0, visitors: new Set() };
      dailyChart.push({ date: key, views: entry.views, visitors: entry.visitors instanceof Set ? entry.visitors.size : entry.visitors });
    }

    // ── 30-day analytics ──
    const d30Entries    = allEntries.filter(e => e.ts >= d30Start);
    const d30IPs        = new Set(d30Entries.map(e => e.ip));

    // ── Per-domain breakdown (today) ──
    const DOMAINS = ['calbridge.ai', 'app.calbridge.ai', 'teamcalbridge.com'];
    const byDomain = {};
    for (const d of DOMAINS) {
      const de = todayEntries.filter(e => e.domain === d);
      byDomain[d] = {
        uniqueVisitors: new Set(de.map(e => e.ip)).size,
        pageviews: de.length,
        landingPageViews: de.filter(e => isLandingPage(e.url)).length,
        signups: de.filter(e => isSignup(e.method, e.url, e.status)).length,
      };
    }

    // ── Real account signups from DB ──
    let newAccounts = 0;
    try {
      const { query: sfQuery } = require('../services/snowflakeService');
      const signupRows = await sfQuery(`
        SELECT COUNT(*) as cnt FROM CALBRIDGE_PROD.APP.clients
        WHERE created_at >= CURRENT_DATE() AND linked_client_id IS NULL
      `);
      newAccounts = Number(signupRows[0]?.CNT || 0);
    } catch(e) { /* non-fatal */ }

    res.json({
      today: {
        uniqueVisitors:   todayIPs.size,
        pageviews:        todayEntries.length,
        landingPageViews: landingViews,
        signups,
        newAccounts,
        topPages,
        topReferrers,
        hourlyChart,
        byDomain
      },
      last7days: {
        uniqueVisitors: d7IPs.size,
        pageviews:      d7Entries.length,
        dailyChart
      },
      last30days: {
        uniqueVisitors: d30IPs.size,
        pageviews:      d30Entries.length
      }
    });
  } catch (err) { next(err); }
});

module.exports = router;
