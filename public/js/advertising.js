// Calbridge — Advertising Page

const $ = id => document.getElementById(id);
let trendChart, channelChart, typeChart, acosTrendChart;
let currentDays = 30;
let allCampaigns = [];
let activeChannel = 'all';

const CHANNEL_LABELS = {
  all: 'Amazon Ads + DSP — unified view',
  ads: 'Sponsored Ads — SP, SB, SD',
  dsp: 'Amazon DSP — programmatic'
};

document.addEventListener('DOMContentLoaded', async () => {
  await checkAuth();
  setupControls();
  await loadAll();
});

async function checkAuth() {
  try {
    const res = await fetch('/auth/me', { credentials: 'include' });
    if (!res.ok) { window.location.href = '/index.html'; return; }
    const { client } = await res.json();
    $('client-name').textContent = client.name || client.email;
    const profileRes = await fetch('/account/profile', { credentials: 'include' });
    const profile = await profileRes.json();
    if (profile.logoUrl) {
      const logoEl = document.querySelector('.sidebar-logo img');
      if (logoEl) { logoEl.src = profile.logoUrl; logoEl.style.filter = 'none'; }
    }
    // Hide nav items based on connections
    const connRes = await fetch('/amazon/status', { credentials: 'include' });
    const conn = await connRes.json();
    const hasAds   = conn.ads?.connected || conn.dsp?.connected;
    const hasSales = conn.seller?.connected || conn.vendor?.connected;
    const hasAny   = hasAds || hasSales;
    if (!hasAny)   document.querySelector('a[href="/dashboard.html"]')?.remove();
    if (!hasSales) document.querySelector('a[href="/dashboard.html#performance"]')?.remove();
    // If no ads connected, redirect away from this page
    if (!hasAds) { window.location.href = '/account.html'; return; }
  } catch (e) {
    console.error('Auth check failed:', e);
    window.location.href = '/index.html';
  }
}

function setupControls() {
  setupDateFilter('days-filter', async (days, label) => {
    currentDays = days;
    await loadAll();
  });

  $('logout-btn').addEventListener('click', async () => {
    await fetch('/auth/logout', { method: 'POST', credentials: 'include' });
    window.location.href = '/';
  });

  // Global channel toggle — affects KPIs, all charts, and campaign table
  document.querySelectorAll('.channel-toggle .tab-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      document.querySelectorAll('.channel-toggle .tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeChannel = btn.dataset.channel;
      // Update subtitle
      const subtitle = $('channel-subtitle');
      if (subtitle) subtitle.textContent = CHANNEL_LABELS[activeChannel] || '';
      // Reload everything with new channel filter
      await loadAll();
    });
  });
}

async function loadAll() {
  try {
    await Promise.all([
      loadSummary(),
      loadTrend(),
      loadChannelSplit(),
      loadCampaignTypes(),
      loadCampaigns()
    ]);
  } catch (err) {
    console.error('loadAll error:', err);
    document.querySelector('.dashboard-section').insertAdjacentHTML('afterbegin',
      `<div class="error-banner" style="margin-bottom:16px">Error loading data: ${err.message}</div>`
    );
  }
}

function channelParam() {
  return activeChannel !== 'all' ? `&channel=${activeChannel}` : '';
}

async function loadSummary() {
  const res = await fetch(`/advertising/summary?days=${currentDays}${channelParam()}`, { credentials: 'include' });
  if (!res.ok) throw new Error(`Summary API ${res.status}`);
  const d = await res.json();
  console.log('Summary data:', d);

  $('kpi-spend').textContent       = fmt$(d.TOTAL_SPEND);
  $('kpi-sales').textContent       = fmt$(d.TOTAL_SALES);
  $('kpi-acos').textContent        = d.ACOS  ? (d.ACOS  * 100).toFixed(1) + '%' : '—';
  $('kpi-roas').textContent        = d.ROAS  ? d.ROAS.toFixed(2) + 'x'          : '—';
  $('kpi-impressions').textContent = fmtN(d.TOTAL_IMPRESSIONS);
  $('kpi-clicks').textContent      = fmtN(d.TOTAL_CLICKS);
  $('kpi-ctr').textContent         = d.CTR   ? (d.CTR   * 100).toFixed(2) + '%' : '';
}

async function loadTrend() {
  const res = await fetch(`/advertising/trend?days=${currentDays}${channelParam()}`, { credentials: 'include' });
  const rows = await res.json();

  const labels = rows.map(r => fmtDate(r.REPORT_DATE));
  const spend  = rows.map(r => parseFloat(r.SPEND  || 0));
  const sales  = rows.map(r => parseFloat(r.SALES  || 0));
  const acos   = rows.map(r => r.ACOS ? parseFloat((r.ACOS * 100).toFixed(1)) : null);

  if (trendChart) trendChart.destroy();
  trendChart = new Chart($('trend-chart'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Sales',  data: sales,  borderColor: '#1a56db', backgroundColor: 'rgba(26,86,219,.08)', tension: .4, fill: true, yAxisID: 'y' },
        { label: 'Spend',  data: spend,  borderColor: '#c81e1e', backgroundColor: 'rgba(200,30,30,.08)',  tension: .4, fill: true, yAxisID: 'y' }
      ]
    },
    options: {
      responsive: true,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { position: 'top' } },
      scales: { y: { ticks: { callback: v => '$' + v } } }
    }
  });

  if (acosTrendChart) acosTrendChart.destroy();
  acosTrendChart = new Chart($('acos-trend-chart'), {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'ACOS %',
        data: acos,
        borderColor: '#b45309',
        backgroundColor: 'rgba(180,83,9,.08)',
        tension: .4,
        fill: true,
        spanGaps: true
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { position: 'top' } },
      scales: { y: { ticks: { callback: v => v + '%' } } }
    }
  });
}

