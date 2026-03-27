/**
 * Calbridge — Advertising Dashboard (rebuilt)
 * Decision-support dashboard: spend, ROAS, ACoS, TACoS, channel breakdown,
 * campaign table, ASIN table, keyword efficiency.
 * CSP compliant: no inline scripts, all JS here.
 */

/* ─── State ──────────────────────────────────────────────────────────── */
let activeChannel  = 'all';   // 'all' | 'ads' | 'dsp'
// Default to Month to Date — computed at page load
const _mtdStart = new Date(); _mtdStart.setDate(1); _mtdStart.setHours(0,0,0,0);
let currentDays    = Math.max(1, Math.ceil((new Date() - _mtdStart) / 86400000)) || 1;
let currentStart   = _mtdStart.toISOString().split('T')[0];
let currentEnd     = new Date().toISOString().split('T')[0];

// Build date query params — uses explicit startDate/endDate for fixed historical windows
function dateParams() {
  if (currentStart && currentEnd) {
    return `days=${currentDays}&startDate=${currentStart}&endDate=${currentEnd}`;
  }
  return `days=${currentDays}`;
}
let trendView      = 'daily'; // 'daily' | 'weekly'
let trendChart     = null;
let adTypeChart    = null;

// Campaign table state
let campaignData     = [];
let campaignFiltered = [];
let campaignSortCol  = 'SPEND';
let campaignSortDir  = -1;
let campaignPage     = 0;
const CAMP_PAGE_SIZE = 25;

// ASIN table state
let asinData       = [];
let asinFiltered   = [];
let asinSortCol    = 'spend';
let asinSortDir    = -1;
let asinPage       = 0;
const ASIN_PAGE_SIZE = 20;

// Keyword table state
let keywordData     = [];
let keywordFiltered = [];
let keywordSortCol  = 'spend';
let keywordSortDir  = -1;
let keywordPage     = 0;
const KW_PAGE_SIZE  = 25;

// Keyword type chart
let kwTypeChart = null;

/* ─── Bootstrap ──────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {
  await checkAuth();
  setupControls();
  await loadAll();
});

/* ─── Auth ───────────────────────────────────────────────────────────── */
async function checkAuth() {
  try {
    const res = await fetch('/auth/me', { credentials: 'include' });
    if (!res.ok) { window.location.href = '/index.html'; return; }
    const { client } = await res.json();
    el('client-name').textContent = client.name || client.email;

    // Brand logo
    try {
      const profileRes = await fetch('/account/profile', { credentials: 'include' });
      const profile = await profileRes.json();
      if (profile.logoUrl) {
        const logoEl = document.querySelector('.sidebar-logo img');
        if (logoEl) logoEl.src = profile.logoUrl;
      }
    } catch (_) {}

    // Redirect if no ads connection
    try {
      const connRes = await fetch('/amazon/status', { credentials: 'include' });
      const conn = await connRes.json();
      if (!conn.ads?.connected && !conn.dsp?.connected) {
        window.location.href = '/account.html';
      }
    } catch (_) {}
  } catch (e) {
    window.location.href = '/index.html';
  }
}

