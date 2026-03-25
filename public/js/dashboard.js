// Calbridge Dashboard — client-side JS

const $ = id => document.getElementById(id);
let cmTrendChart, revSpendChart, campaignChart, acosChart, salesTrendChart, channelSplitChart, forecastChart;
let currentDays = 30;

// ---- Init ----
document.addEventListener('DOMContentLoaded', async () => {
  await checkAuth();
  setupNav();
  setupFilters();
  setupBell();
  await loadAll();
  await loadDecisions();
});

async function checkAuth() {
  try {
    const res = await fetch('/auth/me', { credentials: 'include' });
    if (!res.ok) { window.location.href = '/'; return; }
    const { client } = await res.json();
    $('client-name').textContent = client.name || client.email;
    // Load client logo if set
    const profileRes = await fetch('/account/profile', { credentials: 'include' });
    const profile = await profileRes.json();
    if (profile.logoUrl) {
      const logoEl = document.querySelector('.sidebar-logo img');
      if (logoEl) { logoEl.src = profile.logoUrl; logoEl.style.filter = 'none'; }
    }
    // Conditional nav based on connections — hide tabs entirely if not connected
    const connRes = await fetch('/amazon/status', { credentials: 'include' });
    const conn = await connRes.json();
    const hasAds   = conn.ads?.connected || conn.dsp?.connected;
    const hasSales = conn.seller?.connected || conn.vendor?.connected;
    const hasAny   = hasAds || hasSales;
    if (!hasAny)   document.querySelector('[data-section="overview"]')?.closest('a')?.remove();
    if (!hasAds)   document.querySelectorAll('.nav-item-ads').forEach(el => el.remove());
    if (!hasSales) document.querySelector('[data-section="performance"]')?.closest('a')?.remove();
  } catch { window.location.href = '/'; }
}

// ---- Navigation ----
function setupNav() {
  document.querySelectorAll('.nav-item').forEach(link => {
    link.addEventListener('click', e => {
      const section = link.dataset.section;
      if (!section) return; // let normal navigation happen (e.g. /advertising.html)
      e.preventDefault();
      document.querySelectorAll('.nav-item').forEach(l => l.classList.remove('active'));
      document.querySelectorAll('.dashboard-section').forEach(s => s.classList.add('hidden'));
      link.classList.add('active');
      $(`section-${section}`).classList.remove('hidden');
      $('section-title').textContent = link.textContent.replace(/^./, '').trim();
      // Lazy-load tabs
      if (section === 'performance') loadPerformance();
      if (section === 'forecast')    loadForecast();
      if (section === 'pacing')      loadBudgetPacing();
      if (section === 'ntb')         loadNtb();
      if (section === 'trends')      loadProfitabilityTrends();
    });
  });

  $('logout-btn').addEventListener('click', async () => {
    await fetch('/auth/logout', { method: 'POST', credentials: 'include' });
    window.location.href = '/';
  });
}

function setupFilters() {
  setupDateFilter('days-filter', async (days, label) => {
    currentDays = days;
    $('section-sub').textContent = label;
    await loadAll();
  });

  $('sync-btn').addEventListener('click', async () => {
    $('sync-btn').textContent = '↻ Syncing...';
    $('sync-btn').disabled = true;
    await fetch('/dashboard/sync', { method: 'POST', credentials: 'include' });
    setTimeout(async () => {
      await loadAll();
      $('sync-btn').textContent = '↻ Sync Now';
      $('sync-btn').disabled = false;
    }, 3000);
  });
}

// ---- Load All Data ----
async function loadAll() {
  await Promise.all([
    loadOverview(),
    loadConnections()
  ]);
}

// ---- Performance Tab ----
let performanceLoaded = false;

async function loadPerformance() {
  if (performanceLoaded) return;
  performanceLoaded = true;
  try {
    const res = await fetch(`/dashboard/sales-performance?days=${currentDays}`, { credentials: 'include' });
    if (!res.ok) return;
    const data = await res.json();

    // Top ASINs table
    const tbody = $('sales-top-asins-body');
    if (data.topAsins?.length) {
      tbody.innerHTML = data.topAsins.map((r, i) => `
        <tr>
          <td><strong>#${i+1}</strong> ${r.productName !== r.asin ? `<span style="font-size:12px">${r.productName.substring(0,60)}</span>` : '—'}</td>
          <td style="font-size:11px;color:var(--gray-400)">${r.asin}</td>
          <td>${Number(r.units).toLocaleString()}</td>
          <td><strong>${fmt$(r.revenue)}</strong></td>
        </tr>
      `).join('');
    } else {
      tbody.innerHTML = '<tr><td colspan="4" class="loading-cell">No sales data yet</td></tr>';
    }

    // Sales trend chart
    if (data.dailyTrend?.length) {
      const labels = data.dailyTrend.map(r => r.date);
      const revs   = data.dailyTrend.map(r => r.revenue);
      if (salesTrendChart) salesTrendChart.destroy();
      salesTrendChart = new Chart($('sales-trend-chart'), {
        type: 'line',
        data: {
          labels,
          datasets: [{ label: 'Daily Revenue', data: revs, borderColor: '#1a56db', backgroundColor: 'rgba(26,86,219,.08)', tension: .4, fill: true }]
        },
        options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { ticks: { callback: v => '$' + Number(v).toFixed(0) } } } }
      });
    }

    // Channel split pie
    if (data.channelSplit?.length) {
      const labels = data.channelSplit.map(r => r.channel === 'seller' ? 'Seller Central' : r.channel === 'vendor' ? 'Vendor Central' : r.channel);
      const vals   = data.channelSplit.map(r => r.revenue);
      if (channelSplitChart) channelSplitChart.destroy();
      channelSplitChart = new Chart($('channel-split-chart'), {
        type: 'doughnut',
        data: {
          labels,
          datasets: [{ data: vals, backgroundColor: ['#1a56db', '#057a55', '#0694a2', '#e02424'] }]
        },
        options: { responsive: true, plugins: { legend: { position: 'bottom' } } }
      });
    }
  } catch (err) { console.error('Performance load error:', err); }
}

