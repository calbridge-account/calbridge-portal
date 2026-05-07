require('dotenv').config();
const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);

// SB rows — format inferred from campaign name
// Video = supports headline (action needed if missing)
// Store/StoreSpotlight = custom headline optional (store page shown instead)
// Products = supports headline (action needed if missing)
const sbRows = [
  { campaign: 'B.Keyword.Products.SB.UPS.BestSellers',                              format: 'Products', headline: 'Stay protected with battery backup from CyberPower', status: 'PUBLISHED',                asins: 'B00429N19W, B00DBAA696' },
  { campaign: 'B.Keyword.Store.SB.UPS.2026.StoreSpotlight',                         format: 'Store',    headline: 'Stay protected with battery backup from CyberPower', status: 'PUBLISHED',                asins: '—' },
  { campaign: 'B.Keyword.Store.SB.UPS.StoreSpotlight',                              format: 'Store',    headline: 'Stay protected with battery backup from Cyberpower ⚠️ typo', status: 'PUBLISHED',       asins: '—' },
  { campaign: 'B.Keyword.Video.SB.UPS.IntelligentLCD.CP1500AVRLCD3.B0BCMLLSHL',    format: 'Video',    headline: null, status: 'PUBLISHED',                asins: 'B0BCMLLSHL' },
  { campaign: 'B.Keyword.Video.SB.UPS.PFCSinewave.CP1500PFCLCD.B00429N19W',         format: 'Video',    headline: 'Stay protected with battery backup from CyberPower', status: 'PUBLISHED',                asins: 'B00429N19W, B0B354X985' },
  { campaign: 'B.Keyword.Video.SB.UPS.PFCSinewave.CPPFC(1)',                        format: 'Video',    headline: null, status: 'PENDING_MODERATION_REVIEW', asins: 'B00429N19W' },
  { campaign: 'B.Keyword.Video.SB.PFCSinewave.CP1500PFCRM2U.B0B354X985',            format: 'Video',    headline: 'Stay protected with battery backup from CyberPower', status: 'PUBLISHED',                asins: 'B0B354X985' },
  { campaign: 'B.RSOV.Products.SB.UPS.1500units',                                   format: 'Products', headline: 'Stay protected with battery backup from CyberPower', status: 'PUBLISHED',                asins: 'B00429N19W, B0BCMLLSHL, B0B354X985' },
  { campaign: 'B.SB.Products.SB.UPS.PFC',                                           format: 'Products', headline: 'Stay protected with battery backup from CyberPower', status: 'PUBLISHED',                asins: 'B00429N19W, B0B354X985' },
  { campaign: 'B2B - B.Keyword.Products.SB.UPS.1500units',                          format: 'Products', headline: 'Stay protected with battery backup from CyberPower', status: 'PUBLISHED',                asins: 'B0B354X985, B00429N19W, B01615H29O' },
  { campaign: 'B2B - B.Keyword.Store.SB.UPS.StoreSpotlight',                        format: 'Store',    headline: 'Stay protected with battery backup from CyberPower', status: 'PUBLISHED',                asins: '—' },
  { campaign: 'B2B - N.Keyword.Products.SB.UPS.1500units',                          format: 'Products', headline: 'Stay protected with battery backup from CyberPower', status: 'PUBLISHED',                asins: 'B0B354X985, B00429N19W, B01615H29O' },
  { campaign: 'B2B - N.Keyword.Store.SB.UPS.StoreSpotlight',                        format: 'Store',    headline: 'Stay protected with battery backup from CyberPower', status: 'PUBLISHED',                asins: '—' },
  { campaign: 'C.Keyword.Products.SB.UPS.1500units',                                format: 'Products', headline: 'Stay protected with battery backup from CyberPower', status: 'PUBLISHED',                asins: 'B00429N19W, B0BCMLLSHL, B00DBAA696' },
  { campaign: 'C.Keyword.Store.SB.UPS.StoreSpotlight',                              format: 'Store',    headline: 'Stay protected with battery backup from CyberPower', status: 'PUBLISHED',                asins: '—' },
  { campaign: 'C.Keyword.Video.SB.PFCSinewave.2026.CP1500AVRLCD3',                  format: 'Video',    headline: null, status: 'PUBLISHED',                asins: 'B0BCMLLSHL' },
  { campaign: 'C.Keyword.Video.SB.PFCSinewave.2026.CP1500PFCLCD',                   format: 'Video',    headline: null, status: 'PUBLISHED',                asins: 'B00429N19W' },
  { campaign: 'C.Keyword.Video.SB.PFCSinewave.CP1500PFCRM2U.B0B354X985_v2',         format: 'Video',    headline: 'Stay protected with battery backup from CyberPower', status: 'PUBLISHED',                asins: 'B0B354X985' },
  { campaign: 'C.Keyword.Video.SB.UPS.IntelligentLCD.CP1500AVRLCD3.B0BCMLLSHL',    format: 'Video',    headline: null, status: 'PUBLISHED',                asins: 'B0BCMLLSHL' },
  { campaign: 'C.Keyword.Video.SB.UPS.IntelligentLCD.CPAVR3',                       format: 'Video',    headline: null, status: 'PUBLISHED',                asins: 'B0BCMLLSHL' },
  { campaign: 'C.Keyword.Video.SB.UPS.PFCSinewave.CP1500PFCLCD.B00429N19W',         format: 'Video',    headline: 'Stay protected with battery backup from CyberPower', status: 'PUBLISHED',                asins: 'B00429N19W' },
  { campaign: 'C.Keyword.Video.SB.UPS.PFCSinewave.CP1500PFCRM2U.B0B354X985',        format: 'Video',    headline: null, status: 'PUBLISHED',                asins: 'B0B354X985' },
  { campaign: 'C.Keyword.Video.SB.UPS.PFCSinewave.CPPFC(1)',                        format: 'Video',    headline: null, status: 'PENDING_MODERATION_REVIEW', asins: 'B00429N19W' },
  { campaign: 'N.Keyword.Products.SB.UPS.1500units',                                format: 'Products', headline: 'Stay protected with battery backup from CyberPower', status: 'PUBLISHED',                asins: 'B00429N19W, B0BCMLLSHL, B0B354X985' },
  { campaign: 'N.Keyword.Store.SB.UPS.StoreSpotlight',                              format: 'Store',    headline: 'Stay protected with battery backup from CyberPower', status: 'PUBLISHED',                asins: '—' },
  { campaign: 'N.Keyword.Video.SB.PFCSinewave.CP1500PFCRM2U.B0B354X985',            format: 'Video',    headline: 'Stay protected with battery backup from CyberPower', status: 'PUBLISHED',                asins: 'B0B354X985' },
  { campaign: 'N.Keyword.Video.SB.UPS.2026.StoreSpotlight',                         format: 'Video',    headline: 'Stay protected with battery backup from CyberPower', status: 'PUBLISHED',                asins: 'B00429N19W, B0DCLJ8RZ9, B0BCMLLSHL' },
  { campaign: 'N.Keyword.Video.SB.UPS.IntelligentLCD.CP1500AVRLCD3.B0BCMLLSHL',    format: 'Video',    headline: null, status: 'PUBLISHED',                asins: 'B0BCMLLSHL' },
  { campaign: 'N.Keyword.Video.SB.UPS.PFCSinewave.2026.CP1500PFCLCD.B00429N19W',    format: 'Video',    headline: null, status: 'PUBLISHED',                asins: 'B00429N19W' },
  { campaign: 'N.Keyword.Video.SB.UPS.PFCSinewave.CP1500PFCLCD.B00429N19W',         format: 'Video',    headline: 'Stay protected with battery backup from CyberPower', status: 'PUBLISHED',                asins: 'B00429N19W, B0B354X985, B00429N192' },
  { campaign: 'N.Keyword.Video.SB.UPS.PFCSinewave.CPPFC(1)',                        format: 'Video',    headline: null, status: 'PENDING_MODERATION_REVIEW', asins: 'B00429N19W' },
  { campaign: 'N.Keyword.Video.SB.UPS.SmartAppLCD.OR.OR500LCRM1U',                 format: 'Video',    headline: null, status: 'PENDING_MODERATION_REVIEW', asins: 'B000XJJN60' },
  { campaign: 'N.Keyword.Video.SB.UPS.SmartAppSinewave.OLHD',                       format: 'Video',    headline: null, status: 'PENDING_MODERATION_REVIEW', asins: 'B07TR6VTQ2' },
  { campaign: 'N.Keyword.Video.SB.UPS.Surge.CSP',                                   format: 'Video',    headline: null, status: 'PENDING_MODERATION_REVIEW', asins: 'B00K8ZMVZ4' },
  { campaign: 'N.SB.Products.SB.UPS.AVR',                                           format: 'Products', headline: 'Stay protected with battery backup from CyberPower', status: 'PUBLISHED',                asins: 'B0BCMLLSHL, B0125HR2ZG, B0122YQDMK' },
  { campaign: 'N.SB.Products.SB.UPS.Eco',                                           format: 'Products', headline: 'Stay protected with battery backup from CyberPower', status: 'PUBLISHED',                asins: 'B00DBAA696, B00DBAA33K, B00DBAAJQ6' },
  { campaign: 'N.SB.Products.SB.UPS.PFC',                                           format: 'Products', headline: 'Stay protected with battery backup from CyberPower', status: 'PUBLISHED',                asins: 'B00429N19W, B0B354X985' },
  { campaign: 'N.SB.Products.SB.UPS.PFCRM',                                         format: 'Products', headline: 'Protect your business with CyberPower',              status: 'PUBLISHED',                asins: 'B0B354X985, B0DCLJ8RZ9, B003OJAHW0' },
];

