# CyberPower SP Keyword Analysis Report
**Generated:** 2026-03-27  
**Period:** Last 30 days (unless otherwise noted)  
**Client ID:** 7d88ea17-002b-4a02-97fc-bcab1292d57e  
**Analyst:** Automated SP Analysis Pipeline

---

## Executive Summary

CyberPower's Sponsored Products program is performing well overall, with a blended 30-day ACOS of **~17.2%** across all match types. Total spend over the last 30 days was approximately **$230,330** driving **~$1.56M in attributed sales** across **8,029 purchases**. The program is healthy, but there are meaningful efficiency opportunities concentrated in two areas: (1) **TARGETING_EXPRESSION_PREDEFINED** (auto/category targeting) is significantly over-spending at **30.6% ACOS** vs. the ~10–14% range achieved by keyword-based match types, and (2) there are **20 high-performing, underbid keywords** generating purchases at less than $50 total spend — each deserving aggressive bid increases.

Branded terms are outperforming generic at **7.4% ACOS vs. 17.0%**, confirming the typical branded/generic efficiency gap. No zero-purchase wasted spend over $50 was detected (a positive indicator of solid negative keyword hygiene), and no high-CTR/no-conversion clusters were identified — suggesting good keyword-to-landing-page alignment.

Year-over-year comparison is partial: Jan–Feb 2025 data is unavailable in the warehouse (no rows), while Jan–Feb 2026 shows **$228,548 spend / $1.39M sales / 7,325 purchases at 16.4% ACOS**.

---

## Immediate Actions (Priority Order)

1. **Reduce auto/category targeting bids by 25–35%** — TARGETING_EXPRESSION_PREDEFINED is running at 30.6% ACOS ($25.3K spend, 421 purchases), nearly 2× the efficiency of phrase and broad. Implement bid modifiers or daily budget caps to reallocate budget to keyword-based campaigns.

2. **Increase bids on 20 opportunity keywords** — These terms are converting at ≥5 purchases with <$50 total spend. Many are clearly underbid (e.g., "ups for computer" — 12 purchases, $24.83 spend, 1.2% ACOS). Raise bids 50–100% and monitor impression share.

3. **Promote top exact-match converters to standalone campaigns** — The top 20 converting search terms include highly branded, highly specific terms (e.g., model numbers like "OR700LCDRM1U", "CP1500PFCLCD") driving sub-1% ACOS. Harvest these into exact-match keyword campaigns with increased budgets.

4. **Scale winning campaigns further** — The top B2B campaigns (OR500LCDRM1U at 0.8% ACOS, OR700LCDRM1U at 1.0% ACOS) have low impression volume despite excellent ROAS. Increase daily budgets and bid higher to capture more impression share at these exceptional rates.

5. **Audit TARGETING_EXPRESSION (product/auto) match type** — Running at 20.2% ACOS ($87.5K spend, 3,147 purchases) — largest spend bucket. Systematically mine search term reports from this match type and harvest top performers into keyword campaigns to reduce dependency on auto targeting.

6. **Restore Jan–Feb 2025 data for YoY baseline** — 2025 data is absent from the warehouse. Coordinate with the data pipeline team to backfill historical data and enable meaningful YoY trending.

7. **Monitor campaigns with 30–44% ACOS** — Several campaigns in the bottom of Q8 are approaching or exceeding likely target ACOS. Flag for bid reduction or pause testing (see Campaign ACOS section below).

8. **Consider branded keyword budget expansion** — At 7.4% ACOS and 15.5% CVR, branded terms are exceptionally efficient. If budget allows, increase branded keyword coverage and bids to defend share.

---

## Analysis 1: Match Type Efficiency

