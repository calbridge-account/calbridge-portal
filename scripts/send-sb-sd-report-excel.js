require('dotenv').config();
const XLSX = require('xlsx');
const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);
const path = require('path');
const fs = require('fs');

const sbRows = [
  { Campaign: 'B.Keyword.Products.SB.UPS.BestSellers',                              Format: 'Products', Headline: 'Stay protected with battery backup from CyberPower', 'Featured ASINs': 'B00429N19W, B00DBAA696',                  Status: 'PUBLISHED',                'Needs Headline?': 'No' },
  { Campaign: 'B.Keyword.Store.SB.UPS.2026.StoreSpotlight',                         Format: 'Store',    Headline: 'Stay protected with battery backup from CyberPower', 'Featured ASINs': '—',                                        Status: 'PUBLISHED',                'Needs Headline?': 'No' },
  { Campaign: 'B.Keyword.Store.SB.UPS.StoreSpotlight',                              Format: 'Store',    Headline: 'Stay protected with battery backup from Cyberpower', 'Featured ASINs': '—',                                        Status: 'PUBLISHED',                'Needs Headline?': '⚠ TYPO (lowercase p)' },
  { Campaign: 'B.Keyword.Video.SB.UPS.IntelligentLCD.CP1500AVRLCD3.B0BCMLLSHL',    Format: 'Video',    Headline: '',                                                    'Featured ASINs': 'B0BCMLLSHL',                               Status: 'PUBLISHED',                'Needs Headline?': '⚠ YES' },
  { Campaign: 'B.Keyword.Video.SB.UPS.PFCSinewave.CP1500PFCLCD.B00429N19W',         Format: 'Video',    Headline: 'Stay protected with battery backup from CyberPower', 'Featured ASINs': 'B00429N19W, B0B354X985',                  Status: 'PUBLISHED',                'Needs Headline?': 'No' },
  { Campaign: 'B.Keyword.Video.SB.UPS.PFCSinewave.CPPFC(1)',                        Format: 'Video',    Headline: '',                                                    'Featured ASINs': 'B00429N19W',                               Status: 'PENDING_MODERATION_REVIEW', 'Needs Headline?': '⚠ YES' },
  { Campaign: 'B.Keyword.Video.SB.PFCSinewave.CP1500PFCRM2U.B0B354X985',            Format: 'Video',    Headline: 'Stay protected with battery backup from CyberPower', 'Featured ASINs': 'B0B354X985',                               Status: 'PUBLISHED',                'Needs Headline?': 'No' },
  { Campaign: 'B.RSOV.Products.SB.UPS.1500units',                                   Format: 'Products', Headline: 'Stay protected with battery backup from CyberPower', 'Featured ASINs': 'B00429N19W, B0BCMLLSHL, B0B354X985',      Status: 'PUBLISHED',                'Needs Headline?': 'No' },
  { Campaign: 'B.SB.Products.SB.UPS.PFC',                                           Format: 'Products', Headline: 'Stay protected with battery backup from CyberPower', 'Featured ASINs': 'B00429N19W, B0B354X985',                  Status: 'PUBLISHED',                'Needs Headline?': 'No' },
  { Campaign: 'B2B - B.Keyword.Products.SB.UPS.1500units',                          Format: 'Products', Headline: 'Stay protected with battery backup from CyberPower', 'Featured ASINs': 'B0B354X985, B00429N19W, B01615H29O',      Status: 'PUBLISHED',                'Needs Headline?': 'No' },
  { Campaign: 'B2B - B.Keyword.Store.SB.UPS.StoreSpotlight',                        Format: 'Store',    Headline: 'Stay protected with battery backup from CyberPower', 'Featured ASINs': '—',                                        Status: 'PUBLISHED',                'Needs Headline?': 'No' },
  { Campaign: 'B2B - N.Keyword.Products.SB.UPS.1500units',                          Format: 'Products', Headline: 'Stay protected with battery backup from CyberPower', 'Featured ASINs': 'B0B354X985, B00429N19W, B01615H29O',      Status: 'PUBLISHED',                'Needs Headline?': 'No' },
  { Campaign: 'B2B - N.Keyword.Store.SB.UPS.StoreSpotlight',                        Format: 'Store',    Headline: 'Stay protected with battery backup from CyberPower', 'Featured ASINs': '—',                                        Status: 'PUBLISHED',                'Needs Headline?': 'No' },
  { Campaign: 'C.Keyword.Products.SB.UPS.1500units',                                Format: 'Products', Headline: 'Stay protected with battery backup from CyberPower', 'Featured ASINs': 'B00429N19W, B0BCMLLSHL, B00DBAA696',      Status: 'PUBLISHED',                'Needs Headline?': 'No' },
  { Campaign: 'C.Keyword.Store.SB.UPS.StoreSpotlight',                              Format: 'Store',    Headline: 'Stay protected with battery backup from CyberPower', 'Featured ASINs': '—',                                        Status: 'PUBLISHED',                'Needs Headline?': 'No' },
  { Campaign: 'C.Keyword.Video.SB.PFCSinewave.2026.CP1500AVRLCD3',                  Format: 'Video',    Headline: '',                                                    'Featured ASINs': 'B0BCMLLSHL',                               Status: 'PUBLISHED',                'Needs Headline?': '⚠ YES' },
  { Campaign: 'C.Keyword.Video.SB.PFCSinewave.2026.CP1500PFCLCD',                   Format: 'Video',    Headline: '',                                                    'Featured ASINs': 'B00429N19W',                               Status: 'PUBLISHED',                'Needs Headline?': '⚠ YES' },
  { Campaign: 'C.Keyword.Video.SB.PFCSinewave.CP1500PFCRM2U.B0B354X985_v2',         Format: 'Video',    Headline: 'Stay protected with battery backup from CyberPower', 'Featured ASINs': 'B0B354X985',                               Status: 'PUBLISHED',                'Needs Headline?': 'No' },
  { Campaign: 'C.Keyword.Video.SB.UPS.IntelligentLCD.CP1500AVRLCD3.B0BCMLLSHL',    Format: 'Video',    Headline: '',                                                    'Featured ASINs': 'B0BCMLLSHL',                               Status: 'PUBLISHED',                'Needs Headline?': '⚠ YES' },
  { Campaign: 'C.Keyword.Video.SB.UPS.IntelligentLCD.CPAVR3',                       Format: 'Video',    Headline: '',                                                    'Featured ASINs': 'B0BCMLLSHL',                               Status: 'PUBLISHED',                'Needs Headline?': '⚠ YES' },
  { Campaign: 'C.Keyword.Video.SB.UPS.PFCSinewave.CP1500PFCLCD.B00429N19W',         Format: 'Video',    Headline: 'Stay protected with battery backup from CyberPower', 'Featured ASINs': 'B00429N19W',                               Status: 'PUBLISHED',                'Needs Headline?': 'No' },
  { Campaign: 'C.Keyword.Video.SB.UPS.PFCSinewave.CP1500PFCRM2U.B0B354X985',        Format: 'Video',    Headline: '',                                                    'Featured ASINs': 'B0B354X985',                               Status: 'PUBLISHED',                'Needs Headline?': '⚠ YES' },
  { Campaign: 'C.Keyword.Video.SB.UPS.PFCSinewave.CPPFC(1)',                        Format: 'Video',    Headline: '',                                                    'Featured ASINs': 'B00429N19W',                               Status: 'PENDING_MODERATION_REVIEW', 'Needs Headline?': '⚠ YES' },
  { Campaign: 'N.Keyword.Products.SB.UPS.1500units',                                Format: 'Products', Headline: 'Stay protected with battery backup from CyberPower', 'Featured ASINs': 'B00429N19W, B0BCMLLSHL, B0B354X985',      Status: 'PUBLISHED',                'Needs Headline?': 'No' },
  { Campaign: 'N.Keyword.Store.SB.UPS.StoreSpotlight',                              Format: 'Store',    Headline: 'Stay protected with battery backup from CyberPower', 'Featured ASINs': '—',                                        Status: 'PUBLISHED',                'Needs Headline?': 'No' },
  { Campaign: 'N.Keyword.Video.SB.PFCSinewave.CP1500PFCRM2U.B0B354X985',            Format: 'Video',    Headline: 'Stay protected with battery backup from CyberPower', 'Featured ASINs': 'B0B354X985',                               Status: 'PUBLISHED',                'Needs Headline?': 'No' },
  { Campaign: 'N.Keyword.Video.SB.UPS.2026.StoreSpotlight',                         Format: 'Video',    Headline: 'Stay protected with battery backup from CyberPower', 'Featured ASINs': 'B00429N19W, B0DCLJ8RZ9, B0BCMLLSHL',      Status: 'PUBLISHED',                'Needs Headline?': 'No' },
  { Campaign: 'N.Keyword.Video.SB.UPS.IntelligentLCD.CP1500AVRLCD3.B0BCMLLSHL',    Format: 'Video',    Headline: '',                                                    'Featured ASINs': 'B0BCMLLSHL',                               Status: 'PUBLISHED',                'Needs Headline?': '⚠ YES' },
  { Campaign: 'N.Keyword.Video.SB.UPS.PFCSinewave.2026.CP1500PFCLCD.B00429N19W',    Format: 'Video',    Headline: '',                                                    'Featured ASINs': 'B00429N19W',                               Status: 'PUBLISHED',                'Needs Headline?': '⚠ YES' },
  { Campaign: 'N.Keyword.Video.SB.UPS.PFCSinewave.CP1500PFCLCD.B00429N19W',         Format: 'Video',    Headline: 'Stay protected with battery backup from CyberPower', 'Featured ASINs': 'B00429N19W, B0B354X985, B00429N192',       Status: 'PUBLISHED',                'Needs Headline?': 'No' },
  { Campaign: 'N.Keyword.Video.SB.UPS.PFCSinewave.CPPFC(1)',                        Format: 'Video',    Headline: '',                                                    'Featured ASINs': 'B00429N19W',                               Status: 'PENDING_MODERATION_REVIEW', 'Needs Headline?': '⚠ YES' },
  { Campaign: 'N.Keyword.Video.SB.UPS.SmartAppLCD.OR.OR500LCRM1U',                 Format: 'Video',    Headline: '',                                                    'Featured ASINs': 'B000XJJN60',                               Status: 'PENDING_MODERATION_REVIEW', 'Needs Headline?': '⚠ YES' },
  { Campaign: 'N.Keyword.Video.SB.UPS.SmartAppSinewave.OLHD',                       Format: 'Video',    Headline: '',                                                    'Featured ASINs': 'B07TR6VTQ2',                               Status: 'PENDING_MODERATION_REVIEW', 'Needs Headline?': '⚠ YES' },
  { Campaign: 'N.Keyword.Video.SB.UPS.Surge.CSP',                                   Format: 'Video',    Headline: '',                                                    'Featured ASINs': 'B00K8ZMVZ4',                               Status: 'PENDING_MODERATION_REVIEW', 'Needs Headline?': '⚠ YES' },
  { Campaign: 'N.SB.Products.SB.UPS.AVR',                                           Format: 'Products', Headline: 'Stay protected with battery backup from CyberPower', 'Featured ASINs': 'B0BCMLLSHL, B0125HR2ZG, B0122YQDMK',      Status: 'PUBLISHED',                'Needs Headline?': 'No' },
  { Campaign: 'N.SB.Products.SB.UPS.Eco',                                           Format: 'Products', Headline: 'Stay protected with battery backup from CyberPower', 'Featured ASINs': 'B00DBAA696, B00DBAA33K, B00DBAAJQ6',      Status: 'PUBLISHED',                'Needs Headline?': 'No' },
  { Campaign: 'N.SB.Products.SB.UPS.PFC',                                           Format: 'Products', Headline: 'Stay protected with battery backup from CyberPower', 'Featured ASINs': 'B00429N19W, B0B354X985',                  Status: 'PUBLISHED',                'Needs Headline?': 'No' },
  { Campaign: 'N.SB.Products.SB.UPS.PFCRM',                                         Format: 'Products', Headline: 'Protect your business with CyberPower',              'Featured ASINs': 'B0B354X985, B0DCLJ8RZ9, B003OJAHW0',      Status: 'PUBLISHED',                'Needs Headline?': 'No' },
];