/* ─── Controls ───────────────────────────────────────────────────────── */
function setupControls() {
  // Days filter
  const daysSelect  = el('days-filter');
  const customRange = el('custom-range');
  const applyBtn    = el('apply-custom');

  daysSelect?.addEventListener('change', async () => {
    const val = daysSelect.value;
    if (val === 'custom') { customRange?.classList.remove('hidden'); return; }
    customRange?.classList.add('hidden');
    if (val === 'mtd') {
      const start = new Date(); start.setDate(1);
      currentDays  = Math.max(1, Math.ceil((new Date() - start) / 86400000));
      currentStart = start.toISOString().split('T')[0];
      currentEnd   = new Date().toISOString().split('T')[0];
    } else if (val === 'ytd') {
      const start = new Date(new Date().getFullYear(), 0, 1);
      currentDays  = Math.max(1, Math.ceil((new Date() - start) / 86400000));
      currentStart = start.toISOString().split('T')[0];
      currentEnd   = new Date().toISOString().split('T')[0];
    } else {
      currentDays  = Number(val) || 30;
      currentStart = null;
      currentEnd   = null;
    }
    await loadAll();
  });

  applyBtn?.addEventListener('click', async () => {
    const from = el('date-from')?.value;
    const to   = el('date-to')?.value;
    if (from && to) {
      currentDays  = Math.max(1, Math.ceil((new Date(to) - new Date(from)) / 86400000) + 1);
      currentStart = from;
      currentEnd   = to;
      customRange?.classList.add('hidden');
      await loadAll();
    }
  });

  // Logout
  el('logout-btn')?.addEventListener('click', async () => {
    await fetch('/auth/logout', { method: 'POST', credentials: 'include' });
    window.location.href = '/';
  });

  // Channel toggle
  document.querySelectorAll('#channel-toggle .tab-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      document.querySelectorAll('#channel-toggle .tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeChannel = btn.dataset.channel;
      updateSubtitle();
      applyChannelVisibility();
      await loadAll();
    });
  });

  // Trend daily/weekly toggle
  el('trend-daily-btn')?.addEventListener('click', () => {
    trendView = 'daily';
    el('trend-daily-btn').classList.add('active');
    el('trend-weekly-btn').classList.remove('active');
    loadTrend();
  });
  el('trend-weekly-btn')?.addEventListener('click', () => {
    trendView = 'weekly';
    el('trend-weekly-btn').classList.add('active');
    el('trend-daily-btn').classList.remove('active');
    loadTrend();
  });

  // Campaign search
  el('campaign-search')?.addEventListener('input', () => {
    campaignPage = 0;
    filterAndRenderCampaigns();
  });

  // ASIN search
  el('asin-search')?.addEventListener('input', () => {
    asinPage = 0;
    filterAndRenderAsins();
  });

  // Campaign table sort
  document.querySelectorAll('#campaign-table thead th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (campaignSortCol === col) campaignSortDir = -campaignSortDir;
      else { campaignSortCol = col; campaignSortDir = -1; }
      campaignPage = 0;
      filterAndRenderCampaigns();
    });
  });

  // ASIN table sort
  document.querySelectorAll('#asin-table thead th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (asinSortCol === col) asinSortDir = -asinSortDir;
      else { asinSortCol = col; asinSortDir = -1; }
      asinPage = 0;
      filterAndRenderAsins();
    });
  });

  // Pagination — campaign
  el('campaign-prev')?.addEventListener('click', () => { campaignPage--; renderCampaignPage(); });
  el('campaign-next')?.addEventListener('click', () => { campaignPage++; renderCampaignPage(); });

  // Pagination — asin
  el('asin-prev')?.addEventListener('click', () => { asinPage--; renderAsinPage(); });
  el('asin-next')?.addEventListener('click', () => { asinPage++; renderAsinPage(); });

  // Keyword search
  el('keyword-search')?.addEventListener('input', () => {
    keywordPage = 0;
    filterAndRenderKeywords();
  });

  // Keyword table sort
  document.querySelectorAll('#keyword-table thead th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (keywordSortCol === col) keywordSortDir = -keywordSortDir;
      else { keywordSortCol = col; keywordSortDir = -1; }
      keywordPage = 0;
      filterAndRenderKeywords();
    });
  });

  // Pagination — keyword
  el('keyword-prev')?.addEventListener('click', () => { keywordPage--; renderKeywordPage(); });
  el('keyword-next')?.addEventListener('click', () => { keywordPage++; renderKeywordPage(); });
}

/* ─── Subtitle & visibility ──────────────────────────────────────────── */
function updateSubtitle() {
  const labels = {
    all:  'Amazon Ads + DSP — unified view',
    ads:  'Sponsored Products · Sponsored Brands · Sponsored Display',
    dsp:  'Amazon DSP — programmatic display'
  };
  el('channel-subtitle').textContent = labels[activeChannel] || activeChannel;
}

function applyChannelVisibility() {
  const isDsp = activeChannel === 'dsp';
  // ACoS and CTR aren't meaningful for DSP
  toggleEl('kpi-acos-card', !isDsp);
  toggleEl('kpi-ctr-card',  !isDsp);
  // Composition chart only shown when All or Sponsored Ads selected
  const showComposition = (activeChannel === 'all' || activeChannel === 'ads');
  const compCard = el('ad-type-composition-card');
  if (compCard) compCard.style.display = showComposition ? '' : 'none';
}

/* ─── Channel param helper ───────────────────────────────────────────── */
function channelParam() {
  if (activeChannel === 'dsp') return '&channel=dsp';
  if (activeChannel === 'ads') return '&channel=ads';
  return ''; // 'all' = no filter
}

/* ─── Load everything ────────────────────────────────────────────────── */
async function loadAll() {
  applyChannelVisibility();

  // Dim KPIs while loading
  ['kpi-spend','kpi-sales','kpi-roas','kpi-acos','kpi-tacos','kpi-ctr'].forEach(id => {
    const node = el(id);
    if (node) { node.textContent = '—'; node.style.opacity = '0.35'; }
  });

  await Promise.allSettled([
    loadSummary(),
    loadTrend(),
    loadChannelBreakdown(),
    loadAdTypeComposition(),
    loadCampaigns(),
    loadAsins(),
    loadKeywords(),
    loadKeywordTypeChart()
  ]);

  // Restore KPI opacity
  ['kpi-spend','kpi-sales','kpi-roas','kpi-acos','kpi-tacos','kpi-ctr'].forEach(id => {
    const node = el(id);
    if (node) node.style.opacity = '1';
  });
}

