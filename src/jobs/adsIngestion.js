/**
 * Amazon Advertising API ingestion — v3 Async Reporting
 * Covers: Sponsored Products, Sponsored Brands, Sponsored Display
 *
 * Architecture:
 *   Phase 1 (ingestPerformance): Request all report types → store IDs in ads_report_queue
 *   Phase 2 (processReportQueue): Poll, download, gunzip, write each completed report to its table
 *
 * Production base URL: https://advertising-api.amazon.com
 * API docs: https://advertising.amazon.com/API/docs/en-us/reference/reporting/reports
 */
'use strict';

require('dotenv').config();
const path = require('path');
const fs   = require('fs');
const zlib = require('zlib');
const axios = require('axios');
const { query } = require('../services/snowflakeService');
const { getValidToken } = require('../services/amazonAuthService');
const { runJob } = require('./ingestionRunner');

const ADS_API_BASE = 'https://advertising-api.amazon.com';

// ============================================================
// REPORT TYPE DEFINITIONS
// ============================================================

/**
 * Each entry describes one report type to request + where to write results.
 * key       — used in ads_report_queue.report_type and to look up the write fn
 * adProduct — SPONSORED_PRODUCTS | SPONSORED_BRANDS | SPONSORED_DISPLAY
 * reportTypeId — the v3 report type string
 * groupBy   — array of dimension strings
 * columns   — array of metric/dimension column names (Amazon API names)
 * table     — Snowflake target table
 * primaryKey — array of snake_case column names for MERGE ON clause
 */