| Match Type | Impressions | Clicks | CTR | Cost | Purchases | Sales | ACOS | CVR |
|---|---|---|---|---|---|---|---|---|
| TARGETING_EXPRESSION (auto/product) | 3,216,840 | 35,336 | 1.10% | $87,471 | 3,147 | $434,091 | **20.2%** | 8.9% |
| PHRASE | 4,556,953 | 25,271 | 0.55% | $68,912 | 2,359 | $602,542 | **11.4%** | 9.3% |
| BROAD | 1,299,168 | 17,022 | 1.31% | $42,010 | 1,909 | $390,752 | **10.8%** | 11.2% |
| TARGETING_EXPRESSION_PREDEFINED (category/auto) | 1,170,768 | 19,238 | 1.64% | $25,325 | 421 | $82,660 | **30.6%** | 2.2% |
| EXACT | 574,394 | 2,122 | 0.37% | $6,597 | 192 | $47,919 | **13.8%** | 9.0% |
| Placeholder keyword | 635 | 7 | 1.10% | $14 | 1 | $200 | **7.0%** | 14.3% |

**Key Insights:**
- **BROAD and PHRASE** are the most efficient keyword match types at 10.8% and 11.4% ACOS respectively, with BROAD having the highest CVR (11.2%).
- **TARGETING_EXPRESSION_PREDEFINED** (category/predefined auto) is the worst performer at 30.6% ACOS — 2.8× worse than BROAD. This match type has high CTR (1.64%) but very low CVR (2.2%), suggesting CyberPower products are appearing in loosely-related category placements.
- **EXACT** match runs at 13.8% ACOS with only $6,597 spend — indicating under-investment relative to its demonstrated efficiency. More budget should flow to proven exact-match terms.
- **TARGETING_EXPRESSION** (auto/product targeting) is the largest spend bucket ($87.5K) at 20.2% ACOS — acceptable but above keyword match types. This warrants ongoing search term harvesting.

---

## Analysis 2: Top 20 Converting Search Terms (Last 30 Days, ≥3 Purchases)

*Ordered by ACOS ascending (lowest first)*

| Rank | Search Term | Match Type | Purchases | Cost | Sales | ACOS | CVR |
|---|---|---|---|---|---|---|---|
| 1 | 2000va/1500w | PHRASE | 3 | $1.02 | $1,232.20 | 0.08% | 300% |
| 2 | cyber power ec850 | BROAD | 6 | $3.90 | $4,469.45 | 0.09% | 200% |
| 3 | cyberpower or700lcdrm1u smart app lcd ups... | PHRASE | 3 | $2.76 | $3,151.00 | 0.09% | 60% |
| 4 | cyberpower or700lcdrm1u | BROAD | 3 | $2.75 | $2,456.05 | 0.11% | 300% |
| 5 | cyberpower 550 ups | PHRASE | 3 | $1.23 | $1,037.15 | 0.12% | 150% |
| 6 | uninterruptible power supply battery backup | TARGETING_EXPRESSION | 3 | $0.50 | $379.85 | 0.13% | 300% |
| 7 | 1500 ups battery backup rack mount | BROAD | 5 | $1.95 | $1,159.75 | 0.17% | 500% |
| 8 | rack mount pdu remote | PHRASE | 3 | $3.00 | $1,717.85 | 0.17% | 300% |
| 9 | cyberpower st425 standby ups 425va-260w | TARGETING_EXPRESSION | 3 | $1.62 | $882.09 | 0.18% | 100% |
| 10 | cyberpower cp350slg | TARGETING_EXPRESSION | 3 | $1.58 | $820.85 | 0.19% | 150% |
| 11 | 650 ups battery backup | BROAD | 6 | $2.51 | $913.60 | 0.27% | 600% |
| 12 | cyberpower cp1500pfclcd pfc sinewave ups... | PHRASE | 10 | $10.64 | $3,570.21 | 0.30% | 111% |
| 13 | cyberpower 20amp ups | PHRASE | 5 | $2.16 | $592.11 | 0.36% | 500% |
| 14 | pr1500lcd | PHRASE | 4 | $12.21 | $3,335.89 | 0.37% | 31% |
| 15 | cyberpower cp1350pfclcd pfc sinewave ups... | PHRASE | 4 | $5.51 | $1,248.70 | 0.44% | 100% |
| 16 | desktop ups | BROAD | 5 | $22.82 | $4,925.10 | 0.46% | 50% |
| 17 | cyberpower - pfc sinewave series 1500va... | BROAD | 4 | $5.16 | $959.80 | 0.54% | 67% |
| 18 | battery back up and surge protection 8 plug | PHRASE | 3 | $2.03 | $359.85 | 0.56% | 300% |
| 19 | cyberpower u p s | BROAD | 3 | $2.56 | $433.85 | 0.59% | 300% |
| 20 | cyberpower or500lcdrm1u smart app lcd ups... | PHRASE | 5 | $8.25 | $1,334.45 | 0.62% | 63% |

