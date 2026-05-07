# Calbridge GTM Plan — Refreshed
_Updated: 2026-05-07 | Previous version: Apr 21_

---

## Status Audit vs April 21 Plan

| Item | Apr 21 Status | May 7 Status |
|------|---------------|--------------|
| Community drops posted | ❌ Abe action | ❓ Confirm with Abe |
| Competitor DM outreach (20-30) | ❌ Abe action | ❓ Confirm with Abe |
| LinkedIn posts (3/week) | ❌ Abe action | ❓ Confirm with Abe |
| Stripe Agency price ID | ❌ Abe action | ✅ STRIPE_PRICE_AGENCY in .env |
| Smart campaign creation (Pro) | 🔶 In progress | ✅ Shipped (SP/SB/SD wizard) |
| Portfolio budget management | ❌ Not started | ❌ Still needed |
| Budget automation + smart alerts | ❌ Not started | 🔶 Route exists, needs UI |
| Dayparting | ❌ Not started | ✅ Routes built (needs Marketing Stream for AI) |
| SmartScout API integration | ❌ Waiting on key | ❓ Key in .env? |
| White-label agency portal | 🔶 Foundation | ✅ Full agency portal shipped |
| Case study (CyberPower) | ❌ Ask Colin/Justina/Tim | ❓ Confirm with Abe |
| Blog comparison pages | 🔶 In progress | ❌ /blog/ returns 404 — needs deploy |
| teamcalbridge.com rebuild | ❌ DNS pending | ✅ Live (nginx serving, Calbridge title) |
| Inbound email (contact@calbridge.ai) | ❌ MX record needed | ❓ Unknown — check DNS |
| ROAS 2dp display | ❌ Bug | ✅ Fixed May 7 |

---

## 🔴 Do This Week — Revenue-Generating (Abe's Actions)

These cannot be delegated. They require your identity and credibility.

### 1. Community Drops
Post in this order (each is 5 minutes):
- **Seller Sessions Discord** — `#tools` channel — most technical crowd
- **My Amazon Guy Skool** — biggest reach among active sellers
- **r/AmazonSeller** — founder framing, not a pitch ("I built this after managing $500k/mo")
- **EcomCrew Community**
- **r/amazonfba**
- **Helium 10 Facebook Group**

> Need fresh drafts? Say the word — I'll write new ones tuned to today's context (you now have agency features, Report Builder, campaign creation wizard — much stronger than April).

### 2. Competitor Outreach — 20+ DMs this week
Mine 1-3 star reviews from:
- **Perpetua** → https://www.trustpilot.com/review/perpetua.io (April 2026: 6-figure losses, annual contracts, sent to collections)
- **Teikametrics** → https://www.trustpilot.com/review/www.teikametrics.com (charges after cancellation, bot support)
- **Reddit** → r/AmazonSeller + r/amazonfba search "perpetua" OR "teikametrics" + "alternative"

DM template:
> "Saw your post about [Perpetua/Teikametrics]. We built Calbridge after managing $500k/mo in Amazon ad spend ourselves — same exact frustrations. Month-to-month, no contracts, AI that actually adjusts bids. Free tier to try. Happy to do a 20-min live walkthrough if you're looking. — Abe @ Calbridge"

**Target:** 20-30 DMs → expect 3-5 replies → 1-2 demos → 1 close.

### 3. LinkedIn Posts — 3 this week
Stronger angles now vs April (you have more to show):

**Monday — Founder story:**
> "I manage $500k/month in Amazon ad spend across multiple brands. For years I pieced together Sellerboard + Google Sheets + Amazon console to try to answer one question: is this actually making money? I got tired of it and built something better. Calbridge is live. Free tier. No contracts. [link]"

**Wednesday — Competitor pain:**
> "Perpetua just got a Trustpilot review: 'six-figure loss, locked into an annual contract, they sent me to collections.' We built Calbridge on the opposite philosophy: month-to-month, cancel in 2 clicks, no surprise charges. [link]"

**Friday — Feature proof:**
> "Our campaign creation wizard just built a full SP + SB campaign structure — keywords, bids, match types, negatives — from one ASIN. Here's what it looks like. [screenshot] Built for operators, not analysts. [link]"

**Engagement rule:** Reply to every comment personally within 24 hours.

### 4. Agency Direct Outreach — 20 DMs/week
LinkedIn search: `"Amazon agency" + "PPC" + founder/owner/director` — filter US + Canada

Pitch:
> "We built a white-label Amazon analytics portal for agencies — your logo, client logins, multi-brand switcher, Report Builder with PDF exports. Free pilot for your first 3 brands. 10 minutes to connect. Worth a 20-min call?"

One agency = 5-30 brands. Highest LTV channel.

---

## 🟡 Build Next (Ash Executes — Ordered by Revenue Impact)

### 5. Blog Comparison Pages — Deploy NOW (Ash)
`/blog/` is returning 404. The comparison pages are the highest-intent SEO traffic available.
- `calbridge-vs-perpetua`
- `calbridge-vs-teikametrics`
- "What is contribution margin on Amazon" (how-to, ranks fast)
- "Amazon dayparting guide" (longer tail)

**Ash action:** Build the blog directory, create these 4 pages, deploy. ETA: today.

### 6. SmartScout Integration (Ash — needs SMARTSCOUT_API_KEY)
Once key is in `.env`:
- Enrich ASIN profiles with estimated monthly sales
- Competitor intelligence panel in dashboard
- Category benchmarks (your ROAS vs category avg)
- Massive value-add for Growth/Pro/Agency — no competitor at this price point has it

