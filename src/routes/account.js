const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { requireAuth } = require('../middleware/requireAuth');
const { query } = require('../services/snowflakeService');

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
      SELECT client_id, email, name, company_name, logo_url, team_members, created_at
      FROM clients WHERE client_id = ?
    `, [req.session.clientId]);
    if (!rows.length) return res.status(404).json({ error: 'Client not found' });
    const r = rows[0];
    res.json({
      id:          r.CLIENT_ID,
      email:       r.EMAIL,
      name:        r.NAME,
      companyName: r.COMPANY_NAME || r.NAME,
      logoUrl:     r.LOGO_URL || null,
      teamMembers: r.TEAM_MEMBERS ? JSON.parse(r.TEAM_MEMBERS) : [],
      createdAt:   r.CREATED_AT
    });
  } catch (err) { next(err); }
});

/**
 * PATCH /account/profile
 * Update name and company name
 */
router.patch('/profile', requireAuth, async (req, res, next) => {
  try {
    const { name, companyName } = req.body;
    await query(`
      UPDATE clients SET name = ?, company_name = ? WHERE client_id = ?
    `, [name, companyName, req.session.clientId]);
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
    const logoUrl = `/uploads/logos/${req.file.filename}`;
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

module.exports = router;