const sdRows = [
  { Campaign: 'C.SD.Product.UPS.Ecologic.EC850LCD.B00DBAA696',                    'Creative Type': 'IMAGE', Headline: '', 'Needs Headline?': '⚠ YES' },
  { Campaign: 'C.Keyword.Consumer.SD.UPS.PFCSineWave.CP1500PFCRM2U.B0B354X985',   'Creative Type': 'IMAGE', Headline: '', 'Needs Headline?': '⚠ YES' },
  { Campaign: 'C.SD.Keyword.UPS.IntelligentLCD.CP1500AVRLCD3.B0BCMLLSHL',         'Creative Type': 'IMAGE', Headline: '', 'Needs Headline?': '⚠ YES' },
  { Campaign: 'C.Product.Consumer.SP.UPS.PFCSineWave.CP1500PFCRM2U.B0B354X985',   'Creative Type': 'IMAGE', Headline: '', 'Needs Headline?': '⚠ YES' },
  { Campaign: 'C.SD.Product.UPS.SmartAppLCD.B000XJLLKG.OR700LCDRM1U',             'Creative Type': 'IMAGE', Headline: '', 'Needs Headline?': '⚠ YES' },
  { Campaign: 'C.SD.Product.UPS.IntelligentLCD.CP1500AVRLCD3.B0BCMLLSHL',         'Creative Type': 'IMAGE', Headline: '', 'Needs Headline?': '⚠ YES' },
  { Campaign: 'C.SD.Product.UPS.SmartAppOnline.B07TR6VTQ2.OL5KRTHD',              'Creative Type': 'IMAGE', Headline: '', 'Needs Headline?': '⚠ YES' },
  { Campaign: 'C.SD.Product.UPS.PFCSinewave.CP1500PFCLCD.B00429N19W',             'Creative Type': 'IMAGE', Headline: '', 'Needs Headline?': '⚠ YES' },
];

