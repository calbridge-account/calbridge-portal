'use strict';
require('dotenv').config({ path: '/home/azureuser/.openclaw/workspace/.env' });
const { Resend } = require('/home/azureuser/.openclaw/workspace/node_modules/resend');
const resend = new Resend(process.env.RESEND_API_KEY);

const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:720px;margin:0 auto;color:#1f2937;">

<h1 style="color:#2d5a27;border-bottom:2px solid #edf5ec;padding-bottom:12px;">Calbridge — Master To-Do &amp; Roadmap</h1>
<p style="color:#6b7280;font-size:14px;">Everything we discussed today. Organized by priority. — Ash, Tue Apr 21</p>

<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">

<h2 style="color:#dc2626;">🔴 Do This Week (Revenue-Generating)</h2>

<h3>1. Community Drops</h3>
<p style="font-size:14px;">Drafts already in your inbox. Post in this order:</p>
<ol style="font-size:14px;line-height:1.8;">
  <li><strong>Seller Sessions Discord</strong> (#tools) — most technical, post first</li>
  <li><strong>My Amazon Guy Skool</strong> — biggest reach among serious sellers</li>
  <li><strong>r/AmazonSeller</strong> — use founder framing, not a pitch</li>
  <li><strong>EcomCrew Community</strong></li>
  <li><strong>r/amazonfba</strong></li>
  <li><strong>Helium 10 Facebook Group</strong></li>
</ol>

<h3>2. Competitor Outreach — Mine disgruntled users</h3>
<ul style="font-size:14px;line-height:1.8;">
  <li>Perpetua Trustpilot (sort 1-3 stars) — April 2026 reviews mention 6-figure losses, annual contract traps, collections</li>
  <li>Teikametrics Trustpilot — Jan-Mar 2026 billing complaints, charges after cancellation, bot-only support</li>
  <li>DM template already sent to you</li>
  <li>Target: 20-30 DMs this week, expect 3-5 replies minimum</li>
</ul>

<h3>3. LinkedIn Posts (3 this week)</h3>
<ul style="font-size:14px;line-height:1.8;">
  <li>Monday: Founder story — built this after managing $500k/mo</li>
  <li>Wednesday: Competitor pain angle — screenshot Perpetua review</li>
  <li>Friday: Feature proof — screenshot of AI recommendations in action</li>
</ul>

<h3>4. Stripe — Add Agency Price ID</h3>
<ul style="font-size:14px;line-height:1.8;">
  <li>Create a $549/mo product in Stripe dashboard</li>
  <li>Add STRIPE_PRICE_AGENCY to .env on the server</li>
  <li>Agency CTA currently routes to mailto for manual close — that is intentional for now</li>
</ul>

<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">

<h2 style="color:#d97706;">🟡 Build Next (Product Features)</h2>

<h3>5. Smart Campaign Creation (Pro)</h3>
<ul style="font-size:14px;line-height:1.8;">
  <li>Input: ASIN. Output: full campaign structure (keywords, bids, match types, negatives) auto-launched via Amazon API</li>
  <li>Core Pro differentiator. ~1-2 weeks to build.</li>
</ul>

<h3>6. Portfolio Budget Management (Pro)</h3>
<ul style="font-size:14px;line-height:1.8;">
  <li>Set total portfolio budget, AI allocates dynamically by ROAS performance</li>
  <li>Anomaly detection: auto-pause runaway campaigns before budget blows</li>
</ul>

<h3>7. Budget Automation + Smart Alerts (Growth)</h3>
<ul style="font-size:14px;line-height:1.8;">
  <li>Auto-pause campaigns at monthly budget cap, auto-resume next month</li>
  <li>Alerts: ACoS spike, spend surge, budget burn rate warnings</li>
</ul>

<h3>8. SmartScout API Integration</h3>
<ul style="font-size:14px;line-height:1.8;">
  <li>REST API, X-Api-Key header auth. Supports US, UK, IT, DE, CA, MX, FR, ES</li>
  <li>Key data: estimated ASIN sales, seller profiles, competitor intelligence, category benchmarks</li>
  <li>Use cases: enrich ASIN profiles with market size estimates, show competitors in dashboard, benchmark your performance vs category</li>
  <li>Huge value-add for Growth/Pro/Agency tiers — nobody else at this price has SmartScout data baked in</li>
  <li><strong>Action needed from you: Add SMARTSCOUT_API_KEY to .env — I will build the integration immediately after</strong></li>
</ul>

<h3>9. White-Label Agency Portal (Agency)</h3>
<ul style="font-size:14px;line-height:1.8;">
  <li>Custom subdomain per agency (analytics.youragency.com)</li>
  <li>Logo swap per agency config</li>
  <li>Client login — sees only their brand, no Calbridge branding</li>
  <li>Build when first agency client closes — foundation already exists</li>
</ul>

<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">

<h2 style="color:#d97706;">🟠 Content &amp; SEO</h2>

<h3>10. Case Studies</h3>
<ul style="font-size:14px;line-height:1.8;">
  <li>Best candidate: CyberPower (if they consent). Anonymous version works too: "8-figure PC accessories brand"</li>
  <li>Format: Before/After. Metrics: ACoS improvement, contribution margin gain, time saved</li>
  <li><strong>Action needed: Ask Colin/Justina/Tim at CyberPower if they are OK being featured</strong></li>
  <li>Even an anonymous case study with real numbers converts better than none</li>
</ul>

<h3>11. Blog Comparison Pages (SEO — high intent traffic)</h3>
<ul style="font-size:14px;line-height:1.8;">
  <li>calbridge-vs-perpetua — in progress</li>
  <li>calbridge-vs-teikametrics — in progress</li>
  <li>Planned: "What is contribution margin on Amazon" + "Amazon dayparting guide"</li>
  <li>Ranking estimate: 4-6 weeks for buying-intent searches</li>
</ul>

<h3>12. teamcalbridge.com Rebuild</h3>
<ul style="font-size:14px;line-height:1.8;">
  <li>4-page site ready to deploy: Home, Services, Platform, Contact</li>
  <li><strong>Action needed: In Squarespace DNS, point teamcalbridge.com A record to 172.179.10.131</strong></li>
  <li>I will issue the SSL cert and configure nginx as soon as DNS propagates</li>
</ul>

<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">

<h2 style="color:#2563eb;">🔵 Multi-Marketplace Expansion</h2>

<table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px;">
  <tr style="background:#edf5ec;"><th style="padding:8px;text-align:left;">Marketplace</th><th style="padding:8px;text-align:center;">Status</th><th style="padding:8px;text-align:left;">Notes</th></tr>
  <tr><td style="padding:8px;">US</td><td style="padding:8px;text-align:center;">✅ Live</td><td style="padding:8px;">Fully tested (CyberPower)</td></tr>
  <tr style="background:#f9fafb;"><td style="padding:8px;">CA</td><td style="padding:8px;text-align:center;">🟡 Connected</td><td style="padding:8px;">Untested at scale</td></tr>
  <tr><td style="padding:8px;">UK</td><td style="padding:8px;text-align:center;">🟡 Connected</td><td style="padding:8px;">Needs test account</td></tr>
  <tr style="background:#f9fafb;"><td style="padding:8px;">DE / FR / IT / ES</td><td style="padding:8px;text-align:center;">🟡 Connected</td><td style="padding:8px;">EU VAT/compliance to consider</td></tr>
  <tr><td style="padding:8px;">JP / AU / MX</td><td style="padding:8px;text-align:center;">🟡 Connected</td><td style="padding:8px;">Currency/locale handling needed</td></tr>
</table>
<ul style="font-size:14px;line-height:1.8;">
  <li>SmartScout covers UK, DE, IT, FR, CA, MX, ES — good complement for international market data</li>
  <li>Landing page states "US optimized, international beta available" — honest positioning</li>
  <li>Strategy: accept international signups, let first client be the test</li>
</ul>

<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">

<h2 style="color:#2d5a27;">📧 Inbound Email Setup</h2>
<ul style="font-size:14px;line-height:1.8;">
  <li>Plan: Resend inbound webhook on contact@calbridge.ai — email lands in our chat, I draft replies, you approve</li>
  <li>Cost: $0</li>
  <li><strong>Action needed: Add MX record for calbridge.ai in Squarespace DNS. I will send you the exact record value.</strong></li>
</ul>

<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">

<h2 style="color:#16a34a;">✅ Already Shipped Today</h2>
<ul style="font-size:14px;line-height:1.8;">
  <li>calbridge.ai live with SSL ✅</li>
  <li>Landing page correctly served at calbridge.ai root ✅</li>
  <li>SEO: meta tags, OG, JSON-LD structured data ✅</li>
  <li>robots.txt + sitemap.xml ✅</li>
  <li>Privacy + Terms pages live ✅</li>
  <li>5-tier pricing: Free / Starter / Growth / Pro / Agency ✅</li>
  <li>Agency: $549 base + $299/brand ✅</li>
  <li>Pro: smart campaign creation, portfolio budgets, 3yr data, API access (gated, builds coming) ✅</li>
  <li>Growth: budget automation, smart alerts, dayparting, marginal ROAS ✅</li>
  <li>Dayparting schedule service + Snowflake tables ✅</li>
  <li>Marginal ROAS scoring service + Snowflake tables ✅</li>
  <li>Landing page: Seattle/HQ credibility, consulting CTA, 6-card features grid ✅</li>
  <li>GTM plan: docs/gtm/GTM-PLAN.md ✅</li>
  <li>6 community drop drafts emailed ✅</li>
  <li>Competitor DM outreach template emailed ✅</li>
</ul>

<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">

<h2 style="color:#2d5a27;">Your Action Items (Nothing moves without these)</h2>
<ol style="font-size:14px;line-height:2;">
  <li>Post the community drops (drafts in your inbox)</li>
  <li>Mine Perpetua/Teikametrics Trustpilot and send 20+ DMs</li>
  <li>Add SMARTSCOUT_API_KEY to .env on the server</li>
  <li>Point teamcalbridge.com DNS to 172.179.10.131</li>
  <li>Add MX record for calbridge.ai (inbound email — I'll send the value)</li>
  <li>Ask CyberPower team if they'll consent to a case study</li>
  <li>Create Agency price in Stripe, add STRIPE_PRICE_AGENCY to .env</li>
</ol>

<p style="margin-top:32px;color:#6b7280;font-size:13px;">— Ash &nbsp;·&nbsp; Sending to abe@teamcalbridge.com</p>
</div>
`;

resend.emails.send({
  from: 'Ash at Calbridge <ash@teamcalbridge.com>',
  to: 'abe@teamcalbridge.com',
  subject: 'Calbridge Master To-Do — Case Studies to Multi-Marketplace',
  html
}).then(r => {
  console.log('Sent:', r.data?.id);
  process.exit(0);
}).catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
