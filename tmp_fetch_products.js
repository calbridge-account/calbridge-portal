require('dotenv').config();
const axios = require('axios');
const { query } = require('./src/services/snowflakeService');
const { getValidToken } = require('./src/services/amazonAuthService');

const CLIENT_ID = '7d88ea17-002b-4a02-97fc-bcab1292d57e';
const MARKETPLACE_ID = 'ATVPDKIKX0DER'; // US

const ASINS = [
  'B00095W91Y','B000XJJN60','B0016P7HJA','B001E08PF2','B001Q3MA4O','B0039YX77M',
  'B003KBB276','B003KBB35C','B003KBEMTG','B003KBEOOO','B003VNFAS0','B003VQMTKO',
  'B00429N18S','B00429N19M','B004K1YFWE','B004K1YFWO','B004K1YFZQ','B004K1YG5K',
  'B005TXZ0TY','B0083TXNMM','B0083TXNPE','B008U4SGYK','B009ACPB8K','B009ACPBAI',
  'B009ACPBPS','B009ACPBSK','B009ACPC16','B009ACPC5C','B009ACPC6Q','B009ACPC8Y',
  'B009ACPCC0','B009ACPCK2','B009ACPCX4','B009ACPD4C','B00ANU8M3Y','B00ANU8M5W',
  'B00FLTTI3A','B00GOU8RMI','B00GOU8T76','B00GOU8U1G','B00GOUA56O','B00IPNPYPA',
  'B00J9OHCN6','B00JBJQ0RS','B00JKMYEKQ','B00NMY60ZU','B00XLUC220','B00YJ9MDTY',
  'B00YO0ZKSY','B0125HR2ZG','B01615H1AE','B01615H29O','B01615H3CK','B01BIJWCI4',
  'B01DVG2XCC','B01HAO0IBO','B01JRLT65C','B01MYOYC9U','B06XMR4BZF','B072BY6WR7',
  'B075C488G4','B076MJMDLN','B0778YGVV2','B0797HLQNG','B079KDJ5NT','B07LGFSLCL',
  'B07P7RPWK3','B07P8WMDJ5','B07PB1X2YD','B07SN5GPRN','B07SP51QXC','B07TKYPWKG',
  'B07TP64DP1','B07TR6BXXD','B07VBBFQCH','B07VDGSXHK','B07VJPDGL9','B085828FM6',
  'B08582J7T3','B089YW6GM8','B09HL7LBZT','B09JZYJDRS','B09RTMPJNK','B09RTN4VX4',
  'B09RTNG9JF','B09RTNL7BC','B09RTNTW7N','B0BCR5T93K','B0BKHLHM9S','B0BZT5C8SS',
  'B0CDHYMH8V','B0CDJ2W77Y','B0CDJ3T1HM','B0CGBM7QVM','B0CJ9VXST7','B0CJ9WB7BY',
  'B0CJ9WBZFR','B0CJ9WTFJ6','B0CJ9XWR7Q','B0D23RXDB7','B0D82D37S4','B0DCLDX1N1',
  'B0DCLK7RK1','B0F6NWX9RJ','B0F6NY9RDX','B0G1NL6415','B0G1P11Z73','B0G1PCCMG3',
  'B0G2MWGTXC','B0G2MY1ZTB','B0G2MZQ2P2','B0G3682755','B0G9VYVHGQ','B0GH28SKWF',
  'B0GH2HZMJL','B0GH2K9WBH','B0GH2PXX3F','B0GH2ZWRHF','B0GH3816S1','B0GH3CFT2N',
  'B0GK4J6JZS','B0GSX766J2','B0GSXF6WJ2','B0GTRRQ4MH'
];

function chunk(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  console.log(`Fetching ${ASINS.length} ASINs via SP-API Catalog Items...`);
  
  const accessToken = await getValidToken(CLIENT_ID, 'seller');
  const client = axios.create({
    baseURL: 'https://sellingpartnerapi-na.amazon.com',
    headers: {
      'x-amz-access-token': accessToken,
      'Content-Type': 'application/json'
    }
  });

  const batches = chunk(ASINS, 20);
  const results = [];
  
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    console.log(`Batch ${i+1}/${batches.length}: ${batch.length} ASINs...`);
    
    try {
      const res = await client.get('/catalog/2022-04-01/items', {
        params: {
          identifiers: batch.join(','),
          identifiersType: 'ASIN',
          marketplaceIds: MARKETPLACE_ID,
          includedData: 'summaries,identifiers',
          pageSize: 20,
        }
      });
      
      const items = res.data?.items || [];
      console.log(`  Got ${items.length} items`);
      
      for (const item of items) {
        const summary = (item.summaries || [])[0] || {};
        // Try to get model number from identifiers
        const identifiers = (item.identifiers || [])[0]?.identifiers || [];
        const modelId = identifiers.find(id => id.identifierType === 'MODEL_NUMBER');
        
        results.push({
          asin: item.asin,
          title: summary.itemName || null,
          modelNumber: summary.modelNumber || modelId?.identifier || null,
          brand: summary.brand || null,
        });
      }
    } catch (err) {
      console.error(`  Error on batch ${i+1}:`, err.response?.data || err.message);
      // Add null entries for failed ASINs
      for (const asin of batch) {
        results.push({ asin, title: null, modelNumber: null, brand: null, error: true });
      }
    }
    
    // Rate limit: 2 req/s for catalog items
    if (i < batches.length - 1) {
      await sleep(600);
    }
  }
  
  // Report results
  const withTitles = results.filter(r => r.title);
  const withoutTitles = results.filter(r => !r.title);
  console.log(`\nResults: ${withTitles.length} with titles, ${withoutTitles.length} without`);
  
  if (withoutTitles.length > 0) {
    console.log('ASINs without titles:', withoutTitles.map(r => r.asin).join(', '));
  }
  
  // Write results to file for inspection
  const fs = require('fs');
  fs.writeFileSync('/tmp/catalog_results.json', JSON.stringify(results, null, 2));
  console.log('Results saved to /tmp/catalog_results.json');
  
  // Now do the Snowflake updates
  console.log(`\nUpdating Snowflake for ${withTitles.length} products...`);
  let updated = 0;
  for (const r of withTitles) {
    try {
      await query(
        "UPDATE CALBRIDGE_PROD.APP.PRODUCTS SET title=?, model_number=COALESCE(NULLIF(model_number,''),?), last_synced_at=CURRENT_TIMESTAMP() WHERE client_id='7d88ea17-002b-4a02-97fc-bcab1292d57e' AND asin=?",
        [r.title, r.modelNumber || null, r.asin]
      );
      updated++;
      if (updated % 20 === 0) console.log(`  Updated ${updated}/${withTitles.length}...`);
    } catch (e) {
      console.error(`  Failed to update ${r.asin}:`, e.message);
    }
  }
  
  console.log(`\nDone! Updated ${updated} products in Snowflake.`);
  process.exit(0);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
