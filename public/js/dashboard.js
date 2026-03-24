// CalBridge Dashboard — client-side JS

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
    $('kpi-revenue').textContent    = fmt$(summary.totalRetailSales);
    $('kpi-revenue-sub').textContent = `Seller ${fmt$(summary.sellerRevenue)} · Vendor ${fmt$(summary.vendorRevenue)}`;
    $('kpi-ad-sales').textContent   = fmt$(summary.totalAdSales);
    $('kpi-ad-sales-sub').textContent = `${summary.totalAdOrders.toLocaleString()} orders`;
    $('kpi-spend').textContent      = fmt$(summary.totalAdSpend);
    $('kpi-spend-sub').textContent  = summary.acos ? `${(summary.acos * 100).toFixed(1)}% ACOS` : '';
    $('kpi-roas').textContent       = summary.totalRoas ? `${summary.totalRoas.toFixed(2)}x` : '—';
    $('kpi-ad-roas').textContent    = summary.adRoas    ? `${summary.adRoas.toFixed(2)}x`    : '—';

    // CM from performers
    const totals = topPerformers.reduce((acc, r) => {
      acc.cm  += Number(r.TOTAL_CM  || 0);
      return acc;
    }, { cm: 0 });
    const cmPct = summary.totalRetailSales > 0 ? (totals.cm / summary.totalRetailSales) * 100 : 0;
    $('kpi-cm').textContent     = fmt$(totals.cm);
    $('kpi-cm-sub').textContent = `${cmPct.toFixed(1)}% of retail sales`;
    $('kpi-acos').textContent   = summary.acos ? `${(summary.acos * 100).toFixed(1)}%` : '—';

    // CM Waterfall
    if (summary.cmBreakdown) renderCmWaterfall(summary.cmBreakdown);

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

    const trendRes = await fetch(`/dashboard/asin/${topPerformers[0].ASIN}?days=${currentDays}`, { credentials: 'include' });
    const { trend } = await trendRes.json();

    const labels = trend.map(r => {
      const d = r.CALC_DATE?.value || r.CALC_DATE;
      return typeof d === 'string' ? d.substring(0, 10) : new Date(d).toISOString().substring(0, 10);
    });
    const cmData = trend.map(r => parseFloat(r.CONTRIBUTION_MARGIN || 0).toFixed(2));
    const revData = trend.map(r => parseFloat(r.REVENUE || 0).toFixed(2));

    if (cmTrendChart) cmTrendChart.destroy();
    cmTrendChart = new Chart($('cm-trend-chart'), {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'Revenue', data: revData, borderColor: '#1a56db', backgroundColor: 'rgba(26,86,219,.08)', tension: .4, fill: true },
          { label: 'Contribution Margin', data: cmData, borderColor: '#057a55', backgroundColor: 'rgba(5,122,85,.08)', tension: .4, fill: true }
        ]
      },
      options: { responsive: true, plugins: { legend: { position: 'top' } }, scales: { y: { ticks: { callback: v => '$' + Number(v).toFixed(0) } } } }
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

function renderTopAsins(rows) {
  const tbody = $('top-asins-body');
  if (!rows.length) { tbody.innerHTML = '<tr><td colspan="9" class="loading-cell">No data yet</td></tr>'; return; }
  tbody.innerHTML = rows.slice(0, 10).map(r => {
    const cm      = parseFloat(r.TOTAL_CM         || 0);
    const pct     = parseFloat(r.AVG_CM_PERCENT   || 0);
    const unitCm  = r.AVG_UNIT_CM        != null ? parseFloat(r.AVG_UNIT_CM)        : null;
    const unitPct = r.AVG_UNIT_CM_PERCENT != null ? parseFloat(r.AVG_UNIT_CM_PERCENT) : null;
    const cls = cm > 0 ? 'cm-positive' : cm < 0 ? 'cm-negative' : 'cm-neutral';
    const title = r.PRODUCT_TITLE ? `<div style="font-weight:600;font-size:12px">${r.PRODUCT_TITLE}</div><div style="color:var(--gray-400);font-size:11px">${r.SKU || ''}</div>` : r.ASIN;
    return `<tr>
      <td style="max-width:180px">${title}</td>
      <td style="font-size:11px;color:var(--gray-400)">${r.ASIN}</td>
      <td>${Number(r.TOTAL_UNITS || 0).toLocaleString()}</td>
      <td>${fmt$(r.TOTAL_REVENUE)}</td>
      <td>${fmt$(r.TOTAL_AD_SPEND)}</td>
      <td class="${cls}">${fmt$(cm)}</td>
      <td class="${cls}">${pct.toFixed(1)}%</td>
      <td class="${cls}">${unitCm != null ? fmt$(unitCm) : '—'}</td>
      <td class="${cls}">${unitPct != null ? unitPct.toFixed(1) + '%' : '—'}</td>
    </tr>`;
  }).join('');
}

