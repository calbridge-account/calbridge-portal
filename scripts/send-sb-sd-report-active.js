require('dotenv').config();
const XLSX = require('xlsx');
const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);
const fs = require('fs');

// All 39 campaigns with end dates from API
// Active = end date after 2025-12-31 (null end date = no expiry = active)
const allCampaigns = [
  { id: '209147373785811', name: 'N.Keyword.Video.SB.UPS.PFCSinewave.CPPFC(1)',             end: '2025-12-31', state: 'PAUSED' },
  { id: '38757712528936',  name: 'B.Keyword.Video.SB.UPS.PFCSinewave.CPPFC(1)',             end: '2025-12-31', state: 'PAUSED' },
  { id: '60249080858733',  name: 'C.Keyword.Video.SB.UPS.PFCSinewave.CPPFC(1)',             end: '2025-12-31', state: 'PAUSED' },
  { id: '249902179030051', name: 'N.Keyword.Video.SB.UPS.Surge.CSP',                        end: '2025-12-31', state: 'PAUSED' },
  { id: '74868404430193',  name: 'N.Keyword.Video.SB.UPS.SmartAppLCD.OR.OR500LCRM1U',      end: '2025-12-31', state: 'PAUSED' },
  { id: '85546644235770',  name: 'C.Keyword.Video.SB.UPS.IntelligentLCD.CPAVR3',           end: '2025-12-31', state: 'PAUSED' },
  { id: '84817009251939',  name: 'C.Keyword.Video.SB.PFCSinewave.CP1500PFCRM2U.B0B354X985', end: '2025-12-31', state: 'ENABLED' },
  { id: '112828660396406', name: 'N.Keyword.Video.SB.UPS.SmartAppSinewave.OLHD',            end: '2025-12-31', state: 'PAUSED' },
  { id: '400654489506156', name: 'B.Keyword.Products.SB.UPS.BestSellers',                   end: '2025-12-31', state: 'PAUSED' },
  { id: '300358990869228', name: 'B.Keyword.Store.SB.UPS.StoreSpotlight',                   end: '2025-12-31', state: 'ENABLED' },
  { id: '327967099369911', name: 'N.Keyword.Products.SB.UPS.1500units',                     end: '2025-12-31', state: 'PAUSED' },
  { id: '425328024590643', name: 'C.Keyword.Products.SB.UPS.1500units',                     end: '2025-12-31', state: 'ENABLED' },
  { id: '533624646611887', name: 'C.Keyword.Store.SB.UPS.StoreSpotlight',                   end: '2025-12-31', state: 'PAUSED' },
  { id: '516203922618177', name: 'N.Keyword.Store.SB.UPS.StoreSpotlight',                   end: '2025-12-31', state: 'ENABLED' },
  { id: '369323377946560', name: 'B2B - N.Keyword.Store.SB.UPS.StoreSpotlight',             end: '2025-12-31', state: 'ENABLED' },
  { id: '450441693358033', name: 'B2B - B.Keyword.Products.SB.UPS.1500units',               end: '2025-12-31', state: 'ENABLED' },
  { id: '353873361287335', name: 'B2B - B.Keyword.Store.SB.UPS.StoreSpotlight',             end: '2025-12-31', state: 'ENABLED' },
  { id: '288898439745613', name: 'B2B - N.Keyword.Products.SB.UPS.1500units',               end: '2025-12-31', state: 'ENABLED' },
  { id: '456008348744441', name: 'N.SB.Products.SB.UPS.PFC',                                end: '2025-12-31', state: 'PAUSED' },
  { id: '501138070676838', name: 'N.SB.Products.SB.UPS.AVR',                                end: '2025-12-31', state: 'PAUSED' },
  { id: '367333782614376', name: 'N.SB.Products.SB.UPS.PFCRM',                              end: '2025-12-31', state: 'PAUSED' },
  { id: '533553529526025', name: 'N.Keyword.Video.SB.PFCSinewave.CP1500PFCRM2U.B0B354X985', end: '2025-12-31', state: 'PAUSED' },
  { id: '495634510759677', name: 'B.Keyword.Video.SB.PFCSinewave.CP1500PFCRM2U.B0B354X985', end: '2025-12-31', state: 'PAUSED' },
  { id: '504590116611528', name: 'C.Keyword.Video.SB.PFCSinewave.CP1500PFCRM2U.B0B354X985_v2', end: '2025-12-31', state: 'PAUSED' },
  { id: '452338404496050', name: 'B.SB.Products.SB.UPS.PFC',                                end: '2025-12-31', state: 'PAUSED' },
  { id: '335733425531216', name: 'N.Keyword.Video.SB.UPS.PFCSinewave.CP1500PFCLCD.B00429N19W', end: '2025-12-31', state: 'ENABLED' },
  { id: '293529288726869', name: 'B.Keyword.Video.SB.UPS.PFCSinewave.CP1500PFCLCD.B00429N19W', end: '2025-12-31', state: 'ENABLED' },
  { id: '349078398145277', name: 'N.SB.Products.SB.UPS.Eco',                                end: '2025-12-31', state: 'PAUSED' },
  { id: '501364882562485', name: 'C.Keyword.Video.SB.UPS.IntelligentLCD.CP1500AVRLCD3.B0BCMLLSHL', end: '2025-12-31', state: 'ENABLED' },
  { id: '490434522578484', name: 'C.Keyword.Video.SB.UPS.PFCSinewave.CP1500PFCLCD.B00429N19W', end: '2025-12-31', state: 'ENABLED' },
  { id: '362619829731385', name: 'B.Keyword.Video.SB.UPS.IntelligentLCD.CP1500AVRLCD3.B0BCMLLSHL', end: '2025-12-31', state: 'ENABLED' },
  { id: '438623516658807', name: 'N.Keyword.Video.SB.UPS.IntelligentLCD.CP1500AVRLCD3.B0BCMLLSHL', end: '2025-12-31', state: 'PAUSED' },
  { id: '517243732232070', name: 'B.RSOV.Products.SB.UPS.1500units',                        end: '2025-12-31', state: 'ENABLED' },
  // 2026 campaigns — no end date = no expiry
  { id: '436092719312252', name: 'B.Keyword.Video.SB.UPS.2026.StoreSpotlight',              end: null, state: 'ENABLED' },
  { id: '410331745640501', name: 'N.Keyword.Video.SB.UPS.2026.StoreSpotlight',              end: null, state: 'ENABLED' },
  { id: '520121709405886', name: 'C.Keyword.Video.SB.PFCSinewave.2026.CP1500PFCLCD',        end: null, state: 'ENABLED' },
  { id: '298664655817372', name: 'C.Keyword.Video.SB.PFCSinewave.2026.CP1500AVRLCD3',       end: null, state: 'ENABLED' },
  { id: '496257674867474', name: 'N.Keyword.Video.SB.UPS.PFCSinewave.2026.CP1500PFCLCD.B00429N19W', end: null, state: 'ENABLED' },
  { id: '422752340317837', name: 'B.Keyword.Store.SB.UPS.2026.StoreSpotlight',              end: null, state: 'ENABLED' },
];