// ---- Overview ----
async function loadOverview() {
  try {
    const [summaryRes, perfRes] = await Promise.all([
      fetch(`/dashboard/summary?days=${currentDays}`, { credentials: 'include' }),
      fetch(`/dashboard/performance?days=${currentDays}&limit=20`, { credentials: 'include' })
    ]);
    const summary = await summaryRes.json();
    const { topPerformers, bottomPerformers } = await perfRes.json();

    // Top-line KPIs from summary endpoint
    const hasSalesData = summary.totalRetailSales > 0;
    $('kpi-revenue').textContent     = hasSalesData ? fmt$(summary.totalRetailSales) : 'Pending';
    $('kpi-revenue').style.color     = hasSalesData ? '' : 'var(--gray-400)';
    $('kpi-revenue-sub').textContent = hasSalesData
      ? `Seller ${fmt$(summary.sellerRevenue)} · Vendor ${fmt$(summary.vendorRevenue)}`
      : 'Seller Central connection pending';
    $('kpi-ad-sales').textContent    = fmt$(summary.totalAdSales);
    $('kpi-ad-sales-sub').textContent = `${(summary.totalAdOrders||0).toLocaleString()} orders`;
    $('kpi-spend').textContent       = fmt$(summary.totalAdSpend);
    $('kpi-spend-sub').textContent   = summary.acos ? `${(summary.acos * 100).toFixed(1)}% ACOS` : '';
    $('kpi-roas').textContent        = summary.totalRoas ? `${summary.totalRoas.toFixed(2)}x` : '—';
    $('kpi-ad-roas').textContent     = summary.adRoas ? `${summary.adRoas.toFixed(2)}x` : '—';

    // CM3 (True Profitability) from cmBreakdown or performers aggregate
    const cm = summary.cmBreakdown;
    let cm3Total = cm?.cm3 != null ? cm.cm3 : null;
    if (cm3Total == null) {
      // Fallback: sum CM3 from performers
      cm3Total = topPerformers.reduce((acc, r) => acc + (r.cm3 != null ? r.cm3 : Number(r.TOTAL_CM3 || r.TOTAL_CM || 0)), 0);
    }
    const cmPct = summary.totalRetailSales > 0 && cm3Total != null ? (cm3Total / summary.totalRetailSales) * 100 : 0;
    $('kpi-cm').textContent     = cm3Total != null ? fmt$(cm3Total) : '—';
    $('kpi-cm').style.color     = cm3Total != null && cm3Total < 0 ? 'var(--danger)' : 'var(--gray-400)';
    if (cm3Total != null) {
      $('kpi-cm').style.color   = cm3Total < 0 ? 'var(--danger)' : '';
      $('kpi-cm-sub').textContent = `${cmPct.toFixed(1)}% of retail sales`;
    } else if (!hasSalesData) {
      $('kpi-cm-sub').textContent = 'Connect Seller Central to unlock';
    } else {
      $('kpi-cm-sub').textContent = 'Upload COGS in Account settings';
    }
    $('kpi-acos').textContent   = summary.acos ? `${(summary.acos * 100).toFixed(1)}%` : '—';

    // CM Waterfall
    if (summary.cmBreakdown) renderCmWaterfall(summary.cmBreakdown);

    // Data status banner
    const banner = $('data-status-banner');
    if (banner) {
      if (!hasSalesData && summary.totalAdSpend > 0) {
        banner.style.display = 'flex';
        banner.style.background = 'var(--brand-light)';
        banner.style.border = '1px solid var(--brand)';
        banner.style.color = 'var(--brand)';
        banner.innerHTML = '📡 <strong>Advertising data connected.</strong>&nbsp;Connect your Seller or Vendor Central account in <a href="/account.html" style="color:var(--brand);text-decoration:underline">Account Settings</a> to unlock sales data and contribution margin.';
      } else if (summary.totalAdSpend === 0 && summary.totalRetailSales === 0) {
        banner.style.display = 'flex';
        banner.style.background = 'var(--gray-100)';
        banner.style.border = '1px solid var(--gray-200)';
        banner.style.color = 'var(--gray-600)';
        banner.innerHTML = '⏳ <strong>Initial sync in progress.</strong>&nbsp;Your data is being pulled from Amazon. Check back in a few minutes.';
      } else {
        banner.style.display = 'none';
      }
    }

    // TACOS (Total ACOS) — load async, show card if data is available
    loadTacos();

    // CM Trend chart (aggregate by ASIN across all performers)
    await loadCmTrend();

    // Revenue vs Spend bar chart
    renderRevSpend(topPerformers.slice(0, 6));

    // Top ASINs table
    renderTopAsins(topPerformers);

    // Bottom ASINs table
    renderBottomAsins(bottomPerformers);

    // Campaign chart
    await loadCampaignData();

  } catch (err) {
    console.error('Overview load error:', err);
  }
}

