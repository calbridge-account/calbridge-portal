require('dotenv').config();
const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);

const sbRows = [
  { campaign: 'B.Keyword.Products.SB.UPS.BestSellers',                              headline: 'Stay protected with battery backup from CyberPower', status: 'PUBLISHED',                asins: 'B00429N19W, B00DBAA696' },
  { campaign: 'B.Keyword.Store.SB.UPS.2026.StoreSpotlight',                         headline: 'Stay protected with battery backup from CyberPower', status: 'PUBLISHED',                asins: '—' },
  { campaign: 'B.Keyword.Store.SB.UPS.StoreSpotlight',                              headline: 'Stay protected with battery backup from Cyberpower ⚠️', status: 'PUBLISHED',             asins: '—' },
  { campaign: 'B.Keyword.Video.SB.UPS.IntelligentLCD.CP1500AVRLCD3.B0BCMLLSHL',    headline: '(none)',                                              status: 'PUBLISHED',                asins: 'B0BCMLLSHL' },
  { campaign: 'B.Keyword.Video.SB.UPS.PFCSinewave.CP1500PFCLCD.B00429N19W',         headline: 'Stay protected with battery backup from CyberPower', status: 'PUBLISHED',                asins: 'B00429N19W, B0B354X985' },
  { campaign: 'B.Keyword.Video.SB.UPS.PFCSinewave.CPPFC(1)',                        headline: '(none)',                                              status: 'PENDING_MODERATION_REVIEW', asins: 'B00429N19W' },
  { campaign: 'B.Keyword.Video.SB.PFCSinewave.CP1500PFCRM2U.B0B354X985',            headline: 'Stay protected with battery backup from CyberPower', status: 'PUBLISHED',                asins: 'B0B354X985' },
  { campaign: 'B.RSOV.Products.SB.UPS.1500units',                                   headline: 'Stay protected with battery backup from CyberPower', status: 'PUBLISHED',                asins: 'B00429N19W, B0BCMLLSHL, B0B354X985' },
  { campaign: 'B.SB.Products.SB.UPS.PFC',                                           headline: 'Stay protected with battery backup from CyberPower', status: 'PUBLISHED',                asins: 'B00429N19W, B0B354X985' },
  { campaign: 'B2B - B.Keyword.Products.SB.UPS.1500units',                          headline: 'Stay protected with battery backup from CyberPower', status: 'PUBLISHED',                asins: 'B0B354X985, B00429N19W, B01615H29O' },
  { campaign: 'B2B - B.Keyword.Store.SB.UPS.StoreSpotlight',                        headline: 'Stay protected with battery backup from CyberPower', status: 'PUBLISHED',                asins: '—' },
  { campaign: 'B2B - N.Keyword.Products.SB.UPS.1500units',                          headline: 'Stay protected with battery backup from CyberPower', status: 'PUBLISHED',                asins: 'B0B354X985, B00429N19W, B01615H29O' },
  { campaign: 'B2B - N.Keyword.Store.SB.UPS.StoreSpotlight',                        headline: 'Stay protected with battery backup from CyberPower', status: 'PUBLISHED',                asins: '—' },
  { campaign: 'C.Keyword.Products.SB.UPS.1500units',                                headline: 'Stay protected with battery backup from CyberPower', status: 'PUBLISHED',                asins: 'B00429N19W, B0BCMLLSHL, B00DBAA696' },
  { campaign: 'C.Keyword.Store.SB.UPS.StoreSpotlight',                              headline: 'Stay protected with battery backup from CyberPower', status: 'PUBLISHED',                asins: '—' },
  { campaign: 'C.Keyword.Video.SB.PFCSinewave.2026.CP1500AVRLCD3',                  headline: '(none)',                                              status: 'PUBLISHED',                asins: 'B0BCMLLSHL' },
  { campaign: 'C.Keyword.Video.SB.PFCSinewave.2026.CP1500PFCLCD',                   headline: '(none)',                                              status: 'PUBLISHED',                asins: 'B00429N19W' },
  { campaign: 'C.Keyword.Video.SB.PFCSinewave.CP1500PFCRM2U.B0B354X985_v2',         headline: 'Stay protected with battery backup from CyberPower', status: 'PUBLISHED',                asins: 'B0B354X985' },
  { campaign: 'C.Keyword.Video.SB.UPS.IntelligentLCD.CP1500AVRLCD3.B0BCMLLSHL',    headline: '(none)',                                              status: 'PUBLISHED',                asins: 'B0BCMLLSHL' },
  { campaign: 'C.Keyword.Video.SB.UPS.IntelligentLCD.CPAVR3',                       headline: '(none)',                                              status: 'PUBLISHED',                asins: 'B0BCMLLSHL' },
  { campaign: 'C.Keyword.Video.SB.UPS.PFCSinewave.CP1500PFCLCD.B00429N19W',         headline: 'Stay protected with battery backup from CyberPower', status: 'PUBLISHED',                asins: 'B00429N19W' },
  { campaign: 'C.Keyword.Video.SB.UPS.PFCSinewave.CP1500PFCRM2U.B0B354X985',        headline: '(none)',                                              status: 'PUBLISHED',                asins: 'B0B354X985' },
  { campaign: 'C.Keyword.Video.SB.UPS.PFCSinewave.CPPFC(1)',                        headline: '(none)',                                              status: 'PENDING_MODERATION_REVIEW', asins: 'B00429N19W' },
  { campaign: 'N.Keyword.Products.SB.UPS.1500units',                                headline: 'Stay protected with battery backup from CyberPower', status: 'PUBLISHED',                asins: 'B00429N19W, B0BCMLLSHL, B0B354X985' },
  { campaign: 'N.Keyword.Store.SB.UPS.StoreSpotlight',                              headline: 'Stay protected with battery backup from CyberPower', status: 'PUBLISHED',                asins: '—' },
  { campaign: 'N.Keyword.Video.SB.PFCSinewave.CP1500PFCRM2U.B0B354X985',            headline: 'Stay protected with battery backup from CyberPower', status: 'PUBLISHED',                asins: 'B0B354X985' },
  { campaign: 'N.Keyword.Video.SB.UPS.2026.StoreSpotlight',                         headline: 'Stay protected with battery backup from CyberPower', status: 'PUBLISHED',                asins: 'B00429N19W, B0DCLJ8RZ9, B0BCMLLSHL' },
  { campaign: 'N.Keyword.Video.SB.UPS.IntelligentLCD.CP1500AVRLCD3.B0BCMLLSHL',    headline: '(none)',                                              status: 'PUBLISHED',                asins: 'B0BCMLLSHL' },
  { campaign: 'N.Keyword.Video.SB.UPS.PFCSinewave.2026.CP1500PFCLCD.B00429N19W',    headline: '(none)',                                              status: 'PUBLISHED',                asins: 'B00429N19W' },
  { campaign: 'N.Keyword.Video.SB.UPS.PFCSinewave.CP1500PFCLCD.B00429N19W',         headline: 'Stay protected with battery backup from CyberPower', status: 'PUBLISHED',                asins: 'B00429N19W, B0B354X985, B00429N192' },
  { campaign: 'N.Keyword.Video.SB.UPS.PFCSinewave.CPPFC(1)',                        headline: '(none)',                                              status: 'PENDING_MODERATION_REVIEW', asins: 'B00429N19W' },
  { campaign: 'N.Keyword.Video.SB.UPS.SmartAppLCD.OR.OR500LCRM1U',                 headline: '(none)',                                              status: 'PENDING_MODERATION_REVIEW', asins: 'B000XJJN60' },
  { campaign: 'N.Keyword.Video.SB.UPS.SmartAppSinewave.OLHD',                       headline: '(none)',                                              status: 'PENDING_MODERATION_REVIEW', asins: 'B07TR6VTQ2' },
  { campaign: 'N.Keyword.Video.SB.UPS.Surge.CSP',                                   headline: '(none)',                                              status: 'PENDING_MODERATION_REVIEW', asins: 'B00K8ZMVZ4' },
  { campaign: 'N.SB.Products.SB.UPS.AVR',                                           headline: 'Stay protected with battery backup from CyberPower', status: 'PUBLISHED',                asins: 'B0BCMLLSHL, B0125HR2ZG, B0122YQDMK' },
  { campaign: 'N.SB.Products.SB.UPS.Eco',                                           headline: 'Stay protected with battery backup from CyberPower', status: 'PUBLISHED',                asins: 'B00DBAA696, B00DBAA33K, B00DBAAJQ6' },
  { campaign: 'N.SB.Products.SB.UPS.PFC',                                           headline: 'Stay protected with battery backup from CyberPower', status: 'PUBLISHED',                asins: 'B00429N19W, B0B354X985' },
  { campaign: 'N.SB.Products.SB.UPS.PFCRM',                                         headline: 'Protect your business with CyberPower',              status: 'PUBLISHED',                asins: 'B0B354X985, B0DCLJ8RZ9, B003OJAHW0' },
];