// Creative data from earlier pull
const creativeMap = {
  'B.Keyword.Products.SB.UPS.BestSellers':                              { format: 'Products', headline: 'Stay protected with battery backup from CyberPower', asins: 'B00429N19W, B00DBAA696',           cStatus: 'PUBLISHED' },
  'B.Keyword.Store.SB.UPS.2026.StoreSpotlight':                         { format: 'Store',    headline: 'Stay protected with battery backup from CyberPower', asins: '—',                               cStatus: 'PUBLISHED' },
  'B.Keyword.Store.SB.UPS.StoreSpotlight':                              { format: 'Store',    headline: 'Stay protected with battery backup from Cyberpower', asins: '—',                               cStatus: 'PUBLISHED' },
  'B.Keyword.Video.SB.UPS.IntelligentLCD.CP1500AVRLCD3.B0BCMLLSHL':    { format: 'Video',    headline: '',                                                   asins: 'B0BCMLLSHL',                      cStatus: 'PUBLISHED' },
  'B.Keyword.Video.SB.UPS.PFCSinewave.CP1500PFCLCD.B00429N19W':         { format: 'Video',    headline: 'Stay protected with battery backup from CyberPower', asins: 'B00429N19W, B0B354X985',          cStatus: 'PUBLISHED' },
  'B.Keyword.Video.SB.UPS.PFCSinewave.CPPFC(1)':                        { format: 'Video',    headline: '',                                                   asins: 'B00429N19W',                      cStatus: 'PENDING_MODERATION_REVIEW' },
  'B.Keyword.Video.SB.PFCSinewave.CP1500PFCRM2U.B0B354X985':            { format: 'Video',    headline: 'Stay protected with battery backup from CyberPower', asins: 'B0B354X985',                      cStatus: 'PUBLISHED' },
  'B.RSOV.Products.SB.UPS.1500units':                                   { format: 'Products', headline: 'Stay protected with battery backup from CyberPower', asins: 'B00429N19W, B0BCMLLSHL, B0B354X985', cStatus: 'PUBLISHED' },
  'B.SB.Products.SB.UPS.PFC':                                           { format: 'Products', headline: 'Stay protected with battery backup from CyberPower', asins: 'B00429N19W, B0B354X985',          cStatus: 'PUBLISHED' },
  'B2B - B.Keyword.Products.SB.UPS.1500units':                          { format: 'Products', headline: 'Stay protected with battery backup from CyberPower', asins: 'B0B354X985, B00429N19W, B01615H29O', cStatus: 'PUBLISHED' },
  'B2B - B.Keyword.Store.SB.UPS.StoreSpotlight':                        { format: 'Store',    headline: 'Stay protected with battery backup from CyberPower', asins: '—',                               cStatus: 'PUBLISHED' },
  'B2B - N.Keyword.Products.SB.UPS.1500units':                          { format: 'Products', headline: 'Stay protected with battery backup from CyberPower', asins: 'B0B354X985, B00429N19W, B01615H29O', cStatus: 'PUBLISHED' },
  'B2B - N.Keyword.Store.SB.UPS.StoreSpotlight':                        { format: 'Store',    headline: 'Stay protected with battery backup from CyberPower', asins: '—',                               cStatus: 'PUBLISHED' },
  'C.Keyword.Products.SB.UPS.1500units':                                { format: 'Products', headline: 'Stay protected with battery backup from CyberPower', asins: 'B00429N19W, B0BCMLLSHL, B00DBAA696', cStatus: 'PUBLISHED' },
  'C.Keyword.Store.SB.UPS.StoreSpotlight':                              { format: 'Store',    headline: 'Stay protected with battery backup from CyberPower', asins: '—',                               cStatus: 'PUBLISHED' },
  'C.Keyword.Video.SB.PFCSinewave.2026.CP1500AVRLCD3':                  { format: 'Video',    headline: '',                                                   asins: 'B0BCMLLSHL',                      cStatus: 'PUBLISHED' },
  'C.Keyword.Video.SB.PFCSinewave.2026.CP1500PFCLCD':                   { format: 'Video',    headline: '',                                                   asins: 'B00429N19W',                      cStatus: 'PUBLISHED' },
  'C.Keyword.Video.SB.PFCSinewave.CP1500PFCRM2U.B0B354X985_v2':         { format: 'Video',    headline: 'Stay protected with battery backup from CyberPower', asins: 'B0B354X985',                      cStatus: 'PUBLISHED' },
  'C.Keyword.Video.SB.UPS.IntelligentLCD.CP1500AVRLCD3.B0BCMLLSHL':    { format: 'Video',    headline: '',                                                   asins: 'B0BCMLLSHL',                      cStatus: 'PUBLISHED' },
  'C.Keyword.Video.SB.UPS.IntelligentLCD.CPAVR3':                       { format: 'Video',    headline: '',                                                   asins: 'B0BCMLLSHL',                      cStatus: 'PUBLISHED' },
  'C.Keyword.Video.SB.UPS.PFCSinewave.CP1500PFCLCD.B00429N19W':         { format: 'Video',    headline: 'Stay protected with battery backup from CyberPower', asins: 'B00429N19W',                      cStatus: 'PUBLISHED' },
  'C.Keyword.Video.SB.UPS.PFCSinewave.CP1500PFCRM2U.B0B354X985':        { format: 'Video',    headline: '',                                                   asins: 'B0B354X985',                      cStatus: 'PUBLISHED' },
  'C.Keyword.Video.SB.UPS.PFCSinewave.CPPFC(1)':                        { format: 'Video',    headline: '',                                                   asins: 'B00429N19W',                      cStatus: 'PENDING_MODERATION_REVIEW' },
  'N.Keyword.Products.SB.UPS.1500units':                                { format: 'Products', headline: 'Stay protected with battery backup from CyberPower', asins: 'B00429N19W, B0BCMLLSHL, B0B354X985', cStatus: 'PUBLISHED' },
  'N.Keyword.Store.SB.UPS.StoreSpotlight':                              { format: 'Store',    headline: 'Stay protected with battery backup from CyberPower', asins: '—',                               cStatus: 'PUBLISHED' },
  'N.Keyword.Video.SB.PFCSinewave.CP1500PFCRM2U.B0B354X985':            { format: 'Video',    headline: 'Stay protected with battery backup from CyberPower', asins: 'B0B354X985',                      cStatus: 'PUBLISHED' },
  'N.Keyword.Video.SB.UPS.2026.StoreSpotlight':                         { format: 'Video',    headline: 'Stay protected with battery backup from CyberPower', asins: 'B00429N19W, B0DCLJ8RZ9, B0BCMLLSHL', cStatus: 'PUBLISHED' },
  'N.Keyword.Video.SB.UPS.IntelligentLCD.CP1500AVRLCD3.B0BCMLLSHL':    { format: 'Video',    headline: '',                                                   asins: 'B0BCMLLSHL',                      cStatus: 'PUBLISHED' },
  'N.Keyword.Video.SB.UPS.PFCSinewave.2026.CP1500PFCLCD.B00429N19W':    { format: 'Video',    headline: '',                                                   asins: 'B00429N19W',                      cStatus: 'PUBLISHED' },
  'N.Keyword.Video.SB.UPS.PFCSinewave.CP1500PFCLCD.B00429N19W':         { format: 'Video',    headline: 'Stay protected with battery backup from CyberPower', asins: 'B00429N19W, B0B354X985, B00429N192', cStatus: 'PUBLISHED' },
  'N.Keyword.Video.SB.UPS.PFCSinewave.CPPFC(1)':                        { format: 'Video',    headline: '',                                                   asins: 'B00429N19W',                      cStatus: 'PENDING_MODERATION_REVIEW' },
  'N.Keyword.Video.SB.UPS.SmartAppLCD.OR.OR500LCRM1U':                 { format: 'Video',    headline: '',                                                   asins: 'B000XJJN60',                      cStatus: 'PENDING_MODERATION_REVIEW' },
  'N.Keyword.Video.SB.UPS.SmartAppSinewave.OLHD':                       { format: 'Video',    headline: '',                                                   asins: 'B07TR6VTQ2',                      cStatus: 'PENDING_MODERATION_REVIEW' },
  'N.Keyword.Video.SB.UPS.Surge.CSP':                                   { format: 'Video',    headline: '',                                                   asins: 'B00K8ZMVZ4',                      cStatus: 'PENDING_MODERATION_REVIEW' },
  'N.SB.Products.SB.UPS.AVR':                                           { format: 'Products', headline: 'Stay protected with battery backup from CyberPower', asins: 'B0BCMLLSHL, B0125HR2ZG, B0122YQDMK', cStatus: 'PUBLISHED' },
  'N.SB.Products.SB.UPS.Eco':                                           { format: 'Products', headline: 'Stay protected with battery backup from CyberPower', asins: 'B00DBAA696, B00DBAA33K, B00DBAAJQ6', cStatus: 'PUBLISHED' },
  'N.SB.Products.SB.UPS.PFC':                                           { format: 'Products', headline: 'Stay protected with battery backup from CyberPower', asins: 'B00429N19W, B0B354X985',          cStatus: 'PUBLISHED' },
  'N.SB.Products.SB.UPS.PFCRM':                                         { format: 'Products', headline: 'Protect your business with CyberPower',              asins: 'B0B354X985, B0DCLJ8RZ9, B003OJAHW0', cStatus: 'PUBLISHED' },
};