async function loadCmTrend() {
  try {
    const asinRes = await fetch(`/dashboard/performance?days=${currentDays}&limit=1`, { credentials: 'include' });
    const { topPerformers } = await asinRes.json();
    if (!topPerformers.length) return;

    const topAsin = topPerformers[0].ASIN || topPerformers[0].asin;
    const trendRes = await fetch(`/dashboard/asin/${topAsin}?days=${currentDays}`, { credentials: 'include' });
    const { trend, summary: trendSummary } = await trendRes.json();

    if (!trend?.length) return;

    // Use calcDate from the enriched trend response
    const labels  = trend.map(r => r.calcDate || ((() => {
      const d = r.CALC_DATE?.value || r.CALC_DATE;
      return typeof d === 'string' ? d.substring(0, 10) : new Date(d).toISOString().substring(0, 10);
    })()));
    const revData = trend.map(r => parseFloat(r.revenue || r.REVENUE || 0));
    const cm1Data = trend.map(r => r.cm1 != null ? parseFloat(r.cm1) : parseFloat(r.CONTRIBUTION_MARGIN || 0));
    const cm2Data = trend.map(r => r.cm2 != null ? parseFloat(r.cm2) : null);
    const cm3Data = trend.map(r => r.cm3 != null ? parseFloat(r.cm3) : null);

    const datasets = [
      { label: 'Revenue', data: revData, borderColor: '#1a56db', backgroundColor: 'rgba(26,86,219,.06)', tension: .4, fill: true, pointRadius: 2 },
      { label: 'CM1 – Net Amazon Proceeds', data: cm1Data, borderColor: '#0694a2', backgroundColor: 'transparent', tension: .4, borderWidth: 2, pointRadius: 2 },
    ];
    if (cm2Data.some(v => v != null)) {
      datasets.push({ label: 'CM2 – Gross Profit', data: cm2Data, borderColor: '#057a55', backgroundColor: 'transparent', tension: .4, borderWidth: 2, pointRadius: 2 });
    }
    if (cm3Data.some(v => v != null)) {
      datasets.push({ label: 'CM3 – True Profitability', data: cm3Data, borderColor: '#059669', backgroundColor: 'rgba(5,150,105,.06)', tension: .4, fill: true, borderWidth: 2.5, pointRadius: 2 });
    }

    // Update chart title to show which ASIN + vendor caveat if applicable
    const chartTitle = $('cm-trend-chart')?.closest('.chart-card')?.querySelector('h3');
    if (chartTitle) {
      const vendorNote = trendSummary?.vendorCm1IsEstimate ? ' ⚠️' : '';
      chartTitle.textContent = `CM Trend — ${topAsin}${vendorNote}`;
      if (vendorNote) chartTitle.title = 'Vendor CM1 is an estimate. Excludes Amazon deductions.';
    }

    if (cmTrendChart) cmTrendChart.destroy();
    cmTrendChart = new Chart($('cm-trend-chart'), {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true,
        plugins: { legend: { position: 'top' } },
        scales: { y: { ticks: { callback: v => '$' + Number(v).toFixed(0) } } }
      }
    });
  } catch (err) { console.error('CM trend error:', err); }
}

function renderRevSpend(rows) {
  const labels = rows.map(r => r.ASIN);
  const rev    = rows.map(r => parseFloat(r.TOTAL_REVENUE  || 0));
  const spend  = rows.map(r => parseFloat(r.TOTAL_AD_SPEND || 0));

  if (revSpendChart) revSpendChart.destroy();
  revSpendChart = new Chart($('rev-spend-chart'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Revenue',  data: rev,   backgroundColor: 'rgba(26,86,219,.7)' },
        { label: 'Ad Spend', data: spend, backgroundColor: 'rgba(200,30,30,.7)' }
      ]
    },
    options: { responsive: true, plugins: { legend: { position: 'top' } }, scales: { y: { ticks: { callback: v => '$' + v } } } }
  });
}

async function loadCampaignData() {
  try {
    const res = await fetch(`/dashboard/performance?days=${currentDays}&limit=20`, { credentials: 'include' });
    const { topPerformers } = await res.json();
    if (!topPerformers.length) return;

    const labels = topPerformers.slice(0, 8).map(r => r.ASIN);
    const cm     = topPerformers.slice(0, 8).map(r => parseFloat(r.TOTAL_CM || 0).toFixed(2));
    const spend  = topPerformers.slice(0, 8).map(r => parseFloat(r.TOTAL_AD_SPEND || 0).toFixed(2));

    if (campaignChart) campaignChart.destroy();
    campaignChart = new Chart($('campaign-chart'), {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Contribution Margin', data: cm,    backgroundColor: 'rgba(5,122,85,.7)' },
          { label: 'Ad Spend',            data: spend, backgroundColor: 'rgba(200,30,30,.7)' }
        ]
      },
      options: { responsive: true, plugins: { legend: { position: 'top' } }, scales: { y: { ticks: { callback: v => '$' + v } } } }
    });

    // ACOS chart
    const acosData = topPerformers.slice(0, 8).map(r => {
      const rev = parseFloat(r.TOTAL_REVENUE || 0);
      const sp  = parseFloat(r.TOTAL_AD_SPEND || 0);
      return rev > 0 ? parseFloat(((sp / rev) * 100).toFixed(1)) : 0;
    });

    if (acosChart) acosChart.destroy();
    acosChart = new Chart($('acos-chart'), {
      type: 'bar',
      data: {
        labels,
        datasets: [{ label: 'ACOS %', data: acosData, backgroundColor: 'rgba(26,86,219,.7)' }]
      },
      options: { responsive: true, plugins: { legend: { position: 'top' } }, scales: { y: { ticks: { callback: v => v + '%' } } } }
    });
  } catch (err) { console.error('Campaign chart error:', err); }
}

// Trend indicator badge — used in ASIN tables
function trendBadge(asin, trendMap) {
  if (!trendMap || !trendMap[asin]) return '';
  const t = trendMap[asin];
  const icon  = t.trend === 'improving' ? '📈' : t.trend === 'declining' ? '📉' : '➡️';
  const color = t.trend === 'improving' ? 'var(--success)' : t.trend === 'declining' ? 'var(--danger)' : 'var(--gray-400)';
  const wow   = t.wowChangePct != null ? ` ${t.wowChangePct > 0 ? '+' : ''}${t.wowChangePct.toFixed(0)}% WoW` : '';
  return `<span style="font-size:11px;color:${color};margin-left:4px" title="${t.trendLabel}${wow}">${icon}${wow}</span>`;
}

let _trendMap = null; // cache per load

async function loadTrendMap() {
  if (_trendMap) return _trendMap;
  try {
    const res = await fetch(`/dashboard/profitability-trend?days=90&limit=50`, { credentials: 'include' });
    if (!res.ok) return {};
    const d = await res.json();
    _trendMap = {};
    (d.asins || []).forEach(a => { _trendMap[a.asin] = a; });
    return _trendMap;
  } catch { return {}; }
}

