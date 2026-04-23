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
    const { email, password, name, companyName, account_type } = req.body;
    if (!email || !password || !name) {
      return res.status(400).json({ error: 'name, email and password are required' });
    }
    // Pass companyName and account_type through to authService
    const client = await authService.signup({ email, password, name, companyName, account_type: account_type || 'brand' });
    // Don't set session — account is pending_verification until email confirmed
    res.status(201).json({ message: 'Account created', status: 'pending_verification', client: { id: client.id, email: client.email, name: client.name, accountType: account_type || 'brand' } });

    // Send welcome email to user is now handled in authService.signup (verification email)
    // Still send the brand-setup onboarding email non-blocking after verification —
    // keeping this block but it will only fire after the account is later activated.
    // For now we suppress it on signup (user hasn't verified yet).
    if (false) setImmediate(async () => {
      try {
        const { Resend } = require('resend');
        const resend = new Resend(process.env.RESEND_API_KEY);
        const baseUrl = process.env.BASE_URL || 'https://app.calbridge.ai';
        const firstName = (name || '').split(' ')[0] || 'there';
        await resend.emails.send({
          from: `Ash at Calbridge <${process.env.EMAIL_FROM || 'ash@teamcalbridge.com'}>`,
          to: email,
          subject: 'Welcome to Calbridge — let\'s connect your Amazon account',
          html: `
<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;color:#1a1a1a;">
  <img src="https://app.calbridge.ai/images/calbridge-logo.png" alt="Calbridge" style="height:56px;margin-bottom:24px;">
  <h1 style="font-size:22px;font-weight:700;margin:0 0 8px;">Welcome, ${firstName}!</h1>
  <p style="color:#4b5563;margin:0 0 20px;line-height:1.6;">Your Calbridge account is ready. Here\'s how to get started:</p>

  <div style="background:#f9fafb;border-radius:8px;padding:20px 24px;margin-bottom:20px;">
    <p style="font-weight:600;margin:0 0 12px;">Step 1 — Connect your Amazon account</p>
    <p style="color:#4b5563;margin:0 0 12px;font-size:14px;">Head to Brand Setup and connect your Seller Central, Advertising, or Vendor Central account.</p>
    <a href="${baseUrl}/brand-setup.html" style="display:inline-block;background:#2d5a27;color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px;font-weight:600;font-size:14px;">Connect Amazon Account</a>
  </div>

  <div style="background:#f9fafb;border-radius:8px;padding:20px 24px;margin-bottom:20px;">
    <p style="font-weight:600;margin:0 0 12px;">Step 2 — View your dashboard</p>
    <p style="color:#4b5563;margin:0 0 12px;font-size:14px;">Once connected, your advertising and retail data will start syncing automatically.</p>
    <a href="${baseUrl}/analytics/" style="display:inline-block;background:#2d5a27;color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px;font-weight:600;font-size:14px;">Open Dashboard</a>
  </div>

  <p style="color:#4b5563;font-size:14px;line-height:1.6;margin:0 0 8px;">Questions? Just reply to this email — I\'ll get back to you.</p>
  <p style="color:#4b5563;font-size:14px;margin:0 0 32px;">— Abe, Calbridge</p>
  <p style="color:#9ca3af;font-size:11px;border-top:1px solid #e5e7eb;padding-top:16px;">© 2026 Calbridge · <a href="https://calbridge.ai" style="color:#9ca3af;">calbridge.ai</a></p>
</body></html>`
        });
        console.log(`[Auth] Welcome email sent to ${email}`);
      } catch (emailErr) {
        console.error('[Auth] Welcome email failed (non-fatal):', emailErr.message);
      }
    }); // end if(false)
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
    // Always clear advertiser override on fresh login — prevents data bleed between accounts
    req.session.activeAdvertiserId = null;
    req.session.activeMarketplace  = null;

    // Phase 3F: Enrich session with new account model (non-fatal if map not found)
    try {
      const map = await query(
        'SELECT agency_id, manager_id, advertiser_id FROM CALBRIDGE_PROD.APP.client_migration_map WHERE client_id = ?',
        [client.id]
      );
      if (map.length) {
        req.session.agencyId     = map[0].AGENCY_ID     || null;
        req.session.managerId    = map[0].MANAGER_ID    || null;
        req.session.advertiserId = map[0].ADVERTISER_ID || null;
      }
    } catch (e) {
      // Non-fatal — old sessions still work via clientId
      console.warn('[Auth] Phase 3 session enrichment failed (non-fatal):', e.message);
    }

    // Determine role: check if this user is a team member on a parent account
    // authService.login returns effectiveId (parent's clientId for linked accounts)
    // We need to check the original user record for linked_client_id + find their role
    let userRole = 'owner';
    try {
      const userRows = await query(
        `SELECT client_id, linked_client_id FROM clients WHERE email = ?`, [email.toLowerCase().trim()]
      );
      const userRecord = userRows[0];
      if (userRecord?.LINKED_CLIENT_ID) {
        // This is a team member — look up their role from the parent's team_members
        const parentRows = await query(
          `SELECT team_members FROM clients WHERE client_id = ?`, [userRecord.LINKED_CLIENT_ID]
        );
        const members = parentRows[0]?.TEAM_MEMBERS
          ? (typeof parentRows[0].TEAM_MEMBERS === 'string'
              ? (typeof parentRows[0].TEAM_MEMBERS === "string" ? JSON.parse(parentRows[0].TEAM_MEMBERS) : parentRows[0].TEAM_MEMBERS)
              : parentRows[0].TEAM_MEMBERS)
          : [];
        const member = members.find(m => m.email === email.toLowerCase().trim());
        userRole = member?.role || 'viewer';
      }
    } catch (roleErr) {
      console.warn('[Auth] Role lookup failed, defaulting to owner:', roleErr.message);
    }
    req.session.userRole = userRole;

    // Fetch onboarding status + account type for redirect logic on the client side
    const rows = await query(
      `SELECT onboarding_completed, account_type FROM clients WHERE client_id = ?`, [client.id]
    ).catch(() => []);
    const onboardingCompleted = rows[0]?.ONBOARDING_COMPLETED ?? false;
    const accountType = rows[0]?.ACCOUNT_TYPE || 'brand';

    res.json({
      message: 'Logged in',
      client: {
        id:                  client.id,
        email:               client.email,
        name:                client.name,
        role:                userRole,
        onboardingCompleted: !!onboardingCompleted,
        accountType,
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
    if (err.message === 'EMAIL_NOT_VERIFIED') {
      return res.status(403).json({ error: 'EMAIL_NOT_VERIFIED', message: 'Please verify your email before signing in. Check your inbox for a verification link.' });
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
    // Also fetch logoUrl and companyName for the dashboard header
    const rows = await require('../services/snowflakeService').query(
      `SELECT company_name, logo_url, account_type, onboarding_completed FROM clients WHERE client_id = ?`,
      [req.session.clientId]
    );
    const extra = rows?.[0] || {};
    const onboardingCompleted = extra.ONBOARDING_COMPLETED ?? extra.onboarding_completed ?? null;
    res.json({
      client: {
        id:                  client.id,
        email:               client.email,
        name:                client.name,
        companyName:         extra.COMPANY_NAME || extra.company_name || client.name,
        logoUrl:             extra.LOGO_URL     || extra.logo_url     || null,
        role:                req.session.userRole || 'owner',
        accountType:         extra.ACCOUNT_TYPE || extra.account_type || 'brand',
        onboardingCompleted: !!onboardingCompleted,
        isBrandSession:      !!req.session.isBrandSession,
        agencyClientId:      req.session.agencyClientId || null,
      }
    });
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
        from:    `Calbridge <${process.env.EMAIL_FROM || 'ash@calbridge.ai'}>`,
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

// GET /auth/verify-email?token=xxx
router.get('/verify-email', async (req, res, next) => {
  try {
    const { token } = req.query;
    if (!token) return res.redirect('/index.html?error=invalid_token');

    const rows = await query(
      `SELECT client_id, email_verification_expires_at, status
       FROM clients
       WHERE email_verification_token = ?
         AND status = 'pending_verification'`,
      [token]
    );

    if (!rows.length) {
      return res.redirect('/index.html?error=invalid_token');
    }

    const row = rows[0];
    const expires = new Date(row.EMAIL_VERIFICATION_EXPIRES_AT || row.email_verification_expires_at);
    if (expires < new Date()) {
      return res.redirect('/index.html?error=token_expired');
    }

    const clientId = row.CLIENT_ID || row.client_id;

    // Activate account
    await query(
      `UPDATE clients
       SET status = 'active',
           email_verified_at = CURRENT_TIMESTAMP(),
           email_verification_token = NULL,
           approved_at = COALESCE(approved_at, CURRENT_TIMESTAMP())
       WHERE client_id = ?`,
      [clientId]
    );

    // Auto-login: set session
    req.session.clientId = clientId;

    // Redirect to app — Welcome modal will fire since onboarding_completed is false
    res.redirect('/analytics/');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