// Filter: active = end date after 2025-12-31 OR no end date
const cutoff = new Date('2025-12-31');
const activeCampaigns = allCampaigns.filter(c => {
  if (!c.end) return true; // no end date = ongoing
  return new Date(c.end) > cutoff;
});

console.log('Active campaigns (after 12/31/2025):', activeCampaigns.length);
console.log('Filtered out (expired):', allCampaigns.length - activeCampaigns.length);

function needsHeadline(format, headline) {
  return (format === 'Video' || format === 'Products') && !headline;
}

const sbRows = activeCampaigns.map(c => {
  const cr = creativeMap[c.name] || { format: 'Unknown', headline: '', asins: '—', cStatus: '—' };
  let flag = 'No';
  if (!cr.headline && cr.name && cr.name.includes('Cyberpower')) flag = '⚠ TYPO (lowercase p)';
  else if (cr.headline === 'Stay protected with battery backup from Cyberpower') flag = '⚠ TYPO (lowercase p)';
  else if (needsHeadline(cr.format, cr.headline)) flag = '⚠ YES';
  return {
    Campaign:         c.name,
    Format:           cr.format,
    'Campaign State': c.state,
    'Start Date':     c.end ? (allCampaigns.find(x=>x.id===c.id)?.id ? c.end.replace('2025-12-31','(see end date)') : '') : '',
    'End Date':       c.end || '(no end date)',
    Headline:         cr.headline || '',
    'Featured ASINs': cr.asins,
    'Creative Status': cr.cStatus,
    'Needs Headline?': flag,
  };
});