const REPORT_TYPES = [
  {
    key:          'spCampaigns',
    adProduct:    'SPONSORED_PRODUCTS',
    reportTypeId: 'spCampaigns',
    groupBy:      ['campaign'],
    columns:      [
      'campaignId', 'campaignName', 'impressions', 'clicks', 'cost',
      'purchases30d', 'sales30d', 'unitsSoldClicks30d',
      'purchases1d', 'purchases7d', 'purchases14d',
      'sales1d', 'sales7d', 'sales14d',
      'unitsSoldClicks1d', 'unitsSoldClicks7d', 'unitsSoldClicks14d',
      'campaignBudgetAmount', 'campaignBudgetType', 'campaignBudgetCurrencyCode',
      'topOfSearchImpressionShare', 'campaignBiddingStrategy'
    ],
    table:      'sp_campaign_report',
    primaryKey: ['client_id', 'profile_id', 'campaign_id', 'date']
  },
  {
    key:          'spAdGroups',
    adProduct:    'SPONSORED_PRODUCTS',
    reportTypeId: 'spCampaigns',   // SP uses spCampaigns reportTypeId for adGroup groupBy
    groupBy:      ['adGroup'],
    columns:      [
      'adGroupId', 'adGroupName', 'adStatus',
      'impressions', 'clicks', 'cost', 'costPerClick', 'clickThroughRate',
      'purchases30d', 'sales30d', 'unitsSoldClicks30d',
      'purchases1d', 'purchases7d', 'purchases14d',
      'sales1d', 'sales7d', 'sales14d',
      'unitsSoldClicks1d', 'unitsSoldClicks7d', 'unitsSoldClicks14d',
      'date'
    ],
    table:      'sp_ad_group_report',
    primaryKey: ['client_id', 'profile_id', 'ad_group_id', 'date']
  },
  {
    key:          'spTargeting',
    adProduct:    'SPONSORED_PRODUCTS',
    reportTypeId: 'spTargeting',
    groupBy:      ['targeting'],
    columns:      [
      'campaignId', 'campaignName', 'campaignStatus', 'campaignBudgetAmount',
      'campaignBudgetType', 'campaignBudgetCurrencyCode',
      'adGroupId', 'adGroupName', 'keywordId', 'keyword', 'keywordType',
      'matchType', 'targeting', 'adKeywordStatus', 'keywordBid',
      'portfolioId', 'impressions', 'clicks', 'cost', 'costPerClick', 'clickThroughRate',
      'purchases30d', 'sales30d', 'unitsSoldClicks30d',
      'purchases1d', 'purchases7d', 'purchases14d',
      'sales1d', 'sales7d', 'sales14d',
      'unitsSoldClicks1d', 'unitsSoldClicks7d', 'unitsSoldClicks14d',
      'purchasesSameSku30d', 'unitsSoldSameSku30d',
      'attributedSalesSameSku30d', 'salesOtherSku7d', 'unitsSoldOtherSku7d',
      'topOfSearchImpressionShare', 'acosClicks7d', 'acosClicks14d',
      'roasClicks7d', 'roasClicks14d',
      'date'
    ],
    table:      'sp_targeting_keyword_report',
    primaryKey: ['client_id', 'profile_id', 'campaign_id', 'ad_group_id', 'keyword_id', 'date']
  },
  {
    key:          'spSearchTerm',
    adProduct:    'SPONSORED_PRODUCTS',
    reportTypeId: 'spSearchTerm',
    groupBy:      ['searchTerm'],
    columns:      [
      'campaignId', 'campaignName', 'campaignStatus', 'campaignBudgetAmount',
      'campaignBudgetType', 'campaignBudgetCurrencyCode',
      'adGroupId', 'adGroupName', 'keywordId', 'keyword', 'keywordType',
      'matchType', 'targeting', 'searchTerm', 'adKeywordStatus', 'keywordBid',
      'portfolioId', 'impressions', 'clicks', 'cost', 'costPerClick', 'clickThroughRate',
      'purchases30d', 'sales30d', 'unitsSoldClicks30d',
      'purchases1d', 'purchases7d', 'purchases14d',
      'sales1d', 'sales7d', 'sales14d',
      'unitsSoldClicks1d', 'unitsSoldClicks7d', 'unitsSoldClicks14d',
      'purchasesSameSku30d', 'attributedSalesSameSku30d', 'salesOtherSku7d',
      'acosClicks7d', 'acosClicks14d', 'roasClicks7d', 'roasClicks14d',
      'date'
    ],
    table:      'sp_search_term_report',
    primaryKey: ['client_id', 'profile_id', 'campaign_id', 'ad_group_id', 'keyword_id', 'search_term', 'date']
  },
  {
    key:          'spAdvertisedProduct',
    adProduct:    'SPONSORED_PRODUCTS',
    reportTypeId: 'spAdvertisedProduct',
    groupBy:      ['advertiser'],
    columns:      [
      'campaignId', 'campaignName', 'campaignStatus', 'campaignBudgetAmount',
      'campaignBudgetType', 'campaignBudgetCurrencyCode',
      'adGroupId', 'adGroupName', 'adId', 'advertisedAsin', 'advertisedSku',
      'portfolioId', 'impressions', 'clicks', 'cost', 'spend', 'costPerClick', 'clickThroughRate',
      'purchases30d', 'sales30d', 'unitsSoldClicks30d',
      'purchases1d', 'purchases7d', 'purchases14d',
      'sales1d', 'sales7d', 'sales14d',
      'unitsSoldClicks1d', 'unitsSoldClicks7d', 'unitsSoldClicks14d',
      'purchasesSameSku30d', 'purchasesSameSku1d', 'purchasesSameSku7d', 'purchasesSameSku14d',
      'unitsSoldSameSku30d', 'unitsSoldSameSku1d', 'unitsSoldSameSku7d', 'unitsSoldSameSku14d',
      'attributedSalesSameSku30d', 'attributedSalesSameSku1d', 'attributedSalesSameSku7d', 'attributedSalesSameSku14d',
      'salesOtherSku7d', 'unitsSoldOtherSku7d',
      'acosClicks7d', 'acosClicks14d', 'roasClicks7d', 'roasClicks14d',
      'date'
    ],
    table:      'sp_advertised_product_report',
    primaryKey: ['client_id', 'profile_id', 'campaign_id', 'ad_group_id', 'ad_id', 'date']
  },
  {
    key:          'spCampaignPlacement',
    adProduct:    'SPONSORED_PRODUCTS',
    reportTypeId: 'spCampaigns',   // SP placement uses spCampaigns reportTypeId
    groupBy:      ['campaignPlacement'],
    columns:      [
      'campaignId', 'campaignName', 'campaignStatus',
      'campaignBudgetAmount', 'campaignBudgetType', 'campaignBudgetCurrencyCode',
      'placementClassification',
      'impressions', 'clicks', 'cost',
      'purchases30d', 'sales30d', 'unitsSoldClicks30d',
      'purchases1d', 'purchases7d', 'purchases14d',
      'sales1d', 'sales7d', 'sales14d',
      'topOfSearchImpressionShare', 'date'
    ],
    table:      'sp_campaign_placement_report',
    primaryKey: ['client_id', 'profile_id', 'campaign_id', 'placement', 'date']
  },
  {
    key:          'spPurchasedProduct',
    adProduct:    'SPONSORED_PRODUCTS',
    reportTypeId: 'spPurchasedProduct',
    groupBy:      ['asin'],
    columns:      [
      'campaignId', 'campaignName', 'campaignBudgetCurrencyCode',
      'adGroupId', 'adGroupName', 'keywordId', 'keyword', 'keywordType',
      'matchType', 'advertisedAsin', 'purchasedAsin', 'advertisedSku',
      'purchases1d', 'purchases7d', 'purchases14d', 'purchases30d',
      'unitsSoldClicks1d', 'unitsSoldClicks7d', 'unitsSoldClicks14d', 'unitsSoldClicks30d',
      'sales1d', 'sales7d', 'sales14d', 'sales30d',
      'purchasesOtherSku1d', 'purchasesOtherSku7d', 'purchasesOtherSku14d', 'purchasesOtherSku30d',
      'salesOtherSku1d', 'salesOtherSku7d', 'salesOtherSku14d', 'salesOtherSku30d',
      'unitsSoldOtherSku1d', 'unitsSoldOtherSku7d', 'unitsSoldOtherSku14d', 'unitsSoldOtherSku30d',
      'date'
    ],
    table:      'sp_purchased_product_report',
    primaryKey: ['client_id', 'profile_id', 'campaign_id', 'ad_group_id', 'keyword_id', 'advertised_asin', 'purchased_asin', 'date']
  },
  {
    key:          'sbCampaigns',
    adProduct:    'SPONSORED_BRANDS',
    reportTypeId: 'sbCampaigns',
    groupBy:      ['campaign'],
    columns:      [
      'campaignId', 'campaignName', 'campaignStatus',
      'campaignBudgetAmount', 'campaignBudgetType', 'campaignBudgetCurrencyCode',
      'impressions', 'clicks', 'cost', 'costType',
      'purchases', 'purchasesClicks', 'purchasesPromoted',
      'sales', 'salesClicks', 'salesPromoted',
      'unitsSold', 'unitsSoldClicks',
      'newToBrandPurchases', 'newToBrandPurchasesClicks', 'newToBrandPurchasesPercentage', 'newToBrandPurchasesRate',
      'newToBrandSales', 'newToBrandSalesClicks', 'newToBrandSalesPercentage',
      'newToBrandUnitsSold', 'newToBrandUnitsSoldClicks', 'newToBrandUnitsSoldPercentage',
      'newToBrandDetailPageViews', 'newToBrandDetailPageViewsClicks', 'newToBrandDetailPageViewRate', 'newToBrandECPDetailPageView',
      'detailPageViews', 'detailPageViewsClicks',
      'addToCart', 'addToCartClicks', 'addToCartRate', 'eCPAddToCart',
      'addToList', 'addToListFromClicks',
      'qualifiedBorrows', 'qualifiedBorrowsFromClicks',
      'royaltyQualifiedBorrows', 'royaltyQualifiedBorrowsFromClicks',
      'brandedSearches', 'brandedSearchesClicks',
      'brandStorePageView', 'topOfSearchImpressionShare',
      'video5SecondViewRate', 'video5SecondViews',
      'videoCompleteViews', 'videoFirstQuartileViews', 'videoMidpointViews', 'videoThirdQuartileViews', 'videoUnmutes',
      'viewabilityRate', 'viewableImpressions', 'viewClickThroughRate',
      'kindleEditionNormalizedPagesRead14d', 'kindleEditionNormalizedPagesRoyalties14d',
      'date'
    ],
    table:      'sb_campaign_report',
    primaryKey: ['client_id', 'profile_id', 'campaign_id', 'report_date']
  },
  {
    key:          'sbTargeting',   // was sbKeywords — correct reportTypeId is sbTargeting
    adProduct:    'SPONSORED_BRANDS',
    reportTypeId: 'sbTargeting',
    groupBy:      ['targeting'],
    filters:      [{ field: 'keywordType', values: ['BROAD','PHRASE','EXACT','TARGETING_EXPRESSION','TARGETING_EXPRESSION_PREDEFINED'] }],
    columns:      [
      'campaignId', 'campaignName', 'campaignStatus',
      'campaignBudgetAmount', 'campaignBudgetType', 'campaignBudgetCurrencyCode',
      'adGroupId', 'adGroupName',
      'keywordId', 'keywordText', 'keywordType', 'matchType', 'keywordBid', 'adKeywordStatus',
      'targetingExpression', 'targetingId', 'targetingText', 'targetingType',
      'impressions', 'clicks', 'cost', 'costType',
      'purchases', 'purchasesClicks', 'purchasesPromoted',
      'sales', 'salesClicks', 'salesPromoted',
      'unitsSold',
      'newToBrandPurchases', 'newToBrandPurchasesClicks', 'newToBrandPurchasesPercentage', 'newToBrandPurchasesRate',
      'newToBrandSales', 'newToBrandSalesClicks', 'newToBrandSalesPercentage',
      'newToBrandUnitsSold', 'newToBrandUnitsSoldClicks', 'newToBrandUnitsSoldPercentage',
      'newToBrandDetailPageViews', 'newToBrandDetailPageViewsClicks', 'newToBrandDetailPageViewRate', 'newToBrandECPDetailPageView',
      'detailPageViews', 'detailPageViewsClicks',
      'addToCart', 'addToCartClicks', 'addToCartRate', 'eCPAddToCart',
      'addToList', 'addToListFromClicks',
      'brandedSearches', 'brandedSearchesClicks',
      'topOfSearchImpressionShare',
      'date'
    ],
    table:      'sb_keyword_report',
    primaryKey: ['client_id', 'profile_id', 'keyword_id', 'report_date']
  },
  {
    key:          'sbSearchTerms',
    adProduct:    'SPONSORED_BRANDS',
    reportTypeId: 'sbSearchTerm',   // correct reportTypeId (no 's')
    groupBy:      ['searchTerm'],
    filters:      [{ field: 'keywordType', values: ['BROAD','PHRASE','EXACT','TARGETING_EXPRESSION','TARGETING_EXPRESSION_PREDEFINED'] }],
    columns:      [
      'campaignId', 'campaignName', 'campaignStatus',
      'campaignBudgetAmount', 'campaignBudgetType', 'campaignBudgetCurrencyCode',
      'adGroupId', 'adGroupName',
      'keywordId', 'keywordText', 'matchType', 'keywordBid',
      'searchTerm',
      'impressions', 'clicks', 'cost', 'costType',
      'purchases', 'purchasesClicks', 'sales', 'salesClicks', 'unitsSold',
      'video5SecondViewRate', 'video5SecondViews',
      'videoCompleteViews', 'videoFirstQuartileViews', 'videoMidpointViews', 'videoThirdQuartileViews', 'videoUnmutes',
      'viewabilityRate', 'viewableImpressions', 'viewClickThroughRate',
      'kindleEditionNormalizedPagesRead14d', 'kindleEditionNormalizedPagesRoyalties14d',
      'date'
    ],
    table:      'sb_search_term_report',
    primaryKey: ['client_id', 'profile_id', 'keyword_id', 'search_term', 'report_date']
  },
  {
    key:          'sbTargets',
    adProduct:    'SPONSORED_BRANDS',
    reportTypeId: 'sbTargeting',   // same reportTypeId, different filter
    groupBy:      ['targeting'],
    filters:      [{ field: 'keywordType', values: ['TARGETING_EXPRESSION','TARGETING_EXPRESSION_PREDEFINED'] }],
    columns:      [
      'campaignId', 'campaignName', 'campaignStatus',
      'campaignBudgetAmount', 'campaignBudgetType', 'campaignBudgetCurrencyCode',
      'adGroupId', 'adGroupName',
      'targetingExpression', 'targetingId', 'targetingText', 'targetingType',
      'impressions', 'clicks', 'cost', 'costType',
      'purchases', 'purchasesClicks', 'sales', 'salesClicks', 'unitsSold',
      'newToBrandPurchases', 'newToBrandPurchasesClicks',
      'newToBrandSales', 'newToBrandSalesClicks',
      'newToBrandUnitsSold', 'newToBrandUnitsSoldClicks',
      'topOfSearchImpressionShare',
      'date'
    ],
    table:      'sb_target_report',
    primaryKey: ['client_id', 'profile_id', 'target_id', 'report_date']
  },
  {
    key:          'sbPlacements',
    adProduct:    'SPONSORED_BRANDS',
    reportTypeId: 'sbCampaignPlacement',   // correct reportTypeId
    groupBy:      ['campaignPlacement'],
    columns:      [
      'campaignId', 'campaignName', 'campaignStatus',
      'campaignBudgetAmount', 'campaignBudgetType', 'campaignBudgetCurrencyCode',
      'placementClassification',
      'impressions', 'clicks', 'cost', 'costType',
      'purchases', 'purchasesClicks', 'purchasesPromoted',
      'sales', 'salesClicks', 'salesPromoted',
      'unitsSold', 'unitsSoldClicks',
      'newToBrandPurchases', 'newToBrandPurchasesClicks', 'newToBrandPurchasesPercentage',
      'newToBrandSales', 'newToBrandSalesClicks', 'newToBrandSalesPercentage',
      'newToBrandUnitsSold', 'newToBrandUnitsSoldClicks', 'newToBrandUnitsSoldPercentage',
      'newToBrandDetailPageViews', 'newToBrandDetailPageViewsClicks', 'newToBrandDetailPageViewRate', 'newToBrandECPDetailPageView',
      'detailPageViews', 'detailPageViewsClicks',
      'addToCart', 'addToCartClicks', 'addToCartRate', 'eCPAddToCart',
      'video5SecondViewRate', 'video5SecondViews',
      'videoCompleteViews', 'videoFirstQuartileViews', 'videoMidpointViews', 'videoThirdQuartileViews', 'videoUnmutes',
      'viewabilityRate', 'viewableImpressions', 'viewClickThroughRate',
      'date'
    ],
    table:      'sb_placement_report',
    primaryKey: ['client_id', 'profile_id', 'campaign_id', 'placement', 'report_date']
  },
  {
    key:          'sdCampaigns',
    adProduct:    'SPONSORED_DISPLAY',
    reportTypeId: 'sdCampaigns',
    groupBy:      ['campaign'],
    columns:      [
      'campaignId', 'campaignName', 'campaignStatus', 'campaignBudgetAmount', 'campaignBudgetCurrencyCode',
      'costType',
      'impressions', 'impressionsViews', 'clicks', 'cost',
      'purchases', 'purchasesClicks', 'purchasesPromotedClicks',
      'sales', 'salesClicks', 'salesPromotedClicks',
      'unitsSold', 'unitsSoldClicks',
      'detailPageViews', 'detailPageViewsClicks',
      'addToCart', 'addToCartClicks', 'addToCartRate', 'addToCartViews', 'eCPAddToCart',
      'addToList', 'addToListFromClicks', 'addToListFromViews',
      'qualifiedBorrows', 'qualifiedBorrowsFromClicks', 'qualifiedBorrowsFromViews',
      'royaltyQualifiedBorrows', 'royaltyQualifiedBorrowsFromClicks', 'royaltyQualifiedBorrowsFromViews',
      'brandedSearches', 'brandedSearchesClicks', 'brandedSearchesViews', 'brandedSearchRate',
      'newToBrandPurchases', 'newToBrandPurchasesClicks',
      'newToBrandSales', 'newToBrandSalesClicks',
      'newToBrandUnitsSold', 'newToBrandUnitsSoldClicks',
      'newToBrandDetailPageViews', 'newToBrandDetailPageViewClicks',
      'newToBrandDetailPageViewRate', 'newToBrandDetailPageViewViews', 'newToBrandECPDetailPageView',
      'cumulativeReach', 'impressionsFrequencyAverage',
      'videoCompleteViews', 'videoFirstQuartileViews', 'videoMidpointViews', 'videoThirdQuartileViews', 'videoUnmutes',
      'viewabilityRate', 'viewClickThroughRate', 'eCPBrandSearch',
      'longTermSales', 'longTermROAS',
      'date'
    ],
    table:      'sd_campaign_report',
    primaryKey: ['client_id', 'profile_id', 'campaign_id', 'date']
  },
  {
    key:          'sdAdGroups',
    adProduct:    'SPONSORED_DISPLAY',
    reportTypeId: 'sdAdGroup',   // correct reportTypeId
    groupBy:      ['adGroup'],
    columns:      [
      'adGroupId', 'adGroupName', 'campaignId', 'bidOptimization',
      'impressions', 'impressionsViews', 'clicks', 'cost',
      'purchases', 'purchasesClicks', 'purchasesPromotedClicks',
      'sales', 'salesClicks', 'salesPromotedClicks',
      'unitsSold', 'unitsSoldClicks',
      'detailPageViews', 'detailPageViewsClicks',
      'addToCart', 'addToCartClicks', 'addToCartRate', 'addToCartViews', 'eCPAddToCart',
      'addToList', 'addToListFromClicks', 'addToListFromViews',
      'qualifiedBorrows', 'qualifiedBorrowsFromClicks', 'qualifiedBorrowsFromViews',
      'royaltyQualifiedBorrows', 'royaltyQualifiedBorrowsFromClicks', 'royaltyQualifiedBorrowsFromViews',
      'brandedSearches', 'brandedSearchesClicks', 'brandedSearchesViews', 'brandedSearchRate',
      'newToBrandPurchases', 'newToBrandPurchasesClicks',
      'newToBrandSales', 'newToBrandSalesClicks',
      'newToBrandUnitsSold', 'newToBrandUnitsSoldClicks',
      'newToBrandDetailPageViews', 'newToBrandDetailPageViewClicks',
      'newToBrandDetailPageViewRate', 'newToBrandDetailPageViewViews', 'newToBrandECPDetailPageView',
      'cumulativeReach', 'impressionsFrequencyAverage',
      'videoCompleteViews', 'videoFirstQuartileViews', 'videoMidpointViews', 'videoThirdQuartileViews', 'videoUnmutes',
      'viewabilityRate', 'viewClickThroughRate', 'eCPBrandSearch',
      'date'
    ],
    table:      'sd_ad_group_report',
    primaryKey: ['client_id', 'profile_id', 'ad_group_id', 'date']
  },
  {
    key:          'sdTargeting',
    adProduct:    'SPONSORED_DISPLAY',
    reportTypeId: 'sdTargeting',
    groupBy:      ['targeting'],
    columns:      [
      'adGroupId', 'adGroupName', 'campaignId', 'campaignName', 'campaignBudgetCurrencyCode',
      'targetingExpression', 'targetingId', 'targetingText',
      'impressions', 'impressionsViews', 'clicks', 'cost',
      'purchases', 'purchasesClicks', 'purchasesPromotedClicks',
      'sales', 'salesClicks', 'salesPromotedClicks',
      'unitsSold', 'unitsSoldClicks',
      'detailPageViews', 'detailPageViewsClicks',
      'addToCart', 'addToCartClicks', 'addToCartRate', 'addToCartViews', 'eCPAddToCart',
      'addToList', 'addToListFromClicks', 'addToListFromViews',
      'qualifiedBorrows', 'qualifiedBorrowsFromClicks', 'qualifiedBorrowsFromViews',
      'royaltyQualifiedBorrows', 'royaltyQualifiedBorrowsFromClicks', 'royaltyQualifiedBorrowsFromViews',
      'brandedSearches', 'brandedSearchesClicks', 'brandedSearchesViews', 'brandedSearchRate',
      'newToBrandPurchases', 'newToBrandPurchasesClicks',
      'newToBrandSales', 'newToBrandSalesClicks',
      'newToBrandUnitsSold', 'newToBrandUnitsSoldClicks',
      'newToBrandDetailPageViews', 'newToBrandDetailPageViewClicks',
      'newToBrandDetailPageViewRate', 'newToBrandDetailPageViewViews', 'newToBrandECPDetailPageView',
      'videoCompleteViews', 'videoFirstQuartileViews', 'videoMidpointViews', 'videoThirdQuartileViews', 'videoUnmutes',
      'viewabilityRate', 'viewClickThroughRate', 'eCPBrandSearch',
      'date'
    ],
    table:      'sd_target_report',
    primaryKey: ['client_id', 'profile_id', 'ad_group_id', 'campaign_id', 'targeting_id', 'date']
  },
  {
    key:          'sdAdvertisedProduct',   // was sdProductAds
    adProduct:    'SPONSORED_DISPLAY',
    reportTypeId: 'sdAdvertisedProduct',   // correct reportTypeId
    groupBy:      ['advertiser'],
    columns:      [
      'adId', 'adGroupId', 'adGroupName', 'campaignId', 'campaignName', 'campaignBudgetCurrencyCode',
      'promotedAsin', 'promotedSku',   // SD uses promotedAsin NOT advertisedAsin
      'bidOptimization',
      'impressions', 'impressionsViews', 'impressionsFrequencyAverage', 'clicks', 'cost',
      'purchases', 'purchasesClicks', 'purchasesPromotedClicks',
      'sales', 'salesClicks', 'salesPromotedClicks',
      'unitsSold', 'unitsSoldClicks',
      'detailPageViews', 'detailPageViewsClicks',
      'addToCart', 'addToCartClicks', 'addToCartRate', 'addToCartViews', 'eCPAddToCart',
      'addToList', 'addToListFromClicks', 'addToListFromViews',
      'qualifiedBorrows', 'qualifiedBorrowsFromClicks', 'qualifiedBorrowsFromViews',
      'royaltyQualifiedBorrows', 'royaltyQualifiedBorrowsFromClicks', 'royaltyQualifiedBorrowsFromViews',
      'brandedSearches', 'brandedSearchesClicks', 'brandedSearchesViews', 'brandedSearchRate',
      'newToBrandPurchases', 'newToBrandPurchasesClicks',
      'newToBrandSales', 'newToBrandSalesClicks',
      'newToBrandUnitsSold', 'newToBrandUnitsSoldClicks',
      'newToBrandDetailPageViews', 'newToBrandDetailPageViewClicks',
      'newToBrandDetailPageViewRate', 'newToBrandDetailPageViewViews', 'newToBrandECPDetailPageView',
      'cumulativeReach',
      'videoCompleteViews', 'videoFirstQuartileViews', 'videoMidpointViews', 'videoThirdQuartileViews', 'videoUnmutes',
      'viewabilityRate', 'viewClickThroughRate', 'eCPBrandSearch',
      'date'
    ],
    table:      'sd_product_ad_report',
    primaryKey: ['client_id', 'profile_id', 'ad_id', 'date']
  }
];

