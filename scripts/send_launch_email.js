require('dotenv').config({ path: '/home/azureuser/.openclaw/workspace/.env' });
const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);

const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 680px; margin: 0 auto; padding: 32px 24px; color: #1a1a1a; }
  h1 { font-size: 22px; font-weight: 700; margin-bottom: 4px; }
  h2 { font-size: 15px; font-weight: 600; margin: 28px 0 10px; color: #374151; border-bottom: 1px solid #e5e7eb; padding-bottom: 6px; }
  .subtitle { color: #6b7280; font-size: 13px; margin-bottom: 28px; }
  .item { display: flex; align-items: flex-start; gap: 10px; margin: 8px 0; font-size: 14px; line-height: 1.5; }
  .done { color: #16a34a; font-weight: 700; flex-shrink: 0; }
  .warn { color: #d97706; font-weight: 700; flex-shrink: 0; }
  .label { flex: 1; }
  .note { font-size: 12px; color: #6b7280; margin-top: 2px; }
  .blocker { background: #fef2f2; border-left: 3px solid #ef4444; padding: 12px 16px; border-radius: 4px; margin: 12px 0; font-size: 14px; }
  .blocker strong { display: block; margin-bottom: 4px; color: #dc2626; }
  .blocker .fix { margin-top: 6px; color: #374151; font-size: 13px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 8px; }
  th { text-align: left; padding: 8px 12px; background: #f9fafb; color: #374151; font-weight: 600; border-bottom: 2px solid #e5e7eb; }
  td { padding: 8px 12px; border-bottom: 1px solid #f3f4f6; vertical-align: top; }
  tr:last-child td { border-bottom: none; }
  .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #9ca3af; }
</style></head>
<body>

<h1>Self-Serve Launch Checklist</h1>
<p class="subtitle">Status as of Mon Apr 20, 2026 &middot; Prepared by Ash</p>

<h2>&#x2705; Already Live</h2>

<div class="item"><span class="done">&#x2713;</span><div class="label">4-tier pricing (Free / Starter $99 / Growth $249 / Pro $499)<div class="note">Plans defined, Stripe price IDs wired, feature gating active across all routes</div></div></div>
<div class="item"><span class="done">&#x2713;</span><div class="label">Stripe checkout &amp; billing portal<div class="note">/billing/checkout and /billing/portal working; webhook secret configured</div></div></div>
<div class="item"><span class="done">&#x2713;</span><div class="label">Feature gating (requirePlan middleware)<div class="note">Write-back gated to Growth+, vendor reports gated, AI chat gated</div></div></div>
<div class="item"><span class="done">&#x2713;</span><div class="label">Pricing page at /analytics/pricing<div class="note">4-tier comparison, monthly/annual toggle, upgrade CTAs into Stripe checkout</div></div></div>
<div class="item"><span class="done">&#x2713;</span><div class="label">Upgrade banners on Recommendations page &amp; nav sidebar</div></div>
<div class="item"><span class="done">&#x2713;</span><div class="label">Free tier default &mdash; new signups land on Free automatically</div></div>
<div class="item"><span class="done">&#x2713;</span><div class="label">Data window enforcement per plan (30d / 90d / 1yr / 2yr)</div></div>
<div class="item"><span class="done">&#x2713;</span><div class="label">AI decision engine + write-back live<div class="note">69 campaign launches queued and ready to execute (date format bug fixed tonight)</div></div></div>
<div class="item"><span class="done">&#x2713;</span><div class="label">Public signup route (/signup) exists on the server</div></div>
<div class="item"><span class="done">&#x2713;</span><div class="label">Resend email configured (ash@teamcalbridge.com)</div></div>
<div class="item"><span class="done">&#x2713;</span><div class="label">Recommendations pagination: 25/50/250/All + page-scoped approve</div></div>

<h2>&#x1F534; Blockers &mdash; Must Fix Before Launch</h2>

<div class="blocker">
  <strong>1. No landing page</strong>
  The portal is live at app.teamcalbridge.com but there's no marketing page at teamcalbridge.com. Anyone clicking a LinkedIn post, ProductHunt link, or cold DM has nowhere to land. Every campaign is dead without this.
  <div class="fix">&#x1F527; Fix: Build the landing page. I have the copy and layout ready &mdash; ~2-3 hours. Just say go.</div>
</div>

<div class="blocker">
  <strong>2. No Signup page in the React app</strong>
  The Express /signup route exists but there's no Signup.jsx in the dashboard. New users hit a blank page. The login page works but signup is completely orphaned.
  <div class="fix">&#x1F527; Fix: ~1 hour &mdash; Signup.jsx with email/password/company, wired to existing /auth/signup endpoint.</div>
</div>

<div class="blocker">
  <strong>3. SP-API app still in Draft (blocks Catalog API / product titles)</strong>
  The Product Listing role is approved in Dev Console, but roles don't activate until the app is submitted for review &mdash; even for private/internal apps. Right now 124 of 273 ASINs are missing titles in the UI. Everything else works; this is purely Amazon-side.
  <div class="fix">&#x1F527; Fix: Developer Console &rarr; your app &rarr; Submit for Review. Set Listing Type = Private (no public Appstore). Amazon activates in minutes to hours. Then one re-auth in brand-setup and I'll pull all 273 titles automatically.</div>
</div>

<h2>&#x1F7E1; Important &mdash; Not Day-1 Blockers</h2>

<div class="item"><span class="warn">!</span><div class="label">No onboarding email on signup<div class="note">Users sign up and hear nothing. Need a welcome email with connection instructions. Resend is wired &mdash; just no template yet. ~1 hr.</div></div></div>
<div class="item"><span class="warn">!</span><div class="label">Vendor/retail pages show empty for Seller-only accounts<div class="note">Most self-serve signups will be Seller Central, not Vendor Central. The Sales &amp; Inventory pages need a graceful "not connected" state instead of blank charts.</div></div></div>
<div class="item"><span class="warn">!</span><div class="label">Password reset email not verified end-to-end<div class="note">Route exists, needs a smoke test with a real email.</div></div></div>
<div class="item"><span class="warn">!</span><div class="label">version=beta consent URL bug fixed tonight<div class="note">All future seller/vendor auth flows will now hit the live app, not the draft. Existing CyberPower tokens are fine. New clients connecting fresh will work correctly.</div></div></div>

<h2>Launch Priority Order</h2>
<table>
  <tr><th>#</th><th>Task</th><th>Who</th><th>Est.</th></tr>
  <tr><td>1</td><td>Build landing page at teamcalbridge.com</td><td>Ash</td><td>2-3 hrs</td></tr>
  <tr><td>2</td><td>Build Signup.jsx in React app</td><td>Ash</td><td>1 hr</td></tr>
  <tr><td>3</td><td>Submit SP-API app for review in Dev Console (Private listing)</td><td>Abe</td><td>5 min</td></tr>
  <tr><td>4</td><td>Welcome email on signup</td><td>Ash</td><td>1 hr</td></tr>
  <tr><td>5</td><td>End-to-end test: signup &rarr; connect &rarr; dashboard &rarr; upgrade</td><td>Both</td><td>1 hr</td></tr>
  <tr><td>6</td><td>GTM: LinkedIn post + Skool/Discord posts + 15-20 agency DMs</td><td>Abe</td><td>2-3 hrs</td></tr>
</table>

<p style="margin-top:20px; font-size:14px; color:#374151;">
  <strong>Total remaining dev work: ~5-6 hours.</strong> You can be live this week &mdash; realistically Wednesday or Thursday if we move tomorrow.
</p>

<p style="font-size:14px; color:#374151; margin-top:12px;">
  I can build #1, #2, and #4 tonight or first thing tomorrow. Just say the word.
</p>

<div class="footer">Ash &middot; Calbridge Portal &middot; ${new Date().toUTCString()}</div>

</body>
</html>
`;

resend.emails.send({
  from: 'Ash <ash@teamcalbridge.com>',
  to: 'abe@teamcalbridge.com',
  subject: 'Self-Serve Launch Checklist — What\'s Done, What\'s Missing',
  html,
}).then(r => {
  console.log('Sent:', r.data?.id || JSON.stringify(r));
  process.exit(0);
}).catch(e => {
  console.error('Failed:', e.message);
  process.exit(1);
});
