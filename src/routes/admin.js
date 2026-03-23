/**
 * Admin routes — protected by ADMIN_SECRET header
 * Used by Abe to manage client accounts
 */
const express = require('express');
const router = express.Router();
const { query } = require('../services/snowflakeService');
const { Resend } = require('resend');

// Admin auth middleware — requires X-Admin-Secret header
function requireAdmin(req, res, next) {
  const secret = req.headers['x-admin-secret'] || req.query.secret;
  if (!secret || secret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

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