/* ─── Section 2: Summary KPIs ────────────────────────────────────────── */
async function loadSummary() {
  try {
    const [summaryRes, roasRes] = await Promise.all([
      fetch(`/advertising/summary?${dateParams()}${channelParam()}`, { credentials: 'include' }),
      fetch(`/advertising/roas-by-type?${dateParams()}`, { credentials: 'include' })
    ]);

    if (!summaryRes.ok) throw new Error(`Summary ${summaryRes.status}`);
    const d = await summaryRes.json();

    const spend       = Number(d.TOTAL_SPEND       || 0);
    const sales       = Number(d.TOTAL_SALES       || 0);
    const impressions = Number(d.TOTAL_IMPRESSIONS || 0);
    const clicks      = Number(d.TOTAL_CLICKS      || 0);
    const roas        = spend > 0 ? sales / spend      : null;
    const acos        = sales > 0 ? spend / sales      : null;
    const ctr         = impressions > 0 ? clicks / impressions : null;

    el('kpi-spend').textContent = fmt$(spend);
    el('kpi-sales').textContent = fmt$(sales);
    el('kpi-roas').textContent  = roas != null ? roas.toFixed(2) + 'x' : '—';
    el('kpi-acos').textContent  = acos != null ? (acos * 100).toFixed(1) + '%' : '—';
    el('kpi-ctr').textContent   = ctr  != null ? (ctr * 100).toFixed(2) + '%' : '—';
    el('kpi-clicks-sub').textContent = fmtN(clicks) + ' clicks';

    // Color-code ACoS
    if (acos != null) {
      const acosEl = el('kpi-acos');
      acosEl.className = 'kpi-value ' + (acos < 0.20 ? 'cm-positive' : acos > 0.45 ? 'cm-negative' : 'cm-neutral');
    }

    // TACoS from roas-by-type endpoint
    if (roasRes.ok) {
      const roasData = await roasRes.json();
      if (roasData.tacosPercent != null) {
        el('kpi-tacos').textContent = roasData.tacosPercent.toFixed(1) + '%';
        el('kpi-tacos-card').style.display = '';
      } else {
        el('kpi-tacos').textContent = '—';
      }
    }

  } catch (err) {
    console.error('loadSummary:', err);
  }
}

/* ─── Section 3: Spend & Sales Trend ────────────────────────────────── */
async function loadTrend() {
  try {
    const res = await fetch(`/advertising/trend?${dateParams()}${channelParam()}`, { credentials: 'include' });
    if (!res.ok) throw new Error(`Trend ${res.status}`);
    let rows = await res.json();

    // Weekly aggregation
    if (trendView === 'weekly') {
      rows = aggregateWeekly(rows);
    }

    const labels = rows.map(r => fmtDate(r.REPORT_DATE || r.report_date || r.week));
    const spend  = rows.map(r => Number(r.SPEND  || r.spend  || 0));
    const sales  = rows.map(r => Number(r.SALES  || r.sales  || 0));

    if (trendChart) { trendChart.destroy(); trendChart = null; }

    const canvas = el('trend-chart');
    const newCanvas = document.createElement('canvas');
    newCanvas.id = 'trend-chart';
    newCanvas.style.cssText = 'max-height:260px;min-height:200px;width:100%';
    canvas.parentNode.replaceChild(newCanvas, canvas);

    trendChart = new Chart(newCanvas, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Attributed Sales',
            data: sales,
            borderColor: '#2d5a27',
            backgroundColor: 'rgba(45,90,39,.08)',
            tension: 0.35,
            fill: true,
            yAxisID: 'ySales',
            pointRadius: labels.length > 60 ? 0 : 3,
            pointHoverRadius: 5
          },
          {
            label: 'Spend',
            data: spend,
            borderColor: '#c81e1e',
            backgroundColor: 'rgba(200,30,30,.06)',
            tension: 0.35,
            fill: true,
            yAxisID: 'ySpend',
            pointRadius: labels.length > 60 ? 0 : 3,
            pointHoverRadius: 5
          }
        ]
      },
      options: {
        responsive: true,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'top' },
          tooltip: {
            callbacks: {
              label: ctx => ` ${ctx.dataset.label}: ${fmt$(ctx.raw)}`
            }
          }
        },
        scales: {
          ySales: {
            type: 'linear',
            position: 'left',
            ticks: { callback: v => '$' + fmtK(v) },
            grid: { color: 'rgba(0,0,0,.05)' }
          },
          ySpend: {
            type: 'linear',
            position: 'right',
            ticks: { callback: v => '$' + fmtK(v), color: '#c81e1e' },
            grid: { drawOnChartArea: false }
          }
        }
      }
    });
  } catch (err) {
    console.error('loadTrend:', err);
  }
}

