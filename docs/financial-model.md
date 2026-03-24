# CalBridge Financial Model
*Built: March 2026 | Solo founder, bootstrapped | Amazon analytics SaaS*

---

## Assumptions & Ground Rules

Before the numbers: here's what this model is built on. Change any of these and re-run the math.

### Pricing Tiers
| Tier | Price/mo | Capacity | Notes |
|------|----------|----------|-------|
| Starter | $499 | Up to 5 brands | Entry point for small agencies |
| Pro | $999 | Up to 15 brands + portal + forecasting | Core product, biggest volume |
| Scale | $1,999 | Unlimited + white-label | For serious agencies |
| Enterprise | $5,000 avg | Custom | Modeled at $5k blended avg |

### Sales Motion
- **Primary channel:** Founder-led outbound + content marketing (LinkedIn, Amazon seller communities, podcasts)
- **No paid ads initially** — too early to know what converts
- **Abe's existing network:** 9% management fee agency clients = warm referral pipeline
- **Sales cycle:** ~3–6 weeks for SMB tiers, 8–16 weeks for Enterprise

### Churn Assumptions (researched)
- B2B SaaS targeting agencies typically runs **3–6% monthly churn** at early stage
- Mature B2B SaaS: **1.5–3% monthly**
- This model uses **5% conservative, 3.5% base, 2% aggressive** — reflecting that agencies are stickier than solo sellers (switching costs, white-label branding, client portals)

### Cost Assumptions
| Item | Monthly Cost |
|------|-------------|
| AWS / compute | $800 |
| Snowflake (data warehouse) | $1,200 |
| Amazon SP-API / data fees | $400 |
| SaaS tools (Stripe, Intercom, Loom, etc.) | $500 |
| Domain, email, misc | $100 |
| **Total infra + tools** | **$3,000/mo** |

---

## Model 1: MRR Growth (Months 1–24)

### Mix Assumptions by Scenario

**Conservative** — 1 new customer/month, mostly Starter
| Tier | % of new customers | Avg new/mo |
|------|--------------------|-----------|
| Starter | 60% | 0.6 |
| Pro | 30% | 0.3 |
| Scale | 10% | 0.1 |
| Enterprise | ~1 per 6 mo | 0.17 |

**Base** — 3 new customers/month, Starter/Pro split
| Tier | % of new customers | Avg new/mo |
|------|--------------------|-----------|
| Starter | 40% | 1.2 |
| Pro | 40% | 1.2 |
| Scale | 15% | 0.45 |
| Enterprise | ~1 per 3 mo | 0.33 |

**Aggressive** — 6 new customers/month, skewing Pro+
| Tier | % of new customers | Avg new/mo |
|------|--------------------|-----------|
| Starter | 25% | 1.5 |
| Pro | 45% | 2.7 |
| Scale | 20% | 1.2 |
| Enterprise | ~1 per 2 mo | 0.5 |

### Blended ARPU (Average Revenue Per User)
| Scenario | Blended ARPU/mo |
|----------|----------------|
| Conservative | ~$780 |
| Base | ~$980 |
| Aggressive | ~$1,180 |

### MRR Snapshot Table

*(Net MRR = new MRR added − churned MRR. Churn applied to active customer base each month.)*

**Conservative Scenario** (1 new customer/mo avg, 5% monthly churn)

| Month | Customers (cumul.) | Churned | Active | MRR |
|-------|--------------------|---------|--------|-----|
| 1 | 1 | 0 | 1 | $780 |
| 3 | 3 | 0 | 3 | $2,340 |
| 6 | 5 | 1 | 5 | **$3,900** |
| 9 | 7 | 1 | 6 | $4,680 |
| 12 | 10 | 2 | 8 | **$6,240** |
| 18 | 14 | 4 | 10 | **$7,800** |
| 24 | 18 | 6 | 12 | **$9,360** |

ARR at Month 24: **~$112k**

**Base Scenario** (3 new customers/mo avg, 3.5% monthly churn)

