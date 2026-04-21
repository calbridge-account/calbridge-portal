require('dotenv').config();
const https = require('https');

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

function fetchAsin(asin) {
  return new Promise((resolve) => {
    const url = `https://api.upcitemdb.com/prod/trial/lookup?asin=${asin}`;
    https.get(url, { timeout: 10000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const item = json.items && json.items[0];
          if (item && item.title) {
            resolve({ asin, title: item.title, model: item.model || null, ok: true });
          } else {
            resolve({ asin, title: null, model: null, ok: false, reason: json.code || 'no_item' });
          }
        } catch(e) {
          resolve({ asin, title: null, model: null, ok: false, reason: 'parse_error' });
        }
      });
    }).on('error', (e) => {
      resolve({ asin, title: null, model: null, ok: false, reason: e.message });
    }).on('timeout', () => {
      resolve({ asin, title: null, model: null, ok: false, reason: 'timeout' });
    });
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function chunk(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

async function main() {
  const results = [];
  const batches = chunk(ASINS, 5); // 5 concurrent, rate limit friendly
  
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    console.log(`Batch ${i+1}/${batches.length} (${batch.join(', ')})...`);
    const batchResults = await Promise.all(batch.map(fetchAsin));
    results.push(...batchResults);
    
    for (const r of batchResults) {
      if (r.ok) {
        console.log(`  ✓ ${r.asin}: ${r.title.substring(0, 60)}...`);
      } else {
        console.log(`  ✗ ${r.asin}: ${r.reason}`);
      }
    }
    
    // Respect rate limits (trial is limited)
    if (i < batches.length - 1) await sleep(1500);
  }
  
  const ok = results.filter(r => r.ok);
  const failed = results.filter(r => !r.ok);
  console.log(`\nResults: ${ok.length} found, ${failed.length} not found`);
  
  const fs = require('fs');
  fs.writeFileSync('/tmp/upcdb_results.json', JSON.stringify(results, null, 2));
  console.log('Saved to /tmp/upcdb_results.json');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