// Build workbook
const wb = XLSX.utils.book_new();

// Sheet 1: Sponsored Brands
const sbWs = XLSX.utils.json_to_sheet(sbRows);
// Column widths
sbWs['!cols'] = [
  { wch: 60 }, // Campaign
  { wch: 10 }, // Format
  { wch: 55 }, // Headline
  { wch: 35 }, // Featured ASINs
  { wch: 26 }, // Status
  { wch: 22 }, // Needs Headline?
];
XLSX.utils.book_append_sheet(wb, sbWs, 'Sponsored Brands');

// Sheet 2: Sponsored Display
const sdWs = XLSX.utils.json_to_sheet(sdRows);
sdWs['!cols'] = [
  { wch: 60 }, // Campaign
  { wch: 14 }, // Creative Type
  { wch: 40 }, // Headline
  { wch: 22 }, // Needs Headline?
];
XLSX.utils.book_append_sheet(wb, sdWs, 'Sponsored Display');

// Summary sheet
const summaryData = [
  { Metric: 'Report Date',                         Value: new Date().toISOString().split('T')[0] },
  { Metric: 'Client',                              Value: 'CyberPower US' },
  { Metric: 'Total SB Campaigns',                  Value: sbRows.length },
  { Metric: 'SB - Has Headline',                   Value: sbRows.filter(r => r.Headline).length },
  { Metric: 'SB - Missing Headline (action needed)', Value: sbRows.filter(r => r['Needs Headline?'] === '⚠ YES').length },
  { Metric: 'SB - Typo in Headline',               Value: sbRows.filter(r => r['Needs Headline?'].includes('TYPO')).length },
  { Metric: 'Headline: "Stay protected with battery backup from CyberPower"', Value: sbRows.filter(r => r.Headline === 'Stay protected with battery backup from CyberPower').length },
  { Metric: 'Headline: "Protect your business with CyberPower"',              Value: sbRows.filter(r => r.Headline === 'Protect your business with CyberPower').length },
  { Metric: 'Total SD Campaigns',                  Value: sdRows.length },
  { Metric: 'SD - Missing Headline (action needed)', Value: sdRows.length },
];
const sumWs = XLSX.utils.json_to_sheet(summaryData);
sumWs['!cols'] = [{ wch: 50 }, { wch: 20 }];
XLSX.utils.book_append_sheet(wb, sumWs, 'Summary');