function renderBottomAsins(rows) {
  const tbody = $('bottom-asins-body');
  if (!rows.length) { tbody.innerHTML = '<tr><td colspan="7" class="loading-cell">No data yet</td></tr>'; return; }
  tbody.innerHTML = rows.slice(0, 10).map(r => {
    const cm     = parseFloat(r.TOTAL_CM       || 0);
    const pct    = parseFloat(r.AVG_CM_PERCENT || 0);
    const unitCm = r.AVG_UNIT_CM != null ? parseFloat(r.AVG_UNIT_CM) : null;
    const cls    = cm < 0 ? 'cm-negative' : 'cm-neutral';
    const title  = r.PRODUCT_TITLE ? `<div style="font-weight:600;font-size:12px">${r.PRODUCT_TITLE}</div><div style="color:var(--gray-400);font-size:11px">${r.SKU || ''}</div>` : r.ASIN;
    return `<tr>
      <td style="max-width:180px">${title}</td>
      <td>${fmt$(r.TOTAL_REVENUE)}</td>
      <td>${fmt$(r.TOTAL_AD_SPEND)}</td>
      <td class="${cls}">${fmt$(cm)}</td>
      <td class="${cls}">${pct.toFixed(1)}%</td>
      <td class="${cls}">${unitCm != null ? fmt$(unitCm) : '—'}</td>
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
function renderCmWaterfall(cm) {
  const card = $('cm-waterfall-card');
  const body = $('cm-waterfall-body');
  if (!card || !body) return;
  if (!cm || cm.revenue <= 0) { card.style.display = 'none'; return; }
  card.style.display = '';

  const rev = cm.revenue;
  function bar(value, cls) {
    const pct = rev > 0 ? Math.max(0, Math.min(100, (value / rev) * 100)) : 0;
    const isNeg = value < 0;
    return `<div class="cm-waterfall-bar-wrap"><div class="cm-waterfall-bar ${isNeg ? 'bar-negative' : cls}" style="width:${pct}%"></div></div>`;
  }
  function pctStr(v) {
    return rev > 0 ? `<span class="cm-wf-pct">${((v/rev)*100).toFixed(1)}%</span>` : '';
  }

  const rows = [
    { label: 'Revenue',                    value: cm.revenue,  cls: 'bar-revenue', style: '' },
    { label: '− COGS',                     value: -cm.cogs,    cls: 'bar-negative', style: 'color:var(--danger)' },
    { label: '= CM1 (Gross Margin)',        value: cm.cm1,      cls: 'bar-cm1', style: 'font-weight:700' },
    { label: '− FBA &amp; Referral Fees',  value: -cm.fbaFees, cls: 'bar-negative', style: 'color:var(--danger)' },
    { label: '= CM2 (After Amazon Fees)',   value: cm.cm2,      cls: 'bar-cm2', style: 'font-weight:700' },
    { label: '− Ad Spend',                 value: -cm.adSpend, cls: 'bar-negative', style: 'color:var(--danger)' },
    { label: '= CM3 (True Profit)',         value: cm.cm3,      cls: 'bar-cm3', style: 'font-weight:700;font-size:14px' },
  ];

  body.innerHTML = `<div class="cm-waterfall">` + rows.map(r => `
    <div class="cm-waterfall-row">
      <div class="cm-waterfall-label" style="${r.style}">${r.label}</div>
      ${bar(Math.abs(r.value), r.cls)}
      <div class="cm-waterfall-value" style="${r.style}">${fmt$(r.value)}${r.value !== cm.revenue && r.value >= 0 ? pctStr(r.value) : ''}</div>
    </div>
  `).join('') + `</div>`;
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

// ---- Helpers ----
function fmt$(n) {
  const v = parseFloat(n || 0);
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
