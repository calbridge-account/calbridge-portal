/**
 * src/config/sourceMapping.js
 *
 * Canonical name mapping layer — translates source-system field names to
 * Calbridge internal (canonical) field names, and vice versa.
 *
 * When a new data source arrives (Walmart, Shopify, Google Ads, etc.),
 * add its mapping here. The rest of the pipeline uses canonical names only.
 *
 * Source-of-truth hierarchy (from architecture/platform-architecture.md):
 *   1. Amazon Ads API  > derived calculations       (spend, impressions, clicks)
 *   2. SP-API retail   > Ads-attributed sales        (actual order revenue)
 *   3. Client COGS     > estimated COGS              (margin calculations)
 *   4. CANONICAL.*     > RAW_* staging               (all reporting — never query RAW_*)
 *   5. Retail revenue  > Ads-attributed sales        (when sources disagree)
 *
 * Usage:
 *   const { normalizeToCanonical, denormalizeFromCanonical, MAPS } = require('./sourceMapping');
 *
 *   // Normalize a raw Amazon Ads campaign record to canonical shape
 *   const canonical = normalizeToCanonical(rawRecord, 'amazon_ads', 'campaign');
 *
 *   // Get a field map directly
 *   const fieldName = MAPS.amazon_ads.campaign['campaignId']; // → 'amazon_campaign_id'
 */

'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// AMAZON ADS — Campaign Mapping
// Source: Amazon Advertising API v3 SP/SB/SD campaign reports
// ─────────────────────────────────────────────────────────────────────────────

const AMAZON_ADS_CAMPAIGN_MAP = {
  // Identifiers
  campaignId:                          'amazon_campaign_id',
  portfolioId:                         'amazon_portfolio_id',

  // Metadata
  campaignName:                        'name',
  campaignStatus:                      'status',
  campaignBudgetAmount:                'daily_budget',
  campaignBudgetType:                  'budget_type',
  campaignBudgetCurrencyCode:          'currency_code',
  campaignBiddingStrategy:             'bidding_strategy',
  startDate:                           'start_date',
  endDate:                             'end_date',

  // Performance (daily grain — goes to ANALYTICS.ADS_PERFORMANCE, not CANONICAL.CAMPAIGNS)
  impressions:                         'impressions',
  clicks:                              'clicks',
  cost:                                'cost',

  // Attribution windows (30d is canonical standard)
  purchases30d:                        'purchases_30d',
  purchases14d:                        'purchases_14d',
  purchases7d:                         'purchases_7d',
  purchases1d:                         'purchases_1d',
  sales30d:                            'sales_30d',
  sales14d:                            'sales_14d',
  sales7d:                             'sales_7d',
  sales1d:                             'sales_1d',
  unitsSoldClicks30d:                  'units_sold_30d',

  // New to brand
  newToBrandPurchases:                 'new_to_brand_purchases',
  newToBrandSales:                     'new_to_brand_sales',

  // Engagement
  detailPageViews:                     'detail_page_views',
  addToCart:                           'add_to_cart',
  topOfSearchImpressionShare:          'top_of_search_impression_share',
};


// ─────────────────────────────────────────────────────────────────────────────
// AMAZON ADS — Ad Group Mapping
// ─────────────────────────────────────────────────────────────────────────────

const AMAZON_ADS_AD_GROUP_MAP = {
  adGroupId:                           'amazon_ad_group_id',
  campaignId:                          'amazon_campaign_id',
  adGroupName:                         'name',
  adStatus:                            'status',
  // Performance fields same as campaign level
  impressions:                         'impressions',
  clicks:                              'clicks',
  cost:                                'cost',
  purchases30d:                        'purchases_30d',
  sales30d:                            'sales_30d',
  unitsSoldClicks30d:                  'units_sold_30d',
};


// ─────────────────────────────────────────────────────────────────────────────
// AMAZON ADS — Keyword/Target Mapping
// ─────────────────────────────────────────────────────────────────────────────

const AMAZON_ADS_KEYWORD_MAP = {
  keywordId:                           'amazon_keyword_id',
  targetId:                            'amazon_target_id',
  campaignId:                          'amazon_campaign_id',
  adGroupId:                           'amazon_ad_group_id',
  keyword:                             'keyword_text',
  matchType:                           'match_type',
  targeting:                           'target_expression',
  adKeywordStatus:                     'status',
  keywordBid:                          'bid',
  // Performance
  impressions:                         'impressions',
  clicks:                              'clicks',
  cost:                                'cost',
  purchases30d:                        'purchases_30d',
  sales30d:                            'sales_30d',
};


// ─────────────────────────────────────────────────────────────────────────────
// AMAZON ADS — Advertised Product (ASIN-level) Mapping
// ─────────────────────────────────────────────────────────────────────────────

