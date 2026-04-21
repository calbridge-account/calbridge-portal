require('dotenv').config();
const axios = require('axios');
const { getValidToken } = require('./src/services/amazonAuthService');

const CLIENT_ID = '7d88ea17-002b-4a02-97fc-bcab1292d57e';
const MARKETPLACE_ID = 'ATVPDKIKX0DER';

async function testEndpoint(type, asin) {
  console.log(`\nTesting ${type} token with ASIN ${asin}...`);
  try {
    const accessToken = await getValidToken(CLIENT_ID, type);
    console.log(`  Got token: ${accessToken.substring(0, 30)}...`);
    
    const client = axios.create({
      baseURL: 'https://sellingpartnerapi-na.amazon.com',
      headers: {
        'x-amz-access-token': accessToken,
        'Content-Type': 'application/json'
      }
    });
    
    const res = await client.get('/catalog/2022-04-01/items', {
      params: {
        identifiers: asin,
        identifiersType: 'ASIN',
        marketplaceIds: MARKETPLACE_ID,
        includedData: 'summaries',
        pageSize: 1,
      }
    });
    
    console.log(`  SUCCESS! Items: ${res.data?.items?.length}`);
    if (res.data?.items?.length > 0) {
      const item = res.data.items[0];
      console.log(`  ASIN: ${item.asin}`);
      console.log(`  Title: ${item.summaries?.[0]?.itemName}`);
    }
    return true;
  } catch (err) {
    console.log(`  Error: ${err.response?.data?.errors?.[0]?.code}: ${err.response?.data?.errors?.[0]?.message}`);
    console.log(`  HTTP status: ${err.response?.status}`);
    return false;
  }
}

async function main() {
  // Test with a known ASIN that should work
  const testAsin = 'B0039YX77M'; // OR2200LCDRTXL2U - worked via web_fetch
  
  await testEndpoint('seller', testAsin);
  await testEndpoint('vendor', testAsin);
  
  process.exit(0);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
