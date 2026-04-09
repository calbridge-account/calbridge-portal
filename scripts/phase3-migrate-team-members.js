#!/usr/bin/env node
/**
 * Phase 3D — Team Member Migration
 *
 * Migrates team members from the legacy JSON blob + linked_client_id system
 * into the new users + user_advertiser_access tables.
 *
 * What this script does:
 *   1. Creates user_advertiser_access table if it doesn't exist
 *   2. Creates manager_accounts table if it doesn't exist
 *   3. Creates advertiser_accounts table if it doesn't exist
 *   4. Reads all clients with linked_client_id (team member login accounts)
 *   5. For each team member: upserts a row in users + user_advertiser_access
 *   6. Also seeds manager_accounts + advertiser_accounts from the parent client
 *   7. Prints a full summary
 *
 * Safe to re-run: all writes are MERGE/upsert, nothing is deleted from old tables.
 *
 * Usage:
 *   node scripts/phase3-migrate-team-members.js
 *   node scripts/phase3-migrate-team-members.js --dry-run   # print plan without writing
 */

require('dotenv').config();
const { query } = require('../src/services/snowflakeService');
const crypto = require('crypto');

const DRY_RUN = process.argv.includes('--dry-run');

// ─── Role normalisation ───────────────────────────────────────────────────────
// Old system uses: viewer | admin
// New system uses: viewer | analyst | manager | owner
function normaliseRole(oldRole) {
  if (!oldRole) return 'viewer';
  switch (oldRole.toLowerCase()) {
    case 'owner':   return 'owner';
    case 'admin':   return 'manager';
    case 'manager': return 'manager';
    case 'analyst': return 'analyst';
    default:        return 'viewer';
  }
}

// ─── Ensure tables exist ──────────────────────────────────────────────────────

