/**
 * Calbridge — Advertising Dashboard
 * No inline scripts: all logic lives here for CSP compliance.
 */

/* ─── State ─────────────────────────────────────────────────────────── */
let activeChannel = 'all';   // 'all' | 'ads' | 'SP' | 'SB' | 'SD' | 'dsp'
let currentDays   = 30;

let trendChart    = null;
let donutChart    = null;
let acosTrendChart = null;

// ASIN table state
let asinData       = [];      // full dataset from API
let asinFiltered   = [];      // after search filter
let asinSortCol    = 'spend';
let asinSortDir    = -1;      // -1 = desc, 1 = asc
let asinPage       = 0;
const ASIN_PAGE_SIZE = 25;

// Campaign table state
let campaignData     = [];
let campaignFiltered = [];
let campaignSortCol  = 'SPEND';
let campaignSortDir  = -1;
let campaignPage     = 0;
const CAMP_PAGE_SIZE = 25;

/* ─── Bootstrap ─────────────────────────────────────────────────────── */
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
      const profile    = await profileRes.json();
      if (profile.logoUrl) {
        const logoEl = document.querySelector('.sidebar-logo img');
        if (logoEl) { logoEl.src = profile.logoUrl; }
      }
    } catch (_) { /* logo is cosmetic, ignore */ }

    // Redirect if no ads connection
    try {
      const connRes = await fetch('/amazon/status', { credentials: 'include' });
      const conn    = await connRes.json();
      if (!conn.ads?.connected && !conn.dsp?.connected) {
        window.location.href = '/account.html';
      }
    } catch (_) { /* if status check fails, allow through */ }
  } catch (e) {
    console.error('Auth check failed:', e);
    window.location.href = '/index.html';
  }
}

/* ─── Controls ───────────────────────────────────────────────────────── */
function setupControls() {
  // Days filter — direct listener, no external dependency
  const daysSelect = document.getElementById('days-filter');
  const customRange = document.getElementById('custom-range');
  const applyBtn = document.getElementById('apply-custom');

  if (daysSelect) {
    daysSelect.addEventListener('change', async () => {
      const val = daysSelect.value;
      if (val === 'custom') {
        customRange?.classList.remove('hidden');
        return;
      }
      customRange?.classList.add('hidden');
      if (val === 'mtd') {
        const start = new Date(); start.setDate(1);
        currentDays = Math.max(1, Math.ceil((new Date() - start) / 86400000));
      } else if (val === 'ytd') {
        const start = new Date(new Date().getFullYear(), 0, 1);
        currentDays = Math.max(1, Math.ceil((new Date() - start) / 86400000));
      } else {
        currentDays = Number(val) || 30;
      }
      await loadAll();
    });
  }

  if (applyBtn) {
    applyBtn.addEventListener('click', async () => {
      const from = document.getElementById('date-from')?.value;
      const to = document.getElementById('date-to')?.value;
      if (from && to) {
        currentDays = Math.max(1, Math.ceil((new Date(to) - new Date(from)) / 86400000) + 1);
        customRange?.classList.add('hidden');
        daysSelect.value = 'custom';
        await loadAll();
      }
    });
  }

  // Logout
  el('logout-btn').addEventListener('click', async () => {
    await fetch('/auth/logout', { method: 'POST', credentials: 'include' });
    window.location.href = '/';
  });

  // Channel toggle
  document.querySelectorAll('#channel-toggle .tab-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      document.querySelectorAll('#channel-toggle .tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeChannel = btn.dataset.channel;

      const subtitles = {
        all: 'Amazon Ads + DSP — unified view',
        ads: 'Sponsored Ads — SP · SB · SD',
        SP:  'Sponsored Products',
        SB:  'Sponsored Brands',
        SD:  'Sponsored Display',
        dsp: 'Amazon DSP — programmatic display'
      };
      el('channel-subtitle').textContent = subtitles[activeChannel] || activeChannel;

      // Show/hide DSP-incompatible metrics
      applyChannelVisibility();

      await loadAll();
    });
  });

  // ASIN search
  el('asin-search').addEventListener('input', () => {
    asinPage = 0;
    filterAndRenderAsins();
  });

  // Campaign search
  el('campaign-search').addEventListener('input', () => {
    campaignPage = 0;
    filterAndRenderCampaigns();
  });

  // ASIN table header sort
  document.querySelectorAll('#asin-table thead th.sortable').forEach(th => {
    th.style.cursor = 'pointer';
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (asinSortCol === col) {
        asinSortDir = -asinSortDir;
      } else {
        asinSortCol = col;
        asinSortDir = -1;
      }
      asinPage = 0;
      filterAndRenderAsins();
    });
  });

  // Campaign table header sort
  document.querySelectorAll('#campaign-table thead th.sortable').forEach(th => {
    th.style.cursor = 'pointer';
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (campaignSortCol === col) {
        campaignSortDir = -campaignSortDir;
      } else {
        campaignSortCol = col;
        campaignSortDir = -1;
      }
      campaignPage = 0;
      filterAndRenderCampaigns();
    });
  });

  // Pagination — ASIN
  el('asin-prev').addEventListener('click', () => { asinPage--; renderAsinPage(); });
  el('asin-next').addEventListener('click', () => { asinPage++; renderAsinPage(); });

  // Pagination — Campaign
  el('campaign-prev').addEventListener('click', () => { campaignPage--; renderCampaignPage(); });
  el('campaign-next').addEventListener('click', () => { campaignPage++; renderCampaignPage(); });
}

