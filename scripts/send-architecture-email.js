'use strict';
require('dotenv').config({ path: '/home/azureuser/.openclaw/workspace/.env' });
const { Resend } = require('/home/azureuser/.openclaw/workspace/node_modules/resend');
const resend = new Resend(process.env.RESEND_API_KEY);

const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:740px;margin:0 auto;color:#1f2937;line-height:1.6;">

<h1 style="color:#2d5a27;border-bottom:2px solid #edf5ec;padding-bottom:12px;">Calbridge Data Architecture — Session Summary</h1>
<p style="color:#6b7280;font-size:14px;">Thu Apr 23, 2026 · 01:00–04:40 UTC — Ash</p>

<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">

<h2 style="color:#2d5a27;">✅ What We Fixed Tonight</h2>
<ul style="font-size:14px;line-height:2;">
  <li><strong>DSP data stall</strong> — CyberPower DSP was 6 days stale, Acer DSP 23 days stale. Root cause: ingest jobs not running on worker restarts. Fixed — all 3 ingest jobs now self-heal on every restart.</li>
  <li><strong>Acer DSP dead</strong> — account had expired valid_to date. Reactivated.</li>
  <li><strong>SparkX cleanup</strong> — SparkX advertiser IDs removed from active pull. CyberPower DSP now only pulls from Calbridge DSP seat.</li>
  <li><strong>DSP source_platform NULL error</strong> — was blocking raw table writes. Made column nullable, expanded platform map. DSP now current through Apr 22 ✅</li>
  <li><strong>rebuildMart terminated connection</strong> — added auto-retry with pool reset on Snowflake connection drops.</li>
  <li><strong>Decision action "Unknown error"</strong> — improved error capture so failed bid changes now show real Amazon error messages.</li>
  <li><strong>Worker crash loop</strong> — 126 restarts caused by stale SyntaxError. Cleaned up, worker stable.</li>
  <li><strong>Favicon</strong> — added, kills the constant 404 noise in logs.</li>
  <li><strong>Vendor data</strong> — manually triggered, now current through Apr 23.</li>
  <li><strong>Mart rebuild</strong> — all 4 ad types (SP/SB/SD/DSP) current through Apr 22.</li>
</ul>

<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">

<h2 style="color:#dc2626;">🔴 Critical Finding: Dashboard Showing Wrong DSP Numbers</h2>
<table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:12px;">
  <tr style="background:#edf5ec;"><th style="padding:8px;text-align:left;">Source</th><th style="padding:8px;text-align:right;">Spend</th><th style="padding:8px;text-align:right;">Sales</th></tr>
  <tr><td style="padding:8px;">Amazon actual (DSP_CAMPAIGN_REPORT)</td><td style="padding:8px;text-align:right;"><strong>$2,021,757</strong></td><td style="padding:8px;text-align:right;"><strong>$11,722,404</strong></td></tr>
  <tr style="background:#fef2f2;"><td style="padding:8px;">Dashboard showing (DSP_RAW_CAMPAIGN)</td><td style="padding:8px;text-align:right;color:#dc2626;">$1,144,674</td><td style="padding:8px;text-align:right;color:#dc2626;">$9,818,237</td></tr>
  <tr style="background:#fef2f2;"><td style="padding:8px;font-weight:600;">Gap</td><td style="padding:8px;text-align:right;color:#dc2626;font-weight:600;">-$877,083</td><td style="padding:8px;text-align:right;color:#dc2626;font-weight:600;">-$1,904,167</td></tr>
</table>
<p style="font-size:13px;color:#6b7280;">Root cause: DSP_RAW_CAMPAIGN is missing SparkX orders due to 64-bit integer truncation — some orders appear multiple times with different IDs and the dedup logic excluded them. DSP_CAMPAIGN_REPORT has the correct data. Fixing this is part of the architecture refactor below.</p>

<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">

<h2 style="color:#d97706;">🟡 Current Data Flow (Too Complex)</h2>
<pre style="background:#f9fafb;padding:16px;border-radius:8px;font-size:12px;overflow-x:auto;">Amazon API
  → ADS_REPORT_QUEUE
  → SP/SB/SD/DSP_CAMPAIGN_REPORT    (raw download tables)
  → RAW.AD_CAMPAIGN                  (SP/SB/SD consolidated — redundant)
  → DSP_RAW_CAMPAIGN                 (DSP deduped — showing wrong numbers)
  → mart_advertising_daily           (daily KPI totals)
  → CAMPAIGN_PERFORMANCE             (campaign-level — written by pipeline directly)
  → ADJUSTED_CAMPAIGN_PERFORMANCE    (view: spend multipliers)
  → Dashboard</pre>
