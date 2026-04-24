// Agency Portal — Brand Management
// Handles brand list, add-brand modal, and toasts.

// ── Load brands ───────────────────────────────────────────────────────────────
async function loadBrands() {
  const grid      = document.getElementById('brand-grid');
  const emptyState = document.getElementById('empty-state');
  const loadingEl = document.getElementById('loading-state');

  grid.innerHTML = '';
  loadingEl.style.display = 'block';
  emptyState.style.display = 'none';

  try {
    const res  = await fetch('/agency/brands', { credentials: 'include' });
    if (res.status === 403) {
      loadingEl.style.display = 'none';
      grid.innerHTML = '<p style="color:var(--danger);padding:20px;">Access denied — agency account required.</p>';
      return;
    }
    const data = res.ok ? await res.json() : { brands: [] };
    const brands = data.brands || [];

    loadingEl.style.display = 'none';

    if (!brands.length) {
      emptyState.style.display = 'flex';
      return;
    }

    emptyState.style.display = 'none';
    brands.forEach(brand => {
      grid.appendChild(buildBrandCard(brand));
    });
  } catch (err) {
    loadingEl.style.display = 'none';
    grid.innerHTML = `<p style="color:var(--danger);padding:20px;">Failed to load brands: ${err.message}</p>`;
  }
}

// ── Build a brand card DOM node ───────────────────────────────────────────────
function buildBrandCard(brand) {
  const card = document.createElement('div');
  card.className = 'brand-card';

  const initial = (brand.brandName || 'B').charAt(0).toUpperCase();
  const logoHtml = brand.logoUrl
    ? `<img src="${brand.logoUrl}" alt="${escHtml(brand.brandName)}" class="brand-logo-img" />`
    : `<div class="brand-logo-placeholder">${initial}</div>`;

  const mpBadge  = `<span class="badge badge-mp">${escHtml(brand.marketplace || 'US')}</span>`;
  const planBadge = `<span class="badge badge-plan badge-${(brand.plan || 'free').toLowerCase()}">${escHtml(brand.plan || 'free')}</span>`;
  const connHtml = formatConnectionStatus(brand.connections || {});

  const manageHref = brand.clientId
    ? `/analytics/?brand=${encodeURIComponent(brand.clientId)}`
    : '/analytics/';

  card.innerHTML = `
    <div class="brand-card-header">
      ${logoHtml}
      <div class="brand-card-meta">
        <div class="brand-card-name">${escHtml(brand.brandName)}</div>
        <div class="brand-card-badges">${mpBadge} ${planBadge}</div>
      </div>
    </div>
    <div class="brand-card-connections">
      ${connHtml}
    </div>
    <div class="brand-card-footer">
      <a href="${manageHref}" class="btn btn-manage">Dashboard →</a>
      <a href="/analytics/account?brand=${encodeURIComponent(brand.clientId || '')}" class="btn btn-secondary" style="font-size:0.8rem;padding:5px 10px;">⚙ Settings</a>
    </div>
  `;
  return card;
}

// ── Format connection status dots ─────────────────────────────────────────────
function formatConnectionStatus(connections) {
  const items = [
    { key: 'ads',    label: 'Ads'    },
    { key: 'vendor', label: 'Vendor' },
    { key: 'seller', label: 'Seller' },
  ];
  return items.map(({ key, label }) => {
    const connected = connections[key] === true;
    const cls = connected ? 'dot-connected' : 'dot-disconnected';
    const title = connected ? `${label}: connected` : `${label}: not connected`;
    return `<span class="conn-dot-wrap" title="${title}">
      <span class="conn-dot ${cls}"></span>
      <span class="conn-label">${label}</span>
    </span>`;
  }).join('');
}

// ── Modal ─────────────────────────────────────────────────────────────────────
function openAddBrandModal() {
  document.getElementById('add-brand-modal').classList.add('open');
  document.getElementById('modal-brand-name').focus();
}

function closeAddBrandModal() {
  document.getElementById('add-brand-modal').classList.remove('open');
  document.getElementById('add-brand-form').reset();
  document.getElementById('modal-error').textContent = '';
  document.getElementById('modal-submit-btn').disabled = false;
  document.getElementById('modal-submit-btn').textContent = 'Create Brand';
}