const sdRows = [
  { campaign: 'C.SD.Product.UPS.Ecologic.EC850LCD.B00DBAA696',                    headline: '(none)', type: 'IMAGE' },
  { campaign: 'C.Keyword.Consumer.SD.UPS.PFCSineWave.CP1500PFCRM2U.B0B354X985',   headline: '(none)', type: 'IMAGE' },
  { campaign: 'C.SD.Keyword.UPS.IntelligentLCD.CP1500AVRLCD3.B0BCMLLSHL',         headline: '(none)', type: 'IMAGE' },
  { campaign: 'C.Product.Consumer.SP.UPS.PFCSineWave.CP1500PFCRM2U.B0B354X985',   headline: '(none)', type: 'IMAGE' },
  { campaign: 'C.SD.Product.UPS.SmartAppLCD.B000XJLLKG.OR700LCDRM1U',             headline: '(none)', type: 'IMAGE' },
  { campaign: 'C.SD.Product.UPS.IntelligentLCD.CP1500AVRLCD3.B0BCMLLSHL',         headline: '(none)', type: 'IMAGE' },
  { campaign: 'C.SD.Product.UPS.SmartAppOnline.B07TR6VTQ2.OL5KRTHD',              headline: '(none)', type: 'IMAGE' },
  { campaign: 'C.SD.Product.UPS.PFCSinewave.CP1500PFCLCD.B00429N19W',             headline: '(none)', type: 'IMAGE' },
];

