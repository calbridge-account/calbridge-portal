# CalBridge Portal — API Reference

Base URL: `https://app.teamcalbridge.com` (prod) / `http://localhost:3000` (dev)

---

## Auth

### POST /auth/signup
Create a new client account.

**Body:** `{ name, email, password }`
**Returns:** `{ message, client: { id, email, name } }`
**Session:** Created on success

### POST /auth/login
Log in to an existing account.

**Body:** `{ email, password }`
**Returns:** `{ message, client: { id, email, name } }`
**Errors:** `401` on bad credentials

### POST /auth/logout
End the current session. Requires auth.

### GET /auth/me
Get current logged-in client. Requires auth.

**Returns:** `{ client: { id, email, name } }`

### POST /auth/forgot-password
Request a password reset email.

**Body:** `{ email }`
**Returns:** `{ message }` — always 200, does not reveal whether email exists
**Notes:** Token valid for 1 hour. Reset email sent via Resend from ash@teamcalbridge.com.

### POST /auth/reset-password
Set a new password using a valid reset token.

**Body:** `{ token, password }`
**Returns:** `{ message }` on success
**Errors:** `400` if token is invalid or expired, password < 8 chars

---

## Amazon Connections

All routes require auth.

### GET /amazon/connect/:type
Redirect to Amazon OAuth consent screen.

**type:** `ads` | `dsp` | `seller` | `vendor`
**Redirects to:** Amazon LWA authorization URL

### GET /amazon/callback/:type
OAuth callback — exchange code for tokens. Called by Amazon after client authorizes.

**Query params:** `code`, `state`, `selling_partner_id` (seller/vendor only)
**On success:** Redirects to `/dashboard?connected=<type>`

### GET /amazon/status
Get connection status for all 4 Amazon integrations.

**Returns:**
```json
{
  "ads":    { "connected": true,  "label": "Amazon Ads",            "connectedAt": "...", "expiresAt": "..." },
  "dsp":    { "connected": false, "label": "Amazon DSP" },
  "seller": { "connected": true,  "label": "Amazon Seller Central", "connectedAt": "...", "expiresAt": "...", "sellingPartnerId": "..." },
  "vendor": { "connected": false, "label": "Amazon Vendor Central" }
}
```

---

## Dashboard

All routes require auth.

### GET /dashboard/summary?days=30
Overview KPIs: total retail sales, ad attributed sales, ad spend, total ROAS, ACOS, and CM1/CM2/CM3 waterfall breakdown.

**Returns:**
```json
{
  "totalRetailSales": 42500,
  "sellerRevenue": 35000,
  "vendorRevenue": 7500,
  "totalUnits": 840,
  "totalAdSales": 18200,
  "totalAdSpend": 4200,
  "totalAdOrders": 320,
  "adRoas": 4.33,
  "acos": 0.231,
  "totalRoas": 10.12,
  "cmBreakdown": {
    "revenue": 42500, "cogs": 8500, "fbaFees": 6375, "adSpend": 4200,
    "cm1": 34000, "cm2": 27625, "cm3": 23425
  },
  "days": 30
}
```

### GET /dashboard/performance?days=30&limit=10
Top and bottom performers by contribution margin.

**Returns:** `{ topPerformers, bottomPerformers, days }`

### GET /dashboard/sales-performance?days=30
Top 10 ASINs by revenue, daily sales trend, and channel split (Seller vs Vendor).

**Returns:**
```json
{
  "topAsins": [{ "asin": "B001...", "productName": "...", "units": 120, "revenue": 4500 }],
  "dailyTrend": [{ "date": "2026-03-01", "revenue": 1420, "units": 28 }],
  "channelSplit": [{ "channel": "seller", "revenue": 35000, "units": 700 }],
  "days": 30
}
```

### GET /dashboard/asin/:asin?days=90
Contribution margin trend for a specific ASIN.

### POST /dashboard/sync
Manually trigger a full data sync (runs in background).

**Returns:** `{ message, clientId }`

---

## Decisions / Decision Engine

All routes require auth.

### GET /decisions?days=30
Run the decision engine. Returns insights, alerts, and recommendations.
Includes: negative margin alerts, ACOS above break-even, spend with no sales, ACOS spikes,
budget pacing alerts (over/under-pacing), and scale opportunities.

**Returns:**
```json
{
  "summary": {
    "totalAsins": 12, "losingMoney": 2, "overSpending": 3,
    "opportunities": 1, "alertCount": 5,
    "breakEvenByAsin": [{ "asin": "...", "breakEvenAcos": 0.64, "actualAcos": 0.42, "status": "healthy" }]
  },
  "insights": [
    {
      "type": "danger|warning|opportunity",
      "category": "negative_margin|acos_above_breakeven|budget_overpacing|...",
      "title": "...",
      "message": "...",
      "action": { "label": "...", "type": "...", "asin": "..." }
    }
  ]
}
```

