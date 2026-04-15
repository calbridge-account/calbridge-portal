require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { query } = require('../src/services/snowflakeService');

async function main() {
  const clientId = '7d88ea17-002b-4a02-97fc-bcab1292d57e';
  const monthStart = '2026-04-01';
  // SparkX order with biggest discrepancy: 582993263973926300
  const orderId = '582993263973926300';

  const cr = await query(`
    SELECT date, total_cost, COALESCE(total_sales, sales, 0) AS sales
    FROM CALBRIDGE_PROD.APP.dsp_campaign_report
    WHERE client_id = ? AND order_id = ? AND date >= ?
    ORDER BY date
  `, [clientId, orderId, monthStart]);
  console.log('dsp_campaign_report daily (order 582993):');
  cr.forEach(r => console.log(' ', String(r.DATE).substring(0,10), '| cost:', Number(r.TOTAL_COST).toFixed(4), '| sales:', Number(r.SALES).toFixed(2)));

  const li = await query(`
    SELECT date, total_cost, COALESCE(total_sales, sales, 0) AS sales
    FROM CALBRIDGE_PROD.APP.dsp_line_item_report
    WHERE client_id = ? AND order_id = ? AND date >= ?
    ORDER BY date
  `, [clientId, orderId, monthStart]);
  console.log('\ndsp_line_item_report daily (order 582993):');
  li.forEach(r => console.log(' ', String(r.DATE).substring(0,10), '| cost:', Number(r.TOTAL_COST).toFixed(4), '| sales:', Number(r.SALES).toFixed(2)));

  // What does current ACP view return for this order?
  const acp = await query(`
    SELECT date, spend, sales
    FROM CALBRIDGE_PROD.APP.adjusted_campaign_performance
    WHERE client_id = ? AND campaign_id = ? AND date >= ?
    ORDER BY date
  `, [clientId, orderId, monthStart]);
  console.log('\nACP view daily (order 582993):');
  acp.forEach(r => console.log(' ', String(r.DATE).substring(0,10), '| spend:', Number(r.SPEND||0).toFixed(4), '| sales:', Number(r.SALES||0).toFixed(2)));
  console.log('ACP total:', acp.reduce((s,r) => s + Number(r.SALES||0), 0).toFixed(2));

  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