/* ─── Channel visibility ─────────────────────────────────────────────── */
function applyChannelVisibility() {
  const isDsp = activeChannel === 'dsp';
  // For SP/SB/SD subtypes, show sponsored ads metrics (ACOS, CTR)

  // ACOS card — hide for DSP
  toggleEl('kpi-acos-card',   !isDsp);
  // CTR card — hide for DSP
  toggleEl('kpi-ctr-card',    !isDsp);
  // ACOS trend row — hide for DSP
  toggleEl('acos-trend-row',  !isDsp);
}

/* ─── Load all data ──────────────────────────────────────────────────── */
async function loadAll() {
  applyChannelVisibility();
  try {
    await Promise.all([
      loadSummary(),
      loadTrend(),
      loadDonut(),
      loadAdTypeBreakdown(),
      loadAsinPerformance(),
      loadCampaigns()
    ]);
  } catch (err) {
    console.error('loadAll error:', err);
  }
}

/* ─── Ad Type Breakdown Table ────────────────────────────────────────── */
async function loadAdTypeBreakdown() {
  const tbody = document.getElementById('adtype-tbody');
  if (!tbody) return;
  try {
    // Always fetch all types for comparison — not filtered by activeChannel
    const res = await fetch(`/advertising/by-channel?days=${currentDays}`, { credentials: 'include' });
    if (!res.ok) throw new Error(`${res.status}`);
    const rows = await res.json();

    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="10" class="loading-cell">No data</td></tr>';
      return;
    }

    const TYPE_COLORS = { SP: '#1a56db', SB: '#c05621', SD: '#065f46', DSP: '#5b21b6' };
    const totals = rows.reduce((s, r) => ({
      spend: s.spend + Number(r.SPEND||0),
      sales: s.sales + Number(r.SALES||0)
    }), { spend: 0, sales: 0 });

    tbody.innerHTML = rows.map(r => {
      const spend = Number(r.SPEND||0), sales = Number(r.SALES||0);
      const orders = Number(r.ORDERS||0), clicks = Number(r.CLICKS||0), impr = Number(r.IMPRESSIONS||0);
      const acos  = sales  > 0 ? (spend / sales * 100).toFixed(1) + '%' : '—';
      const roas  = spend  > 0 ? (sales / spend).toFixed(2) + 'x' : '—';
      const ctr   = impr   > 0 ? (clicks / impr * 100).toFixed(2) + '%' : '—';
      const cpc   = clicks > 0 ? fmt$(spend / clicks) : '—';
      const pct   = totals.spend > 0 ? (spend / totals.spend * 100).toFixed(1) : 0;
      const type  = r.AD_TYPE || r.CAMPAIGN_TYPE;
      const color = TYPE_COLORS[type] || '#6b7280';
      const isDspRow = type === 'DSP';

      return `<tr style="${activeChannel !== 'all' && activeChannel !== (isDspRow?'dsp':type==='ads'?'ads':type) && !(['SP','SB','SD'].includes(activeChannel)&&!isDspRow) ? 'opacity:0.4' : ''}">
        <td><span class="badge-${type?.toLowerCase()}" style="background:${color}20;color:${color};padding:3px 8px;border-radius:4px;font-weight:700;font-size:12px">${type}</span></td>
        <td><strong>${fmt$(spend)}</strong> <span style="font-size:11px;color:var(--gray-400)">(${pct}%)</span></td>
        <td>${fmt$(sales)}</td>
        <td>${orders.toLocaleString()}</td>
        <td class="${Number(acos)>40?'cm-negative':Number(acos)<15?'cm-positive':''}">${isDspRow?'—':acos}</td>
        <td>${roas}</td>
        <td>${impr.toLocaleString()}</td>
        <td>${clicks.toLocaleString()}</td>
        <td>${isDspRow?'—':ctr}</td>
        <td>${isDspRow?'—':cpc}</td>
      </tr>`;
    }).join('');

    // Totals row
    const totalSpend = totals.spend, totalSales = totals.sales;
    const totalAcos = totalSales > 0 ? (totalSpend/totalSales*100).toFixed(1)+'%' : '—';
    const totalRoas = totalSpend > 0 ? (totalSales/totalSpend).toFixed(2)+'x' : '—';
    tbody.innerHTML += `<tr style="font-weight:700;border-top:2px solid var(--gray-200)">
      <td>Total</td><td>${fmt$(totalSpend)}</td><td>${fmt$(totalSales)}</td>
      <td colspan="7">${totalAcos} ACOS · ${totalRoas} ROAS</td>
    </tr>`;

  } catch (err) {
    console.error('loadAdTypeBreakdown:', err);
    tbody.innerHTML = '<tr><td colspan="10" class="loading-cell">Error loading data</td></tr>';
  }
}