// ── Submit add brand ──────────────────────────────────────────────────────────
async function submitAddBrand(e) {
  e.preventDefault();
  const btn     = document.getElementById('modal-submit-btn');
  const errorEl = document.getElementById('modal-error');
  errorEl.textContent = '';
  btn.disabled = true;
  btn.textContent = 'Creating…';

  const brandName    = document.getElementById('modal-brand-name').value.trim();
  const contactEmail = document.getElementById('modal-contact-email').value.trim();
  const marketplace  = document.getElementById('modal-marketplace').value;

  try {
    const res  = await fetch('/agency/brands', {
      method:      'POST',
      headers:     { 'Content-Type': 'application/json' },
      credentials: 'include',
      body:        JSON.stringify({ brandName, contactEmail: contactEmail || undefined, marketplace }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to create brand');

    closeAddBrandModal();
    showToast(`Brand "${brandName}" created!`, 'success');
    await loadBrands();
  } catch (err) {
    errorEl.textContent = err.message;
    btn.disabled = false;
    btn.textContent = 'Create Brand';
  }
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function showToast(msg, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = `toast ${type} show`;
  setTimeout(() => { toast.classList.remove('show'); }, 3200);
}

// ── Util ──────────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Session: load client name + handle logout ─────────────────────────────────
async function initSession() {
  try {
    const res  = await fetch('/auth/me', { credentials: 'include' });
    if (!res.ok) { window.location.href = '/login.html'; return; }
    const data = await res.json();
    const displayName = data.client?.name || data.client?.email || '';
    const nameEl = document.getElementById('client-name');
    if (nameEl) nameEl.textContent = displayName;
    // Set initials in sidebar badge
    const initialsEl = document.getElementById('client-initials');
    if (initialsEl && displayName) {
      const parts = displayName.trim().split(/\s+/);
      const initials = parts.length >= 2
        ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
        : displayName.slice(0, 2).toUpperCase();
      initialsEl.textContent = initials;
    }
  } catch {
    window.location.href = '/login.html';
  }
  document.getElementById('logout-btn')?.addEventListener('click', async () => {
    await fetch('/auth/logout', { method: 'POST', credentials: 'include' });
    window.location.href = '/login.html';
  });
}

// ── Portfolio KPI ─────────────────────────────────────────────────────────────

function fmtCurrency(val) {
  const n = Number(val) || 0;
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtNumber(val) {
  return (Number(val) || 0).toLocaleString('en-US');
}

function fmtRoas(val) {
  return (Number(val) || 0).toFixed(2) + '\u00d7';
}

function fmtAcos(val) {
  return (Number(val) || 0).toFixed(1) + '%';
}

async function loadPortfolioKpis(days) {
  days = days || 30;

  // Reset tiles to loading dash
  ['kpi-spend', 'kpi-sales', 'kpi-roas', 'kpi-acos', 'kpi-impressions', 'kpi-clicks'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = '\u2014';
  });

  const tbody = document.getElementById('brand-kpi-body');
  if (tbody) tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#9ca3af;">Loading\u2026</td></tr>';

  try {
    const res  = await fetch(`/agency/kpi-summary?days=${days}`, { credentials: 'include' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      if (tbody) tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:#dc2626;">Failed to load KPIs: ${escHtml(err.error || res.statusText)}</td></tr>`;
      return;
    }
    const data = await res.json();
    const s = data.summary || {};

    // Populate summary tiles
    const setTile = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    setTile('kpi-spend',       fmtCurrency(s.totalSpend));
    setTile('kpi-sales',       fmtCurrency(s.totalSales));
    setTile('kpi-roas',        fmtRoas(s.blendedRoas));
    setTile('kpi-acos',        fmtAcos(s.blendedAcos));
    setTile('kpi-impressions', fmtNumber(s.totalImpressions));
    setTile('kpi-clicks',      fmtNumber(s.totalClicks));

    // Populate per-brand table
    const brands = data.brands || [];
    if (!brands.length) {
      if (tbody) tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#9ca3af;">No brand data yet.</td></tr>';
      return;
    }

    if (tbody) {
      tbody.innerHTML = brands.map(b => `
        <tr>
          <td>${escHtml(b.brandName || '\u2014')}</td>
          <td>${fmtCurrency(b.spend)}</td>
          <td>${fmtCurrency(b.sales)}</td>
          <td>${fmtRoas(b.roas)}</td>
          <td>${fmtAcos(b.acos)}</td>
          <td>${fmtNumber(b.impressions)}</td>
          <td>${fmtNumber(b.clicks)}</td>
          <td>${fmtNumber(b.campaigns)}</td>
        </tr>
      `).join('');
    }
  } catch (err) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:#dc2626;">Error: ${escHtml(err.message)}</td></tr>`;
  }
}

// ── Boot ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initSession();
  loadBrands();
  loadPortfolioKpis(30);

  // Days selector for portfolio KPIs
  const daysSelect = document.getElementById('kpi-days-select');
  if (daysSelect) {
    daysSelect.addEventListener('change', () => loadPortfolioKpis(parseInt(daysSelect.value, 10)));
  }

  initSession();
  loadBrands();

  // Modal form submit
  document.getElementById('add-brand-form').addEventListener('submit', submitAddBrand);

  // Close modal on backdrop click
  document.getElementById('add-brand-modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeAddBrandModal();
  });

  // Mobile hamburger
  const hamburger = document.getElementById('hamburger-btn');
  const overlay   = document.getElementById('sidebar-overlay');
  const sidebar   = document.querySelector('.sidebar');
  if (hamburger) {
    hamburger.addEventListener('click', () => {
      sidebar.classList.toggle('mobile-open');
      overlay.style.display = sidebar.classList.contains('mobile-open') ? 'block' : 'none';
    });
    overlay.addEventListener('click', () => {
      sidebar.classList.remove('mobile-open');
      overlay.style.display = 'none';
    });
  }
});