const sdRows = [
  { campaign: 'C.SD.Product.UPS.Ecologic.EC850LCD.B00DBAA696',                    type: 'IMAGE' },
  { campaign: 'C.Keyword.Consumer.SD.UPS.PFCSineWave.CP1500PFCRM2U.B0B354X985',   type: 'IMAGE' },
  { campaign: 'C.SD.Keyword.UPS.IntelligentLCD.CP1500AVRLCD3.B0BCMLLSHL',         type: 'IMAGE' },
  { campaign: 'C.Product.Consumer.SP.UPS.PFCSineWave.CP1500PFCRM2U.B0B354X985',   type: 'IMAGE' },
  { campaign: 'C.SD.Product.UPS.SmartAppLCD.B000XJLLKG.OR700LCDRM1U',             type: 'IMAGE' },
  { campaign: 'C.SD.Product.UPS.IntelligentLCD.CP1500AVRLCD3.B0BCMLLSHL',         type: 'IMAGE' },
  { campaign: 'C.SD.Product.UPS.SmartAppOnline.B07TR6VTQ2.OL5KRTHD',              type: 'IMAGE' },
  { campaign: 'C.SD.Product.UPS.PFCSinewave.CP1500PFCLCD.B00429N19W',             type: 'IMAGE' },
];

