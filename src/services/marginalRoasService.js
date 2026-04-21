'use strict';
/**
 * Marginal ROAS & Contribution Margin Scoring Service
 * Scores campaigns by efficiency of incremental ad spend.
 *
 * Algorithm:
 *   1. Pull 30 days of daily ADJUSTED_CAMPAIGN_PERFORMANCE per client
 *   2. For each campaign with >=7 days of data:
 *      - Blended ROAS  = total_sales / total_spend
 *      - Marginal ROAS = JS slope calculation: sort days by spend, compute
 *                        average slope across adjacent pairs (ΔSales/ΔSpend)
 *      - Efficiency score = min(100, (marginal_roas / TARGET_ROAS) * 100)
 *      - Recommendation + confidence based on score and days of data
 *   3. MERGE scores into CAMPAIGN_MARGINAL_ROAS
 */

const { query, batchMerge } = require('./snowflakeService');

const TARGET_ROAS = 2.0; // baseline ROAS to normalise efficiency score against

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Calculate marginal ROAS from a series of (spend, sales) daily pairs.
 * Sort by spend ascending, compute slope between every adjacent pair,
 * then return the median slope as the marginal ROAS estimate.
 *
 * @param {Array<{spend: number, sales: number}>} days
 * @returns {number|null}  marginal ROAS, or null if insufficient data
 */
function calcMarginalRoas(days) {
  if (!days || days.length < 2) return null;

  // Sort ascending by spend
  const sorted = [...days].sort((a, b) => a.spend - b.spend);

  const slopes = [];
  for (let i = 1; i < sorted.length; i++) {
    const dSpend = sorted[i].spend - sorted[i - 1].spend;
    if (Math.abs(dSpend) < 0.01) continue; // skip days with nearly identical spend
    const dSales = sorted[i].sales - sorted[i - 1].sales;
    slopes.push(dSales / dSpend);
  }

  if (slopes.length === 0) return null;

  // Return median slope
  slopes.sort((a, b) => a - b);
  const mid = Math.floor(slopes.length / 2);
  return slopes.length % 2 === 0
    ? (slopes[mid - 1] + slopes[mid]) / 2
    : slopes[mid];
}

/**
 * Map efficiency score → recommendation string.
 */
function scoreToRecommendation(score) {
  if (score > 70)  return 'scale';
  if (score >= 40) return 'hold';
  if (score >= 20) return 'reduce';
  return 'pause';
}

/**
 * Map days of data → confidence level.
 */