// Build a lookup map: key → REPORT_TYPES entry
const REPORT_TYPE_MAP = Object.fromEntries(REPORT_TYPES.map(rt => [rt.key, rt]));

// ============================================================
// HELPERS
// ============================================================

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Convert camelCase API column name to snake_case Snowflake column name.
 * e.g. campaignId → campaign_id, purchases30d → purchases_30_d
 */
function toSnake(str) {
  return str
    // Insert underscore before numeric sequences (e.g. 30d → _30_d)
    .replace(/(\d+)([a-zA-Z])/g, '_$1_$2')
    .replace(/([a-zA-Z])(\d+)/g, '$1_$2')
    // camelCase → snake_case
    .replace(/([A-Z])/g, '_$1')
    .toLowerCase()
    // Clean up double underscores
    .replace(/__+/g, '_')
    .replace(/^_/, '');
}

/**
 * Format a Date object as YYYYMMDD string.
 */
function toDateKey(date) {
  return date.toISOString().split('T')[0].replace(/-/g, '');
}

/**
 * Format a YYYYMMDD string as YYYY-MM-DD (for SQL DATE columns).
 */
function toISODate(dateKey) {
  return `${dateKey.substring(0,4)}-${dateKey.substring(4,6)}-${dateKey.substring(6,8)}`;
}

// ============================================================
// CLIENT + PROFILE FUNCTIONS
// ============================================================

/**
 * Create a fresh authenticated axios instance per request.
 * Calls getValidToken() each time so tokens are always fresh.
 */
async function adsClient(clientId, connectionType) {
  const accessToken = await getValidToken(clientId, connectionType);
  return axios.create({
    baseURL: ADS_API_BASE,
    headers: {
      'Authorization':                  `Bearer ${accessToken}`,
      'Amazon-Advertising-API-ClientId': process.env.LWA_CLIENT_ID,
      'Content-Type':                    'application/json'
    },
    timeout: 30000
  });
}

/**
 * Fetch all advertising profiles for a client.
 */
async function fetchProfiles(clientId, connectionType) {
  const client = await adsClient(clientId, connectionType);
  const res = await client.get('/v2/profiles');
  return res.data || [];
}

/**
 * Filter profiles to those with a matching brand entry in Snowflake.
 * Falls back to all profiles if no brands are configured yet.
 */
async function getAuthorizedProfiles(clientId, allProfiles) {
  try {
    const brandRows = await query(
      'SELECT ads_profile_id FROM brands WHERE client_id = ? AND is_active = TRUE AND ads_profile_id IS NOT NULL',
      [clientId]
    );
    if (!brandRows.length) {
      console.log(`[Ads] Client ${clientId}: no brands configured — using all ${allProfiles.length} profiles`);
      return allProfiles;
    }
    const authorizedIds = new Set(brandRows.map(r => String(r.ADS_PROFILE_ID || r.ads_profile_id)));
    const filtered = allProfiles.filter(p => authorizedIds.has(String(p.profileId)));
    console.log(`[Ads] Client ${clientId}: ${filtered.length}/${allProfiles.length} profiles authorized via brands`);
    return filtered;
  } catch (err) {
    console.warn(`[Ads] getAuthorizedProfiles error — using all profiles: ${err.message}`);
    return allProfiles;
  }
}

// ============================================================
// REPORT REQUEST + DOWNLOAD
// ============================================================

/**
 * Request a v3 async report.
 * Handles 425 (duplicate) by extracting and returning the existing reportId.
 * Adds 2s delay after each successful request to avoid throttling.
 */
async function requestV3Report(client, profileId, startDate, reportTypeId, adProduct, groupBy, columns, filters) {
  try {
    const config = {
      adProduct,
      groupBy,
      columns,
      reportTypeId,
      timeUnit: 'DAILY',
      format:   'GZIP_JSON'
    };
    if (filters && filters.length) config.filters = filters;

    const res = await client.post('/reporting/reports', {
      name:      `${adProduct}_${reportTypeId}_${startDate}`,
      startDate,
      endDate:   startDate,
      configuration: config
    }, {
      headers: {
        'Amazon-Advertising-API-Scope': profileId,
        'Content-Type': 'application/vnd.createasyncreportrequest.v3+json',
        'Accept':        'application/vnd.createasyncreportrequest.v3+json'
      },
      // Force the Content-Type header — axios may override it otherwise
      transformRequest: [(data, headers) => {
        headers['Content-Type'] = 'application/vnd.createasyncreportrequest.v3+json';
        return JSON.stringify(data);
      }]
    });

    // Throttle: 2s between requests to avoid 429
    await sleep(2000);

    return res.data?.reportId;
  } catch (err) {
    const status = err.response?.status;

    // 425 = duplicate report — Amazon returns the existing ID in the error detail
    if (status === 425) {
      const detail = err.response?.data?.detail || '';
      const match  = detail.match(/duplicate of\s*:\s*([\w-]+)/i);
      if (match?.[1]) {
        console.log(`[Ads] 425 duplicate — reusing report ${match[1]} for ${adProduct} ${reportTypeId} ${startDate}`);
        await sleep(2000);
        return match[1];
      }
    }

    // 429 = throttled — wait longer
    if (status === 429) {
      console.warn(`[Ads] 429 throttled for ${adProduct} ${reportTypeId} — waiting 10s`);
      await sleep(10000);
    }

    throw err;
  }
}

/**
 * Poll a report until COMPLETED (or FAILURE/timeout), then download and gunzip.
 * Returns parsed JSON array.
 */
async function downloadReport(client, profileId, reportId, maxWaitMs = 300000) {
  const start     = Date.now();
  let   pollCount = 0;

  while (Date.now() - start < maxWaitMs) {
    const res = await client.get(`/reporting/reports/${reportId}`, {
      headers: { 'Amazon-Advertising-API-Scope': profileId }
    });
    const { status, url, failureReason } = res.data;

    if (status === 'COMPLETED' && url) {
      const dl  = await axios.get(url, { responseType: 'arraybuffer', timeout: 120000 });
      const buf = zlib.gunzipSync(Buffer.from(dl.data));
      return JSON.parse(buf.toString('utf8'));
    }

    if (status === 'FAILURE') {
      throw new Error(`Report ${reportId} FAILURE: ${failureReason || 'unknown reason'}`);
    }

    if (status === 'PENDING' || status === 'PROCESSING') {
      pollCount++;
      const delay = pollCount <= 10 ? 8000 : 15000;
      await sleep(delay);
      continue;
    }

    throw new Error(`Report ${reportId} unexpected status: ${status}`);
  }

  throw new Error(`Report ${reportId} timed out after ${maxWaitMs / 1000}s`);
}

