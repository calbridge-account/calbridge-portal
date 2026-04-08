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

// Safe JSON parser that preserves large integers as strings.
// Standard JSON.parse() silently truncates integers > Number.MAX_SAFE_INTEGER (2^53-1),
// which corrupts Amazon DSP advertiser IDs (e.g. 577089618135015252 → 577089618135015300).
// json-bigint with storeAsString:true returns big ints as strings, safe for VARCHAR storage.
const JSONbig = require('json-bigint')({ storeAsString: true });
function safeParse(str) {
  try { return JSONbig.parse(str); }
  catch { return JSON.parse(str); } // fallback to native if json-bigint fails
}
const { query, batchMerge } = require('../services/snowflakeService');
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
      'addToList',
      'purchases30d', 'sales30d', 'unitsSoldClicks30d',
      'purchases1d', 'purchases7d', 'purchases14d',
      'sales1d', 'sales7d', 'sales14d',
      'unitsSoldClicks1d', 'unitsSoldClicks7d', 'unitsSoldClicks14d',
      'campaignBudgetAmount', 'campaignBudgetType', 'campaignBudgetCurrencyCode',
      'topOfSearchImpressionShare', 'campaignBiddingStrategy',
      'campaignRuleBasedBudgetAmount', 'campaignApplicableBudgetRuleId', 'campaignApplicableBudgetRuleName',
      'campaignStatus', 'date', 'spend'
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
      // Ad group only — campaign context not available for adGroup groupBy
      'adGroupId', 'adGroupName', 'adStatus',
      // Performance
      'date', 'impressions', 'clicks', 'cost',
      'addToList',
      // All purchase/sales/units windows
      'purchases1d', 'purchases7d', 'purchases14d', 'purchases30d',
      'purchasesSameSku1d', 'purchasesSameSku7d', 'purchasesSameSku14d', 'purchasesSameSku30d',
      'sales1d', 'sales7d', 'sales14d', 'sales30d',
      'attributedSalesSameSku1d', 'attributedSalesSameSku7d', 'attributedSalesSameSku14d', 'attributedSalesSameSku30d',
      'unitsSoldClicks1d', 'unitsSoldClicks7d', 'unitsSoldClicks14d', 'unitsSoldClicks30d',
      'unitsSoldSameSku1d', 'unitsSoldSameSku7d', 'unitsSoldSameSku14d', 'unitsSoldSameSku30d'
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
      'portfolioId', 'impressions', 'clicks', 'cost', 'addToList', 'purchases30d', 'sales30d', 'unitsSoldClicks30d',
      'purchases1d', 'purchases7d', 'purchases14d',
      'sales1d', 'sales7d', 'sales14d',
      'unitsSoldClicks1d', 'unitsSoldClicks7d', 'unitsSoldClicks14d',
      'purchasesSameSku30d', 'unitsSoldSameSku30d',
      'attributedSalesSameSku30d', 'salesOtherSku7d', 'unitsSoldOtherSku7d',
      'topOfSearchImpressionShare', 'date'
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
      'portfolioId', 'impressions', 'clicks', 'cost', 'addToList', 'purchases30d', 'sales30d', 'unitsSoldClicks30d',
      'purchases1d', 'purchases7d', 'purchases14d',
      'sales1d', 'sales7d', 'sales14d',
      'unitsSoldClicks1d', 'unitsSoldClicks7d', 'unitsSoldClicks14d',
      'purchasesSameSku30d', 'attributedSalesSameSku30d', 'salesOtherSku7d',
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
      'portfolioId', 'impressions', 'clicks', 'cost', 'purchases30d', 'sales30d', 'unitsSoldClicks30d',
      'purchases1d', 'purchases7d', 'purchases14d',
      'sales1d', 'sales7d', 'sales14d',
      'unitsSoldClicks1d', 'unitsSoldClicks7d', 'unitsSoldClicks14d',
      'purchasesSameSku30d', 'purchasesSameSku1d', 'purchasesSameSku7d', 'purchasesSameSku14d',
      'unitsSoldSameSku30d', 'unitsSoldSameSku1d', 'unitsSoldSameSku7d', 'unitsSoldSameSku14d',
      'attributedSalesSameSku30d', 'attributedSalesSameSku1d', 'attributedSalesSameSku7d', 'attributedSalesSameSku14d',
      'salesOtherSku7d', 'unitsSoldOtherSku7d',
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
      'newToBrandPurchases', 'newToBrandPurchasesClicks', 'newToBrandSales', 'newToBrandSalesClicks', 'newToBrandUnitsSold', 'newToBrandUnitsSoldClicks', 'newToBrandDetailPageViews', 'newToBrandDetailPageViewsClicks', 'detailPageViews', 'detailPageViewsClicks',
      'addToCart', 'addToCartClicks',
      'brandedSearches', 'brandedSearchesClicks',
      'addToList', 'addToListFromClicks',
      'brandStorePageView', 'topOfSearchImpressionShare',
      'video5SecondViews',
      'videoCompleteViews', 'videoFirstQuartileViews', 'videoMidpointViews', 'videoThirdQuartileViews', 'videoUnmutes',
      'viewabilityRate', 'viewableImpressions',
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
      'newToBrandPurchases', 'newToBrandPurchasesClicks', 'newToBrandSales', 'newToBrandSalesClicks', 'newToBrandUnitsSold', 'newToBrandUnitsSoldClicks', 'newToBrandDetailPageViews', 'newToBrandDetailPageViewsClicks', 'detailPageViews', 'detailPageViewsClicks',
      'addToCart', 'addToCartClicks',
      'brandedSearches', 'brandedSearchesClicks',
      'addToList', 'addToListFromClicks',
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
      'video5SecondViews',
      'videoCompleteViews', 'videoFirstQuartileViews', 'videoMidpointViews', 'videoThirdQuartileViews', 'videoUnmutes',
      'viewabilityRate', 'viewableImpressions',
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
      'newToBrandPurchases', 'newToBrandPurchasesClicks', 'newToBrandSales', 'newToBrandSalesClicks', 'newToBrandUnitsSold', 'newToBrandUnitsSoldClicks', 'newToBrandDetailPageViews', 'newToBrandDetailPageViewsClicks', 'detailPageViews', 'detailPageViewsClicks',
      'addToCart', 'addToCartClicks', 'video5SecondViews',
      'videoCompleteViews', 'videoFirstQuartileViews', 'videoMidpointViews', 'videoThirdQuartileViews', 'videoUnmutes',
      'viewabilityRate', 'viewableImpressions', 'date'
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
      'addToCart', 'addToCartClicks', 'addToCartViews',
      'addToList', 'addToListFromClicks', 'addToListFromViews',
      'brandedSearches', 'brandedSearchesClicks', 'brandedSearchesViews', 'newToBrandPurchases', 'newToBrandPurchasesClicks',
      'newToBrandSales', 'newToBrandSalesClicks',
      'newToBrandUnitsSold', 'newToBrandUnitsSoldClicks',
      'newToBrandDetailPageViews', 'newToBrandDetailPageViewClicks',
      'newToBrandDetailPageViewViews', 'cumulativeReach', 'impressionsFrequencyAverage',
      'videoCompleteViews', 'videoFirstQuartileViews', 'videoMidpointViews', 'videoThirdQuartileViews', 'videoUnmutes',
      'viewabilityRate', 'longTermSales', 'date'
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
      'addToCart', 'addToCartClicks', 'addToCartViews',
      'addToList', 'addToListFromClicks', 'addToListFromViews',
      'brandedSearches', 'brandedSearchesClicks', 'brandedSearchesViews', 'newToBrandPurchases', 'newToBrandPurchasesClicks',
      'newToBrandSales', 'newToBrandSalesClicks',
      'newToBrandUnitsSold', 'newToBrandUnitsSoldClicks',
      'newToBrandDetailPageViews', 'newToBrandDetailPageViewClicks',
      'newToBrandDetailPageViewViews', 'cumulativeReach', 'impressionsFrequencyAverage',
      'videoCompleteViews', 'videoFirstQuartileViews', 'videoMidpointViews', 'videoThirdQuartileViews', 'videoUnmutes',
      'viewabilityRate', 'date'
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
      'addToCart', 'addToCartClicks', 'addToCartViews',
      'addToList', 'addToListFromClicks', 'addToListFromViews',
      'brandedSearches', 'brandedSearchesClicks', 'brandedSearchesViews', 'newToBrandPurchases', 'newToBrandPurchasesClicks',
      'newToBrandSales', 'newToBrandSalesClicks',
      'newToBrandUnitsSold', 'newToBrandUnitsSoldClicks',
      'newToBrandDetailPageViews', 'newToBrandDetailPageViewClicks',
      'newToBrandDetailPageViewViews', 'videoCompleteViews', 'videoFirstQuartileViews', 'videoMidpointViews', 'videoThirdQuartileViews', 'videoUnmutes',
      'viewabilityRate', 'date'
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
      'addToCart', 'addToCartClicks', 'addToCartViews',
      'addToList', 'addToListFromClicks', 'addToListFromViews',
      'brandedSearches', 'brandedSearchesClicks', 'brandedSearchesViews', 'newToBrandPurchases', 'newToBrandPurchasesClicks',
      'newToBrandSales', 'newToBrandSalesClicks',
      'newToBrandUnitsSold', 'newToBrandUnitsSoldClicks',
      'newToBrandDetailPageViews', 'newToBrandDetailPageViewClicks',
      'newToBrandDetailPageViewViews', 'cumulativeReach',
      'videoCompleteViews', 'videoFirstQuartileViews', 'videoMidpointViews', 'videoThirdQuartileViews', 'videoUnmutes',
      'viewabilityRate', 'date'
    ],
    table:      'sd_product_ad_report',
    primaryKey: ['client_id', 'profile_id', 'ad_id', 'date']
  }
];

// ── Gross & Invalid Traffic ──────────────────────────────────────────────────
// One report type per ad product — same columns for SP, SB, SD
const GROSS_INVALID_COLS = [
  'campaignName', 'campaignStatus', 'date',
  'impressions', 'grossImpressions', 'invalidImpressions', 'invalidImpressionRate',
  'clicks',       'grossClickThroughs', 'invalidClickThroughs', 'invalidClickThroughRate'
];