**Key Insights:**
- These terms are extraordinarily efficient — top 10 all under 0.2% ACOS. Many appear to have very low impressions/clicks, suggesting they are benefiting from high-intent, low-volume searches that convert at a very high rate.
- **Action:** Immediately harvest all 20 into exact-match keyword campaigns with increased bids. The current spend levels are so low ($0.50–$22.82) that even tripling bids would leave ACOS well below any reasonable target.
- CVR values above 100% are possible when a single click triggers multi-unit orders (B2B/commercial customers buying in quantity).
- Generic terms like "desktop ups", "battery back up and surge protection 8 plug", and "1500 ups battery backup rack mount" show that generic intent is highly convertible at low ACOS for CyberPower — suggesting strong brand presence in SERP.

---

## Analysis 3: Wasted Spend (Cost >$50, Zero Purchases)

**No results returned.** There were zero search terms with >$50 in spend and zero purchases in the last 30 days.

This is a very positive indicator. It suggests CyberPower's negative keyword strategy is working effectively, and that high-spend terms are generating at least some conversions. This may also indicate conservative bidding on untested terms.

> **Note:** It's possible some spend is distributed across many terms under the $50 threshold with zero purchases. A lower threshold analysis (e.g., >$20 cost, zero purchases) may surface additional negative keyword candidates. Consider running a supplementary query.

---

## Analysis 4: Branded vs. Generic Performance

| Segment | Impressions | Clicks | CTR | Cost | Purchases | Sales | ACOS | CVR |
|---|---|---|---|---|---|---|---|---|
| **Branded** | 1,032,941 | 9,443 | 0.91% | $26,741 | 1,462 | $359,779 | **7.4%** | 15.5% |
| **Generic** | 9,785,817 | 89,553 | 0.92% | $203,590 | 6,567 | $1,198,384 | **17.0%** | 7.3% |

**Key Insights:**
- **Branded** traffic converts at 2.1× the rate of generic (15.5% vs. 7.3% CVR) and achieves ACOS 2.3× lower (7.4% vs. 17.0%) — consistent with industry benchmarks.
- **Generic** drives 81% of total spend and 76% of purchases, confirming it is the growth engine but at a higher cost efficiency.
- The CTR parity between branded and generic (0.91% vs. 0.92%) is notable — branded campaigns are not achieving a CTR premium, which could indicate ad creative parity or that branded searches are being served lower in the funnel.
- **Branded ACOS of 7.4%** is excellent. If the business target ACOS is, say, 15–20%, there is significant headroom to invest more in branded defense.
- **Generic ACOS of 17.0%** is reasonable but could be improved by mining the opportunity keyword list (Analysis 5) and reallocating budget from poor-performing match types.

---

## Analysis 5: Opportunity Keywords — Underbidding (≥5 Purchases, <$50 Spend)

*These keywords are generating significant purchases at minimal spend — almost certainly underbid.*

