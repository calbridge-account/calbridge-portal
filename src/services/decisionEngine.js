/**
 * CalBridge Decision Engine
 *
 * Analyzes CM + advertising data to surface:
 * 1. Break-even ACOS per ASIN (calculated from CM data)
 * 2. Where money is being lost
 * 3. Where to invest more
 * 4. What needs immediate attention (alerts)
 *
 * Future: one-click actions that write back to Advertising API
 */
const { query } = require('./snowflakeService');

/**
 * Run full decision analysis for a client
 * Returns structured recommendations + alerts
 */
async function analyze(clientId, days = 30) {
  const [cmData, campaignData, trendData] = await Promise.all([
    getContributionMarginData(clientId, days),
    getCampaignData(clientId, days),
    getTrendAlerts(clientId)
  ]);

  const recommendations = [];
  const alerts = [];

  // ---- BREAK-EVEN ACOS per ASIN ----
  // Break-even ACOS = (CM before ad spend) / Revenue
  // i.e. the max % of revenue you can spend on ads and still break even
  const asinMetrics = cmData.map(row => {
    const revenue    = Number(row.TOTAL_REVENUE   || 0);
    const adSpend    = Number(row.TOTAL_AD_SPEND  || 0);
    const fbaFees    = Number(row.TOTAL_FBA_FEES  || 0);
    const cogs       = Number(row.TOTAL_COGS      || 0);
    const cm3        = Number(row.TOTAL_CM        || 0);

    // CM before ad spend = revenue - cogs - fba fees
    const cmBeforeAds = revenue - cogs - fbaFees;
    const breakEvenAcos = revenue > 0 ? cmBeforeAds / revenue : null;
    const actualAcos    = revenue > 0 ? adSpend / revenue     : null;
    const cm3Pct        = revenue > 0 ? cm3 / revenue         : null;

    return {
      asin:          row.ASIN,
      revenue,
      adSpend,
      fbaFees,
      cogs,
      cm3,
      cm3Pct,
      cmBeforeAds,
      breakEvenAcos,
      actualAcos,
      isOverSpending: breakEvenAcos !== null && actualAcos !== null && actualAcos > breakEvenAcos,
      isUnderInvested: breakEvenAcos !== null && actualAcos !== null &&
                       actualAcos < breakEvenAcos * 0.5 && cm3Pct > 0.15 // CM% > 15% and ACOS < half break-even
    };
  });

  // ---- LOSING MONEY: negative CM3 ----
  const losingAsins = asinMetrics.filter(a => a.cm3 < 0 && a.revenue > 0);
  losingAsins.forEach(a => {
    alerts.push({
      type:     'danger',
      category: 'negative_margin',
      title:    `${a.asin} is losing money`,
      message:  `CM3 is ${fmt$(a.cm3)} (${pct(a.cm3Pct)}) — you're spending more on ads + fees than you're earning.`,
      asin:     a.asin,
      metric:   { cm3: a.cm3, cm3Pct: a.cm3Pct, actualAcos: a.actualAcos, breakEvenAcos: a.breakEvenAcos },
      action:   { label: 'Reduce Ad Spend', type: 'reduce_budget', asin: a.asin, suggestedAcos: a.breakEvenAcos * 0.8 }
    });
  });

  // ---- OVER-SPENDING: ACOS above break-even ----
  const overSpending = asinMetrics.filter(a => a.isOverSpending && a.cm3 >= 0);
  overSpending.forEach(a => {
    const gap = a.actualAcos - a.breakEvenAcos;
    alerts.push({
      type:     'warning',
      category: 'acos_above_breakeven',
      title:    `${a.asin} ACOS above break-even`,
      message:  `Actual ACOS ${pct(a.actualAcos)} vs break-even ${pct(a.breakEvenAcos)} — ad spend is ${pct(gap)} above break-even point.`,
      asin:     a.asin,
      metric:   { actualAcos: a.actualAcos, breakEvenAcos: a.breakEvenAcos, gap },
      action:   { label: 'Optimize Bids', type: 'reduce_bids', asin: a.asin, targetAcos: a.breakEvenAcos * 0.85 }
    });
  });

  // ---- UNDER-INVESTED: high margin, low ad spend ----
  const underInvested = asinMetrics.filter(a => a.isUnderInvested);
  underInvested.forEach(a => {
    const headroom = (a.breakEvenAcos - a.actualAcos) * a.revenue;
    recommendations.push({
      type:     'opportunity',
      category: 'scale_opportunity',
      title:    `Scale spend on ${a.asin}`,
      message:  `CM3 is ${pct(a.cm3Pct)} with ACOS at ${pct(a.actualAcos)} vs break-even ${pct(a.breakEvenAcos)}. You have ~${fmt$(headroom)} headroom to increase ad spend profitably.`,
      asin:     a.asin,
      metric:   { cm3Pct: a.cm3Pct, actualAcos: a.actualAcos, breakEvenAcos: a.breakEvenAcos, headroom },
      action:   { label: 'Increase Budget', type: 'increase_budget', asin: a.asin, suggestedAcos: a.breakEvenAcos * 0.9 }
    });
  });

  // ---- CAMPAIGN LEVEL: high spend + low ROAS ----
  campaignData.forEach(c => {
    const acos  = Number(c.ACOS  || 0);
    const spend = Number(c.SPEND || 0);
    const sales = Number(c.SALES || 0);
    if (spend < 50) return; // ignore tiny campaigns
    if (acos > 0.6 && sales > 0) {
      alerts.push({
        type:     'warning',
        category: 'high_acos_campaign',
        title:    `High ACOS: ${c.CAMPAIGN_NAME || c.CAMPAIGN_ID}`,
        message:  `ACOS is ${pct(acos)} on ${fmt$(spend)} spend. Consider pausing or restructuring this campaign.`,
        campaignId: c.CAMPAIGN_ID,
        metric:   { acos, spend, sales, roas: c.ROAS },
        action:   { label: 'Pause Campaign', type: 'pause_campaign', campaignId: c.CAMPAIGN_ID }
      });
    }
    if (spend > 100 && sales === 0) {
      alerts.push({
        type:     'danger',
        category: 'spend_no_sales',
        title:    `No sales: ${c.CAMPAIGN_NAME || c.CAMPAIGN_ID}`,
        message:  `${fmt$(spend)} spent with zero attributed sales in the last ${days} days.`,
        campaignId: c.CAMPAIGN_ID,
        metric:   { spend, sales: 0 },
        action:   { label: 'Pause Campaign', type: 'pause_campaign', campaignId: c.CAMPAIGN_ID }
      });
    }
  });

  // ---- TREND ALERTS: sudden ACOS spikes ----
  trendData.forEach(t => {
    if (t.SPIKE_DETECTED) {
      alerts.push({
        type:     'warning',
        category: 'acos_spike',
        title:    'ACOS spike detected',
        message:  `Daily ACOS jumped to ${pct(t.RECENT_ACOS)} vs ${pct(t.AVG_ACOS)} 7-day average — a ${pct(t.SPIKE_RATIO - 1)} increase.`,
        metric:   { recentAcos: t.RECENT_ACOS, avgAcos: t.AVG_ACOS, spikeRatio: t.SPIKE_RATIO },
        action:   { label: 'Review Campaigns', type: 'review', link: '/advertising.html' }
      });
    }
  });

  // Sort: danger first, then warning, then opportunity
  const sortOrder = { danger: 0, warning: 1, opportunity: 2 };
  const allInsights = [...alerts, ...recommendations]
    .sort((a, b) => (sortOrder[a.type] ?? 3) - (sortOrder[b.type] ?? 3));

  return {
    summary: {
      totalAsins:       asinMetrics.length,
      losingMoney:      losingAsins.length,
      overSpending:     overSpending.length,
      opportunities:    underInvested.length,
      alertCount:       alerts.length,
      breakEvenByAsin:  asinMetrics.map(a => ({
        asin: a.asin,
        breakEvenAcos: a.breakEvenAcos,
        actualAcos:    a.actualAcos,
        cm3Pct:        a.cm3Pct,
        status: a.cm3 < 0 ? 'losing' : a.isOverSpending ? 'over' : a.isUnderInvested ? 'opportunity' : 'healthy'
      }))
    },
    insights: allInsights
  };
}