// Fix end date display
activeCampaigns.forEach((c, i) => {
  sbRows[i]['End Date'] = c.end || '(no end date)';
});

const wb = XLSX.utils.book_new();

const sbWs = XLSX.utils.json_to_sheet(sbRows);
sbWs['!cols'] = [
  { wch: 62 }, // Campaign
  { wch: 10 }, // Format
  { wch: 14 }, // Campaign State
  { wch: 12 }, // Start Date
  { wch: 16 }, // End Date
  { wch: 52 }, // Headline
  { wch: 35 }, // Featured ASINs
  { wch: 22 }, // Creative Status
  { wch: 22 }, // Needs Headline?
];
XLSX.utils.book_append_sheet(wb, sbWs, 'Sponsored Brands (Active)');

// SD rows — all 8 are active (no end dates)
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
const sdWs = XLSX.utils.json_to_sheet(sdRows);
sdWs['!cols'] = [{ wch: 62 }, { wch: 14 }, { wch: 40 }, { wch: 22 }];
XLSX.utils.book_append_sheet(wb, sdWs, 'Sponsored Display (Active)');

const needsAction = sbRows.filter(r => r['Needs Headline?'] !== 'No');
const summaryData = [
  { Metric: 'Report Date',                          Value: new Date().toISOString().split('T')[0] },
  { Metric: 'Client',                               Value: 'CyberPower US' },
  { Metric: 'Total SB campaigns pulled',            Value: allCampaigns.length },
  { Metric: 'Expired (end date ≤ 12/31/2025)',      Value: allCampaigns.length - activeCampaigns.length },
  { Metric: 'Active SB campaigns in this report',   Value: activeCampaigns.length },
  { Metric: 'SB - Has headline',                    Value: sbRows.filter(r => r.Headline).length },
  { Metric: 'SB - Missing headline (action needed)',Value: needsAction.filter(r => r['Needs Headline?'] === '⚠ YES').length },
  { Metric: 'SB - Typo in headline',                Value: needsAction.filter(r => r['Needs Headline?'].includes('TYPO')).length },
  { Metric: 'Active SD campaigns',                  Value: sdRows.length },
  { Metric: 'SD - Missing headline (action needed)', Value: sdRows.length },
];
const sumWs = XLSX.utils.json_to_sheet(summaryData);
sumWs['!cols'] = [{ wch: 45 }, { wch: 15 }];
XLSX.utils.book_append_sheet(wb, sumWs, 'Summary');