| Month | New Added | Churned | Active | MRR |
|-------|-----------|---------|--------|-----|
| 1 | 3 | 0 | 3 | $2,940 |
| 3 | 9 | 0 | 9 | $8,820 |
| 6 | 18 | 2 | 16 | **$15,680** |
| 9 | 27 | 4 | 23 | $22,540 |
| 12 | 36 | 7 | 29 | **$28,420** |
| 18 | 54 | 14 | 40 | **$39,200** |
| 24 | 72 | 22 | 50 | **$49,000** |

ARR at Month 24: **~$588k**

**Aggressive Scenario** (6 new customers/mo avg, 2% monthly churn)

| Month | New Added | Churned | Active | MRR |
|-------|-----------|---------|--------|-----|
| 1 | 6 | 0 | 6 | $7,080 |
| 3 | 18 | 1 | 17 | $20,060 |
| 6 | 36 | 3 | 33 | **$38,940** |
| 9 | 54 | 6 | 48 | $56,640 |
| 12 | 72 | 9 | 63 | **$74,340** |
| 18 | 108 | 17 | 91 | **$107,380** |
| 24 | 144 | 27 | 117 | **$138,060** |

ARR at Month 24: **~$1.66M**

### Summary Comparison

| Scenario | Month 6 MRR | Month 12 MRR | Month 18 MRR | Month 24 MRR | Month 24 ARR |
|----------|-------------|--------------|--------------|--------------|--------------|
| Conservative | $3,900 | $6,240 | $7,800 | $9,360 | $112k |
| Base | $15,680 | $28,420 | $39,200 | $49,000 | $588k |
| Aggressive | $38,940 | $74,340 | $107,380 | $138,060 | $1.66M |

> **Abe's reality check:** The base scenario requires closing 3 customers/month consistently from month 1. Given the existing agency network and warm pipeline, this is achievable — but only if sales is a daily priority, not a side activity. Conservative is the floor if CalBridge stays secondary to agency work.

---

## Model 2: Unit Economics

### CAC (Customer Acquisition Cost)

**Founder-led sales + content model — no paid ads:**

| Cost Item | Monthly | Annual |
|-----------|---------|--------|
| Founder time (80 hrs/mo @ $100/hr opportunity cost) | $8,000 | $96,000 |
| Content tools (Descript, Canva, scheduling) | $150 | $1,800 |
| Conference / networking | $300 | $3,600 |
| Outbound tools (Apollo, LinkedIn Sales Nav) | $200 | $2,400 |
| **Total sales & marketing spend** | **$8,650** | **$103,800** |

| Scenario | Customers/mo | Annual customers | CAC |
|----------|-------------|-----------------|-----|
| Conservative | 1 | 12 | **$8,650** |
| Base | 3 | 36 | **$2,883** |
| Aggressive | 6 | 72 | **$1,442** |

*Note: As founder time gets more efficient with better content + inbound, CAC drops fast. At 6 customers/month, the unit economics are excellent.*

### LTV by Tier

**Formula: LTV = ARPU × (1 / monthly churn rate)**

| Tier | ARPU/mo | Churn (base) | Avg Lifetime (mo) | LTV |
|------|---------|-------------|-------------------|-----|
| Starter | $499 | 3.5% | 28.6 mo | **$14,271** |
| Pro | $999 | 3.5% | 28.6 mo | **$28,571** |
| Scale | $1,999 | 3.5% | 28.6 mo | **$57,143** |
| Enterprise | $5,000 | 2% | 50 mo | **$250,000** |

*Enterprise gets a lower churn assumption — these are sticky, contract-based deals.*

### LTV:CAC Ratio

| Tier | LTV | CAC (Base) | LTV:CAC | Verdict |
|------|-----|-----------|---------|---------|
| Starter | $14,271 | $2,883 | **4.9x** | ✅ Healthy |
| Pro | $28,571 | $2,883 | **9.9x** | ✅ Excellent |
| Scale | $57,143 | $2,883 | **19.8x** | 🚀 Outstanding |
| Enterprise | $250,000 | $8,650 (founder-heavy) | **28.9x** | 🚀 Game-changing |

*Industry benchmark: LTV:CAC > 3x is good. > 5x is excellent. CalBridge is strong at Pro and above.*

### Payback Period