// Needs action = Video/Products with null headline
function needsHeadline(r) {
  return r.headline === null && (r.format === 'Video' || r.format === 'Products');
}

function formatBadge(f) {
  const colors = {
    'Video':    'background:#dbeafe;color:#1e40af;',
    'Products': 'background:#dcfce7;color:#166534;',
    'Store':    'background:#f3f4f6;color:#374151;',
  };
  return `<span style="${colors[f] || ''}padding:2px 7px;border-radius:4px;font-size:11px;font-weight:600;">${f}</span>`;
}

function statusBadge(s) {
  if (s === 'PUBLISHED') return '<span style="background:#dcfce7;color:#166534;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;">PUBLISHED</span>';
  if (s === 'PENDING_MODERATION_REVIEW') return '<span style="background:#fef9c3;color:#854d0e;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;">PENDING REVIEW</span>';
  return `<span style="background:#f3f4f6;color:#374151;padding:2px 8px;border-radius:4px;font-size:11px;">${s}</span>`;
}

function headlineCell(r) {
  if (r.headline && r.headline.includes('typo')) {
    return `<td style="padding:8px 12px;font-size:12px;color:#b45309;font-style:italic;">${r.headline}</td>`;
  }
  if (r.headline) {
    return `<td style="padding:8px 12px;font-size:12px;color:#111827;">${r.headline}</td>`;
  }
  if (needsHeadline(r)) {
    return `<td style="padding:8px 12px;font-size:12px;background:#fff7ed;"><span style="color:#c2410c;font-weight:600;">⚠ Needs headline</span></td>`;
  }
  return `<td style="padding:8px 12px;font-size:12px;color:#9ca3af;font-style:italic;">(none — store format)</td>`;
}

const sbTableRows = sbRows.map(r => `
  <tr style="border-bottom:1px solid #e5e7eb;${needsHeadline(r) ? 'background:#fffbeb;' : ''}">
    <td style="padding:8px 12px;font-size:12px;color:#111827;">${r.campaign}</td>
    <td style="padding:8px 12px;">${formatBadge(r.format)}</td>
    ${headlineCell(r)}
    <td style="padding:8px 12px;font-size:11px;color:#6b7280;">${r.asins}</td>
    <td style="padding:8px 12px;">${statusBadge(r.status)}</td>
  </tr>`).join('');

