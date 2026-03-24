# Decision Engine

## Overview

The decision engine (`src/services/decisionEngine.js`) analyzes each client's contribution margin and advertising data to surface actionable insights. It runs on-demand when the dashboard loads.

---

## Contribution Margin Tiers

| Tier | Formula | What it tells you |
|------|---------|-------------------|
| **CM1** | Revenue - COGS | Gross margin — is the product priced right vs cost? |
| **CM2** | CM1 - FBA Fees - Amazon Referral Fee | Margin after Amazon takes its cut |
| **CM3** | CM2 - Ad Spend | True profitability — what you actually keep |

**CM3 is the primary decision metric.**

### COGS Definition
COGS = **production/landed cost only** — the actual cost to manufacture and ship product to Amazon's warehouse.

**Do NOT include:**
- FBA fulfillment fees (deducted separately)
- Amazon referral fees (deducted separately)
- FBA storage fees
- Shipping from Amazon warehouse to customer

These are already captured from the Amazon APIs and deducted in CM2/CM3.

---

## Break-Even ACOS

Break-even ACOS is calculated automatically from the client's margin data — no manual input required.

```
Break-Even ACOS = (Revenue - COGS - FBA Fees) / Revenue
                = CM2 / Revenue
```

This represents the maximum percentage of revenue that can be spent on advertising before the product stops being profitable.

**Example:**
- Revenue: $50
- COGS: $10
- FBA Fees: $8
- CM2 = $32
- Break-Even ACOS = 32/50 = 64%

If actual ACOS is below 64%, the product is profitable after ads. Above 64%, you're losing money.

---

## Insight Types

### 🔴 Critical (danger)

**Negative CM3**
- Condition: `CM3 < 0`
- Meaning: Losing money on every sale after all costs
- Action: Reduce ad spend immediately

**Spend with no sales**
- Condition: Campaign spend > $100 with zero attributed sales
- Meaning: Money being wasted — no conversions
- Action: Pause campaign

### 🟡 Warnings

**ACOS above break-even**
- Condition: Actual ACOS > Break-Even ACOS (but CM3 still positive)
- Meaning: Spending more on ads than sustainable — margin shrinking
- Action: Optimize bids toward break-even ACOS

**High ACOS campaign**
- Condition: Campaign ACOS > 60%
- Meaning: Poorly performing campaign dragging overall ACOS up
- Action: Review targeting, pause or restructure

**ACOS spike**
- Condition: 3-day rolling average ACOS > 120% of 7-14 day baseline
- Meaning: Something changed — bidding issue, competition, listing problem
- Action: Investigate and review campaigns

**Budget over-pacing**
- Condition: Projected month-end spend > 110% of `monthly_ad_budget` setting
- Formula: `daily_rate = mtd_spend / day_of_month; projected = mtd_spend + (daily_rate × days_remaining)`
- Message: "Over-pacing: projected to overspend by X% ($Y vs $Z budget)"
- Action: Review campaign budgets

**Budget under-pacing**
- Condition: Projected month-end spend < 70% of `monthly_ad_budget` setting
- Message: "Under-pacing: only X% of budget on track to be used this month"
- Action: Review campaign budgets to ensure spend is being utilized

Budget pacing requires a `client_settings` table with:
```sql
client_id VARCHAR, setting_key VARCHAR, setting_value VARCHAR
-- Row: (client_id, 'monthly_ad_budget', '5000')
```

### 🟢 Opportunities

**Scale opportunity**
- Condition: CM3% > 15% AND actual ACOS < 50% of break-even ACOS
- Meaning: Product is highly profitable with room to increase ad spend profitably
- Metric: Headroom = (Break-Even ACOS - Actual ACOS) × Revenue = dollars available to spend on ads profitably

---

## Client Health Score

`src/services/healthScore.js` — Per-client health score (0–100) visible in admin panel.

| Component | Condition | Points |
|-----------|-----------|--------|
| CM Trend | 7-day avg CM% > 30-day avg (improving) | +20 |
| CM Trend | 7-day avg CM% < 30-day avg (declining) | −10 |
| ACOS vs Break-even | Actual ACOS ≤ break-even | +20 |
| ACOS vs Break-even | Actual ACOS > break-even | −15 |
| Data Freshness | Last successful sync < 24h ago | +20 |
| Data Freshness | Last successful sync < 48h ago | +10 |
| Amazon Connections | All 4 types connected | +20 |
| Login Recency | Logged in last 7 days | +20 |
| Login Recency | Logged in last 30 days | +10 |

Score is clamped to [0, 100].

**Admin badge display:**
- 80–100: 🟢 Healthy (green)
- 50–79: 🟡 Fair (yellow)
- 0–49: 🔴 At Risk (red)

**API:** `GET /admin/health-scores` — returns all active clients with score + breakdown.

---

## Vendor Central CM Model

⚠️ **Not yet fully implemented — under development**

Vendor Central has a different revenue model:

- Amazon issues a **Purchase Order** to the vendor
- Vendor ships inventory to Amazon
- Amazon pays **Shipped COGS** (their cost) to the vendor
- **Shipped COGS = the vendor's recognized revenue** (not the consumer price)

Therefore for Vendor clients:
```
CM1 = Shipped COGS - Vendor's product cost
CM2 = CM1 - Co-op fees - Damage allowances - Chargebacks
CM3 = CM2 - Ad Spend
```

This is different from Seller Central where consumer-facing revenue is used as the top line.

**Additional Vendor data needed:**
- Co-op fee rates
- Damage allowance rates
- Chargeback history

These will be pulled from the Vendor Central reports API when SP-API approval comes through.

---

## Future: One-Click Actions (Phase 6)

Currently action buttons show a "coming soon" message. Phase 6 will implement write-back to the Amazon Advertising API:

| Action | API Call |
|--------|---------|
| Pause Campaign | `PUT /v2/campaigns` → state: paused |
| Reduce Budget | `PUT /v2/campaigns` → dailyBudget: new value |
| Adjust Bids | `PUT /v2/keywords` → bid: new value |
| Increase Budget | `PUT /v2/campaigns` → dailyBudget: new value |

All write-back actions will require explicit confirmation in the UI before executing.