// Write to temp file
const tmpPath = '/tmp/cyberpower-sb-sd-creatives.xlsx';
XLSX.writeFile(wb, tmpPath);
const fileBuffer = fs.readFileSync(tmpPath);
const base64 = fileBuffer.toString('base64');

(async () => {
  const r = await resend.emails.send({
    from: 'Ash at Calbridge <ash@teamcalbridge.com>',
    to: 'abe@teamcalbridge.com',
    subject: 'CyberPower — SB & SD Headlines by Campaign (Excel)',
    html: `<p>Hi Abe,</p>
<p>Attached is the CyberPower SB &amp; SD creative report as an Excel file.</p>
<ul>
  <li><strong>Sponsored Brands tab:</strong> all 39 campaigns with headline, format, ASINs, status, and action flag</li>
  <li><strong>Sponsored Display tab:</strong> all 8 SD campaigns — all missing custom headlines</li>
  <li><strong>Summary tab:</strong> counts at a glance</li>
</ul>
<p>Key actions: <strong>${sbRows.filter(r => r['Needs Headline?'] === '⚠ YES').length} SB campaigns</strong> need headlines added + <strong>1 typo</strong> (lowercase "Cyberpower") needs correcting + <strong>8 SD campaigns</strong> should get custom headlines.</p>
<p>— Ash</p>`,
    attachments: [
      {
        filename: 'CyberPower-SB-SD-Creatives-' + new Date().toISOString().split('T')[0] + '.xlsx',
        content: base64,
      }
    ],
  });
  console.log('Sent:', JSON.stringify(r.data));
  fs.unlinkSync(tmpPath);
})();
