# CalBridge Deploy Checklist

## Exact PM2 Start Command

```bash
# Standard restart (use this for code deploys):
pm2 restart calbridge-portal --update-env

# First-time start using ecosystem file (preferred):
cd /home/azureuser/.openclaw/workspace
pm2 start ecosystem.config.js --env production
pm2 save

# First-time start (legacy — if ecosystem file not yet deployed):
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

# 2. Install dependencies (always run — express-rate-limit was added)
npm install --production

# 3. Run schema migration (safe to re-run — idempotent)
#    This now also creates: sessions, admin_config tables
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

- **Session store**: Now uses `SnowflakeStore` (Snowflake-backed). Sessions persist across
  restarts and server reboots. The `sessions` table is auto-created on startup. No manual
  migration needed. **Schema migration** (`node src/models/initSchema.js`) creates the table
  explicitly; safe to run before first deploy with this change.

- **Rate limiting**: `express-rate-limit` was added to package.json. Run `npm install` before
  restarting. General API routes: 200 req/15min. Auth endpoints: 20 req/15min. Static files
  (HTML/CSS/JS) are NOT rate-limited.

- **Scheduler**: Runs in the same process as the web server. If `ENABLE_SCHEDULER=false`
  is set in `.env`, the scheduler is disabled (useful for maintenance windows).

- **Amazon OAuth state**: State tokens are stored in-memory. An app restart mid-OAuth flow
  will invalidate pending states. Users will need to restart the connection flow.
  For high availability, migrate to Redis for state storage.

- **Stripe**: Using test mode keys (`sk_test_...`). Switch to live keys when billing goes live.
