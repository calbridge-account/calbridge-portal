require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { query } = require('../src/services/snowflakeService');

async function main() {
  const clientId = '7d88ea17-002b-4a02-97fc-bcab1292d57e';

  // 1. What columns exist in dsp_campaign_report for sales?
  const cols = await query(`
    SELECT COLUMN_NAME, DATA_TYPE
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'APP'
      AND TABLE_NAME = 'DSP_CAMPAIGN_REPORT'
      AND (LOWER(COLUMN_NAME) LIKE '%sale%' OR LOWER(COLUMN_NAME) LIKE '%purchase%' OR LOWER(COLUMN_NAME) LIKE '%revenue%')
    ORDER BY ORDINAL_POSITION
  `);
  console.log('DSP campaign report sales columns:', cols.map(r => r.COLUMN_NAME).join(', '));

  const liCols = await query(`
    SELECT COLUMN_NAME, DATA_TYPE
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'APP'
      AND TABLE_NAME = 'DSP_LINE_ITEM_REPORT'
      AND (LOWER(COLUMN_NAME) LIKE '%sale%' OR LOWER(COLUMN_NAME) LIKE '%purchase%' OR LOWER(COLUMN_NAME) LIKE '%revenue%')
    ORDER BY ORDINAL_POSITION
  `);
  console.log('DSP line item report sales columns:', liCols.map(r => r.COLUMN_NAME).join(', '));

  // 2. Raw totals from each source (last 30 days)
  const cr30 = await query(`
    SELECT
      SUM(total_cost)                          AS spend,
      SUM(COALESCE(total_sales, 0))            AS total_sales,
      SUM(COALESCE(sales, 0))                  AS sales,
      SUM(COALESCE(total_purchases, 0))        AS total_purchases,
      SUM(COALESCE(purchases, 0))              AS purchases,
      SUM(COALESCE(new_to_brand_product_sales, 0)) AS ntb_sales
    FROM CALBRIDGE_PROD.APP.dsp_campaign_report
    WHERE client_id = ? AND date >= DATEADD('day', -30, CURRENT_DATE())
  `, [clientId]);
  console.log('\ndsp_campaign_report (last 30d):', JSON.stringify(cr30[0], null, 2));

  const li30 = await query(`
    SELECT
      SUM(total_cost)                          AS spend,
      SUM(COALESCE(total_sales, 0))            AS total_sales,
      SUM(COALESCE(sales, 0))                  AS sales,
      SUM(COALESCE(total_purchases, 0))        AS total_purchases,
      SUM(COALESCE(purchases, 0))              AS purchases
    FROM CALBRIDGE_PROD.APP.dsp_line_item_report
    WHERE client_id = ? AND date >= DATEADD('day', -30, CURRENT_DATE())
  `, [clientId]);
  console.log('\ndsp_line_item_report (last 30d):', JSON.stringify(li30[0], null, 2));

  // 3. What does ACP currently return for DSP?
  const acp = await query(`
    SELECT
      SUM(spend) AS spend,
      SUM(sales) AS sales,
      SUM(orders) AS orders
    FROM CALBRIDGE_PROD.APP.adjusted_campaign_performance
    WHERE client_id = ? AND ad_type = 'DSP'
      AND date >= DATEADD('day', -30, CURRENT_DATE())
  `, [clientId]);
  console.log('\nACP DSP (last 30d):', JSON.stringify(acp[0], null, 2));

  // 4. Per-order breakdown to see where sales are coming from
  const byOrder = await query(`
    SELECT
      campaign_name,
      SUM(spend) AS spend,
      SUM(sales) AS sales,
      SUM(orders) AS orders
    FROM CALBRIDGE_PROD.APP.adjusted_campaign_performance
    WHERE client_id = ? AND ad_type = 'DSP'
      AND date >= DATEADD('day', -30, CURRENT_DATE())
    GROUP BY campaign_name
    ORDER BY sales DESC
  `, [clientId]);
  console.log('\nACP DSP by order (last 30d):');
  byOrder.forEach(r => console.log(`  ${r.CAMPAIGN_NAME?.substring(0,50)} | spend: ${Number(r.SPEND||0).toFixed(0)} | sales: ${Number(r.SALES||0).toFixed(0)}`));
  console.log('  TOTAL sales:', byOrder.reduce((s,r)=>s+Number(r.SALES||0),0).toFixed(2));

  // 5. What columns does CAMPAIGN_PERFORMANCE view actually pass through?
  const cpCols = await query(`
    SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'APP' AND TABLE_NAME = 'CAMPAIGN_PERFORMANCE'
      AND (LOWER(COLUMN_NAME) LIKE '%sale%' OR LOWER(COLUMN_NAME) LIKE '%purchase%')
    ORDER BY ORDINAL_POSITION
  `);
  console.log('\nCAMPAIGN_PERFORMANCE view sales cols:', cpCols.map(r=>r.COLUMN_NAME).join(', '));

  // 6. What does dsp_campaign_report have per order for total_sales vs sales?
  const crByOrder = await query(`
    SELECT order_name,
      SUM(total_cost) AS spend,
      SUM(COALESCE(total_sales,0)) AS total_sales,
      SUM(COALESCE(sales,0)) AS sales_col,
      SUM(COALESCE(total_sales, sales, 0)) AS coalesced
    FROM CALBRIDGE_PROD.APP.dsp_campaign_report
    WHERE client_id = ? AND date >= DATEADD('day', -30, CURRENT_DATE())
    GROUP BY order_name ORDER BY coalesced DESC
  `, [clientId]);
  console.log('\ndsp_campaign_report per order — total_sales vs sales col (last 30d):');
  crByOrder.forEach(r => console.log(`  ${r.ORDER_NAME?.substring(0,50)} | spend: ${Number(r.SPEND||0).toFixed(0)} | total_sales: ${Number(r.TOTAL_SALES||0).toFixed(0)} | sales_col: ${Number(r.SALES_COL||0).toFixed(0)} | coalesced: ${Number(r.COALESCED||0).toFixed(0)}`));

  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
