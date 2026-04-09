/**
 * Manager Account Routes — Phase 3B
 *
 * Provides API endpoints for the manager/advertiser/user account model.
 * These routes are additive — they do not modify existing routes or tables.
 *
 * All routes are mounted at /manager (see src/app.js).
 *
 * Session model (current): req.session.clientId
 * Session model (target):  req.session.userId / managerId / advertiserId / role
 *
 * For backward compatibility, clientId is resolved to managerId/advertiserId
 * via client_migration_map. If no mapping exists, clientId is used as both.
 */

const express = require('express');
const crypto = require('crypto');
const { query } = require('../services/snowflakeService');
const { requireAuth } = require('../middleware/requireAuth');

const router = express.Router();

// ─── Helper: Resolve manager context from session clientId ────────────────────

/**
 * Looks up manager_id and advertiser_id from client_migration_map.
 * Falls back to treating clientId as both manager and advertiser if no map entry found.
 *
 * @param {string} clientId - from req.session.clientId
 * @returns {{ managerId: string, advertiserId: string }}
 */
async function resolveManagerContext(clientId) {
  const map = await query(
    'SELECT manager_id, advertiser_id FROM CALBRIDGE_PROD.APP.client_migration_map WHERE client_id = ?',
    [clientId]
  );
  if (map.length) {
    return {
      managerId:    map[0].MANAGER_ID,
      advertiserId: map[0].ADVERTISER_ID,
    };
  }
  // Backward compat: clientId acts as both manager and advertiser
  return { managerId: clientId, advertiserId: clientId };
}

// ─── Apply requireAuth to all routes in this router ──────────────────────────

router.use(requireAuth);

// ─── GET /manager/me ──────────────────────────────────────────────────────────
// Returns the current manager account for the authenticated session.

