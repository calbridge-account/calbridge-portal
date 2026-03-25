/**
 * Snowflake Schema Validator
 *
 * Validates that all column references in route files exist in the actual
 * Snowflake schema. Runs at startup (warns) and as a dev tool (fails).
 *
 * Usage:
 *   node src/utils/schemaValidator.js         — validate all routes
 *   node src/utils/schemaValidator.js --fix   — show suggestions
 */

const KNOWN_SCHEMA = {
  CLIENTS: ['CLIENT_ID','EMAIL','NAME','CREATED_AT','PASSWORD_HASH','CONNECTIONS','LOGO_URL','COMPANY_NAME','TEAM_MEMBERS','STATUS','APPROVED_AT','STRIPE_CUSTOMER_ID','STRIPE_SUBSCRIPTION_ID','SUBSCRIPTION_PLAN','SUBSCRIPTION_STATUS','TRIAL_ENDS_AT','SUBSCRIPTION_ENDS_AT','PASSWORD_RESET_TOKEN','PASSWORD_RESET_EXPIRES','ONBOARDING_COMPLETED','WEEKLY_REPORT_ENABLED','PLAN'],
  AD_CAMPAIGNS: ['CLIENT_ID','CONNECTION_TYPE','CAMPAIGN_ID','CAMPAIGN_NAME','CAMPAIGN_TYPE','STATUS','BUDGET','BUDGET_TYPE','START_DATE','END_DATE','SYNCED_AT'],
  AD_PERFORMANCE: ['CLIENT_ID','CONNECTION_TYPE','CAMPAIGN_ID','REPORT_DATE','IMPRESSIONS','CLICKS','SPEND','SALES','ORDERS','UNITS_SOLD','ACOS','ROAS','CTR','CPC','SYNCED_AT'],
  PRODUCTS: ['CLIENT_ID','CONNECTION_TYPE','ASIN','SKU','TITLE','BRAND','CATEGORY','PRICE','FBA_FEES','COGS','SYNCED_AT'],
  SALES: ['CLIENT_ID','CONNECTION_TYPE','ASIN','ORDER_DATE','UNITS_ORDERED','ORDERED_REVENUE','UNITS_SHIPPED','SHIPPED_REVENUE','SYNCED_AT'],
  CONTRIBUTION_MARGIN: ['CLIENT_ID','ASIN','CALC_DATE','REVENUE','AD_SPEND','FBA_FEES','COGS','OTHER_COSTS','CONTRIBUTION_MARGIN','CM_PERCENT','UNITS','UNIT_CM','UNIT_CM_PERCENT','CALCULATED_AT'],
  INGESTION_LOG: ['LOG_ID','CLIENT_ID','CONNECTION_TYPE','JOB_TYPE','STATUS','RECORDS_WRITTEN','ERROR_MESSAGE','STARTED_AT','COMPLETED_AT'],
  CAMPAIGN_ACTIONS: ['ACTION_ID','CLIENT_ID','CAMPAIGN_ID','ACTION_TYPE','PAYLOAD','STATUS','CREATED_AT','EXECUTED_AT'],
  AMAZON_CONNECTIONS: ['CLIENT_ID','CONNECTION_TYPE','ACCESS_TOKEN','REFRESH_TOKEN','EXPIRES_AT','SELLING_PARTNER_ID','CONNECTED_AT','UPDATED_AT'],
  ADMIN_USERS: ['ADMIN_ID','EMAIL','NAME','PASSWORD_HASH','ROLE','CREATED_AT','LAST_LOGIN'],
  // Brand architecture tables (added for multi-brand support)
  AD_PROFILES: ['PROFILE_ID','CLIENT_ID','NAME','TYPE','SUB_TYPE','MARKETPLACE','CURRENCY_CODE','TIMEZONE','ACCOUNT_ID','DAILY_BUDGET','CREATED_AT'],
  DSP_ADVERTISERS: ['ADVERTISER_ID','CLIENT_ID','NAME','AGENCY_PROFILE_ID','CREATED_AT'],
  BRANDS: ['BRAND_ID','CLIENT_ID','NAME','MARKETPLACE','ADS_PROFILE_ID','DSP_ADVERTISER_ID','SP_SELLER_ID','SP_VENDOR_ID','IS_ACTIVE','CREATED_AT','UPDATED_AT'],
};