function aggregateWeekly(rows) {
  const weeks = {};
  rows.forEach(r => {
    const dateStr = fmtDate(r.REPORT_DATE || r.report_date);
    if (!dateStr) return;
    const d = new Date(dateStr);
    const day = d.getDay();
    const monday = new Date(d);
    monday.setDate(d.getDate() - ((day + 6) % 7));
    const key = monday.toISOString().slice(0, 10);
    if (!weeks[key]) weeks[key] = { week: key, spend: 0, sales: 0 };
    weeks[key].spend += Number(r.SPEND || r.spend || 0);
    weeks[key].sales += Number(r.SALES || r.sales || 0);
  });
  return Object.values(weeks).sort((a, b) => a.week.localeCompare(b.week));
}

/* ─── Section 4: Channel Breakdown Cards ────────────────────────────── */
async function loadChannelBreakdown() {
  const container = el('channel-cards');
  if (!container) return;
  container.innerHTML = '<div style="color:var(--gray-400);font-size:13px;padding:8px">Loading…</div>';

  try {
    const res = await fetch(`/advertising/by-channel?${dateParams()}`, { credentials: 'include' });
    if (!res.ok) throw new Error(`Channel ${res.status}`);
    const rows = await res.json();

    if (!rows.length) {
      container.innerHTML = '<div style="color:var(--gray-400);font-size:13px;padding:8px">No channel data available.</div>';
      return;
    }

    // Filter to active channel if narrowed
    let visible = rows;
    if (activeChannel === 'dsp')  visible = rows.filter(r => r.AD_TYPE === 'DSP');
    else if (activeChannel === 'ads') visible = rows.filter(r => r.AD_TYPE !== 'DSP');

    // Break-even ROAS threshold — simplistic default (1.0x = "covering spend")
    const BREAKEVEN_ROAS = 2.0;

    const COLORS = { SP: '#1a56db', SB: '#c66a10', SD: '#057a55', DSP: '#6b21e8' };
    const cols = visible.length === 1 ? 1 : visible.length === 2 ? 2 : visible.length === 3 ? 3 : 4;
    container.style.gridTemplateColumns = `repeat(${Math.min(cols, 4)}, 1fr)`;

    container.innerHTML = visible.map(r => {
      const type   = r.AD_TYPE;
      const spend  = Number(r.SPEND       || 0);
      const sales  = Number(r.SALES       || 0);
      const impr   = Number(r.IMPRESSIONS || 0);
      const clicks = Number(r.CLICKS      || 0);
      const roas   = r.ROAS != null ? Number(r.ROAS) : (spend > 0 ? sales / spend : null);
      const acos   = r.ACOS != null ? Number(r.ACOS) : (sales > 0 ? spend / sales : null);
      const isDsp  = type === 'DSP';
      const color  = COLORS[type] || '#9ca3af';
      const roasOk = roas != null && roas >= BREAKEVEN_ROAS;
      const borderColor = roas == null ? 'var(--gray-200)' : (roasOk ? 'var(--success)' : 'var(--danger)');
      const bgColor     = roas == null ? '' : (roasOk ? 'rgba(45,90,39,.03)' : 'rgba(200,30,30,.03)');

      return `<div class="kpi-card" style="border-left:3px solid ${borderColor};background:${bgColor || '#fff'}">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
          <span class="badge-ad-type badge-${type?.toLowerCase().replace('dsp','dsp-type')}" style="font-size:13px;padding:3px 10px">${escHtml(type)}</span>
          <span style="font-size:11px;font-weight:600;color:${roasOk ? 'var(--success)' : roas == null ? 'var(--gray-400)' : 'var(--danger)'}">${roas != null ? roas.toFixed(2) + 'x ROAS' : '—'}</span>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div>
            <div class="kpi-label">Spend</div>
            <div style="font-size:18px;font-weight:700;color:var(--gray-800)">${fmt$(spend)}</div>
          </div>
          <div>
            <div class="kpi-label" title="${isDsp ? 'Total attributed sales (halo effect — all products attributed to DSP impressions, not click-direct only). This is the correct DSP measurement metric.' : 'Ad-attributed sales (30-day click window). Does not equal total revenue.'}">${isDsp ? 'Total Sales ⓘ' : 'Ad-Attr. Sales ⓘ'}</div>
            <div style="font-size:18px;font-weight:700;color:var(--gray-800)">${fmt$(sales)}</div>
          </div>
          <div>
            <div class="kpi-label">ACoS</div>
            <div style="font-size:15px;font-weight:600" class="${isDsp ? '' : acos != null ? (acos < 0.20 ? 'cm-positive' : acos > 0.45 ? 'cm-negative' : 'cm-neutral') : ''}">${isDsp ? '—' : acos != null ? (acos * 100).toFixed(1) + '%' : '—'}</div>
          </div>
          <div>
            <div class="kpi-label">Impressions</div>
            <div style="font-size:15px;font-weight:600;color:var(--gray-600)">${fmtN(impr)}</div>
          </div>
          <div>
            <div class="kpi-label">Clicks</div>
            <div style="font-size:15px;font-weight:600;color:var(--gray-600)">${fmtN(clicks)}</div>
          </div>
          <div>
            <div class="kpi-label">CTR</div>
            <div style="font-size:15px;font-weight:600;color:var(--gray-600)">${isDsp ? '—' : impr > 0 ? (clicks / impr * 100).toFixed(2) + '%' : '—'}</div>
          </div>
        </div>
      </div>`;
    }).join('');

  } catch (err) {
    console.error('loadChannelBreakdown:', err);
    container.innerHTML = '<div style="color:var(--danger);font-size:13px;padding:8px">Error loading channel data.</div>';
  }
}