function daysToConfidence(days) {
  if (days >= 14) return 'high';
  if (days >= 7)  return 'medium';
  return 'low';
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Score all campaigns for a single client and write to CAMPAIGN_MARGINAL_ROAS.
 *
 * @param {string} clientId
 * @param {string} [marketplace]
 */
async function scoreAllCampaigns(clientId, marketplace = 'ATVPDKIKX0DER') {
  // 1. Pull 30 days of daily spend + sales per campaign
  const rows = await query(`
    SELECT
      CAMPAIGN_ID,
      CAMPAIGN_NAME,
      AD_TYPE,
      DATE,
      SUM(ADJUSTED_SPEND)  AS spend,
      SUM(SALES)           AS sales
    FROM CALBRIDGE_PROD.APP.ADJUSTED_CAMPAIGN_PERFORMANCE
    WHERE CLIENT_ID  = ?
      AND MARKETPLACE = ?
      AND DATE >= DATEADD('day', -30, CURRENT_DATE())
      AND ADJUSTED_SPEND > 0
    GROUP BY CAMPAIGN_ID, CAMPAIGN_NAME, AD_TYPE, DATE
    ORDER BY CAMPAIGN_ID, DATE
  `, [clientId, marketplace]);

  if (!rows || rows.length === 0) {
    console.log(`[marginalRoas] No data for client ${clientId} / ${marketplace}`);
    return 0;
  }

  // 2. Group rows by campaign
  const campaignMap = new Map(); // campaign_id → { ad_type, days: [{spend, sales}] }
  for (const r of rows) {
    const cid = r.CAMPAIGN_ID || r.campaign_id;
    const adType = r.AD_TYPE  || r.ad_type;
    const spend  = parseFloat(r.SPEND  || r.spend  || 0);
    const sales  = parseFloat(r.SALES  || r.sales  || 0);

    if (!campaignMap.has(cid)) {
      campaignMap.set(cid, { ad_type: adType, days: [] });
    }
    campaignMap.get(cid).days.push({ spend, sales });
  }

  // 3. Score each campaign
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const scoredRows = [];

  for (const [campaignId, { ad_type, days }] of campaignMap) {
    if (days.length < 7) continue; // not enough data

    const totalSpend = days.reduce((s, d) => s + d.spend, 0);
    const totalSales = days.reduce((s, d) => s + d.sales, 0);

    if (totalSpend <= 0) continue;

    const blendedRoas  = totalSales / totalSpend;
    const marginalRoas = calcMarginalRoas(days) ?? blendedRoas; // fallback to blended

    // Clamp marginal ROAS at 0 for score purposes (negative slope → inefficient)
    const roasForScore = Math.max(0, marginalRoas);
    const efficiencyScore = Math.min(100, (roasForScore / TARGET_ROAS) * 100);

    const recommendation = scoreToRecommendation(efficiencyScore);
    const confidence     = daysToConfidence(days.length);

    const avgDailySpend = totalSpend / days.length;
    const avgDailySales = totalSales / days.length;

    scoredRows.push({
      client_id:                    clientId,
      campaign_id:                  campaignId,
      marketplace,
      ad_type:                      ad_type || null,
      scored_at:                    today,
      avg_daily_spend:              parseFloat(avgDailySpend.toFixed(2)),
      avg_daily_sales:              parseFloat(avgDailySales.toFixed(2)),
      blended_roas:                 parseFloat(blendedRoas.toFixed(4)),
      marginal_roas:                parseFloat(marginalRoas.toFixed(4)),
      weighted_break_even_acos:     null,  // populated if ASIN economics available
      contribution_margin_at_spend: null,  // populated if ASIN economics available
      efficiency_score:             parseFloat(efficiencyScore.toFixed(2)),
      recommendation,
      confidence,
    });
  }

  if (scoredRows.length === 0) {
    console.log(`[marginalRoas] No scorable campaigns for ${clientId} (all < 7 days)`);
    return 0;
  }

  // 4. MERGE into CAMPAIGN_MARGINAL_ROAS via batchMerge
  const keyColumns  = ['client_id', 'campaign_id', 'marketplace', 'scored_at'];
  const dataColumns = [
    'ad_type', 'avg_daily_spend', 'avg_daily_sales',
    'blended_roas', 'marginal_roas', 'weighted_break_even_acos',
    'contribution_margin_at_spend', 'efficiency_score', 'recommendation', 'confidence',
  ];

  // batchMerge adds synced_at — we need to ensure the table has that column or use raw merge
  // Since CAMPAIGN_MARGINAL_ROAS does not have synced_at, use raw chunked MERGE instead
  const written = await _mergeScoredRows(scoredRows);
  console.log(`[marginalRoas] Scored ${scoredRows.length} campaigns for ${clientId}, wrote ${written}`);
  return written;
}

/**
 * Raw MERGE for scored rows (table lacks synced_at so batchMerge helper won't work).
 */
async function _mergeScoredRows(rows, chunkSize = 500) {
  if (!rows.length) return 0;
  let total = 0;

  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const allColumns = [
      'client_id', 'campaign_id', 'marketplace', 'scored_at',
      'ad_type', 'avg_daily_spend', 'avg_daily_sales',
      'blended_roas', 'marginal_roas', 'weighted_break_even_acos',
      'contribution_margin_at_spend', 'efficiency_score', 'recommendation', 'confidence',
    ];

    const keyColumns  = ['client_id', 'campaign_id', 'marketplace', 'scored_at'];
    const dataColumns = allColumns.filter(c => !keyColumns.includes(c));

    const valuePlaceholders = chunk.map(() =>
      '(' + allColumns.map(() => '?').join(', ') + ')'
    ).join(',\n    ');

    const selectCols = allColumns.map((col, idx) => {
      const alias = `column${idx + 1}`;
      if (col === 'scored_at') return `${alias}::DATE AS ${col}`;
      return `${alias} AS ${col}`;
    }).join(', ');

    const onClause     = keyColumns.map(c => `t.${c} = s.${c}`).join(' AND ');
    const updateClause = dataColumns.map(c => `${c} = s.${c}`).join(',\n        ');
    const insertCols   = allColumns.join(', ');
    const insertVals   = allColumns.map(c => `s.${c}`).join(', ');

    const sql = `
      MERGE INTO CALBRIDGE_PROD.APP.CAMPAIGN_MARGINAL_ROAS t
      USING (
        SELECT ${selectCols}
        FROM VALUES
          ${valuePlaceholders}
      ) s
      ON ${onClause}
      WHEN MATCHED THEN UPDATE SET
        ${updateClause}
      WHEN NOT MATCHED THEN INSERT (${insertCols})
        VALUES (${insertVals})
    `;

    const binds = [];
    for (const row of chunk) {
      for (const col of allColumns) {
        const val = row[col];
        binds.push(val === undefined ? null : val);
      }
    }

    const result = await query(sql, binds);
    const inserted = result?.[0]?.['number of rows inserted'] ?? 0;
    const updated  = result?.[0]?.['number of rows updated']  ?? 0;
    total += inserted + updated;
  }

  return total;
}