**Formula: CAC / ARPU = months to recover customer acquisition cost**

| Tier | CAC (Base) | ARPU | Payback (months) |
|------|-----------|------|-----------------|
| Starter | $2,883 | $499 | **5.8 months** |
| Pro | $2,883 | $999 | **2.9 months** |
| Scale | $2,883 | $1,999 | **1.4 months** |
| Enterprise | $8,650 | $5,000 | **1.7 months** |

> **Key insight:** Even Starter tier pays back in under 6 months. Pro and above are nearly instant ROI. This means CalBridge can grow without needing outside capital — every dollar recovered in 1–6 months can fund the next customer acquisition.

---

## Model 3: Break-Even Analysis

### Operating Cost Stack

| Stage | Monthly Costs | What's Included |
|-------|--------------|-----------------|
| **Current (solo)** | $3,000 | Infra + tools only |
| **First hire** | $10,500–$11,500 | + $7,500–8,500/mo salary (mid-level dev or growth hire) |
| **Second hire** | $18,000–$21,000 | + another $7,500–9,500/mo (CS or sales) |

### Break-Even MRR Thresholds

| Milestone | MRR Needed | Why |
|-----------|-----------|-----|
| **Cover infra costs** | $3,000 | 6 Starter, 3 Pro, or 2 Scale customers |
| **Pay yourself $5k/mo** | $8,000 | Infra + modest founder salary |
| **Pay yourself $10k/mo** | $13,000 | Real income parity while solo |
| **First hire justified** | $18,000–$22,000 | Infra + founder salary + new hire salary (with margin buffer) |
| **Second hire justified** | $30,000–$35,000 | Full team of 3, still profitable |

### Customer Count to Hit Each Threshold (Base ARPU ~$980)

| Milestone | MRR Target | Customers Needed |
|-----------|-----------|-----------------|
| Cover infra | $3,000 | 3–4 |
| Pay yourself $5k | $8,000 | 9–10 |
| Pay yourself $10k | $13,000 | 14–15 |
| First hire | $20,000 | 21–22 |
| Second hire | $33,000 | 34–35 |

### Timeline to First Hire (By Scenario)

| Scenario | Months to 22 customers | Est. Month |
|----------|----------------------|------------|
| Conservative | ~22 months | Month 22 |
| Base | ~8 months | Month 8 |
| Aggressive | ~4 months | Month 4 |

> **Decision trigger:** Hire when MRR is consistently above the threshold for 2+ months, not on a single good month. Runway should cover 6 months of burn even if growth stalls.

---

## Model 4: Combined Revenue Model

### Scenario: Agency Stays Flat at $45k/mo + CalBridge Scales

| Month | Agency Revenue | CalBridge MRR (Base) | Total Revenue | Growth vs. Month 1 |
|-------|---------------|---------------------|---------------|-------------------|
| 1 | $45,000 | $2,940 | $47,940 | — |
| 6 | $45,000 | $15,680 | $60,680 | +26% |
| 12 | $45,000 | $28,420 | $73,420 | +53% |
| 18 | $45,000 | $39,200 | $84,200 | +76% |
| 24 | $45,000 | $49,000 | $94,000 | +96% |

**At month 24 (base):** Near-doubling of total revenue without touching agency ops.

### Scenario: 3 Agency Clients Also Buy the Dashboard

Assume 3 existing agency clients convert to Pro tier ($999/mo each):

| Item | Amount |
|------|--------|
| Instant MRR from agency clients | **$2,997/mo** |
| Agency revenue retained | $45,000/mo |
| Effective CalBridge Month 1 MRR | $5,937 (vs. $2,940 without) |

**Month 24 combined (base + 3 agency clients on Pro):**
| Source | MRR |
|--------|-----|
| Agency revenue | $45,000 |
| CalBridge (base growth) | $49,000 |
| **Total** | **$94,000** |

*The 3 agency clients are already priced in base — but the strategic value is validation. They shorten your sales cycle for every future prospect.*

### What If Agency Revenue Grows Too?

Stretch case: Agency grows 10% YoY while CalBridge scales (base scenario):