const tmpPath = '/tmp/cyberpower-sb-sd-active.xlsx';
XLSX.writeFile(wb, tmpPath);
const base64 = fs.readFileSync(tmpPath).toString('base64');

(async () => {
  const r = await resend.emails.send({
    from: 'Ash at Calbridge <ash@teamcalbridge.com>',
    to: 'abe@teamcalbridge.com',
    subject: 'CyberPower — SB & SD Headlines (Active campaigns only)',
    html: `<p>Hi Abe,</p>
<p>Updated Excel attached — filtered to <strong>active campaigns only</strong> (end date after 12/31/2025 or no end date).</p>
<ul>
  <li><strong>${activeCampaigns.length} of 39 SB campaigns</strong> are active (${allCampaigns.length - activeCampaigns.length} excluded — all had end date of 12/31/2025)</li>
  <li><strong>All 8 SD campaigns</strong> are active (no end dates set)</li>
  <li><strong>${needsAction.filter(r => r['Needs Headline?'] === '⚠ YES').length} SB campaigns</strong> need headlines + <strong>1 typo</strong> to fix</li>
</ul>
<p>— Ash</p>`,
    attachments: [{
      filename: `CyberPower-SB-SD-Active-${new Date().toISOString().split('T')[0]}.xlsx`,
      content: base64,
    }],
  });
  console.log('Active campaigns:', activeCampaigns.length, '| Filtered out:', allCampaigns.length - activeCampaigns.length);
  console.log('Sent:', JSON.stringify(r.data));
  fs.unlinkSync(tmpPath);
})();