/* ─── Channel param helper ───────────────────────────────────────────── */
function channelParam() {
  if (activeChannel === 'ads') return '&channel=ads';
  if (activeChannel === 'dsp') return '&channel=dsp';
  if (['SP','SB','SD'].includes(activeChannel)) return '&channel=ads&adType=' + activeChannel;
  return '';
}

/* ─── Summary KPIs ───────────────────────────────────────────────────── */
async function loadSummary() {
  try {
    const res = await fetch(`/advertising/summary?days=${currentDays}${channelParam()}`, { credentials: 'include' });
    if (!res.ok) throw new Error(`Summary ${res.status}`);
    const d = await res.json();

    // Raw sums
    const spend       = Number(d.TOTAL_SPEND       || 0);
    const sales       = Number(d.TOTAL_SALES       || 0);
    const impressions = Number(d.TOTAL_IMPRESSIONS || 0);
    const clicks      = Number(d.TOTAL_CLICKS      || 0);

    // Computed from raw facts
    const roas  = spend > 0 ? sales / spend : null;
    const acos  = sales > 0 ? spend / sales : null;
    const ctr   = impressions > 0 ? clicks / impressions : null;

    el('kpi-spend').textContent       = fmt$(spend);
    el('kpi-sales').textContent       = fmt$(sales);
    el('kpi-roas').textContent        = roas  != null ? roas.toFixed(2) + 'x'          : '—';
    el('kpi-acos').textContent        = acos  != null ? (acos * 100).toFixed(1) + '%'  : '—';
    el('kpi-impressions').textContent = fmtN(impressions);
    el('kpi-ctr').textContent         = ctr   != null ? (ctr * 100).toFixed(2) + '%'   : '—';
    el('kpi-clicks-sub').textContent  = fmtN(clicks) + ' clicks';
  } catch (err) {
    console.error('loadSummary:', err);
  }
}