async function ensureTables() {
  console.log('\n[Phase3D] Ensuring tables exist...');

  await query(`
    CREATE TABLE IF NOT EXISTS CALBRIDGE_PROD.APP.manager_accounts (
      manager_id             VARCHAR(36) PRIMARY KEY,
      name                   VARCHAR(255),
      stripe_customer_id     VARCHAR,
      stripe_subscription_id VARCHAR,
      subscription_plan      VARCHAR(20),
      subscription_status    VARCHAR(20),
      created_at             TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log('  ✓ manager_accounts');

  await query(`
    CREATE TABLE IF NOT EXISTS CALBRIDGE_PROD.APP.advertiser_accounts (
      advertiser_id        VARCHAR(36) PRIMARY KEY,
      manager_id           VARCHAR(36),
      name                 VARCHAR(255),
      marketplace          TEXT DEFAULT 'US',
      ads_profile_id       TEXT,
      sp_seller_id         TEXT,
      sp_vendor_id         TEXT,
      dsp_advertiser_id    TEXT,
      is_active            BOOLEAN DEFAULT TRUE,
      created_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log('  ✓ advertiser_accounts');

  await query(`
    CREATE TABLE IF NOT EXISTS CALBRIDGE_PROD.APP.user_advertiser_access (
      user_id       VARCHAR(36),
      advertiser_id VARCHAR(36),
      role          VARCHAR(20) DEFAULT 'viewer',
      PRIMARY KEY (user_id, advertiser_id)
    )
  `);
  console.log('  ✓ user_advertiser_access');

  // Note: client_migration_map may already exist from Phase 3B with migrated_at column
  await query(`
    CREATE TABLE IF NOT EXISTS CALBRIDGE_PROD.APP.client_migration_map (
      client_id     VARCHAR(36) PRIMARY KEY,
      manager_id    VARCHAR(36),
      advertiser_id VARCHAR(36),
      migrated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log('  ✓ client_migration_map');
}

// ─── Migrate a parent client → manager_accounts + advertiser_accounts ─────────

async function migrateParentClient(client) {
  const managerId    = client.CLIENT_ID;  // client_id becomes manager_id
  const advertiserId = client.CLIENT_ID;  // same id for single-advertiser clients

  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would upsert manager_accounts: ${managerId} (${client.NAME})`);
    console.log(`  [DRY RUN] Would upsert advertiser_accounts: ${advertiserId} (${client.NAME})`);
    return { managerId, advertiserId };
  }

  // Upsert manager_accounts
  await query(`
    MERGE INTO CALBRIDGE_PROD.APP.manager_accounts t
    USING (SELECT ? AS manager_id, ? AS name) s
      ON t.manager_id = s.manager_id
    WHEN NOT MATCHED THEN INSERT (manager_id, name, created_at)
      VALUES (s.manager_id, s.name, CURRENT_TIMESTAMP)
  `, [managerId, client.NAME || client.EMAIL]);

  // Upsert advertiser_accounts
  await query(`
    MERGE INTO CALBRIDGE_PROD.APP.advertiser_accounts t
    USING (SELECT ? AS advertiser_id, ? AS manager_id, ? AS name) s
      ON t.advertiser_id = s.advertiser_id
    WHEN NOT MATCHED THEN INSERT (advertiser_id, manager_id, name, marketplace, is_active, created_at)
      VALUES (s.advertiser_id, s.manager_id, s.name, 'US', TRUE, CURRENT_TIMESTAMP)
  `, [advertiserId, managerId, client.NAME || client.EMAIL]);

  // Upsert client_migration_map so resolveManagerContext works
  await query(`
    MERGE INTO CALBRIDGE_PROD.APP.client_migration_map t
    USING (SELECT ? AS client_id, ? AS manager_id, ? AS advertiser_id) s
      ON t.client_id = s.client_id
    WHEN MATCHED THEN UPDATE SET manager_id = s.manager_id, advertiser_id = s.advertiser_id
    WHEN NOT MATCHED THEN INSERT (client_id, manager_id, advertiser_id, migrated_at)
      VALUES (s.client_id, s.manager_id, s.advertiser_id, CURRENT_TIMESTAMP)
  `, [managerId, managerId, advertiserId]);

  return { managerId, advertiserId };
}

// ─── Migrate a single team member ─────────────────────────────────────────────

async function migrateTeamMember({ linkedClient, teamMemberEntry, advertiserId }) {
  const email     = (linkedClient?.EMAIL || teamMemberEntry?.email || '').toLowerCase().trim();
  const name      = linkedClient?.NAME   || teamMemberEntry?.name  || '';
  const role      = normaliseRole(teamMemberEntry?.role);
  // Prefer the id from the actual client row (linked_client_id side), fall back to JSON id
  const userId    = linkedClient?.CLIENT_ID || teamMemberEntry?.id || crypto.randomUUID();
  const invitedAt = teamMemberEntry?.invitedAt || null;
  const status    = teamMemberEntry?.status   || 'pending';

  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would upsert user: ${email} (${name}) role=${role} userId=${userId}`);
    console.log(`  [DRY RUN] Would upsert user_advertiser_access: userId=${userId} advertiserId=${advertiserId} role=${role}`);
    return { email, userId, role, status };
  }

  // client_id column is NOT NULL — use linked client's id if available, else fall back to the
  // JSON member id (which we're also using as user_id for pending/invited-only members)
  const clientIdForUsers = linkedClient?.CLIENT_ID || userId;

  // Upsert into users table (existing schema has user_id, client_id, email, name, role, is_active, invited_at, created_at)
  await query(`
    MERGE INTO CALBRIDGE_PROD.APP.users t
    USING (SELECT ? AS user_id, ? AS email, ? AS name, ? AS role, ? AS client_id, ? AS invited_at) s
      ON t.email = s.email
    WHEN MATCHED THEN UPDATE SET
      name       = COALESCE(s.name, t.name),
      role       = s.role,
      client_id  = COALESCE(t.client_id, s.client_id),
      is_active  = TRUE
    WHEN NOT MATCHED THEN INSERT (user_id, client_id, email, name, role, is_active, invited_at, created_at)
      VALUES (s.user_id, s.client_id, s.email, s.name, s.role, TRUE, s.invited_at::TIMESTAMP, CURRENT_TIMESTAMP)
  `, [userId, email, name, role, clientIdForUsers, invitedAt || new Date().toISOString()]);

  // Re-fetch userId in case it was matched by email (existing row)
  const userRow = await query(
    'SELECT user_id FROM CALBRIDGE_PROD.APP.users WHERE email = ?', [email]
  );
  const resolvedUserId = userRow[0]?.USER_ID || userId;

  // Upsert user_advertiser_access
  await query(`
    MERGE INTO CALBRIDGE_PROD.APP.user_advertiser_access t
    USING (SELECT ? AS user_id, ? AS advertiser_id, ? AS role) s
      ON t.user_id = s.user_id AND t.advertiser_id = s.advertiser_id
    WHEN MATCHED THEN UPDATE SET role = s.role
    WHEN NOT MATCHED THEN INSERT (user_id, advertiser_id, role)
      VALUES (s.user_id, s.advertiser_id, s.role)
  `, [resolvedUserId, advertiserId, role]);

  return { email, userId: resolvedUserId, role, status };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${'='.repeat(60)}`);
  console.log('Phase 3D — Team Member Migration');
  if (DRY_RUN) console.log('*** DRY RUN — no writes will be made ***');
  console.log(`${'='.repeat(60)}`);

  // Step 1: Ensure tables
  if (!DRY_RUN) {
    await ensureTables();
  } else {
    console.log('\n[Phase3D] (Dry run: skipping table creation)');
  }

  // Step 2: Load all parent clients (non-linked, i.e. actual accounts, not team member logins)
  console.log('\n[Phase3D] Loading parent clients...');
  const parentClients = await query(`
    SELECT client_id, email, name, team_members
    FROM CALBRIDGE_PROD.APP.clients
    WHERE linked_client_id IS NULL
      AND team_members IS NOT NULL
      AND team_members != '[]'
      AND team_members != ''
  `);
  console.log(`  Found ${parentClients.length} parent client(s) with team members`);

  // Step 3: Load all linked clients (team member login accounts)
  console.log('\n[Phase3D] Loading linked client accounts...');
  const linkedClients = await query(`
    SELECT client_id, email, name, linked_client_id
    FROM CALBRIDGE_PROD.APP.clients
    WHERE linked_client_id IS NOT NULL
  `);
  console.log(`  Found ${linkedClients.length} linked client(s) (team member accounts)`);

  // Index by email for quick lookup
  const linkedByEmail = {};
  for (const lc of linkedClients) {
    linkedByEmail[lc.EMAIL?.toLowerCase()?.trim()] = lc;
  }

  // Step 4: Migrate each parent and their team members
  const summary = {
    parentsMigrated:          0,
    teamMembersMigrated:      0,
    teamMembersWithoutAccount: 0,
    errors:                   [],
  };

  for (const parent of parentClients) {
    const parentName = parent.NAME || parent.EMAIL;
    console.log(`\n[Phase3D] Migrating parent: ${parentName} (${parent.CLIENT_ID})`);

    let managerId, advertiserId;
    try {
      ({ managerId, advertiserId } = await migrateParentClient(parent));
      summary.parentsMigrated++;
    } catch (err) {
      console.error(`  ✗ Failed to migrate parent ${parentName}:`, err.message);
      summary.errors.push({ type: 'parent', id: parent.CLIENT_ID, error: err.message });
      continue;
    }

    // Parse team_members JSON
    let members = [];
    try {
      members = typeof parent.TEAM_MEMBERS === 'string'
        ? JSON.parse(parent.TEAM_MEMBERS)
        : (parent.TEAM_MEMBERS || []);
    } catch {
      console.warn(`  ⚠ Could not parse team_members JSON for ${parentName}`);
      continue;
    }

    console.log(`  Team members in JSON: ${members.length}`);

    for (const member of members) {
      const emailKey = member.email?.toLowerCase()?.trim();
      const linkedClient = linkedByEmail[emailKey] || null;

      if (!linkedClient) {
        console.log(`  ⚠ ${member.email} — no linked client account (pending/not yet signed up)`);
        summary.teamMembersWithoutAccount++;
      }

      try {
        const result = await migrateTeamMember({
          linkedClient,
          teamMemberEntry: member,
          advertiserId,
        });
        console.log(`  ✓ ${result.email} → role=${result.role} status=${result.status} userId=${result.userId}`);
        summary.teamMembersMigrated++;
      } catch (err) {
        console.error(`  ✗ Failed to migrate member ${member.email}:`, err.message);
        summary.errors.push({ type: 'team_member', email: member.email, error: err.message });
      }
    }
  }

  // ─── Summary ─────────────────────────────────────────────────────────────────
  console.log(`\n${'='.repeat(60)}`);
  console.log('Migration Summary');
  console.log(`${'='.repeat(60)}`);
  console.log(`  Parent clients migrated:               ${summary.parentsMigrated}`);
  console.log(`  Team members migrated:                 ${summary.teamMembersMigrated}`);
  console.log(`  Team members without login account:    ${summary.teamMembersWithoutAccount}`);
  console.log(`  Errors:                                ${summary.errors.length}`);
  if (summary.errors.length) {
    console.log('\n  Errors detail:');
    for (const e of summary.errors) {
      console.log(`    - [${e.type}] ${e.id || e.email}: ${e.error}`);
    }
  }

  if (!DRY_RUN) {
    // Verify by reading back
    console.log('\n[Phase3D] Verification — reading back migrated data...');
    const users = await query('SELECT user_id, email, name, role FROM CALBRIDGE_PROD.APP.users');
    const access = await query('SELECT user_id, advertiser_id, role FROM CALBRIDGE_PROD.APP.user_advertiser_access');
    const mgrs   = await query('SELECT manager_id, name FROM CALBRIDGE_PROD.APP.manager_accounts');
    const advs   = await query('SELECT advertiser_id, manager_id, name FROM CALBRIDGE_PROD.APP.advertiser_accounts');
    console.log(`  users table:                  ${users.length} row(s)`);
    console.log(`  user_advertiser_access table: ${access.length} row(s)`);
    console.log(`  manager_accounts table:       ${mgrs.length} row(s)`);
    console.log(`  advertiser_accounts table:    ${advs.length} row(s)`);

    if (users.length) {
      console.log('\n  Users:');
      for (const u of users) console.log(`    ${u.EMAIL} — ${u.NAME} (role: ${u.ROLE})`);
    }
    if (access.length) {
      console.log('\n  Access rows:');
      for (const a of access) console.log(`    userId=${a.USER_ID} → advertiserId=${a.ADVERTISER_ID} role=${a.ROLE}`);
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  if (DRY_RUN) {
    console.log('Dry run complete — no data was written.');
  } else {
    console.log('Migration complete!');
  }
  console.log(`${'='.repeat(60)}\n`);

  process.exit(summary.errors.length > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('\n[Phase3D] Fatal error:', err);
  process.exit(1);
});
