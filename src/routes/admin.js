/**
 * Admin routes — session-based auth for admin users
 */
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../services/snowflakeService');
const { invalidateClient, stats: cacheStats } = require('../services/queryCache');
const { Resend } = require('resend');
const { sendWeeklyReportsToAll } = require('../jobs/weeklyEmailScheduler');
const { generateAndSend } = require('../services/weeklyReport');
const { getAllHealthScores } = require('../services/healthScore');

// Admin auth middleware
function requireAdmin(req, res, next) {
  if (!req.session?.adminId) return res.status(401).json({ error: 'Admin authentication required' });
  next();
}

function requireSuperAdmin(req, res, next) {
  if (!req.session?.adminId) return res.status(401).json({ error: 'Admin authentication required' });
  if (req.session?.adminRole !== 'superadmin') return res.status(403).json({ error: 'Superadmin required' });
  next();
}

// ---- Admin Auth ----

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const rows = await query(
      'SELECT admin_id, email, name, password_hash, role FROM admin_users WHERE email = ?',
      [email.toLowerCase().trim()]
    );
    if (!rows.length) return res.status(401).json({ error: 'Invalid credentials' });

    const row = rows[0];
    const valid = await bcrypt.compare(password, row.PASSWORD_HASH);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    req.session.adminId   = row.ADMIN_ID;
    req.session.adminRole = row.ROLE;
    req.session.adminName = row.NAME;

    await query('UPDATE admin_users SET last_login = CURRENT_TIMESTAMP WHERE admin_id = ?', [row.ADMIN_ID]);

    res.json({ message: 'Logged in', admin: { id: row.ADMIN_ID, email: row.EMAIL, name: row.NAME, role: row.ROLE } });
  } catch (err) { next(err); }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ message: 'Logged out' }));
});

