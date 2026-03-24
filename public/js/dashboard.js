// CalBridge Dashboard — client-side JS

const $ = id => document.getElementById(id);
let cmTrendChart, revSpendChart, campaignChart, acosChart;
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

// ---- Helpers ----
function fmt$(n) {
  const v = parseFloat(n || 0);
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