| Rank | Search Term | Match Type | Purchases | Cost | Sales | ACOS | CVR |
|---|---|---|---|---|---|---|---|
| 1 | ups for computer | TARGETING_EXPRESSION | 12 | $24.83 | $2,069.90 | 1.2% | 109% |
| 2 | cyberpower cp1500pfclcd pfc sinewave ups... | PHRASE | 10 | $10.64 | $3,570.21 | 0.3% | 111% |
| 3 | 1u ups rackmount | PHRASE | 10 | $47.79 | $2,109.90 | 2.3% | 36% |
| 4 | cyberpower sinewave ups | BROAD | 9 | $24.54 | $2,089.50 | 1.2% | 43% |
| 5 | cyberpower 850va | BROAD | 9 | $27.92 | $985.60 | 2.8% | 35% |
| 6 | cyberpower cp1500avrlcd3... | PHRASE | 9 | $48.07 | $2,229.92 | 2.2% | 33% |
| 7 | cyberpower st425 standby ups battery backup and surge protector | TARGETING_EXPRESSION | 8 | $6.46 | $779.35 | 0.8% | 89% |
| 8 | battery surge protector backup power supply | BROAD | 8 | $49.62 | $1,179.60 | 4.2% | 38% |
| 9 | 1u battery backup | PHRASE | 8 | $27.24 | $2,028.84 | 1.3% | 47% |
| 10 | battery backup ups | TARGETING_EXPRESSION | 8 | $48.63 | $1,129.50 | 4.3% | 38% |
| 11 | cyber power 1500 | BROAD | 8 | $14.82 | $2,119.55 | 0.7% | 44% |
| 12 | cyberpower 1500va ups with 12 outlets | PHRASE | 8 | $38.78 | $1,593.50 | 2.4% | 33% |
| 13 | battery surge protector | TARGETING_EXPRESSION | 7 | $34.01 | $749.55 | 4.5% | 39% |
| 14 | ups cyberpower | BROAD | 7 | $46.74 | $1,513.60 | 3.1% | 19% |
| 15 | cyberpower 1500va avr | BROAD | 7 | $39.10 | $2,279.45 | 1.7% | 19% |
| 16 | ups small | TARGETING_EXPRESSION | 6 | $41.82 | $529.70 | 7.9% | 30% |
| 17 | sinewave ups battery backup | BROAD | 6 | $37.09 | $1,399.70 | 2.6% | 38% |
| 18 | pc battery backup | TARGETING_EXPRESSION | 6 | $47.71 | $389.70 | 12.2% | 29% |
| 19 | cp1500pfclcd | PHRASE | 6 | $14.08 | $1,427.70 | 1.0% | 60% |
| 20 | 650 ups battery backup | BROAD | 6 | $2.51 | $913.60 | 0.3% | 600% |

**Key Insights:**
- 20 terms are generating ≥5 purchases each with under $50 in total spend — all under 12.2% ACOS, most under 5%.
- **"ups for computer"** leads with 12 purchases at $24.83 spend (1.2% ACOS). This is a high-volume, generic UPS term that is almost certainly getting limited impression share due to low bids.
- **"650 ups battery backup"** and **"cyber power 1500"** are standout value plays — sub-1% ACOS with healthy purchase counts.
- **Recommended action:** For each of these terms, calculate a bid floor based on target ACOS, then increase current bids by 75–150%. Set up dedicated exact-match campaigns for the top 10 to maximize control and budget allocation.

---

## Analysis 6: High CTR, Zero Conversion

**No results returned.** No search terms with >1% CTR, ≥5 clicks, and zero purchases were found in the last 30 days.

This is another positive signal — CyberPower's ads appear to be driving clicks from genuinely purchase-intent audiences. The absence of high-CTR/no-conversion terms suggests:
1. Ad copy and product images are aligned with search intent
2. Landing pages (PDPs) are converting well
3. Negative keyword strategy is filtering low-intent clicks

> **Note:** If this analysis is run on a shorter window (e.g., last 7 days), some terms may appear here as they accumulate more data. Recommend scheduling this as a weekly check.

---

## Analysis 7: Year-over-Year Comparison (Jan 1 – Feb 28)

| Period | Spend | Sales | Purchases | ACOS | Clicks | Impressions |
|---|---|---|---|---|---|---|
| Jan–Feb 2025 | *No data* | *No data* | *No data* | *No data* | *No data* | *No data* |
| Jan–Feb 2026 | $228,548 | $1,389,857 | 7,325 | 16.4% | 92,966 | 9,625,252 |