router.get('/me', requireAdmin, async (req, res, next) => {
  try {
    const rows = await query('SELECT admin_id, email, name, role, last_login FROM admin_users WHERE admin_id = ?', [req.session.adminId]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const r = rows[0];
    res.json({ id: r.ADMIN_ID, email: r.EMAIL, name: r.NAME, role: r.ROLE, lastLogin: r.LAST_LOGIN });
  } catch (err) { next(err); }
});

// ---- Admin User Management ----

router.get('/users', requireSuperAdmin, async (req, res, next) => {
  try {
    const rows = await query('SELECT admin_id, email, name, role, created_at, last_login FROM admin_users ORDER BY created_at');
    res.json(rows.map(r => ({ id: r.ADMIN_ID, email: r.EMAIL, name: r.NAME, role: r.ROLE, createdAt: r.CREATED_AT, lastLogin: r.LAST_LOGIN })));
  } catch (err) { next(err); }
});

router.post('/users', requireSuperAdmin, async (req, res, next) => {
  try {
    const { email, name, password, role = 'admin' } = req.body;
    if (!email || !name || !password) return res.status(400).json({ error: 'email, name and password required' });

    const existing = await query('SELECT admin_id FROM admin_users WHERE email = ?', [email.toLowerCase().trim()]);
    if (existing.length) return res.status(409).json({ error: 'Email already exists' });

    const hash = await bcrypt.hash(password, 12);
    const id = uuidv4();
    await query(
      'INSERT INTO admin_users (admin_id, email, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)',
      [id, email.toLowerCase().trim(), name, hash, role]
    );
    res.status(201).json({ message: 'Admin user created', id });
  } catch (err) { next(err); }
});

router.delete('/users/:adminId', requireSuperAdmin, async (req, res, next) => {
  try {
    if (req.params.adminId === req.session.adminId) return res.status(400).json({ error: 'Cannot delete your own account' });
    await query('DELETE FROM admin_users WHERE admin_id = ?', [req.params.adminId]);
    res.json({ message: 'Admin user removed' });
  } catch (err) { next(err); }
});

router.post('/users/:adminId/change-password', requireAdmin, async (req, res, next) => {
  try {
    // Admins can only change their own password unless superadmin
    if (req.params.adminId !== req.session.adminId && req.session.adminRole !== 'superadmin') {
      return res.status(403).json({ error: 'Cannot change another user password' });
    }
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    const hash = await bcrypt.hash(newPassword, 12);
    await query('UPDATE admin_users SET password_hash = ? WHERE admin_id = ?', [hash, req.params.adminId]);
    res.json({ message: 'Password updated' });
  } catch (err) { next(err); }
});

/**
 * GET /admin/clients
 * List all clients with status, cross-referenced with manager accounts
 */
router.get('/clients', requireAdmin, async (req, res, next) => {
  try {
    const rows = await query(`
      SELECT
        c.client_id, c.email, c.name, c.company_name, c.status,
        c.created_at, c.approved_at, c.last_login_at, c.linked_client_id,
        c.subscription_plan, c.subscription_status,
        map.manager_id,
        m.name AS manager_name,
        m.subscription_plan AS manager_plan, m.subscription_status AS manager_status
      FROM clients c
      LEFT JOIN CALBRIDGE_PROD.APP.client_migration_map map ON map.client_id = c.client_id
      LEFT JOIN CALBRIDGE_PROD.APP.manager_accounts m ON m.manager_id = map.manager_id
      WHERE c.linked_client_id IS NULL
      ORDER BY c.created_at DESC
    `);
    res.json(rows.map(r => ({
      id:            r.CLIENT_ID,
      clientId:      r.CLIENT_ID,          // used by spend adjustments dropdown
      email:         r.EMAIL,
      name:          r.NAME,
      companyName:   r.COMPANY_NAME || r.NAME,  // fall back to name when company_name is null
      status:        r.STATUS || 'active',
      createdAt:     r.CREATED_AT,
      approvedAt:    r.APPROVED_AT,
      lastLoginAt:   r.LAST_LOGIN_AT || null,
      linkedClientId: r.LINKED_CLIENT_ID || null,
      managerId:     r.MANAGER_ID || null,
      managerName:   r.MANAGER_NAME || null,
      // Prefer manager_accounts plan (authoritative for Phase3); fall back to clients table
      subscriptionPlan:   r.MANAGER_PLAN   || r.SUBSCRIPTION_PLAN   || null,
      subscriptionStatus: r.MANAGER_STATUS || r.SUBSCRIPTION_STATUS || null,
    })));
  } catch (err) { next(err); }
});

/**
 * POST /admin/approve/:clientId
 * Approve a pending client
 */
router.post('/approve/:clientId', requireAdmin, async (req, res, next) => {
  try {
    const rows = await query(`SELECT email, name FROM clients WHERE client_id = ?`, [req.params.clientId]);
    if (!rows.length) return res.status(404).json({ error: 'Client not found' });

    await query(`
      UPDATE clients SET status = 'active', approved_at = CURRENT_TIMESTAMP
      WHERE client_id = ?
    `, [req.params.clientId]);

    // Email the client
    const { email, name } = rows[0];
    try {
      const resend = new Resend(process.env.RESEND_API_KEY);
      await resend.emails.send({
        from: `Calbridge Portal <${process.env.EMAIL_FROM}>`,
        to: [email],
        cc: [process.env.EMAIL_CC],
        subject: 'Your Calbridge Portal access is approved',
        text: `Hi ${name || 'there'},\n\nYour Calbridge Client Portal account has been approved. You can now log in at:\n\nhttps://app.calbridge.ai\n\nOnce logged in, go to Account to connect your Amazon accounts and get started.\n\nIf you have any questions, reply to this email.\n\nThe Calbridge Team`
      });
    } catch (emailErr) {
      console.warn('[Admin] Approval email failed:', emailErr.message);
    }

    res.json({ message: `Client ${email} approved and notified` });
  } catch (err) { next(err); }
});

/**
 * POST /admin/suspend/:clientId
 * Suspend a client
 */
router.post('/suspend/:clientId', requireAdmin, async (req, res, next) => {
  try {
    await query(`UPDATE clients SET status = 'suspended' WHERE client_id = ?`, [req.params.clientId]);
    res.json({ message: 'Client suspended' });
  } catch (err) { next(err); }
});

/**
 * POST /admin/invite
 * Pre-create an approved account and email invite
 */
router.post('/invite', requireAdmin, async (req, res, next) => {
  try {
    const { email, name, companyName } = req.body;
    if (!email || !name) return res.status(400).json({ error: 'email and name required' });

    const { v4: uuidv4 } = require('uuid');
    const id = uuidv4();

    await query(`
      INSERT INTO clients (client_id, email, name, company_name, status, approved_at, created_at)
      VALUES (?, ?, ?, ?, 'invited', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `, [id, email.toLowerCase().trim(), name, companyName || name]);

    // Send invite email
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: `Calbridge Portal <${process.env.EMAIL_FROM}>`,
      to: [email],
      cc: [process.env.EMAIL_CC],
      subject: 'You have been invited to the Calbridge Client Portal',
      text: `Hi ${name},\n\nYou have been invited to access the Calbridge Client Portal.\n\nCreate your password and log in at:\nhttps://app.calbridge.ai/signup.html\n\nUse this email address: ${email}\n\nIf you have any questions, contact us at ${process.env.EMAIL_CC}.\n\nThe Calbridge Team`
    });

    res.status(201).json({ message: `Invite sent to ${email}`, clientId: id });
  } catch (err) { next(err); }
});

/**
 * POST /admin/send-weekly-reports
 * Trigger weekly email reports for all eligible active clients (runs in background)
 */
router.post('/send-weekly-reports', requireAdmin, async (req, res, next) => {
  try {
    // Count eligible clients first for the response
    const clients = await query(`
      SELECT COUNT(*) AS cnt FROM clients
      WHERE status = 'active'
        AND (weekly_report_enabled IS NULL OR weekly_report_enabled = TRUE)
    `);
    const clientCount = Number(clients[0]?.CNT || 0);

    // Fire and forget — runs in background, logs to console
    sendWeeklyReportsToAll().catch(err =>
      console.error('[WeeklyEmail] Background send failed:', err.message)
    );

    res.json({ message: 'Weekly reports queued', clientCount });
  } catch (err) { next(err); }
});

/**
 * POST /admin/test-weekly-report/:clientId
 * Send a test weekly report to abe@teamcalbridge.com (not the real client email)
 */
router.post('/test-weekly-report/:clientId', requireAdmin, async (req, res, next) => {
  try {
    const { clientId } = req.params;

    const rows = await query(`SELECT client_id, email, name FROM clients WHERE client_id = ?`, [clientId]);
    if (!rows.length) return res.status(404).json({ error: 'Client not found' });

    const result = await generateAndSend(clientId, { overrideEmail: process.env.EMAIL_CC });

    if (result.skipped) {
      return res.json({ message: `Test skipped: ${result.reason}`, skipped: true });
    }

    res.json({ message: `Test report sent to ${process.env.EMAIL_CC} for client ${rows[0].EMAIL}` });
  } catch (err) { next(err); }
});

/**
 * GET /admin/health-scores
 * Health score (0-100) for all active clients
 */
