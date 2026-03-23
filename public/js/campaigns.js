// CalBridge — Campaign Management Page

const $ = id => document.getElementById(id);
let currentDays = 30;
let allCampaigns = [];
let activeStatus = 'all';
let expandedRow = null;
let trendCharts = {};

document.addEventListener('DOMContentLoaded', async () => {
  await checkAuth();
  setupControls();
  await loadCampaigns();
  await loadPendingActions();
});

// ---- Auth & init ----

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
      if (logoEl) { logoEl.src = profile.logoUrl; }
    }

    // Check connections — redirect if no ads
    const connRes = await fetch('/amazon/status', { credentials: 'include' });
    const conn = await connRes.json();
    const hasAds = conn.ads?.connected || conn.dsp?.connected;
    if (!hasAds) { window.location.href = '/account.html'; return; }

    // Hide campaigns nav for pages that don't have ads
    document.querySelectorAll('.nav-item-campaigns').forEach(el => {
      if (!hasAds) el.classList.add('nav-disabled');
    });
  } catch (e) {
    window.location.href = '/index.html';
  }
}

function setupControls() {
  // Days filter
  $('days-filter').addEventListener('change', async e => {
    currentDays = Number(e.target.value);
    await loadCampaigns();
  });

  // Status tabs
  document.querySelectorAll('#status-tabs .tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#status-tabs .tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeStatus = btn.dataset.status;
      renderTable();
    });
  });

  // Search
  $('campaign-search').addEventListener('input', () => renderTable());

  // Logout
  $('logout-btn').addEventListener('click', async () => {
    await fetch('/auth/logout', { method: 'POST', credentials: 'include' });
    window.location.href = '/index.html';
  });
}

// ---- Data loading ----

async function loadCampaigns() {
  $('campaigns-body').innerHTML = `<tr><td colspan="11" class="loading-cell">Loading campaigns…</td></tr>`;
  try {
    const res = await fetch(`/campaigns?days=${currentDays}`, { credentials: 'include' });
    if (!res.ok) throw new Error('Failed to load campaigns');
    allCampaigns = await res.json();
    renderTable();
  } catch (e) {
    $('campaigns-body').innerHTML = `<tr><td colspan="11" class="loading-cell">Could not load campaigns. Make sure your Amazon Ads account is connected.</td></tr>`;
  }
}

async function loadPendingActions() {
  try {
    const res = await fetch('/campaigns/actions/pending', { credentials: 'include' });
    if (!res.ok) return;
    const actions = await res.json();
    if (actions.length > 0) {
      $('pending-count').textContent = actions.length;
      $('pending-actions-banner').classList.remove('hidden');
    }
  } catch (e) { /* silent */ }
}

// ---- Render ----