// ============================================================
// CAMPAIGN ENTITY INGESTION
// ============================================================

/**
 * Fetch all campaigns for a profile (enabled + paused + archived).
 */
async function fetchCampaigns(client, profileId) {
  const res = await client.get('/v2/campaigns', {
    headers: { 'Amazon-Advertising-API-Scope': profileId },
    params:  { stateFilter: 'enabled,paused,archived', count: 100 }
  });
  return Array.isArray(res.data) ? res.data : [];
}

/**
 * Upsert campaign entities into ad_campaigns.
 */
async function writeCampaigns(clientId, connectionType, profileId, campaigns) {
  if (!campaigns.length) return 0;
  let written = 0;
  for (const c of campaigns) {
    await query(`
      MERGE INTO ad_campaigns t
      USING (SELECT ? AS client_id, ? AS connection_type, ? AS campaign_id) s
      ON t.client_id = s.client_id AND t.connection_type = s.connection_type AND t.campaign_id = s.campaign_id
      WHEN MATCHED THEN UPDATE SET
        campaign_name = ?, campaign_type = ?, status = ?,
        budget = ?, budget_type = ?, synced_at = CURRENT_TIMESTAMP
      WHEN NOT MATCHED THEN INSERT
        (client_id, connection_type, campaign_id, campaign_name, campaign_type, status, budget, budget_type, synced_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `, [
      clientId, connectionType, String(c.campaignId),
      c.name, c.campaignType, c.state,
      c.dailyBudget || null, c.budgetType || null,
      clientId, connectionType, String(c.campaignId),
      c.name, c.campaignType, c.state,
      c.dailyBudget || null, c.budgetType || null
    ]);
    written++;
  }
  return written;
}

/**
 * Ingest campaign entities for all authorized profiles.
 */
async function ingestCampaigns(clientId, connectionType) {
  return runJob(clientId, connectionType, 'campaigns', async () => {
    const allProfiles = await fetchProfiles(clientId, connectionType);
    const profiles    = await getAuthorizedProfiles(clientId, allProfiles);
    let totalWritten  = 0;

    for (const profile of profiles) {
      const client    = await adsClient(clientId, connectionType);
      const campaigns = await fetchCampaigns(client, String(profile.profileId));
      totalWritten   += await writeCampaigns(clientId, connectionType, String(profile.profileId), campaigns);
    }

    return { recordsWritten: totalWritten };
  });
}

// ============================================================
// PER-TABLE WRITE FUNCTIONS (MERGE upsert)
// ============================================================

/**
 * Generic helper: map a report row (camelCase API names) to snake_case values
 * for a given set of API column names. Returns an object keyed by snake_case names.
 */
function mapRow(apiRow, apiColumns) {
  const mapped = {};
  for (const col of apiColumns) {
    const snake = toSnake(col);
    const val   = apiRow[col];
    mapped[snake] = (val === undefined || val === null || val === '') ? null : val;
  }
  return mapped;
}

/**
 * Write rows to sp_campaign_report using MERGE.
 */
async function writeSpCampaignReport(clientId, profileId, reportDate, rows) {
  if (!rows.length) return 0;
  const isoDate = toISODate(reportDate);
  let written = 0;
  for (const r of rows) {
    await query(`
      MERGE INTO sp_campaign_report t
      USING (SELECT ? AS client_id, ? AS profile_id, ? AS campaign_id, ?::DATE AS date) s
      ON t.client_id = s.client_id AND t.profile_id = s.profile_id
        AND t.campaign_id = s.campaign_id AND t.date = s.date
      WHEN MATCHED THEN UPDATE SET
        campaign_name = ?, campaign_budget_amount = ?, campaign_budget_type = ?,
        campaign_budget_currency_code = ?, campaign_bidding_strategy = ?,
        top_of_search_impression_share = ?,
        impressions = ?, clicks = ?, cost = ?,
        purchases_1_d = ?, purchases_7_d = ?, purchases_14_d = ?, purchases_30_d = ?,
        sales_1_d = ?, sales_7_d = ?, sales_14_d = ?, sales_30_d = ?,
        units_sold_clicks_1_d = ?, units_sold_clicks_7_d = ?, units_sold_clicks_14_d = ?, units_sold_clicks_30_d = ?,
        synced_at = CURRENT_TIMESTAMP
      WHEN NOT MATCHED THEN INSERT (
        client_id, profile_id, campaign_id, date,
        campaign_name, campaign_budget_amount, campaign_budget_type,
        campaign_budget_currency_code, campaign_bidding_strategy,
        top_of_search_impression_share,
        impressions, clicks, cost,
        purchases_1_d, purchases_7_d, purchases_14_d, purchases_30_d,
        sales_1_d, sales_7_d, sales_14_d, sales_30_d,
        units_sold_clicks_1_d, units_sold_clicks_7_d, units_sold_clicks_14_d, units_sold_clicks_30_d,
        synced_at
      ) VALUES (
        ?, ?, ?, ?::DATE,
        ?, ?, ?, ?, ?,
        ?,
        ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        CURRENT_TIMESTAMP
      )
    `, [
      // MERGE key
      clientId, profileId, String(r.campaignId), isoDate,
      // UPDATE
      r.campaignName || null, r.campaignBudgetAmount || null, r.campaignBudgetType || null,
      r.campaignBudgetCurrencyCode || null, r.campaignBiddingStrategy || null,
      r.topOfSearchImpressionShare || null,
      r.impressions || 0, r.clicks || 0, r.cost || 0,
      r.purchases1d || null, r.purchases7d || null, r.purchases14d || null, r.purchases30d || null,
      r.sales1d || null, r.sales7d || null, r.sales14d || null, r.sales30d || null,
      r.unitsSoldClicks1d || null, r.unitsSoldClicks7d || null, r.unitsSoldClicks14d || null, r.unitsSoldClicks30d || null,
      // INSERT
      clientId, profileId, String(r.campaignId), isoDate,
      r.campaignName || null, r.campaignBudgetAmount || null, r.campaignBudgetType || null,
      r.campaignBudgetCurrencyCode || null, r.campaignBiddingStrategy || null,
      r.topOfSearchImpressionShare || null,
      r.impressions || 0, r.clicks || 0, r.cost || 0,
      r.purchases1d || null, r.purchases7d || null, r.purchases14d || null, r.purchases30d || null,
      r.sales1d || null, r.sales7d || null, r.sales14d || null, r.sales30d || null,
      r.unitsSoldClicks1d || null, r.unitsSoldClicks7d || null, r.unitsSoldClicks14d || null, r.unitsSoldClicks30d || null
    ]);
    written++;
  }
  return written;
}

/**
 * Write rows to sp_ad_group_report using MERGE.
 */
async function writeSpAdGroupReport(clientId, profileId, reportDate, rows) {
  if (!rows.length) return 0;
  const isoDate = toISODate(reportDate);
  let written = 0;
  for (const r of rows) {
    await query(`
      MERGE INTO sp_ad_group_report t
      USING (SELECT ? AS client_id, ? AS profile_id, ? AS ad_group_id, ?::DATE AS date) s
      ON t.client_id = s.client_id AND t.profile_id = s.profile_id
        AND t.ad_group_id = s.ad_group_id AND t.date = s.date
      WHEN MATCHED THEN UPDATE SET
        ad_group_name = ?,
        impressions = ?, clicks = ?, cost = ?,
        purchases_1_d = ?, purchases_7_d = ?, purchases_14_d = ?, purchases_30_d = ?,
        sales_1_d = ?, sales_7_d = ?, sales_14_d = ?, sales_30_d = ?,
        units_sold_clicks_1_d = ?, units_sold_clicks_7_d = ?, units_sold_clicks_14_d = ?, units_sold_clicks_30_d = ?,
        synced_at = CURRENT_TIMESTAMP
      WHEN NOT MATCHED THEN INSERT (
        client_id, profile_id, ad_group_id, date, ad_group_name,
        impressions, clicks, cost,
        purchases_1_d, purchases_7_d, purchases_14_d, purchases_30_d,
        sales_1_d, sales_7_d, sales_14_d, sales_30_d,
        units_sold_clicks_1_d, units_sold_clicks_7_d, units_sold_clicks_14_d, units_sold_clicks_30_d,
        synced_at
      ) VALUES (?, ?, ?, ?::DATE, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `, [
      clientId, profileId, String(r.adGroupId), isoDate,
      r.adGroupName || null,
      r.impressions || 0, r.clicks || 0, r.cost || 0,
      r.purchases1d || null, r.purchases7d || null, r.purchases14d || null, r.purchases30d || null,
      r.sales1d || null, r.sales7d || null, r.sales14d || null, r.sales30d || null,
      r.unitsSoldClicks1d || null, r.unitsSoldClicks7d || null, r.unitsSoldClicks14d || null, r.unitsSoldClicks30d || null,
      clientId, profileId, String(r.adGroupId), isoDate,
      r.adGroupName || null,
      r.impressions || 0, r.clicks || 0, r.cost || 0,
      r.purchases1d || null, r.purchases7d || null, r.purchases14d || null, r.purchases30d || null,
      r.sales1d || null, r.sales7d || null, r.sales14d || null, r.sales30d || null,
      r.unitsSoldClicks1d || null, r.unitsSoldClicks7d || null, r.unitsSoldClicks14d || null, r.unitsSoldClicks30d || null
    ]);
    written++;
  }
  return written;
}

/**
 * Write rows to sp_targeting_keyword_report using MERGE.
 */
