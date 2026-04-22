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

  await query(`
    INSERT INTO clients (client_id, email, name, password_hash, status, created_at)
    VALUES (?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP)
  `, [id, email, name, hash]);

  // ── Phase 3F: Create 4-tier account hierarchy entries ──────────────────────
  // This is purely additive — existing client row is preserved above.
  try {
    const orgName = (companyName || name).trim();

    // 1. Create manager_account — starts on free plan with 14-day trial
    const managerId = uuidv4();
    await query(`
      INSERT INTO CALBRIDGE_PROD.APP.manager_accounts
        (manager_id, name, agency_id, subscription_plan, subscription_status, trial_ends_at, created_at)
      VALUES (?, ?, NULL, 'free', 'active', DATEADD('day', 14, CURRENT_TIMESTAMP()), CURRENT_TIMESTAMP)
    `, [managerId, orgName]);

    // Also set free plan + trial on the clients row, store account_type
    await query(`
      UPDATE clients SET subscription_plan='free', subscription_status='active',
        trial_ends_at = DATEADD('day', 14, CURRENT_TIMESTAMP()) WHERE client_id=?
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

  // Notify Abe
  await sendApprovalEmail({ id, email, name }).catch(err =>
    console.warn('[Auth] Approval email failed:', err.message)
  );

  return { id, email, name, status: 'pending' };
}

async function sendApprovalEmail({ id, email, name }) {
  const { Resend } = require('resend');
  const resend = new Resend(process.env.RESEND_API_KEY);
  await resend.emails.send({
    from: `Calbridge Portal <${process.env.EMAIL_FROM}>`,
    to: [process.env.EMAIL_CC],
    subject: `New signup pending approval: ${name}`,
    text: `A new client has signed up and is awaiting your approval.\n\nName: ${name}\nEmail: ${email}\nClient ID: ${id}\n\nTo approve:\nPOST https://app.teamcalbridge.com/admin/approve/${id}\n\nOr log into your admin panel to manage pending accounts.`
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
