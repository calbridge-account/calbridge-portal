# CalBridge Portal — API Reference

Base URL: `https://teamcalbridge.com` (prod) / `http://localhost:3000` (dev)

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

### GET /dashboard
Client dashboard data. Requires auth.
_(Snowflake data coming in Phase 3)_

---

## Billing

All routes require auth unless noted.

### GET /billing/plans _(public, no auth required)_
Return the three plan definitions.

**Returns:**
```json
{
  "plans": [
    { "id": "starter", "name": "Starter", "price": 149, "priceMonthly": "$149/mo", "description": "...", "features": [...] },
    { "id": "growth",  "name": "Growth",  "price": 299, ... },
    { "id": "pro",     "name": "Pro",     "price": 499, ... }
  ]
}
```

### POST /billing/create-checkout
Create a Stripe checkout session and return the checkout URL.

**Body:** `{ planId: 'starter' | 'growth' | 'pro' }`
**Returns:** `{ checkoutUrl }` — redirect the user to this URL
**Errors:** `503` if `STRIPE_SECRET_KEY` is not configured, `400` for invalid planId

### GET /billing/success
Stripe redirect after successful payment. Updates subscription in Snowflake, then redirects to `/billing.html?status=success`.

**Query params:** `session_id` (provided by Stripe)

### GET /billing/cancel
Stripe redirect after cancelled checkout. Redirects to `/billing.html?status=cancelled`.

### POST /billing/webhook _(raw body — no JSON middleware)_
Handle Stripe webhook events. Must be registered in Stripe dashboard pointing to `POST /billing/webhook`.

**Events handled:**
- `customer.subscription.created` — record new subscription
- `customer.subscription.updated` — update plan/status
- `customer.subscription.deleted` — mark as cancelled
- `invoice.payment_failed` — mark as past_due

**Headers:** `Stripe-Signature` (verified against `STRIPE_WEBHOOK_SECRET`)

### GET /billing/status
Return current subscription status for logged-in client.

**Returns:**
```json
{
  "plan": "growth",
  "status": "active",
  "trialEndsAt": null,
  "subscriptionEndsAt": "2026-04-23T00:00:00Z",
  "hasCustomer": true,
  "hasSubscription": true
}
```

---

## Account

All routes require auth.

### POST /account/complete-onboarding
Mark onboarding as completed for the logged-in client.

**Returns:** `{ message: 'Onboarding completed' }`

_(See existing account endpoints in account.js for profile, logo, password, and team management.)_

---

## System

### GET /health
Health check — no auth required.

**Returns:** `{ status: "ok", ts: "<ISO timestamp>" }`
