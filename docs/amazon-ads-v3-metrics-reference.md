# Amazon Ads API v3 — Complete Metrics Reference
# Source: Official Amazon Ads API Documentation
# Date: 2026-03-25
# This is the authoritative list of all metric names, types, and which report types they apply to.

## SP-only metrics (purchases/sales/units with time windows)
purchases1d, purchases7d, purchases14d, purchases30d — spCampaigns, spTargeting, spSearchTerm, spPurchasedProduct, spAdvertisedProduct
purchasesSameSku1d/7d/14d/30d — spCampaigns, spTargeting, spSearchTerm, spAdvertisedProduct
unitsSoldClicks1d/7d/14d/30d — spCampaigns, spTargeting, spSearchTerm, spPurchasedProduct, spAdvertisedProduct
sales1d/7d/14d/30d — spCampaigns, spTargeting, spSearchTerm, spPurchasedProduct, spAdvertisedProduct
attributedSalesSameSku1d/7d/14d/30d — spCampaigns, spTargeting, spSearchTerm, spAdvertisedProduct
unitsSoldSameSku1d/7d/14d/30d — spCampaigns, spTargeting, spSearchTerm, spAdvertisedProduct
salesOtherSku7d — spTargeting, spSearchTerm, spPurchasedProduct, spAdvertisedProduct
unitsSoldOtherSku7d — spTargeting, spSearchTerm, spAdvertisedProduct
acosClicks7d, acosClicks14d — spTargeting, spSearchTerm, spAdvertisedProduct
roasClicks7d, roasClicks14d — spTargeting, spSearchTerm, spAdvertisedProduct
advertisedAsin, advertisedSku — spPurchasedProduct, spAdvertisedProduct
purchasedAsin — spPurchasedProduct, sbPurchasedProduct
topOfSearchImpressionShare — spCampaigns, sbCampaigns, sbTargeting
campaignApplicableBudgetRuleId, campaignApplicableBudgetRuleName — spCampaigns
campaignRuleBasedBudgetAmount — spCampaigns
campaignBiddingStrategy — spCampaigns
placementClassification — spCampaigns, sbPlacement
portfolioId — spTargeting, spSearchTerm, spPurchasedProduct, spAdvertisedProduct
searchTerm — spSearchTerm, sbSearchTerm
keyword — spTargeting, spSearchTerm, spPurchasedProduct
keywordId — spTargeting, sbTargeting, spSearchTerm, sbSearchTerm, spPurchasedProduct
keywordText — sbTargeting, sbSearchTerm (NOTE: SB uses keywordText not keyword)
keywordBid — spTargeting, sbTargeting, spSearchTerm, sbSearchTerm
keywordType — spTargeting, sbTargeting, spSearchTerm, spPurchasedProduct
matchType — spTargeting, sbTargeting, spSearchTerm, sbSearchTerm, spPurchasedProduct
targeting — spTargeting, spSearchTerm
adKeywordStatus — spTargeting, sbTargeting, spSearchTerm, sbSearchTerm, sdTargeting
targetingExpression — sbTargeting, sdTargeting
targetingId — sbTargeting, sdTargeting (Integer)
targetingText — sbTargeting, sdTargeting, stTargeting
targetingType — sbTargeting

