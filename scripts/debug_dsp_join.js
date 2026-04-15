require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { query } = require('../src/services/snowflakeService');

async function main() {
  const clientId = '7d88ea17-002b-4a02-97fc-bcab1292d57e';
  const monthStart = '2026-04-01';

  // Check what the subquery joins actually return for SparkX orders
  const rows = await query(`
    SELECT
      c.order_id,
      c.order_name,
      co.total_sales_cr,
      lo.total_sales_li,
      CASE
        WHEN COALESCE(lo.total_sales_li, 0) > COALESCE(co.total_sales_cr, 0)
          AND COALESCE(co.total_sales_cr, 0) > 0
          THEN 'li_wins_scale'
        ELSE 'cr_wins'
      END AS winner
    FROM CALBRIDGE_PROD.APP.dsp_campaign_report c
    LEFT JOIN (
      SELECT client_id, order_id, SUM(COALESCE(total_sales, sales, 0)) AS total_sales_cr
      FROM CALBRIDGE_PROD.APP.dsp_campaign_report
      GROUP BY client_id, order_id
    ) co ON co.client_id = c.client_id AND co.order_id = c.order_id
    LEFT JOIN (
      SELECT client_id, order_id, SUM(COALESCE(total_sales, sales, 0)) AS total_sales_li
      FROM CALBRIDGE_PROD.APP.dsp_line_item_report
      GROUP BY client_id, order_id
    ) lo ON lo.client_id = c.client_id AND lo.order_id = c.order_id
    WHERE c.client_id = ? AND c.date >= ?
    GROUP BY c.order_id, c.order_name, co.total_sales_cr, lo.total_sales_li
    ORDER BY COALESCE(co.total_sales_cr, 0) DESC
  `, [clientId, monthStart]);

  console.log('Join results for April:');
  rows.forEach(r => console.log(
    ' ', r.ORDER_ID, r.ORDER_NAME?.substring(0,40),
    '| cr_total:', Number(r.TOTAL_SALES_CR||0).toFixed(0),
    '| li_total:', Number(r.TOTAL_SALES_LI||0).toFixed(0),
    '|', r.WINNER
  ));

  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
