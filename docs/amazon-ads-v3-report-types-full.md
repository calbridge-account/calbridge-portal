# Amazon Ads API v3 — Complete Report Types Reference
# Source: Official Amazon Ads API Documentation
# Date: 2026-03-25

## SPONSORED PRODUCTS

### spCampaigns — Campaign Report
groupBy: campaign, adGroup, or campaignPlacement
Base cols: impressions, addToList, qualifiedBorrows, royaltyQualifiedBorrows, clicks, cost, purchases1d, purchases7d, purchases14d, purchases30d, purchasesSameSku1d, purchasesSameSku7d, purchasesSameSku14d, purchasesSameSku30d, unitsSoldClicks1d, unitsSoldClicks7d, unitsSoldClicks14d, unitsSoldClicks30d, sales1d, sales7d, sales14d, sales30d, attributedSalesSameSku1d, attributedSalesSameSku7d, attributedSalesSameSku14d, attributedSalesSameSku30d, unitsSoldSameSku1d, unitsSoldSameSku7d, unitsSoldSameSku14d, unitsSoldSameSku30d, kindleEditionNormalizedPagesRead14d, kindleEditionNormalizedPagesRoyalties14d, date, startDate, endDate, campaignBiddingStrategy, costPerClick, clickThroughRate, spend

groupBy=campaign adds: campaignName, campaignId, campaignStatus, campaignBudgetAmount, campaignBudgetType, campaignRuleBasedBudgetAmount, campaignApplicableBudgetRuleId, campaignApplicableBudgetRuleName, campaignBudgetCurrencyCode, topOfSearchImpressionShare
Filter: campaignStatus (ENABLED, PAUSED, ARCHIVED)

groupBy=adGroup adds: adGroupName, adGroupId, adStatus
Filter: adStatus (ENABLED, PAUSED, ARCHIVED)

groupBy=campaignPlacement adds: placementClassification, campaignName, campaignId, campaignStatus, campaignBudgetAmount, campaignBudgetType, campaignRuleBasedBudgetAmount, campaignApplicableBudgetRuleId, campaignApplicableBudgetRuleName, campaignBudgetCurrencyCode, topOfSearchImpressionShare

### spTargeting — Targeting Report
groupBy: targeting
Base cols: impressions, addToList, qualifiedBorrows, royaltyQualifiedBorrows, clicks, costPerClick, clickThroughRate, cost, purchases1d, purchases7d, purchases14d, purchases30d, purchasesSameSku1d, purchasesSameSku7d, purchasesSameSku14d, purchasesSameSku30d, unitsSoldClicks1d, unitsSoldClicks7d, unitsSoldClicks14d, unitsSoldClicks30d, sales1d, sales7d, sales14d, sales30d, attributedSalesSameSku1d, attributedSalesSameSku7d, attributedSalesSameSku14d, attributedSalesSameSku30d, unitsSoldSameSku1d, unitsSoldSameSku7d, unitsSoldSameSku14d, unitsSoldSameSku30d, kindleEditionNormalizedPagesRead14d, kindleEditionNormalizedPagesRoyalties14d, salesOtherSku7d, unitsSoldOtherSku7d, acosClicks7d, acosClicks14d, roasClicks7d, roasClicks14d, keywordId, keyword, campaignBudgetCurrencyCode, date, startDate, endDate, portfolioId, campaignName, campaignId, campaignBudgetType, campaignBudgetAmount, campaignStatus, keywordBid, adGroupName, adGroupId, keywordType, matchType, targeting, topOfSearchImpressionShare
groupBy=targeting adds: adKeywordStatus
Filters: adKeywordStatus (ENABLED, PAUSED, ARCHIVED), keywordType (BROAD, PHRASE, EXACT, TARGETING_EXPRESSION, TARGETING_EXPRESSION_PREDEFINED)