function renderTopAsins(rows) {
  const tbody = $('top-asins-body');
  if (!rows.length) { tbody.innerHTML = '<tr><td colspan="8" class="loading-cell">No data yet</td></tr>'; return; }

  // Load trends async and re-render badges when ready
  loadTrendMap().then(trendMap => {
    tbody.innerHTML = rows.slice(0, 10).map(r => {
      const asin    = r.ASIN || r.asin;
      const cm1     = r.cm1     != null ? r.cm1     : (r.TOTAL_CM1 != null ? Number(r.TOTAL_CM1) : null);
      const cm2     = r.cm2     != null ? r.cm2     : (r.TOTAL_CM2 != null ? Number(r.TOTAL_CM2) : null);
      const cm3     = r.cm3     != null ? r.cm3     : (r.TOTAL_CM3 != null ? Number(r.TOTAL_CM3) : null);
      const cm3Unit = r.cm3PerUnit != null ? r.cm3PerUnit : (r.AVG_CM3_PER_UNIT != null ? Number(r.AVG_CM3_PER_UNIT) : null);

      const cm3Cls = cm3 == null ? 'cm-neutral' : cm3 < 0 ? 'cm-negative' : cm3 > 0 ? 'cm-positive' : 'cm-neutral';
      const profitBadge = cm3 != null && cm3 < 0
        ? ' <span style="font-size:10px;color:var(--danger);font-weight:700">⚠ LOSING</span>' : '';
      const vendorBadge = r.vendorCm1IsEstimate || r.VENDOR_CM1_IS_ESTIMATE
        ? ' <span style="font-size:10px;color:#b45309" title="Excludes Amazon deductions. Full remittance data coming soon.">⚠️</span>' : '';
      const cogsNote = cm2 == null
        ? '<span style="color:var(--gray-400);font-size:11px">COGS not set</span>'
        : `<span class="${cm3Cls}">${fmt$(cm2)}</span>`;
      const title = r.PRODUCT_TITLE || r.product_title
        ? `<div style="font-weight:600;font-size:12px">${(r.PRODUCT_TITLE || r.product_title || '').substring(0, 60)}</div><div style="color:var(--gray-400);font-size:11px">${r.SKU || r.sku || ''}</div>`
        : asin;

      return `<tr>
        <td style="max-width:180px">${title}</td>
        <td style="font-size:11px;color:var(--gray-400)">${asin}</td>
        <td>${Number(r.TOTAL_UNITS || r.total_units || 0).toLocaleString()}</td>
        <td>${fmt$(r.TOTAL_REVENUE || r.total_revenue)}</td>
        <td>${cm1 != null ? fmt$(cm1) + vendorBadge : '—'}</td>
        <td>${cogsNote}</td>
        <td class="${cm3Cls}">${cm3 != null ? fmt$(cm3) : '—'}${profitBadge}${trendBadge(asin, trendMap)}</td>
        <td class="${cm3Cls}">${cm3Unit != null ? fmt$(cm3Unit) : '—'}</td>
      </tr>`;
    }).join('');
  });

  // Render immediately without trends while loading
  tbody.innerHTML = rows.slice(0, 10).map(r => {
    const asin    = r.ASIN || r.asin;
    const cm1     = r.cm1 != null ? r.cm1 : (r.TOTAL_CM1 != null ? Number(r.TOTAL_CM1) : null);
    const cm2     = r.cm2 != null ? r.cm2 : (r.TOTAL_CM2 != null ? Number(r.TOTAL_CM2) : null);
    const cm3     = r.cm3 != null ? r.cm3 : (r.TOTAL_CM3 != null ? Number(r.TOTAL_CM3) : null);
    const cm3Unit = r.cm3PerUnit != null ? r.cm3PerUnit : (r.AVG_CM3_PER_UNIT != null ? Number(r.AVG_CM3_PER_UNIT) : null);
    const cm3Cls  = cm3 == null ? 'cm-neutral' : cm3 < 0 ? 'cm-negative' : cm3 > 0 ? 'cm-positive' : 'cm-neutral';
    const profitBadge = cm3 != null && cm3 < 0 ? ' <span style="font-size:10px;color:var(--danger);font-weight:700">⚠ LOSING</span>' : '';
    const vendorBadge = r.vendorCm1IsEstimate || r.VENDOR_CM1_IS_ESTIMATE ? ' <span style="font-size:10px;color:#b45309">⚠️</span>' : '';
    const cogsNote = cm2 == null ? '<span style="color:var(--gray-400);font-size:11px">COGS not set</span>' : `<span class="${cm3Cls}">${fmt$(cm2)}</span>`;
    const title = r.PRODUCT_TITLE || r.product_title
      ? `<div style="font-weight:600;font-size:12px">${(r.PRODUCT_TITLE || r.product_title || '').substring(0, 60)}</div><div style="color:var(--gray-400);font-size:11px">${r.SKU || r.sku || ''}</div>`
      : asin;
    return `<tr>
      <td style="max-width:180px">${title}</td>
      <td style="font-size:11px;color:var(--gray-400)">${asin}</td>
      <td>${Number(r.TOTAL_UNITS || r.total_units || 0).toLocaleString()}</td>
      <td>${fmt$(r.TOTAL_REVENUE || r.total_revenue)}</td>
      <td>${cm1 != null ? fmt$(cm1) + vendorBadge : '—'}</td>
      <td>${cogsNote}</td>
      <td class="${cm3Cls}">${cm3 != null ? fmt$(cm3) : '—'}${profitBadge}</td>
      <td class="${cm3Cls}">${cm3Unit != null ? fmt$(cm3Unit) : '—'}</td>
    </tr>`;
  }).join('');
}