## SB-only metrics (14d attribution window — SB ONLY)
purchases — sbCampaigns, sbAdGroups, sbPlacement, sbTargeting, sbSearchTerm, sbAds
purchasesClicks — sbCampaigns + all SB
purchasesPromoted — sbCampaigns, sbAdGroups, sbPlacement, sbTargeting, sbAds (same-SKU 14d)
sales — sbCampaigns + all SB (14d)
salesClicks — sbCampaigns + all SB
salesPromoted — sbCampaigns, sbAdGroups, sbPlacement, sbTargeting, sbAds
unitsSold — sbCampaigns + all SB
unitsSoldClicks — sbCampaigns + all SB
newToBrandPurchases — sbCampaigns + all SB
newToBrandPurchasesClicks — sbCampaigns + all SB
newToBrandPurchasesPercentage — sbCampaigns, sbAdGroups, sbPlacement, sbTargeting, sbAds
newToBrandPurchasesRate — sbCampaigns, sbAdGroups, sbPlacement, sbTargeting, sbAds
newToBrandSales — sbCampaigns + all SB
newToBrandSalesClicks — sbCampaigns + all SB
newToBrandSalesPercentage — sbCampaigns, sbAdGroups, sbPlacement, sbTargeting, sbAds
newToBrandUnitsSold — sbCampaigns + all SB
newToBrandUnitsSoldClicks — sbCampaigns + all SB
newToBrandUnitsSoldPercentage — sbCampaigns, sbAdGroups, sbPlacement, sbTargeting, sbAds
newToBrandDetailPageViews — sbCampaigns + all SB
newToBrandDetailPageViewsClicks — sbCampaigns + all SB (NOTE: plural ViewsClicks)
newToBrandDetailPageViewRate — sbCampaigns + all SB
newToBrandECPDetailPageView — sbCampaigns + all SB
brandStorePageView — sbCampaigns ONLY
topOfSearchImpressionShare — spCampaigns, sbCampaigns, sbTargeting
video5SecondViewRate — sbCampaigns + all SB (NOT sdCampaigns)
video5SecondViews — sbCampaigns + all SB (NOT sdCampaigns)
videoCompleteViews — sbCampaigns + all SB + sdCampaigns + sdAdGroups etc
videoFirstQuartileViews — sbCampaigns + all SB + sdCampaigns etc
videoMidpointViews — sbCampaigns + all SB + sdCampaigns etc
videoThirdQuartileViews — sbCampaigns + all SB + sdCampaigns etc
videoUnmutes — sbCampaigns + all SB + sdCampaigns etc (NOT stCampaigns)
viewabilityRate — sbCampaigns + all SB + sdCampaigns etc
viewableImpressions — sbCampaigns + all SB (NOT sdCampaigns)
viewClickThroughRate — sbCampaigns + all SB + sdCampaigns etc
brandedSearches — sbCampaigns + all SB + sdCampaigns etc
brandedSearchesClicks — sbCampaigns + all SB + sdCampaigns etc
detailPageViews — sbCampaigns + all SB + sdCampaigns etc
detailPageViewsClicks — sbCampaigns + all SB + sdCampaigns etc
addToCart — sbCampaigns + all SB + sdCampaigns etc
addToCartClicks — sbCampaigns + all SB + sdCampaigns etc
addToCartRate — sbCampaigns + all SB + sdCampaigns etc
eCPAddToCart — sbCampaigns + all SB + sdCampaigns etc
costType — sbCampaigns, sbAdGroups, sbPlacement, sbTargeting, sbSearchTerm, sdCampaigns, sbAds
longTermSales — sdCampaigns, sbCampaigns, stCampaigns, dspCampaign
longTermROAS — sdCampaigns, sbCampaigns, stCampaigns, dspCampaign
kindleEditionNormalizedPagesRead14d — spCampaigns, spTargeting, spSearchTerm, spPurchasedProduct, spAdvertisedProduct, sbCampaigns, sbAdGroup, sbAds, sbCampaignPlacement, sbPurchasedProduct, sbSearchTerm
kindleEditionNormalizedPagesRoyalties14d — same as above