/* ─── Section 4b: Ad Type Composition Chart ─────────────────────────── */
async function loadAdTypeComposition() {
  // Only relevant when All or Sponsored Ads is selected
  if (activeChannel === 'dsp') return;

  const canvas = el('ad-type-chart');
  if (!canvas) return;

  try {
    const res = await fetch(`/advertising/by-campaign-type?${dateParams()}`, { credentials: 'include' });
    if (!res.ok) throw new Error(`Composition ${res.status}`);
    const rows = await res.json();

    if (!rows.length) return;

    const COLORS = {
      SP:  '#1a56db',
      SB:  '#c66a10',
      SD:  '#057a55',
      DSP: '#6b21e8'
    };
    const ORDER = ['SP', 'SB', 'SD', 'DSP'];

    // Sort by canonical order
    const sorted = ORDER
      .map(type => rows.find(r => (r.CAMPAIGN_TYPE || r.campaign_type) === type))
      .filter(Boolean);

    const labels = sorted.map(r => r.CAMPAIGN_TYPE || r.campaign_type);
    const spendData = sorted.map(r => Number(r.SPEND || r.spend || 0));
    const colors = labels.map(l => COLORS[l] || '#9ca3af');

    if (adTypeChart) { adTypeChart.destroy(); adTypeChart = null; }

    const newCanvas = document.createElement('canvas');
    newCanvas.id = 'ad-type-chart';
    newCanvas.style.cssText = 'max-height:220px;min-height:160px;width:100%';
    canvas.parentNode.replaceChild(newCanvas, canvas);

    adTypeChart = new Chart(newCanvas, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data: spendData,
          backgroundColor: colors,
          borderWidth: 2,
          borderColor: '#fff',
          hoverOffset: 6
        }]
      },
      options: {
        responsive: true,
        cutout: '60%',
        plugins: {
          legend: {
            position: 'right',
            labels: { font: { size: 12 }, padding: 14 }
          },
          tooltip: {
            callbacks: {
              label: ctx => {
                const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                const pct = total > 0 ? ((ctx.raw / total) * 100).toFixed(1) : '0.0';
                return ` ${ctx.label}: ${fmt$(ctx.raw)} (${pct}%)`;
              }
            }
          }
        }
      }
    });
  } catch (err) {
    console.error('loadAdTypeComposition:', err);
  }
}

/* ─── Section 5: Campaign Table ──────────────────────────────────────── */
async function loadCampaigns() {
  el('campaign-tbody').innerHTML = '<tr><td colspan="10" class="loading-cell">Loading…</td></tr>';
  try {
    const res = await fetch(`/advertising/campaigns?${dateParams()}&limit=500${channelParam()}`, { credentials: 'include' });
    if (!res.ok) throw new Error(`Campaigns ${res.status}`);
    campaignData = await res.json();
    campaignPage = 0;
    filterAndRenderCampaigns();
  } catch (err) {
    console.error('loadCampaigns:', err);
    el('campaign-tbody').innerHTML = '<tr><td colspan="10" class="loading-cell">Error loading campaigns.</td></tr>';
  }
}

function filterAndRenderCampaigns() {
  const q = (el('campaign-search')?.value || '').toLowerCase().trim();
  campaignFiltered = q
    ? campaignData.filter(r => (r.CAMPAIGN_NAME || '').toLowerCase().includes(q))
    : [...campaignData];

  campaignFiltered.sort((a, b) => {
    const av = a[campaignSortCol], bv = b[campaignSortCol];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === 'string') return av.localeCompare(bv) * campaignSortDir;
    return (Number(av) - Number(bv)) * campaignSortDir;
  });

  updateSortArrows('#campaign-table', campaignSortCol, campaignSortDir, 'col');
  renderCampaignPage();
}