async function writeSpTargetingReport(clientId, profileId, reportDate, rows) {
  if (!rows.length) return 0;
  const isoDate = toISODate(reportDate);
  let written = 0;
  for (const r of rows) {
    await query(`
      MERGE INTO sp_targeting_keyword_report t
      USING (SELECT ? AS client_id, ? AS profile_id, ? AS campaign_id, ? AS ad_group_id, ? AS keyword_id, ?::DATE AS date) s
      ON t.client_id = s.client_id AND t.profile_id = s.profile_id
        AND t.campaign_id = s.campaign_id AND t.ad_group_id = s.ad_group_id
        AND t.keyword_id = s.keyword_id AND t.date = s.date
      WHEN MATCHED THEN UPDATE SET
        targeting = ?, match_type = ?, keyword_bid = ?, ad_keyword_status = ?,
        top_of_search_impression_share = ?,
        impressions = ?, clicks = ?, cost = ?,
        purchases_1_d = ?, purchases_7_d = ?, purchases_14_d = ?, purchases_30_d = ?,
        sales_1_d = ?, sales_7_d = ?, sales_14_d = ?, sales_30_d = ?,
        units_sold_clicks_1_d = ?, units_sold_clicks_7_d = ?, units_sold_clicks_14_d = ?, units_sold_clicks_30_d = ?,
        synced_at = CURRENT_TIMESTAMP
      WHEN NOT MATCHED THEN INSERT (
        client_id, profile_id, campaign_id, ad_group_id, keyword_id, date,
        targeting, match_type, keyword_bid, ad_keyword_status, top_of_search_impression_share,
        impressions, clicks, cost,
        purchases_1_d, purchases_7_d, purchases_14_d, purchases_30_d,
        sales_1_d, sales_7_d, sales_14_d, sales_30_d,
        units_sold_clicks_1_d, units_sold_clicks_7_d, units_sold_clicks_14_d, units_sold_clicks_30_d,
        synced_at
      ) VALUES (?, ?, ?, ?, ?, ?::DATE, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `, [
      clientId, profileId, String(r.campaignId), String(r.adGroupId), String(r.keywordId), isoDate,
      r.targeting || null, r.matchType || null, r.keywordBid || null, r.adKeywordStatus || null,
      r.topOfSearchImpressionShare || null,
      r.impressions || 0, r.clicks || 0, r.cost || 0,
      r.purchases1d || null, r.purchases7d || null, r.purchases14d || null, r.purchases30d || null,
      r.sales1d || null, r.sales7d || null, r.sales14d || null, r.sales30d || null,
      r.unitsSoldClicks1d || null, r.unitsSoldClicks7d || null, r.unitsSoldClicks14d || null, r.unitsSoldClicks30d || null,
      clientId, profileId, String(r.campaignId), String(r.adGroupId), String(r.keywordId), isoDate,
      r.targeting || null, r.matchType || null, r.keywordBid || null, r.adKeywordStatus || null,
      r.topOfSearchImpressionShare || null,
      r.impressions || 0, r.clicks || 0, r.cost || 0,
      r.purchases1d || null, r.purchases7d || null, r.purchases14d || null, r.purchases30d || null,
      r.sales1d || null, r.sales7d || null, r.sales14d || null, r.sales30d || null,
      r.unitsSoldClicks1d || null, r.unitsSoldClicks7d || null, r.unitsSoldClicks14d || null, r.unitsSoldClicks30d || null
    ]);
    written++;
  }
  return written;
}

/**
 * Write rows to sp_search_term_report using MERGE.
 */
async function writeSpSearchTermReport(clientId, profileId, reportDate, rows) {
  if (!rows.length) return 0;
  const isoDate = toISODate(reportDate);
  let written = 0;
  for (const r of rows) {
    await query(`
      MERGE INTO sp_search_term_report t
      USING (SELECT ? AS client_id, ? AS profile_id, ? AS campaign_id, ? AS ad_group_id,
                    ? AS keyword_id, ? AS search_term, ?::DATE AS date) s
      ON t.client_id = s.client_id AND t.profile_id = s.profile_id
        AND t.campaign_id = s.campaign_id AND t.ad_group_id = s.ad_group_id
        AND t.keyword_id = s.keyword_id AND t.search_term = s.search_term AND t.date = s.date
      WHEN MATCHED THEN UPDATE SET
        targeting = ?, match_type = ?,
        impressions = ?, clicks = ?, cost = ?,
        purchases_1_d = ?, purchases_7_d = ?, purchases_14_d = ?, purchases_30_d = ?,
        sales_1_d = ?, sales_7_d = ?, sales_14_d = ?, sales_30_d = ?,
        units_sold_clicks_1_d = ?, units_sold_clicks_7_d = ?, units_sold_clicks_14_d = ?, units_sold_clicks_30_d = ?,
        synced_at = CURRENT_TIMESTAMP
      WHEN NOT MATCHED THEN INSERT (
        client_id, profile_id, campaign_id, ad_group_id, keyword_id, search_term, date,
        targeting, match_type, impressions, clicks, cost,
        purchases_1_d, purchases_7_d, purchases_14_d, purchases_30_d,
        sales_1_d, sales_7_d, sales_14_d, sales_30_d,
        units_sold_clicks_1_d, units_sold_clicks_7_d, units_sold_clicks_14_d, units_sold_clicks_30_d,
        synced_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?::DATE, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `, [
      clientId, profileId, String(r.campaignId), String(r.adGroupId),
      String(r.keywordId), r.searchTerm || '', isoDate,
      r.targeting || null, r.matchType || null,
      r.impressions || 0, r.clicks || 0, r.cost || 0,
      r.purchases1d || null, r.purchases7d || null, r.purchases14d || null, r.purchases30d || null,
      r.sales1d || null, r.sales7d || null, r.sales14d || null, r.sales30d || null,
      r.unitsSoldClicks1d || null, r.unitsSoldClicks7d || null, r.unitsSoldClicks14d || null, r.unitsSoldClicks30d || null,
      clientId, profileId, String(r.campaignId), String(r.adGroupId),
      String(r.keywordId), r.searchTerm || '', isoDate,
      r.targeting || null, r.matchType || null,
      r.impressions || 0, r.clicks || 0, r.cost || 0,
      r.purchases1d || null, r.purchases7d || null, r.purchases14d || null, r.purchases30d || null,
      r.sales1d || null, r.sales7d || null, r.sales14d || null, r.sales30d || null,
      r.unitsSoldClicks1d || null, r.unitsSoldClicks7d || null, r.unitsSoldClicks14d || null, r.unitsSoldClicks30d || null
    ]);
    written++;
  }
  return written;
}

/**
 * Write rows to sp_advertised_product_report using MERGE.
 */
async function writeSpAdvertisedProductReport(clientId, profileId, reportDate, rows) {
  if (!rows.length) return 0;
  const isoDate = toISODate(reportDate);
  let written = 0;
  for (const r of rows) {
    await query(`
      MERGE INTO sp_advertised_product_report t
      USING (SELECT ? AS client_id, ? AS profile_id, ? AS campaign_id, ? AS ad_group_id, ? AS ad_id, ?::DATE AS date) s
      ON t.client_id = s.client_id AND t.profile_id = s.profile_id
        AND t.campaign_id = s.campaign_id AND t.ad_group_id = s.ad_group_id
        AND t.ad_id = s.ad_id AND t.date = s.date
      WHEN MATCHED THEN UPDATE SET
        advertised_asin = ?, advertised_sku = ?,
        impressions = ?, clicks = ?, cost = ?,
        purchases_1_d = ?, purchases_7_d = ?, purchases_14_d = ?, purchases_30_d = ?,
        sales_1_d = ?, sales_7_d = ?, sales_14_d = ?, sales_30_d = ?,
        units_sold_clicks_1_d = ?, units_sold_clicks_7_d = ?, units_sold_clicks_14_d = ?, units_sold_clicks_30_d = ?,
        purchases_same_sku_30_d = ?, units_sold_same_sku_30_d = ?,
        synced_at = CURRENT_TIMESTAMP
      WHEN NOT MATCHED THEN INSERT (
        client_id, profile_id, campaign_id, ad_group_id, ad_id, date,
        advertised_asin, advertised_sku, impressions, clicks, cost,
        purchases_1_d, purchases_7_d, purchases_14_d, purchases_30_d,
        sales_1_d, sales_7_d, sales_14_d, sales_30_d,
        units_sold_clicks_1_d, units_sold_clicks_7_d, units_sold_clicks_14_d, units_sold_clicks_30_d,
        purchases_same_sku_30_d, units_sold_same_sku_30_d,
        synced_at
      ) VALUES (?, ?, ?, ?, ?, ?::DATE, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `, [
      clientId, profileId, String(r.campaignId), String(r.adGroupId), String(r.adId), isoDate,
      r.advertisedAsin || null, r.advertisedSku || null,
      r.impressions || 0, r.clicks || 0, r.cost || 0,
      r.purchases1d || null, r.purchases7d || null, r.purchases14d || null, r.purchases30d || null,
      r.sales1d || null, r.sales7d || null, r.sales14d || null, r.sales30d || null,
      r.unitsSoldClicks1d || null, r.unitsSoldClicks7d || null, r.unitsSoldClicks14d || null, r.unitsSoldClicks30d || null,
      r.purchasesSameSku30d || null, r.unitsSoldSameSku30d || null,
      clientId, profileId, String(r.campaignId), String(r.adGroupId), String(r.adId), isoDate,
      r.advertisedAsin || null, r.advertisedSku || null,
      r.impressions || 0, r.clicks || 0, r.cost || 0,
      r.purchases1d || null, r.purchases7d || null, r.purchases14d || null, r.purchases30d || null,
      r.sales1d || null, r.sales7d || null, r.sales14d || null, r.sales30d || null,
      r.unitsSoldClicks1d || null, r.unitsSoldClicks7d || null, r.unitsSoldClicks14d || null, r.unitsSoldClicks30d || null,
      r.purchasesSameSku30d || null, r.unitsSoldSameSku30d || null
    ]);
    written++;
  }
  return written;
}

/**
 * Write rows to sp_campaign_placement_report using MERGE.
 */
async function writeSpCampaignPlacementReport(clientId, profileId, reportDate, rows) {
  if (!rows.length) return 0;
  const isoDate = toISODate(reportDate);
  let written = 0;
  for (const r of rows) {
    await query(`
      MERGE INTO sp_campaign_placement_report t
      USING (SELECT ? AS client_id, ? AS profile_id, ? AS campaign_id, ? AS placement, ?::DATE AS date) s
      ON t.client_id = s.client_id AND t.profile_id = s.profile_id
        AND t.campaign_id = s.campaign_id AND t.placement = s.placement AND t.date = s.date
      WHEN MATCHED THEN UPDATE SET
        impressions = ?, clicks = ?, cost = ?,
        purchases_30_d = ?, sales_30_d = ?, units_sold_clicks_30_d = ?,
        synced_at = CURRENT_TIMESTAMP
      WHEN NOT MATCHED THEN INSERT (
        client_id, profile_id, campaign_id, placement, date,
        impressions, clicks, cost, purchases_30_d, sales_30_d, units_sold_clicks_30_d, synced_at
      ) VALUES (?, ?, ?, ?, ?::DATE, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `, [
      clientId, profileId, String(r.campaignId), r.placement || '', isoDate,
      r.impressions || 0, r.clicks || 0, r.cost || 0,
      r.purchases30d || null, r.sales30d || null, r.unitsSoldClicks30d || null,
      clientId, profileId, String(r.campaignId), r.placement || '', isoDate,
      r.impressions || 0, r.clicks || 0, r.cost || 0,
      r.purchases30d || null, r.sales30d || null, r.unitsSoldClicks30d || null
    ]);
    written++;
  }
  return written;
}

/**
 * Write rows to sb_campaign_report using MERGE.
 */
