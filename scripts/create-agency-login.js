require('dotenv').config();
const { query } = require('../src/services/snowflakeService');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

(async () => {
  const clientId  = uuidv4();
  const managerId = uuidv4();
  const userId    = uuidv4();
  const hash      = await bcrypt.hash('REDACTED_PASSWORD', 12);
  const email     = 'calbridge@teamcalbridge.com';
  const name      = 'Calbridge';
  const agencyId  = '99bd1b49-c7b4-4fa9-b58f-7825944f524e';

  await query(
    'INSERT INTO CALBRIDGE_PROD.APP.clients (client_id, email, name, client_name, client_type, password_hash, status, account_type, subscription_plan, subscription_status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP())',
    [clientId, email, name, name, 'agency', hash, 'active', 'agency', 'agency', 'active']
  );
  console.log('clients:', clientId);

  await query(
    'INSERT INTO CALBRIDGE_PROD.APP.manager_accounts (manager_id, name, agency_id, subscription_plan, subscription_status, created_at) VALUES (?,?,?,?,?,CURRENT_TIMESTAMP())',
    [managerId, name, agencyId, 'agency', 'active']
  );
  console.log('manager:', managerId);

  await query(
    'INSERT INTO CALBRIDGE_PROD.APP.client_migration_map (client_id, manager_id, advertiser_id, agency_id) VALUES (?,?,?,?)',
    [clientId, managerId, managerId, agencyId]
  );
  console.log('migration map: done');

  await query(
    'INSERT INTO CALBRIDGE_PROD.APP.users (user_id, client_id, email, name, role, is_active, created_at) VALUES (?,?,?,?,?,TRUE,CURRENT_TIMESTAMP())',
    [userId, clientId, email, name, 'manager_owner']
  );
  console.log('user: done');
  console.log('\n✅ Agency login created!');
  console.log('   Email:    calbridge@teamcalbridge.com');
  console.log('   Password: REDACTED_PASSWORD');
  console.log('   Login at: https://app.calbridge.ai');
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
