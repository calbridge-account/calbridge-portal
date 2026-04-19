require('dotenv').config();

const { analyze } = require('../src/services/decisionEngine');
const clientId = '7d88ea17-002b-4a02-97fc-bcab1292d57e';

console.log('[' + new Date().toISOString() + '] Running decision engine analysis for CyberPower...');
analyze(clientId, 30).then(result => {
  console.log('RESULT:', JSON.stringify(result, null, 2));
  process.exit(0);
}).catch(err => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