### spSearchTerm — Search Term Report
groupBy: searchTerm
Base cols: impressions, addToList, qualifiedBorrows, royaltyQualifiedBorrows, clicks, costPerClick, clickThroughRate, cost, purchases1d, purchases7d, purchases14d, purchases30d, purchasesSameSku1d, purchasesSameSku7d, purchasesSameSku14d, purchasesSameSku30d, unitsSoldClicks1d, unitsSoldClicks7d, unitsSoldClicks14d, unitsSoldClicks30d, sales1d, sales7d, sales14d, sales30d, attributedSalesSameSku1d, attributedSalesSameSku7d, attributedSalesSameSku14d, attributedSalesSameSku30d, unitsSoldSameSku1d, unitsSoldSameSku7d, unitsSoldSameSku14d, unitsSoldSameSku30d, kindleEditionNormalizedPagesRead14d, kindleEditionNormalizedPagesRoyalties14d, salesOtherSku7d, unitsSoldOtherSku7d, acosClicks7d, acosClicks14d, roasClicks7d, roasClicks14d, keywordId, keyword, campaignBudgetCurrencyCode, date, startDate, endDate, portfolioId, searchTerm, campaignName, campaignId, campaignBudgetType, campaignBudgetAmount, campaignStatus, keywordBid, adGroupName, adGroupId, keywordType, matchType, targeting, adKeywordStatus
groupBy=searchTerm adds: adKeywordStatus
Filters: keywordType (BROAD, PHRASE, EXACT, TARGETING_EXPRESSION, TARGETING_EXPRESSION_PREDEFINED)

### spAdvertisedProduct — Advertised Product Report
groupBy: advertiser
Base cols: date, startDate, endDate, campaignName, campaignId, adGroupName, adGroupId, adId, addToList, qualifiedBorrows, royaltyQualifiedBorrows, portfolioId, impressions, clicks, costPerClick, clickThroughRate, cost, spend, campaignBudgetCurrencyCode, campaignBudgetAmount, campaignBudgetType, campaignStatus, advertisedAsin, advertisedSku, purchases1d, purchases7d, purchases14d, purchases30d, purchasesSameSku1d, purchasesSameSku7d, purchasesSameSku14d, purchasesSameSku30d, unitsSoldClicks1d, unitsSoldClicks7d, unitsSoldClicks14d, unitsSoldClicks30d, sales1d, sales7d, sales14d, sales30d, attributedSalesSameSku1d, attributedSalesSameSku7d, attributedSalesSameSku14d, attributedSalesSameSku30d, salesOtherSku7d, unitsSoldSameSku1d, unitsSoldSameSku7d, unitsSoldSameSku14d, unitsSoldSameSku30d, unitsSoldOtherSku7d, kindleEditionNormalizedPagesRead14d, kindleEditionNormalizedPagesRoyalties14d, acosClicks7d, acosClicks14d, roasClicks7d, roasClicks14d
Filter: adCreativeStatus (ENABLED, PAUSED, ARCHIVED)

### spPurchasedProduct — Purchased Product Report
groupBy: asin
Base cols: date, startDate, endDate, addToList, addToListFromClicks, qualifiedBorrows, qualifiedBorrowsFromClicks, royaltyQualifiedBorrows, royaltyQualifiedBorrowsFromClicks, portfolioId, campaignName, campaignId, adGroupName, adGroupId, keywordId, keyword, keywordType, advertisedAsin, purchasedAsin, advertisedSku, campaignBudgetCurrencyCode, matchType, unitsSoldClicks1d/7d/14d/30d, sales1d/7d/14d/30d, purchases1d/7d/14d/30d, unitsSoldOtherSku1d/7d/14d/30d, salesOtherSku1d/7d/14d/30d, purchasesOtherSku1d/7d/14d/30d, kindleEditionNormalizedPagesRead14d, kindleEditionNormalizedPagesRoyalties14d

### spGrossAndInvalids — Gross and Invalid Traffic
groupBy: campaign
Cols: campaignName, campaignStatus, clicks, date, endDate, grossClickThroughs, grossImpressions, impressions, invalidClickThroughRate, invalidClickThroughs, invalidImpressionRate, invalidImpressions, startDate

### spAudiences — Audience Report
groupBy: campaign_bid_boost_segment
Cols: campaignId, segmentName, segmentClassCode, impressions, clicks, cost, spend + all purchase/sales windows + date, campaignName, campaignStatus, campaignBudgetAmount/Type, marketplaceId

---

## SPONSORED BRANDS (ALL IN PREVIEW — isMultiAdGroupsEnabled=True only)

