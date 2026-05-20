---
title: "Amazon Contribution Margin: The Metric That Tells You If You're Actually Profitable"
slug: amazon-contribution-margin
date: 2026-05-20
description: "ACoS tells you ad efficiency. Contribution margin tells you if you make money. Learn CM1, CM2, CM3 with real examples and how to calculate it per ASIN."
keywords: ["amazon contribution margin", "amazon profitability per asin", "amazon cm3", "amazon profit per unit", "amazon acos vs profit", "amazon unit economics", "amazon seller profitability"]
---

# Amazon Contribution Margin: The Metric That Tells You If You're Actually Profitable

A 15% ACoS sounds great. But a 15% ACoS on a product with 12% gross margin after fees is a loss. ACoS measures advertising efficiency. It says nothing about whether your business makes money.

Contribution margin is the metric that answers the actual question: after every cost is accounted for, how much does each sale contribute to your business? Here's how to calculate it, what the three contribution margin layers mean, and why it's the number you should be building your strategy around.

## Why ACoS Is an Incomplete Picture

ACoS = Ad Spend ÷ Ad-Attributed Revenue. It tells you the ratio of what you spent on ads versus what those ads generated in sales.

The problem is what it doesn't include:

- Your cost of goods sold
- Amazon FBA fees (pick, pack, storage, inbound)
- Returns and refunds
- Amazon referral fee (8-15% depending on category)
- Shipping to Amazon
- Any co-op or trade spend

You can run a profitable ACoS and still lose money on every unit sold. Sellers discover this when they look at their bank account and realize the business seems to be growing but cash isn't accumulating. Contribution margin is where that story gets resolved.

## The Three Layers of Contribution Margin

Amazon profitability analysis is most useful when broken into three layers, each adding a new cost category.

### CM1: Gross Margin After COGS

```
CM1 = Revenue − Cost of Goods Sold
```

This is your starting point. It captures the fundamental economics of the product before any platform-specific costs.

**Example:**
- Selling price: $35.00
- COGS (manufacturing + shipping to US): $8.50
- **CM1 = $26.50 (75.7% margin)**

CM1 tells you whether the product is viable at all. A CM1 below 50-60% on Amazon typically signals trouble ahead once you layer in fees and ad spend.

### CM2: Gross Margin After FBA Fees

```
CM2 = CM1 − FBA Fulfillment Fee − Referral Fee − Storage Fees
```

This is where Amazon's take becomes visible. FBA fees depend on product size and weight; the referral fee is a percentage of sale price (typically 8-15%); storage fees vary by month and size tier.

**Continuing the example:**
- FBA fulfillment fee (standard size): $4.75
- Amazon referral fee (15%): $5.25
- Storage (monthly average allocated per unit): $0.40
- **CM2 = $26.50 − $4.75 − $5.25 − $0.40 = $16.10 (46.0% margin)**

CM2 is your pre-advertising margin—what you'd earn per unit if you sold entirely organically with zero ad spend. This number sets your advertising ceiling. Your ad spend per unit cannot exceed CM2 without losing money on each sale.

### CM3: Contribution After Advertising

```
CM3 = CM2 − Ad Spend per Unit Sold
```

This is the bottom line. CM3 tells you how much money you actually make per unit after accounting for everything: your product cost, Amazon's fees, and your advertising.

**Completing the example:**
- Total ad spend last month: $4,200
- Total units sold last month: 680
- Ad spend per unit: $6.18
- **CM3 = $16.10 − $6.18 = $9.92 (28.3% margin)**

At $9.92 contribution per unit on a $35 product, you're genuinely profitable. Now you have something to optimize against.

If CM3 came out negative, you'd know you have a real problem—either COGS is too high, fees are eating too much, or ad spend per unit is unsustainable.

## What a CM3 Waterfall Looks Like

Laying this out as a waterfall per unit makes the story immediately clear:

| Line Item | Amount | Running Total |
|---|---|---|
| Selling Price | $35.00 | $35.00 |
| − COGS | −$8.50 | $26.50 |
| **CM1** | | **$26.50 (75.7%)** |
| − FBA Fulfillment Fee | −$4.75 | $21.75 |
| − Referral Fee (15%) | −$5.25 | $16.50 |
| − Storage (avg/unit) | −$0.40 | $16.10 |
| **CM2** | | **$16.10 (46.0%)** |
| − Ad Spend per Unit | −$6.18 | $9.92 |
| **CM3** | | **$9.92 (28.3%)** |

Run this waterfall for every ASIN in your catalog. The results are usually eye-opening. Most sellers find a handful of products generating nearly all their real profit, several products that look decent on ACoS but are actually marginally profitable or break-even at CM3, and occasionally one or two products that are actively destroying cash despite appearing healthy.

## Using CM3 to Set Advertising Limits

Once you know CM3, you can set meaningful advertising constraints.

Your **maximum viable ad spend per unit** is CM2. Spend more than CM2 per unit on ads, and you're losing money per sale regardless of ACoS.

Your **target ad spend per unit** should leave enough CM3 to cover overhead (SaaS tools, agency fees, operating costs) and still generate meaningful profit. For most sellers, targeting CM3 of 20-30% of revenue is a reasonable anchor.

**Setting a target ACoS from CM3:**
```
Target ACoS = Target Ad Spend per Unit ÷ Selling Price × 100
```

If your CM2 is $16.10 on a $35 product, your absolute ceiling ACoS is 46%. To target a 25% CM3 margin ($8.75/unit), you'd want to spend no more than $7.35/unit on ads, giving a target ACoS of ~21%.

This is how you set ACoS targets that are grounded in real economics rather than industry benchmarks or gut feel.

## Why CM3 Is Hard to Calculate Manually

Building a CM3 view per ASIN requires data from at least four places:

1. **Your COGS data** (usually in a spreadsheet or ERP)
2. **Amazon FBA fee data** (available in the fee preview tool or fee reports)
3. **Amazon referral and other fee data** (Payments report)
4. **Advertising spend per ASIN** (Campaign reports, cross-referenced to ASINs)

Assembling this manually is a multi-hour exercise, and it needs to be redone every month as fees change, ad spend fluctuates, and COGS evolves. Most brands do it quarterly at best, which means they're making weekly advertising decisions without current profitability data.

## How Calbridge Automates Contribution Margin

[Calbridge](https://calbridge.ai) calculates CM1, CM2, and CM3 automatically per ASIN by ingesting your advertising data directly and letting you upload COGS data once. When your costs change, you update the COGS file and the platform recalculates everything.

You get a contribution margin waterfall per ASIN without building a spreadsheet. You can see at a glance which products are generating real profit, which are break-even, and which need either cost reduction or ad spend cuts. The AI bid recommendation layer uses CM3 as an input—it won't recommend scaling ad spend on a product that's already margin-negative.

For accounts with 50+ active ASINs, this kind of automated CM3 visibility is the difference between managing by data and managing by instinct.

If you've been optimizing to ACoS and wondering why profitability feels unclear, CM3 is probably the missing piece. Start with the waterfall for your top 10 revenue ASINs. What you find will shape every advertising decision that comes after.
