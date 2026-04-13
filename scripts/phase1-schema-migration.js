/**
 * Phase 1 Schema Migration: client_accounts + client_credentials
 * ADDITIVE ONLY — no existing tables modified
 */
require('dotenv').config();
const { query: runQuery } = require('../src/services/snowflakeService');

async function run() {
  console.log('=== Phase 1 Schema Migration ===\n');

  // ── Step 1: Create client_accounts ─────────────────────────────────────────
  console.log('Step 1: Creating client_accounts table...');
  await runQuery(`
    CREATE TABLE IF NOT EXISTS CALBRIDGE_PROD.APP.client_accounts (
      account_id           VARCHAR(36)   NOT NULL DEFAULT UUID_STRING(),
      client_id            VARCHAR(36)   NOT NULL,
      account_name         VARCHAR(200)  NOT NULL,
      channel              VARCHAR(32)   NOT NULL,
      marketplace          VARCHAR(8)    NOT NULL DEFAULT 'US',
      platform_profile_id  VARCHAR(64),
      agency_profile_id    VARCHAR(64),
      managed_by           VARCHAR(64)   DEFAULT 'calbridge',
      is_active            BOOLEAN       NOT NULL DEFAULT TRUE,
      valid_from           DATE,
      valid_to             DATE,
      notes                VARCHAR(1000),
      created_at           TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
      updated_at           TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
      PRIMARY KEY (account_id)
    )
  `);
  console.log('✓ client_accounts table created (or already exists)\n');

  // ── Step 2: Create client_credentials ──────────────────────────────────────
  console.log('Step 2: Creating client_credentials table...');
  await runQuery(`
    CREATE TABLE IF NOT EXISTS CALBRIDGE_PROD.APP.client_credentials (
      credential_id        VARCHAR(36)   NOT NULL DEFAULT UUID_STRING(),
      account_id           VARCHAR(36),
      client_id            VARCHAR(36)   NOT NULL,
      connection_type      VARCHAR(32)   NOT NULL,
      access_token         VARCHAR(2000),
      refresh_token        VARCHAR(2000),
      token_expires_at     TIMESTAMP_NTZ,
      connected_at         TIMESTAMP_NTZ,
      is_active            BOOLEAN       NOT NULL DEFAULT TRUE,
      created_at           TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
      updated_at           TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
      PRIMARY KEY (credential_id)
    )
  `);
  console.log('✓ client_credentials table created (or already exists)\n');

  // ── Step 3: Backfill client_accounts ───────────────────────────────────────
  console.log('Step 3: Backfilling client_accounts...');

  // Check if already backfilled to make this idempotent
  const existing = await runQuery(`
    SELECT COUNT(*) AS cnt FROM CALBRIDGE_PROD.APP.client_accounts
  `);
  const existingCount = existing[0].CNT;
  console.log(`  Current row count: ${existingCount}`);

  if (existingCount > 0) {
    console.log('  ⚠ Rows already exist — skipping backfill to avoid duplicates.\n');
  } else {
    // CyberPower: 7d88ea17-002b-4a02-97fc-bcab1292d57e
    const cyberPowerId = '7d88ea17-002b-4a02-97fc-bcab1292d57e';
    // Acer: 929cea98-38a6-49ab-bffc-1d38b1f3cc60
    const acerId = '929cea98-38a6-49ab-bffc-1d38b1f3cc60';

    const inserts = [
      // CyberPower — Sponsored Ads US
      {
        client_id: cyberPowerId,
        account_name: 'CyberPower US Sponsored Ads',
        channel: 'sponsored_ads',
        marketplace: 'US',
        platform_profile_id: '2115070599068216',
        agency_profile_id: null,
        managed_by: 'calbridge',
        is_active: true,
        valid_from: null,
        valid_to: null,
        notes: null,
      },
      // CyberPower — Vendor US
      {
        client_id: cyberPowerId,
        account_name: 'CyberPower US Vendor',
        channel: 'vendor',
        marketplace: 'US',
        platform_profile_id: null,
        agency_profile_id: null,
        managed_by: 'calbridge',
        is_active: true,
        valid_from: null,
        valid_to: null,
        notes: 'Vendor connection via SP-API',
      },
      // CyberPower — Seller US
      {
        client_id: cyberPowerId,
        account_name: 'CyberPower US Seller',
        channel: 'seller',
        marketplace: 'US',
        platform_profile_id: null,
        agency_profile_id: null,
        managed_by: 'calbridge',
        is_active: true,
        valid_from: null,
        valid_to: null,
        notes: 'Seller connection via SP-API',
      },
      // CyberPower — DSP US (SparkX, historical)
      {
        client_id: cyberPowerId,
        account_name: 'CyberPower US DSP (SparkX)',
        channel: 'dsp',
        marketplace: 'US',
        platform_profile_id: '590465275620100345',
        agency_profile_id: '3222769947754429',
        managed_by: 'sparkx',
        is_active: false,
        valid_from: '2026-01-01',
        valid_to: '2026-04-01',
        notes: 'Historical SparkX DSP account',
      },
      // CyberPower — DSP US (Calbridge, active)
      {
        client_id: cyberPowerId,
        account_name: 'CyberPower US DSP',
        channel: 'dsp',
        marketplace: 'US',
        platform_profile_id: '591210185781978252',
        agency_profile_id: '2167357144044647',
        managed_by: 'calbridge',
        is_active: true,
        valid_from: '2026-04-01',
        valid_to: null,
        notes: 'Active Calbridge DSP account',
      },
      // Acer — Sponsored Ads US
      {
        client_id: acerId,
        account_name: 'Acer US Sponsored Ads',
        channel: 'sponsored_ads',
        marketplace: 'US',
        platform_profile_id: '2193374793490121',
        agency_profile_id: null,
        managed_by: 'calbridge',
        is_active: true,
        valid_from: null,
        valid_to: null,
        notes: null,
      },
      // Acer — DSP US
      {
        client_id: acerId,
        account_name: 'Acer US DSP',
        channel: 'dsp',
        marketplace: 'US',
        platform_profile_id: '577089618135015300',
        agency_profile_id: '3222769947754429',
        managed_by: 'calbridge',
        is_active: true,
        valid_from: '2026-02-01',
        valid_to: null,
        notes: null,
      },
      // Acer — DSP US (Acer America)
      {
        client_id: acerId,
        account_name: 'Acer America US DSP',
        channel: 'dsp',
        marketplace: 'US',
        platform_profile_id: '3252964120201',
        agency_profile_id: '2167357144044647',
        managed_by: 'calbridge',
        is_active: false,
        valid_from: null,
        valid_to: null,
        notes: 'Acer America DSP account',
      },
    ];

    for (const row of inserts) {
      const sql = `
        INSERT INTO CALBRIDGE_PROD.APP.client_accounts (
          client_id, account_name, channel, marketplace,
          platform_profile_id, agency_profile_id, managed_by,
          is_active, valid_from, valid_to, notes
        ) VALUES (
          '${row.client_id}',
          '${row.account_name}',
          '${row.channel}',
          '${row.marketplace}',
          ${row.platform_profile_id ? `'${row.platform_profile_id}'` : 'NULL'},
          ${row.agency_profile_id ? `'${row.agency_profile_id}'` : 'NULL'},
          '${row.managed_by}',
          ${row.is_active},
          ${row.valid_from ? `'${row.valid_from}'` : 'NULL'},
          ${row.valid_to ? `'${row.valid_to}'` : 'NULL'},
          ${row.notes ? `'${row.notes}'` : 'NULL'}
        )
      `;
      await runQuery(sql);
      console.log(`  ✓ Inserted: ${row.account_name}`);
    }
    console.log('');
  }

  // ── Step 4: Verify ─────────────────────────────────────────────────────────
  console.log('Step 4: Verifying...');

  const cyberCount = await runQuery(`
    SELECT COUNT(*) AS cnt FROM CALBRIDGE_PROD.APP.client_accounts
    WHERE client_id = '7d88ea17-002b-4a02-97fc-bcab1292d57e'
  `);
  console.log(`  CyberPower rows: ${cyberCount[0].CNT} (expected: 5)`);
  if (cyberCount[0].CNT !== 5) console.warn('  ⚠ MISMATCH — expected 5!');

  const acerCount = await runQuery(`
    SELECT COUNT(*) AS cnt FROM CALBRIDGE_PROD.APP.client_accounts
    WHERE client_id = '929cea98-38a6-49ab-bffc-1d38b1f3cc60'
  `);
  console.log(`  Acer rows: ${acerCount[0].CNT} (expected: 3)`);
  if (acerCount[0].CNT !== 3) console.warn('  ⚠ MISMATCH — expected 3!');

  console.log('\nFull client_accounts contents:\n');
  const allRows = await runQuery(`
    SELECT
      account_id,
      client_id,
      account_name,
      channel,
      marketplace,
      platform_profile_id,
      agency_profile_id,
      managed_by,
      is_active,
      valid_from,
      valid_to,
      notes,
      created_at
    FROM CALBRIDGE_PROD.APP.client_accounts
    ORDER BY client_id, channel, is_active DESC
  `);

  console.table(allRows.map(r => ({
    account_name: r.ACCOUNT_NAME,
    channel: r.CHANNEL,
    platform_profile_id: r.PLATFORM_PROFILE_ID,
    agency_profile_id: r.AGENCY_PROFILE_ID,
    managed_by: r.MANAGED_BY,
    is_active: r.IS_ACTIVE,
    valid_from: r.VALID_FROM,
    valid_to: r.VALID_TO,
  })));

  console.log('\nRaw rows (full detail):');
  allRows.forEach((r, i) => {
    console.log(`\n[${i + 1}] ${r.ACCOUNT_NAME}`);
    console.log(`     account_id:          ${r.ACCOUNT_ID}`);
    console.log(`     client_id:           ${r.CLIENT_ID}`);
    console.log(`     channel:             ${r.CHANNEL}`);
    console.log(`     marketplace:         ${r.MARKETPLACE}`);
    console.log(`     platform_profile_id: ${r.PLATFORM_PROFILE_ID}`);
    console.log(`     agency_profile_id:   ${r.AGENCY_PROFILE_ID}`);
    console.log(`     managed_by:          ${r.MANAGED_BY}`);
    console.log(`     is_active:           ${r.IS_ACTIVE}`);
    console.log(`     valid_from:          ${r.VALID_FROM}`);
    console.log(`     valid_to:            ${r.VALID_TO}`);
    console.log(`     notes:               ${r.NOTES}`);
    console.log(`     created_at:          ${r.CREATED_AT}`);
  });

  console.log('\n=== Migration complete ===');
  process.exit(0);
}

run().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