### sbCampaigns — Campaign Report
groupBy: campaign
Base cols: addToCart, addToCartClicks, addToCartRate, addToList, addToListFromClicks, qualifiedBorrows, qualifiedBorrowsFromClicks, royaltyQualifiedBorrows, royaltyQualifiedBorrowsFromClicks, brandedSearches, brandedSearchesClicks, campaignBudgetAmount, campaignBudgetCurrencyCode, campaignBudgetType, campaignId, campaignName, campaignStatus, clicks, cost, costType, date, detailPageViews, detailPageViewsClicks, eCPAddToCart, endDate, impressions, kindleEditionNormalizedPagesRead14d, kindleEditionNormalizedPagesRoyalties14d, newToBrandDetailPageViewRate, newToBrandDetailPageViews, newToBrandDetailPageViewsClicks, newToBrandECPDetailPageView, brandStorePageView, newToBrandPurchases, newToBrandPurchasesClicks, newToBrandPurchasesPercentage, newToBrandPurchasesRate, newToBrandSales, newToBrandSalesClicks, newToBrandSalesPercentage, newToBrandUnitsSold, newToBrandUnitsSoldClicks, newToBrandUnitsSoldPercentage, purchases, purchasesClicks, purchasesPromoted, sales, salesClicks, salesPromoted, startDate, topOfSearchImpressionShare, unitsSold, unitsSoldClicks, video5SecondViewRate, video5SecondViews, videoCompleteViews, videoFirstQuartileViews, videoMidpointViews, videoThirdQuartileViews, videoUnmutes, viewabilityRate, viewableImpressions, viewClickThroughRate
groupBy=campaign adds: longTermSales, longTermROAS
Filter: campaignStatus (ENABLED, PAUSED, ARCHIVED)

### sbTargeting — Targeting/Keyword Report
groupBy: targeting
Base cols: addToCart, addToCartClicks, addToCartRate, adGroupId, adGroupName, addToList, addToListFromClicks, qualifiedBorrows, qualifiedBorrowsFromClicks, royaltyQualifiedBorrows, royaltyQualifiedBorrowsFromClicks, brandedSearches, brandedSearchesClicks, campaignBudgetAmount, campaignBudgetCurrencyCode, campaignBudgetType, campaignId, campaignName, campaignStatus, clicks, cost, costType, date, detailPageViews, detailPageViewsClicks, eCPAddToCart, endDate, impressions, keywordBid, keywordId, adKeywordStatus, keywordText, keywordType, matchType, newToBrandDetailPageViewRate, newToBrandDetailPageViews, newToBrandDetailPageViewsClicks, newToBrandECPDetailPageView, newToBrandPurchases, newToBrandPurchasesClicks, newToBrandPurchasesPercentage, newToBrandPurchasesRate, newToBrandSales, newToBrandSalesClicks, newToBrandSalesPercentage, newToBrandUnitsSold, newToBrandUnitsSoldClicks, newToBrandUnitsSoldPercentage, purchases, purchasesClicks, purchasesPromoted, sales, salesClicks, salesPromoted, startDate, targetingExpression, targetingId, targetingText, targetingType, topOfSearchImpressionShare, unitsSold
Filters: adKeywordStatus, keywordType (BROAD, PHRASE, EXACT, TARGETING_EXPRESSION, TARGETING_EXPRESSION_PREDEFINED, THEME)

### sbSearchTerm — Search Term Report
groupBy: searchTerm
Base cols: adGroupId, adGroupName, addToList, addToListFromClicks, qualifiedBorrows, qualifiedBorrowsFromClicks, royaltyQualifiedBorrows, royaltyQualifiedBorrowsFromClicks, campaignBudgetAmount, campaignBudgetCurrencyCode, campaignBudgetType, campaignId, campaignName, campaignStatus, clicks, cost, costType, date, endDate, impressions, keywordBid, keywordId, keywordText, kindleEditionNormalizedPagesRead14d, kindleEditionNormalizedPagesRoyalties14d, matchType, purchases, purchasesClicks, sales, salesClicks, searchTerm, startDate, unitsSold, video5SecondViewRate, video5SecondViews, videoCompleteViews, videoFirstQuartileViews, videoMidpointViews, videoThirdQuartileViews, videoUnmutes, viewabilityRate, viewableImpressions, viewClickThroughRate
groupBy=searchTerm adds: adKeywordStatus
Filters: keywordType (BROAD, PHRASE, EXACT, TARGETING_EXPRESSION, TARGETING_EXPRESSION_PREDEFINED)

### sbCampaignPlacement — Placement Report
groupBy: campaignPlacement (or campaign)
Base cols: (same as sbCampaigns base) + viewClickThroughRate
groupBy=campaignPlacement adds: placementClassification

