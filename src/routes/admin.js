/**
 * Admin routes — session-based auth for admin users
 */
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../services/snowflakeService');
const { Resend } = require('resend');

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
 * List all clients with status
 */
router.get('/clients', requireAdmin, async (req, res, next) => {
  try {
    const rows = await query(`
      SELECT client_id, email, name, company_name, status, created_at, approved_at
      FROM clients
      ORDER BY created_at DESC
    `);
    res.json(rows.map(r => ({
      id:          r.CLIENT_ID,
      email:       r.EMAIL,
      name:        r.NAME,
      companyName: r.COMPANY_NAME,
      status:      r.STATUS || 'active',
      createdAt:   r.CREATED_AT,
      approvedAt:  r.APPROVED_AT
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
        text: `Hi ${name || 'there'},\n\nYour Calbridge Client Portal account has been approved. You can now log in at:\n\nhttps://app.teamcalbridge.com\n\nOnce logged in, go to Account to connect your Amazon accounts and get started.\n\nIf you have any questions, reply to this email.\n\nThe Calbridge Team`
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
      text: `Hi ${name},\n\nYou have been invited to access the Calbridge Client Portal.\n\nCreate your password and log in at:\nhttps://app.teamcalbridge.com/signup.html\n\nUse this email address: ${email}\n\nIf you have any questions, contact us at ${process.env.EMAIL_CC}.\n\nThe Calbridge Team`
    });

    res.status(201).json({ message: `Invite sent to ${email}`, clientId: id });
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

module.exports = router;