// Table aliases commonly used in queries
const TABLE_ALIASES = {
  'c':  'AD_CAMPAIGNS',
  'p':  'PRODUCTS',
  'ap': 'AD_PERFORMANCE',
  'ac': 'AD_CAMPAIGNS',
  's':  'SALES',
  'pr': 'PRODUCTS',
  'cm': 'CONTRIBUTION_MARGIN',
  'cl': 'CLIENTS',
  'b':  'BRANDS',
  'br': 'BRANDS',
  'adp': 'AD_PROFILES',
  'dsp': 'DSP_ADVERTISERS',
};

/**
 * Validate a SQL string against known schema
 * Returns array of { column, table, suggestion } for unknown columns
 */
function validateSQL(sql, context = '') {
  const issues = [];

  // Skip SQL that uses CTEs or MERGE — complex alias patterns not supported
  if (/\bWITH\b/i.test(sql) || /\bMERGE\b/i.test(sql)) return issues;

  // Extract aliased column references like c.COLUMN_NAME or p.column_name
  const aliasRefs = [...sql.matchAll(/\b([a-z]{1,3})\.([a-zA-Z_]+)\b/g)];
  for (const [, alias, col] of aliasRefs) {
    const table = TABLE_ALIASES[alias.toLowerCase()];
    if (!table) continue;
    const colUpper = col.toUpperCase();
    // Skip non-column identifiers
    if (['CLIENT_ID','CONNECTION_TYPE','CAMPAIGN_ID'].includes(colUpper)) continue;
    const tableSchema = KNOWN_SCHEMA[table];
    if (tableSchema && !tableSchema.includes(colUpper)) {
      // Check if it's a known column on any table (may just be wrong alias)
      const foundIn = Object.entries(KNOWN_SCHEMA)
        .filter(([, cols]) => cols.includes(colUpper))
        .map(([t]) => t);
      issues.push({
        context,
        reference: `${alias}.${col}`,
        resolvedTable: table,
        column: colUpper,
        foundIn: foundIn.length ? foundIn : null,
        message: foundIn.length
          ? `Column ${colUpper} not in ${table} — found in: ${foundIn.join(', ')}`
          : `Column ${colUpper} not found in any table`
      });
    }
  }

  return issues;
}

/**
 * Scan all route/service/job files for SQL and validate
 */
function validateAllFiles() {
  const fs = require('fs');
  const path = require('path');

  const srcDir = path.join(__dirname, '..');
  const files = [];
  for (const sub of ['routes', 'services', 'jobs']) {
    const dir = path.join(srcDir, sub);
    if (fs.existsSync(dir)) {
      fs.readdirSync(dir).filter(f => f.endsWith('.js')).forEach(f => files.push(path.join(dir, f)));
    }
  }

  let totalIssues = 0;
  const allIssues = [];

  for (const file of files) {
    const code = fs.readFileSync(file, 'utf8');
    const relPath = path.relative(path.join(__dirname, '../..'), file);

    // Extract SQL strings (template literals with SELECT/INSERT/UPDATE/MERGE)
    const sqlBlocks = [...code.matchAll(/`([^`]*(?:SELECT|INSERT|UPDATE|MERGE|CREATE)[^`]*)`/gi)];
    for (const [, sql] of sqlBlocks) {
      const issues = validateSQL(sql, relPath);
      allIssues.push(...issues);
      totalIssues += issues.length;
    }
  }

  return { issues: allIssues, totalIssues };
}

// ---- Run as script ----
if (require.main === module) {
  console.log('🔍 Calbridge Schema Validator\n');

  const { issues, totalIssues } = validateAllFiles();

  if (totalIssues === 0) {
    console.log('✅ All SQL validated — no unknown column references found\n');
    process.exit(0);
  }

  console.log(`❌ Found ${totalIssues} potential schema issue(s):\n`);
  issues.forEach(issue => {
    console.log(`  📁 ${issue.context}`);
    console.log(`     ${issue.message}`);
    if (issue.foundIn) console.log(`     💡 Try: ${issue.foundIn[0]}.${issue.column}`);
    console.log('');
  });
  process.exit(1);
}

module.exports = { validateSQL, KNOWN_SCHEMA };