### sbAdGroup — Ad Group Report
reportTypeId: sbAdGroup
groupBy: adGroup
Base cols: addToCart, addToCartClicks, addToCartRate, adGroupId, adGroupName, adStatus + all NTB/sales metrics same as sbCampaigns

### sbAds — Ad Report
reportTypeId: sbAds
groupBy: ads
Base cols: adGroupId, adGroupName, adId + all SB metrics

### sbPurchasedProduct — Purchased Product Report
reportTypeId: sbPurchasedProduct
groupBy: purchasedAsin
Base cols: campaignId, adGroupId, date, startDate, endDate, campaignBudgetCurrencyCode, campaignName, campaignPriceTypeCode, adGroupName, attributionType, purchasedAsin, ordersClicks14d, productName, productCategory, sales14d, salesClicks14d, orders14d, unitsSold14d, newToBrandSales14d, newToBrandPurchases14d, newToBrandUnitsSold14d, newToBrandSalesPercentage14d, newToBrandPurchasesPercentage14d, newToBrandUnitsSoldPercentage14d, unitsSoldClicks14d, kindleEditionNormalizedPagesRead14d, kindleEditionNormalizedPagesRoyalties14d

### sbGrossAndInvalids — Gross and Invalid Traffic
reportTypeId: sbGrossAndInvalids
(same cols as spGrossAndInvalids)

### sbAudiences — Audience Report
reportTypeId: sbAudiences
groupBy: campaign_bid_boost_segment

---

## SPONSORED DISPLAY

### sdCampaigns — Campaign Report
groupBy: campaign or matchedTarget
Base cols: addToCart, addToCartClicks, addToCartRate, addToCartViews, addToList, addToListFromClicks, addToListFromViews, qualifiedBorrows, qualifiedBorrowsFromClicks, qualifiedBorrowsFromViews, royaltyQualifiedBorrows, royaltyQualifiedBorrowsFromClicks, royaltyQualifiedBorrowsFromViews, brandedSearches, brandedSearchesClicks, brandedSearchesViews, brandedSearchRate, campaignBudgetCurrencyCode, campaignId, campaignName, clicks, cost, date, detailPageViews, detailPageViewsClicks, eCPAddToCart, eCPBrandSearch, endDate, impressions, impressionsViews, kindleEditionNormalizedPagesRead/ReadFromClicks/ReadFromViews/Royalties/RoyaltiesFromClicks/RoyaltiesFromViews, newToBrandPurchases, newToBrandPurchasesClicks, newToBrandSalesClicks, newToBrandUnitsSold, newToBrandUnitsSoldClicks, purchases, purchasesClicks, purchasesPromotedClicks, sales, salesClicks, salesPromotedClicks, startDate, unitsSold, unitsSoldClicks, videoCompleteViews, videoFirstQuartileViews, videoMidpointViews, videoThirdQuartileViews, videoUnmutes, viewabilityRate, viewClickThroughRate
groupBy=campaign adds: campaignBudgetAmount, campaignStatus, costType, cumulativeReach, impressionsFrequencyAverage, longTermSales, longTermROAS, newToBrandDetailPageViewClicks, newToBrandDetailPageViewRate, newToBrandDetailPageViews, newToBrandDetailPageViewViews, newToBrandECPDetailPageView, newToBrandSales
groupBy=matchedTarget adds: matchedTargetAsin

### sdAdGroup — Ad Group Report
reportTypeId: sdAdGroup
groupBy: adGroup or matchedTarget
Base cols: same as sdCampaigns + adGroupId, adGroupName, bidOptimization, cumulativeReach, impressionsFrequencyAverage + all NTB detail page view metrics

### sdTargeting — Targeting Report
reportTypeId: sdTargeting
groupBy: targeting or matchedTarget
Base cols: addToCart, addToCartClicks, addToCartRate, addToCartViews, adGroupId, adGroupName, addToList, addToListFromClicks, addToListFromViews, qualifiedBorrows/Clicks/Views, royaltyQualifiedBorrows/Clicks/Views, brandedSearches/Clicks/Views, brandedSearchRate, campaignBudgetCurrencyCode, campaignId, campaignName, clicks, cost, date, detailPageViews, detailPageViewsClicks, eCPAddToCart, eCPBrandSearch, endDate, impressions, impressionsViews, kindle metrics, newToBrandPurchases, newToBrandPurchasesClicks, newToBrandSales, newToBrandSalesClicks, newToBrandUnitsSold, newToBrandUnitsSoldClicks, purchases, purchasesClicks, purchasesPromotedClicks, sales, salesClicks, salesPromotedClicks, startDate, targetingExpression, targetingId, targetingText, unitsSold, unitsSoldClicks, video metrics, viewabilityRate, viewClickThroughRate
groupBy=targeting adds: adKeywordStatus, newToBrandDetailPageView metrics, newToBrandECPDetailPageView
groupBy=matchedTarget adds: matchedTargetAsin

