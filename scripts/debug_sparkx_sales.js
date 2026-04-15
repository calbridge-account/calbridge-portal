require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { query } = require('../src/services/snowflakeService');

async function main() {
  const clientId = '7d88ea17-002b-4a02-97fc-bcab1292d57e';
  const monthStart = '2026-04-01';
  const sparkxOrderIds = [
    '577791050225926400','582993263973926300','582911732508457200',
    '586368505524283400','577512736499291100','577121841661811200'
  ];
  const inClause = sparkxOrderIds.map(() => '?').join(',');

  // What does current ACP view return for SparkX orders in April?
  const acpSparkx = await query(`
    SELECT campaign_id, MAX(campaign_name) AS name, SUM(spend) AS spend, SUM(sales) AS sales
    FROM CALBRIDGE_PROD.APP.adjusted_campaign_performance
    WHERE client_id = ? AND date >= ?
      AND campaign_id IN (${inClause})
    GROUP BY campaign_id ORDER BY sales DESC
  `, [clientId, monthStart, ...sparkxOrderIds]);
  console.log('SparkX orders in current ACP view (April):');
  acpSparkx.forEach(r => console.log(' ', r.CAMPAIGN_ID, r.NAME?.substring(0,45),
    '| spend:', Number(r.SPEND||0).toFixed(2), '| sales:', Number(r.SALES||0).toFixed(2)));

  // campaign_report for these orders
  const cr = await query(`
    SELECT order_id, order_name, SUM(total_cost) AS spend, SUM(COALESCE(total_sales,sales,0)) AS sales
    FROM CALBRIDGE_PROD.APP.dsp_campaign_report
    WHERE client_id = ? AND date >= ? AND order_id IN (${inClause})
    GROUP BY order_id, order_name
  `, [clientId, monthStart, ...sparkxOrderIds]);

  // line_item_report for these orders
  const li = await query(`
    SELECT order_id, order_name, SUM(total_cost) AS spend, SUM(COALESCE(total_sales,sales,0)) AS sales
    FROM CALBRIDGE_PROD.APP.dsp_line_item_report
    WHERE client_id = ? AND date >= ? AND order_id IN (${inClause})
    GROUP BY order_id, order_name
  `, [clientId, monthStart, ...sparkxOrderIds]);

  const crMap = Object.fromEntries(cr.map(r => [String(r.ORDER_ID), { spend: Number(r.SPEND||0), sales: Number(r.SALES||0) }]));
  const liMap = Object.fromEntries(li.map(r => [String(r.ORDER_ID), { spend: Number(r.SPEND||0), sales: Number(r.SALES||0) }]));

  console.log('\nPer-order: cr vs li vs current view (April):');
  let totalCrSales = 0, totalLiSales = 0, totalAcpSales = 0;
  const acpMap = Object.fromEntries(acpSparkx.map(r => [String(r.CAMPAIGN_ID), Number(r.SALES||0)]));
  sparkxOrderIds.forEach(id => {
    const c = crMap[id] || { spend: 0, sales: 0 };
    const l = liMap[id] || { spend: 0, sales: 0 };
    const acp = acpMap[id] || 0;
    const best = Math.max(c.sales, l.sales);
    totalCrSales += c.sales; totalLiSales += l.sales; totalAcpSales += acp;
    console.log(' ', id,
      '| cr_sales:', c.sales.toFixed(0),
      '| li_sales:', l.sales.toFixed(0),
      '| acp_now:', acp.toFixed(0),
      '| best_would_be:', best.toFixed(0),
      c.sales !== l.sales ? (c.sales > l.sales ? '<-- cr wins' : '<-- li wins') : '(same)');
  });
  console.log('\nTOTALS | cr_sales:', totalCrSales.toFixed(2), '| li_sales:', totalLiSales.toFixed(2), '| acp_now:', totalAcpSales.toFixed(2));

  // Also check: what is total DSP sales in ACP view right now for April?
  const totalDsp = await query(`
    SELECT SUM(spend) AS spend, SUM(sales) AS sales
    FROM CALBRIDGE_PROD.APP.adjusted_campaign_performance
    WHERE client_id = ? AND ad_type = 'DSP' AND date >= ?
  `, [clientId, monthStart]);
  console.log('\nTotal DSP in ACP view (April) — spend:', Number(totalDsp[0].SPEND||0).toFixed(2), '| sales:', Number(totalDsp[0].SALES||0).toFixed(2));

  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
