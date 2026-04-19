require('dotenv').config();
const { query } = require('../src/services/snowflakeService');

const clientId = '7d88ea17-002b-4a02-97fc-bcab1292d57e';

// First find what tables exist
query(`
  SELECT table_schema, table_name, row_count
  FROM CALBRIDGE_PROD.information_schema.tables
  WHERE table_type = 'BASE TABLE'
  ORDER BY table_schema, table_name
`).then(tables => {
  console.log('\n=== All tables in CALBRIDGE_PROD ===');
  tables.forEach(r => console.log(`  [${r.TABLE_SCHEMA}] ${r.TABLE_NAME} (${r.ROW_COUNT} rows)`));
  process.exit(0);
}).catch(e => { console.error(e.message); process.exit(1); });