### sdAdvertisedProduct — Advertised Product Report
reportTypeId: sdAdvertisedProduct
groupBy: advertiser
Base cols: addToCart, addToCartRate, addToCartViews, addToCartClicks, adGroupId, adGroupName, adId, addToList/Clicks/Views, qualifiedBorrows/Clicks/Views, royaltyQualifiedBorrows/Clicks/Views, bidOptimization, brandedSearches/Clicks/Views, brandedSearchRate, campaignBudgetCurrencyCode, campaignId, campaignName, clicks, cost, cumulativeReach, date, detailPageViews, detailPageViewsClicks, eCPAddToCart, eCPBrandSearch, endDate, impressions, impressionsFrequencyAverage, impressionsViews, kindle metrics, newToBrandDetailPageView metrics, newToBrandPurchases/Clicks, newToBrandSales/Clicks, newToBrandUnitsSold/Clicks, promotedAsin, promotedSku, purchases, purchasesClicks, purchasesPromotedClicks, sales, salesClicks, salesPromotedClicks, startDate, unitsSold, unitsSoldClicks, video metrics, viewabilityRate, viewClickThroughRate

### sdPurchasedProduct — Purchased Product Report
reportTypeId: sdPurchasedProduct
groupBy: asin
Base cols: adGroupId, adGroupName, asinBrandHalo, addToList/Clicks/Views, qualifiedBorrows/Clicks/Views, royaltyQualifiedBorrows/Clicks/Views, campaignBudgetCurrencyCode, campaignId, campaignName, conversionsBrandHalo, conversionsBrandHaloClicks, date, endDate, kindle metrics, promotedAsin, promotedSku, salesBrandHalo, salesBrandHaloClicks, startDate, unitsSoldBrandHalo, unitsSoldBrandHaloClicks

### sdGrossAndInvalids — Gross and Invalid Traffic
reportTypeId: sdGrossAndInvalids

---

## KEY CORRECTIONS vs WHAT SUBAGENT BUILT

1. SB uses `sbTargeting` reportTypeId (not `sbKeywords`) for keyword/targeting reports
   - groupBy is `targeting` (not `keyword`)
   - Keyword col is `keywordText` (not `keywordName`)
   - Has `targetingExpression`, `targetingId`, `targetingText`, `targetingType`

2. SB Ad Group report = `sbAdGroup` (separate reportTypeId, not part of sbCampaigns)
   
3. SB Placement report = `sbCampaignPlacement` with groupBy `campaignPlacement`
   - placementClassification is the key dimension

4. SP Placement = use `spCampaigns` with groupBy `campaignPlacement`
   - NOT a separate reportTypeId

5. SD Advertised Product = `sdAdvertisedProduct` with groupBy `advertiser`
   - promotedAsin, promotedSku (not advertisedAsin)

6. SP Campaign groupBy can be `campaign`, `adGroup`, OR `campaignPlacement` — same reportTypeId

7. Gross and Invalid Traffic reports exist for SP, SB, SD:
   - spGrossAndInvalids, sbGrossAndInvalids, sdGrossAndInvalids

8. Purchased Product reports: spPurchasedProduct, sbPurchasedProduct, sdPurchasedProduct
   - SP groupBy: asin | SB groupBy: purchasedAsin | SD groupBy: asin

9. New reports NOT in legacy Fivetran schema:
   - crossProgramBenchmarks (Benchmarks)
   - conversionPath (Conversion Path — brand-level, cross-channel)
   - spPromptAdExtension (Prompt Ad Extension — new AI format)
   - spAudiences, sbAudiences (Audience bid boost segment)
   - All DSP reports (dspCampaign, dspAudience, etc.)
   - stCampaigns, stTargeting (Sponsored TV)

10. SD targeting: uses `targetingExpression`, `targetingId`, `targetingText` (not `targetingAsin`)

## IMPORTANT: Data retention limits
- SP: 95 days max lookback
- SB: 60 days max lookback
- SD: 65 days max lookback
- Max date range per request: 31 days