function renderBottomAsins(rows) {
  const tbody = $('bottom-asins-body');
  if (!rows.length) { tbody.innerHTML = '<tr><td colspan="8" class="loading-cell">No data yet</td></tr>'; return; }
  tbody.innerHTML = rows.slice(0, 10).map(r => {
    const cm1     = r.cm1     != null ? r.cm1     : (r.TOTAL_CM1 != null ? Number(r.TOTAL_CM1) : null);
    const cm2     = r.cm2     != null ? r.cm2     : (r.TOTAL_CM2 != null ? Number(r.TOTAL_CM2) : null);
    const cm3     = r.cm3     != null ? r.cm3     : (r.TOTAL_CM3 != null ? Number(r.TOTAL_CM3) : null);
    const cm3Unit = r.cm3PerUnit != null ? r.cm3PerUnit : (r.AVG_CM3_PER_UNIT != null ? Number(r.AVG_CM3_PER_UNIT) : null);
    const profitable = r.profitable != null ? r.profitable : (cm3 != null ? cm3 >= 0 : null);

    const cm3Cls   = cm3 == null ? 'cm-neutral' : cm3 < 0 ? 'cm-negative' : cm3 > 0 ? 'cm-positive' : 'cm-neutral';
    const urgency  = cm3 != null && cm3 < 0 ? '🔴 Losing money' : (cm3 != null && cm3 < 10 ? '🟡 Marginal' : '');
    const cogsNote = cm2 == null ? '<span style="color:var(--gray-400);font-size:11px">COGS not set</span>' : `<span class="${cm3Cls}">${fmt$(cm2)}</span>`;
    const vendorBadge = r.vendorCm1IsEstimate || r.VENDOR_CM1_IS_ESTIMATE
      ? ' <span style="font-size:10px;color:#b45309" title="Excludes Amazon deductions. Full remittance data coming soon.">⚠️</span>'
      : '';
    const title  = r.PRODUCT_TITLE || r.product_title
      ? `<div style="font-weight:600;font-size:12px">${(r.PRODUCT_TITLE || r.product_title || '').substring(0, 60)}</div><div style="color:var(--gray-400);font-size:11px">${r.SKU || r.sku || ''}</div>`
      : r.ASIN || r.asin;
    return `<tr>
      <td style="max-width:180px">${title}</td>
      <td>${fmt$(r.TOTAL_REVENUE || r.total_revenue)}</td>
      <td>${fmt$(r.TOTAL_AD_SPEND || r.total_ad_spend)}</td>
      <td>${cm1 != null ? fmt$(cm1) + vendorBadge : '—'}</td>
      <td>${cogsNote}</td>
      <td class="${cm3Cls}">${cm3 != null ? fmt$(cm3) : '—'} ${urgency ? `<small>${urgency}</small>` : ''}</td>
      <td class="${cm3Cls}">${cm3Unit != null ? fmt$(cm3Unit) : '—'}</td>
      <td><button class="btn-connect" onclick="alert('Decisioning coming soon!')">Review</button></td>
    </tr>`;
  }).join('');
}

// ---- Connections ----
async function loadConnections() {
  try {
    const res = await fetch('/amazon/status', { credentials: 'include' });
    const status = await res.json();
    const grid = $('connections-grid');

    const icons = { ads: '📢', dsp: '🎯', seller: '🛒', vendor: '🏭' };

    grid.innerHTML = Object.entries(status).map(([type, info]) => `
      <div class="connection-card ${info.connected ? 'connected' : ''}">
        <div class="connection-info">
          <h4>${icons[type]} ${info.label}</h4>
          <p>${info.connected ? `Connected • expires ${new Date(info.expiresAt).toLocaleDateString()}` : 'Not connected'}</p>
        </div>
        ${info.connected
          ? `<span class="connection-badge badge-connected">Connected</span>`
          : `<a href="/amazon/connect/${type}" class="btn-connect">Connect</a>`
        }
      </div>
    `).join('');

    // Sync status
    const dashRes = await fetch('/dashboard', { credentials: 'include' });
    const { ingestion } = await dashRes.json();
    const syncList = $('sync-status-list');
    if (!ingestion || !ingestion.length) {
      syncList.innerHTML = '<p style="color:var(--gray-400);font-size:13px">No sync history yet</p>';
      return;
    }
    syncList.innerHTML = ingestion.map(row => `
      <div class="sync-item">
        <span><span class="sync-dot dot-${row.STATUS}"></span>${row.CONNECTION_TYPE} / ${row.JOB_TYPE}</span>
        <span style="color:var(--gray-400)">${row.STATUS} • ${row.RECORDS_WRITTEN || 0} records</span>
      </div>
    `).join('');
  } catch (err) { console.error('Connections error:', err); }
}

// ---- Bell + Insights Panel ----
let insightsData = [];

