const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { requireAuth } = require('../middleware/requireAuth');
const { query } = require('../services/snowflakeService');
const { removeBackground } = require('../services/removeBackground');

// Logo upload config
const storage = multer.diskStorage({
  destination: path.join(__dirname, '../../public/uploads/logos'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${req.session.clientId}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  }
});

/**
 * GET /account/profile
 * Get full profile for logged-in client
 */
router.get('/profile', requireAuth, async (req, res, next) => {
  try {
    const rows = await query(`
      SELECT client_id, email, name, company_name, logo_url, team_members, created_at, weekly_report_enabled
      FROM clients WHERE client_id = ?
    `, [req.session.clientId]);
    if (!rows.length) return res.status(404).json({ error: 'Client not found' });
    const r = rows[0];
    res.json({
      id:                  r.CLIENT_ID,
      email:               r.EMAIL,
      name:                r.NAME,
      companyName:         r.COMPANY_NAME || r.NAME,
      logoUrl:             r.LOGO_URL || null,
      teamMembers:         r.TEAM_MEMBERS ? JSON.parse(r.TEAM_MEMBERS) : [],
      createdAt:           r.CREATED_AT,
      weeklyReportEnabled: r.WEEKLY_REPORT_ENABLED !== false  // default true
    });
  } catch (err) { next(err); }
});

/**
 * PATCH /account/profile
 * Update name, company name, and email preferences
 */
router.patch('/profile', requireAuth, async (req, res, next) => {
  try {
    const { name, companyName, weeklyReportEnabled } = req.body;

    // Build update fields dynamically
    const updates = [];
    const binds   = [];

    if (name !== undefined)         { updates.push('name = ?');                  binds.push(name); }
    if (companyName !== undefined)  { updates.push('company_name = ?');          binds.push(companyName); }
    if (weeklyReportEnabled !== undefined) {
      updates.push('weekly_report_enabled = ?');
      binds.push(weeklyReportEnabled === true || weeklyReportEnabled === 'true');
    }

    if (!updates.length) return res.json({ message: 'Nothing to update' });

    binds.push(req.session.clientId);
    await query(`UPDATE clients SET ${updates.join(', ')} WHERE client_id = ?`, binds);
    res.json({ message: 'Profile updated' });
  } catch (err) { next(err); }
});

/**
 * POST /account/logo
 * Upload client logo
 */
router.post('/logo', requireAuth, upload.single('logo'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded or invalid type (PNG, JPG, SVG, WebP allowed)' });

    const uploadedPath = req.file.path;
    const ext = path.extname(req.file.originalname).toLowerCase();
    let finalPath = uploadedPath;
    let finalFilename = req.file.filename;

    // Auto-remove background for non-SVG images
    if (ext !== '.svg') {
      const pngFilename = `${req.session.clientId}.png`;
      const pngPath = path.join(path.dirname(uploadedPath), pngFilename);
      try {
        await removeBackground(uploadedPath, pngPath);
        // Clean up original if it was a different format
        if (uploadedPath !== pngPath) fs.unlinkSync(uploadedPath);
        finalPath = pngPath;
        finalFilename = pngFilename;
      } catch (bgErr) {
        console.warn('[Logo] Background removal failed, using original:', bgErr.message);
        // Fall through — use original if bg removal fails
      }
    }

    const logoUrl = `/uploads/logos/${finalFilename}`;
    await query(`UPDATE clients SET logo_url = ? WHERE client_id = ?`, [logoUrl, req.session.clientId]);
    res.json({ message: 'Logo uploaded', logoUrl });
  } catch (err) { next(err); }
});

/**
 * DELETE /account/logo
 * Remove client logo
 */
router.delete('/logo', requireAuth, async (req, res, next) => {
  try {
    await query(`UPDATE clients SET logo_url = NULL WHERE client_id = ?`, [req.session.clientId]);
    res.json({ message: 'Logo removed' });
  } catch (err) { next(err); }
});

/**
 * POST /account/change-password
 * Change password
 */
router.post('/change-password', requireAuth, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Both current and new password required' });
    if (newPassword.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' });

    const rows = await query(`SELECT password_hash FROM clients WHERE client_id = ?`, [req.session.clientId]);
    if (!rows.length) return res.status(404).json({ error: 'Client not found' });

    const valid = await bcrypt.compare(currentPassword, rows[0].PASSWORD_HASH);
    if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });

    const hash = await bcrypt.hash(newPassword, 12);
    await query(`UPDATE clients SET password_hash = ? WHERE client_id = ?`, [hash, req.session.clientId]);
    res.json({ message: 'Password changed successfully' });
  } catch (err) { next(err); }
});

