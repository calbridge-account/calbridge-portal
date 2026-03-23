# Snowflake — Data Pipeline & Schema

## Connection Details

| Setting | Value |
|---------|-------|
| Account | <SNOWFLAKE_ACCOUNT> |
| Host | <SNOWFLAKE_ACCOUNT>.snowflakecomputing.com |
| Warehouse | CALBRIDGE_WH (X-Small, auto-suspend 60s) |
| Database | CALBRIDGE |
| Schemas | SANDBOX (dev), PROD (production) |
| Service User | CALBRIDGE_SVC |
| Role | CALBRIDGE_PORTAL |

## Tables

| Table | Description |
|-------|-------------|
| `clients` | Client accounts (mirrors app auth) |
| `amazon_connections` | OAuth tokens per client per connection type |
| `ad_campaigns` | Campaign metadata from Ads + DSP |
| `ad_performance` | Daily campaign metrics (impressions, clicks, spend, sales, ACOS, ROAS) |
| `products` | Product catalog from Seller/Vendor Central |
| `sales` | Daily sales by ASIN from Seller/Vendor Central |
| `contribution_margin` | Calculated CM per ASIN per day |
| `ingestion_log` | Pipeline run history and error tracking |

## Multi-Tenancy

Every table has a `client_id` column. All queries **must** filter by `client_id`. No client can ever see another client's data.

## Schema Setup

To initialize schema in a new environment:
```bash
SNOWFLAKE_SCHEMA=SANDBOX node src/models/initSchema.js
SNOWFLAKE_SCHEMA=PROD node src/models/initSchema.js
```

## Contribution Margin Formula

```
CM = Revenue - Ad Spend - FBA Fees - COGS - Other Costs
CM% = (CM / Revenue) * 100
```

- **Revenue** → from `sales` table (Seller/Vendor Central)
- **Ad Spend** → from `ad_performance` table (Ads/DSP)
- **FBA Fees** → from `products` table (or SP-API fees endpoint)
- **COGS** → client-provided, stored in `products.cogs`

## Ingestion Pipeline

Each ingestion job:
1. Fetches client's valid access token (auto-refreshes if needed)
2. Calls Amazon API
3. Transforms response to match schema
4. Writes to Snowflake via MERGE (upsert — safe to re-run)
5. Logs result to `ingestion_log`

On failure: retries 3x with exponential backoff, then alerts ash@teamcalbridge.com

## Warehouse Notes

- X-Small is sufficient for ingestion workloads
- Auto-suspends after 60 seconds idle
- Auto-resumes on query — no manual intervention needed
- Upgrade to Small if query times become slow at scale