| Month | Agency Revenue | CalBridge MRR | Total |
|-------|---------------|---------------|-------|
| 12 | $49,500 | $28,420 | $77,920 |
| 24 | $54,450 | $49,000 | $103,450 |

> **$100k+ total monthly revenue by month 24 is realistic in the base scenario** — without raising capital, without a team larger than 2–3 people, and while keeping the existing agency business running.

---

## Model 5: Sensitivity Table

### What Drives 24-Month ARR? Three levers:

**Lever 1: Churn Rate**
*(Holding base scenario constant: 3 new customers/mo, $980 ARPU)*

| Monthly Churn | Active Customers (Mo 24) | MRR (Mo 24) | ARR |
|--------------|--------------------------|-------------|-----|
| 2% | 64 | $62,720 | $752k |
| 3.5% (base) | 50 | $49,000 | $588k |
| 5% | 41 | $40,180 | $482k |
| 8% | 29 | $28,420 | $341k |

> Every 1% of monthly churn you eliminate is worth ~$70–90k in 24-month ARR at the base growth rate.

**Lever 2: Average Selling Price**
*(Holding constant: 3 new customers/mo, 3.5% churn, 50 active customers at month 24)*

| Avg Selling Price | MRR (Mo 24) | ARR |
|------------------|-------------|-----|
| $700 | $35,000 | $420k |
| $980 (base) | $49,000 | $588k |
| $1,200 | $60,000 | $720k |
| $1,500 | $75,000 | $900k |

> Moving from $700 to $1,200 ARPU (by closing more Pro/Scale deals vs. Starter) adds **$300k+ in ARR without acquiring a single additional customer.**

**Lever 3: New Customer Growth Rate**
*(Holding constant: 3.5% churn, $980 ARPU)*

| New Customers/mo | Active at Mo 24 | MRR (Mo 24) | ARR |
|-----------------|-----------------|-------------|-----|
| 1 | 12 | $11,760 | $141k |
| 3 (base) | 50 | $49,000 | $588k |
| 5 | 84 | $82,320 | $988k |
| 8 | 134 | $131,320 | $1.58M |

### Full Sensitivity Matrix: 24-Month ARR

*(Rows = new customers/mo | Columns = monthly churn)*

| Growth \ Churn | 2% | 3.5% | 5% | 8% |
|----------------|-----|------|-----|-----|
| 1/mo | $167k | $141k | $120k | $84k |
| 3/mo | $752k | $588k | $482k | $341k |
| 5/mo | $1.25M | $988k | $804k | $564k |
| 8/mo | $2.0M | $1.58M | $1.29M | $900k |

*(All cells assume $980 blended ARPU)*

---

## Decision Dashboard

A quick reference for where Abe should focus energy:

| Question | Answer |
|----------|--------|
| What MRR covers all costs so you stop bleeding? | **$3,000** |
| What MRR justifies founder salary ($10k/mo)? | **$13,000** |
| What MRR justifies hiring first employee? | **$20,000–22,000** |
| What MRR makes CalBridge the primary business? | **$30,000+** (surpassing agency income would require ~$45k+, but CalBridge generates margin; agency doesn't scale the same way) |
| Biggest lever to pull? | **Churn reduction + pushing Pro over Starter** |
| Best early win? | **Convert 3 agency clients to Pro ($3k MRR instantly, zero CAC)** |
| Time to first hire (base scenario)? | **~Month 8** |
| Realistic 24-month ARR? | **$500k–750k (base)** |
| Breakout 24-month ARR? | **$1.5M+ (aggressive)** |

---

## What to Watch Monthly

Track these 5 numbers like a hawk:

1. **Net new MRR** — new + expansion − churn. Positive = healthy.
2. **Monthly churn %** — if this creeps above 5%, pause growth and fix retention first.
3. **Blended ARPU** — is it going up (more Pro/Scale deals) or down (too many Starters)?
4. **CAC by channel** — which sources bring the most customers per hour of effort?
5. **Combined revenue** — agency + SaaS total. Are you actually building something additive?

---

*Last updated: March 2026. Revisit assumptions at month 3, 6, and 12 as real data replaces estimates.*