<p style="font-size:13px;color:#6b7280;margin-top:8px;">6 hops. Two competing "marts" that can drift. DSP special-cased everywhere. Hard to debug, expensive to maintain.</p>

<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">

<h2 style="color:#2d5a27;">✨ Target Data Flow (What Great Looks Like)</h2>
<pre style="background:#edf5ec;padding:16px;border-radius:8px;font-size:12px;overflow-x:auto;">Amazon API
  → ADS_REPORT_QUEUE
  → RAW TABLES (append-only, sacred — never modified)
      APP.SP_CAMPAIGN_REPORT
      APP.SB_CAMPAIGN_REPORT
      APP.SD_CAMPAIGN_REPORT
      APP.DSP_CAMPAIGN_REPORT
      APP.VENDOR_SALES / VENDOR_FORECASTS / PRODUCTS
  → rebuildMart() — ONE job, runs hourly, fully rebuildable
      MARTS.AD_PERFORMANCE_DAILY     (SP/SB/SD/DSP by client+date+ad_type)
      MARTS.CAMPAIGN_PERFORMANCE     (campaign grain, all ad types)
      MARTS.DSP_LINE_ITEM            (DSP flight grain, Calbridge only)
      MARTS.VENDOR_DAILY             (vendor sales+forecasts)
      MARTS.ASIN_PERFORMANCE         (ASIN contribution margin + ad attribution)
  → VIEWS (zero compute, just joins + adjustments)
      ADJUSTED_CAMPAIGN_PERFORMANCE  (spend multipliers)
      CLIENT_METRICS                 (dashboard KPIs + attribution window)
  → Dashboard routes (read views only)</pre>
<p style="font-size:13px;color:#6b7280;margin-top:8px;">3 hops. One mart rebuild job. DSP first-class alongside SP/SB/SD. Fully rebuildable from raw in &lt;60s. Scalable to 100+ clients without architecture changes.</p>

<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">

<h2 style="color:#2d5a27;">📊 Data Settlement — What Amazon Says</h2>
<p style="font-size:14px;">Amazon explicitly recommends re-pulling recent data daily. Their guidance:</p>
<table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:12px;">
  <tr style="background:#edf5ec;"><th style="padding:8px;text-align:left;">Age</th><th style="padding:8px;text-align:left;">Status</th><th style="padding:8px;text-align:left;">Action</th></tr>
  <tr><td style="padding:8px;">D-0 to D-2</td><td style="padding:8px;">Preliminary — fraud filtering running</td><td style="padding:8px;">Re-pull every 6h (already doing this)</td></tr>
  <tr style="background:#f9fafb;"><td style="padding:8px;">D-3 to D-14</td><td style="padding:8px;">Settling — attribution windows closing</td><td style="padding:8px;color:#dc2626;font-weight:600;">NOT doing this — need to add</td></tr>
  <tr><td style="padding:8px;">D-15 to D-60</td><td style="padding:8px;">Near-final — rare adjustments</td><td style="padding:8px;color:#dc2626;font-weight:600;">NOT doing this — need to add</td></tr>
  <tr style="background:#f9fafb;"><td style="padding:8px;">D-60+</td><td style="padding:8px;">Final</td><td style="padding:8px;">No action needed</td></tr>
</table>
<p style="font-size:13px;color:#6b7280;">Two cron jobs needed: daily D-3→D-14 settle pass, weekly D-15→D-60 finalize pass. Uses existing queue infrastructure — just resets status to 'pending' for those date windows.</p>

<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">

<h2 style="color:#2d5a27;">📥 Reports We're Not Pulling (Gaps)</h2>

