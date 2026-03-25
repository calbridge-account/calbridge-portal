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

    // 1. OpenRouter credits
    try {
      const openrouterKey = process.env.OPENROUTER_API_KEY || process.env.OPENROUTER_CHATBOT_KEY;
      if (openrouterKey) {
        const credRes = await safeFetch('https://openrouter.ai/api/v1/credits', {
          headers: { Authorization: `Bearer ${openrouterKey}` }
        });
        if (credRes.ok) {
          results.openrouter = await credRes.json();
        } else {
          results.openrouter = { error: `API returned ${credRes.status}` };
        }
      } else {
        results.openrouter = { error: 'No OpenRouter API key configured' };
      }
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

    // ── OpenRouter — chatbot API key spend ──
    try {
      const openrouterKey = process.env.OPENROUTER_API_KEY || process.env.OPENROUTER_CHATBOT_KEY;
      if (!openrouterKey) throw new Error('No OpenRouter API key configured');

      const credRes = await safeFetch('https://openrouter.ai/api/v1/credits', {
        headers: { Authorization: `Bearer ${openrouterKey}` }
      });
      if (!credRes.ok) throw new Error(`OpenRouter API returned ${credRes.status}`);
      const credData = await credRes.json();

      // total_credits = purchased credits, total_usage = all-time spend on this key
      const totalCredits = parseFloat(credData?.data?.total_credits || 0);
      const totalUsage   = parseFloat(credData?.data?.total_usage   || 0);
      const remaining    = totalCredits - totalUsage;

      results.openrouter = {
        totalCredits,
        totalUsage,      // all-time spend on this specific chatbot key
        remaining,
        source:          'OPENROUTER_API_KEY (chatbot)'
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

module.exports = router;