## SD-only metrics
addToCartViews — sdCampaigns + sdAdGroups + sdTargeting + sdAdvertisedProduct
brandedSearchesViews — sdCampaigns + sdAdGroups + sdTargeting + sdAdvertisedProduct
brandedSearchRate — sdCampaigns + sdAdGroups + sdTargeting + sdAdvertisedProduct
impressionsViews — sdCampaigns + sdAdGroups + sdTargeting + sdAdvertisedProduct
eCPBrandSearch — sdCampaigns + sdAdGroups + sdTargeting + sdAdvertisedProduct
purchasesPromotedClicks — sdCampaigns + sdAdGroups + sdTargeting + sdAdvertisedProduct (different from SB's purchasesPromoted)
salesPromotedClicks — sdCampaigns + sdAdGroups + sdTargeting + sdAdvertisedProduct
addToListFromViews — sdCampaigns + sdAdGroups + sdTargeting + sdAdvertisedProduct + sdPurchasedProduct
qualifiedBorrowsFromViews — sdCampaigns + sdAdGroups + sdTargeting + sdAdvertisedProduct + sdPurchasedProduct
royaltyQualifiedBorrowsFromViews — same
cumulativeReach — sdCampaigns (groupBy=campaign only)
impressionsFrequencyAverage — sdCampaigns, sdAdGroups, sdAdvertisedProduct
newToBrandDetailPageViewClicks — sdCampaigns + sdAdGroups + sdTargeting + sdAdvertisedProduct
newToBrandDetailPageViewRate — sdCampaigns + sdAdGroups + sdTargeting + sdAdvertisedProduct
newToBrandDetailPageViews — sdCampaigns + sdAdGroups + sdTargeting + sdAdvertisedProduct
newToBrandDetailPageViewViews — sdCampaigns + sdAdGroups + sdTargeting + sdAdvertisedProduct
newToBrandECPDetailPageView — sdCampaigns + sdAdGroups + sdTargeting + sdAdvertisedProduct
promotedAsin — sdAdvertisedProduct, sdPurchasedProduct (SD uses promotedAsin NOT advertisedAsin)
promotedSku — sdAdvertisedProduct, sdPurchasedProduct
matchedTargetAsin — sdCampaigns, sdAdGroups, sdTargeting (groupBy=matchedTarget only)
kindleEditionNormalizedPagesRead/ReadFromClicks/ReadFromViews — sdAdGroup, sdAdvertisedProduct, sdCampaigns, sdPurchasedProduct, sdTargeting
kindleEditionNormalizedPagesRoyalties/RoyaltiesFromClicks/RoyaltiesFromViews — same
bidOptimization — sdAdGroups, sdAdvertisedProduct
linkOuts — sdCampaigns, sdAdGroups, sdTargeting, sdAdvertisedProduct

## Common SP+SB+SD metrics
impressions — all
clicks — all
cost — all SP + SB + SD
date — all
startDate, endDate — all
campaignId — all
campaignName — all
campaignStatus — all
campaignBudgetAmount — spCampaigns, sbCampaigns + all SB, stCampaigns, spAdvertisedProduct
campaignBudgetCurrencyCode — all SP + SB + SD
campaignBudgetType — spCampaigns, sbCampaigns + all SB, stCampaigns, spAdvertisedProduct
adGroupId — spCampaigns(adGroup groupBy), sbAdGroups, spTargeting, sbTargeting + all
adGroupName — same
adId — sdAdvertisedProduct, sbAds, spAdvertisedProduct
adStatus — spCampaigns(adGroup groupBy), sbAdGroups, stCampaigns, stTargeting
costPerClick — spCampaigns, spTargeting, spSearchTerm, spAdvertisedProduct, stCampaigns, stTargeting
clickThroughRate — spCampaigns, spTargeting, spSearchTerm, spAdvertisedProduct, stCampaigns, stTargeting
spend — spCampaigns, spAdvertisedProduct (alias for cost)
addToList — all SP + SB + SD (NOT sbSearchTerm for addToList — uses addToListFromClicks)
qualifiedBorrows — all SP + SB + SD
royaltyQualifiedBorrows — all SP + SB + SD
addToListFromClicks — sbCampaigns + all SB + sdCampaigns + sdAdGroups etc

## SB Purchased Product specific fields
campaignPriceTypeCode — sbPurchasedProduct
attributionType — sbPurchasedProduct
purchasedAsin — spPurchasedProduct, sbPurchasedProduct
productName — sbPurchasedProduct
productCategory — sbPurchasedProduct
ordersClicks14d — sbPurchasedProduct
orders14d — sbPurchasedProduct
newToBrandPurchases14d, newToBrandSales14d, newToBrandUnitsSold14d — sbPurchasedProduct
newToBrandSalesPercentage14d, newToBrandPurchasesPercentage14d, newToBrandUnitsSoldPercentage14d — sbPurchasedProduct
unitsSoldClicks14d, salesClicks14d, unitsSold14d, sales14d — sbPurchasedProduct

## SD Purchased Product specific fields
asinBrandHalo — sdPurchasedProduct
conversionsBrandHalo, conversionsBrandHaloClicks — sdPurchasedProduct
salesBrandHalo, salesBrandHaloClicks — sdPurchasedProduct
unitsSoldBrandHalo, unitsSoldBrandHaloClicks — sdPurchasedProduct
promotedAsin, promotedSku — sdAdvertisedProduct, sdPurchasedProduct

## Gross and Invalid Traffic (SP/SB/SD)
grossImpressions, grossClickThroughs — spGrossandInvalids, sbGrossandInvalids, sdGrossandInvalids
invalidImpressions, invalidClickThroughs — same
invalidImpressionRate, invalidClickThroughRate — same
campaignName, campaignStatus — same

## New report types NOT in legacy Fivetran schema
crossProgramBenchmarks — brand-level benchmarks vs category peers (adProduct=ALL, groupBy=brandCategoryBenchmarks)
conversionPath — 30-day cross-channel path to conversion (adProduct=ALL, groupBy=brandConversionPath, needs Brand Registry)
spPromptAdExtension — SP prompt/AI ad extension metrics (groupBy=promptAdExtension)
spAudiences, sbAudiences — audience bid boost segment reports
stCampaigns, stTargeting — Sponsored TV (new ad type)
All dsp* reports — DSP campaigns, inventory, audience, geo, tech, etc.