function renderCampaignPage() {
  const total  = campaignFiltered.length;
  const pages  = Math.max(1, Math.ceil(total / CAMP_PAGE_SIZE));
  campaignPage = Math.max(0, Math.min(campaignPage, pages - 1));
  const start  = campaignPage * CAMP_PAGE_SIZE;
  const slice  = campaignFiltered.slice(start, start + CAMP_PAGE_SIZE);

  el('campaign-page-info').textContent = total
    ? `${start + 1}–${Math.min(start + CAMP_PAGE_SIZE, total)} of ${total}`
    : '0 results';
  el('campaign-prev').disabled = campaignPage === 0;
  el('campaign-next').disabled = campaignPage >= pages - 1;

  if (!slice.length) {
    el('campaign-tbody').innerHTML = '<tr><td colspan="10" class="loading-cell">No campaigns found.</td></tr>';
    return;
  }

  const adTypeBadge = {
    SP:  '<span class="badge-ad-type badge-sp">SP</span>',
    SB:  '<span class="badge-ad-type badge-sb">SB</span>',
    SD:  '<span class="badge-ad-type badge-sd">SD</span>',
    DSP: '<span class="badge-ad-type badge-dsp-type">DSP</span>'
  };

  el('campaign-tbody').innerHTML = slice.map(r => {
    const spend  = Number(r.SPEND       || 0);
    const sales  = Number(r.SALES       || 0);
    const impr   = Number(r.IMPRESSIONS || 0);
    const clicks = Number(r.CLICKS      || 0);
    const acos   = sales  > 0 ? spend / sales      : null;
    const roas   = spend  > 0 ? sales / spend      : null;
    const ctr    = r.CTR  != null ? Number(r.CTR)  : (impr > 0 ? clicks / impr : null);
    const cvr    = r.CVR  != null ? Number(r.CVR)  : null;
    const isDsp  = r.AD_TYPE === 'DSP';

    const acosCls = acos != null
      ? acos < 0.20 ? 'cm-positive' : acos > 0.45 ? 'cm-negative' : 'cm-neutral'
      : '';

    const name   = r.CAMPAIGN_NAME || r.CAMPAIGN_ID || '—';
    const badge  = adTypeBadge[r.AD_TYPE] || `<span class="badge-ad-type">${escHtml(r.AD_TYPE || '—')}</span>`;

    return `<tr>
      <td style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px"
          title="${escHtml(name)}">${escHtml(name)}</td>
      <td>${badge}</td>
      <td><strong>${fmt$(spend)}</strong></td>
      <td>${fmt$(sales)}</td>
      <td>${roas != null ? roas.toFixed(2) + 'x' : '—'}</td>
      <td class="${acosCls}">${isDsp ? '—' : acos != null ? (acos * 100).toFixed(1) + '%' : '—'}</td>
      <td>${fmtN(impr)}</td>
      <td>${fmtN(clicks)}</td>
      <td>${isDsp ? '—' : ctr != null ? (ctr * 100).toFixed(2) + '%' : '—'}</td>
      <td>${isDsp ? '—' : cvr != null ? (cvr * 100).toFixed(1) + '%' : '—'}</td>
    </tr>`;
  }).join('');
}

/* ─── Section 6: ASIN Table ──────────────────────────────────────────── */
async function loadAsins() {
  el('asin-tbody').innerHTML = '<tr><td colspan="9" class="loading-cell">Loading…</td></tr>';
  try {
    const res = await fetch(`/advertising/asin-performance?${dateParams()}&limit=200`, { credentials: 'include' });
    if (!res.ok) throw new Error(`ASINs ${res.status}`);
    const data = await res.json();

    if (!data.asins?.length) {
      el('asin-tbody').innerHTML = '<tr><td colspan="9" class="loading-cell">No ASIN data — syncing from Amazon.</td></tr>';
      return;
    }

    asinData = data.asins;
    asinPage = 0;
    filterAndRenderAsins();
  } catch (err) {
    console.error('loadAsins:', err);
    el('asin-tbody').innerHTML = '<tr><td colspan="9" class="loading-cell">Error loading ASIN data.</td></tr>';
  }
}

function filterAndRenderAsins() {
  const q = (el('asin-search')?.value || '').toLowerCase().trim();
  asinFiltered = q
    ? asinData.filter(a =>
        (a.asin || '').toLowerCase().includes(q) ||
        (a.modelNumber || '').toLowerCase().includes(q) ||
        (a.productTitle || '').toLowerCase().includes(q)
      )
    : [...asinData];

  asinFiltered.sort((a, b) => {
    const av = asinSortCol in a ? a[asinSortCol] : null;
    const bv = asinSortCol in b ? b[asinSortCol] : null;
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === 'string') return av.localeCompare(bv) * asinSortDir;
    return (av - bv) * asinSortDir;
  });

  updateSortArrows('#asin-table', asinSortCol, asinSortDir, 'col');
  renderAsinPage();
}