const sdTableRows = sdRows.map(r => `
  <tr style="border-bottom:1px solid #e5e7eb;background:#fffbeb;">
    <td style="padding:8px 12px;font-size:12px;color:#111827;">${r.campaign}</td>
    <td style="padding:8px 12px;"><span style="background:#f3f4f6;color:#374151;padding:2px 7px;border-radius:4px;font-size:11px;font-weight:600;">${r.type}</span></td>
    <td style="padding:8px 12px;font-size:12px;background:#fff7ed;"><span style="color:#c2410c;font-weight:600;">⚠ Needs headline</span></td>
    <td style="padding:8px 12px;"><span style="background:#f3f4f6;color:#374151;padding:2px 8px;border-radius:4px;font-size:11px;">—</span></td>
  </tr>`).join('');

const actionNeeded = sbRows.filter(needsHeadline);
const dateStr = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f9fafb;margin:0;padding:20px;">
  <div style="max-width:960px;margin:0 auto;background:#fff;border-radius:12px;border:1px solid #e5e7eb;overflow:hidden;">
    <div style="background:#1a2e1a;padding:24px 32px;">
      <img src="https://app.calbridge.ai/calbridge-logo.png" alt="Calbridge" style="height:32px;" />
      <p style="color:#86efac;margin:8px 0 0;font-size:13px;">CyberPower — SB &amp; SD Creative Report (Updated)</p>
    </div>
    <div style="padding:32px;">
      <p style="color:#374151;font-size:14px;margin-top:0;">
        Pulled live from the Amazon Ads API on <strong>${dateStr}</strong>.
        Covers all enabled/paused SB and SD creatives for <strong>CyberPower US</strong>.
        Campaigns highlighted in <span style="background:#fffbeb;padding:1px 6px;border-radius:3px;font-size:12px;color:#c2410c;font-weight:600;">orange</span> are missing headlines and should have them.
      </p>

      <!-- Action summary -->
      <div style="margin:0 0 24px;padding:16px;background:#fff7ed;border-radius:8px;border:1px solid #fed7aa;">
        <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#c2410c;">⚠ Action Required — ${actionNeeded.length} SB campaigns + 8 SD campaigns missing headlines</p>
        <ul style="margin:0;padding-left:20px;font-size:13px;color:#9a3412;">
          <li><strong>${actionNeeded.filter(r => r.status === 'PUBLISHED').length} published</strong> SB Video campaigns running with no headline</li>
          <li><strong>${actionNeeded.filter(r => r.status === 'PENDING_MODERATION_REVIEW').length} pending</strong> SB Video campaigns — add headline before they go live</li>
          <li><strong>8 SD IMAGE</strong> campaigns — all missing custom headlines (Amazon uses auto-generated copy)</li>
          <li><strong>1 typo:</strong> "Cyberpower" (lowercase p) in <em>B.Keyword.Store.SB.UPS.StoreSpotlight</em></li>
        </ul>
      </div>

      <!-- SB -->
      <h2 style="font-size:16px;color:#111827;margin:24px 0 12px;padding-bottom:8px;border-bottom:2px solid #e5e7eb;">
        🏷️ Sponsored Brands — Headlines (${sbRows.length} campaigns)
      </h2>
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;">
          <thead>
            <tr style="background:#f9fafb;">
              <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #e5e7eb;">Campaign</th>
              <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #e5e7eb;">Format</th>
              <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #e5e7eb;">Headline</th>
              <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #e5e7eb;">Featured ASINs</th>
              <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #e5e7eb;">Status</th>
            </tr>
          </thead>
          <tbody>${sbTableRows}</tbody>
        </table>
      </div>

      <!-- SD -->
      <h2 style="font-size:16px;color:#111827;margin:32px 0 12px;padding-bottom:8px;border-bottom:2px solid #e5e7eb;">
        🖥️ Sponsored Display — Creatives (${sdRows.length} campaigns)
      </h2>
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;">
          <thead>
            <tr style="background:#f9fafb;">
              <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #e5e7eb;">Campaign</th>
              <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #e5e7eb;">Type</th>
              <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #e5e7eb;">Headline</th>
              <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #e5e7eb;">Status</th>
            </tr>
          </thead>
          <tbody>${sdTableRows}</tbody>
        </table>
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
    subject: 'CyberPower — SB & SD Headlines by Campaign (with action items)',
    html,
  });
  console.log('Sent:', JSON.stringify(r.data));
})();