<h3 style="font-size:15px;color:#374151;">Missing — No Blocker (just not built):</h3>
<table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px;">
  <tr style="background:#edf5ec;"><th style="padding:8px;text-align:left;">Report</th><th style="padding:8px;text-align:left;">What it gives you</th><th style="padding:8px;text-align:left;">Priority</th></tr>
  <tr><td style="padding:8px;font-weight:600;">spAudiences</td><td style="padding:8px;">SP retargeting/audience segment performance. 95-day lookback.</td><td style="padding:8px;color:#d97706;">High</td></tr>
  <tr style="background:#f9fafb;"><td style="padding:8px;font-weight:600;">sbAudiences</td><td style="padding:8px;">Same for SB campaigns. 95-day lookback.</td><td style="padding:8px;color:#d97706;">High</td></tr>
  <tr><td style="padding:8px;font-weight:600;">dspAudience</td><td style="padding:8px;">DSP audience overlap — critical for DSP optimization. 95-day lookback.</td><td style="padding:8px;color:#dc2626;">Critical</td></tr>
  <tr style="background:#f9fafb;"><td style="padding:8px;font-weight:600;">dspProduct</td><td style="padding:8px;">Which ASINs converting from DSP. Ties DSP spend to ASIN contribution margin.</td><td style="padding:8px;color:#dc2626;">Critical</td></tr>
  <tr><td style="padding:8px;font-weight:600;">dspGeo</td><td style="padding:8px;">Geographic performance breakdown for DSP.</td><td style="padding:8px;color:#6b7280;">Medium</td></tr>
  <tr style="background:#f9fafb;"><td style="padding:8px;font-weight:600;">dspHierarchy</td><td style="padding:8px;">Full DSP order/line item/creative hierarchy in one report.</td><td style="padding:8px;color:#6b7280;">Medium</td></tr>
</table>

<h3 style="font-size:15px;color:#374151;">Missing — Requires Additional Setup:</h3>
<table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px;">
  <tr style="background:#edf5ec;"><th style="padding:8px;text-align:left;">Report</th><th style="padding:8px;text-align:left;">What it gives you</th><th style="padding:8px;text-align:left;">Blocker</th></tr>
  <tr><td style="padding:8px;font-weight:600;">brandMetrics</td><td style="padding:8px;">Full funnel: awareness → consideration → purchase. Massive strategic value.</td><td style="padding:8px;">Brand Analytics role in Developer Console</td></tr>
  <tr style="background:#f9fafb;"><td style="padding:8px;font-weight:600;">amazonAttribution</td><td style="padding:8px;">Off-Amazon traffic attribution (social, email, Google).</td><td style="padding:8px;">Attribution role needed</td></tr>
  <tr><td style="padding:8px;font-weight:600;">GET_VENDOR_SALES_REPORT</td><td style="padding:8px;">Vendor shipped COGS + revenue. Currently blocked.</td><td style="padding:8px;">Brand Analytics role</td></tr>
  <tr style="background:#f9fafb;"><td style="padding:8px;font-weight:600;">Amazon Marketing Stream</td><td style="padding:8px;">Real-time hourly data via SQS. Enables true dayparting with actual hourly patterns.</td><td style="padding:8px;">Separate SQS setup + subscription</td></tr>
</table>

<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">

<h2 style="color:#2d5a27;">💰 Snowflake Costs</h2>
<table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:12px;">
  <tr style="background:#edf5ec;"><th style="padding:8px;">Month</th><th style="padding:8px;text-align:right;">Credits</th><th style="padding:8px;text-align:right;">Est Cost</th><th style="padding:8px;text-align:left;">Notes</th></tr>
  <tr><td style="padding:8px;">March</td><td style="padding:8px;text-align:right;">~100</td><td style="padding:8px;text-align:right;">~$200</td><td style="padding:8px;">Baseline</td></tr>
  <tr style="background:#fef2f2;"><td style="padding:8px;">April (projected)</td><td style="padding:8px;text-align:right;">~400</td><td style="padding:8px;text-align:right;font-weight:600;color:#dc2626;">~$800</td><td style="padding:8px;">Spike from worker crash loop</td></tr>
  <tr style="background:#edf5ec;"><td style="padding:8px;">May (projected)</td><td style="padding:8px;text-align:right;">~100</td><td style="padding:8px;text-align:right;color:#2d5a27;font-weight:600;">~$200</td><td style="padding:8px;">Crash loop fixed, back to baseline</td></tr>
</table>
<p style="font-size:13px;color:#6b7280;">April spike caused by 126 worker restarts × hourly ingest jobs = ~80,000 MERGE queries/day. Now fixed. 382GB failsafe storage is temp — expires Apr 28-29. Current run rate: ~6 credits/day (~$12/day, ~$360/mo). Architecture refactor will reduce this further.</p>

