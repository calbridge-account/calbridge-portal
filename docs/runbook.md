# CalBridge Portal — Runbook

## Production Deployment Checklist

Before going live or after any server rebuild, verify ALL of these:

### Required Environment Variables
Run this to check nothing is missing:
```bash
grep -E "^(SESSION_SECRET|LWA_CLIENT_ID|LWA_CLIENT_SECRET|SPAPI_PROD_CLIENT_ID|SPAPI_PROD_CLIENT_SECRET|SNOWFLAKE_ACCOUNT|SNOWFLAKE_USER|SNOWFLAKE_PASSWORD|RESEND_API_KEY|BASE_URL|NODE_ENV)" .env
```

Every one of these must be set:

| Variable | Purpose | Risk if missing |
|---|---|---|
| `SESSION_SECRET` | Signs session cookies | Sessions invalidated on every restart — users get logged out |
| `NODE_ENV=production` | Switches to prod APIs/credentials | Uses sandbox Amazon endpoints |
| `BASE_URL` | OAuth redirect URIs | Amazon OAuth callbacks fail |
| `LWA_CLIENT_ID` | Amazon Advertising OAuth | Ad connections fail |
| `LWA_CLIENT_SECRET` | Amazon Advertising OAuth | Ad connections fail |
| `SPAPI_PROD_CLIENT_ID` | SP-API production OAuth | Seller/Vendor connections fail |
| `SPAPI_PROD_CLIENT_SECRET` | SP-API production OAuth | Seller/Vendor connections fail |
| `SNOWFLAKE_ACCOUNT` | Database connection | Everything fails |
| `SNOWFLAKE_USER` | Database connection | Everything fails |
| `SNOWFLAKE_PASSWORD` | Database connection | Everything fails |
| `SNOWFLAKE_WAREHOUSE` | Database queries | Everything fails |
| `SNOWFLAKE_DATABASE` | Database queries | Everything fails |
| `SNOWFLAKE_SCHEMA` | Database queries | Everything fails |
| `RESEND_API_KEY` | Email sending | Failure alerts not sent |
| `EMAIL_FROM` | Email sender | Failure alerts not sent |
| `EMAIL_CC` | Alert recipient | Abe doesn't get alerts |

### PM2 Process
```bash
pm2 status                          # should show calbridge-portal as online
pm2 restart calbridge-portal --update-env   # always use --update-env after .env changes
pm2 save                            # persist process list across reboots
```

### Health Check
```bash
curl https://app.teamcalbridge.com/health
# Should return: {"status":"ok","ts":"..."}
```

### Nginx
```bash
sudo nginx -t                       # test config
sudo systemctl status nginx         # should be active
sudo systemctl reload nginx         # after config changes
```

### SSL Certificate
```bash
sudo certbot certificates           # check expiry (auto-renews every 90 days)
```

---

## Common Issues

### Users getting logged out on restart
**Cause:** `SESSION_SECRET` not set or changed between restarts.
**Fix:** Ensure `SESSION_SECRET` is set in `.env` and never changes. Generate once: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`

### OAuth callback fails
**Cause:** `BASE_URL` not set or wrong. Must match exactly what's registered in Amazon Developer Console.
**Fix:** `BASE_URL=https://app.teamcalbridge.com` in `.env`

### Scheduler hitting Amazon APIs with demo tokens
**Cause:** Demo/test clients in the database with fake tokens.
**Fix:** Scheduler already skips clients whose access tokens start with `demo-`. For real clients, tokens come from OAuth and are always valid.

### Snowflake connection timeout
**Cause:** Warehouse auto-suspended (normal). First query after idle period takes 5-10 seconds to resume.
**Fix:** Expected behavior — warehouse auto-resumes. No action needed.

### Ingestion failing with 401
**Cause:** Client's Amazon access token expired and refresh failed (token revoked or app not approved).
**Fix:** Client needs to reconnect via Account → Connections. They'll receive an alert email.

---

## Onboarding a New Client

1. Create their account via `/auth/signup` or manually insert into `clients` table
2. Send them the portal URL: `https://app.teamcalbridge.com`
3. They log in and connect their Amazon accounts under Account → Connections
4. First sync runs automatically within 6 hours (or trigger manually via POST `/dashboard/sync`)
5. They upload their COGS via Account → Cost of Goods template
6. Dashboard populates with real data

---

## Server Info

| Item | Value |
|---|---|
| Server IP | 172.179.10.131 |
| Portal URL | https://app.teamcalbridge.com |
| PM2 Process | calbridge-portal |
| App Port | 3000 |
| Workspace | /home/azureuser/.openclaw/workspace |
| Nginx Config | /etc/nginx/sites-available/calbridge-portal |
| SSL Certs | /etc/letsencrypt/live/app.teamcalbridge.com/ |
| Logs | pm2 logs calbridge-portal |
| GitHub Repo | https://github.com/calbridge-account/calbridge-portal |
