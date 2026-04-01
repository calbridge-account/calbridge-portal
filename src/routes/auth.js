const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const authService = require('../services/authService');
const { requireAuth } = require('../middleware/requireAuth');
const { query } = require('../services/snowflakeService');

// POST /auth/signup
router.post('/signup', async (req, res, next) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password || !name) {
      return res.status(400).json({ error: 'name, email and password are required' });
    }
    const client = await authService.signup({ email, password, name });
    req.session.clientId = client.id;
    res.status(201).json({ message: 'Account created', client: { id: client.id, email: client.email, name: client.name } });
  } catch (err) {
    next(err);
  }
});

// POST /auth/login
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'email and password required' });
    const client = await authService.login({ email, password });
    req.session.clientId = client.id;

    // Fetch onboarding status for redirect logic on the client side
    const rows = await query(
      `SELECT onboarding_completed FROM clients WHERE client_id = ?`, [client.id]
    ).catch(() => []);
    const onboardingCompleted = rows[0]?.ONBOARDING_COMPLETED ?? false;

    res.json({
      message: 'Logged in',
      client: {
        id:                  client.id,
        email:               client.email,
        name:                client.name,
        onboardingCompleted: !!onboardingCompleted
      }
    });
  } catch (err) {
    if (err.message === 'INVALID_CREDENTIALS') {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    if (err.message === 'PENDING_APPROVAL') {
      return res.status(403).json({ error: 'PENDING_APPROVAL', message: 'Your account is pending approval. You will receive an email once approved.' });
    }
    if (err.message === 'ACCOUNT_SUSPENDED') {
      return res.status(403).json({ error: 'ACCOUNT_SUSPENDED', message: 'Your account has been suspended. Please contact support.' });
    }
    next(err);
  }
});

// POST /auth/logout
router.post('/logout', requireAuth, (req, res) => {
  req.session.destroy(() => res.json({ message: 'Logged out' }));
});

// GET /auth/logout — for sidebar link / direct navigation
router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

// GET /auth/me
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const client = await authService.getById(req.session.clientId);
    res.json({ client: { id: client.id, email: client.email, name: client.name } });
  } catch (err) {
    next(err);
  }
});

// POST /auth/forgot-password
// Accepts email, generates a secure token, stores hashed version in DB, sends reset email
router.post('/forgot-password', async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'email is required' });

    const normalised = email.toLowerCase().trim();
    const rows = await query(
      `SELECT client_id, name FROM clients WHERE email = ?`, [normalised]
    );

    // Always return 200 — don't reveal whether the email exists
    if (!rows.length) {
      return res.json({ message: 'If that email exists, a reset link has been sent.' });
    }

    const client = rows[0];

    // Generate a cryptographically secure token
    const rawToken   = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expires    = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now

    await query(`
      UPDATE clients
      SET password_reset_token   = ?,
          password_reset_expires = ?
      WHERE client_id = ?
    `, [hashedToken, expires.toISOString(), client.CLIENT_ID]);

    const baseUrl  = process.env.BASE_URL || 'http://localhost:3000';
    const resetUrl = `${baseUrl}/reset-password.html?token=${rawToken}`;

    // Send reset email via Resend
    try {
      const { Resend } = require('resend');
      const resend = new Resend(process.env.RESEND_API_KEY);
      await resend.emails.send({
        from:    `Calbridge <${process.env.EMAIL_FROM || 'ash@teamcalbridge.com'}>`,
        to:      [normalised],
        subject: 'Reset your Calbridge password',
        html: `
          <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#fff;border-radius:8px;">
            <img src="${baseUrl}/images/calbridge-logo-220.png" alt="Calbridge" style="height:60px;margin-bottom:24px;" />
            <h2 style="color:#1e3a1a;margin:0 0 8px;">Reset your password</h2>
            <p style="color:#4b5563;margin:0 0 24px;">Hi ${client.NAME}, click the button below to reset your Calbridge password. This link expires in <strong>1 hour</strong>.</p>
            <a href="${resetUrl}" style="display:inline-block;background:#2d5a27;color:#fff;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:600;">Reset Password</a>
            <p style="color:#9ca3af;font-size:12px;margin:24px 0 0;">If you didn't request a password reset, you can safely ignore this email. Your password won't change.</p>
            <p style="color:#9ca3af;font-size:11px;margin:8px 0 0;">Or copy this link: ${resetUrl}</p>
          </div>
        `
      });
    } catch (emailErr) {
      console.error('[Auth] Failed to send password reset email:', emailErr.message);
      // Don't expose email failures to the client
    }

    res.json({ message: 'If that email exists, a reset link has been sent.' });
  } catch (err) { next(err); }
});

// POST /auth/reset-password
// Accepts token + new password, validates expiry, updates password, clears token
router.post('/reset-password', async (req, res, next) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'token and password are required' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    const rows = await query(`
      SELECT client_id, password_reset_expires
      FROM clients
      WHERE password_reset_token = ?
    `, [hashedToken]);

    if (!rows.length) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    const row = rows[0];
    if (new Date(row.PASSWORD_RESET_EXPIRES) < new Date()) {
      return res.status(400).json({ error: 'Reset token has expired — please request a new one' });
    }

    const hash = await bcrypt.hash(password, 12);

    await query(`
      UPDATE clients
      SET password_hash           = ?,
          password_reset_token    = NULL,
          password_reset_expires  = NULL
      WHERE client_id = ?
    `, [hash, row.CLIENT_ID]);

    res.json({ message: 'Password reset successfully. You can now log in.' });
  } catch (err) { next(err); }
});

module.exports = router;