function statusBadge(s) {
  if (s === 'PUBLISHED') return '<span style="background:#dcfce7;color:#166534;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;">PUBLISHED</span>';
  if (s === 'PENDING_MODERATION_REVIEW') return '<span style="background:#fef9c3;color:#854d0e;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;">PENDING REVIEW</span>';
  return '<span style="background:#f3f4f6;color:#374151;padding:2px 8px;border-radius:4px;font-size:11px;">' + s + '</span>';
}

const sbTableRows = sbRows.map(r => {
  const noHeadline = r.headline === '(none)';
  return `
  <tr style="border-bottom:1px solid #e5e7eb;">
    <td style="padding:8px 12px;font-size:12px;color:#111827;">${r.campaign}</td>
    <td style="padding:8px 12px;font-size:12px;color:${noHeadline ? '#9ca3af' : '#111827'};font-style:${noHeadline ? 'italic' : 'normal'};">${r.headline}</td>
    <td style="padding:8px 12px;font-size:11px;color:#6b7280;">${r.asins}</td>
    <td style="padding:8px 12px;">${statusBadge(r.status)}</td>
  </tr>`;
}).join('');

const sdTableRows = sdRows.map(r => `
  <tr style="border-bottom:1px solid #e5e7eb;">
    <td style="padding:8px 12px;font-size:12px;color:#111827;">${r.campaign}</td>
    <td style="padding:8px 12px;font-size:12px;color:#9ca3af;font-style:italic;">${r.headline}</td>
    <td style="padding:8px 12px;font-size:11px;color:#6b7280;">${r.type}</td>
    <td style="padding:8px 12px;"><span style="background:#f3f4f6;color:#374151;padding:2px 8px;border-radius:4px;font-size:11px;">—</span></td>
  </tr>`).join('');