/**
 * Get latest campaign scores for a client.
 *
 * @param {string} clientId
 * @param {string} [marketplace]
 * @param {number} [limit]
 * @returns {Promise<Array>}
 */
async function getCampaignScores(clientId, marketplace = 'ATVPDKIKX0DER', limit = 50) {
  const rows = await query(`
    SELECT
      campaign_id,
      marketplace,
      ad_type,
      scored_at,
      avg_daily_spend,
      avg_daily_sales,
      blended_roas,
      marginal_roas,
      efficiency_score,
      recommendation,
      confidence
    FROM CALBRIDGE_PROD.APP.CAMPAIGN_MARGINAL_ROAS
    WHERE client_id  = ?
      AND marketplace = ?
      AND scored_at = (
        SELECT MAX(scored_at)
        FROM CALBRIDGE_PROD.APP.CAMPAIGN_MARGINAL_ROAS
        WHERE client_id = ? AND marketplace = ?
      )
    ORDER BY efficiency_score DESC
    LIMIT ?
  `, [clientId, marketplace, clientId, marketplace, limit]);

  return (rows || []).map(r => ({
    campaign_id:      r.CAMPAIGN_ID      || r.campaign_id,
    marketplace:      r.MARKETPLACE      || r.marketplace,
    ad_type:          r.AD_TYPE          || r.ad_type,
    scored_at:        r.SCORED_AT        || r.scored_at,
    avg_daily_spend:  parseFloat(r.AVG_DAILY_SPEND  || r.avg_daily_spend  || 0),
    avg_daily_sales:  parseFloat(r.AVG_DAILY_SALES  || r.avg_daily_sales  || 0),
    blended_roas:     parseFloat(r.BLENDED_ROAS     || r.blended_roas     || 0),
    marginal_roas:    parseFloat(r.MARGINAL_ROAS    || r.marginal_roas    || 0),
    efficiency_score: parseFloat(r.EFFICIENCY_SCORE || r.efficiency_score || 0),
    recommendation:   r.RECOMMENDATION   || r.recommendation,
    confidence:       r.CONFIDENCE       || r.confidence,
  }));
}

/**
 * Upsert ASIN economics in bulk.
 *
 * @param {string} clientId
 * @param {Array<{
 *   asin: string,
 *   marketplace?: string,
 *   cogs?: number,
 *   fba_fee?: number,
 *   referral_fee_pct?: number,
 *   avg_selling_price?: number,
 *   data_source?: string
 * }>} records
 * @returns {Promise<number>} rows written
 */
async function upsertAsinEconomics(clientId, records) {
  if (!records || records.length === 0) return 0;

  // Compute derived fields and normalise
  const rows = records.map(r => {
    const price  = r.avg_selling_price ?? null;
    const cogs   = r.cogs ?? null;
    const fbaFee = r.fba_fee ?? null;
    const refPct = r.referral_fee_pct ?? 0.15;

    let contribution_margin = null;
    let break_even_acos     = null;

    if (price !== null && cogs !== null && fbaFee !== null) {
      const referralFee = price * refPct;
      contribution_margin = price - cogs - fbaFee - referralFee;
      if (price > 0) {
        break_even_acos = contribution_margin / price;
      }
    }

    return {
      client_id:            clientId,
      asin:                 r.asin,
      marketplace:          r.marketplace || 'ATVPDKIKX0DER',
      cogs:                 cogs,
      fba_fee:              fbaFee,
      referral_fee_pct:     refPct,
      avg_selling_price:    price,
      contribution_margin:  contribution_margin !== null ? parseFloat(contribution_margin.toFixed(2)) : null,
      break_even_acos:      break_even_acos     !== null ? parseFloat(break_even_acos.toFixed(4))     : null,
      data_source:          r.data_source || 'manual',
    };
  });

  const allColumns = [
    'client_id', 'asin', 'marketplace', 'cogs', 'fba_fee', 'referral_fee_pct',
    'avg_selling_price', 'contribution_margin', 'break_even_acos', 'data_source',
  ];
  const keyColumns  = ['client_id', 'asin', 'marketplace'];
  const dataColumns = allColumns.filter(c => !keyColumns.includes(c));

  let total = 0;
  const chunkSize = 500;

  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);

    const valuePlaceholders = chunk.map(() =>
      '(' + allColumns.map(() => '?').join(', ') + ')'
    ).join(',\n    ');

    const selectCols   = allColumns.map((col, idx) => `column${idx + 1} AS ${col}`).join(', ');
    const onClause     = keyColumns.map(c => `t.${c} = s.${c}`).join(' AND ');
    const updateClause = dataColumns.map(c => `${c} = s.${c}`).join(',\n        ');
    const insertCols   = allColumns.join(', ') + ', updated_at';
    const insertVals   = allColumns.map(c => `s.${c}`).join(', ') + ', CURRENT_TIMESTAMP()';

    const sql = `
      MERGE INTO CALBRIDGE_PROD.APP.ASIN_ECONOMICS t
      USING (
        SELECT ${selectCols}
        FROM VALUES
          ${valuePlaceholders}
      ) s
      ON ${onClause}
      WHEN MATCHED THEN UPDATE SET
        ${updateClause},
        updated_at = CURRENT_TIMESTAMP()
      WHEN NOT MATCHED THEN INSERT (${insertCols})
        VALUES (${insertVals})
    `;

    const binds = [];
    for (const row of chunk) {
      for (const col of allColumns) {
        const val = row[col];
        binds.push(val === undefined ? null : val);
      }
    }

    const result = await query(sql, binds);
    const inserted = result?.[0]?.['number of rows inserted'] ?? 0;
    const updated  = result?.[0]?.['number of rows updated']  ?? 0;
    total += inserted + updated;
  }

  console.log(`[marginalRoas] upsertAsinEconomics ${clientId}: wrote ${total} rows`);
  return total;
}