**Budget pacing categories:**
- `budget_overpacing` — projected spend > 110% of monthly budget
- `budget_underpacing` — projected spend < 70% of monthly budget
- Requires `client_settings` table with `monthly_ad_budget` entry

---

## Advertising

All routes require auth.

### GET /advertising/overview?days=30
Advertising overview: total spend, sales, ACOS, ROAS, impressions, clicks, daily trends.

### GET /advertising/campaigns?days=30
Campaign-level performance breakdown.

---

## Campaigns

All routes require auth.

### GET /campaigns?days=30
List all campaigns with aggregated performance metrics.

**Fields:** `CAMPAIGN_ID`, `CAMPAIGN_NAME`, `CAMPAIGN_TYPE`, `CONNECTION_TYPE`, `STATUS`, `BUDGET`, `IMPRESSIONS`, `CLICKS`, `SPEND`, `SALES`, `ORDERS`, `ACOS`, `ROAS`, `CTR`, `CPC`

### GET /campaigns/:id?days=30
Single campaign detail with daily performance trend and pending actions.

### POST /campaigns/:id/pause
**GATED** — queues a pause action. Returns `{ status: 'queued', actionId }`

### POST /campaigns/:id/resume
**GATED** — queues a resume action.

### PATCH /campaigns/:id/budget
**GATED** — queues a budget update. Body: `{ budget: number }`

### PATCH /campaigns/:id/bids
**GATED** — queues a bid update. Body: `{ bid: number }`

---

## Account

All routes require auth.

### GET /account/profile
Get client profile: name, email, company, logo URL, connections.

### PATCH /account/profile
Update profile fields.

### POST /account/change-password
Change password. Body: `{ currentPassword, newPassword }`

### POST /account/complete-onboarding
Mark onboarding as completed.

---

## COGS

All routes require auth.

### GET /cogs
List all COGS entries for the client.

### POST /cogs/upload
Upload COGS via CSV. Columns: `asin`, `cogs`. Updates products table.

### PUT /cogs/:asin
Update COGS for a single ASIN. Body: `{ cogs: number }`

### DELETE /cogs/:asin
Remove COGS entry for an ASIN.

---

## Billing

### GET /billing/plans _(no auth required)_
Return the three plan definitions.

**Returns:** `{ plans: [{ id, name, price, priceMonthly, description, features }] }`

### POST /billing/create-checkout
Create a Stripe checkout session.

**Body:** `{ planId: 'starter' | 'growth' | 'pro' }`
**Returns:** `{ checkoutUrl }`

### GET /billing/status
Return current subscription status.

**Returns:** `{ plan, status, trialEndsAt, subscriptionEndsAt, hasCustomer, hasSubscription }`

### POST /billing/webhook _(raw body)_
Handle Stripe webhook events. Register in Stripe dashboard.

---

## Admin

Admin routes require admin session (POST /admin/login).

### POST /admin/login
Authenticate as admin.

**Body:** `{ email, password }`

### GET /admin/clients
List all clients with status, email, company, signup date.

### GET /admin/health-scores
Health score (0–100) for all active clients with component breakdown.

**Returns:**
```json
[{
  "clientId": "...",
  "score": 75,
  "breakdown": {
    "cmTrend": 20,           // +20 improving, -10 declining, 0 flat
    "acosVsBreakEven": -15,  // +20 below break-even, -15 above
    "dataFreshness": 20,     // +20 last 24h, +10 last 48h, 0 older
    "amazonConnections": 20, // +20 if all 4 connected
    "loginRecency": 10       // +20 last 7 days, +10 last 30 days
  }
}]
```

### POST /admin/approve/:clientId
Approve a pending client and send notification email.

### POST /admin/suspend/:clientId
Suspend a client.

### POST /admin/invite
Pre-create approved account and send invite email.

**Body:** `{ email, name, companyName }`

### GET /admin/logs
Recent ingestion logs across all clients (last 100).

### POST /admin/send-weekly-reports
Trigger weekly email reports for all eligible active clients (background).

### POST /admin/test-weekly-report/:clientId
Send a test weekly report to abe@teamcalbridge.com.

### GET /admin/users _(superadmin only)_
List all admin users.

### POST /admin/users _(superadmin only)_
Create a new admin user. Body: `{ email, name, password, role: 'admin'|'superadmin' }`

### DELETE /admin/users/:adminId _(superadmin only)_
Remove an admin user.

---

## AI Chat

Requires auth. Gated on `OPENROUTER_API_KEY`.

### POST /chat
Send message to AI assistant. Returns response based on client's CM data, top ASINs, and alerts.

**Body:** `{ message: string }`
**Returns:** `{ reply: string }`

### GET /chat/history
Return current session conversation history.

### DELETE /chat/history
Clear conversation history.

---

## System

### GET /health
Health check (no auth required).

**Returns:** `{ status: "ok", ts: "<ISO timestamp>" }`