function renderTable() {
  const search = $('campaign-search').value.toLowerCase().trim();

  const filtered = allCampaigns.filter(c => {
    const status = (c.STATUS || c.status || '').toLowerCase();
    const name = (c.CAMPAIGN_NAME || c.campaign_name || '').toLowerCase();
    const matchStatus = activeStatus === 'all' || status === activeStatus ||
      (activeStatus === 'enabled' && (status === 'enabled' || status === 'active'));
    const matchSearch = !search || name.includes(search);
    return matchStatus && matchSearch;
  });

  $('campaigns-count').textContent = `${filtered.length} campaign${filtered.length !== 1 ? 's' : ''}`;

  if (filtered.length === 0) {
    $('campaigns-body').innerHTML = `<tr><td colspan="11" class="loading-cell">No campaigns match your filters.</td></tr>`;
    return;
  }

  const tbody = document.createElement('tbody');
  tbody.id = 'campaigns-body';

  filtered.forEach(c => {
    const id = c.CAMPAIGN_ID || c.campaign_id;
    const name = c.CAMPAIGN_NAME || c.campaign_name || id;
    const type = c.CAMPAIGN_TYPE || c.campaign_type || '—';
    const channel = c.CONNECTION_TYPE || c.connection_type || '—';
    const status = c.STATUS || c.status || 'unknown';
    const budget = c.BUDGET || c.budget;
    const spend = c.SPEND || c.spend || 0;
    const sales = c.SALES || c.sales || 0;
    const acos = c.ACOS || c.acos;
    const roas = c.ROAS || c.roas;

    const statusClass = status === 'enabled' || status === 'active' ? 'status-active'
                      : status === 'paused' ? 'status-paused'
                      : 'status-archived';
    const statusLabel = status === 'enabled' ? 'Active' :
                        status.charAt(0).toUpperCase() + status.slice(1);

    const isPaused = status === 'paused';

    // Main row
    const tr = document.createElement('tr');
    tr.className = 'campaign-row';
    tr.dataset.id = id;
    tr.innerHTML = `
      <td class="expand-cell">
        <button class="expand-btn" data-id="${escHtml(id)}" title="Show trend">▶</button>
      </td>
      <td class="campaign-name-cell" title="${escHtml(name)}">${escHtml(name)}</td>
      <td><span class="badge-type">${escHtml(type)}</span></td>
      <td><span class="badge-${escHtml(channel.toLowerCase())}">${escHtml(channel.toUpperCase())}</span></td>
      <td><span class="campaign-status ${statusClass}">${escHtml(statusLabel)}</span></td>
      <td>${budget != null ? '$' + fmtNum(budget) : '—'}</td>
      <td>$${fmtNum(spend)}</td>
      <td>$${fmtNum(sales)}</td>
      <td>${acos != null ? pct(acos) : '—'}</td>
      <td>${roas != null ? Number(roas).toFixed(2) + 'x' : '—'}</td>
      <td class="actions-cell">
        <button class="btn-action btn-pause-resume"
          data-id="${escHtml(id)}"
          data-action="${isPaused ? 'resume' : 'pause'}"
          title="${isPaused ? 'Queue resume' : 'Queue pause'}">
          ${isPaused ? '▶ Resume' : '⏸ Pause'}
        </button>
        <button class="btn-action btn-budget" data-id="${escHtml(id)}" title="Queue budget update">
          💰 Budget
        </button>
      </td>
    `;
    tbody.appendChild(tr);

    // Expand row (hidden by default)
    const expandTr = document.createElement('tr');
    expandTr.className = 'campaign-expand-row hidden';
    expandTr.dataset.expandFor = id;
    expandTr.innerHTML = `
      <td colspan="11" class="campaign-expand-cell">
        <div class="campaign-expand-inner">
          <div class="chart-card" style="margin:0">
            <h3>Daily Performance Trend (${currentDays}d)</h3>
            <canvas id="trend-chart-${escHtml(id)}" style="max-height:200px"></canvas>
          </div>
        </div>
      </td>
    `;
    tbody.appendChild(expandTr);
  });

  $('campaigns-body').replaceWith(tbody);

  // Bind expand buttons
  document.querySelectorAll('.expand-btn').forEach(btn => {
    btn.addEventListener('click', () => toggleExpand(btn.dataset.id, btn));
  });

  // Bind action buttons
  document.querySelectorAll('.btn-pause-resume').forEach(btn => {
    btn.addEventListener('click', () => queueAction(btn.dataset.id, btn.dataset.action, btn));
  });

  document.querySelectorAll('.btn-budget').forEach(btn => {
    btn.addEventListener('click', () => promptBudget(btn.dataset.id, btn));
  });
}

// ---- Expand / trend chart ----