const AMAZON_ADS_PRODUCT_MAP = {
  advertisedAsin:                      'asin',
  advertisedSku:                       'sku',
  campaignId:                          'amazon_campaign_id',
  adGroupId:                           'amazon_ad_group_id',
  adId:                                'amazon_ad_id',
  // Performance
  impressions:                         'impressions',
  clicks:                              'clicks',
  cost:                                'cost',
  purchases30d:                        'purchases_30d',
  purchases14d:                        'purchases_14d',
  purchases7d:                         'purchases_7d',
  purchases1d:                         'purchases_1d',
  sales30d:                            'sales_30d',
  sales14d:                            'sales_14d',
  sales7d:                             'sales_7d',
  sales1d:                             'sales_1d',
  unitsSoldClicks30d:                  'units_sold_30d',
  unitsSoldOtherSku7d:                 'units_sold_other_sku_7d',
  salesOtherSku7d:                     'sales_other_sku_7d',
};


// ─────────────────────────────────────────────────────────────────────────────
// SP-API — Listings Mapping
// Source: Amazon Selling Partner API catalog/listings
// ─────────────────────────────────────────────────────────────────────────────

const SP_API_LISTINGS_MAP = {
  asin:                                'asin',
  sellerSku:                           'sku',
  itemName:                            'item_name',
  brand:                               'brand',
  browseClassification:                'category',
  productType:                         'product_type',
  status:                              'status',
  fulfillmentChannel:                  'fulfillment_channel',
  price:                               'price',
  currency:                            'currency_code',
  salesRank:                           'sales_rank',
  salesRankCategory:                   'sales_rank_category',
  parentAsin:                          'parent_asin',
};


// ─────────────────────────────────────────────────────────────────────────────
// SP-API — FBA Inventory Mapping
// ─────────────────────────────────────────────────────────────────────────────

const SP_API_INVENTORY_MAP = {
  asin:                                'asin',
  sellerSku:                           'sku',
  fnSku:                               'fn_sku',
  condition:                           'condition_type',
  fulfillableQuantity:                 'fulfillable_quantity',
  inboundWorkingQuantity:              'inbound_working_quantity',
  inboundShippedQuantity:              'inbound_shipped_quantity',
  inboundReceivingQuantity:            'inbound_receiving_quantity',
  reservedQuantity:                    'reserved_quantity',
  unfulfillableQuantity:               'unfulfillable_quantity',
  totalQuantity:                       'total_quantity',
  yourPrice:                           'your_price',
  estimatedDaysOfSupply30d:            'days_of_supply_30d',
  estimatedDaysOfSupply90d:            'days_of_supply_90d',
};


// ─────────────────────────────────────────────────────────────────────────────
// SP-API — Sales Traffic Mapping
// ─────────────────────────────────────────────────────────────────────────────

const SP_API_SALES_TRAFFIC_MAP = {
  asin:                                'asin',
  date:                                'date',
  orderedProductSales:                 'ordered_revenue',
  totalOrderItems:                     'total_order_items',
  unitsOrdered:                        'units_ordered',
  unitsRefunded:                       'units_refunded',
  unitsShipped:                        'units_shipped',
  sessions:                            'sessions',
  pageViews:                           'page_views',
  buyBoxPercentage:                    'buy_box_percentage',
  unitSessionPercentage:               'unit_session_percentage',
  orderedProductSalesB2b:              'ordered_revenue_b2b',
  unitsOrderedB2b:                     'units_ordered_b2b',
  sessionsB2b:                         'sessions_b2b',
};


// ─────────────────────────────────────────────────────────────────────────────
// WALMART (future) — Campaign Mapping stub
// Extend when Walmart Connect integration is added
// ─────────────────────────────────────────────────────────────────────────────

const WALMART_CAMPAIGN_MAP = {
  campaignId:                          'external_campaign_id',
  campaignName:                        'name',
  campaignStatus:                      'status',
  totalBudget:                         'daily_budget',
  startDate:                           'start_date',
  endDate:                             'end_date',
};


// ─────────────────────────────────────────────────────────────────────────────
// Master map registry
// ─────────────────────────────────────────────────────────────────────────────

const MAPS = {
  amazon_ads: {
    campaign:        AMAZON_ADS_CAMPAIGN_MAP,
    ad_group:        AMAZON_ADS_AD_GROUP_MAP,
    keyword_target:  AMAZON_ADS_KEYWORD_MAP,
    product:         AMAZON_ADS_PRODUCT_MAP,
  },
  sp_api: {
    product:         SP_API_LISTINGS_MAP,
    inventory:       SP_API_INVENTORY_MAP,
    sales_traffic:   SP_API_SALES_TRAFFIC_MAP,
  },
  walmart: {
    campaign:        WALMART_CAMPAIGN_MAP,
  },
};


