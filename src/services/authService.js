const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { query } = require('./snowflakeService');

/**
 * Auth service — Snowflake-backed client accounts
 */

async function signup({ email, password, name, companyName, account_type = 'brand' }) {
  email = email.toLowerCase().trim();
  // Check existing
  const existing = await query(
    `SELECT client_id FROM clients WHERE email = ?`, [email]
  );
  if (existing.length) {
    const err = new Error('EMAIL_TAKEN'); err.status = 409; throw err;
  }

  const id = uuidv4();
  const hash = await bcrypt.hash(password, 12);
  const verifyToken = require('crypto').randomBytes(32).toString('hex');

  await query(`
    INSERT INTO clients (client_id, email, name, client_name, client_type, password_hash, status, email_verification_token, email_verification_expires_at, created_at)
    VALUES (?, ?, ?, ?, 'brand', ?, 'pending_verification', ?, DATEADD('hour', 48, CURRENT_TIMESTAMP()), CURRENT_TIMESTAMP)
  `, [id, email, name, (companyName || name).trim(), hash, verifyToken]);

  // ── Phase 3F: Create 4-tier account hierarchy entries ──────────────────────
  // This is purely additive — existing client row is preserved above.
  try {
    const orgName = (companyName || name).trim();

    // 1. Create manager_account — starts on free plan with 14-day trial
    const managerId = uuidv4();
    await query(`
      INSERT INTO CALBRIDGE_PROD.APP.manager_accounts
        (manager_id, name, agency_id, subscription_plan, subscription_status, trial_ends_at, created_at)
      VALUES (?, ?, NULL, 'free', 'active', NULL, CURRENT_TIMESTAMP)
    `, [managerId, orgName]);

    // Also set free plan + trial on the clients row, store account_type
    await query(`
      UPDATE clients SET subscription_plan='free', subscription_status='active',
        trial_ends_at = NULL,
        approved_at = CURRENT_TIMESTAMP() WHERE client_id=?
    `, [id]).catch(() => {});
    // Store account_type (brand or agency) — non-fatal if column doesn't exist yet
    await query(`UPDATE clients SET account_type=? WHERE client_id=?`, [account_type, id]).catch(() => {});

    // 2. Create user row
    const userId = uuidv4();
    await query(`
      INSERT INTO CALBRIDGE_PROD.APP.users
        (user_id, client_id, email, name, role, is_active, created_at)
      VALUES (?, ?, ?, ?, 'manager_owner', TRUE, CURRENT_TIMESTAMP)
    `, [userId, id, email, name]);

    // 3. Create first advertiser_account
    const advertiserId = uuidv4();
    await query(`
      INSERT INTO CALBRIDGE_PROD.APP.advertiser_accounts
        (advertiser_id, manager_id, name, marketplace, is_active, created_at)
      VALUES (?, ?, ?, 'US', TRUE, CURRENT_TIMESTAMP)
    `, [advertiserId, managerId, `${orgName} · US`]);

    // 4. Create user_advertiser_access row
    await query(`
      INSERT INTO CALBRIDGE_PROD.APP.user_advertiser_access
        (user_id, advertiser_id, role)
      VALUES (?, ?, 'manager_owner')
    `, [userId, advertiserId]);

    // 5. Insert into client_migration_map
    await query(`
      INSERT INTO CALBRIDGE_PROD.APP.client_migration_map
        (client_id, manager_id, advertiser_id, agency_id)
      VALUES (?, ?, ?, NULL)
    `, [id, managerId, advertiserId]);

    console.log(`[Auth] Phase 3 hierarchy created for ${email}: manager=${managerId}, advertiser=${advertiserId}, user=${userId}`);
  } catch (phase3Err) {
    // Non-fatal — existing client row was already created successfully
    console.error('[Auth] Phase 3 hierarchy creation failed (non-fatal):', phase3Err.message);
  }
  // ── End Phase 3F ───────────────────────────────────────────────────────────

  // Initialize nav config — dynamic locking happens in navConfig.js
  try {
    const navPaths = ['/', '/vendor', '/forecasting', '/cogs', '/advertising', '/pacing', '/account'];
    for (const path of navPaths) {
      await query(
        `INSERT INTO CALBRIDGE_PROD.APP.CLIENT_NAV_CONFIG (client_id, nav_path, visibility)
         SELECT ?, ?, 'visible' WHERE NOT EXISTS (
           SELECT 1 FROM CALBRIDGE_PROD.APP.CLIENT_NAV_CONFIG WHERE client_id=? AND nav_path=?
         )`,
        [id, path, id, path]
      ).catch(() => {}); // non-fatal
    }
  } catch (navErr) {
    console.warn('[Auth] Nav config init failed (non-fatal):', navErr.message);
  }

  // Send verification email to user
  const baseUrl = process.env.BASE_URL || 'https://app.calbridge.ai';
  const verifyUrl = `${baseUrl}/auth/verify-email?token=${verifyToken}`;
  try {
    const { Resend } = require('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: `Ash at Calbridge <${process.env.EMAIL_FROM || 'ash@teamcalbridge.com'}>`,
      to: email,
      subject: 'Verify your Calbridge email',
      html: `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;color:#1a1a1a;">
          <img src="${baseUrl}/images/calbridge-logo.png" alt="Calbridge" style="height:40px;margin-bottom:24px;" />
          <h2 style="font-size:20px;font-weight:700;margin:0 0 8px;">Verify your email</h2>
          <p style="color:#4b5563;margin:0 0 24px;line-height:1.6;">Click the button below to verify your email and activate your Calbridge account.</p>
          <a href="${verifyUrl}" style="display:inline-block;background:#15803d;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:14px;">Verify Email &rarr;</a>
          <p style="color:#9ca3af;font-size:12px;margin:24px 0 0;line-height:1.5;">This link expires in 48 hours. If you didn't sign up for Calbridge, you can safely ignore this email.</p>
          <p style="color:#9ca3af;font-size:11px;border-top:1px solid #e5e7eb;padding-top:16px;margin-top:16px;">&copy; 2026 Calbridge &middot; <a href="https://calbridge.ai" style="color:#9ca3af;">calbridge.ai</a></p>
        </div>`,
    });
  } catch (emailErr) {
    console.warn('[Auth] Verification email failed:', emailErr.message);
    // Non-fatal — account still created, user can request resend
  }

  // Notify Abe (pending verification)
  await sendWelcomeEmailToAbe({ id, email, name }).catch(err =>
    console.warn('[Auth] Welcome email failed:', err.message)
  );

  return { id, email, name, status: 'pending_verification' };
}