async function toggleExpand(campaignId, btn) {
  const expandRow = document.querySelector(`tr[data-expand-for="${campaignId}"]`);
  if (!expandRow) return;

  const isExpanded = !expandRow.classList.contains('hidden');
  if (isExpanded) {
    expandRow.classList.add('hidden');
    btn.textContent = '▶';
    return;
  }

  // Close any other open expand
  document.querySelectorAll('.campaign-expand-row:not(.hidden)').forEach(r => {
    r.classList.add('hidden');
    const prevBtn = document.querySelector(`.expand-btn[data-id="${r.dataset.expandFor}"]`);
    if (prevBtn) prevBtn.textContent = '▶';
  });

  expandRow.classList.remove('hidden');
  btn.textContent = '▼';

  const canvasId = `trend-chart-${campaignId}`;
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  // Destroy old chart if exists
  if (trendCharts[campaignId]) {
    trendCharts[campaignId].destroy();
    delete trendCharts[campaignId];
  }

  canvas.parentElement.insertAdjacentHTML('beforeend', `<p class="loading-cell" id="trend-loading-${campaignId}">Loading trend…</p>`);

  try {
    const res = await fetch(`/campaigns/${encodeURIComponent(campaignId)}?days=${currentDays}`, { credentials: 'include' });
    if (!res.ok) throw new Error('Not found');
    const { trend } = await res.json();

    const loadingEl = document.getElementById(`trend-loading-${campaignId}`);
    if (loadingEl) loadingEl.remove();

    if (!trend || trend.length === 0) {
      canvas.insertAdjacentHTML('afterend', '<p class="loading-cell">No daily data available.</p>');
      return;
    }

    const labels = trend.map(r => r.REPORT_DATE || r.report_date);
    const spendData = trend.map(r => Number(r.SPEND || r.spend || 0));
    const salesData = trend.map(r => Number(r.SALES || r.sales || 0));

    trendCharts[campaignId] = new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Spend',
            data: spendData,
            borderColor: '#c81e1e',
            backgroundColor: 'rgba(200,30,30,.08)',
            borderWidth: 2,
            tension: 0.3,
            fill: true,
            pointRadius: 3
          },
          {
            label: 'Sales',
            data: salesData,
            borderColor: '#2d5a27',
            backgroundColor: 'rgba(45,90,39,.08)',
            borderWidth: 2,
            tension: 0.3,
            fill: true,
            pointRadius: 3
          }
        ]
      },
      options: {
        responsive: true,
        plugins: { legend: { position: 'top' } },
        scales: {
          y: { beginAtZero: true, ticks: { callback: v => '$' + v.toLocaleString() } },
          x: { ticks: { maxTicksLimit: 10 } }
        }
      }
    });
  } catch (e) {
    const loadingEl = document.getElementById(`trend-loading-${campaignId}`);
    if (loadingEl) loadingEl.textContent = 'Could not load trend data.';
  }
}

// ---- Write actions (gated) ----

async function queueAction(campaignId, action, btn) {
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⏳ Queuing…';

  try {
    const res = await fetch(`/campaigns/${encodeURIComponent(campaignId)}/${action}`, {
      method: 'POST',
      credentials: 'include'
    });
    const data = await res.json();

    btn.textContent = '✅ Queued';
    btn.classList.add('btn-queued');

    // Refresh pending count
    await loadPendingActions();

    // Show brief toast
    showToast(`${action.charAt(0).toUpperCase() + action.slice(1)} queued — will execute when write permissions are active`);
  } catch (e) {
    btn.disabled = false;
    btn.textContent = originalText;
    showToast('Failed to queue action', true);
  }
}

async function promptBudget(campaignId, btn) {
  const campaign = allCampaigns.find(c =>
    (c.CAMPAIGN_ID || c.campaign_id) === campaignId
  );
  const currentBudget = campaign ? (campaign.BUDGET || campaign.budget || '') : '';
  const input = prompt(`Enter new daily budget for campaign:\n(Current: ${currentBudget ? '$' + Number(currentBudget).toFixed(2) : 'unknown'})`, currentBudget || '');

  if (input === null) return; // cancelled
  const budget = Number(input);
  if (!budget || budget <= 0) { alert('Please enter a valid positive budget amount.'); return; }

  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⏳ Queuing…';

  try {
    const res = await fetch(`/campaigns/${encodeURIComponent(campaignId)}/budget`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ budget })
    });
    await res.json();

    btn.textContent = '✅ Queued';
    btn.classList.add('btn-queued');
    await loadPendingActions();
    showToast(`Budget update to $${budget.toFixed(2)} queued`);
  } catch (e) {
    btn.disabled = false;
    btn.textContent = originalText;
    showToast('Failed to queue budget update', true);
  }
}

// ---- Toast ----

function showToast(msg, isError = false) {
  const existing = document.querySelector('.cb-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `cb-toast ${isError ? 'cb-toast-error' : ''}`;
  toast.textContent = msg;
  document.body.appendChild(toast);

  setTimeout(() => toast.classList.add('cb-toast-show'), 10);
  setTimeout(() => {
    toast.classList.remove('cb-toast-show');
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// ---- Helpers ----

function fmtNum(val) {
  if (val == null) return '—';
  return Number(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function pct(val) {
  if (val == null) return '—';
  return (Number(val) * 100).toFixed(1) + '%';
}

function escHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