async function writeSbCampaignReport(clientId, profileId, reportDate, rows) {
  if (!rows.length) return 0;
  const isoDate = toISODate(reportDate);
  let written = 0;
  for (const r of rows) {
    await query(`
      MERGE INTO sb_campaign_report t
      USING (SELECT ? AS client_id, ? AS profile_id, ? AS campaign_id, ?::DATE AS report_date) s
      ON t.client_id = s.client_id AND t.profile_id = s.profile_id
        AND t.campaign_id = s.campaign_id AND t.report_date = s.report_date
      WHEN MATCHED THEN UPDATE SET
        campaign_name = ?, top_of_search_impression_share = ?,
        impressions = ?, clicks = ?, cost = ?,
        attributed_sales_14_d = ?, attributed_conversions_14_d = ?,
        attributed_orders_new_to_brand_14_d = ?, attributed_sales_new_to_brand_14_d = ?,
        attributed_units_ordered_new_to_brand_14_d = ?,
        video_5_second_views = ?, video_complete_views = ?, viewable_impressions = ?,
        synced_at = CURRENT_TIMESTAMP
      WHEN NOT MATCHED THEN INSERT (
        client_id, profile_id, campaign_id, report_date, campaign_name,
        top_of_search_impression_share, impressions, clicks, cost,
        attributed_sales_14_d, attributed_conversions_14_d,
        attributed_orders_new_to_brand_14_d, attributed_sales_new_to_brand_14_d,
        attributed_units_ordered_new_to_brand_14_d,
        video_5_second_views, video_complete_views, viewable_impressions, synced_at
      ) VALUES (?, ?, ?, ?::DATE, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `, [
      clientId, profileId, String(r.campaignId), isoDate,
      r.campaignName || null, r.topOfSearchImpressionShare || null,
      r.impressions || 0, r.clicks || 0, r.cost || 0,
      r.attributedSales14d || null, r.attributedConversions14d || null,
      r.attributedOrdersNewToBrand14d || null, r.attributedSalesNewToBrand14d || null,
      r.attributedUnitsOrderedNewToBrand14d || null,
      r.video5SecondViews || null, r.videoCompleteViews || null, r.viewableImpressions || null,
      clientId, profileId, String(r.campaignId), isoDate,
      r.campaignName || null,
      r.topOfSearchImpressionShare || null,
      r.impressions || 0, r.clicks || 0, r.cost || 0,
      r.attributedSales14d || null, r.attributedConversions14d || null,
      r.attributedOrdersNewToBrand14d || null, r.attributedSalesNewToBrand14d || null,
      r.attributedUnitsOrderedNewToBrand14d || null,
      r.video5SecondViews || null, r.videoCompleteViews || null, r.viewableImpressions || null
    ]);
    written++;
  }
  return written;
}

/**
 * Write rows to sb_keyword_report using MERGE.
 */
async function writeSbKeywordReport(clientId, profileId, reportDate, rows) {
  if (!rows.length) return 0;
  const isoDate = toISODate(reportDate);
  let written = 0;
  for (const r of rows) {
    await query(`
      MERGE INTO sb_keyword_report t
      USING (SELECT ? AS client_id, ? AS profile_id, ? AS keyword_id, ?::DATE AS report_date) s
      ON t.client_id = s.client_id AND t.profile_id = s.profile_id
        AND t.keyword_id = s.keyword_id AND t.report_date = s.report_date
      WHEN MATCHED THEN UPDATE SET
        campaign_id = ?, ad_group_id = ?,
        top_of_search_impression_share = ?,
        search_term_impression_rank = ?, search_term_impression_share = ?,
        impressions = ?, clicks = ?, cost = ?,
        attributed_sales_14_d = ?, attributed_conversions_14_d = ?,
        attributed_orders_new_to_brand_14_d = ?, attributed_sales_new_to_brand_14_d = ?,
        synced_at = CURRENT_TIMESTAMP
      WHEN NOT MATCHED THEN INSERT (
        client_id, profile_id, keyword_id, report_date, campaign_id, ad_group_id,
        top_of_search_impression_share, search_term_impression_rank, search_term_impression_share,
        impressions, clicks, cost,
        attributed_sales_14_d, attributed_conversions_14_d,
        attributed_orders_new_to_brand_14_d, attributed_sales_new_to_brand_14_d, synced_at
      ) VALUES (?, ?, ?, ?::DATE, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `, [
      clientId, profileId, String(r.keywordId), isoDate,
      String(r.campaignId || ''), String(r.adGroupId || ''),
      r.topOfSearchImpressionShare || null,
      r.searchTermImpressionRank || null, r.searchTermImpressionShare || null,
      r.impressions || 0, r.clicks || 0, r.cost || 0,
      r.attributedSales14d || null, r.attributedConversions14d || null,
      r.attributedOrdersNewToBrand14d || null, r.attributedSalesNewToBrand14d || null,
      clientId, profileId, String(r.keywordId), isoDate,
      String(r.campaignId || ''), String(r.adGroupId || ''),
      r.topOfSearchImpressionShare || null,
      r.searchTermImpressionRank || null, r.searchTermImpressionShare || null,
      r.impressions || 0, r.clicks || 0, r.cost || 0,
      r.attributedSales14d || null, r.attributedConversions14d || null,
      r.attributedOrdersNewToBrand14d || null, r.attributedSalesNewToBrand14d || null
    ]);
    written++;
  }
  return written;
}

/**
 * Write rows to sb_search_term_report using MERGE.
 */
async function writeSbSearchTermReport(clientId, profileId, reportDate, rows) {
  if (!rows.length) return 0;
  const isoDate = toISODate(reportDate);
  let written = 0;
  for (const r of rows) {
    await query(`
      MERGE INTO sb_search_term_report t
      USING (SELECT ? AS client_id, ? AS profile_id, ? AS keyword_id, ? AS query_term, ?::DATE AS report_date) s
      ON t.client_id = s.client_id AND t.profile_id = s.profile_id
        AND t.keyword_id = s.keyword_id AND t.query_term = s.query_term AND t.report_date = s.report_date
      WHEN MATCHED THEN UPDATE SET
        campaign_id = ?, ad_group_id = ?,
        search_term_impression_rank = ?, search_term_impression_share = ?,
        impressions = ?, clicks = ?, cost = ?,
        attributed_sales_14_d = ?, attributed_conversions_14_d = ?,
        synced_at = CURRENT_TIMESTAMP
      WHEN NOT MATCHED THEN INSERT (
        client_id, profile_id, keyword_id, query_term, report_date,
        campaign_id, ad_group_id,
        search_term_impression_rank, search_term_impression_share,
        impressions, clicks, cost,
        attributed_sales_14_d, attributed_conversions_14_d, synced_at
      ) VALUES (?, ?, ?, ?, ?::DATE, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `, [
      clientId, profileId, String(r.keywordId), r.queryTerm || '', isoDate,
      String(r.campaignId || ''), String(r.adGroupId || ''),
      r.searchTermImpressionRank || null, r.searchTermImpressionShare || null,
      r.impressions || 0, r.clicks || 0, r.cost || 0,
      r.attributedSales14d || null, r.attributedConversions14d || null,
      clientId, profileId, String(r.keywordId), r.queryTerm || '', isoDate,
      String(r.campaignId || ''), String(r.adGroupId || ''),
      r.searchTermImpressionRank || null, r.searchTermImpressionShare || null,
      r.impressions || 0, r.clicks || 0, r.cost || 0,
      r.attributedSales14d || null, r.attributedConversions14d || null
    ]);
    written++;
  }
  return written;
}

/**
 * Write rows to sb_target_report using MERGE.
 */
async function writeSbTargetReport(clientId, profileId, reportDate, rows) {
  if (!rows.length) return 0;
  const isoDate = toISODate(reportDate);
  let written = 0;
  for (const r of rows) {
    await query(`
      MERGE INTO sb_target_report t
      USING (SELECT ? AS client_id, ? AS profile_id, ? AS target_id, ?::DATE AS report_date) s
      ON t.client_id = s.client_id AND t.profile_id = s.profile_id
        AND t.target_id = s.target_id AND t.report_date = s.report_date
      WHEN MATCHED THEN UPDATE SET
        campaign_id = ?, ad_group_id = ?,
        top_of_search_impression_share = ?,
        impressions = ?, clicks = ?, cost = ?,
        attributed_sales_14_d = ?, attributed_conversions_14_d = ?,
        attributed_orders_new_to_brand_14_d = ?, attributed_sales_new_to_brand_14_d = ?,
        synced_at = CURRENT_TIMESTAMP
      WHEN NOT MATCHED THEN INSERT (
        client_id, profile_id, target_id, report_date, campaign_id, ad_group_id,
        top_of_search_impression_share, impressions, clicks, cost,
        attributed_sales_14_d, attributed_conversions_14_d,
        attributed_orders_new_to_brand_14_d, attributed_sales_new_to_brand_14_d, synced_at
      ) VALUES (?, ?, ?, ?::DATE, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `, [
      clientId, profileId, String(r.targetId), isoDate,
      String(r.campaignId || ''), String(r.adGroupId || ''),
      r.topOfSearchImpressionShare || null,
      r.impressions || 0, r.clicks || 0, r.cost || 0,
      r.attributedSales14d || null, r.attributedConversions14d || null,
      r.attributedOrdersNewToBrand14d || null, r.attributedSalesNewToBrand14d || null,
      clientId, profileId, String(r.targetId), isoDate,
      String(r.campaignId || ''), String(r.adGroupId || ''),
      r.topOfSearchImpressionShare || null,
      r.impressions || 0, r.clicks || 0, r.cost || 0,
      r.attributedSales14d || null, r.attributedConversions14d || null,
      r.attributedOrdersNewToBrand14d || null, r.attributedSalesNewToBrand14d || null
    ]);
    written++;
  }
  return written;
}

/**
 * Write rows to sb_placement_report using MERGE.
 */
async function writeSbPlacementReport(clientId, profileId, reportDate, rows) {
  if (!rows.length) return 0;
  const isoDate = toISODate(reportDate);
  let written = 0;
  for (const r of rows) {
    await query(`
      MERGE INTO sb_placement_report t
      USING (SELECT ? AS client_id, ? AS profile_id, ? AS campaign_id, ? AS placement, ?::DATE AS report_date) s
      ON t.client_id = s.client_id AND t.profile_id = s.profile_id
        AND t.campaign_id = s.campaign_id AND t.placement = s.placement AND t.report_date = s.report_date
      WHEN MATCHED THEN UPDATE SET
        impressions = ?, clicks = ?, cost = ?,
        attributed_sales_14_d = ?, attributed_conversions_14_d = ?,
        attributed_orders_new_to_brand_14_d = ?, attributed_sales_new_to_brand_14_d = ?,
        synced_at = CURRENT_TIMESTAMP
      WHEN NOT MATCHED THEN INSERT (
        client_id, profile_id, campaign_id, placement, report_date,
        impressions, clicks, cost,
        attributed_sales_14_d, attributed_conversions_14_d,
        attributed_orders_new_to_brand_14_d, attributed_sales_new_to_brand_14_d, synced_at
      ) VALUES (?, ?, ?, ?, ?::DATE, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `, [
      clientId, profileId, String(r.campaignId), r.placement || '', isoDate,
      r.impressions || 0, r.clicks || 0, r.cost || 0,
      r.attributedSales14d || null, r.attributedConversions14d || null,
      r.attributedOrdersNewToBrand14d || null, r.attributedSalesNewToBrand14d || null,
      clientId, profileId, String(r.campaignId), r.placement || '', isoDate,
      r.impressions || 0, r.clicks || 0, r.cost || 0,
      r.attributedSales14d || null, r.attributedConversions14d || null,
      r.attributedOrdersNewToBrand14d || null, r.attributedSalesNewToBrand14d || null
    ]);
    written++;
  }
  return written;
}