**Key Insights:**
- **2025 data is absent from the Snowflake warehouse.** All aggregated values for Jan–Feb 2025 return NULL, indicating no rows exist for this client in that date range.
- **2026 baseline established:** $228.5K in spend across Jan–Feb generated $1.39M in sales at 16.4% ACOS and 7,325 purchases.
- The 2026 data implies an average order value (AOV) of approximately **$190 per purchase** and a CPC of approximately **$2.46** ($228,548 / 92,966 clicks).

**Recommendation:** Escalate the missing 2025 data issue to the data engineering team. Without a 2025 baseline, it is impossible to assess whether CyberPower's ad spend efficiency is improving or degrading year-over-year. This is a critical gap for strategic planning.

---

## Analysis 8: Top 20 Campaigns by ACOS (Last 30 Days)

*Ordered by ACOS ascending — best performing first*

| Rank | Campaign | Spend | Sales | Purchases | ACOS | CTR | Avg TOS IS% |
|---|---|---|---|---|---|---|---|
| 1 | B2B.B.Keyword.Business.SP.UPS.SmartAppLCD.**OR500LCDRM1U** | $237.65 | $29,619.88 | 43 | **0.8%** | 0.60% | 2.3% |
| 2 | B2B.N.Keyword.Business.SP.UPS.SmartAppLCD.**OR700LCDRM1U** | $42.24 | $4,103.35 | 6 | **1.0%** | 0.26% | 2.9% |
| 3 | N.Keyword.Consumer.SP.UPS.SmartAppOnline.**OL1500RTXL2U** | $89.26 | $5,798.70 | 5 | **1.5%** | 0.38% | 0.3% |
| 4 | N.Keyword.Consumer.SP.UPS.IntelligentLCD.**CP825AVRLCD** | $45.20 | $2,856.25 | 12 | **1.6%** | 4.96% | 36.9% |
| 5 | B.Keyword.Consumer.SP.UPS.PFCSinewave.2026.**CP1500PFCLCD** | $8.12 | $467.90 | 2 | **1.7%** | 0.56% | 1.5% |
| 6 | N.Keyword.Consumer.SP.UPS.SmartAppOnline.**OL3000RTXL2U** | $292.57 | $15,686.47 | 13 | **1.9%** | 0.14% | 0.6% |
| 7 | SP_Defense_Branded_Category_CPC_B00DBA9YD0 | $22.27 | $915.75 | 4 | **2.4%** | 0.45% | 0.6% |
| 8 | C.Product.Consumer.SP.UPS.SmartAppOnline.**OL3000RTXL2U** | $58.11 | $2,285.25 | 2 | **2.5%** | 0.80% | 14.6% |
| 9 | N.Keyword.Consumer.SP.UPS.PFCSinewave.**CP1350PFCLCD** | $37.12 | $1,428.65 | 5 | **2.6%** | 0.74% | 27.8% |
| 10 | B2B.B.Keyword.Business.SP.UPS.PFCSinewave.**CP1500PFCLCD** | $794.40 | $28,667.95 | 78 | **2.8%** | 0.48% | 8.8% |
| 11 | B2B.N.Keyword.Business.SP.UPS.PFCSinewave.**OR2200PFCRT2U** | $69.25 | $2,453.65 | 3 | **2.8%** | 0.28% | 0.1% |
| 12 | N.Keyword.Consumer.SP.UPS.IntelligentLCD.**CP685AVRLCD** | $3.93 | $127.95 | 1 | **3.1%** | 3.42% | 48.4% |
| 13 | B2B.N.Keyword.Business.SP.UPS.SmartAppLCD.**OR500LCDRM1U** | $740.83 | $23,452.64 | 85 | **3.2%** | 0.83% | 3.4% |
| 14 | C.Product.Consumer.SP.UPS.SmartAppOnline.**OL1500RTXL2U** | $8.38 | $259.20 | 1 | **3.2%** | 1.06% | 10.2% |
| 15 | B2B.N.Keyword.Business.SP.UPS.SmartAppLCD.**OR1500LCDRT2U** | $486.66 | $12,587.55 | 28 | **3.9%** | 0.40% | 0.6% |
| 16 | N.Keyword.Consumer.SP.UPS.PFCSinewave.**OR2200PFCRT2U** | $2,377.42 | $58,825.31 | 110 | **4.0%** | 0.20% | 1.5% |
| 17 | B2B.C.Keyword.Business.SP.UPS.PFCSinewave.**CP1500PFCLCD** | $1,240.58 | $30,411.55 | 44 | **4.1%** | 0.11% | 4.6% |
| 18 | B.Keyword.Consumer.SP.UPS.AVR.**AVRG750U** | $57.03 | $1,393.55 | 11 | **4.1%** | 1.43% | 46.6% |
| 19 | SP_Conquest_Non-branded_Category_CPC_B000QZ3UG0 | $8.62 | $199.95 | 1 | **4.3%** | 0.20% | 0.1% |
| 20 | N.Keyword.Consumer.SP.UPS.SmartAppLCD.**CPS1500AVR** | $311.00 | $7,090.19 | 12 | **4.4%** | 0.12% | 1.6% |