async function loadChannelSplit() {
  // Hide channel split chart when filtered to a single channel — it's redundant
  const chartCard = $('channel-chart')?.closest('.chart-card');
  if (activeChannel !== 'all') {
    if (chartCard) chartCard.style.display = 'none';
    return;
  }
  if (chartCard) chartCard.style.display = '';
  const res = await fetch(`/advertising/by-channel?days=${currentDays}`, { credentials: 'include' });
  const rows = await res.json();
  if (!rows.length) return;

  const labels = rows.map(r => r.CONNECTION_TYPE === 'ads' ? 'Amazon Ads' : 'Amazon DSP');
  const spend  = rows.map(r => parseFloat(r.SPEND || 0));

  if (channelChart) channelChart.destroy();
  channelChart = new Chart($('channel-chart'), {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{ data: spend, backgroundColor: ['#1a56db', '#057a55'], borderWidth: 2 }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: 'bottom' },
        tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${fmt$(ctx.raw)}` } }
      }
    }
  });
}

async function loadCampaignTypes() {
  const res = await fetch(`/advertising/by-campaign-type?days=${currentDays}${channelParam()}`, { credentials: 'include' });
  const rows = await res.json();
  if (!rows.length) return;

  const typeColors = {
    sponsoredProducts: '#1a56db',
    sponsoredBrands:   '#057a55',
    sponsoredDisplay:  '#b45309',
    video:             '#7e3af2',
    dsp:               '#c81e1e'
  };

  const labels = rows.map(r => fmtCampaignType(r.CAMPAIGN_TYPE, r.CONNECTION_TYPE));
  const spend  = rows.map(r => parseFloat(r.SPEND || 0));
  const colors = rows.map(r => typeColors[r.CAMPAIGN_TYPE] || typeColors[r.CONNECTION_TYPE] || '#9ca3af');

  if (typeChart) typeChart.destroy();
  typeChart = new Chart($('type-chart'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{ label: 'Spend', data: spend, backgroundColor: colors }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: { y: { ticks: { callback: v => '$' + v } } }
    }
  });
}

async function loadCampaigns() {
  const res = await fetch(`/advertising/campaigns?days=${currentDays}&limit=50${channelParam()}`, { credentials: 'include' });
  allCampaigns = await res.json();
  renderCampaignTable();
}

function renderCampaignTable() {
  const tbody = $('campaigns-body');
  const filtered = allCampaigns;

  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="10" class="loading-cell">No campaigns found</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(r => {
    const acos = r.ACOS ? (r.ACOS * 100).toFixed(1) + '%' : '—';
    const roas = r.ROAS ? r.ROAS.toFixed(2) + 'x'         : '—';
    const ctr  = r.CTR  ? (r.CTR  * 100).toFixed(2) + '%' : '—';
    const cpc  = r.CPC  ? fmt$(r.CPC)                      : '—';
    const acosClass = r.ACOS
      ? r.ACOS < 0.15 ? 'cm-positive' : r.ACOS > 0.40 ? 'cm-negative' : 'cm-neutral'
      : '';
    const channel = r.CONNECTION_TYPE === 'ads' ? '<span class="badge-ads">Ads</span>' : '<span class="badge-dsp">DSP</span>';

    return `<tr>
      <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${r.CAMPAIGN_NAME || r.CAMPAIGN_ID}">${r.CAMPAIGN_NAME || r.CAMPAIGN_ID}</td>
      <td>${fmtCampaignType(r.CAMPAIGN_TYPE, r.CONNECTION_TYPE)}</td>
      <td>${channel}</td>
      <td>${fmt$(r.SPEND)}</td>
      <td>${fmt$(r.SALES)}</td>
      <td>${fmtN(r.ORDERS)}</td>
      <td class="${acosClass}">${acos}</td>
      <td>${roas}</td>
      <td>${ctr}</td>
      <td>${cpc}</td>
    </tr>`;
  }).join('');
}

// ---- Helpers ----
function fmt$(n)  { return '$' + parseFloat(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fmtN(n)  { return Number(n || 0).toLocaleString('en-US'); }
function fmtDate(d) {
  const s = d?.value || d;
  return typeof s === 'string' ? s.substring(0, 10) : new Date(s).toISOString().substring(0, 10);
}
function fmtCampaignType(type, channel) {
  const map = { sponsoredProducts: 'Sponsored Products', sponsoredBrands: 'Sponsored Brands', sponsoredDisplay: 'Sponsored Display', video: 'Video' };
  return map[type] || (channel === 'dsp' ? 'DSP' : type || '—');
}
