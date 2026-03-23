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

## System

### GET /health
Health check — no auth required.

**Returns:** `{ status: "ok", ts: "<ISO timestamp>" }`