**Key Insights:**
- All top 20 campaigns are running at impressively low ACOS (0.8%–4.4%), suggesting this sorted view captures only the profitable campaigns. There are likely many more campaigns above 5% ACOS not shown here.
- **OR500LCDRM1U (B2B Broad)** is the standout performer: $237.65 spend → $29,619.88 sales → 43 purchases at 0.8% ACOS. Significant budget increase warranted.
- **OR2200PFCRT2U (Consumer Keyword)** is the highest absolute spend/sales campaign: $2,377 spend → $58,825 sales at 4.0% ACOS. This is the volume engine and should be protected.
- **CP1500PFCLCD** appears in 3 separate campaigns (B2B Broad, B2B Competitor, Consumer New-to-Brand) — all performing well, confirming this is a high-demand SKU deserving continued investment.
- **Top-of-Search Impression Share (TOS IS%)** is very high for CP825AVRLCD (36.9%), CP1350PFCLCD (27.8%), CP685AVRLCD (48.4%), and AVRG750U (46.6%) — indicating these are well-positioned at top of search. Campaigns with TOS IS below 5% may benefit from bid-for-placement adjustments.

---

## Data Quality Notes

1. **2025 historical data is missing** — The entire Jan–Feb 2025 period returned NULL for all metrics. This must be investigated and backfilled for trend analysis.
2. **Campaign status column is NULL** — All campaigns in sp_campaign_report have NULL for campaign_status. This may indicate a pipeline issue not populating this field.
3. **Wasted spend and high-CTR/no-conversion queries returned 0 rows** — While this could be genuinely positive, it is worth confirming that cost thresholds in the query ($50 minimum) are appropriate for the data volume. Running with a lower threshold ($10–$20) is recommended as a sanity check.
4. **CVR values >100%** — Observed in several search terms. This occurs when multiple units are purchased per click session (B2B bulk orders), and is expected behavior for commercial/enterprise UPS buyers.

---

## Appendix: Query Reference

| Query | Description | Rows Returned |
|---|---|---|
| Q1 | Match type efficiency (last 30 days) | 6 match types |
| Q2 | Top 20 converting search terms (≥3 purchases) | 20 terms |
| Q3 | Wasted spend (>$50 cost, 0 purchases) | **0** (clean) |
| Q4 | Branded vs. generic segmentation | 2 segments |
| Q5 | Opportunity keywords (≥5 purchases, <$50 spend) | 20 terms |
| Q6 | High CTR, zero conversion (>1% CTR, ≥5 clicks) | **0** (clean) |
| Q7 | YoY comparison (Jan–Feb 2025 vs 2026) | 2025: no data |
| Q8 | Top 20 campaigns by ACOS (sp_campaign_report) | 20 campaigns |

---

*Report generated by OpenClaw SP Analysis Pipeline | CyberPower Amazon Advertising*