function renderAsinPage() {
  const total = asinFiltered.length;
  const pages = Math.max(1, Math.ceil(total / ASIN_PAGE_SIZE));
  asinPage    = Math.max(0, Math.min(asinPage, pages - 1));
  const start = asinPage * ASIN_PAGE_SIZE;
  const slice = asinFiltered.slice(start, start + ASIN_PAGE_SIZE);

  el('asin-page-info').textContent = total
    ? `${start + 1}–${Math.min(start + ASIN_PAGE_SIZE, total)} of ${total}`
    : '0 results';
  el('asin-prev').disabled = asinPage === 0;
  el('asin-next').disabled = asinPage >= pages - 1;

  if (!slice.length) {
    el('asin-tbody').innerHTML = '<tr><td colspan="9" class="loading-cell">No results.</td></tr>';
    return;
  }

  el('asin-tbody').innerHTML = slice.map(a => {
    const acos  = a.acos != null ? (a.acos * 100).toFixed(1) + '%' : '—';
    const roas  = a.roas != null ? a.roas.toFixed(2) + 'x'         : '—';
    const ctr   = a.ctr  != null ? (a.ctr  * 100).toFixed(2) + '%' : '—';
    const share = (a.spendShare * 100).toFixed(1) + '%';

    const acosCls = a.acos != null
      ? a.acos < 0.20 ? 'cm-positive' : a.acos > 0.45 ? 'cm-negative' : 'cm-neutral'
      : '';

    const model = a.modelNumber || '';
    const title = a.productTitle && a.productTitle !== a.asin ? a.productTitle : '';

    const shareBar = `<div style="display:flex;align-items:center;gap:6px">
      <div style="width:48px;height:5px;background:var(--gray-200);border-radius:3px;overflow:hidden">
        <div style="width:${Math.min(a.spendShare * 100, 100)}%;height:100%;background:var(--brand);border-radius:3px"></div>
      </div>
      <span style="font-size:11px;color:var(--gray-400)">${share}</span>
    </div>`;

    return `<tr>
      <td><a href="https://www.amazon.com/dp/${escHtml(a.asin)}" target="_blank" rel="noopener"
            style="font-family:monospace;font-size:12px;color:var(--brand)">${escHtml(a.asin)}</a></td>
      <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px"
          title="${escHtml(title)}">${escHtml(model) || '<span style="color:var(--gray-400)">—</span>'}</td>
      <td><strong>${fmt$(a.spend)}</strong></td>
      <td>${fmt$(a.sales)}</td>
      <td>${roas}</td>
      <td class="${acosCls}"><strong>${acos}</strong></td>
      <td>${fmtN(a.purchases)}</td>
      <td>${ctr}</td>
      <td>${shareBar}</td>
    </tr>`;
  }).join('');
}

/* ─── Section 7: Keyword Targeting Table ────────────────────────────── */
async function loadKeywords() {
  el('keyword-tbody').innerHTML = '<tr><td colspan="9" class="loading-cell">Loading…</td></tr>';
  try {
    // Keep the keyword-efficiency API call (don't remove it per spec — topByRoas still used by backend)
    await fetch(`/advertising/keyword-efficiency?${dateParams()}&limit=50`, { credentials: 'include' });

    // Load full keyword targeting data for the table
    const res = await fetch(`/advertising/keyword-targeting?${dateParams()}&limit=500`, { credentials: 'include' });
    if (!res.ok) throw new Error(`Keywords ${res.status}`);
    keywordData = await res.json();
    keywordPage = 0;
    filterAndRenderKeywords();
  } catch (err) {
    console.error('loadKeywords:', err);
    el('keyword-tbody').innerHTML = '<tr><td colspan="9" class="loading-cell">Error loading keyword data.</td></tr>';
  }
}

function filterAndRenderKeywords() {
  const q = (el('keyword-search')?.value || '').toLowerCase().trim();
  keywordFiltered = q
    ? keywordData.filter(k =>
        (k.keyword    || '').toLowerCase().includes(q) ||
        (k.matchType  || '').toLowerCase().includes(q) ||
        (k.campaignName || '').toLowerCase().includes(q)
      )
    : [...keywordData];

  keywordFiltered.sort((a, b) => {
    const av = keywordSortCol in a ? a[keywordSortCol] : null;
    const bv = keywordSortCol in b ? b[keywordSortCol] : null;
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === 'string') return av.localeCompare(bv) * keywordSortDir;
    return (av - bv) * keywordSortDir;
  });

  updateSortArrows('#keyword-table', keywordSortCol, keywordSortDir, 'col');
  renderKeywordPage();
}