/**
 * GET /account/team
 * Get team members
 */
router.get('/team', requireAuth, async (req, res, next) => {
  try {
    const rows = await query(`SELECT team_members FROM clients WHERE client_id = ?`, [req.session.clientId]);
    const members = rows[0]?.TEAM_MEMBERS ? JSON.parse(rows[0].TEAM_MEMBERS) : [];
    res.json(members);
  } catch (err) { next(err); }
});

/**
 * POST /account/team
 * Invite a team member
 */
router.post('/team', requireAuth, async (req, res, next) => {
  try {
    const { email, name, role = 'viewer' } = req.body;
    if (!email || !name) return res.status(400).json({ error: 'email and name required' });

    const rows = await query(`SELECT team_members FROM clients WHERE client_id = ?`, [req.session.clientId]);
    const members = rows[0]?.TEAM_MEMBERS ? JSON.parse(rows[0].TEAM_MEMBERS) : [];

    if (members.find(m => m.email === email.toLowerCase())) {
      return res.status(409).json({ error: 'Team member already exists' });
    }

    const newMember = {
      id:        uuidv4(),
      email:     email.toLowerCase().trim(),
      name,
      role,       // viewer | admin
      invitedAt: new Date().toISOString(),
      status:    'pending'
    };
    members.push(newMember);

    await query(`UPDATE clients SET team_members = ? WHERE client_id = ?`,
      [JSON.stringify(members), req.session.clientId]);

    // Send invitation email
    try {
      const { Resend } = require('resend');
      const resend = new Resend(process.env.RESEND_API_KEY);
      const baseUrl = process.env.BASE_URL || 'https://app.teamcalbridge.com';
      // Get inviting client's company name
      const clientRows = await query('SELECT company_name, name FROM clients WHERE client_id = ?', [req.session.clientId]);
      const companyName = clientRows[0]?.COMPANY_NAME || clientRows[0]?.NAME || 'Calbridge';
      await resend.emails.send({
        from: `Calbridge <${process.env.EMAIL_FROM || 'ash@teamcalbridge.com'}>`,
        to: [newMember.email],
        subject: `You've been invited to ${companyName} on Calbridge`,
        html: `
          <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#fff;border-radius:8px">
            <img src="${baseUrl}/images/calbridge-logo.png" alt="Calbridge" style="height:60px;margin-bottom:24px" />
            <h2 style="color:#1e3a1a;margin:0 0 8px">You're invited to ${companyName}</h2>
            <p style="color:#4b5563;margin:0 0 24px">Hi ${name}, you've been invited to access the Calbridge analytics portal for ${companyName} as a <strong>${role}</strong>.</p>
            <a href="${baseUrl}/signup.html?email=${encodeURIComponent(newMember.email)}" style="display:inline-block;background:#2d5a27;color:#fff;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:600">Accept Invitation</a>
            <p style="color:#9ca3af;font-size:12px;margin:24px 0 0">If you weren't expecting this invitation, you can safely ignore this email.</p>
          </div>
        `
      });
      console.log(`[Account] Invitation email sent to ${newMember.email}`);
    } catch (emailErr) {
      console.error('[Account] Failed to send invitation email:', emailErr.message);
      // Non-fatal — member is still added
    }

    res.status(201).json({ message: 'Team member invited', member: newMember });
  } catch (err) { next(err); }
});

/**
 * DELETE /account/team/:memberId
 * Remove a team member
 */
router.delete('/team/:memberId', requireAuth, async (req, res, next) => {
  try {
    const rows = await query(`SELECT team_members FROM clients WHERE client_id = ?`, [req.session.clientId]);
    const members = (rows[0]?.TEAM_MEMBERS ? JSON.parse(rows[0].TEAM_MEMBERS) : [])
      .filter(m => m.id !== req.params.memberId);

    await query(`UPDATE clients SET team_members = ? WHERE client_id = ?`,
      [JSON.stringify(members), req.session.clientId]);
    res.json({ message: 'Team member removed' });
  } catch (err) { next(err); }
});

/**
 * POST /account/complete-onboarding
 * Mark onboarding as completed for the logged-in client
 */
router.post('/complete-onboarding', requireAuth, async (req, res, next) => {
  try {
    await query(`
      UPDATE clients SET onboarding_completed = TRUE WHERE client_id = ?
    `, [req.session.clientId]);
    res.json({ message: 'Onboarding completed' });
  } catch (err) { next(err); }
});

module.exports = router;