router.get('/health-scores', requireAdmin, async (req, res, next) => {
  try {
    const scores = await getAllHealthScores();
    res.json(scores);
  } catch (err) { next(err); }
});

/**
 * GET /admin/logs
 * Recent ingestion logs across all clients
 */
router.get('/logs', requireAdmin, async (req, res, next) => {
  try {
    const rows = await query(`
      SELECT log_id, client_id, connection_type, job_type, status,
             records_written, error_message, started_at, completed_at
      FROM ingestion_log
      ORDER BY started_at DESC
      LIMIT 100
    `);
    res.json(rows);
  } catch (err) { next(err); }
});

// ============================================================
// SPEND ADJUSTMENTS (admin-only, UI layer multipliers)
// ============================================================

/**
 * GET /admin/spend-adjustments
 * List all spend adjustments, optionally filtered by client_id
 */
router.get('/spend-adjustments', requireAdmin, async (req, res, next) => {
  try {
    const clientIdFilter = req.query.clientId || null;
    const clientFilter = clientIdFilter ? 'WHERE sa.client_id = ?' : '';
    const rows = await query(`
      SELECT
        sa.id,
        sa.client_id,
        c.company_name,
        c.name AS client_name,
        sa.year_month,
        sa.ad_type,
        sa.multiplier,
        sa.note,
        sa.created_by,
        sa.created_at,
        sa.updated_at
      FROM spend_adjustments sa
      LEFT JOIN clients c ON sa.client_id = c.client_id
      ${clientFilter}
      ORDER BY sa.year_month DESC, c.company_name ASC, sa.ad_type ASC
    `, clientIdFilter ? [clientIdFilter] : []);
    res.json(rows.map(r => ({
      id:          Number(r.ID),
      clientId:    r.CLIENT_ID,
      companyName: r.COMPANY_NAME || r.CLIENT_NAME || r.CLIENT_ID,
      yearMonth:   r.YEAR_MONTH,
      adType:      r.AD_TYPE,
      multiplier:  Number(r.MULTIPLIER),
      note:        r.NOTE || null,
      createdBy:   r.CREATED_BY || null,
      createdAt:   r.CREATED_AT,
      updatedAt:   r.UPDATED_AT
    })));
  } catch (err) { next(err); }
});

/**
 * POST /admin/spend-adjustments
 * Create or update a spend adjustment (upsert by client_id + year_month + ad_type)
 */
router.post('/spend-adjustments', requireAdmin, async (req, res, next) => {
  try {
    const { clientId, yearMonth, adType, multiplier, note } = req.body;

    // Validation
    if (!clientId || !yearMonth || !adType || multiplier == null) {
      return res.status(400).json({ error: 'clientId, yearMonth, adType, and multiplier are required' });
    }
    if (!/^\d{4}-\d{2}$/.test(yearMonth)) {
      return res.status(400).json({ error: 'yearMonth must be YYYY-MM format' });
    }
    if (!['SP', 'SB', 'SD', 'DSP', 'SA', 'ALL'].includes(adType)) {
      return res.status(400).json({ error: 'adType must be SP, SB, SD, DSP, SA, or ALL' });
    }
    const mult = Number(multiplier);
    if (isNaN(mult) || mult <= 0 || mult > 10) {
      return res.status(400).json({ error: 'multiplier must be a positive number (0–10)' });
    }

    const adminEmail = req.session?.adminEmail || 'admin';

    await query(`
      MERGE INTO spend_adjustments AS target
      USING (SELECT ? AS client_id, ? AS year_month, ? AS ad_type) AS source
        ON target.client_id = source.client_id
       AND target.year_month = source.year_month
       AND target.ad_type    = source.ad_type
      WHEN MATCHED THEN UPDATE SET
        multiplier = ?,
        note       = ?,
        created_by = ?,
        updated_at = CURRENT_TIMESTAMP()
      WHEN NOT MATCHED THEN INSERT (client_id, year_month, ad_type, multiplier, note, created_by)
        VALUES (?, ?, ?, ?, ?, ?)
    `, [clientId, yearMonth, adType, mult, note || null, adminEmail,
        clientId, yearMonth, adType, mult, note || null, adminEmail]);

    res.json({ ok: true });
  } catch (err) { next(err); }
});

/**
 * DELETE /admin/spend-adjustments/:id
 * Remove a spend adjustment by id
 */