async function sendWelcomeEmailToAbe({ id, email, name }) {
  const { Resend } = require('resend');
  const resend = new Resend(process.env.RESEND_API_KEY);
  await resend.emails.send({
    from: `Calbridge Portal <${process.env.EMAIL_FROM}>`,
    to: [process.env.EMAIL_CC],
    subject: `New signup (pending verification): ${name}`,
    text: `${name} (${email}) just signed up for the Calbridge beta.\n\nClient ID: ${id}\n\nAccount status: pending_verification (awaiting email confirmation).\n\nView in admin panel: https://app.calbridge.ai/admin`
  });
}

async function login({ email, password }) {
  email = email.toLowerCase().trim();
  const rows = await query(
    `SELECT client_id, email, name, password_hash, status, linked_client_id FROM clients WHERE email = ?`, [email]
  );
  if (!rows.length) throw new Error('INVALID_CREDENTIALS');
  const row = rows[0];
  const valid = await bcrypt.compare(password, row.PASSWORD_HASH);
  if (!valid) throw new Error('INVALID_CREDENTIALS');
  if (row.STATUS === 'pending_verification') { const err = new Error('EMAIL_NOT_VERIFIED'); err.status = 403; throw err; }
  if (row.STATUS === 'pending') throw new Error('PENDING_APPROVAL');
  if (row.STATUS === 'suspended') throw new Error('ACCOUNT_SUSPENDED');
  // Stamp last login time
  await query('UPDATE clients SET last_login_at = CURRENT_TIMESTAMP WHERE client_id = ?', [row.CLIENT_ID])
    .catch(err => console.warn('[Auth] last_login_at update failed:', err.message));
  // If this account is linked to a parent (e.g. a viewer/team member on a client account),
  // use the parent's client_id so all queries run against the correct data.
  const effectiveId = row.LINKED_CLIENT_ID || row.CLIENT_ID;
  return { id: effectiveId, email: row.EMAIL, name: row.NAME, status: row.STATUS };
}

async function getById(id) {
  const rows = await query(
    `SELECT client_id, email, name, connections FROM clients WHERE client_id = ?`, [id]
  );
  if (!rows.length) {
    const err = new Error('Client not found'); err.status = 404; throw err;
  }
  const row = rows[0];
  return {
    id: row.CLIENT_ID,
    email: row.EMAIL,
    name: row.NAME,
    connections: row.CONNECTIONS
      ? (typeof row.CONNECTIONS === 'string' ? JSON.parse(row.CONNECTIONS) : row.CONNECTIONS)
      : {}
  };
}

async function updateClient(id, updates) {
  if (updates.connections !== undefined) {
    const val = typeof updates.connections === 'string'
      ? updates.connections
      : JSON.stringify(updates.connections);
    await query(`UPDATE clients SET connections = PARSE_JSON(?) WHERE client_id = ?`, [val, id]);
  }
  return getById(id);
}

module.exports = { signup, login, getById, updateClient };