async function loadDecisions() {
  try {
    const res = await fetch(`/decisions?days=${currentDays}`, { credentials: 'include' });
    const { insights } = await res.json();
    insightsData = (insights || []).slice(0, 3); // top 3 only

    // Update bell badge
    const badge = $('bell-badge');
    const count = insightsData.length;
    if (count > 0) {
      badge.textContent = count;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  } catch (err) { console.error('Decisions error:', err); }
}

function setupBell() {
  const btn     = $('bell-btn');
  const panel   = $('insights-panel');
  const overlay = $('insights-overlay');
  const close   = $('insights-close');

  function openPanel() {
    renderInsights();
    panel.classList.remove('hidden');
    overlay.classList.remove('hidden');
    setTimeout(() => panel.classList.add('open'), 10);
  }

  function closePanel() {
    panel.classList.remove('open');
    setTimeout(() => {
      panel.classList.add('hidden');
      overlay.classList.add('hidden');
    }, 250);
  }

  btn.addEventListener('click', openPanel);
  overlay.addEventListener('click', closePanel);
  close.addEventListener('click', closePanel);
}

function renderInsights() {
  const list = $('insights-list');
  if (!insightsData.length) {
    list.innerHTML = `<div class="insights-empty"><div class="insights-check">✅</div><strong>All clear!</strong><p style="margin-top:8px;font-size:13px">No critical issues detected.<br>Your account is looking healthy.</p></div>`;
    return;
  }
  list.innerHTML = insightsData.map(i => `
    <div class="insight-card ${i.type}">
      <div class="insight-card-title">${i.title}</div>
      <div class="insight-card-msg">${i.message}</div>
      ${i.action ? `<button class="insight-card-action" onclick="handleInsightAction('${i.action.type}', ${JSON.stringify(i.action).replace(/"/g, '&quot;')})">${i.action.label} →</button>` : ''}
    </div>
  `).join('');
}

function handleInsightAction(type, action) {
  if (action.link) { window.location.href = action.link; return; }
  alert(`${action.label} — one-click ad actions coming soon!`);
}

// ---- CM Waterfall ----
// Correct model:
//   Revenue (gross)
//   − Amazon fees (FBA + referral for seller; ≈0 for vendor Option A)
//   = CM1: Net Amazon Proceeds   ← "net cash from Amazon"
//   − COGS (brand's internal cost)
//   = CM2: Gross Profit          ← "is this product worth selling?"
//   − Ad Spend (direct ASIN attribution)
//   = CM3: True Profitability    ← "is advertising this product profitable?"
function renderCmWaterfall(cm) {
  const card     = $('cm-waterfall-card');
  const body     = $('cm-waterfall-body');
  const vendNote = $('cm-waterfall-vendor-note');
  if (!card || !body) return;
  if (!cm || cm.revenue <= 0) { card.style.display = 'none'; return; }
  card.style.display = '';

  // Show vendor caveat if applicable
  if (vendNote) {
    vendNote.style.display = cm.vendorCm1IsEstimate ? '' : 'none';
  }

  const rev = cm.revenue;
  function bar(value, cls) {
    const pct = rev > 0 ? Math.max(0, Math.min(100, (Math.abs(value) / rev) * 100)) : 0;
    const isNeg = value < 0;
    return `<div class="cm-waterfall-bar-wrap"><div class="cm-waterfall-bar ${isNeg ? 'bar-negative' : cls}" style="width:${pct}%"></div></div>`;
  }
  function pctStr(v) {
    return rev > 0 ? `<span class="cm-wf-pct">${((v/rev)*100).toFixed(1)}%</span>` : '';
  }
  function nullFmt(v) { return v != null ? fmt$(v) : '<span style="color:var(--gray-400);font-size:12px">COGS not set</span>'; }

  // CM1 from API (pre-computed correctly)
  const cm1 = cm.cm1 != null ? cm.cm1 : (cm.revenue - (cm.amazonFees || (cm.fbaFees + cm.referralFees)));
  const amazonFees = cm.amazonFees || ((cm.fbaFees || 0) + (cm.referralFees || 0));

  // Vendor label adjustment
  const cm1Label = cm.vendorCm1IsEstimate
    ? 'CM1 – Net Amazon Proceeds ⚠️ <span style="font-size:11px;font-weight:400">(estimate — excl. deductions)</span>'
    : 'CM1 – Net Amazon Proceeds';
  const amazonFeesLabel = cm.vendorCm1IsEstimate
    ? '− Amazon Fees <span style="font-size:11px;font-weight:400">(N/A — vendor remittance)</span>'
    : '− Amazon Fees (FBA + Referral)';

  const rows = [
    { label: 'Revenue (gross)',           value: rev,          cls: 'bar-revenue', style: '' },
    { label: amazonFeesLabel,             value: -amazonFees,  cls: 'bar-negative', style: 'color:var(--danger)', skip: cm.vendorCm1IsEstimate && amazonFees === 0 },
    { label: cm1Label,                    value: cm1,          cls: 'bar-cm1', style: 'font-weight:700' },
    { label: '− COGS (your product cost)',value: -(cm.cogs || 0), cls: 'bar-negative', style: 'color:var(--danger)' },
    { label: 'CM2 – Gross Profit',        value: cm.cm2,       cls: 'bar-cm2', style: 'font-weight:700', nullable: true },
    { label: '− Ad Spend (direct ASIN)',  value: -(cm.adSpend || 0), cls: 'bar-negative', style: 'color:var(--danger)' },
    { label: 'CM3 – True Profitability',  value: cm.cm3,       cls: cm.cm3 != null && cm.cm3 < 0 ? 'bar-negative' : 'bar-cm3', style: 'font-weight:700;font-size:14px' + (cm.cm3 != null && cm.cm3 < 0 ? ';color:var(--danger)' : ''), nullable: true },
  ];

  body.innerHTML = `<div class="cm-waterfall">` + rows
    .filter(r => !r.skip)
    .map(r => {
      const displayVal = r.nullable ? nullFmt(r.value) : fmt$(r.value);
      const barVal     = r.value != null ? r.value : 0;
      const pct        = r.value !== rev && r.value != null && r.value >= 0 ? pctStr(r.value) : '';
      return `<div class="cm-waterfall-row">
      <div class="cm-waterfall-label" style="${r.style}">${r.label}</div>
      ${bar(barVal, r.cls)}
      <div class="cm-waterfall-value" style="${r.style}">${displayVal}${pct}</div>
    </div>`;
    }).join('') + `</div>`;
}

// ---- TACOS KPI ----
async function loadTacos() {
  try {
    const res = await fetch(`/dashboard/tacos?days=${currentDays}`, { credentials: 'include' });
    if (!res.ok) return;
    const data = await res.json();
    const card = $('kpi-tacos-card');
    if (card && data.tacos != null) {
      $('kpi-tacos').textContent = (data.tacos * 100).toFixed(1) + '%';
      card.style.display = '';
    }
  } catch { /* TACOS is optional */ }
}

// ---- Forecast Tab ----
let forecastLoaded = false;
async function loadForecast() {
  if (forecastLoaded) return;
  forecastLoaded = true;
  try {
    const res = await fetch('/dashboard/forecast?days=90', { credentials: 'include' });
    if (!res.ok) return;
    const data = await res.json();

    if (!data.available) {
      $('forecast-avg7').textContent    = '—';
      $('forecast-monthly').textContent = 'No data';
      $('forecast-annual').textContent  = '—';
      $('forecast-slope').textContent   = '—';
      return;
    }

    $('forecast-avg7').textContent      = fmt$(data.rollingAvg7d) + '/day';
    $('forecast-monthly').textContent   = fmt$(data.projectedMonthly);
    $('forecast-monthly-sub').textContent = `Day ${data.dayOfMonth} of ${data.daysInMonth} · MTD ${fmt$(data.mtdRevenue)}`;
    $('forecast-annual').textContent    = fmt$(data.projectedAnnual);

    const slopeSign = data.trend30dSlope >= 0 ? '+' : '';
    $('forecast-slope').textContent     = slopeSign + fmt$(data.trend30dSlope) + '/day';
    const slopeEl = $('forecast-slope');
    slopeEl.style.color = data.trend30dSlope >= 0 ? 'var(--success)' : 'var(--danger)';
    $('forecast-slope-sub').textContent = data.trendDirection === 'up'
      ? '📈 Growing trend'
      : data.trendDirection === 'down'
        ? '📉 Declining trend'
        : '➡️ Flat trend';

    // Trend chart
    if (data.dailySeries?.length) {
      const labels  = data.dailySeries.map(d => d.date);
      const revs    = data.dailySeries.map(d => d.revenue);

      // Build 7-day rolling average series
      const rolling = revs.map((_, i) => {
        const start = Math.max(0, i - 6);
        const slice = revs.slice(start, i + 1);
        return slice.reduce((s, v) => s + v, 0) / slice.length;
      });

      // Build linear regression line for last 30 points
      const n = data.dailySeries.length;
      const last30start = Math.max(0, n - 30);
      const trendLine = revs.map((_, i) => {
        if (i < last30start) return null;
        const xi = i - last30start;
        const yMean = revs.slice(last30start).reduce((s, v) => s + v, 0) / (n - last30start);
        return yMean + data.trend30dSlope * (xi - (n - last30start - 1) / 2);
      });

      if (forecastChart) forecastChart.destroy();
      forecastChart = new Chart($('forecast-trend-chart'), {
        type: 'line',
        data: {
          labels,
          datasets: [
            {
              label: 'Daily Revenue',
              data: revs,
              borderColor: 'rgba(26,86,219,0.4)',
              backgroundColor: 'rgba(26,86,219,0.04)',
              tension: 0.1,
              fill: true,
              pointRadius: 2
            },
            {
              label: '7-Day Rolling Avg',
              data: rolling,
              borderColor: '#1a56db',
              backgroundColor: 'transparent',
              tension: 0.4,
              borderWidth: 2.5,
              pointRadius: 0
            },
            {
              label: '30-Day Trend',
              data: trendLine,
              borderColor: data.trend30dSlope >= 0 ? '#057a55' : '#e02424',
              backgroundColor: 'transparent',
              tension: 0,
              borderWidth: 2,
              borderDash: [6, 3],
              pointRadius: 0
            }
          ]
        },
        options: {
          responsive: true,
          plugins: { legend: { position: 'top' } },
          scales: { y: { ticks: { callback: v => '$' + Number(v).toLocaleString() } } }
        }
      });
    }
  } catch (err) { console.error('Forecast load error:', err); }
}

// ---- Budget Pacing Tab ----
let pacingLoaded = false;
async function loadBudgetPacing() {
  if (pacingLoaded) return;
  pacingLoaded = true;
  try {
    const res = await fetch('/dashboard/budget-pacing', { credentials: 'include' });
    if (!res.ok) return;
    const data = await res.json();

    // Summary KPIs
    $('pacing-mtd-spend').textContent = fmt$(data.summary.totalMtdSpend);
    $('pacing-mtd-sub').textContent   = `Day ${data.dayOfMonth} of ${data.daysInMonth}`;
    $('pacing-budget').textContent    = fmt$(data.summary.totalMonthlyBudget);
    $('pacing-over').textContent      = data.summary.overPacing;
    $('pacing-under').textContent     = data.summary.underPacing;

    if (data.summary.overPacing > 0) {
      $('pacing-over-card').style.border = '1px solid var(--danger)';
      $('pacing-over').style.color = 'var(--danger)';
    }
    if (data.summary.underPacing > 0) {
      $('pacing-under-card').style.border = '1px solid var(--warning, #f59e0b)';
      $('pacing-under').style.color = '#f59e0b';
    }

    const tbody = $('pacing-body');
    if (!data.campaigns?.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="loading-cell">No campaigns with budgets found. Campaign budget data comes from the ads sync.</td></tr>';
      return;
    }

    tbody.innerHTML = data.campaigns.map(c => {
      const statusIcon = c.pacingStatus === 'over_pacing'  ? '🔴'
                       : c.pacingStatus === 'under_pacing' ? '🟡' : '🟢';
      const pacingPct = c.pacingRatio != null ? (c.pacingRatio * 100).toFixed(0) + '%' : '—';
      const cls = c.pacingStatus === 'over_pacing' ? 'cm-negative' : c.pacingStatus === 'under_pacing' ? '' : 'cm-positive';
      return `<tr>
        <td style="font-size:12px">${c.campaignName || c.campaignId}</td>
        <td><span style="font-size:11px;color:var(--gray-400)">${c.campaignType || c.connectionType || '—'}</span></td>
        <td>${fmt$(c.dailyBudget)}</td>
        <td>${fmt$(c.monthlyBudget)}</td>
        <td><strong>${fmt$(c.mtdSpend)}</strong></td>
        <td>${fmt$(c.expectedMtdSpend)}</td>
        <td class="${cls}"><strong>${pacingPct}</strong> of expected</td>
        <td>${statusIcon} ${c.pacingStatus.replace('_', ' ')}</td>
      </tr>`;
    }).join('');
  } catch (err) { console.error('Pacing load error:', err); }
}

// ---- New-to-Brand Tab ----
let ntbLoaded = false;
async function loadNtb() {
  if (ntbLoaded) return;
  ntbLoaded = true;
  try {
    const res = await fetch(`/dashboard/ntb?days=${currentDays}`, { credentials: 'include' });
    if (!res.ok) return;
    const data = await res.json();

    if (!data.available) {
      $('ntb-unavailable').style.display = '';
      $('ntb-content').style.display = 'none';
      return;
    }

    $('ntb-unavailable').style.display = 'none';
    $('ntb-content').style.display = '';

    $('ntb-orders').textContent = Number(data.ntbOrders).toLocaleString();
    $('ntb-order-rate-sub').textContent = data.ntbOrderRate != null
      ? `${(data.ntbOrderRate * 100).toFixed(1)}% of total orders`
      : '—% of total orders';
    $('ntb-sales').textContent = fmt$(data.ntbSales);
    $('ntb-revenue-rate-sub').textContent = data.ntbRevenueRate != null
      ? `${(data.ntbRevenueRate * 100).toFixed(1)}% of ad revenue`
      : '—% of ad revenue';
    $('ntb-roas').textContent = data.ntbRoas != null ? data.ntbRoas.toFixed(2) + 'x' : '—';
    $('ntb-acos').textContent = data.ntbAcos != null ? (data.ntbAcos * 100).toFixed(1) + '%' : '—';

    // NTB by campaign table
    const tbody = $('ntb-body');
    if (data.byCampaign?.length) {
      tbody.innerHTML = data.byCampaign.map(c => `<tr>
        <td style="font-size:12px">${c.campaignName || c.campaignId}</td>
        <td><span style="font-size:11px;color:var(--gray-400)">${c.campaignType || '—'}</span></td>
        <td>${Number(c.totalOrders).toLocaleString()}</td>
        <td><strong>${Number(c.ntbOrders).toLocaleString()}</strong></td>
        <td>${c.ntbOrderRate != null ? (c.ntbOrderRate * 100).toFixed(1) + '%' : '—'}</td>
        <td>${fmt$(c.ntbSales)}</td>
        <td>${c.ntbRoas != null ? c.ntbRoas.toFixed(2) + 'x' : '—'}</td>
      </tr>`).join('');
    } else {
      tbody.innerHTML = '<tr><td colspan="7" class="loading-cell">No NTB campaign data</td></tr>';
    }
  } catch (err) { console.error('NTB load error:', err); }
}

// ---- Profitability Trends ----
let trendsLoaded = false;
async function loadProfitabilityTrends() {
  if (trendsLoaded) return;
  trendsLoaded = true;
  const tbody = $('trends-body');
  const kpis  = $('trends-kpis');
  const label = $('trends-summary-label');
  try {
    const res = await fetch(`/dashboard/profitability-trend?days=90&limit=50`, { credentials: 'include' });
    const d   = await res.json();

    if (!d.available) {
      tbody.innerHTML = `<tr><td colspan="9" class="loading-cell">${d.reason || 'No data yet'}</td></tr>`;
      return;
    }

    // Summary KPIs
    const s = d.summary;
    label.textContent = `${s.total} products tracked over 90 days`;
    kpis.innerHTML = `
      <div class="kpi-card" style="border-color:var(--success);background:var(--success-bg)">
        <div class="kpi-label">📈 Scaling Opportunity</div>
        <div class="kpi-value" style="color:var(--success)">${s.scalingOpportunity}</div>
        <div class="kpi-sub">Profitable & improving</div>
      </div>
      <div class="kpi-card" style="border-color:var(--warning);background:var(--warning-bg)">
        <div class="kpi-label">⚠️ Profitable Declining</div>
        <div class="kpi-value" style="color:var(--warning)">${s.profitableDecline}</div>
        <div class="kpi-sub">Watch these</div>
      </div>
      <div class="kpi-card" style="border-color:var(--danger);background:var(--danger-bg)">
        <div class="kpi-label">🔴 Losing Money</div>
        <div class="kpi-value" style="color:var(--danger)">${s.losingMoney}</div>
        <div class="kpi-sub">${s.recovering} recovering</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">🟡 Inconsistent</div>
        <div class="kpi-value">${s.inconsistent}</div>
        <div class="kpi-sub">Review pricing/COGS</div>
      </div>
    `;

    const signalLabel = {
      scaling_opportunity:     '📈 Scale',
      profitable_declining:    '⚠️ Watch',
      losing_money_recovering: '🔄 Recovering',
      losing_money_worsening:  '🔴 Act Now',
      inconsistent:            '🟡 Inconsistent',
      stable:                  '✅ Stable'
    };
    const signalColor = {
      scaling_opportunity:     'var(--success)',
      profitable_declining:    'var(--warning)',
      losing_money_recovering: '#b45309',
      losing_money_worsening:  'var(--danger)',
      inconsistent:            'var(--warning)',
      stable:                  'var(--gray-400)'
    };

    tbody.innerHTML = d.asins.map(a => {
      const wowCls   = a.wowChangePct == null ? '' : a.wowChangePct > 0 ? 'cm-positive' : a.wowChangePct < 0 ? 'cm-negative' : '';
      const trendIcon = a.trend === 'improving' ? '📈' : a.trend === 'declining' ? '📉' : '➡️';
      return `<tr>
        <td style="max-width:160px;font-size:12px">${a.title ? a.title.substring(0, 55) : a.asin}</td>
        <td style="font-size:11px;color:var(--gray-400)">${a.asin}</td>
        <td><span style="font-size:12px;font-weight:600;color:${signalColor[a.signal]}">${signalLabel[a.signal] || a.signal}</span></td>
        <td>${trendIcon} <span style="font-size:12px">${a.trendLabel}</span></td>
        <td class="${a.cm3Last7 >= 0 ? 'cm-positive' : 'cm-negative'}">${fmt$(a.cm3Last7)}</td>
        <td class="${a.cm3Prev7 >= 0 ? 'cm-positive' : 'cm-negative'}">${fmt$(a.cm3Prev7)}</td>
        <td class="${wowCls}">${a.wowChangePct != null ? (a.wowChangePct > 0 ? '+' : '') + a.wowChangePct.toFixed(1) + '%' : '—'}</td>
        <td>${a.breakEvenAcos != null ? a.breakEvenAcos.toFixed(1) + '%' : '—'}</td>
        <td style="font-size:12px">${a.profitableDays}/${a.totalDays} days</td>
      </tr>`;
    }).join('');

  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="9" class="loading-cell">Error loading trends</td></tr>`;
    console.error('Profitability trends error:', err);
  }
}

// ---- Helpers ----
function fmt$(n) {
  const v = parseFloat(n || 0);
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