router.delete('/spend-adjustments/:id', requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid id' });
    await query(`DELETE FROM spend_adjustments WHERE id = ?`, [id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ============================================================
// NAV CONFIG (per-client tab visibility)
// ============================================================

const NAV_PATHS = ['/', '/vendor', '/seller', '/forecasting', '/cogs', '/advertising', '/pacing', '/reports', '/account'];
const VALID_VISIBILITY = ['visible', 'grayed', 'hidden'];

/**
 * Ensure CLIENT_NAV_CONFIG table exists (called once at startup)
 */
async function ensureNavConfigTable() {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS CALBRIDGE_PROD.APP.CLIENT_NAV_CONFIG (
        client_id   VARCHAR   NOT NULL,
        nav_path    VARCHAR   NOT NULL,
        visibility  VARCHAR   NOT NULL DEFAULT 'visible',
        updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (client_id, nav_path)
      )
    `);
    console.log('[NavConfig] Table ready');
  } catch (err) {
    console.warn('[NavConfig] Table ensure failed:', err.message);
  }
}

ensureNavConfigTable();

/**
 * GET /admin/connections/:clientId
 * Returns active connection types for a client (ads, vendor, seller, dsp, etc.)
 */
router.get('/connections/:clientId', requireAdmin, async (req, res, next) => {
  try {
    const { clientId } = req.params;
    const rows = await query(
      `SELECT connection_type, is_active FROM CALBRIDGE_PROD.APP.amazon_connections WHERE client_id = ?`,
      [clientId]
    );
    const connections = {};
    rows.forEach(r => {
      connections[r.CONNECTION_TYPE] = r.IS_ACTIVE === true || r.IS_ACTIVE === 'true' || r.IS_ACTIVE === 1;
    });
    res.json({ clientId, connections });
  } catch (err) { next(err); }
});

/**
 * GET /admin/nav-config/:clientId
 * Returns full nav config for a client (all 7 paths, defaulting to 'visible')
 */
router.get('/nav-config/:clientId', requireAdmin, async (req, res, next) => {
  try {
    const { clientId } = req.params;
    const rows = await query(
      `SELECT nav_path, visibility FROM CALBRIDGE_PROD.APP.CLIENT_NAV_CONFIG WHERE client_id = ?`,
      [clientId]
    );
    // Build config with all nav paths, default 'visible'
    const config = {};
    NAV_PATHS.forEach(p => { config[p] = 'visible'; });
    rows.forEach(r => { config[r.NAV_PATH] = r.VISIBILITY; });
    res.json({ clientId, config });
  } catch (err) { next(err); }
});

/**
 * PUT /admin/nav-config/:clientId
 * Upsert nav config for a client
 * Body: { config: { '/vendor': 'grayed', '/cogs': 'hidden', ... } }
 */
router.put('/nav-config/:clientId', requireAdmin, async (req, res, next) => {
  try {
    const { clientId } = req.params;
    const { config } = req.body;
    if (!config || typeof config !== 'object') {
      return res.status(400).json({ error: 'config object required' });
    }

    const entries = Object.entries(config).filter(([path, vis]) =>
      NAV_PATHS.includes(path) && VALID_VISIBILITY.includes(vis)
    );

    // Upsert each entry
    for (const [navPath, visibility] of entries) {
      await query(`
        MERGE INTO CALBRIDGE_PROD.APP.CLIENT_NAV_CONFIG AS target
        USING (SELECT ? AS client_id, ? AS nav_path) AS source
          ON target.client_id = source.client_id AND target.nav_path = source.nav_path
        WHEN MATCHED THEN UPDATE SET
          visibility = ?,
          updated_at = CURRENT_TIMESTAMP()
        WHEN NOT MATCHED THEN INSERT (client_id, nav_path, visibility, updated_at)
          VALUES (?, ?, ?, CURRENT_TIMESTAMP())
      `, [clientId, navPath, visibility, clientId, navPath, visibility]);
    }

    res.json({ ok: true, updated: entries.length });
  } catch (err) { next(err); }
});

// ============================================================
// AGENCY / MANAGER / ADVERTISER HIERARCHY (Phase 3J)
// ============================================================

/**
 * GET /admin/agency
 * Calbridge agency overview — agency row + manager + advertiser counts
 */
router.get('/agency', requireAdmin, async (req, res, next) => {
  try {
    const [agencyRows, managerCount, advertiserCount] = await Promise.all([
      query(`SELECT * FROM CALBRIDGE_PROD.APP.agency_accounts LIMIT 10`, []),
      query(`SELECT COUNT(*) AS cnt FROM CALBRIDGE_PROD.APP.manager_accounts`, []),
      query(`SELECT COUNT(*) AS cnt FROM CALBRIDGE_PROD.APP.advertiser_accounts`, []),
    ]);
    res.json({
      agencies: agencyRows.map(r => ({
        agencyId:           r.AGENCY_ID,
        name:               r.NAME,
        subscriptionPlan:   r.SUBSCRIPTION_PLAN,
        subscriptionStatus: r.SUBSCRIPTION_STATUS,
        createdAt:          r.CREATED_AT,
      })),
      managerCount:    Number(managerCount[0]?.CNT || 0),
      advertiserCount: Number(advertiserCount[0]?.CNT || 0),
    });
  } catch (err) { next(err); }
});

/**
 * GET /admin/managers
 * List all manager accounts with client mapping and advertiser count
 */
router.get('/managers', requireAdmin, async (req, res, next) => {
  try {
    const rows = await query(`
      SELECT
        m.manager_id, m.name, m.subscription_plan, m.subscription_status, m.agency_id,
        map.client_id,
        c.email AS client_email, c.status AS client_status,
        COUNT(DISTINCT a.advertiser_id) AS advertiser_count
      FROM CALBRIDGE_PROD.APP.manager_accounts m
      LEFT JOIN CALBRIDGE_PROD.APP.client_migration_map map ON map.manager_id = m.manager_id
      LEFT JOIN clients c ON c.client_id = map.client_id
      LEFT JOIN CALBRIDGE_PROD.APP.advertiser_accounts a ON a.manager_id = m.manager_id
      GROUP BY m.manager_id, m.name, m.subscription_plan, m.subscription_status, m.agency_id,
               map.client_id, c.email, c.status
      ORDER BY m.name
    `, []);
    res.json(rows.map(r => ({
      managerId:          r.MANAGER_ID,
      name:               r.NAME,
      subscriptionPlan:   r.SUBSCRIPTION_PLAN,
      subscriptionStatus: r.SUBSCRIPTION_STATUS,
      agencyId:           r.AGENCY_ID,
      clientId:           r.CLIENT_ID,
      clientEmail:        r.CLIENT_EMAIL,
      clientStatus:       r.CLIENT_STATUS,
      advertiserCount:    Number(r.ADVERTISER_COUNT || 0),
    })));
  } catch (err) { next(err); }
});

/**
 * GET /admin/managers/:managerId
 * Manager detail — their advertiser accounts and users
 */
router.get('/managers/:managerId', requireAdmin, async (req, res, next) => {
  try {
    const { managerId } = req.params;
    const [managerRows, advertisers, users] = await Promise.all([
      query(`
        SELECT m.*, map.client_id, c.email AS client_email, c.status AS client_status
        FROM CALBRIDGE_PROD.APP.manager_accounts m
        LEFT JOIN CALBRIDGE_PROD.APP.client_migration_map map ON map.manager_id = m.manager_id
        LEFT JOIN clients c ON c.client_id = map.client_id
        WHERE m.manager_id = ?
      `, [managerId]),
      query(`
        SELECT advertiser_id, name, marketplace, ads_profile_id, sp_seller_id,
               sp_vendor_id, dsp_advertiser_id, is_active, created_at
        FROM CALBRIDGE_PROD.APP.advertiser_accounts
        WHERE manager_id = ?
        ORDER BY name
      `, [managerId]),
      query(`
        SELECT u.user_id, u.email, u.name, uaa.role
        FROM CALBRIDGE_PROD.APP.users u
        JOIN CALBRIDGE_PROD.APP.user_advertiser_access uaa ON uaa.user_id = u.user_id
        JOIN CALBRIDGE_PROD.APP.advertiser_accounts a ON a.advertiser_id = uaa.advertiser_id
        WHERE a.manager_id = ?
        GROUP BY u.user_id, u.email, u.name, uaa.role
        ORDER BY u.name
      `, [managerId]),
    ]);

    if (!managerRows.length) return res.status(404).json({ error: 'Manager not found' });
    const m = managerRows[0];
    res.json({
      managerId:          m.MANAGER_ID,
      name:               m.NAME,
      subscriptionPlan:   m.SUBSCRIPTION_PLAN,
      subscriptionStatus: m.SUBSCRIPTION_STATUS,
      agencyId:           m.AGENCY_ID,
      clientId:           m.CLIENT_ID,
      clientEmail:        m.CLIENT_EMAIL,
      clientStatus:       m.CLIENT_STATUS,
      advertisers: advertisers.map(a => ({
        advertiserId:    a.ADVERTISER_ID,
        name:            a.NAME,
        marketplace:     a.MARKETPLACE,
        adsProfileId:    a.ADS_PROFILE_ID,
        spSellerId:      a.SP_SELLER_ID,
        spVendorId:      a.SP_VENDOR_ID,
        dspAdvertiserId: a.DSP_ADVERTISER_ID,
        isActive:        a.IS_ACTIVE,
        createdAt:       a.CREATED_AT,
      })),
      users: users.map(u => ({
        userId: u.USER_ID,
        email:  u.EMAIL,
        name:   u.NAME,
        role:   u.ROLE,
      })),
    });
  } catch (err) { next(err); }
});

/**
 * POST /admin/managers/:managerId/plan
 * Update subscription plan for a manager
 */
router.post('/managers/:managerId/plan', requireAdmin, async (req, res, next) => {
  try {
    const { managerId } = req.params;
    const { plan, status } = req.body;
    if (!plan) return res.status(400).json({ error: 'plan is required' });
    const validPlans    = ['free', 'starter', 'growth', 'pro', 'agency'];
    const validStatuses = ['active', 'trialing', 'past_due', 'canceled', 'paused', 'cancelled'];
    if (!validPlans.includes(plan)) return res.status(400).json({ error: `plan must be one of: ${validPlans.join(', ')}` });
    if (status && !validStatuses.includes(status)) return res.status(400).json({ error: `status must be one of: ${validStatuses.join(', ')}` });

    // 1. Update manager_accounts (Phase 3 clients)
    await query(`
      UPDATE CALBRIDGE_PROD.APP.manager_accounts
      SET subscription_plan = ?
          ${status ? ', subscription_status = ?' : ''}
      WHERE manager_id = ?
    `, status ? [plan, status, managerId] : [plan, managerId]);

    // 2. Update clients table — handles both pre-Phase3 (managerId IS clientId)
    //    and Phase3 clients (look up via migration map)
    const clientIds = new Set();
    // Direct match: managerId might be a clientId
    clientIds.add(managerId);
    // Migration map lookup
    try {
      const mapRows = await query(
        'SELECT client_id FROM CALBRIDGE_PROD.APP.client_migration_map WHERE manager_id = ?',
        [managerId]
      );
      mapRows.forEach(r => clientIds.add(r.CLIENT_ID || r.client_id));
    } catch (e) { /* non-fatal */ }

    for (const clientId of clientIds) {
      await query(`
        UPDATE CALBRIDGE_PROD.APP.clients
        SET subscription_plan = ?
            ${status ? ', subscription_status = ?, approved_at = COALESCE(approved_at, CURRENT_TIMESTAMP())' : ''}
        WHERE client_id = ?
      `, status ? [plan, status, clientId] : [plan, clientId]).catch(() => {});
    }

    // 3. Create manager_accounts row if it doesn't exist (for pre-Phase3 clients)
    try {
      const exists = await query(
        'SELECT manager_id FROM CALBRIDGE_PROD.APP.manager_accounts WHERE manager_id = ?',
        [managerId]
      );
      if (!exists.length) {
        const clientRow = await query(
          'SELECT name, company_name FROM CALBRIDGE_PROD.APP.clients WHERE client_id = ?',
          [managerId]
        );
        const clientName = clientRow[0]?.COMPANY_NAME || clientRow[0]?.company_name ||
                           clientRow[0]?.NAME || clientRow[0]?.name || managerId;
        await query(`
          INSERT INTO CALBRIDGE_PROD.APP.manager_accounts
            (manager_id, name, subscription_plan, subscription_status, created_at)
          VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP())
        `, [managerId, clientName, plan, status || 'active']).catch(() => {});
        // Also create migration map entry
        await query(`
          INSERT INTO CALBRIDGE_PROD.APP.client_migration_map (client_id, manager_id, advertiser_id)
          SELECT ?, ?, ?
          WHERE NOT EXISTS (
            SELECT 1 FROM CALBRIDGE_PROD.APP.client_migration_map WHERE client_id = ?
          )
        `, [managerId, managerId, managerId, managerId]).catch(() => {});
      }
    } catch (e) { /* non-fatal */ }

    res.json({ ok: true, managerId, plan, status, clientsUpdated: [...clientIds] });
  } catch (err) { next(err); }
});

/**
 * GET /admin/advertisers
 * List all advertiser accounts across all managers
 */
router.get('/advertisers', requireAdmin, async (req, res, next) => {
  try {
    const rows = await query(`
      SELECT
        a.advertiser_id, a.name, a.marketplace,
        a.ads_profile_id, a.sp_seller_id, a.sp_vendor_id, a.dsp_advertiser_id,
        a.is_active, a.created_at,
        a.manager_id, m.name AS manager_name
      FROM CALBRIDGE_PROD.APP.advertiser_accounts a
      LEFT JOIN CALBRIDGE_PROD.APP.manager_accounts m ON m.manager_id = a.manager_id
      ORDER BY m.name, a.name
    `, []);
    res.json(rows.map(r => ({
      advertiserId:    r.ADVERTISER_ID,
      name:            r.NAME,
      marketplace:     r.MARKETPLACE,
      adsProfileId:    r.ADS_PROFILE_ID,
      spSellerId:      r.SP_SELLER_ID,
      spVendorId:      r.SP_VENDOR_ID,
      dspAdvertiserId: r.DSP_ADVERTISER_ID,
      isActive:        r.IS_ACTIVE,
      createdAt:       r.CREATED_AT,
      managerId:       r.MANAGER_ID,
      managerName:     r.MANAGER_NAME,
    })));
  } catch (err) { next(err); }
});

/**
 * PUT /admin/advertisers/:advertiserId
 * Update advertiser account fields (name, profile IDs, marketplace, active)
 */
router.put('/advertisers/:advertiserId', requireAdmin, async (req, res, next) => {
  try {
    const { advertiserId } = req.params;
    const { name, marketplace, adsProfileId, spSellerId, spVendorId, dspAdvertiserId, isActive } = req.body;

    // Build dynamic SET clause only for provided fields
    const sets   = [];
    const params = [];
    if (name            !== undefined) { sets.push('name = ?');              params.push(name); }
    if (marketplace     !== undefined) { sets.push('marketplace = ?');       params.push(marketplace); }
    if (adsProfileId    !== undefined) { sets.push('ads_profile_id = ?');    params.push(adsProfileId); }
    if (spSellerId      !== undefined) { sets.push('sp_seller_id = ?');      params.push(spSellerId); }
    if (spVendorId      !== undefined) { sets.push('sp_vendor_id = ?');      params.push(spVendorId); }
    if (dspAdvertiserId !== undefined) { sets.push('dsp_advertiser_id = ?'); params.push(dspAdvertiserId); }
    if (isActive        !== undefined) { sets.push('is_active = ?');         params.push(Boolean(isActive)); }

    if (!sets.length) return res.status(400).json({ error: 'No fields to update' });
    params.push(advertiserId);

    await query(`
      UPDATE CALBRIDGE_PROD.APP.advertiser_accounts
      SET ${sets.join(', ')}
      WHERE advertiser_id = ?
    `, params);

    res.json({ ok: true, advertiserId });
  } catch (err) { next(err); }
});

// ============================================================
// CLIENT ACCOUNTS (Phase 3 — canonical account registry)
// ============================================================

/**
 * GET /admin/accounts
 * List all rows in client_accounts, joined with client name
 */
router.get('/accounts', requireAdmin, async (req, res, next) => {
  try {
    const rows = await query(`
      SELECT
        ca.account_id,
        ca.client_id,
        c.name        AS client_name,
        c.company_name,
        ca.account_name,
        ca.channel,
        ca.marketplace,
        ca.platform_profile_id,
        ca.agency_profile_id,
        ca.managed_by,
        ca.is_active,
        ca.valid_from,
        ca.valid_to,
        ca.created_at
      FROM CALBRIDGE_PROD.APP.client_accounts ca
      LEFT JOIN CALBRIDGE_PROD.APP.clients c ON c.client_id = ca.client_id
      ORDER BY COALESCE(c.company_name, c.name, ca.client_id), ca.channel, ca.account_name
    `);
    res.json(rows.map(r => ({
      accountId:         r.ACCOUNT_ID,
      clientId:          r.CLIENT_ID,
      clientName:        r.COMPANY_NAME || r.CLIENT_NAME || r.CLIENT_ID,
      accountName:       r.ACCOUNT_NAME,
      channel:           r.CHANNEL,
      marketplace:       r.MARKETPLACE,
      platformProfileId: r.PLATFORM_PROFILE_ID,
      agencyProfileId:   r.AGENCY_PROFILE_ID,
      managedBy:         r.MANAGED_BY,
      isActive:          r.IS_ACTIVE,
      validFrom:         r.VALID_FROM,
      validTo:           r.VALID_TO,
      createdAt:         r.CREATED_AT,
    })));
  } catch (err) { next(err); }
});

/**
 * POST /admin/accounts
 * Insert a new client_accounts row
 */
router.post('/accounts', requireAdmin, async (req, res, next) => {
  try {
    const { clientId, accountName, channel, marketplace, platformProfileId, agencyProfileId, managedBy } = req.body;
    if (!clientId || !accountName || !channel) {
      return res.status(400).json({ error: 'clientId, accountName, and channel are required' });
    }
    const validChannels = ['dsp', 'sponsored_ads', 'seller', 'vendor'];
    if (!validChannels.includes(channel)) {
      return res.status(400).json({ error: `channel must be one of: ${validChannels.join(', ')}` });
    }
    const { v4: uuidv4 } = require('uuid');
    const accountId = uuidv4();
    await query(`
      INSERT INTO CALBRIDGE_PROD.APP.client_accounts
        (account_id, client_id, account_name, channel, marketplace,
         platform_profile_id, agency_profile_id, managed_by,
         is_active, valid_from, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, TRUE, CURRENT_DATE(), CURRENT_TIMESTAMP())
    `, [
      accountId,
      clientId,
      accountName,
      channel,
      marketplace || null,
      platformProfileId || null,
      agencyProfileId   || null,
      managedBy         || null,
    ]);
    res.status(201).json({ ok: true, accountId });
  } catch (err) { next(err); }
});

/**
 * PATCH /admin/accounts/:accountId/retire
 * Soft-retire an account: is_active=FALSE, valid_to=CURRENT_DATE()
 */
router.patch('/accounts/:accountId/retire', requireAdmin, async (req, res, next) => {
  try {
    const { accountId } = req.params;
    await query(`
      UPDATE CALBRIDGE_PROD.APP.client_accounts
      SET    is_active = FALSE,
             valid_to  = CURRENT_DATE()
      WHERE  account_id = ?
    `, [accountId]);
    res.json({ ok: true, accountId });
  } catch (err) { next(err); }
});

/**
 * POST /admin/cache/flush?clientId=xxx
 * Flush the in-memory query cache for a specific client (or all clients if no clientId).
 * Useful after manual data fixes or view changes without restarting the app.
 */
router.post('/cache/flush', requireAdmin, (req, res) => {
  const { clientId } = req.query;
  const before = cacheStats().size;
  if (clientId) {
    invalidateClient(clientId);
    const after = cacheStats().size;
    console.log(`[cache] Flushed client ${clientId}: ${before - after} entries removed`);
    res.json({ ok: true, clientId, entriesRemoved: before - after, remaining: after });
  } else {
    // Flush all — import the cache map directly via stats keys
    const { invalidate } = require('../services/queryCache');
    const keys = cacheStats().keys;
    keys.forEach(k => invalidate(k));
    const after = cacheStats().size;
    console.log(`[cache] Flushed ALL cache: ${before - after} entries removed`);
    res.json({ ok: true, clientId: 'ALL', entriesRemoved: before - after, remaining: after });
  }
});

/**
 * GET /admin/freshness/:clientId
 *
 * Returns freshness metadata for all tables belonging to a client.
 * Reads from Redis first (fast path), falls back to PIPELINE.FRESHNESS in Snowflake.
 *
 * Response shape:
 *   { source: 'redis' | 'snowflake', records: [...] }
 */
router.get('/freshness/:clientId', requireAdmin, async (req, res, next) => {
  try {
    const { getFreshnessForClient } = require('../services/freshnessCacheService');
    const { clientId } = req.params;
    const records = await getFreshnessForClient(clientId);
    const source = records.length > 0 && records[0]._source === 'snowflake' ? 'snowflake' : 'redis';
    // Strip internal _source tag before returning
    const clean = records.map(({ _source, ...r }) => r);
    res.json({ source, records: clean });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /admin/cache/stats
 * Return current cache size and keys (for debugging).
 */
router.get('/cache/stats', requireAdmin, (req, res) => {
  res.json(cacheStats());
});

/**
 * GET /admin/agencies-roster
 * Returns all agencies with brand count, Stripe status, and MRR
 */
router.get('/agencies-roster', requireAdmin, async (req, res, next) => {
  try {
    const rows = await query(`
      SELECT
        a.agency_id,
        a.name,
        a.subscription_plan,
        a.subscription_status,
        a.stripe_customer_id,
        a.stripe_subscription_id,
        a.created_at,
        COUNT(DISTINCT m.manager_id) AS brand_count,
        MAX(c.email) AS primary_email,
        MAX(c.last_login_at) AS last_login_at
      FROM CALBRIDGE_PROD.APP.agency_accounts a
      LEFT JOIN CALBRIDGE_PROD.APP.manager_accounts m ON m.agency_id = a.agency_id
      LEFT JOIN CALBRIDGE_PROD.APP.client_migration_map map ON map.agency_id = a.agency_id AND map.manager_id = map.advertiser_id
      LEFT JOIN CALBRIDGE_PROD.APP.clients c ON c.client_id = map.client_id AND c.account_type = 'agency'
      GROUP BY a.agency_id, a.name, a.subscription_plan, a.subscription_status,
               a.stripe_customer_id, a.stripe_subscription_id, a.created_at
      ORDER BY a.name
    `, []);

    const PLAN_MRR = { free: 0, starter: 99, growth: 249, pro: 499, agency: 549, enterprise: 549 };

    res.json(rows.map(r => ({
      agencyId:         r.AGENCY_ID,
      name:             r.NAME,
      plan:             r.SUBSCRIPTION_PLAN || 'free',
      status:           r.SUBSCRIPTION_STATUS || 'active',
      stripeCustomerId: r.STRIPE_CUSTOMER_ID || null,
      stripeSubId:      r.STRIPE_SUBSCRIPTION_ID || null,
      brandCount:       Number(r.BRAND_COUNT || 0),
      primaryEmail:     r.PRIMARY_EMAIL || null,
      lastLoginAt:      r.LAST_LOGIN_AT || null,
      mrr:              PLAN_MRR[r.SUBSCRIPTION_PLAN] || 0,
      createdAt:        r.CREATED_AT,
    })));
  } catch (err) { next(err); }
});

/**
 * GET /admin/brands-roster
 * Returns all brands (manager_accounts) with agency name, status, and connection count
 */
router.get('/brands-roster', requireAdmin, async (req, res, next) => {
  try {
    const rows = await query(`
      SELECT
        m.manager_id,
        m.name AS brand_name,
        m.subscription_plan,
        m.subscription_status,
        m.agency_id,
        a.name AS agency_name,
        c.client_id,
        c.email,
        c.status AS client_status,
        c.last_login_at,
        c.created_at,
        COUNT(DISTINCT adv.advertiser_id) AS advertiser_count
      FROM CALBRIDGE_PROD.APP.manager_accounts m
      LEFT JOIN CALBRIDGE_PROD.APP.agency_accounts a ON a.agency_id = m.agency_id
      LEFT JOIN CALBRIDGE_PROD.APP.client_migration_map map ON map.manager_id = m.manager_id
      LEFT JOIN CALBRIDGE_PROD.APP.clients c ON c.client_id = map.client_id
      LEFT JOIN CALBRIDGE_PROD.APP.advertiser_accounts adv ON adv.manager_id = m.manager_id AND adv.is_active = TRUE
      GROUP BY m.manager_id, m.name, m.subscription_plan, m.subscription_status, m.agency_id,
               a.name, c.client_id, c.email, c.status, c.last_login_at, c.created_at
      ORDER BY a.name NULLS LAST, m.name
    `, []);

    res.json(rows.map(r => ({
      managerId:       r.MANAGER_ID,
      brandName:       r.BRAND_NAME,
      plan:            r.SUBSCRIPTION_PLAN || 'free',
      status:          r.CLIENT_STATUS || r.SUBSCRIPTION_STATUS || 'active',
      agencyId:        r.AGENCY_ID || null,
      agencyName:      r.AGENCY_NAME || '(No Agency)',
      clientId:        r.CLIENT_ID || null,
      email:           r.EMAIL || null,
      lastLoginAt:     r.LAST_LOGIN_AT || null,
      advertiserCount: Number(r.ADVERTISER_COUNT || 0),
      createdAt:       r.CREATED_AT,
    })));
  } catch (err) { next(err); }
});

/**
 * POST /admin/agencies/:agencyId/assign-email
 * Assign a primary contact email to an agency owner client
 */
router.post('/agencies/:agencyId/assign-email', requireAdmin, async (req, res, next) => {
  try {
    const { agencyId } = req.params;
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'email required' });
    await query(
      `UPDATE CALBRIDGE_PROD.APP.clients SET email = ?
       WHERE client_id IN (
         SELECT map.client_id FROM CALBRIDGE_PROD.APP.client_migration_map map
         JOIN CALBRIDGE_PROD.APP.manager_accounts m ON m.manager_id = map.manager_id
         WHERE m.agency_id = ? AND map.client_id = map.advertiser_id
       )`,
      [email, agencyId]
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

/**
 * POST /admin/agencies/:agencyId/billing-exempt
 * Set or clear billing_exempt for an agency and all its brands.
 * Body: { exempt: true | false }
 */
router.post('/agencies/:agencyId/billing-exempt', requireAdmin, async (req, res, next) => {
  try {
    const { agencyId } = req.params;
    const exempt = req.body.exempt !== false; // default true
    await query(
      'UPDATE CALBRIDGE_PROD.APP.agency_accounts SET billing_exempt = ? WHERE agency_id = ?',
      [exempt, agencyId]
    );
    // Also update all manager_accounts under this agency
    await query(
      'UPDATE CALBRIDGE_PROD.APP.manager_accounts SET billing_exempt = ? WHERE agency_id = ?',
      [exempt, agencyId]
    );
    res.json({ ok: true, agencyId, billingExempt: exempt });
  } catch (err) { next(err); }
});

/**
 * POST /admin/brands/:managerId/status
 * Change brand active/inactive/suspended status
 */
router.post('/brands/:managerId/status', requireAdmin, async (req, res, next) => {
  try {
    const { managerId } = req.params;
    const { status } = req.body;
    if (!['active', 'inactive', 'suspended'].includes(status)) {
      return res.status(400).json({ error: 'invalid status' });
    }
    await query(
      `UPDATE CALBRIDGE_PROD.APP.manager_accounts SET subscription_status = ? WHERE manager_id = ?`,
      [status, managerId]
    );
    await query(
      `UPDATE CALBRIDGE_PROD.APP.clients SET status = ?
       WHERE client_id IN (SELECT client_id FROM CALBRIDGE_PROD.APP.client_migration_map WHERE manager_id = ?)`,
      [status === 'active' ? 'active' : 'inactive', managerId]
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;