const dateStr = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f9fafb;margin:0;padding:20px;">
  <div style="max-width:900px;margin:0 auto;background:#fff;border-radius:12px;border:1px solid #e5e7eb;overflow:hidden;">
    <div style="background:#1a2e1a;padding:24px 32px;">
      <img src="https://app.calbridge.ai/calbridge-logo.png" alt="Calbridge" style="height:32px;" />
      <p style="color:#86efac;margin:8px 0 0;font-size:13px;">CyberPower — SB &amp; SD Creative Report</p>
    </div>
    <div style="padding:32px;">
      <p style="color:#374151;font-size:14px;margin-top:0;">
        Pulled live from the Amazon Ads API on <strong>${dateStr}</strong>.
        Covers all enabled/paused SB and SD creatives for <strong>CyberPower US</strong>.
      </p>

      <h2 style="font-size:16px;color:#111827;margin:24px 0 12px;padding-bottom:8px;border-bottom:2px solid #e5e7eb;">
        🏷️ Sponsored Brands — Headlines (${sbRows.length} campaigns)
      </h2>
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;">
          <thead>
            <tr style="background:#f9fafb;">
              <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #e5e7eb;">Campaign</th>
              <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #e5e7eb;">Headline</th>
              <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #e5e7eb;">Featured ASINs</th>
              <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #e5e7eb;">Status</th>
            </tr>
          </thead>
          <tbody>${sbTableRows}</tbody>
        </table>
      </div>
      <div style="margin:16px 0;padding:16px;background:#f0fdf4;border-radius:8px;border:1px solid #bbf7d0;">
        <p style="margin:0;font-size:13px;color:#166534;">
          <strong>Headline summary:</strong>
          22 campaigns — <em>"Stay protected with battery backup from CyberPower"</em> &nbsp;|&nbsp;
          1 campaign — <em>"Protect your business with CyberPower"</em> &nbsp;|&nbsp;
          1 campaign — <em>"Stay protected with battery backup from Cyberpower"</em> <strong>(lowercase p — worth fixing)</strong> &nbsp;|&nbsp;
          15 campaigns have no headline (video / store spotlight format)
        </p>
      </div>

      <h2 style="font-size:16px;color:#111827;margin:32px 0 12px;padding-bottom:8px;border-bottom:2px solid #e5e7eb;">
        🖥️ Sponsored Display — Creatives (${sdRows.length} campaigns)
      </h2>
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;">
          <thead>
            <tr style="background:#f9fafb;">
              <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #e5e7eb;">Campaign</th>
              <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #e5e7eb;">Headline</th>
              <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #e5e7eb;">Type</th>
              <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #e5e7eb;">Status</th>
            </tr>
          </thead>
          <tbody>${sdTableRows}</tbody>
        </table>
      </div>
      <div style="margin:16px 0;padding:16px;background:#faf5ff;border-radius:8px;border:1px solid #e9d5ff;">
        <p style="margin:0;font-size:13px;color:#6b21a8;">
          <strong>SD note:</strong> All 8 SD creatives are IMAGE format with no custom headline. 
          SD image ads use Amazon-generated copy by default — adding custom headlines could improve CTR.
        </p>
      </div>

      <p style="font-size:12px;color:#9ca3af;margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;">
        Pulled by Ash · Calbridge · ${new Date().toISOString().split('T')[0]} · Data source: Amazon Advertising API (live)
      </p>
    </div>
  </div>
</body>
</html>`;

(async () => {
  const r = await resend.emails.send({
    from: 'Ash at Calbridge <ash@teamcalbridge.com>',
    to: 'abe@teamcalbridge.com',
    subject: 'CyberPower — SB & SD Headlines by Campaign',
    html,
  });
  console.log('Sent:', JSON.stringify(r.data));
})();
