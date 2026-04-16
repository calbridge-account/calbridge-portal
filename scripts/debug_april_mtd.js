require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { query } = require('../src/services/snowflakeService');

async function main() {
  const clientId = '7d88ea17-002b-4a02-97fc-bcab1292d57e';
  const monthStart = '2026-04-01';

  // 1. ACP April MTD by ad type
  const acpMtd = await query(`
    SELECT ad_type,
      SUM(adjusted_spend) AS spend,
      SUM(sales)          AS sales,
      SUM(orders)         AS orders,
      MIN(date)           AS first_date,
      MAX(date)           AS last_date
    FROM CALBRIDGE_PROD.APP.adjusted_campaign_performance
    WHERE client_id = ? AND date >= ?
    GROUP BY ad_type ORDER BY spend DESC
  `, [clientId, monthStart]);
  console.log('=== ACP April MTD (source of truth) ===');
  let totalSpend = 0, totalSales = 0;
  acpMtd.forEach(r => {
    totalSpend += Number(r.SPEND||0);
    totalSales += Number(r.SALES||0);
    console.log(`  ${r.AD_TYPE}: spend=$${Number(r.SPEND||0).toFixed(0)}, sales=$${Number(r.SALES||0).toFixed(0)}, orders=${r.ORDERS} | ${String(r.FIRST_DATE).substring(0,10)} → ${String(r.LAST_DATE).substring(0,10)}`);
  });
  console.log(`  TOTAL: spend=$${totalSpend.toFixed(0)}, sales=$${totalSales.toFixed(0)}`);

  // 2. What the dashboard overview shows (mart_advertising_daily, MTD)
  const martMtd = await query(`
    SELECT ad_type, SUM(spend) AS spend, SUM(sales) AS sales
    FROM CALBRIDGE_PROD.MARTS_MARTS.mart_advertising_daily
    WHERE client_id = ? AND date >= ?
    GROUP BY ad_type ORDER BY spend DESC
  `, [clientId, monthStart]);
  console.log('\n=== Mart April MTD (dashboard overview) ===');
  martMtd.forEach(r => console.log(`  ${r.AD_TYPE}: spend=$${Number(r.SPEND||0).toFixed(0)}, sales=$${Number(r.SALES||0).toFixed(0)}`));

  // 3. What the dashboard /dashboard/kpis route shows
  // It uses mart_advertising_daily for ad attributed sales
  const dashKpi = await query(`
    SELECT SUM(spend) AS ad_spend, SUM(sales) AS ad_sales
    FROM CALBRIDGE_PROD.MARTS_MARTS.mart_advertising_daily
    WHERE client_id = ? AND date >= ?
  `, [clientId, monthStart]);
  console.log(`\n=== Dashboard KPI ad totals (MTD): spend=$${Number(dashKpi[0].AD_SPEND||0).toFixed(0)}, sales=$${Number(dashKpi[0].AD_SALES||0).toFixed(0)}`);

  // 4. Check what date range the UI defaults to for "MTD"
  // Dashboard uses startDate/endDate or days param — check what /dashboard/kpis actually queries
  const now = new Date();
  const dayOfMonth = now.getUTCDate();
  console.log(`\nToday: ${now.toISOString().substring(0,10)} (day ${dayOfMonth} of April)`);
  console.log(`April data available: Apr 1 → ${String(acpMtd[0]?.LAST_DATE||'').substring(0,10)}`);

  // 5. Check what the dashboard overview route actually does for ad sales
  // It reads from mart_advertising_daily with startDate/endDate
  // Default dashboard is MTD — check if there's a date mismatch
  const dashRoute = await query(`
    SELECT
      COALESCE(SUM(spend), 0)  AS total_ad_spend,
      COALESCE(SUM(sales), 0)  AS total_ad_sales,
      COALESCE(SUM(orders), 0) AS total_orders
    FROM CALBRIDGE_PROD.MARTS_MARTS.mart_advertising_daily
    WHERE client_id = ?
      AND date >= ? AND date <= CURRENT_DATE()
  `, [clientId, monthStart]);
  console.log(`\n=== mart MTD (date >= Apr1 AND date <= today): spend=$${Number(dashRoute[0].TOTAL_AD_SPEND||0).toFixed(0)}, sales=$${Number(dashRoute[0].TOTAL_AD_SALES||0).toFixed(0)}`);

  // 6. Vendor sales for April (retail, not ad-attributed)
  const vendor = await query(`
    SELECT
      SUM(ordered_revenue)  AS ordered_revenue,
      SUM(shipped_revenue)  AS shipped_revenue,
      COUNT(DISTINCT asin)  AS asins,
      MIN(order_date)       AS first_date,
      MAX(order_date)       AS last_date
    FROM CALBRIDGE_PROD.APP.vendor_purchase_orders
    WHERE client_id = ? AND order_date >= ?
  `, [clientId, monthStart]);
  console.log(`\n=== Vendor retail sales (PO-based, April MTD): ordered=$${Number(vendor[0].ORDERED_REVENUE||0).toFixed(0)}, shipped=$${Number(vendor[0].SHIPPED_REVENUE||0).toFixed(0)} | ${String(vendor[0].FIRST_DATE).substring(0,10)} → ${String(vendor[0].LAST_DATE).substring(0,10)}`);

  // 7. Check if the dashboard uses days=30 by default instead of true MTD
  const last30 = await query(`
    SELECT ad_type, SUM(adjusted_spend) AS spend, SUM(sales) AS sales
    FROM CALBRIDGE_PROD.APP.adjusted_campaign_performance
    WHERE client_id = ? AND date >= DATEADD('day', -30, CURRENT_DATE())
    GROUP BY ad_type ORDER BY spend DESC
  `, [clientId]);
  console.log('\n=== ACP last 30 days (rolling, NOT MTD) ===');
  let t30spend = 0, t30sales = 0;
  last30.forEach(r => { t30spend += Number(r.SPEND||0); t30sales += Number(r.SALES||0); console.log(`  ${r.AD_TYPE}: spend=$${Number(r.SPEND||0).toFixed(0)}, sales=$${Number(r.SALES||0).toFixed(0)}`); });
  console.log(`  TOTAL: spend=$${t30spend.toFixed(0)}, sales=$${t30sales.toFixed(0)}`);

  // 8. What are the daily totals for April so far?
  const daily = await query(`
    SELECT date,
      SUM(adjusted_spend) AS spend,
      SUM(sales) AS sales
    FROM CALBRIDGE_PROD.APP.adjusted_campaign_performance
    WHERE client_id = ? AND date >= ?
    GROUP BY date ORDER BY date
  `, [clientId, monthStart]);
  console.log('\n=== Daily breakdown April MTD ===');
  daily.forEach(r => console.log(`  ${String(r.DATE).substring(0,10)}: spend=$${Number(r.SPEND||0).toFixed(0)}, sales=$${Number(r.SALES||0).toFixed(0)}`));

  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
