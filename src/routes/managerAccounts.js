/**
 * Manager Account Routes — Phase 3B + 3E
 *
 * Provides API endpoints for the manager/advertiser/user account model,
 * plus agency-level routes added in Phase 3E.
 *
 * Routes mounted at:
 *   /manager  — manager-scoped endpoints (see src/app.js)
 *   /agency   — agency-scoped endpoints (see src/app.js)
 *
 * Session model (current): req.session.clientId
 * Session model (target):  req.session.userId / agencyId / managerId / advertiserId / role
 *
 * For backward compatibility, clientId is resolved to agencyId/managerId/advertiserId
 * via client_migration_map. If no mapping exists, clientId is used as both manager and advertiser.
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

// ─── Helper: Resolve agency context from session clientId ─────────────────────

/**
 * Looks up agency_id, manager_id, and advertiser_id from client_migration_map.
 * Falls back to null agencyId if no mapping found.
 *
 * @param {string} clientId - from req.session.clientId
 * @returns {{ agencyId: string|null, managerId: string, advertiserId: string }}
 */
async function resolveAgencyContext(clientId) {
  const map = await query(
    'SELECT agency_id, manager_id, advertiser_id FROM CALBRIDGE_PROD.APP.client_migration_map WHERE client_id = ?',
    [clientId]
  );
  if (map.length) {
    return {
      agencyId:     map[0].AGENCY_ID    || null,
      managerId:    map[0].MANAGER_ID,
      advertiserId: map[0].ADVERTISER_ID,
    };
  }
  // Backward compat: no agency mapping — clientId acts as manager and advertiser
  return { agencyId: null, managerId: clientId, advertiserId: clientId };
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

// ─── GET /manager/advertisers/list ──────────────────────────────────────────
// Agency-aware advertiser list for the nav selector.
//
// - agency admin (agencyId set in client_migration_map): returns ALL advertiser_accounts
//   across ALL manager_accounts linked to that agency_id, grouped by manager.
// - manager user (managerId only): returns advertiser_accounts for that manager only.
// - fallback: if new tables have no data, returns the current client as a single entry.
//
// Response shape:
//   [{ advertiserId, advertiserName, managerName, managerId, marketplace, isActive, isCurrent }]

router.get('/advertisers/list', async (req, res) => {
  try {
    const clientId = req.session.clientId;

    // If client explicitly switched advertiser, store it in session for isCurrent logic
    const requestedAdvertiserId = req.query.advertiserId || null;
    if (requestedAdvertiserId) {
      req.session.activeAdvertiserId = requestedAdvertiserId;
      // Handle marketplace-based advertiser IDs: clientId__CA → set activeMarketplace
      if (requestedAdvertiserId.includes('__')) {
        const mp = requestedAdvertiserId.split('__')[1];
        if (mp) req.session.activeMarketplace = mp;
      }
      // Explicitly save the session so the updated advertiserId is persisted before
      // the client reloads the page. Without this, the reload can race ahead of the
      // async session write (resave:false doesn't guarantee a flush on mutation).
      await new Promise((resolve) => req.session.save((err) => {
        if (err) console.warn('[advertisers/list] session save error:', err.message);
        resolve();
      }));
    }

    // Resolve agency/manager context from migration map
    let agencyId     = null;
    let managerId    = null;
    let advertiserId = null;

    // activeAdvertiserId: use explicit session switch > migration map default
    const activeAdvertiserId = req.session.activeAdvertiserId || null;

    try {
      const mapRows = await query(
        `SELECT manager_id, advertiser_id, agency_id
         FROM CALBRIDGE_PROD.APP.client_migration_map
         WHERE client_id = ?`,
        [clientId]
      );
      if (mapRows.length) {
        agencyId     = mapRows[0].AGENCY_ID    || null;
        managerId    = mapRows[0].MANAGER_ID   || null;
        advertiserId = mapRows[0].ADVERTISER_ID || null;
      }
    } catch (mapErr) {
      console.warn('[GET /manager/advertisers/list] Migration map query failed:', mapErr.message);
    }

    // ── Agency-level user: return all advertisers under all managers in agency ──
    if (agencyId) {
      let rows = [];
      try {
        rows = await query(
          `SELECT aa.advertiser_id, aa.name AS advertiser_name, aa.marketplace,
                  aa.is_active, aa.logo_url, ma.manager_id, ma.name AS manager_name
           FROM CALBRIDGE_PROD.APP.advertiser_accounts aa
           JOIN CALBRIDGE_PROD.APP.manager_accounts ma
             ON aa.manager_id = ma.manager_id
           WHERE ma.agency_id = ?
           ORDER BY ma.name, aa.name`,
          [agencyId]
        );
      } catch (queryErr) {
        console.warn('[GET /manager/advertisers/list] Agency query failed:', queryErr.message);
      }

      if (rows.length) {
        const effectiveId = activeAdvertiserId || advertiserId;
        const result = rows.map(r => ({
          advertiserId:   r.ADVERTISER_ID,
          advertiserName: r.ADVERTISER_NAME,
          managerName:    r.MANAGER_NAME,
          managerId:      r.MANAGER_ID,
          marketplace:    r.MARKETPLACE || 'US',
          isActive:       r.IS_ACTIVE !== false,
          isCurrent:      r.ADVERTISER_ID === effectiveId,
          logoUrl:        r.LOGO_URL || null,
        }));
        // Only force isCurrent when there's an explicit active advertiser in session;
        // for agency home (no activeAdvertiserId) leave all as isCurrent=false so the
        // frontend can default to "All Brands" view.
        if (effectiveId && !result.some(a => a.isCurrent) && result.length > 0) {
          result[0].isCurrent = true;
        }
        return res.json(result);
      }
      // Fall through to fallback if no rows
    }

    // ── Manager-level user: return all advertisers for this manager only ────────
    if (managerId) {
      let rows = [];
      try {
        rows = await query(
          `SELECT aa.advertiser_id, aa.name AS advertiser_name, aa.marketplace,
                  aa.is_active, aa.logo_url, ma.manager_id, ma.name AS manager_name
           FROM CALBRIDGE_PROD.APP.advertiser_accounts aa
           JOIN CALBRIDGE_PROD.APP.manager_accounts ma
             ON aa.manager_id = ma.manager_id
           WHERE aa.manager_id = ?
           ORDER BY aa.name`,
          [managerId]
        );
      } catch (queryErr) {
        console.warn('[GET /manager/advertisers/list] Manager query failed:', queryErr.message);
      }

      if (rows.length) {
        const effectiveId = activeAdvertiserId || advertiserId;
        const result = rows.map(r => ({
          advertiserId:   r.ADVERTISER_ID,
          advertiserName: r.ADVERTISER_NAME,
          managerName:    r.MANAGER_NAME,
          managerId:      r.MANAGER_ID,
          marketplace:    r.MARKETPLACE || 'US',
          isActive:       r.IS_ACTIVE !== false,
          isCurrent:      r.ADVERTISER_ID === effectiveId,
          logoUrl:        r.LOGO_URL || null,
        }));
        if (!result.some(a => a.isCurrent) && result.length > 0) {
          result[0].isCurrent = true;
        }
        return res.json(result);
      }
    }

    // ── Fallback: return one entry per marketplace from client_accounts ──────────
    // This allows clients like CyberPower to appear as "CyberPower US" and "CyberPower CA"
    // as separate selectable accounts in the dropdown.
    const fallback = await query(
      'SELECT client_id, name, marketplace FROM CALBRIDGE_PROD.APP.clients WHERE client_id = ?',
      [clientId]
    );
    if (fallback.length) {
      const clientName = fallback[0].NAME;
      // Get distinct marketplaces from client_accounts
      let marketplaces = [];
      try {
        const mpRows = await query(
          `SELECT DISTINCT marketplace FROM CALBRIDGE_PROD.APP.client_accounts
           WHERE client_id = ? AND is_active = TRUE AND marketplace IS NOT NULL
           ORDER BY marketplace`,
          [clientId]
        );
        marketplaces = mpRows.map(r => r.MARKETPLACE || r.marketplace).filter(Boolean);
      } catch (e) { /* non-fatal */ }
      if (!marketplaces.length) marketplaces = ['US'];

      const activeMarketplace = req.session.activeMarketplace || marketplaces[0] || 'US';

      const result = marketplaces.map(mp => ({
        advertiserId:   `${clientId}__${mp}`,
        advertiserName: `${clientName} ${mp}`,
        managerName:    clientName,
        managerId:      clientId,
        marketplace:    mp,
        isActive:       true,
        isCurrent:      mp === activeMarketplace,
      }));
      if (!result.some(a => a.isCurrent)) result[0].isCurrent = true;
      return res.json(result);
    }

    // Nothing found at all
    return res.json([]);
  } catch (err) {
    console.error('[GET /manager/advertisers/list]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /manager/active-advertiser ─────────────────────────────────────────
// Returns the currently active advertiser for this session, including logo_url.
// Used by the nav sidebar to set the brand logo on page load.
//
// Response: { advertiserId, advertiserName, managerName, logoUrl, marketplace }

router.get('/active-advertiser', async (req, res) => {
  try {
    const clientId = req.session.clientId;

    // Resolve context
    let agencyId     = null;
    let managerId    = null;
    let advertiserId = null;

    try {
      const mapRows = await query(
        `SELECT manager_id, advertiser_id, agency_id
         FROM CALBRIDGE_PROD.APP.client_migration_map
         WHERE client_id = ?`,
        [clientId]
      );
      if (mapRows.length) {
        agencyId     = mapRows[0].AGENCY_ID    || null;
        managerId    = mapRows[0].MANAGER_ID   || null;
        advertiserId = mapRows[0].ADVERTISER_ID || null;
      }
    } catch (mapErr) {
      console.warn('[GET /manager/active-advertiser] Migration map query failed:', mapErr.message);
    }

    // Effective advertiser: session switch overrides default
    const effectiveAdvertiserId = req.session.activeAdvertiserId || advertiserId;

    if (effectiveAdvertiserId) {
      // Build query scope
      let rows = [];
      if (agencyId) {
        // Agency admin — can access any advertiser under the agency
        rows = await query(
          `SELECT aa.advertiser_id, aa.name AS advertiser_name, aa.marketplace,
                  aa.logo_url, ma.manager_id, ma.name AS manager_name
           FROM CALBRIDGE_PROD.APP.advertiser_accounts aa
           JOIN CALBRIDGE_PROD.APP.manager_accounts ma
             ON aa.manager_id = ma.manager_id
           WHERE aa.advertiser_id = ? AND ma.agency_id = ?`,
          [effectiveAdvertiserId, agencyId]
        );
      } else if (managerId) {
        rows = await query(
          `SELECT aa.advertiser_id, aa.name AS advertiser_name, aa.marketplace,
                  aa.logo_url, ma.manager_id, ma.name AS manager_name
           FROM CALBRIDGE_PROD.APP.advertiser_accounts aa
           JOIN CALBRIDGE_PROD.APP.manager_accounts ma
             ON aa.manager_id = ma.manager_id
           WHERE aa.advertiser_id = ? AND aa.manager_id = ?`,
          [effectiveAdvertiserId, managerId]
        );
      }

      if (rows.length) {
        const r = rows[0];
        return res.json({
          advertiserId:   r.ADVERTISER_ID,
          advertiserName: r.ADVERTISER_NAME,
          managerName:    r.MANAGER_NAME,
          managerId:      r.MANAGER_ID,
          marketplace:    r.MARKETPLACE || 'US',
          logoUrl:        r.LOGO_URL || null,
        });
      }
    }

    // Fallback: return client name + active marketplace (same logic as advertisers/list fallback)
    const fallback = await query(
      'SELECT client_id, name FROM CALBRIDGE_PROD.APP.clients WHERE client_id = ?',
      [clientId]
    ).catch(() => []);
    if (fallback.length) {
      const activeMarketplace = req.session.activeMarketplace || 'US';
      const clientName = fallback[0].NAME;
      return res.json({
        advertiserId:   `${clientId}__${activeMarketplace}`,
        advertiserName: `${clientName} ${activeMarketplace}`,
        managerName:    clientName,
        managerId:      clientId,
        marketplace:    activeMarketplace,
        logoUrl:        null,
      });
    }

    return res.json({
      advertiserId:   null,
      advertiserName: null,
      managerName:    null,
      managerId:      null,
      marketplace:    'US',
      logoUrl:        null,
    });
  } catch (err) {
    console.error('[GET /manager/active-advertiser]', err);
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

// ============================================================================
// AGENCY ROUTES — Phase 3E
// Mounted at /agency in src/app.js
// ============================================================================

// Export a separate agency router so app.js can mount it at /agency
const agencyRouter = express.Router();
agencyRouter.use(requireAuth);

// ─── GET /agency/me ──────────────────────────────────────────────────
// Returns the current agency + all its manager accounts.

agencyRouter.get('/me', async (req, res) => {
  try {
    const { agencyId } = await resolveAgencyContext(req.session.clientId);

    if (!agencyId) {
      return res.status(404).json({ error: 'No agency associated with this account' });
    }

    const agencyRows = await query(
      `SELECT agency_id, name, stripe_customer_id, stripe_subscription_id,
              subscription_plan, subscription_status, created_at
       FROM CALBRIDGE_PROD.APP.agency_accounts
       WHERE agency_id = ?`,
      [agencyId]
    );

    if (!agencyRows.length) {
      return res.status(404).json({ error: 'Agency account not found' });
    }

    const managerRows = await query(
      `SELECT manager_id, name, subscription_plan, subscription_status, created_at
       FROM CALBRIDGE_PROD.APP.manager_accounts
       WHERE agency_id = ?
       ORDER BY name`,
      [agencyId]
    );

    return res.json({
      agency:   agencyRows[0],
      managers: managerRows,
    });
  } catch (err) {
    console.error('[GET /agency/me]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /agency/managers ───────────────────────────────────────────
// Lists all manager accounts under the current agency.

agencyRouter.get('/managers', async (req, res) => {
  try {
    const { agencyId } = await resolveAgencyContext(req.session.clientId);

    if (!agencyId) {
      return res.status(404).json({ error: 'No agency associated with this account' });
    }

    const rows = await query(
      `SELECT manager_id, name, stripe_customer_id, stripe_subscription_id,
              subscription_plan, subscription_status, agency_id, created_at
       FROM CALBRIDGE_PROD.APP.manager_accounts
       WHERE agency_id = ?
       ORDER BY name`,
      [agencyId]
    );

    return res.json(rows);
  } catch (err) {
    console.error('[GET /agency/managers]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /agency/managers ───────────────────────────────────────────
// Creates a new manager account under the current agency.
// Agency admin only.

agencyRouter.post('/managers', async (req, res) => {
  try {
    const { agencyId } = await resolveAgencyContext(req.session.clientId);

    if (!agencyId) {
      return res.status(403).json({ error: 'No agency associated with this account' });
    }

    // Verify caller is agency_admin (session role check)
    // Note: Full RBAC will be wired in Phase 3F; for now trust session.role if set
    const sessionRole = req.session.role;
    if (sessionRole && sessionRole !== 'agency_admin') {
      return res.status(403).json({ error: 'agency_admin role required' });
    }

    const { name, subscription_plan, subscription_status } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'name is required' });
    }

    const managerId = crypto.randomUUID();

    await query(
      `INSERT INTO CALBRIDGE_PROD.APP.manager_accounts
         (manager_id, name, agency_id, subscription_plan, subscription_status,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())`,
      [
        managerId,
        name.trim(),
        agencyId,
        subscription_plan  || null,
        subscription_status || null,
      ]
    );

    return res.status(201).json({ managerId, name: name.trim(), agencyId });
  } catch (err) {
    console.error('[POST /agency/managers]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /agency/users ───────────────────────────────────────────────
// Lists all agency-level users (those with agency_id set).

agencyRouter.get('/users', async (req, res) => {
  try {
    const { agencyId } = await resolveAgencyContext(req.session.clientId);

    if (!agencyId) {
      return res.status(404).json({ error: 'No agency associated with this account' });
    }

    const rows = await query(
      `SELECT user_id, email, name, role, agency_id, is_active, created_at
       FROM CALBRIDGE_PROD.APP.users
       WHERE agency_id = ?
       ORDER BY email`,
      [agencyId]
    );

    return res.json(rows);
  } catch (err) {
    console.error('[GET /agency/users]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /agency/users/invite ────────────────────────────────────────
// Invite an agency-level user (creates or updates user row with agency_id).

agencyRouter.post('/users/invite', async (req, res) => {
  try {
    const { agencyId } = await resolveAgencyContext(req.session.clientId);

    if (!agencyId) {
      return res.status(403).json({ error: 'No agency associated with this account' });
    }

    const { email, name, role = 'agency_staff' } = req.body;

    if (!email || !email.trim()) {
      return res.status(400).json({ error: 'email is required' });
    }

    const validRoles = ['agency_admin', 'agency_staff'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: `role must be one of: ${validRoles.join(', ')}` });
    }

    const normalEmail = email.trim().toLowerCase();

    // Find or create the user
    const existingUser = await query(
      'SELECT user_id FROM CALBRIDGE_PROD.APP.users WHERE email = ?',
      [normalEmail]
    );

    let userId;
    if (existingUser.length) {
      userId = existingUser[0].USER_ID;
      // Update role and agency_id on existing row
      await query(
        `UPDATE CALBRIDGE_PROD.APP.users
         SET role = ?, agency_id = ?
         WHERE user_id = ?`,
        [role, agencyId, userId]
      );
    } else {
      userId = crypto.randomUUID();
      await query(
        `INSERT INTO CALBRIDGE_PROD.APP.users
           (user_id, client_id, email, name, role, agency_id, is_active, invited_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, TRUE, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())`,
        [userId, userId, normalEmail, (name || '').trim() || null, role, agencyId]
      );
    }

    return res.status(201).json({ userId, email: normalEmail, agencyId, role });
  } catch (err) {
    console.error('[POST /agency/users/invite]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /manager/active-advertiser/marketplaces ─────────────────────────────
// Returns the list of distinct marketplaces for the currently active advertiser,
// and the currently selected marketplace (from session).
// Frontend uses this to show/hide the geo selector dropdown.

router.get('/active-advertiser/marketplaces', requireAuth, async (req, res) => {
  try {
    const clientId = req.session.clientId;
    if (!clientId) return res.status(401).json({ error: 'Not authenticated' });

    let marketplaces = [];
    try {
      const rows = await query(
        `SELECT DISTINCT marketplace
         FROM CALBRIDGE_PROD.APP.client_accounts
         WHERE client_id = ?
           AND is_active = TRUE
           AND marketplace IS NOT NULL
         ORDER BY marketplace`,
        [clientId]
      );
      marketplaces = rows.map(r => r.MARKETPLACE || r.marketplace).filter(Boolean);
    } catch (e) {
      // client_accounts may not have data yet — graceful fallback
      console.warn('[GET /manager/active-advertiser/marketplaces] Query failed:', e.message);
    }

    // Default to ['US'] if no marketplace data found
    if (!marketplaces.length) marketplaces = ['US'];

    const activeMarketplace = req.session.activeMarketplace || marketplaces[0] || 'US';

    return res.json({ marketplaces, activeMarketplace });
  } catch (err) {
    console.error('[GET /manager/active-advertiser/marketplaces]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /manager/set-marketplace ────────────────────────────────────────────
// Sets the active marketplace in session. Validates that the requested marketplace
// is actually in the list for this client (prevents spoofing).
// Body: { marketplace: 'CA' }  — use 'all' to remove the filter.

router.post('/set-marketplace', requireAuth, async (req, res) => {
  try {
    const clientId = req.session.clientId;
    if (!clientId) return res.status(401).json({ error: 'Not authenticated' });

    const { marketplace } = req.body;
    if (!marketplace) return res.status(400).json({ error: 'marketplace is required' });

    // 'all' is always valid — removes the filter
    if (marketplace !== 'all') {
      // Validate against actual client marketplaces
      let allowed = [];
      try {
        const rows = await query(
          `SELECT DISTINCT marketplace
           FROM CALBRIDGE_PROD.APP.client_accounts
           WHERE client_id = ?
             AND is_active = TRUE
             AND marketplace IS NOT NULL`,
          [clientId]
        );
        allowed = rows.map(r => r.MARKETPLACE || r.marketplace).filter(Boolean);
      } catch (e) {
        console.warn('[POST /manager/set-marketplace] Validation query failed:', e.message);
        // On error, allow the request through — don't block the user
      }

      if (allowed.length && !allowed.includes(marketplace)) {
        return res.status(400).json({ error: `Invalid marketplace: ${marketplace}` });
      }
    }

    req.session.activeMarketplace = marketplace;
    return res.json({ ok: true, activeMarketplace: marketplace });
  } catch (err) {
    console.error('[POST /manager/set-marketplace]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /agency/brands ─────────────────────────────────────────────────────
// Create a new brand (manager_account + advertiser_account) under this agency.
agencyRouter.post('/brands', async (req, res) => {
  try {
    const { agencyId } = await resolveAgencyContext(req.session.clientId);
    if (!agencyId) return res.status(403).json({ error: 'Agency account required' });

    const { brandName, contactEmail, marketplace = 'US' } = req.body;
    if (!brandName) return res.status(400).json({ error: 'brandName is required' });

    // Inherit agency plan so brand gets same feature access
    const agencyPlanRows = await query(
      'SELECT subscription_plan, subscription_status FROM CALBRIDGE_PROD.APP.agency_accounts WHERE agency_id = ?',
      [agencyId]
    ).catch(() => []);
    // Fall back to manager_accounts plan if agency_accounts doesn't have it
    const agencyMgrRows = agencyPlanRows.length ? [] : await query(
      'SELECT subscription_plan, subscription_status FROM CALBRIDGE_PROD.APP.manager_accounts WHERE agency_id = ? AND subscription_plan IS NOT NULL ORDER BY created_at LIMIT 1',
      [agencyId]
    ).catch(() => []);
    const inheritedPlan   = agencyPlanRows[0]?.SUBSCRIPTION_PLAN   || agencyMgrRows[0]?.SUBSCRIPTION_PLAN   || 'agency';
    const inheritedStatus = agencyPlanRows[0]?.SUBSCRIPTION_STATUS || agencyMgrRows[0]?.SUBSCRIPTION_STATUS || 'active';

    const { v4: uuidv4 } = require('uuid');
    const managerId    = uuidv4();
    const advertiserId = uuidv4();
    const clientId     = uuidv4();
    const userId       = uuidv4();
    const hash         = require('crypto').randomBytes(32).toString('hex');

    // 1. Create manager_account under agency — inherit agency plan
    await query(
      `INSERT INTO CALBRIDGE_PROD.APP.manager_accounts
        (manager_id, name, agency_id, subscription_plan, subscription_status, created_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP())`,
      [managerId, brandName, agencyId, inheritedPlan, inheritedStatus]
    );

    // 2. Create advertiser_account
    await query(
      `INSERT INTO CALBRIDGE_PROD.APP.advertiser_accounts
        (advertiser_id, manager_id, name, marketplace, is_active, created_at)
       VALUES (?, ?, ?, ?, TRUE, CURRENT_TIMESTAMP())`,
      [advertiserId, managerId, `${brandName} - ${marketplace}`, marketplace]
    );

    // 3. Create clients row (brand login account) — inherit agency plan
    const email = contactEmail || `brand-${managerId.substring(0,8)}@calbridge.internal`;
    await query(
      `INSERT INTO CALBRIDGE_PROD.APP.clients
        (client_id, email, name, client_name, client_type, password_hash, status,
         subscription_plan, subscription_status, account_type, created_at)
       VALUES (?, ?, ?, ?, 'brand', ?, 'active', ?, ?, 'brand', CURRENT_TIMESTAMP())`,
      [clientId, email, brandName, brandName, hash, inheritedPlan, inheritedStatus]
    );

    // 4. Create migration map
    await query(
      `INSERT INTO CALBRIDGE_PROD.APP.client_migration_map
        (client_id, manager_id, advertiser_id, agency_id)
       VALUES (?, ?, ?, ?)`,
      [clientId, managerId, advertiserId, agencyId]
    );

    // 5. Create user row
    await query(
      `INSERT INTO CALBRIDGE_PROD.APP.users
        (user_id, client_id, email, name, role, is_active, created_at)
       VALUES (?, ?, ?, ?, 'manager_owner', TRUE, CURRENT_TIMESTAMP())`,
      [userId, clientId, email, brandName]
    );

    // 6. Send invite email if contactEmail provided
    if (contactEmail && process.env.RESEND_API_KEY) {
      try {
        const { Resend } = require('resend');
        const resend = new Resend(process.env.RESEND_API_KEY);
        const baseUrl = process.env.BASE_URL || 'https://app.calbridge.ai';
        await resend.emails.send({
          from: `Ash at Calbridge <${process.env.EMAIL_FROM || 'ash@teamcalbridge.com'}>`,
          to: contactEmail,
          subject: `You've been added to Calbridge - ${brandName}`,
          html: `<p>Hi,</p><p>Your brand <strong>${brandName}</strong> has been set up on Calbridge.</p><p>Your agency will connect your Amazon accounts and you'll receive access once data is flowing.</p><p><a href="${baseUrl}">View your dashboard</a></p><p>- The Calbridge Team</p>`,
        });
      } catch (emailErr) {
        console.warn('[POST /agency/brands] invite email failed:', emailErr.message);
      }
    }

    res.status(201).json({
      ok: true,
      brand: { managerId, advertiserId, clientId, brandName, marketplace, contactEmail: contactEmail || null }
    });
  } catch (err) {
    console.error('[POST /agency/brands]', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /agency/brands ──────────────────────────────────────────────────────
// Returns all brands under this agency with connection status.
agencyRouter.get('/brands', async (req, res) => {
  try {
    const { agencyId } = await resolveAgencyContext(req.session.clientId);
    if (!agencyId) return res.status(403).json({ error: 'Agency account required' });

    const managers = await query(
      `SELECT m.manager_id, m.name, m.subscription_plan, m.subscription_status,
              m.created_at, c.client_id, c.email, c.status AS client_status,
              a.advertiser_id, a.marketplace, COALESCE(c.logo_url, a.logo_url) AS logo_url
       FROM CALBRIDGE_PROD.APP.manager_accounts m
       LEFT JOIN CALBRIDGE_PROD.APP.client_migration_map map ON map.manager_id = m.manager_id
       LEFT JOIN CALBRIDGE_PROD.APP.clients c ON c.client_id = map.client_id
       LEFT JOIN CALBRIDGE_PROD.APP.advertiser_accounts a ON a.manager_id = m.manager_id AND a.is_active = TRUE
       WHERE m.agency_id = ?
       ORDER BY m.created_at ASC`,
      [agencyId]
    );

    // Get connection status for each brand
    const { getConnectionStatus } = require('../services/amazonAuthService');
    const brands = await Promise.all(managers.map(async (m) => {
      const cId = m.CLIENT_ID || m.client_id;
      let connections = { ads: { connected: false }, vendor: { connected: false }, seller: { connected: false } };
      if (cId) {
        try { connections = await getConnectionStatus(cId); } catch (e) {}
      }
      return {
        managerId:    m.MANAGER_ID          || m.manager_id,
        advertiserId: m.ADVERTISER_ID       || m.advertiser_id || null,
        brandName:    m.NAME                || m.name,
        plan:         m.SUBSCRIPTION_PLAN   || m.subscription_plan   || 'free',
        status:       m.SUBSCRIPTION_STATUS || m.subscription_status,
        clientId:     cId,
        email:        m.EMAIL               || m.email,
        marketplace:  m.MARKETPLACE         || m.marketplace         || 'US',
        logoUrl:      m.LOGO_URL            || m.logo_url            || null,
        createdAt:    m.CREATED_AT          || m.created_at,
        connections: {
          ads:    connections?.ads?.connected    === true,
          vendor: connections?.vendor?.connected === true,
          seller: connections?.seller?.connected === true,
        },
      };
    }));

    res.json({ brands });
  } catch (err) {
    console.error('[GET /agency/brands]', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /agency/switch-brand ───────────────────────────────────────────────
// Enter a brand's session as the agency admin.
// Sets session.clientId to the brand's clientId, preserving agencyClientId for back-navigation.
agencyRouter.post('/switch-brand', async (req, res) => {
  try {
    const { clientId: brandClientId } = req.body;
    if (!brandClientId) return res.status(400).json({ error: 'clientId required' });

    // Verify this brand belongs to the agency the user is logged into
    const { agencyId } = await resolveAgencyContext(req.session.clientId);
    if (!agencyId) return res.status(403).json({ error: 'Agency account required' });

    // Check the brand is under this agency
    const rows = await query(
      `SELECT c.client_id, c.name, map.manager_id, map.agency_id
       FROM CALBRIDGE_PROD.APP.clients c
       JOIN CALBRIDGE_PROD.APP.client_migration_map map ON map.client_id = c.client_id
       JOIN CALBRIDGE_PROD.APP.manager_accounts m ON m.manager_id = map.manager_id
       WHERE c.client_id = ? AND m.agency_id = ?`,
      [brandClientId, agencyId]
    );

    if (!rows.length) {
      return res.status(403).json({ error: 'Brand not found in this agency' });
    }

    // Save agency client ID so user can return to agency view
    req.session.agencyClientId = req.session.clientId;

    // Switch session to brand — clear all caches so fresh data loads
    req.session.clientId = brandClientId;
    req.session.activeAdvertiserId = null;
    req.session.advertiserId = null;    // clear legacy advertiserId so resolveClientId uses clientId directly
    req.session.activeMarketplace = null;
    req.session.isBrandSession = true;
    req.session.planCache = null;

    // Explicitly save session before responding so the client redirect lands on the new session
    const switchedBrandName = rows[0].NAME || rows[0].name;
    req.session.save((err) => {
      if (err) console.warn('[switch-brand] session save error:', err.message);
      console.log(`[switch-brand] ✅ Session switched to ${switchedBrandName} (${brandClientId.substring(0,8)})`);
      res.json({ ok: true, brandClientId, brandName: switchedBrandName });
    });
  } catch (err) {
    console.error('[POST /agency/switch-brand]', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /agency/exit-brand ──────────────────────────────────────────────────
// Return to agency session from a brand session.
agencyRouter.post('/exit-brand', async (req, res) => {
  try {
    const agencyClientId = req.session.agencyClientId;
    if (!agencyClientId) {
      return res.status(400).json({ error: 'No agency session to return to' });
    }

    // Restore agency session
    req.session.clientId = agencyClientId;
    req.session.agencyClientId = null;
    req.session.activeAdvertiserId = null;
    req.session.advertiserId = null;    // will be re-resolved from migration map on next request
    req.session.isBrandSession = false;
    req.session.planCache = null;

    req.session.save((err) => {
      if (err) console.warn('[exit-brand] session save error:', err.message);
      res.json({ ok: true });
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /agency/kpi-summary ────────────────────────────────────────────────
// Aggregate KPI metrics across all brands for an agency manager.
// Query params: ?days=30 (default 30, max 90)

agencyRouter.get('/kpi-summary', async (req, res) => {
  try {
    const { agencyId } = await resolveAgencyContext(req.session.clientId);
    if (!agencyId) return res.status(403).json({ error: 'Agency account required' });

    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 90);

    // 1. Get all brands (manager + client mapping) under this agency
    const brandRows = await query(
      `SELECT m.manager_id, m.name AS brand_name,
              map.client_id, a.advertiser_id
       FROM CALBRIDGE_PROD.APP.manager_accounts m
       LEFT JOIN CALBRIDGE_PROD.APP.client_migration_map map ON map.manager_id = m.manager_id
       LEFT JOIN CALBRIDGE_PROD.APP.advertiser_accounts a   ON a.manager_id = m.manager_id AND a.is_active = TRUE
       WHERE m.agency_id = ?
       ORDER BY m.name`,
      [agencyId]
    );

    if (!brandRows.length) {
      return res.json({
        summary: { totalSpend: 0, totalSales: 0, blendedRoas: 0, blendedAcos: 0,
                   totalImpressions: 0, totalClicks: 0, activeBrands: 0, activeCampaigns: 0 },
        brands: [],
        days,
      });
    }

    // Collect distinct client_ids for the ad data query
    const clientIds = [...new Set(brandRows.map(r => r.CLIENT_ID || r.client_id).filter(Boolean))];

    // Build brand metadata map keyed by client_id
    const brandByClientId = {};
    for (const r of brandRows) {
      const cId = r.CLIENT_ID || r.client_id;
      if (cId && !brandByClientId[cId]) {
        brandByClientId[cId] = {
          managerId:    r.MANAGER_ID    || r.manager_id,
          advertiserId: r.ADVERTISER_ID || r.advertiser_id || null,
          brandName:    r.BRAND_NAME    || r.brand_name,
          clientId:     cId,
        };
      }
    }

    // 2. Query ad performance for all client_ids in one shot
    let adRows = [];
    if (clientIds.length) {
      const placeholders = clientIds.map(() => '?').join(', ');
      try {
        adRows = await query(
          `SELECT
             client_id,
             SUM(cost)           AS total_spend,
             SUM(sales_30d)      AS total_sales,
             SUM(impressions)    AS total_impressions,
             SUM(clicks)         AS total_clicks,
             COUNT(DISTINCT campaign_id) AS active_campaigns
           FROM CALBRIDGE_PROD.ANALYTICS.ADS_PERFORMANCE
           WHERE client_id IN (${placeholders})
             AND date >= DATEADD('day', ?, CURRENT_DATE)
             AND date <  CURRENT_DATE
           GROUP BY client_id`,
          [...clientIds, -days]
        );
      } catch (queryErr) {
        console.warn('[GET /agency/kpi-summary] Ad performance query failed:', queryErr.message);
      }
    }

    // 3. Build per-brand results, defaulting to zeros for brands with no ad data
    const adByClientId = {};
    for (const r of adRows) {
      const cId = r.CLIENT_ID || r.client_id;
      adByClientId[cId] = {
        spend:      Number(r.TOTAL_SPEND       || r.total_spend       || 0),
        sales:      Number(r.TOTAL_SALES       || r.total_sales       || 0),
        impressions:Number(r.TOTAL_IMPRESSIONS || r.total_impressions || 0),
        clicks:     Number(r.TOTAL_CLICKS      || r.total_clicks      || 0),
        campaigns:  Number(r.ACTIVE_CAMPAIGNS  || r.active_campaigns  || 0),
      };
    }

    const brands = Object.values(brandByClientId).map(b => {
      const ad = adByClientId[b.clientId] || { spend: 0, sales: 0, impressions: 0, clicks: 0, campaigns: 0 };
      const roas = ad.spend > 0 ? ad.sales / ad.spend           : 0;
      const acos = ad.sales > 0 ? (ad.spend / ad.sales) * 100  : 0;
      return {
        advertiserId: b.advertiserId,
        brandName:    b.brandName,
        spend:        ad.spend,
        sales:        ad.sales,
        roas:         Math.round(roas * 100) / 100,
        acos:         Math.round(acos * 10)  / 10,
        impressions:  ad.impressions,
        clicks:       ad.clicks,
        campaigns:    ad.campaigns,
      };
    });

    // 4. Aggregate summary
    const totalSpend       = brands.reduce((s, b) => s + b.spend, 0);
    const totalSales       = brands.reduce((s, b) => s + b.sales, 0);
    const totalImpressions = brands.reduce((s, b) => s + b.impressions, 0);
    const totalClicks      = brands.reduce((s, b) => s + b.clicks, 0);
    const totalCampaigns   = brands.reduce((s, b) => s + b.campaigns, 0);
    const blendedRoas      = totalSpend  > 0 ? Math.round((totalSales / totalSpend) * 100) / 100  : 0;
    const blendedAcos      = totalSales  > 0 ? Math.round((totalSpend / totalSales * 100) * 10) / 10 : 0;

    return res.json({
      summary: {
        totalSpend:       Math.round(totalSpend       * 100) / 100,
        totalSales:       Math.round(totalSales       * 100) / 100,
        blendedRoas,
        blendedAcos,
        totalImpressions,
        totalClicks,
        activeBrands:     brands.length,
        activeCampaigns:  totalCampaigns,
      },
      brands,
      days,
    });
  } catch (err) {
    console.error('[GET /agency/kpi-summary]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── DELETE /agency/brands/:managerId ───────────────────────────────────────
// Detach a brand from the agency (soft remove — data preserved, brand keeps its login).
agencyRouter.delete('/brands/:managerId', async (req, res) => {
  try {
    const { agencyId } = await resolveAgencyContext(req.session.clientId);
    if (!agencyId) return res.status(403).json({ error: 'Agency account required' });

    const { managerId } = req.params;

    // Verify brand belongs to this agency
    const rows = await query(
      'SELECT manager_id, name FROM CALBRIDGE_PROD.APP.manager_accounts WHERE manager_id = ? AND agency_id = ?',
      [managerId, agencyId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Brand not found in this agency' });

    // Detach from agency — keeps all data, brand login still works
    await query(
      'UPDATE CALBRIDGE_PROD.APP.manager_accounts SET agency_id = NULL WHERE manager_id = ?',
      [managerId]
    );

    const brandName = rows[0].NAME || rows[0].name;
    console.log(`[agency] Detached brand ${brandName} (${managerId}) from agency ${agencyId}`);
    res.json({ ok: true, brandName });
  } catch (err) {
    console.error('[DELETE /agency/brands/:managerId]', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// AGENCY REPORTING ROUTES — Phase 3F
// ============================================================================

// ─── Helper: Validate UUID ───────────────────────────────────────────────────
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isValidUUID(id) { return UUID_RE.test(id); }

// ─── Helper: Build CSV string from rows ──────────────────────────────────────
function buildCsv(columns, rows) {
  const escape = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  };
  const lines = [columns.map(escape).join(',')];
  for (const row of rows) {
    lines.push(columns.map(col => escape(row[col])).join(','));
  }
  return lines.join('\n');
}

// ─── Helper: Run advertising report query ────────────────────────────────────
async function runAdvertisingReport({ clientIds, startDate, endDate, reportType, marketplace }) {
  if (!clientIds || clientIds.length === 0) {
    return { rows: [], columns: [] };
  }

  const placeholders = clientIds.map(() => '?').join(', ');
  const marketplaceFilter = (marketplace && marketplace !== 'all')
    ? 'AND r.marketplace = ?'
    : '';

  let sql;
  let binds;
  let columns;

  if (reportType === 'daily') {
    // Use AD_PERFORMANCE_DAILY — no campaign_id/ntb columns
    columns = ['client_id', 'client_name', 'date', 'spend', 'sales', 'orders',
               'impressions', 'clicks', 'acos', 'roas', 'ctr', 'cvr'];

    sql = `
      SELECT
        r.client_id,
        COALESCE(c.company_name, c.name) AS client_name,
        r.date,
        SUM(r.spend)                                                           AS spend,
        SUM(r.sales)                                                           AS sales,
        SUM(r.orders)                                                          AS orders,
        SUM(r.impressions)                                                     AS impressions,
        SUM(r.clicks)                                                          AS clicks,
        CASE WHEN SUM(r.sales) > 0
             THEN SUM(r.spend)/SUM(r.sales)*100 END                           AS acos,
        CASE WHEN SUM(r.spend) > 0
             THEN SUM(r.sales)/SUM(r.spend) END                               AS roas,
        CASE WHEN SUM(r.impressions) > 0
             THEN SUM(r.clicks)::FLOAT/SUM(r.impressions)*100 END             AS ctr,
        CASE WHEN SUM(r.clicks) > 0
             THEN SUM(r.orders)::FLOAT/SUM(r.clicks)*100 END                  AS cvr
      FROM CALBRIDGE_PROD.MARTS.AD_PERFORMANCE_DAILY r
      JOIN CALBRIDGE_PROD.APP.clients c ON c.client_id = r.client_id
      WHERE r.date BETWEEN ? AND ?
        AND r.client_id IN (${placeholders})
        ${marketplaceFilter}
      GROUP BY r.client_id, c.company_name, c.name, r.date
      ORDER BY r.client_id, r.date
    `;

    binds = [startDate, endDate, ...clientIds];
    if (marketplace && marketplace !== 'all') binds.push(marketplace);

  } else if (reportType === 'campaign') {
    columns = ['client_id', 'client_name', 'campaign_id', 'campaign_name', 'ad_type',
               'spend', 'sales', 'orders', 'impressions', 'clicks',
               'ntb_orders', 'ntb_sales', 'acos', 'roas', 'ctr', 'cvr'];

    sql = `
      SELECT
        r.client_id,
        COALESCE(c.company_name, c.name) AS client_name,
        r.campaign_id,
        r.campaign_name,
        r.ad_type,
        SUM(r.spend)                                                           AS spend,
        SUM(r.sales)                                                           AS sales,
        SUM(r.orders)                                                          AS orders,
        SUM(r.impressions)                                                     AS impressions,
        SUM(r.clicks)                                                          AS clicks,
        SUM(r.ntb_purchases)                                                   AS ntb_orders,
        SUM(r.ntb_sales)                                                       AS ntb_sales,
        CASE WHEN SUM(r.sales) > 0
             THEN SUM(r.spend)/SUM(r.sales)*100 END                           AS acos,
        CASE WHEN SUM(r.spend) > 0
             THEN SUM(r.sales)/SUM(r.spend) END                               AS roas,
        CASE WHEN SUM(r.impressions) > 0
             THEN SUM(r.clicks)::FLOAT/SUM(r.impressions)*100 END             AS ctr,
        CASE WHEN SUM(r.clicks) > 0
             THEN SUM(r.orders)::FLOAT/SUM(r.clicks)*100 END                  AS cvr
      FROM CALBRIDGE_PROD.MARTS.CAMPAIGN_PERFORMANCE r
      JOIN CALBRIDGE_PROD.APP.clients c ON c.client_id = r.client_id
      WHERE r.date BETWEEN ? AND ?
        AND r.client_id IN (${placeholders})
        ${marketplaceFilter}
      GROUP BY r.client_id, c.company_name, c.name,
               r.campaign_id, r.campaign_name, r.ad_type
      ORDER BY spend DESC
    `;

    binds = [startDate, endDate, ...clientIds];
    if (marketplace && marketplace !== 'all') binds.push(marketplace);

  } else {
    // summary (default) — one row per client
    columns = ['client_id', 'client_name', 'spend', 'sales', 'orders',
               'impressions', 'clicks', 'ntb_orders', 'ntb_sales',
               'acos', 'roas', 'ctr', 'cvr'];

    sql = `
      SELECT
        r.client_id,
        COALESCE(c.company_name, c.name) AS client_name,
        SUM(r.spend)                                                           AS spend,
        SUM(r.sales)                                                           AS sales,
        SUM(r.orders)                                                          AS orders,
        SUM(r.impressions)                                                     AS impressions,
        SUM(r.clicks)                                                          AS clicks,
        SUM(r.ntb_purchases)                                                   AS ntb_orders,
        SUM(r.ntb_sales)                                                       AS ntb_sales,
        CASE WHEN SUM(r.sales) > 0
             THEN SUM(r.spend)/SUM(r.sales)*100 END                           AS acos,
        CASE WHEN SUM(r.spend) > 0
             THEN SUM(r.sales)/SUM(r.spend) END                               AS roas,
        CASE WHEN SUM(r.impressions) > 0
             THEN SUM(r.clicks)::FLOAT/SUM(r.impressions)*100 END             AS ctr,
        CASE WHEN SUM(r.clicks) > 0
             THEN SUM(r.orders)::FLOAT/SUM(r.clicks)*100 END                  AS cvr
      FROM CALBRIDGE_PROD.MARTS.CAMPAIGN_PERFORMANCE r
      JOIN CALBRIDGE_PROD.APP.clients c ON c.client_id = r.client_id
      WHERE r.date BETWEEN ? AND ?
        AND r.client_id IN (${placeholders})
        ${marketplaceFilter}
      GROUP BY r.client_id, c.company_name, c.name
      ORDER BY spend DESC
    `;

    binds = [startDate, endDate, ...clientIds];
    if (marketplace && marketplace !== 'all') binds.push(marketplace);
  }

  const rawRows = await query(sql.trim(), binds);

  // Normalise column names to lowercase (Snowflake returns uppercase keys)
  const rows = rawRows.map(r => {
    const out = {};
    for (const col of columns) {
      const val = r[col.toUpperCase()] !== undefined ? r[col.toUpperCase()] : r[col];
      out[col] = val !== undefined ? val : null;
    }
    return out;
  });

  return { rows, columns };
}

// ─── Helper: Parse + validate report params ───────────────────────────────────
function parseReportParams(params) {
  const { clients, startDate, endDate, reportType = 'summary', marketplace = 'all' } = params;

  if (!startDate || !endDate) {
    return { error: 'startDate and endDate are required', status: 400 };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    return { error: 'startDate and endDate must be YYYY-MM-DD', status: 400 };
  }

  const start = new Date(startDate);
  const end   = new Date(endDate);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return { error: 'Invalid date values', status: 400 };
  }
  if (end < start) {
    return { error: 'endDate must be >= startDate', status: 400 };
  }
  const diffDays = Math.round((end - start) / 86400000);
  if (diffDays > 90) {
    return { error: 'Date range cannot exceed 90 days', status: 400 };
  }

  const validReportTypes = ['summary', 'campaign', 'daily'];
  if (!validReportTypes.includes(reportType)) {
    return { error: `reportType must be one of: ${validReportTypes.join(', ')}`, status: 400 };
  }

  // Parse + sanitize client_ids
  let clientIds;
  if (!clients || clients === 'all') {
    clientIds = 'all';
  } else {
    const raw = String(clients).split(',').map(s => s.trim()).filter(Boolean);
    const invalid = raw.filter(id => !isValidUUID(id));
    if (invalid.length) {
      return { error: `Invalid client_id(s): ${invalid.join(', ')}`, status: 400 };
    }
    clientIds = raw;
    if (clientIds.length === 0) {
      return { error: 'clients list is empty', status: 400 };
    }
  }

  return { clientIds, startDate, endDate, reportType, marketplace };
}

// ─── GET /agency/reports/clients ────────────────────────────────────────────
// Returns all active clients the agency can report on.

agencyRouter.get('/reports/clients', async (req, res) => {
  try {
    const rows = await query(
      `SELECT client_id, COALESCE(company_name, name) AS name
       FROM CALBRIDGE_PROD.APP.clients
       WHERE status = 'active'
       ORDER BY name`
    );

    const result = rows.map(r => ({
      clientId: r.CLIENT_ID || r.client_id,
      name:     r.NAME      || r.name,
    }));

    return res.json(result);
  } catch (err) {
    console.error('[GET /agency/reports/clients]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /agency/reports/advertising ────────────────────────────────────────
// Returns advertising performance data for one or more clients.
// Query params: clients, startDate, endDate, reportType, marketplace

agencyRouter.get('/reports/advertising', async (req, res) => {
  try {
    const parsed = parseReportParams(req.query);
    if (parsed.error) return res.status(parsed.status).json({ error: parsed.error });

    let { clientIds, startDate, endDate, reportType, marketplace } = parsed;

    // Resolve 'all' → fetch all active client_ids
    if (clientIds === 'all') {
      const allRows = await query(
        `SELECT client_id FROM CALBRIDGE_PROD.APP.clients WHERE status = 'active'`
      );
      clientIds = allRows.map(r => r.CLIENT_ID || r.client_id).filter(Boolean);
    }

    if (clientIds.length === 0) {
      return res.json({
        rows: [], columns: [], reportType,
        dateRange: { startDate, endDate },
      });
    }

    const { rows, columns } = await runAdvertisingReport({
      clientIds, startDate, endDate, reportType, marketplace,
    });

    return res.json({ rows, columns, reportType, dateRange: { startDate, endDate } });
  } catch (err) {
    console.error('[GET /agency/reports/advertising]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /agency/reports/export-csv ────────────────────────────────────────
// Builds and downloads a CSV of the report query.
// Body: same params as GET /agency/reports/advertising

agencyRouter.post('/reports/export-csv', async (req, res) => {
  try {
    const parsed = parseReportParams(req.body);
    if (parsed.error) return res.status(parsed.status).json({ error: parsed.error });

    let { clientIds, startDate, endDate, reportType, marketplace } = parsed;

    if (clientIds === 'all') {
      const allRows = await query(
        `SELECT client_id FROM CALBRIDGE_PROD.APP.clients WHERE status = 'active'`
      );
      clientIds = allRows.map(r => r.CLIENT_ID || r.client_id).filter(Boolean);
    }

    if (clientIds.length === 0) {
      const today = new Date().toISOString().slice(0, 10);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="calbridge-agency-report-${today}.csv"`);
      return res.send('');
    }

    const { rows, columns } = await runAdvertisingReport({
      clientIds, startDate, endDate, reportType, marketplace,
    });

    const today = new Date().toISOString().slice(0, 10);
    const csv = buildCsv(columns, rows);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="calbridge-agency-report-${today}.csv"`);
    return res.send(csv);
  } catch (err) {
    console.error('[POST /agency/reports/export-csv]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
module.exports.agencyRouter = agencyRouter;
