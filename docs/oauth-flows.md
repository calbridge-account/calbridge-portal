# Amazon OAuth Flows

## Login with Amazon (LWA)

Both the Advertising API and SP-API use LWA for OAuth 2.0.

### Credentials (stored in .env)

```
LWA_CLIENT_ID=<CLIENT_ID>
LWA_CLIENT_SECRET=<CLIENT_SECRET>
```

### Redirect URIs (register these in Amazon Developer Console)

```
https://teamcalbridge.com/amazon/callback/ads
https://teamcalbridge.com/amazon/callback/spapi
```

For sandbox/dev:
```
http://localhost:3000/amazon/callback/ads
http://localhost:3000/amazon/callback/spapi
```

---

## Advertising API OAuth

**Scope:** `advertising::campaign_management`

**Connect URL:** `GET /amazon/connect/ads`
**Callback URL:** `GET /amazon/callback/ads`

**Token storage per client:**
```json
{
  "accessToken": "...",
  "refreshToken": "...",
  "expiresAt": "2026-03-24T18:00:00.000Z"
}
```

Access tokens expire in 1 hour. Refresh tokens do not expire unless revoked.

---

## SP-API OAuth (Seller/Vendor Central)

**Scope:** `sellingpartnerapi::migration`

**Connect URL:** `GET /amazon/connect/spapi`
**Callback URL:** `GET /amazon/callback/spapi`

**Additional data captured:** `selling_partner_id` (Amazon's internal seller ID)

**Token storage per client:**
```json
{
  "accessToken": "...",
  "refreshToken": "...",
  "expiresAt": "2026-03-24T18:00:00.000Z",
  "sellingPartnerId": "A1B2C3D4E5F6G7"
}
```

---

## Token Refresh

All ingestion jobs call `amazonAuthService.refreshAccessToken(refreshToken)` before making API calls if `expiresAt` is within 5 minutes.

If refresh fails (token revoked), the ingestion job logs the failure and triggers an alert email to `ash@teamcalbridge.com` (CC: `abe@teamcalbridge.com`) notifying that the client needs to reconnect.

---

## Security Notes

- OAuth state tokens are single-use (deleted from store after callback)
- State tokens expire after 10 minutes (enforced in prod)
- Refresh tokens stored encrypted at rest (implementation: Phase 3)
- Tokens never exposed in API responses or logs