/* ─── Trend chart ────────────────────────────────────────────────────── */
async function loadTrend() {
  try {
    const res = await fetch(`/advertising/trend?days=${currentDays}${channelParam()}`, { credentials: 'include' });
    if (!res.ok) throw new Error(`Trend ${res.status}`);
    const rows = await res.json();

    const labels = rows.map(r => fmtDate(r.REPORT_DATE));
    const spend  = rows.map(r => Number(r.SPEND  || 0));
    const sales  = rows.map(r => Number(r.SALES  || 0));

    // ACOS computed from raw facts per day
    const acosPct = rows.map(r => {
      const s = Number(r.SALES || 0);
      const sp = Number(r.SPEND || 0);
      return s > 0 ? parseFloat(((sp / s) * 100).toFixed(2)) : null;
    });

    // Trend chart
    if (trendChart) trendChart.destroy();
    trendChart = new Chart(el('trend-chart'), {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Sales',
            data: sales,
            borderColor: '#1a56db',
            backgroundColor: 'rgba(26,86,219,.08)',
            tension: 0.4,
            fill: true,
            yAxisID: 'y',
            pointRadius: labels.length > 45 ? 0 : 3
          },
          {
            label: 'Spend',
            data: spend,
            borderColor: '#c81e1e',
            backgroundColor: 'rgba(200,30,30,.07)',
            tension: 0.4,
            fill: true,
            yAxisID: 'y',
            pointRadius: labels.length > 45 ? 0 : 3
          }
        ]
      },
      options: {
        responsive: true,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { position: 'top' } },
        scales: {
          y: { ticks: { callback: v => '$' + fmtK(v) } }
        }
      }
    });

    // ACOS trend chart (hidden when DSP)
    if (acosTrendChart) acosTrendChart.destroy();
    acosTrendChart = new Chart(el('acos-trend-chart'), {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'ACOS %',
          data: acosPct,
          borderColor: '#b45309',
          backgroundColor: 'rgba(180,83,9,.07)',
          tension: 0.4,
          fill: true,
          spanGaps: true,
          pointRadius: labels.length > 45 ? 0 : 3
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { position: 'top' } },
        scales: {
          y: { ticks: { callback: v => v + '%' } }
        }
      }
    });
  } catch (err) {
    console.error('loadTrend:', err);
  }
}