/**
 * Write rows to sd_campaign_report using MERGE.
 */
async function writeSdCampaignReport(clientId, profileId, reportDate, rows) {
  if (!rows.length) return 0;
  const isoDate = toISODate(reportDate);
  let written = 0;
  for (const r of rows) {
    await query(`
      MERGE INTO sd_campaign_report t
      USING (SELECT ? AS client_id, ? AS profile_id, ? AS campaign_id, ?::DATE AS date) s
      ON t.client_id = s.client_id AND t.profile_id = s.profile_id
        AND t.campaign_id = s.campaign_id AND t.date = s.date
      WHEN MATCHED THEN UPDATE SET
        campaign_name = ?,
        impressions = ?, clicks = ?, cost = ?,
        purchases = ?, purchases_clicks = ?, sales = ?, sales_clicks = ?,
        detail_page_views = ?, detail_page_views_clicks = ?,
        add_to_cart = ?, add_to_cart_clicks = ?,
        new_to_brand_purchases = ?, new_to_brand_sales = ?, new_to_brand_units_sold = ?,
        branded_searches = ?, viewability_rate = ?,
        synced_at = CURRENT_TIMESTAMP
      WHEN NOT MATCHED THEN INSERT (
        client_id, profile_id, campaign_id, date, campaign_name,
        impressions, clicks, cost,
        purchases, purchases_clicks, sales, sales_clicks,
        detail_page_views, detail_page_views_clicks,
        add_to_cart, add_to_cart_clicks,
        new_to_brand_purchases, new_to_brand_sales, new_to_brand_units_sold,
        branded_searches, viewability_rate, synced_at
      ) VALUES (?, ?, ?, ?::DATE, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `, [
      clientId, profileId, String(r.campaignId), isoDate,
      r.campaignName || null,
      r.impressions || 0, r.clicks || 0, r.cost || 0,
      r.purchases || null, r.purchasesClicks || null, r.sales || null, r.salesClicks || null,
      r.detailPageViews || null, r.detailPageViewsClicks || null,
      r.addToCart || null, r.addToCartClicks || null,
      r.newToBrandPurchases || null, r.newToBrandSales || null, r.newToBrandUnitsSold || null,
      r.brandedSearches || null, r.viewabilityRate || null,
      clientId, profileId, String(r.campaignId), isoDate,
      r.campaignName || null,
      r.impressions || 0, r.clicks || 0, r.cost || 0,
      r.purchases || null, r.purchasesClicks || null, r.sales || null, r.salesClicks || null,
      r.detailPageViews || null, r.detailPageViewsClicks || null,
      r.addToCart || null, r.addToCartClicks || null,
      r.newToBrandPurchases || null, r.newToBrandSales || null, r.newToBrandUnitsSold || null,
      r.brandedSearches || null, r.viewabilityRate || null
    ]);
    written++;
  }
  return written;
}

/**
 * Write rows to sd_ad_group_report using MERGE.
 */
async function writeSdAdGroupReport(clientId, profileId, reportDate, rows) {
  if (!rows.length) return 0;
  const isoDate = toISODate(reportDate);
  let written = 0;
  for (const r of rows) {
    await query(`
      MERGE INTO sd_ad_group_report t
      USING (SELECT ? AS client_id, ? AS profile_id, ? AS ad_group_id, ?::DATE AS date) s
      ON t.client_id = s.client_id AND t.profile_id = s.profile_id
        AND t.ad_group_id = s.ad_group_id AND t.date = s.date
      WHEN MATCHED THEN UPDATE SET
        campaign_id = ?,
        impressions = ?, clicks = ?, cost = ?,
        purchases = ?, purchases_clicks = ?, sales = ?, sales_clicks = ?,
        detail_page_views = ?, add_to_cart = ?,
        new_to_brand_purchases = ?, new_to_brand_sales = ?, new_to_brand_units_sold = ?,
        synced_at = CURRENT_TIMESTAMP
      WHEN NOT MATCHED THEN INSERT (
        client_id, profile_id, ad_group_id, date, campaign_id,
        impressions, clicks, cost,
        purchases, purchases_clicks, sales, sales_clicks,
        detail_page_views, add_to_cart,
        new_to_brand_purchases, new_to_brand_sales, new_to_brand_units_sold, synced_at
      ) VALUES (?, ?, ?, ?::DATE, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `, [
      clientId, profileId, String(r.adGroupId), isoDate,
      String(r.campaignId || ''),
      r.impressions || 0, r.clicks || 0, r.cost || 0,
      r.purchases || null, r.purchasesClicks || null, r.sales || null, r.salesClicks || null,
      r.detailPageViews || null, r.addToCart || null,
      r.newToBrandPurchases || null, r.newToBrandSales || null, r.newToBrandUnitsSold || null,
      clientId, profileId, String(r.adGroupId), isoDate,
      String(r.campaignId || ''),
      r.impressions || 0, r.clicks || 0, r.cost || 0,
      r.purchases || null, r.purchasesClicks || null, r.sales || null, r.salesClicks || null,
      r.detailPageViews || null, r.addToCart || null,
      r.newToBrandPurchases || null, r.newToBrandSales || null, r.newToBrandUnitsSold || null
    ]);
    written++;
  }
  return written;
}

/**
 * Write rows to sd_target_report using MERGE.
 */
async function writeSdTargetReport(clientId, profileId, reportDate, rows) {
  if (!rows.length) return 0;
  const isoDate = toISODate(reportDate);
  let written = 0;
  for (const r of rows) {
    await query(`
      MERGE INTO sd_target_report t
      USING (SELECT ? AS client_id, ? AS profile_id, ? AS ad_group_id, ? AS campaign_id, ? AS targeting_id, ?::DATE AS date) s
      ON t.client_id = s.client_id AND t.profile_id = s.profile_id
        AND t.ad_group_id = s.ad_group_id AND t.campaign_id = s.campaign_id
        AND t.targeting_id = s.targeting_id AND t.date = s.date
      WHEN MATCHED THEN UPDATE SET
        impressions = ?, clicks = ?, cost = ?,
        purchases = ?, purchases_clicks = ?, sales = ?, sales_clicks = ?,
        detail_page_views = ?, add_to_cart = ?,
        new_to_brand_purchases = ?, new_to_brand_sales = ?, new_to_brand_units_sold = ?,
        synced_at = CURRENT_TIMESTAMP
      WHEN NOT MATCHED THEN INSERT (
        client_id, profile_id, ad_group_id, campaign_id, targeting_id, date,
        impressions, clicks, cost,
        purchases, purchases_clicks, sales, sales_clicks,
        detail_page_views, add_to_cart,
        new_to_brand_purchases, new_to_brand_sales, new_to_brand_units_sold, synced_at
      ) VALUES (?, ?, ?, ?, ?, ?::DATE, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `, [
      clientId, profileId, String(r.adGroupId), String(r.campaignId), String(r.targetingId), isoDate,
      r.impressions || 0, r.clicks || 0, r.cost || 0,
      r.purchases || null, r.purchasesClicks || null, r.sales || null, r.salesClicks || null,
      r.detailPageViews || null, r.addToCart || null,
      r.newToBrandPurchases || null, r.newToBrandSales || null, r.newToBrandUnitsSold || null,
      clientId, profileId, String(r.adGroupId), String(r.campaignId), String(r.targetingId), isoDate,
      r.impressions || 0, r.clicks || 0, r.cost || 0,
      r.purchases || null, r.purchasesClicks || null, r.sales || null, r.salesClicks || null,
      r.detailPageViews || null, r.addToCart || null,
      r.newToBrandPurchases || null, r.newToBrandSales || null, r.newToBrandUnitsSold || null
    ]);
    written++;
  }
  return written;
}

/**
 * Write rows to sd_product_ad_report using MERGE.
 */
async function writeSdProductAdReport(clientId, profileId, reportDate, rows) {
  if (!rows.length) return 0;
  const isoDate = toISODate(reportDate);
  let written = 0;
  for (const r of rows) {
    await query(`
      MERGE INTO sd_product_ad_report t
      USING (SELECT ? AS client_id, ? AS profile_id, ? AS ad_id, ?::DATE AS date) s
      ON t.client_id = s.client_id AND t.profile_id = s.profile_id
        AND t.ad_id = s.ad_id AND t.date = s.date
      WHEN MATCHED THEN UPDATE SET
        ad_group_id = ?, campaign_id = ?,
        impressions = ?, clicks = ?, cost = ?,
        purchases = ?, purchases_clicks = ?, sales = ?, sales_clicks = ?,
        detail_page_views = ?, add_to_cart = ?,
        new_to_brand_purchases = ?, new_to_brand_sales = ?, new_to_brand_units_sold = ?,
        synced_at = CURRENT_TIMESTAMP
      WHEN NOT MATCHED THEN INSERT (
        client_id, profile_id, ad_id, date, ad_group_id, campaign_id,
        impressions, clicks, cost,
        purchases, purchases_clicks, sales, sales_clicks,
        detail_page_views, add_to_cart,
        new_to_brand_purchases, new_to_brand_sales, new_to_brand_units_sold, synced_at
      ) VALUES (?, ?, ?, ?::DATE, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `, [
      clientId, profileId, String(r.adId), isoDate,
      String(r.adGroupId || ''), String(r.campaignId || ''),
      r.impressions || 0, r.clicks || 0, r.cost || 0,
      r.purchases || null, r.purchasesClicks || null, r.sales || null, r.salesClicks || null,
      r.detailPageViews || null, r.addToCart || null,
      r.newToBrandPurchases || null, r.newToBrandSales || null, r.newToBrandUnitsSold || null,
      clientId, profileId, String(r.adId), isoDate,
      String(r.adGroupId || ''), String(r.campaignId || ''),
      r.impressions || 0, r.clicks || 0, r.cost || 0,
      r.purchases || null, r.purchasesClicks || null, r.sales || null, r.salesClicks || null,
      r.detailPageViews || null, r.addToCart || null,
      r.newToBrandPurchases || null, r.newToBrandSales || null, r.newToBrandUnitsSold || null
    ]);
    written++;
  }
  return written;
}

/**
 * Write spPurchasedProduct rows (products purchased via SP ads, not necessarily advertised)
 */
