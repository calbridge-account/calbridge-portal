'use strict';

/**
 * migrate-encrypt-tokens.js
 *
 * One-time migration: encrypts existing plaintext OAuth tokens in
 * CALBRIDGE_PROD.APP.amazon_connections using AES-256-GCM.
 *
 * Run AFTER deploying the tokenEncryption service and setting TOKEN_ENCRYPTION_KEY in .env.
 *
 * Usage:
 *   node scripts/migrate-encrypt-tokens.js
 *
 * Safe to re-run: rows that are already encrypted (start with 'enc:v1:') are skipped.
 */

require('dotenv').config();

const { query } = require('../src/services/snowflakeService');
const { encrypt, isEncrypted } = require('../src/services/tokenEncryption');

async function main() {
  console.log('[migrate-encrypt-tokens] Starting migration...');

  // Fetch all rows where access_token does NOT look encrypted yet
  const rows = await query(`
    SELECT credential_id, access_token, refresh_token
    FROM   CALBRIDGE_PROD.APP.amazon_connections
    WHERE  access_token IS NOT NULL
      AND  access_token NOT LIKE 'enc:v1:%'
  `);

  console.log(`[migrate-encrypt-tokens] Found ${rows.length} unencrypted row(s) to migrate.`);

  if (rows.length === 0) {
    console.log('[migrate-encrypt-tokens] Nothing to do. All tokens already encrypted.');
    process.exit(0);
  }

  let migrated = 0;
  let errors   = 0;

  for (const row of rows) {
    const credentialId  = row.CREDENTIAL_ID  || row.credential_id;
    const accessToken   = row.ACCESS_TOKEN   || row.access_token;
    const refreshToken  = row.REFRESH_TOKEN  || row.refresh_token;

    // Double-check: skip already-encrypted rows
    if (isEncrypted(accessToken)) {
      console.log(`  [SKIP]    credential_id=${credentialId} — access_token already encrypted`);
      continue;
    }

    try {
      const encAccess  = encrypt(accessToken);
      const encRefresh = refreshToken ? encrypt(refreshToken) : refreshToken;

      await query(`
        UPDATE CALBRIDGE_PROD.APP.amazon_connections
        SET    access_token  = ?,
               refresh_token = ?,
               updated_at    = CURRENT_TIMESTAMP()
        WHERE  credential_id = ?
      `, [encAccess, encRefresh, credentialId]);

      console.log(`  [OK]      credential_id=${credentialId} — encrypted successfully`);
      migrated++;
    } catch (err) {
      console.error(`  [ERROR]   credential_id=${credentialId} — ${err.message}`);
      errors++;
    }
  }

  console.log(`\n[migrate-encrypt-tokens] Done. Migrated: ${migrated}, Errors: ${errors}, Skipped: ${rows.length - migrated - errors}`);

  if (errors > 0) {
    console.error('[migrate-encrypt-tokens] Some rows failed — review errors above before proceeding.');
    process.exit(1);
  }

  process.exit(0);
}

main().catch(err => {
  console.error('[migrate-encrypt-tokens] Fatal error:', err);
  process.exit(1);
});
