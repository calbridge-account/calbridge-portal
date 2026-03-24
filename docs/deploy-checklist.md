# CalBridge Deploy Checklist

## Exact PM2 Start Command

```bash
# Standard restart (use this for code deploys):
pm2 restart calbridge-portal --update-env

# First-time start (if process doesn't exist):
cd /home/azureuser/.openclaw/workspace
pm2 start src/server.js --name calbridge-portal --env production
pm2 save
```

## Correct Deploy Order

For a full environment rebuild or schema migration:

```bash
# 1. Pull latest code
cd /home/azureuser/.openclaw/workspace
GIT_ASKPASS=/bin/true git -c credential.helper='' pull https://$(grep GITHUB_TOKEN .env | cut -d= -f2)@github.com/calbridge-account/calbridge-portal.git main

# 2. Install dependencies (if package.json changed)
npm install --production

# 3. Run schema migration (safe to re-run — idempotent after fix)
node src/models/initSchema.js

# 4. [OPTIONAL] Seed test data (SANDBOX only — never run in PROD schema)
# node src/models/seedData.js

# 5. Restart PM2 with updated env
pm2 restart calbridge-portal --update-env
pm2 save

# 6. Verify health
curl https://app.teamcalbridge.com/health
```

## Post-Deploy Verification Steps

```bash
# Health check
curl -s https://app.teamcalbridge.com/health
# Expected: {"status":"ok","ts":"..."}

# Check PM2 is running
pm2 status
# Expected: calbridge-portal | online

# Check logs for startup errors
pm2 logs calbridge-portal --lines 30

# Verify key routes respond correctly
curl -s -o /dev/null -w "%{http_code}" https://app.teamcalbridge.com/
# Expected: 200

curl -s -o /dev/null -w "%{http_code}" https://app.teamcalbridge.com/brands/plan-info
# Expected: 401 (authentication required — not 404)

curl -s -o /dev/null -w "%{http_code}" https://app.teamcalbridge.com/recommendations/summary
# Expected: 401 (authentication required — not 404)

# Check billing plans (public route)
curl -s https://app.teamcalbridge.com/billing/plans | python3 -m json.tool | head -10
# Expected: JSON with plan definitions

# Check scheduler started
pm2 logs calbridge-portal --lines 50 | grep Scheduler
# Expected: "[Scheduler] Started — full sync every 6 hours"
```

## Rollback Procedure

```bash
# 1. Find last good commit
git log --oneline -10

# 2. Checkout last good commit
git checkout <commit-hash>

# 3. Restart
pm2 restart calbridge-portal --update-env
```

## Environment Variable Check

Before deploy, verify these are set in `.env`:

```bash
grep -E "^(SESSION_SECRET|LWA_CLIENT_ID|LWA_CLIENT_SECRET|SPAPI_PROD_CLIENT_ID|SPAPI_PROD_CLIENT_SECRET|SNOWFLAKE_ACCOUNT|SNOWFLAKE_USER|SNOWFLAKE_PASSWORD|BASE_URL|NODE_ENV|RESEND_API_KEY|OPENROUTER_API_KEY)" .env
```

Critical values:
- `NODE_ENV=production` — switches to prod Amazon API endpoints
- `BASE_URL=https://app.teamcalbridge.com` — used for OAuth redirect URIs
- `SESSION_SECRET` — must be long and random (currently set ✅)
- `SNOWFLAKE_SCHEMA` — currently `SANDBOX`; change to `PROD` when ready for production data

## Notes

- **Session store**: Currently uses in-memory MemoryStore (default express-session).
  Acceptable for single-instance deployment. For multi-instance scaling, migrate to
  `connect-pg-simple` or Redis. Package `connect-pg-simple` is already in package.json.

- **Scheduler**: Runs in the same process as the web server. If `ENABLE_SCHEDULER=false`
  is set in `.env`, the scheduler is disabled (useful for maintenance windows).

- **Amazon OAuth state**: State tokens are stored in-memory. An app restart mid-OAuth flow
  will invalidate pending states. Users will need to restart the connection flow.
  For high availability, migrate to Redis for state storage.

- **Stripe**: Using test mode keys (`sk_test_...`). Switch to live keys when billing goes live.