async function writeSpPurchasedProductReport(clientId, profileId, reportDate, rows) {
  if (!rows.length) return 0;
  let written = 0;
  for (const r of rows) {
    const cols = Object.keys(r).map(k => toSnake(k));
    const vals = Object.values(r).map(v => (v === null || v === undefined) ? null : v);
    // Use generic upsert based on primary key
    const pkCols = ['client_id','profile_id','campaign_id','ad_group_id','keyword_id','advertised_asin','purchased_asin','date'];
    const allCols = ['client_id','profile_id','report_date',...cols];
    try {
      await query(`
        MERGE INTO sp_purchased_product_report t
        USING (SELECT ? AS client_id, ? AS profile_id, ? AS campaign_id, ? AS ad_group_id, ? AS keyword_id, ? AS advertised_asin, ? AS purchased_asin, ? AS report_date) s
        ON t.client_id=s.client_id AND t.profile_id=s.profile_id AND t.campaign_id=s.campaign_id
          AND t.ad_group_id=s.ad_group_id AND t.keyword_id=s.keyword_id
          AND t.advertised_asin=s.advertised_asin AND t.purchased_asin=s.purchased_asin AND t.report_date=s.report_date
        WHEN MATCHED THEN UPDATE SET
          purchases_1_d=?, purchases_7_d=?, purchases_14_d=?, purchases_30_d=?,
          sales_1_d=?, sales_7_d=?, sales_14_d=?, sales_30_d=?,
          units_sold_clicks_1_d=?, units_sold_clicks_7_d=?, units_sold_clicks_14_d=?, units_sold_clicks_30_d=?,
          synced_at=CURRENT_TIMESTAMP
        WHEN NOT MATCHED THEN INSERT
          (client_id,profile_id,campaign_id,ad_group_id,keyword_id,advertised_asin,purchased_asin,report_date,
           purchases_1_d,purchases_7_d,purchases_14_d,purchases_30_d,
           sales_1_d,sales_7_d,sales_14_d,sales_30_d,
           units_sold_clicks_1_d,units_sold_clicks_7_d,units_sold_clicks_14_d,units_sold_clicks_30_d,
           synced_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
      `, [
        clientId, profileId, String(r.campaignId||''), String(r.adGroupId||''),
        String(r.keywordId||''), String(r.advertisedAsin||''), String(r.purchasedAsin||''),
        reportDate,
        r.purchases1d||0, r.purchases7d||0, r.purchases14d||0, r.purchases30d||0,
        r.sales1d||0, r.sales7d||0, r.sales14d||0, r.sales30d||0,
        r.unitsSoldClicks1d||0, r.unitsSoldClicks7d||0, r.unitsSoldClicks14d||0, r.unitsSoldClicks30d||0,
        clientId, profileId, String(r.campaignId||''), String(r.adGroupId||''),
        String(r.keywordId||''), String(r.advertisedAsin||''), String(r.purchasedAsin||''),
        reportDate,
        r.purchases1d||0, r.purchases7d||0, r.purchases14d||0, r.purchases30d||0,
        r.sales1d||0, r.sales7d||0, r.sales14d||0, r.sales30d||0,
        r.unitsSoldClicks1d||0, r.unitsSoldClicks7d||0, r.unitsSoldClicks14d||0, r.unitsSoldClicks30d||0
      ]);
      written++;
    } catch (err) {
      console.warn(`[spPurchasedProduct] Row error: ${err.message}`);
    }
  }
  return written;
}

// ============================================================
// WRITE FUNCTION DISPATCH TABLE
// ============================================================

const WRITE_FNS = {
  spCampaigns:        writeSpCampaignReport,
  spAdGroups:         writeSpAdGroupReport,
  spTargeting:        writeSpTargetingReport,
  spSearchTerm:       writeSpSearchTermReport,
  spAdvertisedProduct: writeSpAdvertisedProductReport,
  spCampaignPlacement: writeSpCampaignPlacementReport,
  sbCampaigns:        writeSbCampaignReport,
  sbTargeting:        writeSbKeywordReport,    // key renamed from sbKeywords
  sbSearchTerms:      writeSbSearchTermReport,
  sbTargets:          writeSbTargetReport,
  sbPlacements:       writeSbPlacementReport,
  spPurchasedProduct: writeSpPurchasedProductReport,
  sdCampaigns:        writeSdCampaignReport,
  sdAdGroups:         writeSdAdGroupReport,
  sdTargeting:        writeSdTargetReport,
  sdAdvertisedProduct: writeSdProductAdReport  // key renamed from sdProductAds
};

// ============================================================
// SCHEMA MIGRATION
// ============================================================

/**
 * Read and execute the SQL migration file to create all ads tables.
 * Each CREATE TABLE IF NOT EXISTS statement is idempotent.
 */
async function ensureAdsSchema() {
  const sqlPath = path.join(__dirname, '../models/migrate-ads-schema.sql');
  const sql     = fs.readFileSync(sqlPath, 'utf8');

  // Split into individual statements — Snowflake doesn't support multi-statement
  // Execute all CREATE TABLE statements
  const statements = sql
    .split(/;\s*\n/)
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));

  let executed = 0;
  for (const stmt of statements) {
    if (!stmt.trim()) continue;
    try {
      await query(stmt);
      executed++;
    } catch (err) {
      // Ignore "already exists" — CREATE TABLE IF NOT EXISTS should prevent this,
      // but some Snowflake versions return errors for things like duplicate PKs
      if (err.message?.includes('already exists') || err.message?.includes('duplicate')) {
        continue;
      }
      throw err;
    }
  }

  console.log(`[ensureAdsSchema] Executed ${executed} SQL statements — schema ready`);
  return executed;
}

// ============================================================
// PERFORMANCE INGESTION (Phase 1: Queue Reports)
// ============================================================

/**
 * Request all report types for all authorized profiles for daysBack days.
 * Stores report IDs in ads_report_queue. Returns immediately.
 * Call processReportQueue() to download completed reports.
 */
async function ingestPerformance(clientId, connectionType, daysBack = 2) {
  return runJob(clientId, connectionType, 'performance', async () => {
    const allProfiles = await fetchProfiles(clientId, connectionType);
    const profiles    = await getAuthorizedProfiles(clientId, allProfiles);
    let   queued      = 0;

    for (const profile of profiles) {
      const profileId = String(profile.profileId);

      for (let d = daysBack; d >= 1; d--) {
        const dateObj    = new Date();
        dateObj.setDate(dateObj.getDate() - d);
        const reportDate = toDateKey(dateObj);
        const isoDate    = toISODate(reportDate);

        for (const rt of REPORT_TYPES) {
          try {
            const freshClient = await adsClient(clientId, connectionType);
            const reportId    = await requestV3Report(
              freshClient, profileId, isoDate,
              rt.reportTypeId, rt.adProduct, rt.groupBy, rt.columns, rt.filters
            );
            if (!reportId) continue;

            // Upsert into queue
            await query(`
              MERGE INTO ads_report_queue t
              USING (SELECT ? AS report_id) s ON t.report_id = s.report_id
              WHEN NOT MATCHED THEN INSERT
                (report_id, client_id, connection_type, profile_id, report_type, report_date, status, requested_at)
                VALUES (?, ?, ?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP)
            `, [reportId, reportId, clientId, connectionType, profileId, rt.key, reportDate]);

            console.log(`[performance] Queued ${rt.key} report ${reportId} for profile ${profileId} date ${reportDate}`);
            queued++;
          } catch (err) {
            const body = err.response?.data
              ? JSON.stringify(err.response.data).substring(0, 300)
              : '';
            console.warn(`[performance] Failed to queue ${rt.key} for ${profileId} ${reportDate}: ${err.message} ${body}`);
          }
        }
      }
    }

    console.log(`[performance] Queued ${queued} reports — run processReportQueue() to download`);

    // Kick off queue processing in background (non-blocking)
    processReportQueue(clientId, connectionType).catch(err =>
      console.error('[performance] Background queue processing error:', err.message)
    );

    return { recordsWritten: 0, queued };
  });
}

// ============================================================
// REPORT QUEUE PROCESSING (Phase 2: Download + Write)
// ============================================================

/**
 * Process pending reports in ads_report_queue.
 * For each pending report:
 *   - Poll GET /reporting/reports/:reportId
 *   - If COMPLETED: download, gunzip, dispatch to correct write function
 *   - If PENDING/PROCESSING: skip (will be picked up next run)
 *   - If FAILURE: mark failed in queue
 */
async function processReportQueue(clientId, connectionType) {
  const pending = await query(`
    SELECT report_id, profile_id, report_type, report_date
    FROM ads_report_queue
    WHERE client_id = ? AND connection_type = ? AND status = 'pending'
    ORDER BY requested_at ASC
    LIMIT 50
  `, [clientId, connectionType]);

  if (!pending.length) {
    console.log(`[ReportQueue] No pending reports for ${clientId}`);
    return { processed: 0 };
  }

  console.log(`[ReportQueue] Processing ${pending.length} pending reports for ${clientId}`);
  let processed = 0;

  for (const row of pending) {
    // Snowflake returns uppercase column names by default
    const reportId   = row.REPORT_ID   || row.report_id;
    const profileId  = row.PROFILE_ID  || row.profile_id;
    const reportType = row.REPORT_TYPE || row.report_type;
    const reportDate = String(row.REPORT_DATE || row.report_date);

    try {
      const pollClient = await adsClient(clientId, connectionType);

      const statusRes = await pollClient.get(`/reporting/reports/${reportId}`, {
        headers: { 'Amazon-Advertising-API-Scope': profileId }
      });
      const { status, url, failureReason } = statusRes.data;

      if (status === 'PENDING' || status === 'PROCESSING') {
        console.log(`[ReportQueue] ${reportId} (${reportType}) still ${status} — skipping`);
        continue;
      }

      if (status === 'FAILURE') {
        await query(`
          UPDATE ads_report_queue
          SET status = 'failed', error_message = ?, completed_at = CURRENT_TIMESTAMP
          WHERE report_id = ?
        `, [failureReason || 'FAILURE', reportId]);
        console.warn(`[ReportQueue] ${reportId} (${reportType}) FAILED: ${failureReason}`);
        continue;
      }

      if (status === 'COMPLETED' && url) {
        // Download and decompress
        const dl   = await axios.get(url, { responseType: 'arraybuffer', timeout: 120000 });
        const rows = JSON.parse(zlib.gunzipSync(Buffer.from(dl.data)).toString('utf8'));
        const data = Array.isArray(rows) ? rows : [];

        // Dispatch to the correct write function
        const writeFn = WRITE_FNS[reportType];
        if (!writeFn) {
          console.warn(`[ReportQueue] No write function for report type: ${reportType}`);
          await query(`
            UPDATE ads_report_queue
            SET status = 'failed', error_message = ?, completed_at = CURRENT_TIMESTAMP
            WHERE report_id = ?
          `, [`No write function for type: ${reportType}`, reportId]);
          continue;
        }

        const written = await writeFn(clientId, profileId, reportDate, data);

        await query(`
          UPDATE ads_report_queue
          SET status = 'completed', records_written = ?, completed_at = CURRENT_TIMESTAMP
          WHERE report_id = ?
        `, [written, reportId]);

        console.log(`[ReportQueue] ✅ ${reportId} (${reportType} ${reportDate}) — ${written} records written`);
        processed++;
      }
    } catch (err) {
      const msg = err.message?.substring(0, 500) || 'unknown error';
      console.warn(`[ReportQueue] Error processing ${reportId} (${reportType}): ${msg}`);

      try {
        await query(`
          UPDATE ads_report_queue
          SET error_message = ?
          WHERE report_id = ?
        `, [msg, reportId]);
      } catch (updateErr) {
        console.warn(`[ReportQueue] Could not update error_message: ${updateErr.message}`);
      }
    }
  }

  return { processed };
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  // Core ingestion
  ingestCampaigns,
  ingestPerformance,
  processReportQueue,
  ensureAdsSchema,

  // Utilities (exported for testing)
  adsClient,
  fetchProfiles,
  getAuthorizedProfiles,
  requestV3Report,
  downloadReport,
  REPORT_TYPES,
  WRITE_FNS
};