// ─────────────────────────────────────────────────────────────────────────────
// normalizeToCanonical(sourceRecord, sourceSystem, entityType)
//
// Translates a source record to canonical field names.
// Unmapped fields are preserved under their original names with a `_raw_` prefix.
//
// @param {Object} sourceRecord   - Raw record from source system
// @param {string} sourceSystem   - 'amazon_ads' | 'sp_api' | 'walmart' | ...
// @param {string} entityType     - 'campaign' | 'ad_group' | 'keyword_target' | 'product' | ...
// @returns {Object}              - Canonical-shaped record
// ─────────────────────────────────────────────────────────────────────────────

function normalizeToCanonical(sourceRecord, sourceSystem, entityType) {
  if (!sourceRecord || typeof sourceRecord !== 'object') {
    throw new TypeError(`normalizeToCanonical: sourceRecord must be an object, got ${typeof sourceRecord}`);
  }

  const entityMap = MAPS[sourceSystem]?.[entityType];
  if (!entityMap) {
    // Unknown source/entity — return as-is with metadata attached
    console.warn(`[sourceMapping] No map found for ${sourceSystem}.${entityType} — returning raw record`);
    return {
      ...sourceRecord,
      _source_system: sourceSystem,
      _entity_type: entityType,
      _normalized: false,
    };
  }

  const canonical = {
    _source_system: sourceSystem,
    _entity_type: entityType,
    _normalized: true,
  };

  for (const [sourceField, sourceValue] of Object.entries(sourceRecord)) {
    const canonicalField = entityMap[sourceField];
    if (canonicalField) {
      canonical[canonicalField] = sourceValue;
    } else {
      // Preserve unmapped fields with prefix so nothing is silently dropped
      canonical[`_raw_${sourceField}`] = sourceValue;
    }
  }

  return canonical;
}


// ─────────────────────────────────────────────────────────────────────────────
// denormalizeFromCanonical(canonicalRecord, targetSystem, entityType)
//
// Reverse mapping: canonical field names → target system field names.
// Useful for writing back to source systems (bid changes, budget updates, etc.)
//
// @param {Object} canonicalRecord - Canonical-shaped record
// @param {string} targetSystem    - 'amazon_ads' | 'sp_api' | 'walmart' | ...
// @param {string} entityType      - 'campaign' | 'ad_group' | 'keyword_target' | ...
// @returns {Object}               - Source-system-shaped record
// ─────────────────────────────────────────────────────────────────────────────

function denormalizeFromCanonical(canonicalRecord, targetSystem, entityType) {
  if (!canonicalRecord || typeof canonicalRecord !== 'object') {
    throw new TypeError(`denormalizeFromCanonical: canonicalRecord must be an object`);
  }

  const entityMap = MAPS[targetSystem]?.[entityType];
  if (!entityMap) {
    throw new Error(`[sourceMapping] No map found for ${targetSystem}.${entityType}`);
  }

  // Build reverse map: canonical → source
  const reverseMap = Object.fromEntries(
    Object.entries(entityMap).map(([src, canon]) => [canon, src])
  );

  const source = {};
  for (const [canonicalField, value] of Object.entries(canonicalRecord)) {
    // Skip internal metadata fields
    if (canonicalField.startsWith('_')) continue;

    const sourceField = reverseMap[canonicalField];
    if (sourceField) {
      source[sourceField] = value;
    }
    // Canonical fields with no reverse mapping are dropped (read-only derived fields)
  }

  return source;
}


// ─────────────────────────────────────────────────────────────────────────────
// getFieldMap(sourceSystem, entityType)
//
// Returns the raw field map for programmatic inspection.
// ─────────────────────────────────────────────────────────────────────────────

function getFieldMap(sourceSystem, entityType) {
  return MAPS[sourceSystem]?.[entityType] ?? null;
}


// ─────────────────────────────────────────────────────────────────────────────
// normalizeMany(records, sourceSystem, entityType)
//
// Batch normalize an array of source records.
// ─────────────────────────────────────────────────────────────────────────────

function normalizeMany(records, sourceSystem, entityType) {
  if (!Array.isArray(records)) {
    throw new TypeError(`normalizeMany: records must be an array`);
  }
  return records.map(r => normalizeToCanonical(r, sourceSystem, entityType));
}


module.exports = {
  // Maps (for direct inspection / testing)
  MAPS,
  AMAZON_ADS_CAMPAIGN_MAP,
  AMAZON_ADS_AD_GROUP_MAP,
  AMAZON_ADS_KEYWORD_MAP,
  AMAZON_ADS_PRODUCT_MAP,
  SP_API_LISTINGS_MAP,
  SP_API_INVENTORY_MAP,
  SP_API_SALES_TRAFFIC_MAP,
  WALMART_CAMPAIGN_MAP,

  // Functions
  normalizeToCanonical,
  denormalizeFromCanonical,
  normalizeMany,
  getFieldMap,
};