router.get('/me', async (req, res) => {
  try {
    const { managerId } = await resolveManagerContext(req.session.clientId);

    const rows = await query(
      `SELECT manager_id, name, stripe_customer_id, stripe_subscription_id,
              subscription_plan, subscription_status, created_at
       FROM CALBRIDGE_PROD.APP.manager_accounts
       WHERE manager_id = ?`,
      [managerId]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Manager account not found' });
    }

    return res.json(rows[0]);
  } catch (err) {
    console.error('[GET /manager/me]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /manager/advertisers ─────────────────────────────────────────────────
// Lists all advertiser accounts belonging to this manager.

router.get('/advertisers', async (req, res) => {
  try {
    const { managerId } = await resolveManagerContext(req.session.clientId);

    const rows = await query(
      `SELECT advertiser_id, manager_id, name, marketplace,
              ads_profile_id, sp_seller_id, sp_vendor_id,
              dsp_advertiser_id, is_active, created_at
       FROM CALBRIDGE_PROD.APP.advertiser_accounts
       WHERE manager_id = ?
       ORDER BY name`,
      [managerId]
    );

    return res.json(rows);
  } catch (err) {
    console.error('[GET /manager/advertisers]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /manager/advertisers/:id ────────────────────────────────────────────
// Returns a single advertiser account detail (must belong to this manager).

router.get('/advertisers/:id', async (req, res) => {
  try {
    const { managerId } = await resolveManagerContext(req.session.clientId);
    const { id } = req.params;

    const rows = await query(
      `SELECT advertiser_id, manager_id, name, marketplace,
              ads_profile_id, sp_seller_id, sp_vendor_id,
              dsp_advertiser_id, is_active, created_at
       FROM CALBRIDGE_PROD.APP.advertiser_accounts
       WHERE advertiser_id = ? AND manager_id = ?`,
      [id, managerId]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Advertiser account not found' });
    }

    return res.json(rows[0]);
  } catch (err) {
    console.error('[GET /manager/advertisers/:id]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /manager/advertisers ────────────────────────────────────────────────
// Creates a new advertiser account under this manager.

router.post('/advertisers', async (req, res) => {
  try {
    const { managerId } = await resolveManagerContext(req.session.clientId);
    const {
      name,
      marketplace = 'US',
      ads_profile_id,
      sp_seller_id,
      sp_vendor_id,
      dsp_advertiser_id,
    } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'name is required' });
    }

    const advertiserId = crypto.randomUUID();

    await query(
      `INSERT INTO CALBRIDGE_PROD.APP.advertiser_accounts
         (advertiser_id, manager_id, name, marketplace,
          ads_profile_id, sp_seller_id, sp_vendor_id,
          dsp_advertiser_id, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, TRUE, CURRENT_TIMESTAMP)`,
      [
        advertiserId,
        managerId,
        name.trim(),
        marketplace,
        ads_profile_id   || null,
        sp_seller_id     || null,
        sp_vendor_id     || null,
        dsp_advertiser_id || null,
      ]
    );

    return res.status(201).json({ advertiserId, managerId, name: name.trim(), marketplace });
  } catch (err) {
    console.error('[POST /manager/advertisers]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PUT /manager/advertisers/:id ────────────────────────────────────────────
// Updates an existing advertiser account (must belong to this manager).

router.put('/advertisers/:id', async (req, res) => {
  try {
    const { managerId } = await resolveManagerContext(req.session.clientId);
    const { id } = req.params;

    // Verify ownership first
    const existing = await query(
      `SELECT advertiser_id FROM CALBRIDGE_PROD.APP.advertiser_accounts
       WHERE advertiser_id = ? AND manager_id = ?`,
      [id, managerId]
    );

    if (!existing.length) {
      return res.status(404).json({ error: 'Advertiser account not found' });
    }

    const {
      name,
      marketplace,
      ads_profile_id,
      sp_seller_id,
      sp_vendor_id,
      dsp_advertiser_id,
      is_active,
    } = req.body;

    // Build dynamic SET clause from provided fields only
    const updates = [];
    const binds   = [];

    if (name          !== undefined) { updates.push('name = ?');             binds.push(name.trim()); }
    if (marketplace   !== undefined) { updates.push('marketplace = ?');      binds.push(marketplace); }
    if (ads_profile_id !== undefined) { updates.push('ads_profile_id = ?'); binds.push(ads_profile_id); }
    if (sp_seller_id  !== undefined) { updates.push('sp_seller_id = ?');     binds.push(sp_seller_id); }
    if (sp_vendor_id  !== undefined) { updates.push('sp_vendor_id = ?');     binds.push(sp_vendor_id); }
    if (dsp_advertiser_id !== undefined) { updates.push('dsp_advertiser_id = ?'); binds.push(dsp_advertiser_id); }
    if (is_active     !== undefined) { updates.push('is_active = ?');        binds.push(is_active ? true : false); }

    if (!updates.length) {
      return res.status(400).json({ error: 'No updatable fields provided' });
    }

    binds.push(id, managerId);

    await query(
      `UPDATE CALBRIDGE_PROD.APP.advertiser_accounts
       SET ${updates.join(', ')}
       WHERE advertiser_id = ? AND manager_id = ?`,
      binds
    );

    return res.json({ success: true, advertiserId: id });
  } catch (err) {
    console.error('[PUT /manager/advertisers/:id]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /manager/users ───────────────────────────────────────────────────────
// Lists all users with access to any advertiser under this manager.
// Falls back to reading from clients.team_members if the new tables are empty.

router.get('/users', async (req, res) => {
  try {
    const clientId   = req.session.clientId;
    const { managerId } = await resolveManagerContext(clientId);

    // Try new tables first
    let rows = [];
    try {
      rows = await query(
        `SELECT u.user_id, u.email, u.name, u.created_at,
                a.advertiser_id, a.name AS advertiser_name, uaa.role
         FROM CALBRIDGE_PROD.APP.users u
         JOIN CALBRIDGE_PROD.APP.user_advertiser_access uaa
           ON u.user_id = uaa.user_id
         JOIN CALBRIDGE_PROD.APP.advertiser_accounts a
           ON uaa.advertiser_id = a.advertiser_id
         WHERE a.manager_id = ?
         ORDER BY u.email, a.name`,
        [managerId]
      );
    } catch (queryErr) {
      console.warn('[GET /manager/users] New tables query failed, using fallback:', queryErr.message);
    }

    // If new tables are empty, fall back to clients.team_members JSON
    if (!rows.length) {
      const fallbackRows = await query(
        'SELECT team_members FROM CALBRIDGE_PROD.APP.clients WHERE client_id = ?',
        [clientId]
      );
      const teamMembers = fallbackRows[0]?.TEAM_MEMBERS
        ? (typeof fallbackRows[0].TEAM_MEMBERS === 'string'
            ? JSON.parse(fallbackRows[0].TEAM_MEMBERS)
            : fallbackRows[0].TEAM_MEMBERS)
        : [];
      // Shape to match new-table response format
      rows = teamMembers.map(m => ({
        USER_ID:        m.id,
        EMAIL:          m.email,
        NAME:           m.name,
        ROLE:           m.role,
        CREATED_AT:     m.invitedAt,
        ADVERTISER_ID:  clientId,
        ADVERTISER_NAME: null,
        source: 'legacy_team_members',
      }));
    }

    return res.json(rows);
  } catch (err) {
    console.error('[GET /manager/users]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /manager/users/invite ───────────────────────────────────────────────
// Invite a user: create user row (if not exists) + user_advertiser_access row.
// Also dual-writes to the legacy clients.team_members JSON for backward compat.

router.post('/users/invite', async (req, res) => {
  try {
    const clientId   = req.session.clientId;
    const { managerId } = await resolveManagerContext(clientId);
    const { email, advertiser_id, role = 'viewer', name } = req.body;

    if (!email || !email.trim()) {
      return res.status(400).json({ error: 'email is required' });
    }
    if (!advertiser_id) {
      return res.status(400).json({ error: 'advertiser_id is required' });
    }

    const validRoles = ['viewer', 'analyst', 'manager', 'owner'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: `role must be one of: ${validRoles.join(', ')}` });
    }

    const normalEmail = email.trim().toLowerCase();

    // Verify the advertiser belongs to this manager
    const advertiserCheck = await query(
      `SELECT advertiser_id FROM CALBRIDGE_PROD.APP.advertiser_accounts
       WHERE advertiser_id = ? AND manager_id = ?`,
      [advertiser_id, managerId]
    );

    if (!advertiserCheck.length) {
      return res.status(404).json({ error: 'Advertiser account not found' });
    }

    // ── New table: find or create the user ──────────────────────────────────
    const existingUser = await query(
      'SELECT user_id FROM CALBRIDGE_PROD.APP.users WHERE email = ?',
      [normalEmail]
    );

    let userId;
    if (existingUser.length) {
      userId = existingUser[0].USER_ID;
    } else {
      userId = crypto.randomUUID();
      await query(
        `INSERT INTO CALBRIDGE_PROD.APP.users
           (user_id, client_id, email, name, role, is_active, invited_at, created_at)
         VALUES (?, ?, ?, ?, ?, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [userId, userId, normalEmail, (name || '').trim() || null, role]
      );
    }

    // Upsert the access row (MERGE so re-inviting updates role)
    await query(
      `MERGE INTO CALBRIDGE_PROD.APP.user_advertiser_access t
       USING (SELECT ? AS user_id, ? AS advertiser_id, ? AS role) s
         ON t.user_id = s.user_id AND t.advertiser_id = s.advertiser_id
       WHEN MATCHED THEN UPDATE SET role = s.role
       WHEN NOT MATCHED THEN INSERT (user_id, advertiser_id, role)
         VALUES (s.user_id, s.advertiser_id, s.role)`,
      [userId, advertiser_id, role]
    );

    // ── Legacy dual-write: also update clients.team_members JSON ────────────
    // Map new 4-tier role back to legacy 2-tier role for backward compat
    const legacyRole = (role === 'owner' || role === 'manager') ? 'admin' : 'viewer';
    try {
      const parentRows = await query(
        'SELECT team_members FROM CALBRIDGE_PROD.APP.clients WHERE client_id = ?',
        [clientId]
      );
      const members = parentRows[0]?.TEAM_MEMBERS
        ? (typeof parentRows[0].TEAM_MEMBERS === 'string'
            ? JSON.parse(parentRows[0].TEAM_MEMBERS)
            : parentRows[0].TEAM_MEMBERS)
        : [];

      const existing = members.find(m => m.email === normalEmail);
      if (existing) {
        existing.role = legacyRole;
      } else {
        members.push({
          id:        userId,
          email:     normalEmail,
          name:      (name || '').trim() || normalEmail,
          role:      legacyRole,
          invitedAt: new Date().toISOString(),
          status:    'pending',
        });
      }
      await query(
        'UPDATE CALBRIDGE_PROD.APP.clients SET team_members = ? WHERE client_id = ?',
        [JSON.stringify(members), clientId]
      );
    } catch (legacyErr) {
      // Non-fatal — new tables are the source of truth going forward
      console.warn('[POST /manager/users/invite] Legacy dual-write failed:', legacyErr.message);
    }

    return res.status(201).json({ userId, email: normalEmail, advertiser_id, role });
  } catch (err) {
    console.error('[POST /manager/users/invite]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PUT /manager/users/:userId/role ─────────────────────────────────────────
// Update a user's role for a specific advertiser (advertiser_id in body).

router.put('/users/:userId/role', async (req, res) => {
  try {
    const { managerId } = await resolveManagerContext(req.session.clientId);
    const { userId } = req.params;
    const { advertiser_id, role } = req.body;

    if (!advertiser_id) {
      return res.status(400).json({ error: 'advertiser_id is required' });
    }

    const validRoles = ['viewer', 'analyst', 'manager', 'owner'];
    if (!role || !validRoles.includes(role)) {
      return res.status(400).json({ error: `role must be one of: ${validRoles.join(', ')}` });
    }

    // Verify advertiser belongs to this manager
    const advertiserCheck = await query(
      `SELECT advertiser_id FROM CALBRIDGE_PROD.APP.advertiser_accounts
       WHERE advertiser_id = ? AND manager_id = ?`,
      [advertiser_id, managerId]
    );

    if (!advertiserCheck.length) {
      return res.status(404).json({ error: 'Advertiser account not found' });
    }

    // Verify access row exists
    const accessRow = await query(
      `SELECT user_id FROM CALBRIDGE_PROD.APP.user_advertiser_access
       WHERE user_id = ? AND advertiser_id = ?`,
      [userId, advertiser_id]
    );

    if (!accessRow.length) {
      return res.status(404).json({ error: 'User access record not found' });
    }

    await query(
      `UPDATE CALBRIDGE_PROD.APP.user_advertiser_access
       SET role = ?
       WHERE user_id = ? AND advertiser_id = ?`,
      [role, userId, advertiser_id]
    );

    return res.json({ success: true, userId, advertiser_id, role });
  } catch (err) {
    console.error('[PUT /manager/users/:userId/role]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── DELETE /manager/users/:userId ───────────────────────────────────────────
// Remove a user's access to all advertiser accounts under this manager.
// Pass advertiser_id in query string to remove access to a specific advertiser only.

router.delete('/users/:userId', async (req, res) => {
  try {
    const { managerId } = await resolveManagerContext(req.session.clientId);
    const { userId } = req.params;
    const { advertiser_id } = req.query; // optional: scope to one advertiser

    if (advertiser_id) {
      // Remove access to a specific advertiser
      const advertiserCheck = await query(
        `SELECT advertiser_id FROM CALBRIDGE_PROD.APP.advertiser_accounts
         WHERE advertiser_id = ? AND manager_id = ?`,
        [advertiser_id, managerId]
      );

      if (!advertiserCheck.length) {
        return res.status(404).json({ error: 'Advertiser account not found' });
      }

      await query(
        `DELETE FROM CALBRIDGE_PROD.APP.user_advertiser_access
         WHERE user_id = ? AND advertiser_id = ?`,
        [userId, advertiser_id]
      );

      return res.json({ success: true, userId, advertiser_id, removed: 'single' });
    } else {
      // Remove access to ALL advertisers under this manager
      await query(
        `DELETE FROM CALBRIDGE_PROD.APP.user_advertiser_access
         WHERE user_id = ?
           AND advertiser_id IN (
             SELECT advertiser_id FROM CALBRIDGE_PROD.APP.advertiser_accounts
             WHERE manager_id = ?
           )`,
        [userId, managerId]
      );

      return res.json({ success: true, userId, removed: 'all' });
    }
  } catch (err) {
    console.error('[DELETE /manager/users/:userId]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