<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">

<h2 style="color:#2d5a27;">🗺️ Next Steps — Prioritized</h2>

<h3 style="font-size:15px;">Immediate (this week):</h3>
<ol style="font-size:14px;line-height:2.2;">
  <li><strong>Fix DSP numbers on dashboard</strong> — switch mart to read DSP_CAMPAIGN_REPORT with proper dedup. Recovers $877k spend + $1.9M sales currently hidden.</li>
  <li><strong>Add dspProduct report</strong> — ASIN-level DSP attribution. Critical for contribution margin at ASIN level.</li>
  <li><strong>Add dspAudience report</strong> — DSP audience performance. Required for meaningful DSP optimization.</li>
  <li><strong>Data settlement cron jobs</strong> — D-3→D-14 daily re-pull + D-15→D-60 weekly. Makes all data accurate.</li>
  <li><strong>Add spAudiences + sbAudiences</strong> — audience performance for SP/SB. No blocker.</li>
</ol>

<h3 style="font-size:15px;">Short-term (2-4 weeks):</h3>
<ol style="font-size:14px;line-height:2.2;">
  <li><strong>Architecture refactor</strong> — collapse 6-hop pipeline to 3-hop. Eliminate RAW.AD_CAMPAIGN and DSP_RAW_CAMPAIGN. One rebuildMart() job does everything. ~3-4 days work.</li>
  <li><strong>data_maturity column</strong> — tag every raw row as preliminary/settling/final. Show on dashboard UI.</li>
  <li><strong>Brand Analytics role</strong> — unlock brandMetrics + vendor sales/inventory/traffic reports.</li>
  <li><strong>ASIN performance mart</strong> — ASIN-level contribution margin after COGS + FBA fees + referral fees + ad spend. The core analytics differentiator.</li>
</ol>

<h3 style="font-size:15px;">Medium-term (1-2 months):</h3>
<ol style="font-size:14px;line-height:2.2;">
  <li><strong>Amazon Marketing Stream</strong> — hourly data via SQS. Enables true dayparting based on actual hourly patterns, not time-of-day inference.</li>
  <li><strong>Amazon Attribution</strong> — off-Amazon traffic attribution.</li>
  <li><strong>Multi-marketplace data</strong> — CA, UK, EU tested and validated.</li>
  <li><strong>SmartScout integration</strong> — market size + competitor data layered onto ASIN performance.</li>
</ol>

<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">

<h2 style="color:#2d5a27;">📌 Current Data State (as of Apr 23 04:40 UTC)</h2>
<table style="width:100%;border-collapse:collapse;font-size:13px;">
  <tr style="background:#edf5ec;"><th style="padding:8px;text-align:left;">Client</th><th style="padding:8px;">SP</th><th style="padding:8px;">SB</th><th style="padding:8px;">SD</th><th style="padding:8px;">DSP</th><th style="padding:8px;">Vendor</th></tr>
  <tr><td style="padding:8px;font-weight:600;">CyberPower</td><td style="padding:8px;text-align:center;">✅ Apr 22</td><td style="padding:8px;text-align:center;">✅ Apr 22</td><td style="padding:8px;text-align:center;">✅ Apr 22</td><td style="padding:8px;text-align:center;">✅ Apr 22</td><td style="padding:8px;text-align:center;">✅ Apr 23</td></tr>
  <tr style="background:#f9fafb;"><td style="padding:8px;font-weight:600;">Acer</td><td style="padding:8px;text-align:center;">✅ Apr 21</td><td style="padding:8px;text-align:center;">✅ Apr 20</td><td style="padding:8px;text-align:center;">—</td><td style="padding:8px;text-align:center;">🔄 Catching up</td><td style="padding:8px;text-align:center;">—</td></tr>
</table>

<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
<p style="color:#6b7280;font-size:13px;">— Ash &nbsp;·&nbsp; info@teamcalbridge.com</p>
</div>
`;

resend.emails.send({
  from: 'Ash at Calbridge <ash@teamcalbridge.com>',
  to: 'abe@teamcalbridge.com',
  subject: 'Calbridge Data Architecture — What We Learned + Next Steps',
  html
}).then(r => {
  console.log('Sent:', r.data?.id);
  process.exit(0);
}).catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