**Abe action:** `SMARTSCOUT_API_KEY=xxx` → add to `.env` on server. I build immediately.

### 7. Inbound Email — contact@calbridge.ai (Ash — needs MX record)
Resend inbound webhook → emails land in our chat → I draft replies → you approve and send.
Cost: $0. Setup: 10 minutes once MX is added.

**Abe action:** Add MX record for calbridge.ai in Squarespace DNS:
- Type: MX
- Host: @
- Value: `feedback-smtp.us-east-1.amazonses.com` ← (Resend's inbound MX — I'll confirm exact value when ready to configure)
- Priority: 10

**Ash action:** Configure Resend inbound webhook after MX propagates.

### 8. Portfolio Budget Management (Pro differentiator)
- Set total portfolio budget; AI reallocates weekly toward highest-ROAS campaigns
- Auto-pause runaway campaigns before budget blows (anomaly detection hook)
- This is the "killer feature" that justifies Pro over Growth

**Ash action:** Build once blog + SmartScout done. ~3-4 days.

### 9. Budget Automation + Smart Alerts (Growth)
Routes exist (`budgets.js`). UI not wired.
- Auto-pause campaigns at monthly budget cap, auto-resume next month
- Alerts: ACoS spike, spend surge, budget burn rate
- Unlocks Growth upsell for existing Starter users

**Ash action:** Wire UI after portfolio budget management.

---

## 🟠 Content & SEO (Ash Executes)

### 10. Case Study — CyberPower
Best candidate. Even anonymous ("8-figure PC accessories brand") converts hard.
Format: Before/After — ACoS improvement, contribution margin gain, time saved.
**Abe action:** Ask Colin/Justina/Tim if they'll consent. Anonymous version OK too.
**Ash action:** Write case study the moment you get the green light.

### 11. ProductHunt Launch — Week 2
- Launch Tuesday-Thursday
- Line up 20+ hunters before launch day
- Prepare 30-second GIF: campaign creation wizard + AI recommendations in action
- "ProductHunt exclusive": 3 months Growth free for first 50 signups
- Cross-post to r/SideProject and r/startups same day

**Ash action:** Write full ProductHunt page copy + hunter recruitment email. Ready this week.

### 12. Podcast Pitches — Send this week
Target in priority order:
1. **EcomCrew** — Mike & Dave, large seller audience
2. **Seller Sessions** — Danny McMillan, technical Amazon crowd
3. **My Amazon Guy** — Steve Chou, massive reach
4. **Serious Sellers Podcast** (Helium 10)
5. **The Ecommerce Fuel Podcast**

Pitch hook: "I manage $500k/mo in real Amazon ad spend, built an AI that auto-adjusts bids, and I'll show your audience live data."

**Ash action:** Write all 5 podcast pitches. Ready today.

---

## 🔵 Infrastructure (Ash — Near-Term)

### 13. Blog Directory Deploy
`/blog/` → 404 right now. Pages exist in plan, not deployed.

### 14. calbridge.ai Inbound Email
MX record → Resend inbound → routes to our chat.

### 15. Marketplace Expansion Positioning
| Marketplace | Status | Action |
|-------------|--------|--------|
| US | ✅ Live, fully tested | — |
| CA | 🟡 Connected | Accept signups, flag as beta |
| UK | 🟡 Connected | Accept signups, flag as beta |
| DE/FR/IT/ES | 🟡 Connected | EU VAT note on signup |
| JP/AU/MX | 🟡 Connected | Currency handling needed |

Landing page already says "US optimized, international beta available" — honest and correct.

---

## 📊 Week 1 Success Metrics

| Metric | Target |
|--------|--------|
| Free signups | 25+ |
| Paid conversions | 2+ |
| Outreach DMs sent | 50+ (competitor + agency) |
| LinkedIn post impressions | 5k+ |
| Community post upvotes/replies | 20+ combined |
| Demo calls booked | 3+ |

---

## Abe's Action Items (Nothing Moves Without These)

| # | Action | Urgency |
|---|--------|---------|
| 1 | Post community drops (or confirm if already done) | 🔴 This week |
| 2 | Mine Perpetua/Teikametrics Trustpilot + send 20+ DMs | 🔴 This week |
| 3 | Post 3 LinkedIn posts | 🔴 This week |
| 4 | Add `SMARTSCOUT_API_KEY` to `.env` on server | 🟡 When ready |
| 5 | Add MX record for calbridge.ai inbound email | 🟡 When ready |
| 6 | Ask CyberPower team (Colin/Justina/Tim) about case study | 🟡 This week |
| 7 | Confirm: have community drops / competitor DMs been done since Apr 21? | 🔴 Now |

---

## Ash's Action Items (I Handle These)

| # | Action | ETA |
|---|--------|-----|
| 1 | Refresh community drop drafts with current feature set | Today |
| 2 | Write updated competitor DM templates | Today |
| 3 | Write 3 LinkedIn post drafts | Today |
| 4 | Write 5 podcast pitch emails | Today |
| 5 | Build + deploy blog comparison pages | Today |
| 6 | Write ProductHunt launch page copy | Today |
| 7 | Build SmartScout integration (after key in .env) | Same day as key |
| 8 | Configure inbound email (after MX record) | Same day as MX |
| 9 | Build portfolio budget management (Pro) | This week |
| 10 | Wire budget automation UI (Growth) | Next week |