/* ─── Donut chart (by ad type) ───────────────────────────────────────── */
async function loadDonut() {
  try {
    const res = await fetch(`/advertising/by-channel?days=${currentDays}`, { credentials: 'include' });
    if (!res.ok) throw new Error(`By-channel ${res.status}`);
    const rows = await res.json();

    // When a specific channel is selected, filter the donut to that channel
    let filtered = rows;
    if (activeChannel === 'ads') filtered = rows.filter(r => ['SP','SB','SD'].includes(r.AD_TYPE));
    if (activeChannel === 'dsp') filtered = rows.filter(r => r.AD_TYPE === 'DSP');

    if (!filtered.length) {
      if (donutChart) donutChart.destroy();
      return;
    }

    const adTypeColors = {
      SP:  '#1a56db',
      SB:  '#e07b22',
      SD:  '#057a55',
      DSP: '#7e3af2'
    };

    const labels = filtered.map(r => r.AD_TYPE);
    const spend  = filtered.map(r => Number(r.SPEND || 0));
    const colors = filtered.map(r => adTypeColors[r.AD_TYPE] || '#9ca3af');

    if (donutChart) donutChart.destroy();
    donutChart = new Chart(el('donut-chart'), {
      type: 'pie',
      data: {
        labels,
        datasets: [{
          data: spend,
          backgroundColor: colors,
          borderWidth: 2,
          borderColor: '#fff'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: { position: 'bottom', labels: { padding: 16, font: { size: 12 } } },
          tooltip: {
            callbacks: {
              label: ctx => {
                const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                const pct = total > 0 ? ((ctx.raw / total) * 100).toFixed(1) : 0;
                return ` ${ctx.label}: ${fmt$(ctx.raw)} (${pct}%)`;
              }
            }
          }
        }
      }
    });
  } catch (err) {
    console.error('loadDonut:', err);
  }
}

/* ─── ASIN Performance ───────────────────────────────────────────────── */
async function loadAsinPerformance() {
  el('asin-tbody').innerHTML = '<tr><td colspan="10" class="loading-cell">Loading…</td></tr>';
  try {
    const res = await fetch(`/advertising/asin-performance?days=${currentDays}&limit=200`, { credentials: 'include' });
    if (!res.ok) throw new Error(`ASIN ${res.status}`);
    const data = await res.json();

    if (!data.asins?.length) {
      el('asin-tbody').innerHTML = '<tr><td colspan="10" class="loading-cell">No ASIN data — syncing from Amazon</td></tr>';
      return;
    }

    asinData = data.asins;
    asinPage = 0;
    filterAndRenderAsins();
  } catch (err) {
    console.error('loadAsinPerformance:', err);
    el('asin-tbody').innerHTML = '<tr><td colspan="10" class="loading-cell">Error loading ASIN data</td></tr>';
  }
}

function filterAndRenderAsins() {
  const q = (el('asin-search').value || '').toLowerCase().trim();
  asinFiltered = q
    ? asinData.filter(a =>
        (a.asin || '').toLowerCase().includes(q) ||
        (a.modelNumber || '').toLowerCase().includes(q) ||
        (a.productTitle || '').toLowerCase().includes(q)
      )
    : [...asinData];

  // Sort
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
  const total   = asinFiltered.length;
  const pages   = Math.max(1, Math.ceil(total / ASIN_PAGE_SIZE));
  asinPage      = Math.max(0, Math.min(asinPage, pages - 1));
  const start   = asinPage * ASIN_PAGE_SIZE;
  const slice   = asinFiltered.slice(start, start + ASIN_PAGE_SIZE);

  el('asin-page-info').textContent = total
    ? `${start + 1}–${Math.min(start + ASIN_PAGE_SIZE, total)} of ${total}`
    : '0 results';

  el('asin-prev').disabled = asinPage === 0;
  el('asin-next').disabled = asinPage >= pages - 1;

  if (!slice.length) {
    el('asin-tbody').innerHTML = '<tr><td colspan="10" class="loading-cell">No results</td></tr>';
    return;
  }

  el('asin-tbody').innerHTML = slice.map(a => {
    const acos  = a.acos  != null ? (a.acos  * 100).toFixed(1) + '%' : '—';
    const roas  = a.roas  != null ? a.roas.toFixed(2) + 'x'          : '—';
    const ctr   = a.ctr   != null ? (a.ctr   * 100).toFixed(2) + '%' : '—';
    const cpc   = a.cpc   != null ? fmt$(a.cpc)                       : '—';
    const share = (a.spendShare * 100).toFixed(1) + '%';

    const acosCls = a.acos != null
      ? a.acos < 0.15 ? 'cm-positive' : a.acos > 0.40 ? 'cm-negative' : 'cm-neutral'
      : '';

    const shareBar = `
      <div style="display:flex;align-items:center;gap:6px">
        <div style="width:56px;height:5px;background:var(--gray-200);border-radius:3px;overflow:hidden">
          <div style="width:${Math.min(a.spendShare * 100, 100)}%;height:100%;background:var(--brand);border-radius:3px"></div>
        </div>
        <span style="font-size:11px;color:var(--gray-400)">${share}</span>
      </div>`;

    const modelDisplay = a.modelNumber || '';
    const hoverTitle   = a.productTitle && a.productTitle !== a.asin ? a.productTitle : '';

    return `<tr>
      <td><a href="https://www.amazon.com/dp/${escHtml(a.asin)}" target="_blank" rel="noopener"
            style="font-family:monospace;font-size:12px;color:var(--brand)">${escHtml(a.asin)}</a></td>
      <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px"
          title="${escHtml(hoverTitle)}">${escHtml(modelDisplay) || '<span style="color:var(--gray-400)">—</span>'}</td>
      <td><strong>${fmt$(a.spend)}</strong></td>
      <td>${fmt$(a.sales)}</td>
      <td>${fmtN(a.purchases)}</td>
      <td class="${acosCls}"><strong>${acos}</strong></td>
      <td>${roas}</td>
      <td>${ctr}</td>
      <td>${cpc}</td>
      <td>${shareBar}</td>
    </tr>`;
  }).join('');
}

/* ─── Campaign Table ─────────────────────────────────────────────────── */
async function loadCampaigns() {
  el('campaign-tbody').innerHTML = '<tr><td colspan="7" class="loading-cell">Loading…</td></tr>';
  try {
    const res = await fetch(`/advertising/campaigns?days=${currentDays}&limit=200${channelParam()}`, { credentials: 'include' });
    if (!res.ok) throw new Error(`Campaigns ${res.status}`);
    campaignData = await res.json();
    campaignPage = 0;
    filterAndRenderCampaigns();
  } catch (err) {
    console.error('loadCampaigns:', err);
    el('campaign-tbody').innerHTML = '<tr><td colspan="7" class="loading-cell">Error loading campaigns</td></tr>';
  }
}

function filterAndRenderCampaigns() {
  const q = (el('campaign-search').value || '').toLowerCase().trim();
  campaignFiltered = q
    ? campaignData.filter(r => (r.CAMPAIGN_NAME || '').toLowerCase().includes(q))
    : [...campaignData];

  // Sort
  campaignFiltered.sort((a, b) => {
    const av = a[campaignSortCol];
    const bv = b[campaignSortCol];
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
  const total   = campaignFiltered.length;
  const pages   = Math.max(1, Math.ceil(total / CAMP_PAGE_SIZE));
  campaignPage  = Math.max(0, Math.min(campaignPage, pages - 1));
  const start   = campaignPage * CAMP_PAGE_SIZE;
  const slice   = campaignFiltered.slice(start, start + CAMP_PAGE_SIZE);

  el('campaign-page-info').textContent = total
    ? `${start + 1}–${Math.min(start + CAMP_PAGE_SIZE, total)} of ${total}`
    : '0 results';

  el('campaign-prev').disabled = campaignPage === 0;
  el('campaign-next').disabled = campaignPage >= pages - 1;

  if (!slice.length) {
    el('campaign-tbody').innerHTML = '<tr><td colspan="7" class="loading-cell">No campaigns found</td></tr>';
    return;
  }

  const adTypeBadge = {
    SP:  '<span class="badge-ad-type badge-sp">SP</span>',
    SB:  '<span class="badge-ad-type badge-sb">SB</span>',
    SD:  '<span class="badge-ad-type badge-sd">SD</span>',
    DSP: '<span class="badge-ad-type badge-dsp-type">DSP</span>'
  };

  el('campaign-tbody').innerHTML = slice.map(r => {
    const spend  = Number(r.SPEND  || 0);
    const sales  = Number(r.SALES  || 0);
    // Compute from raw facts
    const acos   = sales > 0 ? spend / sales         : null;
    const roas   = spend > 0 ? sales / spend         : null;

    const acosFmt  = acos  != null ? (acos * 100).toFixed(1) + '%' : '—';
    const roasFmt  = roas  != null ? roas.toFixed(2) + 'x'         : '—';
    const acosCls  = acos  != null
      ? acos < 0.15 ? 'cm-positive' : acos > 0.40 ? 'cm-negative' : 'cm-neutral'
      : '';

    const badge = adTypeBadge[r.AD_TYPE] || `<span class="badge-ad-type">${escHtml(r.AD_TYPE || '—')}</span>`;
    const name  = r.CAMPAIGN_NAME || r.CAMPAIGN_ID || '—';

    return `<tr>
      <td style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px"
          title="${escHtml(name)}">${escHtml(name)}</td>
      <td>${badge}</td>
      <td><strong>${fmt$(spend)}</strong></td>
      <td>${fmt$(sales)}</td>
      <td>${fmtN(r.ORDERS)}</td>
      <td class="${acosCls}">${acosFmt}</td>
      <td>${roasFmt}</td>
    </tr>`;
  }).join('');
}

/* ─── Sort arrow utility ─────────────────────────────────────────────── */
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
  if (!node) return;
  node.style.display = show ? '' : 'none';
}

function fmt$(n)  {
  return '$' + parseFloat(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtN(n)  { return Number(n || 0).toLocaleString('en-US'); }
function fmtK(v)  {
  if (Math.abs(v) >= 1000) return (v / 1000).toFixed(1) + 'k';
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