function renderKeywordPage() {
  const total = keywordFiltered.length;
  const pages = Math.max(1, Math.ceil(total / KW_PAGE_SIZE));
  keywordPage = Math.max(0, Math.min(keywordPage, pages - 1));
  const start = keywordPage * KW_PAGE_SIZE;
  const slice = keywordFiltered.slice(start, start + KW_PAGE_SIZE);

  el('keyword-page-info').textContent = total
    ? `${start + 1}–${Math.min(start + KW_PAGE_SIZE, total)} of ${total}`
    : '0 results';
  el('keyword-prev').disabled = keywordPage === 0;
  el('keyword-next').disabled = keywordPage >= pages - 1;

  if (!slice.length) {
    el('keyword-tbody').innerHTML = '<tr><td colspan="9" class="loading-cell">No keywords found.</td></tr>';
    return;
  }

  el('keyword-tbody').innerHTML = slice.map(k => {
    const acos    = k.acos != null ? (k.acos * 100).toFixed(1) + '%' : '—';
    const roas    = k.roas != null ? k.roas.toFixed(2) + 'x'         : '—';
    const cpc     = k.cpc  != null ? fmt$(k.cpc)                     : '—';
    const acosCls = k.acos != null
      ? k.acos < 0.20 ? 'cm-positive' : k.acos > 0.45 ? 'cm-negative' : 'cm-neutral'
      : '';

    const matchBadge = k.matchType
      ? `<span style="background:var(--gray-100);color:var(--gray-600);padding:1px 6px;border-radius:4px;font-size:11px;font-weight:600">${escHtml(k.matchType)}</span>`
      : '<span style="color:var(--gray-400)">—</span>';

    return `<tr>
      <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px"
          title="${escHtml(k.keyword)}">${escHtml(k.keyword)}</td>
      <td>${matchBadge}</td>
      <td><strong>${fmt$(k.spend)}</strong></td>
      <td>${fmt$(k.sales)}</td>
      <td>${roas}</td>
      <td class="${acosCls}"><strong>${acos}</strong></td>
      <td>${fmtN(k.orders)}</td>
      <td>${fmtN(k.clicks)}</td>
      <td>${cpc}</td>
    </tr>`;
  }).join('');
}

/* ─── Section 8: SP Keyword Type Breakdown Chart ────────────────────── */
async function loadKeywordTypeChart() {
  // Only show for all/ads channels (not DSP)
  const card = el('kw-type-card');
  if (activeChannel === 'dsp') {
    if (card) card.style.display = 'none';
    return;
  }
  if (card) card.style.display = '';

  try {
    const res = await fetch(`/advertising/keyword-type-breakdown?${dateParams()}`, { credentials: 'include' });
    if (!res.ok) throw new Error(`KwType ${res.status}`);
    const rows = await res.json();

    if (!rows.length) return;

    // Canonical order
    const ORDER = ['AUTO', 'BROAD', 'PHRASE', 'EXACT'];
    const sorted = ORDER
      .map(mt => rows.find(r => r.matchType?.toUpperCase() === mt) || { matchType: mt, spend: 0, sales: 0 })
      .filter(r => r.spend > 0 || r.sales > 0);

    const labels   = sorted.map(r => r.matchType);
    const spendArr = sorted.map(r => r.spend);
    const salesArr = sorted.map(r => r.sales);

    if (kwTypeChart) { kwTypeChart.destroy(); kwTypeChart = null; }

    const canvas = el('kw-type-chart');
    const newCanvas = document.createElement('canvas');
    newCanvas.id = 'kw-type-chart';
    newCanvas.style.cssText = 'max-height:220px;min-height:160px;width:100%';
    canvas.parentNode.replaceChild(newCanvas, canvas);

    kwTypeChart = new Chart(newCanvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Spend',
            data: spendArr,
            backgroundColor: 'rgba(200,30,30,0.75)',
            borderRadius: 4
          },
          {
            label: 'Sales',
            data: salesArr,
            backgroundColor: 'rgba(45,90,39,0.75)',
            borderRadius: 4
          }
        ]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        plugins: {
          legend: { position: 'top' },
          tooltip: {
            callbacks: {
              label: ctx => ` ${ctx.dataset.label}: ${fmt$(ctx.raw)}`
            }
          }
        },
        scales: {
          x: {
            ticks: { callback: v => '$' + fmtK(v) },
            grid: { color: 'rgba(0,0,0,.05)' }
          }
        }
      }
    });
  } catch (err) {
    console.error('loadKeywordTypeChart:', err);
  }
}

/* ─── Sort arrows ────────────────────────────────────────────────────── */
function updateSortArrows(tableSelector, activeCol, dir, attrName) {
  document.querySelectorAll(`${tableSelector} thead th.sortable`).forEach(th => {
    const arrow = th.querySelector('.sort-arrow');
    if (!arrow) return;
    if (th.dataset[attrName] === activeCol) {
      arrow.textContent = dir === -1 ? ' ↓' : ' ↑';
      th.style.color = 'var(--gray-800)';
    } else {
      arrow.textContent = '';
      th.style.color = '';
    }
  });
}

/* ─── DOM & format helpers ───────────────────────────────────────────── */
function el(id) { return document.getElementById(id); }

function toggleEl(id, show) {
  const node = el(id);
  if (node) node.style.display = show ? '' : 'none';
}

function fmt$(n) {
  return '$' + parseFloat(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtN(n) { return Number(n || 0).toLocaleString('en-US'); }
function fmtK(v) {
  const abs = Math.abs(v);
  if (abs >= 1000000) return (v / 1000000).toFixed(1) + 'M';
  if (abs >= 1000)    return (v / 1000).toFixed(1) + 'k';
  return v.toFixed(0);
}
function fmtDate(d) {
  const s = d?.value || d;
  if (!s) return '';
  if (typeof s === 'string') return s.substring(0, 10);
  return new Date(s).toISOString().substring(0, 10);
}
function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