REPORT_TYPES.push(
  {
    key: 'spGrossAndInvalids', adProduct: 'SPONSORED_PRODUCTS',
    reportTypeId: 'spGrossAndInvalids', groupBy: ['campaign'],
    columns: GROSS_INVALID_COLS,
    table: 'sp_gross_and_invalid_report',
    primaryKey: ['client_id', 'profile_id', 'campaign_id', 'date']
  },
  {
    key: 'sbGrossAndInvalids', adProduct: 'SPONSORED_BRANDS',
    reportTypeId: 'sbGrossAndInvalids', groupBy: ['campaign'],
    columns: GROSS_INVALID_COLS,
    table: 'sb_gross_and_invalid_report',
    primaryKey: ['client_id', 'profile_id', 'campaign_id', 'date']
  },
  {
    key: 'sdGrossAndInvalids', adProduct: 'SPONSORED_DISPLAY',
    reportTypeId: 'sdGrossAndInvalids', groupBy: ['campaign'],
    columns: GROSS_INVALID_COLS,
    table: 'sd_gross_and_invalid_report',
    primaryKey: ['client_id', 'profile_id', 'campaign_id', 'date']
  }
);

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
async function requestV3Report(client, profileId, startDate, reportTypeId, adProduct, groupBy, columns, filters, endDate) {
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

    const reportEndDate = endDate || startDate; // single day if no endDate
    const res = await client.post('/reporting/reports', {
      name:      `${adProduct}_${reportTypeId}_${startDate}_${reportEndDate}`,
      startDate,
      endDate:   reportEndDate,
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

    // Throttle: 100ms between requests — fast enough to not block event loop
    await sleep(100);

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
      return safeParse(buf.toString('utf8'));
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
  const getIsoDate = (r) => (r && (r.date || r.DATE)) ? String(r.date || r.DATE).substring(0,10) : (String(reportDate).includes('_') ? toISODate(String(reportDate).substring(0,8)) : toISODate(String(reportDate)));
  // Dual-write to unified RAW.AD_CAMPAIGN
  const rawRows = rows.map(r => ({
    client_id:      clientId,
    campaign_id:    String(r.campaignId),
    date:           getIsoDate(r),
    ad_product:     'SPONSORED_PRODUCTS',
    platform:       'amazon',
    campaign_name:  r.campaignName || null,
    status:         r.campaignStatus || null,
    daily_budget:   r.campaignBudgetAmount || null,
    impressions:    r.impressions || 0,
    clicks:         r.clicks || 0,
    cost:           r.cost || 0,
    purchases_1d:   r.purchases1d || null,
    purchases_7d:   r.purchases7d || null,
    purchases_14d:  r.purchases14d || null,
    purchases_30d:  r.purchases30d || null,
    sales_1d:       r.sales1d || null,
    sales_7d:       r.sales7d || null,
    sales_14d:      r.sales14d || null,
    sales_30d:      r.sales30d || null,
    ntb_orders_14d: null,
    ntb_sales_14d:  null,
    viewable_impressions: null,
    ingested_at:    new Date().toISOString(),
    data_maturity:  'preliminary',
  }));
  await writeRawAdCampaign(rawRows).catch(e => console.warn('[adsIngestion] RAW.AD_CAMPAIGN SP write failed (non-fatal):', e.message));
  const mapped = rows.map(r => ({
    client_id: clientId,
    profile_id: profileId,
    campaign_id: String(r.campaignId),
    date: getIsoDate(r),
    campaign_name: r.campaignName || null,
    campaign_budget_amount: r.campaignBudgetAmount || null,
    campaign_budget_type: r.campaignBudgetType || null,
    campaign_budget_currency_code: r.campaignBudgetCurrencyCode || null,
    campaign_bidding_strategy: r.campaignBiddingStrategy || null,
    top_of_search_impression_share: r.topOfSearchImpressionShare || null,
    impressions: r.impressions || 0,
    clicks: r.clicks || 0,
    cost: r.cost || 0,
    purchases_1_d: r.purchases1d || null,
    purchases_7_d: r.purchases7d || null,
    purchases_14_d: r.purchases14d || null,
    purchases_30_d: r.purchases30d || null,
    sales_1_d: r.sales1d || null,
    sales_7_d: r.sales7d || null,
    sales_14_d: r.sales14d || null,
    sales_30_d: r.sales30d || null,
    units_sold_clicks_1_d: r.unitsSoldClicks1d || null,
    units_sold_clicks_7_d: r.unitsSoldClicks7d || null,
    units_sold_clicks_14_d: r.unitsSoldClicks14d || null,
    units_sold_clicks_30_d: r.unitsSoldClicks30d || null,
  }));
  return batchMerge({
    table: 'sp_campaign_report',
    keyColumns: ['client_id', 'profile_id', 'campaign_id', 'date'],
    dataColumns: [
      'campaign_name', 'campaign_budget_amount', 'campaign_budget_type',
      'campaign_budget_currency_code', 'campaign_bidding_strategy',
      'top_of_search_impression_share',
      'impressions', 'clicks', 'cost',
      'purchases_1_d', 'purchases_7_d', 'purchases_14_d', 'purchases_30_d',
      'sales_1_d', 'sales_7_d', 'sales_14_d', 'sales_30_d',
      'units_sold_clicks_1_d', 'units_sold_clicks_7_d', 'units_sold_clicks_14_d', 'units_sold_clicks_30_d',
    ],
    dateColumns: ['date'],
    rows: mapped,
  });
}

/**
 * Write rows to sp_ad_group_report using MERGE.
 */
async function writeSpAdGroupReport(clientId, profileId, reportDate, rows) {
  if (!rows.length) return 0;
  const mapped = rows.map(r => ({
    client_id: clientId,
    profile_id: profileId,
    ad_group_id: String(r.adGroupId || ''),
    date: r.date || r.DATE || toISODate(reportDate),
    ad_group_name: r.adGroupName || null,
    ad_status: r.adStatus || null,
    campaign_id: String(r.campaignId || ''),
    campaign_name: r.campaignName || null,
    campaign_status: r.campaignStatus || null,
    campaign_budget_amount: r.campaignBudgetAmount || null,
    campaign_budget_type: r.campaignBudgetType || null,
    campaign_budget_currency_code: r.campaignBudgetCurrencyCode || null,
    campaign_bidding_strategy: r.campaignBiddingStrategy || null,
    portfolio_id: r.portfolioId || null,
    impressions: r.impressions || 0,
    clicks: r.clicks || 0,
    cost: r.cost || 0,
    purchases_1_d: r.purchases1d || null,
    purchases_7_d: r.purchases7d || null,
    purchases_14_d: r.purchases14d || null,
    purchases_30_d: r.purchases30d || null,
    purchases_same_sku_1_d: r.purchasesSameSku1d || null,
    purchases_same_sku_7_d: r.purchasesSameSku7d || null,
    purchases_same_sku_14_d: r.purchasesSameSku14d || null,
    purchases_same_sku_30_d: r.purchasesSameSku30d || null,
    sales_1_d: r.sales1d || null,
    sales_7_d: r.sales7d || null,
    sales_14_d: r.sales14d || null,
    sales_30_d: r.sales30d || null,
    attributed_sales_same_sku_1_d: r.attributedSalesSameSku1d || null,
    attributed_sales_same_sku_7_d: r.attributedSalesSameSku7d || null,
    attributed_sales_same_sku_14_d: r.attributedSalesSameSku14d || null,
    attributed_sales_same_sku_30_d: r.attributedSalesSameSku30d || null,
    units_sold_clicks_1_d: r.unitsSoldClicks1d || null,
    units_sold_clicks_7_d: r.unitsSoldClicks7d || null,
    units_sold_clicks_14_d: r.unitsSoldClicks14d || null,
    units_sold_clicks_30_d: r.unitsSoldClicks30d || null,
    units_sold_same_sku_1_d: r.unitsSoldSameSku1d || null,
    units_sold_same_sku_7_d: r.unitsSoldSameSku7d || null,
    units_sold_same_sku_14_d: r.unitsSoldSameSku14d || null,
    units_sold_same_sku_30_d: r.unitsSoldSameSku30d || null,
  }));
  return batchMerge({
    table: 'sp_ad_group_report',
    keyColumns: ['client_id', 'profile_id', 'ad_group_id', 'date'],
    dataColumns: [
      'ad_group_name', 'ad_status',
      'campaign_id', 'campaign_name', 'campaign_status',
      'campaign_budget_amount', 'campaign_budget_type', 'campaign_budget_currency_code',
      'campaign_bidding_strategy', 'portfolio_id',
      'impressions', 'clicks', 'cost',
      'purchases_1_d', 'purchases_7_d', 'purchases_14_d', 'purchases_30_d',
      'purchases_same_sku_1_d', 'purchases_same_sku_7_d', 'purchases_same_sku_14_d', 'purchases_same_sku_30_d',
      'sales_1_d', 'sales_7_d', 'sales_14_d', 'sales_30_d',
      'attributed_sales_same_sku_1_d', 'attributed_sales_same_sku_7_d', 'attributed_sales_same_sku_14_d', 'attributed_sales_same_sku_30_d',
      'units_sold_clicks_1_d', 'units_sold_clicks_7_d', 'units_sold_clicks_14_d', 'units_sold_clicks_30_d',
      'units_sold_same_sku_1_d', 'units_sold_same_sku_7_d', 'units_sold_same_sku_14_d', 'units_sold_same_sku_30_d',
    ],
    dateColumns: ['date'],
    rows: mapped,
  });
}

/**
 * Write rows to sp_targeting_keyword_report using MERGE.
 */
async function writeSpTargetingReport(clientId, profileId, reportDate, rows) {
  if (!rows.length) return 0;
  const getIsoDate = (r) => (r && (r.date || r.DATE)) ? String(r.date || r.DATE).substring(0,10) : (String(reportDate).includes('_') ? toISODate(String(reportDate).substring(0,8)) : toISODate(String(reportDate)));
  const mapped = rows.map(r => ({
    client_id: clientId,
    profile_id: profileId,
    campaign_id: String(r.campaignId || ''),
    ad_group_id: String(r.adGroupId || ''),
    keyword_id: String(r.keywordId || ''),
    date: getIsoDate(r),
    targeting: r.targeting || null,
    match_type: r.matchType || null,
    keyword_bid: r.keywordBid || null,
    ad_keyword_status: r.adKeywordStatus || null,
    top_of_search_impression_share: r.topOfSearchImpressionShare || null,
    impressions: r.impressions || 0,
    clicks: r.clicks || 0,
    cost: r.cost || 0,
    purchases_1_d: r.purchases1d || null,
    purchases_7_d: r.purchases7d || null,
    purchases_14_d: r.purchases14d || null,
    purchases_30_d: r.purchases30d || null,
    sales_1_d: r.sales1d || null,
    sales_7_d: r.sales7d || null,
    sales_14_d: r.sales14d || null,
    sales_30_d: r.sales30d || null,
    units_sold_clicks_1_d: r.unitsSoldClicks1d || null,
    units_sold_clicks_7_d: r.unitsSoldClicks7d || null,
    units_sold_clicks_14_d: r.unitsSoldClicks14d || null,
    units_sold_clicks_30_d: r.unitsSoldClicks30d || null,
  }));
  return batchMerge({
    table: 'sp_targeting_keyword_report',
    keyColumns: ['client_id', 'profile_id', 'campaign_id', 'ad_group_id', 'keyword_id', 'date'],
    dataColumns: [
      'targeting', 'match_type', 'keyword_bid', 'ad_keyword_status',
      'top_of_search_impression_share',
      'impressions', 'clicks', 'cost',
      'purchases_1_d', 'purchases_7_d', 'purchases_14_d', 'purchases_30_d',
      'sales_1_d', 'sales_7_d', 'sales_14_d', 'sales_30_d',
      'units_sold_clicks_1_d', 'units_sold_clicks_7_d', 'units_sold_clicks_14_d', 'units_sold_clicks_30_d',
    ],
    dateColumns: ['date'],
    rows: mapped,
  });
}

/**
 * Write rows to sp_search_term_report using MERGE.
 */
async function writeSpSearchTermReport(clientId, profileId, reportDate, rows) {
  if (!rows.length) return 0;
  const getIsoDate = (r) => (r && (r.date || r.DATE)) ? String(r.date || r.DATE).substring(0,10) : (String(reportDate).includes('_') ? toISODate(String(reportDate).substring(0,8)) : toISODate(String(reportDate)));
  const mapped = rows.map(r => ({
    client_id: clientId,
    profile_id: profileId,
    campaign_id: String(r.campaignId),
    ad_group_id: String(r.adGroupId),
    keyword_id: String(r.keywordId),
    search_term: r.searchTerm || '',
    date: getIsoDate(r),
    targeting: r.targeting || null,
    match_type: r.matchType || null,
    impressions: r.impressions || 0,
    clicks: r.clicks || 0,
    cost: r.cost || 0,
    purchases_1_d: r.purchases1d || null,
    purchases_7_d: r.purchases7d || null,
    purchases_14_d: r.purchases14d || null,
    purchases_30_d: r.purchases30d || null,
    sales_1_d: r.sales1d || null,
    sales_7_d: r.sales7d || null,
    sales_14_d: r.sales14d || null,
    sales_30_d: r.sales30d || null,
    units_sold_clicks_1_d: r.unitsSoldClicks1d || null,
    units_sold_clicks_7_d: r.unitsSoldClicks7d || null,
    units_sold_clicks_14_d: r.unitsSoldClicks14d || null,
    units_sold_clicks_30_d: r.unitsSoldClicks30d || null,
  }));
  return batchMerge({
    table: 'sp_search_term_report',
    keyColumns: ['client_id', 'profile_id', 'campaign_id', 'ad_group_id', 'keyword_id', 'search_term', 'date'],
    dataColumns: [
      'targeting', 'match_type',
      'impressions', 'clicks', 'cost',
      'purchases_1_d', 'purchases_7_d', 'purchases_14_d', 'purchases_30_d',
      'sales_1_d', 'sales_7_d', 'sales_14_d', 'sales_30_d',
      'units_sold_clicks_1_d', 'units_sold_clicks_7_d', 'units_sold_clicks_14_d', 'units_sold_clicks_30_d',
    ],
    dateColumns: ['date'],
    rows: mapped,
  });
}

/**
 * Write rows to sp_advertised_product_report using MERGE.
 */
async function writeSpAdvertisedProductReport(clientId, profileId, reportDate, rows) {
  if (!rows.length) return 0;
  const getIsoDate = (r) => (r && (r.date || r.DATE)) ? String(r.date || r.DATE).substring(0,10) : (String(reportDate).includes('_') ? toISODate(String(reportDate).substring(0,8)) : toISODate(String(reportDate)));
  const mapped = rows.map(r => ({
    client_id: clientId,
    profile_id: profileId,
    campaign_id: String(r.campaignId),
    ad_group_id: String(r.adGroupId),
    ad_id: String(r.adId),
    date: getIsoDate(r),
    advertised_asin: r.advertisedAsin || null,
    advertised_sku: r.advertisedSku || null,
    impressions: r.impressions || 0,
    clicks: r.clicks || 0,
    cost: r.cost || 0,
    purchases_1_d: r.purchases1d || null,
    purchases_7_d: r.purchases7d || null,
    purchases_14_d: r.purchases14d || null,
    purchases_30_d: r.purchases30d || null,
    sales_1_d: r.sales1d || null,
    sales_7_d: r.sales7d || null,
    sales_14_d: r.sales14d || null,
    sales_30_d: r.sales30d || null,
    units_sold_clicks_1_d: r.unitsSoldClicks1d || null,
    units_sold_clicks_7_d: r.unitsSoldClicks7d || null,
    units_sold_clicks_14_d: r.unitsSoldClicks14d || null,
    units_sold_clicks_30_d: r.unitsSoldClicks30d || null,
    purchases_same_sku_30_d: r.purchasesSameSku30d || null,
    units_sold_same_sku_30_d: r.unitsSoldSameSku30d || null,
  }));
  return batchMerge({
    table: 'sp_advertised_product_report',
    keyColumns: ['client_id', 'profile_id', 'campaign_id', 'ad_group_id', 'ad_id', 'date'],
    dataColumns: [
      'advertised_asin', 'advertised_sku',
      'impressions', 'clicks', 'cost',
      'purchases_1_d', 'purchases_7_d', 'purchases_14_d', 'purchases_30_d',
      'sales_1_d', 'sales_7_d', 'sales_14_d', 'sales_30_d',
      'units_sold_clicks_1_d', 'units_sold_clicks_7_d', 'units_sold_clicks_14_d', 'units_sold_clicks_30_d',
      'purchases_same_sku_30_d', 'units_sold_same_sku_30_d',
    ],
    dateColumns: ['date'],
    rows: mapped,
  });
}

/**
 * Write rows to sp_campaign_placement_report using MERGE.
 */
async function writeSpCampaignPlacementReport(clientId, profileId, reportDate, rows) {
  if (!rows.length) return 0;
  const getIsoDate = (r) => (r && (r.date || r.DATE)) ? String(r.date || r.DATE).substring(0,10) : (String(reportDate).includes('_') ? toISODate(String(reportDate).substring(0,8)) : toISODate(String(reportDate)));
  const mapped = rows.map(r => ({
    client_id: clientId,
    profile_id: profileId,
    campaign_id: String(r.campaignId),
    placement: r.placement || 'SUMMARY',  // coerce empty placement to avoid source-duplicate MERGE errors
    date: getIsoDate(r),
    impressions: r.impressions || 0,
    clicks: r.clicks || 0,
    cost: r.cost || 0,
    purchases_30_d: r.purchases30d || null,
    sales_30_d: r.sales30d || null,
    units_sold_clicks_30_d: r.unitsSoldClicks30d || null,
  }));
  return batchMerge({
    table: 'sp_campaign_placement_report',
    keyColumns: ['client_id', 'profile_id', 'campaign_id', 'placement', 'date'],
    dataColumns: ['impressions', 'clicks', 'cost', 'purchases_30_d', 'sales_30_d', 'units_sold_clicks_30_d'],
    dateColumns: ['date'],
    rows: mapped,
  });
}

/**
 * Write rows to sb_campaign_report using MERGE.
 */
async function writeSbCampaignReport(clientId, profileId, reportDate, rows) {
  if (!rows.length) return 0;
  const getIsoDate = (r) => (r && (r.date || r.DATE)) ? String(r.date || r.DATE).substring(0,10) : (String(reportDate).includes('_') ? toISODate(String(reportDate).substring(0,8)) : toISODate(String(reportDate)));
  // Dual-write to unified RAW.AD_CAMPAIGN
  const rawRows = rows.map(r => ({
    client_id:      clientId,
    campaign_id:    String(r.campaignId || r.CAMPAIGN_ID || ''),
    date:           getIsoDate(r),
    ad_product:     'SPONSORED_BRANDS',
    platform:       'amazon',
    campaign_name:  r.campaignName || null,
    status:         r.campaignStatus || null,
    daily_budget:   r.campaignBudgetAmount || null,
    impressions:    r.impressions || 0,
    clicks:         r.clicks || 0,
    cost:           r.cost || 0,
    purchases_1d:   null,
    purchases_7d:   null,
    purchases_14d:  r.purchasesClicks || null,
    purchases_30d:  r.purchases || null,
    sales_1d:       null,
    sales_7d:       null,
    sales_14d:      r.salesClicks || null,
    sales_30d:      r.sales || null,
    ntb_orders_14d: r.newToBrandPurchasesClicks || null,
    ntb_sales_14d:  r.newToBrandSalesClicks || null,
    viewable_impressions: r.viewableImpressions || null,
    ingested_at:    new Date().toISOString(),
    data_maturity:  'preliminary',
  }));
  await writeRawAdCampaign(rawRows).catch(e => console.warn('[adsIngestion] RAW.AD_CAMPAIGN SB write failed (non-fatal):', e.message));
  const mapped = rows.map(r => ({
    client_id: clientId,
    profile_id: profileId,
    campaign_id: String(r.campaignId || r.CAMPAIGN_ID || ''),
    report_date: getIsoDate(r),
    campaign_name: r.campaignName || null,
    campaign_status: r.campaignStatus || null,
    campaign_budget_amount: r.campaignBudgetAmount || null,
    campaign_budget_type: r.campaignBudgetType || null,
    campaign_budget_currency_code: r.campaignBudgetCurrencyCode || null,
    cost_type: r.costType || null,
    impressions: r.impressions || 0,
    clicks: r.clicks || 0,
    cost: r.cost || 0,
    purchases: r.purchases || null,
    purchases_clicks: r.purchasesClicks || null,
    purchases_promoted: r.purchasesPromoted || null,
    sales: r.sales || null,
    sales_clicks: r.salesClicks || null,
    sales_promoted: r.salesPromoted || null,
    units_sold: r.unitsSold || null,
    units_sold_clicks: r.unitsSoldClicks || null,
    new_to_brand_purchases: r.newToBrandPurchases || null,
    new_to_brand_purchases_clicks: r.newToBrandPurchasesClicks || null,
    new_to_brand_purchases_percentage: r.newToBrandPurchasesPercentage || null,
    new_to_brand_purchases_rate: r.newToBrandPurchasesRate || null,
    new_to_brand_sales: r.newToBrandSales || null,
    new_to_brand_sales_clicks: r.newToBrandSalesClicks || null,
    new_to_brand_sales_percentage: r.newToBrandSalesPercentage || null,
    new_to_brand_units_sold: r.newToBrandUnitsSold || null,
    new_to_brand_units_sold_clicks: r.newToBrandUnitsSoldClicks || null,
    new_to_brand_units_sold_percentage: r.newToBrandUnitsSoldPercentage || null,
    new_to_brand_detail_page_views: r.newToBrandDetailPageViews || null,
    new_to_brand_detail_page_views_clicks: r.newToBrandDetailPageViewsClicks || null,
    new_to_brand_detail_page_view_rate: r.newToBrandDetailPageViewRate || null,
    new_to_brand_e_c_p_detail_page_view: r.newToBrandECPDetailPageView || null,
    detail_page_views: r.detailPageViews || null,
    detail_page_views_clicks: r.detailPageViewsClicks || null,
    add_to_cart: r.addToCart || null,
    add_to_cart_clicks: r.addToCartClicks || null,
    add_to_cart_rate: r.addToCartRate || null,
    branded_searches: r.brandedSearches || null,
    branded_searches_clicks: r.brandedSearchesClicks || null,
    brand_store_page_view: r.brandStorePageView || null,
    top_of_search_impression_share: r.topOfSearchImpressionShare || null,
    video_5_second_view_rate: r.video5SecondViewRate || null,
    video_5_second_views: r.video5SecondViews || null,
    video_complete_views: r.videoCompleteViews || null,
    video_first_quartile_views: r.videoFirstQuartileViews || null,
    video_midpoint_views: r.videoMidpointViews || null,
    video_third_quartile_views: r.videoThirdQuartileViews || null,
    video_unmutes: r.videoUnmutes || null,
    viewability_rate: r.viewabilityRate || null,
    viewable_impressions: r.viewableImpressions || null,
    view_click_through_rate: r.viewClickThroughRate || null,
  }));
  return batchMerge({
    table: 'sb_campaign_report',
    keyColumns: ['client_id', 'profile_id', 'campaign_id', 'report_date'],
    dataColumns: [
      'campaign_name', 'campaign_status', 'campaign_budget_amount', 'campaign_budget_type',
      'campaign_budget_currency_code', 'cost_type',
      'impressions', 'clicks', 'cost',
      'purchases', 'purchases_clicks', 'purchases_promoted',
      'sales', 'sales_clicks', 'sales_promoted',
      'units_sold', 'units_sold_clicks',
      'new_to_brand_purchases', 'new_to_brand_purchases_clicks',
      'new_to_brand_purchases_percentage', 'new_to_brand_purchases_rate',
      'new_to_brand_sales', 'new_to_brand_sales_clicks', 'new_to_brand_sales_percentage',
      'new_to_brand_units_sold', 'new_to_brand_units_sold_clicks', 'new_to_brand_units_sold_percentage',
      'new_to_brand_detail_page_views', 'new_to_brand_detail_page_views_clicks',
      'new_to_brand_detail_page_view_rate', 'new_to_brand_e_c_p_detail_page_view',
      'detail_page_views', 'detail_page_views_clicks',
      'add_to_cart', 'add_to_cart_clicks', 'add_to_cart_rate',
      'branded_searches', 'branded_searches_clicks',
      'brand_store_page_view', 'top_of_search_impression_share',
      'video_5_second_view_rate', 'video_5_second_views',
      'video_complete_views', 'video_first_quartile_views',
      'video_midpoint_views', 'video_third_quartile_views', 'video_unmutes',
      'viewability_rate', 'viewable_impressions', 'view_click_through_rate',
    ],
    dateColumns: ['report_date'],
    rows: mapped,
  });
}

/**
 * Write rows to sb_keyword_report using MERGE.
 */
async function writeSbKeywordReport(clientId, profileId, reportDate, rows) {
  if (!rows.length) return 0;
  const getIsoDate = (r) => (r && (r.date || r.DATE)) ? String(r.date || r.DATE).substring(0,10) : (String(reportDate).includes('_') ? toISODate(String(reportDate).substring(0,8)) : toISODate(String(reportDate)));
  const mapped = rows.map(r => ({
    client_id:   clientId,
    profile_id:  profileId,
    keyword_id:  String(r.keywordId || r.targetingId || ''),
    report_date: getIsoDate(r),
    campaign_id: String(r.campaignId || ''),
    campaign_name: r.campaignName || null,
    campaign_status: r.campaignStatus || null,
    campaign_budget_amount: r.campaignBudgetAmount || null,
    campaign_budget_type: r.campaignBudgetType || null,
    campaign_budget_currency_code: r.campaignBudgetCurrencyCode || null,
    ad_group_id: String(r.adGroupId || ''),
    ad_group_name: r.adGroupName || null,
    keyword_text: r.keywordText || r.targetingText || null,
    keyword_type: r.keywordType || null,
    match_type:  r.matchType || null,
    keyword_bid: r.keywordBid || null,
    ad_keyword_status: r.adKeywordStatus || null,
    targeting_expression: r.targetingExpression || null,
    targeting_id: String(r.targetingId || ''),
    targeting_text: r.targetingText || null,
    targeting_type: r.targetingType || null,
    top_of_search_impression_share: r.topOfSearchImpressionShare || null,
    impressions: r.impressions || 0,
    clicks:      r.clicks || 0,
    cost:        r.cost || 0,
    cost_type:   r.costType || null,
    purchases:   r.purchases || null,
    purchases_clicks: r.purchasesClicks || null,
    purchases_promoted: r.purchasesPromoted || null,
    sales:       r.sales || null,
    sales_clicks: r.salesClicks || null,
    sales_promoted: r.salesPromoted || null,
    units_sold:  r.unitsSold || null,
    new_to_brand_purchases: r.newToBrandPurchases || null,
    new_to_brand_purchases_clicks: r.newToBrandPurchasesClicks || null,
    new_to_brand_sales: r.newToBrandSales || null,
    new_to_brand_sales_clicks: r.newToBrandSalesClicks || null,
    new_to_brand_units_sold: r.newToBrandUnitsSold || null,
    detail_page_views: r.detailPageViews || null,
    detail_page_views_clicks: r.detailPageViewsClicks || null,
    add_to_cart: r.addToCart || null,
    add_to_cart_clicks: r.addToCartClicks || null,
    branded_searches: r.brandedSearches || null,
    branded_searches_clicks: r.brandedSearchesClicks || null,
    // NTB percentage/rate cols in table DDL
    new_to_brand_purchases_percentage: r.newToBrandPurchasesPercentage || null,
    new_to_brand_purchases_rate: r.newToBrandPurchasesRate || null,
    new_to_brand_sales_percentage: r.newToBrandSalesPercentage || null,
    new_to_brand_units_sold_percentage: r.newToBrandUnitsSoldPercentage || null,
    new_to_brand_detail_page_views: r.newToBrandDetailPageViews || null,
    new_to_brand_detail_page_views_clicks: r.newToBrandDetailPageViewsClicks || null,
    new_to_brand_detail_page_view_rate: r.newToBrandDetailPageViewRate || null,
    new_to_brand_e_c_p_detail_page_view: r.newToBrandECPDetailPageView || null,
  }));
  return batchMerge({
    table: 'sb_keyword_report',
    keyColumns: ['client_id', 'profile_id', 'keyword_id', 'report_date'],
    dataColumns: [
      'campaign_id', 'campaign_name', 'campaign_status', 'campaign_budget_amount',
      'campaign_budget_type', 'campaign_budget_currency_code',
      'ad_group_id', 'ad_group_name', 'keyword_text', 'keyword_type', 'match_type',
      'keyword_bid', 'ad_keyword_status', 'targeting_expression', 'targeting_id',
      'targeting_text', 'targeting_type', 'top_of_search_impression_share',
      'impressions', 'clicks', 'cost', 'cost_type',
      'purchases', 'purchases_clicks', 'purchases_promoted',
      'sales', 'sales_clicks', 'sales_promoted', 'units_sold',
      'new_to_brand_purchases', 'new_to_brand_purchases_clicks', 'new_to_brand_purchases_percentage', 'new_to_brand_purchases_rate',
      'new_to_brand_sales', 'new_to_brand_sales_clicks', 'new_to_brand_sales_percentage',
      'new_to_brand_units_sold', 'new_to_brand_units_sold_clicks', 'new_to_brand_units_sold_percentage',
      'new_to_brand_detail_page_views', 'new_to_brand_detail_page_views_clicks',
      'new_to_brand_detail_page_view_rate', 'new_to_brand_e_c_p_detail_page_view',
      'detail_page_views', 'detail_page_views_clicks',
      'add_to_cart', 'add_to_cart_clicks',
      'branded_searches', 'branded_searches_clicks',
    ],
    dateColumns: ['report_date'],
    rows: mapped,
  });
}

/**
 * Write rows to sb_search_term_report using MERGE.
 */
async function writeSbSearchTermReport(clientId, profileId, reportDate, rows) {
  if (!rows.length) return 0;
  const getIsoDate = (r) => (r && (r.date || r.DATE)) ? String(r.date || r.DATE).substring(0,10) : (String(reportDate).includes('_') ? toISODate(String(reportDate).substring(0,8)) : toISODate(String(reportDate)));
  const mapped = rows.map(r => ({
    client_id:   clientId,
    profile_id:  profileId,
    keyword_id:  String(r.keywordId || ''),
    search_term: r.searchTerm || r.queryTerm || r.query || '',
    report_date: getIsoDate(r),
    campaign_id: String(r.campaignId || ''),
    campaign_name: r.campaignName || null,
    campaign_status: r.campaignStatus || null,
    campaign_budget_amount: r.campaignBudgetAmount || null,
    campaign_budget_type: r.campaignBudgetType || null,
    campaign_budget_currency_code: r.campaignBudgetCurrencyCode || null,
    ad_group_id: String(r.adGroupId || ''),
    ad_group_name: r.adGroupName || null,
    keyword_text: r.keywordText || null,
    match_type:  r.matchType || null,
    keyword_bid: r.keywordBid || null,
    cost_type:   r.costType || null,
    impressions: r.impressions || 0,
    clicks:      r.clicks || 0,
    cost:        r.cost || 0,
    purchases:   r.purchases || null,
    purchases_clicks: r.purchasesClicks || null,
    sales:       r.sales || null,
    sales_clicks: r.salesClicks || null,
    units_sold:  r.unitsSold || null,
    video_5_second_view_rate: r.video5SecondViewRate || null,
    video_5_second_views: r.video5SecondViews || null,
    video_complete_views: r.videoCompleteViews || null,
    video_first_quartile_views: r.videoFirstQuartileViews || null,
    video_midpoint_views: r.videoMidpointViews || null,
    video_third_quartile_views: r.videoThirdQuartileViews || null,
    video_unmutes: r.videoUnmutes || null,
    viewability_rate: r.viewabilityRate || null,
    viewable_impressions: r.viewableImpressions || null,
    view_click_through_rate: r.viewClickThroughRate || null,
    // kindle columns — table has them, pass through if Amazon returns them
    kindle_edition_normalized_pages_read_14_d: r.kindleEditionNormalizedPagesRead14d || null,
    kindle_edition_normalized_pages_royalties_14_d: r.kindleEditionNormalizedPagesRoyalties14d || null,
  }));
  return batchMerge({
    table: 'sb_search_term_report',
    keyColumns: ['client_id', 'profile_id', 'keyword_id', 'search_term', 'report_date'],
    dataColumns: [
      'campaign_id', 'campaign_name', 'campaign_status', 'campaign_budget_amount',
      'campaign_budget_type', 'campaign_budget_currency_code',
      'ad_group_id', 'ad_group_name', 'keyword_text', 'match_type', 'keyword_bid', 'cost_type',
      'impressions', 'clicks', 'cost',
      'purchases', 'purchases_clicks', 'sales', 'sales_clicks', 'units_sold',
      'video_5_second_view_rate', 'video_5_second_views', 'video_complete_views',
      'video_first_quartile_views', 'video_midpoint_views', 'video_third_quartile_views',
      'video_unmutes', 'viewability_rate', 'viewable_impressions', 'view_click_through_rate',
      'kindle_edition_normalized_pages_read_14_d', 'kindle_edition_normalized_pages_royalties_14_d',
    ],
    dateColumns: ['report_date'],
    rows: mapped,
  });
}

/**
 * Write rows to sb_target_report using MERGE.
 */
async function writeSbTargetReport(clientId, profileId, reportDate, rows) {
  if (!rows.length) return 0;
  const getIsoDate = (r) => (r && (r.date || r.DATE)) ? String(r.date || r.DATE).substring(0,10) : (String(reportDate).includes('_') ? toISODate(String(reportDate).substring(0,8)) : toISODate(String(reportDate)));
  const mapped = rows.map(r => ({
    client_id:   clientId,
    profile_id:  profileId,
    target_id:   String(r.targetId || ''),
    report_date: getIsoDate(r),
    campaign_id: String(r.campaignId || ''),
    campaign_name: r.campaignName || null,
    campaign_status: r.campaignStatus || null,
    campaign_budget_amount: r.campaignBudgetAmount || null,
    campaign_budget_type: r.campaignBudgetType || null,
    campaign_budget_currency_code: r.campaignBudgetCurrencyCode || null,
    ad_group_id: String(r.adGroupId || ''),
    ad_group_name: r.adGroupName || null,
    targeting_expression: r.targetingExpression || null,
    targeting_text: r.targetingText || null,
    targeting_type: r.targetingType || null,
    top_of_search_impression_share: r.topOfSearchImpressionShare || null,
    cost_type:   r.costType || null,
    impressions: r.impressions || 0,
    clicks:      r.clicks || 0,
    cost:        r.cost || 0,
    purchases:   r.purchases || null,
    purchases_clicks: r.purchasesClicks || null,
    sales:       r.sales || null,
    sales_clicks: r.salesClicks || null,
    units_sold:  r.unitsSold || null,
    new_to_brand_purchases: r.newToBrandPurchases || null,
    new_to_brand_purchases_clicks: r.newToBrandPurchasesClicks || null,
    new_to_brand_sales: r.newToBrandSales || null,
    new_to_brand_sales_clicks: r.newToBrandSalesClicks || null,
    new_to_brand_units_sold: r.newToBrandUnitsSold || null,
    new_to_brand_units_sold_clicks: r.newToBrandUnitsSoldClicks || null,
  }));
  return batchMerge({
    table: 'sb_target_report',
    keyColumns: ['client_id', 'profile_id', 'target_id', 'report_date'],
    dataColumns: [
      'campaign_id', 'campaign_name', 'campaign_status', 'campaign_budget_amount',
      'campaign_budget_type', 'campaign_budget_currency_code',
      'ad_group_id', 'ad_group_name', 'targeting_expression', 'targeting_text', 'targeting_type',
      'top_of_search_impression_share', 'cost_type',
      'impressions', 'clicks', 'cost',
      'purchases', 'purchases_clicks', 'sales', 'sales_clicks', 'units_sold',
      'new_to_brand_purchases', 'new_to_brand_purchases_clicks',
      'new_to_brand_sales', 'new_to_brand_sales_clicks',
      'new_to_brand_units_sold', 'new_to_brand_units_sold_clicks',
    ],
    dateColumns: ['report_date'],
    rows: mapped,
  });
}

/**
 * Write rows to sb_placement_report using MERGE.
 */
async function writeSbPlacementReport(clientId, profileId, reportDate, rows) {
  if (!rows.length) return 0;
  const getIsoDate = (r) => (r && (r.date || r.DATE)) ? String(r.date || r.DATE).substring(0,10) : (String(reportDate).includes('_') ? toISODate(String(reportDate).substring(0,8)) : toISODate(String(reportDate)));
  const mapped = rows.map(r => ({
    client_id:   clientId,
    profile_id:  profileId,
    campaign_id: String(r.campaignId || ''),
    placement:   r.placement || 'SUMMARY',
    report_date: getIsoDate(r),
    campaign_name: r.campaignName || null,
    campaign_status: r.campaignStatus || null,
    campaign_budget_amount: r.campaignBudgetAmount || null,
    campaign_budget_type: r.campaignBudgetType || null,
    campaign_budget_currency_code: r.campaignBudgetCurrencyCode || null,
    placement_classification: r.placementClassification || null,
    cost_type:   r.costType || null,
    impressions: r.impressions || 0,
    clicks:      r.clicks || 0,
    cost:        r.cost || 0,
    purchases:   r.purchases || null,
    purchases_clicks: r.purchasesClicks || null,
    purchases_promoted: r.purchasesPromoted || null,
    sales:       r.sales || null,
    sales_clicks: r.salesClicks || null,
    sales_promoted: r.salesPromoted || null,
    units_sold:  r.unitsSold || null,
    units_sold_clicks: r.unitsSoldClicks || null,
    new_to_brand_purchases: r.newToBrandPurchases || null,
    new_to_brand_purchases_clicks: r.newToBrandPurchasesClicks || null,
    new_to_brand_sales: r.newToBrandSales || null,
    new_to_brand_sales_clicks: r.newToBrandSalesClicks || null,
    new_to_brand_units_sold: r.newToBrandUnitsSold || null,
    new_to_brand_units_sold_clicks: r.newToBrandUnitsSoldClicks || null,
    new_to_brand_detail_page_views: r.newToBrandDetailPageViews || null,
    new_to_brand_detail_page_views_clicks: r.newToBrandDetailPageViewsClicks || null,
    detail_page_views: r.detailPageViews || null,
    detail_page_views_clicks: r.detailPageViewsClicks || null,
    add_to_cart: r.addToCart || null,
    add_to_cart_clicks: r.addToCartClicks || null,
    video_5_second_views: r.video5SecondViews || null,
    video_complete_views: r.videoCompleteViews || null,
    video_first_quartile_views: r.videoFirstQuartileViews || null,
    video_midpoint_views: r.videoMidpointViews || null,
    video_third_quartile_views: r.videoThirdQuartileViews || null,
    video_unmutes: r.videoUnmutes || null,
    viewability_rate: r.viewabilityRate || null,
    viewable_impressions: r.viewableImpressions || null,
    // NTB percentage/rate columns — in table DDL
    new_to_brand_purchases_percentage: r.newToBrandPurchasesPercentage || null,
    new_to_brand_sales_percentage: r.newToBrandSalesPercentage || null,
    new_to_brand_units_sold_percentage: r.newToBrandUnitsSoldPercentage || null,
    new_to_brand_detail_page_view_rate: r.newToBrandDetailPageViewRate || null,
    new_to_brand_e_c_p_detail_page_view: r.newToBrandECPDetailPageView || null,
  }));
  return batchMerge({
    table: 'sb_placement_report',
    keyColumns: ['client_id', 'profile_id', 'campaign_id', 'placement', 'report_date'],
    dataColumns: [
      'campaign_name', 'campaign_status', 'campaign_budget_amount',
      'campaign_budget_type', 'campaign_budget_currency_code',
      'placement_classification', 'cost_type',
      'impressions', 'clicks', 'cost',
      'purchases', 'purchases_clicks', 'purchases_promoted',
      'sales', 'sales_clicks', 'sales_promoted',
      'units_sold', 'units_sold_clicks',
      'new_to_brand_purchases', 'new_to_brand_purchases_clicks', 'new_to_brand_purchases_percentage',
      'new_to_brand_sales', 'new_to_brand_sales_clicks', 'new_to_brand_sales_percentage',
      'new_to_brand_units_sold', 'new_to_brand_units_sold_clicks', 'new_to_brand_units_sold_percentage',
      'new_to_brand_detail_page_views', 'new_to_brand_detail_page_views_clicks',
      'new_to_brand_detail_page_view_rate', 'new_to_brand_e_c_p_detail_page_view',
      'detail_page_views', 'detail_page_views_clicks',
      'add_to_cart', 'add_to_cart_clicks',
      'video_5_second_views', 'video_complete_views', 'video_first_quartile_views',
      'video_midpoint_views', 'video_third_quartile_views', 'video_unmutes',
      'viewability_rate', 'viewable_impressions',
    ],
    dateColumns: ['report_date'],
    rows: mapped,
  });
}

/**
 * Write rows to sd_campaign_report using MERGE.
 */
async function writeSdCampaignReport(clientId, profileId, reportDate, rows) {
  if (!rows.length) return 0;
  const getIsoDate = (r) => (r && (r.date || r.DATE)) ? String(r.date || r.DATE).substring(0,10) : (String(reportDate).includes('_') ? toISODate(String(reportDate).substring(0,8)) : toISODate(String(reportDate)));
  // Dual-write to unified RAW.AD_CAMPAIGN
  const rawRows = rows.map(r => ({
    client_id:      clientId,
    campaign_id:    String(r.campaignId),
    date:           getIsoDate(r),
    ad_product:     'SPONSORED_DISPLAY',
    platform:       'amazon',
    campaign_name:  r.campaignName || null,
    status:         null,
    daily_budget:   null,
    impressions:    r.impressions || 0,
    clicks:         r.clicks || 0,
    cost:           r.cost || 0,
    purchases_1d:   null,
    purchases_7d:   null,
    purchases_14d:  r.purchasesClicks || null,
    purchases_30d:  r.purchases || null,
    sales_1d:       null,
    sales_7d:       null,
    sales_14d:      r.salesClicks || null,
    sales_30d:      r.sales || null,
    ntb_orders_14d: r.newToBrandPurchasesClicks || null,
    ntb_sales_14d:  r.newToBrandSalesClicks || null,
    viewable_impressions: r.viewableImpressions || null,
    ingested_at:    new Date().toISOString(),
    data_maturity:  'preliminary',
  }));
  await writeRawAdCampaign(rawRows).catch(e => console.warn('[adsIngestion] RAW.AD_CAMPAIGN SD write failed (non-fatal):', e.message));
  const mapped = rows.map(r => ({
    client_id: clientId,
    profile_id: profileId,
    campaign_id: String(r.campaignId),
    date: getIsoDate(r),
    campaign_name: r.campaignName || null,
    impressions: r.impressions || 0,
    clicks: r.clicks || 0,
    cost: r.cost || 0,
    purchases: r.purchases || null,
    purchases_clicks: r.purchasesClicks || null,
    sales: r.sales || null,
    sales_clicks: r.salesClicks || null,
    detail_page_views: r.detailPageViews || null,
    detail_page_views_clicks: r.detailPageViewsClicks || null,
    add_to_cart: r.addToCart || null,
    add_to_cart_clicks: r.addToCartClicks || null,
    new_to_brand_purchases: r.newToBrandPurchases || null,
    new_to_brand_sales: r.newToBrandSales || null,
    new_to_brand_units_sold: r.newToBrandUnitsSold || null,
    branded_searches: r.brandedSearches || null,
    viewability_rate: r.viewabilityRate || null,
  }));
  return batchMerge({
    table: 'sd_campaign_report',
    keyColumns: ['client_id', 'profile_id', 'campaign_id', 'date'],
    dataColumns: [
      'campaign_name',
      'impressions', 'clicks', 'cost',
      'purchases', 'purchases_clicks', 'sales', 'sales_clicks',
      'detail_page_views', 'detail_page_views_clicks',
      'add_to_cart', 'add_to_cart_clicks',
      'new_to_brand_purchases', 'new_to_brand_sales', 'new_to_brand_units_sold',
      'branded_searches', 'viewability_rate',
    ],
    dateColumns: ['date'],
    rows: mapped,
  });
}

/**
 * Write rows to sd_ad_group_report using MERGE.
 */
async function writeSdAdGroupReport(clientId, profileId, reportDate, rows) {
  if (!rows.length) return 0;
  const getIsoDate = (r) => (r && (r.date || r.DATE)) ? String(r.date || r.DATE).substring(0,10) : (String(reportDate).includes('_') ? toISODate(String(reportDate).substring(0,8)) : toISODate(String(reportDate)));
  const mapped = rows.map(r => ({
    client_id: clientId,
    profile_id: profileId,
    ad_group_id: String(r.adGroupId),
    date: getIsoDate(r),
    campaign_id: String(r.campaignId || ''),
    impressions: r.impressions || 0,
    clicks: r.clicks || 0,
    cost: r.cost || 0,
    purchases: r.purchases || null,
    purchases_clicks: r.purchasesClicks || null,
    sales: r.sales || null,
    sales_clicks: r.salesClicks || null,
    detail_page_views: r.detailPageViews || null,
    add_to_cart: r.addToCart || null,
    new_to_brand_purchases: r.newToBrandPurchases || null,
    new_to_brand_sales: r.newToBrandSales || null,
    new_to_brand_units_sold: r.newToBrandUnitsSold || null,
  }));
  return batchMerge({
    table: 'sd_ad_group_report',
    keyColumns: ['client_id', 'profile_id', 'ad_group_id', 'date'],
    dataColumns: [
      'campaign_id',
      'impressions', 'clicks', 'cost',
      'purchases', 'purchases_clicks', 'sales', 'sales_clicks',
      'detail_page_views', 'add_to_cart',
      'new_to_brand_purchases', 'new_to_brand_sales', 'new_to_brand_units_sold',
    ],
    dateColumns: ['date'],
    rows: mapped,
  });
}

/**
 * Write rows to sd_target_report using MERGE.
 */
async function writeSdTargetReport(clientId, profileId, reportDate, rows) {
  if (!rows.length) return 0;
  const getIsoDate = (r) => (r && (r.date || r.DATE)) ? String(r.date || r.DATE).substring(0,10) : (String(reportDate).includes('_') ? toISODate(String(reportDate).substring(0,8)) : toISODate(String(reportDate)));
  const mapped = rows.map(r => ({
    client_id: clientId,
    profile_id: profileId,
    ad_group_id: String(r.adGroupId),
    campaign_id: String(r.campaignId),
    targeting_id: String(r.targetingId),
    date: getIsoDate(r),
    impressions: r.impressions || 0,
    clicks: r.clicks || 0,
    cost: r.cost || 0,
    purchases: r.purchases || null,
    purchases_clicks: r.purchasesClicks || null,
    sales: r.sales || null,
    sales_clicks: r.salesClicks || null,
    detail_page_views: r.detailPageViews || null,
    add_to_cart: r.addToCart || null,
    new_to_brand_purchases: r.newToBrandPurchases || null,
    new_to_brand_sales: r.newToBrandSales || null,
    new_to_brand_units_sold: r.newToBrandUnitsSold || null,
  }));
  return batchMerge({
    table: 'sd_target_report',
    keyColumns: ['client_id', 'profile_id', 'ad_group_id', 'campaign_id', 'targeting_id', 'date'],
    dataColumns: [
      'impressions', 'clicks', 'cost',
      'purchases', 'purchases_clicks', 'sales', 'sales_clicks',
      'detail_page_views', 'add_to_cart',
      'new_to_brand_purchases', 'new_to_brand_sales', 'new_to_brand_units_sold',
    ],
    dateColumns: ['date'],
    rows: mapped,
  });
}

/**
 * Write rows to sd_product_ad_report using MERGE.
 */
async function writeSdProductAdReport(clientId, profileId, reportDate, rows) {
  if (!rows.length) return 0;
  const getIsoDate = (r) => (r && (r.date || r.DATE)) ? String(r.date || r.DATE).substring(0,10) : (String(reportDate).includes('_') ? toISODate(String(reportDate).substring(0,8)) : toISODate(String(reportDate)));
  const mapped = rows.map(r => ({
    client_id: clientId,
    profile_id: profileId,
    ad_id: String(r.adId),
    date: getIsoDate(r),
    ad_group_id: String(r.adGroupId || ''),
    campaign_id: String(r.campaignId || ''),
    impressions: r.impressions || 0,
    clicks: r.clicks || 0,
    cost: r.cost || 0,
    purchases: r.purchases || null,
    purchases_clicks: r.purchasesClicks || null,
    sales: r.sales || null,
    sales_clicks: r.salesClicks || null,
    detail_page_views: r.detailPageViews || null,
    add_to_cart: r.addToCart || null,
    new_to_brand_purchases: r.newToBrandPurchases || null,
    new_to_brand_sales: r.newToBrandSales || null,
    new_to_brand_units_sold: r.newToBrandUnitsSold || null,
  }));
  return batchMerge({
    table: 'sd_product_ad_report',
    keyColumns: ['client_id', 'profile_id', 'ad_id', 'date'],
    dataColumns: [
      'ad_group_id', 'campaign_id',
      'impressions', 'clicks', 'cost',
      'purchases', 'purchases_clicks', 'sales', 'sales_clicks',
      'detail_page_views', 'add_to_cart',
      'new_to_brand_purchases', 'new_to_brand_sales', 'new_to_brand_units_sold',
    ],
    dateColumns: ['date'],
    rows: mapped,
  });
}

/**
 * Write spPurchasedProduct rows (products purchased via SP ads, not necessarily advertised)
 */
async function writeSpPurchasedProductReport(clientId, profileId, reportDate, rows) {
  if (!rows.length) return 0;
  // Handle range reportDate like '20251223_20260122' — use row-level date if present, else start date
  const getIsoDate = (r) => (r && (r.date || r.DATE)) ? String(r.date || r.DATE).substring(0, 10) : (String(reportDate).includes('_') ? toISODate(String(reportDate).substring(0, 8)) : toISODate(String(reportDate)));
  const mapped = rows.map(r => ({
    client_id: clientId,
    profile_id: profileId,
    campaign_id: String(r.campaignId || ''),
    ad_group_id: String(r.adGroupId || ''),
    keyword_id: String(r.keywordId || ''),
    advertised_asin: String(r.advertisedAsin || ''),
    purchased_asin: String(r.purchasedAsin || ''),
    date: getIsoDate(r),
    purchases_1_d: r.purchases1d || 0,
    purchases_7_d: r.purchases7d || 0,
    purchases_14_d: r.purchases14d || 0,
    purchases_30_d: r.purchases30d || 0,
    sales_1_d: r.sales1d || 0,
    sales_7_d: r.sales7d || 0,
    sales_14_d: r.sales14d || 0,
    sales_30_d: r.sales30d || 0,
    units_sold_clicks_1_d: r.unitsSoldClicks1d || 0,
    units_sold_clicks_7_d: r.unitsSoldClicks7d || 0,
    units_sold_clicks_14_d: r.unitsSoldClicks14d || 0,
    units_sold_clicks_30_d: r.unitsSoldClicks30d || 0,
  }));

  // Deduplicate source rows by primary key before MERGE — Snowflake rejects duplicate keys in source
  const keyColumns = ['client_id', 'profile_id', 'campaign_id', 'ad_group_id', 'keyword_id', 'advertised_asin', 'purchased_asin', 'date'];
  const seen = new Map();
  for (const row of mapped) {
    const key = keyColumns.map(c => row[c]).join('|');
    seen.set(key, row); // last row wins for each key
  }
  const deduped = Array.from(seen.values());

  return batchMerge({
    table: 'sp_purchased_product_report',
    keyColumns,
    dataColumns: [
      'purchases_1_d', 'purchases_7_d', 'purchases_14_d', 'purchases_30_d',
      'sales_1_d', 'sales_7_d', 'sales_14_d', 'sales_30_d',
      'units_sold_clicks_1_d', 'units_sold_clicks_7_d', 'units_sold_clicks_14_d', 'units_sold_clicks_30_d',
    ],
    dateColumns: ['date'],
    rows: deduped,
  });
}

// ============================================================
// DSP WRITE FUNCTIONS
// ============================================================

/**
 * Write rows to dsp_campaign_report using batchMerge.
 * Keyed on (advertiser_id, profile_id, date, order_id).
 * client_id is carried from the queue but not part of the PK.
 */
/**
 * Write rows to dsp_campaign_report using batchMerge.
 * groupBy: ['campaign', 'order', 'lineItem'] — full hierarchy in one row.
 * reportTypeId: 'dspCampaign' (the only valid DSP v3 reportTypeId).
 */
/**
 * Write DSP campaign report rows — matches actual Amazon v3 API response columns.
 * Key: advertiser_id + profile_id + date + order_id
 */
async function writeDspCampaignReport(clientId, profileId, reportDate, rows) {
  if (!rows.length) return 0;
  const [advertiserId, realProfileId] = profileId.includes('|')
    ? profileId.split('|')
    : [profileId, profileId];
  // NOTE: DSP is NOT dual-written to RAW.AD_CAMPAIGN here.
  // stageRawData.js (stageAdCampaignRaw) is the sole writer for DSP → RAW.AD_CAMPAIGN.
  // Dual-writing caused duplicate rows (mismatched report_id format = 2× spend/sales).

  // Validate advertiser_id against dsp_advertiser table to reject truncated/corrupted IDs.
  // Amazon 64-bit IDs overflow JS Number and get rounded — safeParse fixes NEW downloads,
  // but cached report re-downloads from Amazon can still return rounded values.
  // Only write rows whose advertiserId matches our known-good advertiser_id.
  let trustedAdvertiserIds;
  try {
    const knownRows = await query('SELECT advertiser_id FROM dsp_advertiser WHERE is_active = TRUE');
    trustedAdvertiserIds = new Set(knownRows.map(r => String(r.ADVERTISER_ID || r.advertiser_id)));
  } catch (err) {
    console.warn('[DSP] Could not load trusted advertiser IDs — skipping validation:', err.message);
    trustedAdvertiserIds = null;
  }

  const filteredRows = trustedAdvertiserIds
    ? rows.filter(r => {
        const aid = String(r.advertiserId || advertiserId);
        const trusted = trustedAdvertiserIds.has(aid);
        if (!trusted) console.warn(`[DSP] Rejecting row with unknown advertiserId ${aid} (truncation artifact)`);
        return trusted;
      })
    : rows;

  if (!filteredRows.length) return 0;

  const mapped = filteredRows.map(r => ({
    advertiser_id:                String(r.advertiserId || advertiserId),
    profile_id:                   realProfileId,
    client_id:                    clientId,
    date:                         String(r.date || r.DATE || '').substring(0, 10) || null,
    order_id:                     String(r.orderId || ''),
    order_name:                   r.orderName || null,
    order_budget:                 r.orderBudget || null,
    order_start_date:             r.orderStartDate ? String(r.orderStartDate).substring(0, 10) : null,
    order_end_date:               r.orderEndDate ? String(r.orderEndDate).substring(0, 10) : null,
    order_currency:               r.orderCurrency || null,
    advertiser_name:              r.advertiserName || null,
    entity_id:                    String(r.entityId || ''),
    impressions:                  r.impressions || 0,
    clicks:                       r.clicks || 0,
    total_cost:                   r.totalCost || 0,
    viewable_impressions:         r.viewableImpressions || null,
    viewability_rate:             r.viewabilityRate || null,
    detail_page_views:            r.detailPageViews || null,
    detail_page_view_clicks:      r.detailPageViewClicks || null,
    add_to_cart:                  r.addToCart || null,
    add_to_cart_clicks:           r.addToCartClicks || null,
    purchases:                    r.purchases || null,
    purchases_clicks:             r.purchasesClicks || null,
    total_purchases:              r.totalPurchases || null,
    total_purchases_clicks:       r.totalPurchasesClicks || null,
    sales:                        r.sales || null,
    total_sales:                  r.totalSales || null,
    new_to_brand_purchases:       r.newToBrandPurchases || null,
    new_to_brand_purchases_clicks: r.newToBrandPurchasesClicks || null,
    new_to_brand_product_sales:   r.newToBrandProductSales || null,
  }));
  // Key on (client_id, profile_id, date, order_id) — NOT advertiser_id.
  // Amazon's 64-bit advertiser/order IDs can be truncated differently by JSON.parse(),
  // causing the same real campaign to appear under two advertiser_id values.
  // Excluding advertiser_id from the PK ensures a second write for the same
  // order+date is an UPDATE (not a second INSERT), preventing double-counting.
  // advertiser_id is still written/updated via dataColumns.
  return batchMerge({
    table: 'dsp_campaign_report',
    keyColumns: ['client_id', 'profile_id', 'date', 'order_id'],
    dataColumns: [
      'advertiser_id', 'order_name', 'order_budget', 'order_start_date', 'order_end_date',
      'order_currency', 'advertiser_name', 'entity_id',
      'impressions', 'clicks', 'total_cost',
      'viewable_impressions', 'viewability_rate',
      'detail_page_views', 'detail_page_view_clicks',
      'add_to_cart', 'add_to_cart_clicks',
      'purchases', 'purchases_clicks', 'total_purchases', 'total_purchases_clicks',
      'sales', 'total_sales',
      'new_to_brand_purchases', 'new_to_brand_purchases_clicks', 'new_to_brand_product_sales',
    ],
    dateColumns: ['date', 'order_start_date', 'order_end_date'],
    rows: mapped,
  });
}

// ── Generic Gross & Invalid Traffic writer ──────────────────────────────────
async function writeGrossAndInvalidReport(table, clientId, profileId, reportDate, rows) {
  if (!rows.length) return 0;
  const getIsoDateLocal = (r) => (r && (r.date || r.DATE))
    ? String(r.date || r.DATE).substring(0, 10)
    : (String(reportDate).includes('_') ? toISODate(String(reportDate).substring(0, 8)) : toISODate(String(reportDate)));

  const mapped = rows.map(r => ({
    client_id:                  clientId,
    profile_id:                 profileId,
    campaign_id:                String(r.campaignId || ''),
    date:                       getIsoDateLocal(r),
    campaign_name:              r.campaignName              || null,
    campaign_status:            r.campaignStatus            || null,
    impressions:                r.impressions               || 0,
    gross_impressions:          r.grossImpressions          || null,
    invalid_impressions:        r.invalidImpressions        || null,
    invalid_impression_rate:    r.invalidImpressionRate     || null,
    clicks:                     r.clicks                    || 0,
    gross_click_throughs:       r.grossClickThroughs        || null,
    invalid_click_throughs:     r.invalidClickThroughs      || null,
    invalid_click_through_rate: r.invalidClickThroughRate   || null,
  }));

  return batchMerge({
    table,
    keyColumns:  ['client_id', 'profile_id', 'campaign_id', 'date'],
    dataColumns: [
      'campaign_name', 'campaign_status',
      'impressions', 'gross_impressions', 'invalid_impressions', 'invalid_impression_rate',
      'clicks', 'gross_click_throughs', 'invalid_click_throughs', 'invalid_click_through_rate',
    ],
    dateColumns: ['date'],
    rows: mapped,
  });
}

// ============================================================
// DUAL-WRITE: RAW.AD_CAMPAIGN (unified Project GO schema)
// Called alongside each per-report-type write to keep the
// /analytics dashboard current with live ingestion data.
// ============================================================

/**
 * Upsert campaign-level rows into CALBRIDGE_PROD.RAW.AD_CAMPAIGN.
 * This is the unified table the /analytics dashboard reads from.
 */
async function writeRawAdCampaign(rows) {
  if (!rows.length) return 0;
  return batchMerge({
    table:       'CALBRIDGE_PROD.RAW.AD_CAMPAIGN',
    keyColumns:  ['client_id', 'campaign_id', 'date', 'ad_product'],
    dataColumns: [
      'platform', 'campaign_name', 'status', 'daily_budget',
      'impressions', 'clicks', 'cost',
      'purchases_1d', 'purchases_7d', 'purchases_14d', 'purchases_30d',
      'sales_1d', 'sales_7d', 'sales_14d', 'sales_30d',
      'ntb_orders_14d', 'ntb_sales_14d',
      'viewable_impressions', 'ingested_at', 'data_maturity',
    ],
    rows,
  });
}

// ============================================================
// WRITE FUNCTION DISPATCH TABLE
// ============================================================

const WRITE_FNS = {
  spCampaigns:          writeSpCampaignReport,
  spAdGroups:           writeSpAdGroupReport,
  spTargeting:          writeSpTargetingReport,
  spSearchTerm:         writeSpSearchTermReport,
  spAdvertisedProduct:  writeSpAdvertisedProductReport,
  spCampaignPlacement:  writeSpCampaignPlacementReport,
  spPurchasedProduct:   writeSpPurchasedProductReport,
  sbCampaigns:          writeSbCampaignReport,
  sbTargeting:          writeSbKeywordReport,
  sbSearchTerms:        writeSbSearchTermReport,
  sbTargets:            writeSbTargetReport,
  sbPlacements:         writeSbPlacementReport,
  sdCampaigns:          writeSdCampaignReport,
  sdAdGroups:           writeSdAdGroupReport,
  sdTargeting:          writeSdTargetReport,
  sdAdvertisedProduct:  writeSdProductAdReport,
  // Gross & Invalid Traffic
  spGrossAndInvalids: (c,p,d,rows) => writeGrossAndInvalidReport('sp_gross_and_invalid_report',c,p,d,rows),
  sbGrossAndInvalids: (c,p,d,rows) => writeGrossAndInvalidReport('sb_gross_and_invalid_report',c,p,d,rows),
  sdGrossAndInvalids: (c,p,d,rows) => writeGrossAndInvalidReport('sd_gross_and_invalid_report',c,p,d,rows),
  // DSP — reportTypeId is always 'dspCampaign'; key varies by groupBy
  dspCampaign:  writeDspCampaignReport,    // groupBy: ['campaign'] — actual DSP data
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
  // Split on CREATE TABLE boundaries (handles comment blocks between statements)
  const statements = sql
    .split(/(?=CREATE TABLE IF NOT EXISTS )/i)
    .map(s => s.trim())
    .filter(s => s.toUpperCase().startsWith('CREATE'))
    .map(s => {
      // Extract just up to the closing ); of the CREATE TABLE
      const match = s.match(/CREATE TABLE[\s\S]+?\)\s*$/m);
      return match ? match[0] : s.replace(/;$/, '');
    })
    .filter(s => s.length > 20);

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
async function ingestPerformance(clientId, connectionType, daysBack = 30) {
  return runJob(clientId, connectionType, 'performance', async () => {
    const allProfiles = await fetchProfiles(clientId, connectionType);
    const profiles    = await getAuthorizedProfiles(clientId, allProfiles);
    let   queued      = 0;

    // Amazon max range per request: 31 days
    // Split daysBack into 31-day chunks — one request per chunk per report type
    const MAX_RANGE = 31;

    // Build date windows (oldest to newest)
    // Use today as end date — intra-day data is preliminary but gets overwritten on next run
    const endDateBase = new Date();

    const windows = [];
    let remaining = daysBack;
    let windowEnd = new Date(endDateBase);
    while (remaining > 0) {
      const chunkDays = Math.min(remaining, MAX_RANGE);
      const windowStart = new Date(windowEnd);
      windowStart.setDate(windowStart.getDate() - (chunkDays - 1));
      windows.unshift({ // oldest first
        startIso: windowStart.toISOString().split('T')[0],
        endIso:   windowEnd.toISOString().split('T')[0]
      });
      windowEnd = new Date(windowStart);
      windowEnd.setDate(windowEnd.getDate() - 1);
      remaining -= chunkDays;
    }

    console.log(`[performance] ${daysBack} days → ${windows.length} chunks of ≤${MAX_RANGE} days, ${REPORT_TYPES.length} report types = up to ${windows.length * REPORT_TYPES.length} requests`);

    for (const profile of profiles) {
      const profileId = String(profile.profileId);

      for (const { startIso, endIso } of windows) {
        const rangeKey = startIso.replace(/-/g,'') + '_' + endIso.replace(/-/g,'');

        for (const rt of REPORT_TYPES) {
          try {
            await new Promise(r => setImmediate(r)); // yield event loop

            // Deduplicate: skip if already pending/completed for this type+range+profile
            const existing = await query(`
              SELECT COUNT(*) as cnt FROM ads_report_queue
              WHERE client_id=? AND report_type=? AND report_date=? AND profile_id=?
              AND status IN ('pending','completed')
            `, [clientId, rt.key, rangeKey, profileId]);
            if (Number(existing[0]?.CNT || 0) > 0) continue;

            const freshClient = await adsClient(clientId, connectionType);
            const reportId    = await requestV3Report(
              freshClient, profileId, startIso,
              rt.reportTypeId, rt.adProduct, rt.groupBy, rt.columns, rt.filters,
            endIso  // pass endDate to cover full range
          );
          if (!reportId) continue;

          await query(`
            INSERT INTO ads_report_queue
              (report_id, client_id, connection_type, profile_id, report_type, report_date, status, requested_at)
            VALUES (?, ?, ?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP)
          `, [reportId, clientId, connectionType, profileId, rt.key, rangeKey]);

          console.log(`[performance] Queued ${rt.key} ${startIso}→${endIso} (${reportId.substring(0,8)})`);
          queued++;
          await sleep(100);
        } catch (err) {
          const body = err.response?.data ? JSON.stringify(err.response.data).substring(0,200) : '';
          console.warn(`[performance] Failed ${rt.key} ${startIso}→${endIso}: ${err.message} ${body}`);
        }
      } // end report types loop
      } // end windows loop
    } // end profiles loop

    console.log(`[performance] Queued ${queued} reports total`);
    return { recordsWritten: 0, queued };
  });
}

// ============================================================
// RANGE-BASED BACKFILL
// ============================================================

/**
 * Backfill performance reports for an explicit date range.
 * Uses the same 31-day chunking and dedup as ingestPerformance().
 *
 * @param {string} clientId
 * @param {string} connectionType  - 'ads'
 * @param {string} startDate       - ISO date string, e.g. '2025-01-01'
 * @param {string} endDate         - ISO date string, e.g. '2025-12-31'
 * @param {string[]} [reportTypeFilter] - optional array of rt.key values to include
 *                                        e.g. ['spCampaigns'] — if omitted, runs all REPORT_TYPES
 */
async function ingestPerformanceRange(clientId, connectionType, startDate, endDate, reportTypeFilter = null) {
  return runJob(clientId, connectionType, 'performanceRange', async () => {
    const allProfiles = await fetchProfiles(clientId, connectionType);
    const profiles    = await getAuthorizedProfiles(clientId, allProfiles);
    let   queued      = 0;
    let   skipped     = 0;

    const activeTypes = reportTypeFilter
      ? REPORT_TYPES.filter(rt => reportTypeFilter.includes(rt.key))
      : REPORT_TYPES;

    // Amazon max range per request: 31 days
    // Build date windows by iterating forward from startDate in 31-day chunks
    const MAX_RANGE = 31;
    const rangeStart = new Date(startDate);
    const rangeEnd   = new Date(endDate);

    const windows = [];
    let cursor = new Date(rangeStart);
    while (cursor <= rangeEnd) {
      const windowStart = new Date(cursor);
      const windowEnd   = new Date(cursor);
      windowEnd.setDate(windowEnd.getDate() + (MAX_RANGE - 1));
      if (windowEnd > rangeEnd) windowEnd.setTime(rangeEnd.getTime());
      windows.push({
        startIso: windowStart.toISOString().split('T')[0],
        endIso:   windowEnd.toISOString().split('T')[0]
      });
      cursor = new Date(windowEnd);
      cursor.setDate(cursor.getDate() + 1);
    }

    console.log(`[performanceRange] ${startDate}→${endDate}: ${windows.length} chunks of ≤${MAX_RANGE} days, ${activeTypes.length} report type(s) = up to ${windows.length * activeTypes.length * profiles.length} requests`);

    for (const profile of profiles) {
      const profileId = String(profile.profileId);

      for (const { startIso, endIso } of windows) {
        const rangeKey = startIso.replace(/-/g,'') + '_' + endIso.replace(/-/g,'');

        for (const rt of activeTypes) {
          try {
            await new Promise(r => setImmediate(r)); // yield event loop

            // Deduplicate: skip if already pending/completed for this type+range+profile
            const existing = await query(`
              SELECT COUNT(*) as cnt FROM ads_report_queue
              WHERE client_id=? AND report_type=? AND report_date=? AND profile_id=?
              AND status IN ('pending','completed')
            `, [clientId, rt.key, rangeKey, profileId]);
            if (Number(existing[0]?.CNT || 0) > 0) {
              console.log(`[performanceRange] Skip (exists) ${rt.key} ${startIso}→${endIso} profile=${profileId}`);
              skipped++;
              continue;
            }

            const freshClient = await adsClient(clientId, connectionType);
            const reportId    = await requestV3Report(
              freshClient, profileId, startIso,
              rt.reportTypeId, rt.adProduct, rt.groupBy, rt.columns, rt.filters,
              endIso
            );
            if (!reportId) continue;

            await query(`
              INSERT INTO ads_report_queue
                (report_id, client_id, connection_type, profile_id, report_type, report_date, status, requested_at)
              VALUES (?, ?, ?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP)
            `, [reportId, clientId, connectionType, profileId, rt.key, rangeKey]);

            console.log(`[performanceRange] Queued ${rt.key} ${startIso}→${endIso} profile=${profileId} (${reportId.substring(0,8)})`);
            queued++;
            await sleep(100);
          } catch (err) {
            const body = err.response?.data ? JSON.stringify(err.response.data).substring(0,200) : '';
            console.warn(`[performanceRange] Failed ${rt.key} ${startIso}→${endIso}: ${err.message} ${body}`);
          }
        } // end report types loop
      } // end windows loop
    } // end profiles loop

    console.log(`[performanceRange] Done — queued=${queued} skipped=${skipped}`);
    return { recordsWritten: 0, queued, skipped, windows: windows.length };
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
  // Fetch token FIRST before acquiring more connections.
  // Use owner_client_id if set — DSP reports are queued under individual client IDs
  // but the token that can download them belongs to the agency account (CyberPower).
  let earlyToken = null;
  try {
    // Check if any pending reports for this client have a different token owner
    const ownerRows = await query(
      'SELECT DISTINCT owner_client_id FROM ads_report_queue WHERE client_id = ? AND connection_type = ? AND status IN (\'pending\',\'ready\') AND owner_client_id IS NOT NULL LIMIT 1',
      [clientId, connectionType]
    ).catch(() => []);
    const tokenClientId = ownerRows[0]?.OWNER_CLIENT_ID || clientId;

    const connRows = await query('SELECT connections FROM clients WHERE client_id = ?', [tokenClientId]);
    const parsed = typeof connRows[0]?.CONNECTIONS === 'string'
      ? JSON.parse(connRows[0].CONNECTIONS)
      : connRows[0]?.CONNECTIONS;
    const refreshToken = parsed?.[connectionType]?.refreshToken;
    if (refreshToken) {
      const tr = await require('axios').post('https://api.amazon.com/auth/o2/token',
        new (require('url').URLSearchParams)({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: process.env.LWA_CLIENT_ID, client_secret: process.env.LWA_CLIENT_SECRET }),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      );
      earlyToken = tr.data.access_token;
      if (tokenClientId !== clientId) {
        console.log(`[ReportQueue] Using token from owner ${tokenClientId.slice(0,8)} for client ${clientId.slice(0,8)}`);
      }
    }
  } catch (err) {
    console.warn('[ReportQueue] Token pre-fetch failed:', err.message);
  }

  const pending = await query(`
    SELECT report_id, profile_id, report_type, report_date, status, download_url
    FROM ads_report_queue
    WHERE client_id = ? AND connection_type = ? AND status IN ('pending', 'ready')
    ORDER BY requested_at ASC
    LIMIT 20
  `, [clientId, connectionType]);

  if (!pending.length) return { processed: 0 };
  console.log(`[ReportQueue] Processing ${pending.length} pending for ${clientId}`);

  let processed = 0;

  // Get token by reading directly from Snowflake connections table
  // Avoids calling getValidToken() which can hang when pool is busy
  // Use pre-fetched token if available, otherwise fall back to getValidToken
  let cachedToken = earlyToken;
  let tokenFetchedAt = earlyToken ? Date.now() : 0;

  async function refreshToken() {
    try {
      const { getValidToken } = require('../services/amazonAuthService');
      cachedToken = await getValidToken(clientId, connectionType);
      tokenFetchedAt = Date.now();
    } catch (err) {
      throw new Error(`Token refresh failed: ${err.message}`);
    }
  }

  if (!cachedToken) await refreshToken();

  async function buildPollClient() {
    // Refresh if older than 45 minutes
    if (Date.now() - tokenFetchedAt > 45 * 60 * 1000) {
      await refreshToken();
    }
    return axios.create({
      baseURL: ADS_API_BASE,
      headers: {
        'Authorization': `Bearer ${cachedToken}`,
        'Amazon-Advertising-API-ClientId': process.env.LWA_CLIENT_ID,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });
  }

  async function processOne(row) {
    const reportId   = row.REPORT_ID   || row.report_id;
    const rawProfileId = row.PROFILE_ID || row.profile_id;
    const reportType = row.REPORT_TYPE || row.report_type;
    const reportDate = String(row.REPORT_DATE || row.report_date);

    // DSP reports store 'advertiserId|profileId' — extract just profileId
    const profileId = rawProfileId?.includes('|')
      ? rawProfileId.split('|')[1]
      : rawProfileId;

    try {
      // If already marked 'ready' with a stored download URL, skip the poll and download directly
      const rowStatus = row.STATUS || row.status;
      const storedUrl = row.DOWNLOAD_URL || row.download_url;

      let status, url, failureReason;
      if (rowStatus === 'ready' && storedUrl) {
        status = 'COMPLETED';
        url    = storedUrl;
      } else {
        const pollClient = await buildPollClient();
        const statusRes  = await pollClient.get(`/reporting/reports/${reportId}`, {
          headers: { 'Amazon-Advertising-API-Scope': profileId }
        });
        ({ status, url, failureReason } = statusRes.data);
      }

      if (status === 'PENDING' || status === 'PROCESSING') return false;

      if (status === 'FAILURE') {
        await query(`UPDATE ads_report_queue SET status='failed', error_message=?, completed_at=CURRENT_TIMESTAMP WHERE report_id=?`,
          [failureReason || 'FAILURE', reportId]);
        return false;
      }

      if (status === 'COMPLETED' && url) {
        const dl     = await axios.get(url, { responseType: 'arraybuffer', timeout: 120000 });
        const data   = safeParse(zlib.gunzipSync(Buffer.from(dl.data)).toString('utf8'));
        const rows   = Array.isArray(data) ? data : [];
        const writeFn = WRITE_FNS[reportType];

        if (!writeFn) {
          await query(`UPDATE ads_report_queue SET status='failed', error_message=?, completed_at=CURRENT_TIMESTAMP WHERE report_id=?`,
            [`No write function for: ${reportType}`, reportId]);
          return false;
        }

        let written = 0;
        try {
          written = await writeFn(clientId, profileId, reportDate, rows);
        } catch (writeErr) {

          // If table doesn't exist, create schema and retry once
          if (writeErr.message?.includes('does not exist') || writeErr.message?.includes('not authorized')) {
            console.warn(`[ReportQueue] Table missing for ${reportType} — running ensureAdsSchema and retrying`);
            try {
              await ensureAdsSchema();
              written = await writeFn(clientId, profileId, reportDate, rows);
            } catch (retryErr) {
              throw retryErr; // let outer catch handle
            }
          } else {
            throw writeErr;
          }
        }
        await query(`UPDATE ads_report_queue SET status='completed', records_written=?, completed_at=CURRENT_TIMESTAMP WHERE report_id=?`,
          [written, reportId]);
        console.log(`[ReportQueue] ✅ ${reportId} (${reportType} ${reportDate}) — ${written} records`);
        return true;
      }
    } catch (err) {
      const msg = err.message?.substring(0, 500) || 'unknown';
      console.warn(`[ReportQueue] ${reportId} error: ${msg}`);
      try { await query(`UPDATE ads_report_queue SET error_message=? WHERE report_id=?`, [msg, reportId]); } catch {}
    }
    return false;
  }

  // Parallel batches of 5
  // Sequential processing with event loop yield between each report
  for (const row of pending) {
    await new Promise(r => setImmediate(r)); // yield to event loop
    const ok = await processOne(row);
    if (ok) processed++;
  }

  console.log(`[ReportQueue] Completed: ${processed} reports written`);
  return { processed };
}

// ============================================================
// EXPORTS
// ============================================================

// ============================================================
// DSP INGESTION
// ============================================================

/**
 * Fetch all DSP advertisers for a given agency profile.
 */
async function fetchDspAdvertisers(client, profileId) {
  try {
    // Use responseType: 'text' + safeParse to prevent JS float truncation of large advertiser IDs.
    // Axios's default JSON parsing silently corrupts IDs > Number.MAX_SAFE_INTEGER (2^53-1).
    const res = await client.get('/dsp/advertisers', {
      headers: { 'Amazon-Advertising-API-Scope': profileId },
      params: { pageSize: 100 },
      responseType: 'text',
      transformResponse: [data => data] // disable Axios auto-parse
    });
    const parsed = safeParse(res.data);
    const data = parsed?.response || parsed?.advertisers || parsed || [];
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.warn(`[DSP] fetchDspAdvertisers profile ${profileId}: ${err.message}`);
    return [];
  }
}

/**
 * Request a DSP report for a specific advertiser.
 */
async function requestDspReport(client, profileId, advertiserId, reportTypeId, groupBy, columns, startDate, endDate) {
  try {
    const res = await client.post('/reporting/reports', {
      name:      `DSP_${reportTypeId}_${advertiserId}_${startDate}`,
      startDate,
      endDate:   endDate || startDate,
      configuration: {
        adProduct:    'DEMAND_SIDE_PLATFORM',
        groupBy,
        columns,
        reportTypeId,
        timeUnit: 'DAILY',
        format:   'GZIP_JSON',
        filters:  [{ field: 'advertiserId', values: [advertiserId] }]
      }
    }, {
      headers: {
        'Amazon-Advertising-API-Scope': profileId,
        'Content-Type': 'application/vnd.createasyncreportrequest.v3+json',
        'Accept':        'application/vnd.createasyncreportrequest.v3+json'
      },
      transformRequest: [(data, headers) => {
        headers['Content-Type'] = 'application/vnd.createasyncreportrequest.v3+json';
        return JSON.stringify(data);
      }]
    });
    await sleep(2000);
    return res.data?.reportId;
  } catch (err) {
    if (err.response?.status === 425) {
      const match = (err.response?.data?.detail || '').match(/duplicate of\s*:\s*([\w-]+)/i);
      if (match?.[1]) return match[1];
    }
    if (err.response?.status === 429) await sleep(10000);
    throw err;
  }
}

/**
 * DSP report type definitions — 3 requests, all using reportTypeId: 'dspCampaign'.
 * This is the ONLY valid DSP v3 reportTypeId. Vary groupBy for different data grains.
 * timeUnit: DAILY returns one row per day across the full startDate→endDate window.
 *
 * Valid groupBy values: campaign, order, lineItem, audience, product, geography, supply, creative
 * DO NOT invent: dspOrder, dspLineItem, dspAudience, dspProduct — these are not valid reportTypeIds.
 */
// Validated against live API 2026-03-26
const DSP_REPORT_TYPES = [
  {
    key:          'dspCampaign',
    reportTypeId: 'dspCampaign',
    groupBy:      ['campaign'],
    columns:      [
      'date', 'orderId', 'orderName', 'orderBudget', 'orderStartDate', 'orderEndDate', 'orderCurrency',
      'advertiserId', 'advertiserName', 'entityId',
      'impressions', 'clicks', 'totalCost',
      'viewableImpressions', 'viewabilityRate',
      'detailPageViews', 'detailPageViewClicks',
      'addToCart', 'addToCartClicks',
      'purchases', 'purchasesClicks',
      'totalPurchases', 'totalPurchasesClicks',
      'sales', 'totalSales',
      'newToBrandPurchases', 'newToBrandPurchasesClicks', 'newToBrandProductSales',
    ],
  },
];

/**
 * Ingest DSP reports for all advertisers — range-based (one request per
 * advertiser per report type covering the full startDate→endDate window).
 * timeUnit: DAILY means Amazon returns one row per day in the response.
 *
 * Replaces the old day-by-day loop (was: daysBack calls per advertiser).
 * Now: 5 calls per advertiser for the full window.
 */
async function ingestDsp(clientId, connectionType, daysBack = 95) {
  return runJob(clientId, connectionType, 'dsp', async () => {
    const advertiserRows = await query(
      'SELECT advertiser_id, profile_id, name FROM dsp_advertiser WHERE is_active = TRUE'
    );
    if (!advertiserRows.length) return { recordsWritten: 0 };

    // Build advertiser_id → client_id lookup from dsp_advertiser_client_map.
    // Falls back to the triggering clientId if no mapping found.
    // This allows one agency-level sync to correctly route each advertiser's data
    // to the right client dashboard without cross-contamination.
    let advertiserClientMap = {};
    try {
      const mapRows = await query('SELECT advertiser_id, client_id FROM dsp_advertiser_client_map WHERE is_active = TRUE');
      for (const r of mapRows) {
        advertiserClientMap[String(r.ADVERTISER_ID || r.advertiser_id)] = r.CLIENT_ID || r.client_id;
      }
    } catch (err) {
      console.warn('[DSP] advertiser_client_map lookup failed, using default clientId:', err.message);
    }

    // Build 31-day windows (Amazon max range per request).
    // Use today as end date — Amazon has same-day data available.
    const today = new Date(); today.setUTCHours(0,0,0,0);
    const windows = [];
    for (let offset = 0; offset < daysBack; offset += 31) {
      const wEnd = new Date(today); wEnd.setUTCDate(wEnd.getUTCDate() - offset);
      const wStart = new Date(wEnd); wStart.setUTCDate(wStart.getUTCDate() - Math.min(30, daysBack-1-offset));
      windows.push({
        startDate: wStart.toISOString().split('T')[0],
        endDate:   wEnd.toISOString().split('T')[0]
      });
    }
    windows.reverse();

    // Rolling refresh: reset today's window (most recent) back to pending so
    // every 6-hour run re-fetches fresh same-day data from Amazon.
    const latestWindow = windows[windows.length - 1];
    const latestRangeKey = latestWindow.startDate.replace(/-/g,'') + '_' + latestWindow.endDate.replace(/-/g,'');
    try {
      const reset = await query(
        `UPDATE ads_report_queue SET status='pending', completed_at=NULL, error_message=NULL
         WHERE report_date=? AND report_type='dspCampaign' AND status='completed'`,
        [latestRangeKey]
      );
      const n = reset?.[0]?.['number of rows updated'] || 0;
      if (n > 0) console.log(`[DSP] Rolling refresh: reset ${n} completed reports for window ${latestRangeKey}`);
    } catch (err) {
      console.warn('[DSP] Rolling refresh reset failed (non-fatal):', err.message);
    }

    console.log(`[DSP] ${advertiserRows.length} advertisers, ${windows.length} windows × ${DSP_REPORT_TYPES.length} type`);
    let totalQueued = 0;

    for (const row of advertiserRows) {
      const advertiserId   = row.ADVERTISER_ID || row.advertiser_id;
      const profileId      = row.PROFILE_ID    || row.profile_id;
      const name           = row.NAME          || row.name;
      const queueProfileId = advertiserId + '|' + profileId;

      // Route this advertiser's data to the correct client dashboard.
      // Falls back to triggering clientId if no mapping exists.
      const targetClientId = advertiserClientMap[String(advertiserId)] || clientId;
      if (targetClientId !== clientId) {
        console.log(`[DSP] ${name} → routing to client ${targetClientId.slice(0,8)} (mapped)`);
      }

      for (const { startDate, endDate } of windows) {
        const windowKey = startDate.replace(/-/g,'') + '_' + endDate.replace(/-/g,'');

        for (const rt of DSP_REPORT_TYPES) {
          const existing = await query(
            'SELECT COUNT(*) as cnt FROM ads_report_queue WHERE client_id=? AND report_type=? AND report_date=? AND profile_id=? AND status IN (?,?)',
            [targetClientId, rt.key, windowKey, queueProfileId, 'pending', 'completed']
          );
          if (Number(existing[0]?.CNT||0) > 0) continue;

          try {
            const freshClient = await adsClient(clientId, connectionType);
            const reportId = await requestDspReport(freshClient, profileId, advertiserId,
              rt.reportTypeId, rt.groupBy, rt.columns, startDate, endDate);

            if (reportId) {
              await query(
                'INSERT INTO ads_report_queue (report_id,client_id,connection_type,profile_id,report_type,report_date,status,owner_client_id,requested_at) SELECT ?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP',
                [reportId, targetClientId, connectionType, queueProfileId, rt.key, windowKey, 'pending', clientId]
              );
              console.log(`[DSP] Queued ${name} ${startDate}→${endDate} (${reportId.substring(0,8)})`);
              totalQueued++;
            }
            await sleep(200);
          } catch (err) {
            console.warn(`[DSP] ${name} ${startDate}→${endDate}: ${err.message?.substring(0,100)}`);
          }
        }
      }
    }

    console.log(`[DSP] Queued ${totalQueued} reports total`);
    return { recordsWritten: 0, queued: totalQueued };
  });
}

module.exports = {
  // Core ingestion
  ingestCampaigns,
  ingestPerformance,
  ingestPerformanceRange,
  processReportQueue,
  ingestDsp,
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
