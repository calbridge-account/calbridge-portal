/**
 * Phase 2a Backfill: clients.connections → amazon_connections
 *
 * Reads existing OAuth tokens from the clients.connections JSON blob and
 * inserts them into the amazon_connections table (which already had the
 * right schema; credential_id/account_id/is_active columns were added
 * in Phase 2a prep).
 *
 * Idempotent — skips any (client_id, connection_type) pair that already has
 * a row in amazon_connections.
 *
 * Maps connection_type → client_accounts.channel:
 *   ads    → sponsored_ads
 *   dsp    → dsp
 *   seller → seller
 *   vendor → vendor
 *
 * NOTE: The Phase 1 migration script attempted to create client_credentials
 * with a specific schema, but a pre-existing generic client_credentials table
 * (key-value store) already existed in the schema. amazon_connections is the
 * correct target table for OAuth tokens — it has all needed columns.
 */
// Table used for normalized OAuth token storage
const OAUTH_TABLE = 'CALBRIDGE_PROD.APP.amazon_connections';
require('dotenv').config();
const { v4: uuidv4 } = require('uuid');
const { query } = require('../src/services/snowflakeService');

// Map from connections JSON key → client_credentials.connection_type AND
// client_accounts.channel value
const TYPE_TO_CHANNEL = {
  ads:    'sponsored_ads',
  dsp:    'dsp',
  seller: 'seller',
  vendor: 'vendor',
};

async function run() {
  console.log('=== Phase 2a: Backfill client_credentials ===\n');

  // ── 1. Load all active clients with a non-empty connections blob ───────────
  console.log('Step 1: Loading clients with connections...');
  const clients = await query(`
    SELECT client_id, connections
    FROM   CALBRIDGE_PROD.APP.clients
    WHERE  status = 'active'
      AND  connections IS NOT NULL
      AND  connections != PARSE_JSON('{}')
  `);
  console.log(`  Found ${clients.length} active client(s) with connections.\n`);

  // ── 2. Load all existing credential rows (for idempotency check) ───────────
  console.log('Step 2: Loading existing amazon_connections rows...');
  const existingRows = await query(`
    SELECT client_id, connection_type
    FROM   CALBRIDGE_PROD.APP.amazon_connections
  `);
  const existingSet = new Set(
    existingRows.map(r => `${r.CLIENT_ID}:${r.CONNECTION_TYPE}`)
  );
  console.log(`  ${existingRows.length} existing credential row(s) found.\n`);

  // ── 3. Load client_accounts for account_id lookup ─────────────────────────
  console.log('Step 3: Loading client_accounts for account_id lookup...');
  const accountRows = await query(`
    SELECT account_id, client_id, channel
    FROM   CALBRIDGE_PROD.APP.client_accounts
    WHERE  is_active = TRUE
  `);
  // Map: "clientId:channel" → account_id
  const accountMap = new Map(
    accountRows.map(r => [`${r.CLIENT_ID}:${r.CHANNEL}`, r.ACCOUNT_ID])
  );
  console.log(`  ${accountRows.length} account row(s) loaded.\n`);

  // ── 4. Process each client ─────────────────────────────────────────────────
  let inserted = 0;
  let skipped  = 0;
  let errors   = 0;

  for (const row of clients) {
    const clientId = row.CLIENT_ID;
    let connections;
    try {
      connections = typeof row.CONNECTIONS === 'string'
        ? JSON.parse(row.CONNECTIONS)
        : row.CONNECTIONS;
    } catch (err) {
      console.warn(`  [WARN] Could not parse connections for client ${clientId}: ${err.message}`);
      errors++;
      continue;
    }

    for (const [connType, channel] of Object.entries(TYPE_TO_CHANNEL)) {
      const conn = connections?.[connType];
      if (!conn || !conn.accessToken) continue; // no token for this type

      // Idempotency check
      const dedupeKey = `${clientId}:${connType}`;
      if (existingSet.has(dedupeKey)) {
        console.log(`  [SKIP] ${clientId} / ${connType} — already in client_credentials`);
        skipped++;
        continue;
      }

      // Look up account_id (nullable)
      const accountId = accountMap.get(`${clientId}:${channel}`) || null;

      const credentialId = uuidv4();
      const tokenExpiresAt = conn.expiresAt
        ? new Date(conn.expiresAt).toISOString().replace('T', ' ').replace('Z', '')
        : null;
      const connectedAt = conn.connectedAt
        ? new Date(conn.connectedAt).toISOString().replace('T', ' ').replace('Z', '')
        : new Date().toISOString().replace('T', ' ').replace('Z', '');

      try {
        await query(`
          INSERT INTO CALBRIDGE_PROD.APP.amazon_connections
            (credential_id, account_id, client_id, connection_type,
             access_token, refresh_token, expires_at, connected_at,
             is_active, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, TRUE, CURRENT_TIMESTAMP())
        `, [
          credentialId,
          accountId,
          clientId,
          connType,
          conn.accessToken || null,
          conn.refreshToken || null,
          tokenExpiresAt,
          connectedAt,
        ]);
        console.log(`  [OK]   ${clientId} / ${connType} → credential_id=${credentialId}${accountId ? ` (account=${accountId})` : ' (no account match)'}`);
        inserted++;
        existingSet.add(dedupeKey); // prevent re-insert within same run
      } catch (err) {
        console.error(`  [ERR]  ${clientId} / ${connType}: ${err.message}`);
        errors++;
      }
    }
  }

  // ── 5. Summary ─────────────────────────────────────────────────────────────
  console.log(`\n=== Done ===`);
  console.log(`  Inserted: ${inserted}`);
  console.log(`  Skipped:  ${skipped}`);
  console.log(`  Errors:   ${errors}`);

  // ── 6. Verify ──────────────────────────────────────────────────────────────
  const verify = await query(`
    SELECT connection_type, COUNT(*) AS cnt
    FROM   CALBRIDGE_PROD.APP.amazon_connections
    GROUP  BY connection_type
    ORDER  BY connection_type
  `);
  console.log('\namazon_connections row counts by type:');
  for (const r of verify) {
    console.log(`  ${r.CONNECTION_TYPE}: ${r.CNT}`);
  }

  process.exit(errors > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('[FATAL]', err.message);
  process.exit(1);
});