/**
 * Get ASIN economics for a client, optionally filtered to specific ASINs.
 *
 * @param {string} clientId
 * @param {string[]} [asins]  If empty, returns all ASINs for the client
 * @returns {Promise<Array>}
 */
async function getAsinEconomics(clientId, asins = []) {
  let sql;
  let binds;

  if (asins.length > 0) {
    const placeholders = asins.map(() => '?').join(', ');
    sql = `
      SELECT *
      FROM CALBRIDGE_PROD.APP.ASIN_ECONOMICS
      WHERE client_id = ?
        AND asin IN (${placeholders})
      ORDER BY asin
    `;
    binds = [clientId, ...asins];
  } else {
    sql = `
      SELECT *
      FROM CALBRIDGE_PROD.APP.ASIN_ECONOMICS
      WHERE client_id = ?
      ORDER BY asin
    `;
    binds = [clientId];
  }

  const rows = await query(sql, binds);
  return (rows || []).map(r => ({
    asin:                 r.ASIN                 || r.asin,
    marketplace:          r.MARKETPLACE          || r.marketplace,
    cogs:                 r.COGS !== undefined    ? parseFloat(r.COGS)   : parseFloat(r.cogs),
    fba_fee:              r.FBA_FEE !== undefined ? parseFloat(r.FBA_FEE): parseFloat(r.fba_fee),
    referral_fee_pct:     parseFloat(r.REFERRAL_FEE_PCT    || r.referral_fee_pct    || 0.15),
    avg_selling_price:    parseFloat(r.AVG_SELLING_PRICE   || r.avg_selling_price   || 0),
    contribution_margin:  parseFloat(r.CONTRIBUTION_MARGIN || r.contribution_margin || 0),
    break_even_acos:      parseFloat(r.BREAK_EVEN_ACOS     || r.break_even_acos     || 0),
    data_source:          r.DATA_SOURCE          || r.data_source,
    updated_at:           r.UPDATED_AT           || r.updated_at,
  }));
}

/**
 * Score all active clients — called by cron.
 */
async function scoreAllClients() {
  // Find clients active in the last 7 days
  const clients = await query(`
    SELECT DISTINCT CLIENT_ID
    FROM CALBRIDGE_PROD.APP.ADJUSTED_CAMPAIGN_PERFORMANCE
    WHERE DATE >= DATEADD('day', -7, CURRENT_DATE())
  `);

  if (!clients || clients.length === 0) {
    console.log('[marginalRoas] scoreAllClients: no active clients found');
    return;
  }

  console.log(`[marginalRoas] scoreAllClients: scoring ${clients.length} client(s)`);
  let succeeded = 0;
  let failed    = 0;

  for (const row of clients) {
    const clientId = row.CLIENT_ID || row.client_id;
    try {
      await scoreAllCampaigns(clientId);
      succeeded++;
    } catch (err) {
      console.error(`[marginalRoas] scoreAllClients: ${clientId} failed — ${err.message}`);
      failed++;
    }
  }

  console.log(`[marginalRoas] scoreAllClients done — succeeded=${succeeded}, failed=${failed}`);
}

module.exports = {
  scoreAllCampaigns,
  getCampaignScores,
  upsertAsinEconomics,
  getAsinEconomics,
  scoreAllClients,
};