async function getContributionMarginData(clientId, days) {
  return query(`
    SELECT
      asin,
      SUM(revenue)              AS total_revenue,
      SUM(ad_spend)             AS total_ad_spend,
      SUM(fba_fees)             AS total_fba_fees,
      SUM(cogs)                 AS total_cogs,
      SUM(contribution_margin)  AS total_cm,
      AVG(cm_percent)           AS avg_cm_percent
    FROM contribution_margin
    WHERE client_id = ?
      AND calc_date >= DATEADD(day, -?, CURRENT_DATE)
    GROUP BY asin
    ORDER BY SUM(contribution_margin) ASC
  `, [clientId, days]);
}

async function getCampaignData(clientId, days) {
  return query(`
    SELECT
      ap.campaign_id,
      c.campaign_name,
      SUM(ap.spend)   AS spend,
      SUM(ap.sales)   AS sales,
      CASE WHEN SUM(ap.sales) > 0 THEN SUM(ap.spend)/SUM(ap.sales) ELSE NULL END AS acos,
      CASE WHEN SUM(ap.spend) > 0 THEN SUM(ap.sales)/SUM(ap.spend) ELSE NULL END AS roas
    FROM ad_performance ap
    LEFT JOIN ad_campaigns c ON ap.client_id=c.client_id AND ap.campaign_id=c.campaign_id AND ap.connection_type=c.connection_type
    WHERE ap.client_id = ?
      AND ap.report_date >= DATEADD(day, -?, CURRENT_DATE)
    GROUP BY ap.campaign_id, c.campaign_name
    HAVING SUM(ap.spend) > 0
  `, [clientId, days]);
}

async function getTrendAlerts(clientId) {
  return query(`
    WITH daily AS (
      SELECT
        report_date,
        CASE WHEN SUM(sales) > 0 THEN SUM(spend)/SUM(sales) ELSE NULL END AS daily_acos
      FROM ad_performance
      WHERE client_id = ?
        AND report_date >= DATEADD(day, -14, CURRENT_DATE)
      GROUP BY report_date
    ),
    recent AS (SELECT AVG(daily_acos) AS recent_acos FROM daily WHERE report_date >= DATEADD(day, -3, CURRENT_DATE)),
    baseline AS (SELECT AVG(daily_acos) AS avg_acos FROM daily WHERE report_date < DATEADD(day, -3, CURRENT_DATE))
    SELECT
      r.recent_acos,
      b.avg_acos,
      CASE WHEN b.avg_acos > 0 THEN r.recent_acos / b.avg_acos ELSE NULL END AS spike_ratio,
      CASE WHEN b.avg_acos > 0 AND r.recent_acos / b.avg_acos > 1.2 THEN TRUE ELSE FALSE END AS spike_detected
    FROM recent r, baseline b
  `, [clientId]);
}

function fmt$(n) { return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function pct(n)  { return n != null ? (Number(n) * 100).toFixed(1) + '%' : '—'; }

module.exports = { analyze };
