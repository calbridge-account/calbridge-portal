// Calbridge Admin Panel — session-based auth

let currentAdmin = null;
let allClients = [];

document.addEventListener('DOMContentLoaded', async () => {
  await checkAdminAuth();

  document.getElementById('admin-login-btn').addEventListener('click', tryLogin);
  document.getElementById('admin-email-input').addEventListener('keydown', e => { if (e.key === 'Enter') tryLogin(); });
  document.getElementById('admin-password-input').addEventListener('keydown', e => { if (e.key === 'Enter') tryLogin(); });

  document.getElementById('admin-logout-btn').addEventListener('click', async () => {
    await fetch('/admin/logout', { method: 'POST', credentials: 'include' });
    location.reload();
  });

  document.getElementById('refresh-btn').addEventListener('click', loadAll);

  document.querySelectorAll('.admin-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.admin-section').forEach(s => s.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
      if (tab.dataset.tab === 'logs')               loadLogs();
      if (tab.dataset.tab === 'admins')             loadAdminUsers();
      if (tab.dataset.tab === 'spend-adjustments')  loadAdjustments();
      if (tab.dataset.tab === 'nav-visibility')     initNavVisibility();
      if (tab.dataset.tab === 'account-structure')  loadAccountStructure();
      if (tab.dataset.tab === 'accounts')           loadAccounts();
      if (tab.dataset.tab === 'agencies')           initAgenciesRoster();
      if (tab.dataset.tab === 'brands')             initBrandsRoster();
      if (tab.dataset.tab === 'competitors')        initCompetitors();
    });
  });

  document.getElementById('client-search').addEventListener('input', e => {
    renderClients(e.target.value.toLowerCase());
  });

  document.getElementById('send-invite-btn').addEventListener('click', sendInvite);
  document.getElementById('add-admin-btn')?.addEventListener('click', addAdminUser);

  // Flush Cache button
  document.getElementById('flush-cache-btn')?.addEventListener('click', async () => {
    const btn    = document.getElementById('flush-cache-btn');
    const status = document.getElementById('flush-cache-status');
    btn.disabled = true; btn.textContent = '⏳ Flushing...';
    try {
      const res  = await adminFetch('/admin/cache/flush', { method: 'POST' });
      const data = await res.json();
      if (res.ok) { status.textContent = `✅ Cleared ${data.entriesRemoved} cache entries`; status.style.color = 'var(--success)'; }
      else        { status.textContent = `❌ ${data.error || 'Failed'}`; status.style.color = 'var(--danger)'; }
    } catch { status.textContent = '❌ Request failed'; status.style.color = 'var(--danger)'; }
    finally  { btn.disabled = false; btn.textContent = '🔄 Flush Cache'; setTimeout(() => { status.textContent = ''; }, 5000); }
  });

  // Weekly Reports button
  document.getElementById('send-weekly-reports-btn')?.addEventListener('click', async () => {
    const btn    = document.getElementById('send-weekly-reports-btn');
    const status = document.getElementById('weekly-report-status');
    btn.disabled = true; btn.textContent = '⏳ Sending...'; status.textContent = '';
    try {
      const res  = await adminFetch('/admin/send-weekly-reports', { method: 'POST' });
      const data = await res.json();
      if (res.ok) { status.textContent = `✅ Queued for ${data.clientCount} active client(s)`; status.style.color = 'var(--success)'; }
      else         { status.textContent = `❌ ${data.error || 'Failed'}`; status.style.color = 'var(--danger)'; }
    } catch { status.textContent = '❌ Request failed'; status.style.color = 'var(--danger)'; }
    finally  { btn.disabled = false; btn.textContent = '📧 Send Weekly Reports'; }
  });

  // Spend adjustments — save button
  document.getElementById('save-adj-btn')?.addEventListener('click', saveAdjustment);

  // Spend adjustments — filter
  document.getElementById('sa-filter-client')?.addEventListener('change', () => {
    renderAdjTable(document.getElementById('sa-filter-client').value);
  });
});

// ── Auth ─────────────────────────────────────────────────────────────────────
async function checkAdminAuth() {
  const res = await fetch('/admin/me', { credentials: 'include' });
  if (res.ok) { currentAdmin = await res.json(); showPanel(); }
}

async function tryLogin() {
  const email    = document.getElementById('admin-email-input').value.trim();
  const password = document.getElementById('admin-password-input').value;
  const btn      = document.getElementById('admin-login-btn');
  if (!email || !password) { showLoginError('Email and password required'); return; }
  btn.disabled = true; btn.textContent = 'Signing in...';
  const res  = await fetch('/admin/login', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  const data = await res.json();
  if (!res.ok) {
    showLoginError(data.error || 'Invalid credentials');
    btn.disabled = false; btn.textContent = 'Sign In to Admin';
    return;
  }
  currentAdmin = data.admin;
  showPanel();
}

function showLoginError(msg) {
  const el = document.getElementById('admin-login-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

function showPanel() {
  document.getElementById('admin-login').style.display  = 'none';
  document.getElementById('admin-panel').style.display  = 'block';
  document.getElementById('admin-name-display').textContent = currentAdmin?.name || 'Admin';
  if (currentAdmin?.role === 'superadmin') {
    document.getElementById('admins-tab').style.display = '';
  }
  loadAll();
}

async function adminFetch(path, options = {}) {
  return fetch(path, { credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...options });
}

// ── Load all ─────────────────────────────────────────────────────────────────
async function loadAll() {
  // Clients must load first — adjustments dropdown depends on allClients being populated
  await loadClients();
  await loadAdjustments();
}

// ── Clients ───────────────────────────────────────────────────────────────────
async function loadClients() {
  const res = await adminFetch('/admin/clients');
  if (!res.ok) return;
  allClients = await res.json();
  renderClients('');
  updateStats();
  document.getElementById('admin-subtitle').textContent =
    `${allClients.length} total clients · Updated ${new Date().toLocaleTimeString()}`;
}

function updateStats() {
  document.getElementById('stat-total').textContent     = allClients.length;
  document.getElementById('stat-pending').textContent   = allClients.filter(c => c.status === 'pending').length;
  document.getElementById('stat-active').textContent    = allClients.filter(c => c.status === 'active').length;
  document.getElementById('stat-suspended').textContent = allClients.filter(c => c.status === 'suspended').length;
}

function renderClients(search) {
  const tbody    = document.getElementById('clients-table-body');
  const filtered = search
    ? allClients.filter(c =>
        c.name?.toLowerCase().includes(search) ||
        c.email?.toLowerCase().includes(search) ||
        c.companyName?.toLowerCase().includes(search) ||
        c.managerName?.toLowerCase().includes(search))
    : allClients;

  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="loading-cell">No clients found</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(c => `
    <tr>
      <td><strong>${c.name || '—'}</strong></td>
      <td>${c.email}</td>
      <td>${c.companyName || '—'}</td>
      <td>${c.managerName
        ? `<span style="font-size:12px;background:var(--brand-light);color:var(--brand);padding:2px 8px;border-radius:20px;font-weight:600">${c.managerName}</span>`
        : '<span style="color:var(--gray-300);font-size:12px">— not mapped</span>'}
      </td>
      <td><span class="status-pill pill-${c.status || 'active'}">${c.status || 'active'}</span></td>
      <td>${c.subscriptionPlan ? `<span class="status-pill" style="background:var(--brand-light);color:var(--brand)">${c.subscriptionPlan}</span>` : '<span style="color:var(--gray-300);font-size:12px">—</span>'}</td>
      <td>${c.lastLoginAt ? new Date(c.lastLoginAt).toLocaleString() : '—'}</td>
      <td>${c.createdAt  ? new Date(c.createdAt).toLocaleDateString() : '—'}</td>
      <td>
        ${['pending','invited'].includes(c.status) ? `<button class="action-btn btn-approve"   onclick="approveClient('${c.clientId}','${c.email}')">Approve</button>` : ''}
        ${c.status === 'active'    ? `<button class="action-btn btn-suspend"   onclick="suspendClient('${c.clientId}','${c.email}')">Suspend</button>`   : ''}
        ${c.status === 'suspended' ? `<button class="action-btn btn-unsuspend" onclick="approveClient('${c.clientId}','${c.email}')">Reinstate</button>` : ''}
        <button class="action-btn btn-approve" onclick="showUpdatePlan('${c.managerId || c.clientId}','${c.name || c.companyName}','${c.subscriptionPlan || ''}','${c.subscriptionStatus || ''}')">✏️ Plan</button>
      </td>
    </tr>
  `).join('');
}

async function approveClient(id, email) {
  if (!confirm(`Approve ${email}?`)) return;
  const res  = await adminFetch(`/admin/approve/${id}`, { method: 'POST' });
  const data = await res.json();
  alert(data.message);
  await loadClients();
}

async function suspendClient(id, email) {
  if (!confirm(`Suspend ${email}? They will lose access immediately.`)) return;
  const res  = await adminFetch(`/admin/suspend/${id}`, { method: 'POST' });
  const data = await res.json();
  alert(data.message);
  await loadClients();
}

async function sendInvite() {
  const name    = document.getElementById('inv-name').value.trim();
  const company = document.getElementById('inv-company').value.trim();
  const email   = document.getElementById('inv-email').value.trim();
  const result  = document.getElementById('invite-result');
  if (!name || !email) { showResult(result, 'Name and email are required', 'error'); return; }
  const res  = await adminFetch('/admin/invite', { method: 'POST', body: JSON.stringify({ name, email, companyName: company }) });
  const data = await res.json();
  if (!res.ok) { showResult(result, data.error, 'error'); return; }
  showResult(result, `Invite sent to ${email}`, 'success');
  document.getElementById('inv-name').value    = '';
  document.getElementById('inv-company').value = '';
  document.getElementById('inv-email').value   = '';
  await loadClients();
}

// ── Logs ──────────────────────────────────────────────────────────────────────
async function loadLogs() {
  const tbody = document.getElementById('logs-table-body');
  tbody.innerHTML = '<tr><td colspan="7" class="loading-cell">Loading...</td></tr>';
  const res = await adminFetch('/admin/logs');
  if (!res.ok) { tbody.innerHTML = '<tr><td colspan="7" class="loading-cell">Could not load logs</td></tr>'; return; }
  const logs = await res.json();
  if (!logs.length) { tbody.innerHTML = '<tr><td colspan="7" class="loading-cell">No sync activity yet</td></tr>'; return; }
  tbody.innerHTML = logs.map(l => `
    <tr>
      <td style="font-size:11px;color:var(--gray-400)">${l.CLIENT_ID}</td>
      <td>${l.CONNECTION_TYPE}</td>
      <td>${l.JOB_TYPE}</td>
      <td><span class="status-pill pill-${l.STATUS === 'success' ? 'active' : l.STATUS === 'running' ? 'invited' : 'suspended'}">${l.STATUS}</span></td>
      <td>${l.RECORDS_WRITTEN || 0}</td>
      <td>${l.STARTED_AT ? new Date(l.STARTED_AT).toLocaleString() : '—'}</td>
      <td style="font-size:11px;color:var(--danger);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
          title="${l.ERROR_MESSAGE || ''}">${l.ERROR_MESSAGE ? l.ERROR_MESSAGE.substring(0,60)+'...' : '—'}</td>
    </tr>
  `).join('');
}

// ── Admin Users ───────────────────────────────────────────────────────────────
async function loadAdminUsers() {
  const tbody = document.getElementById('admins-table-body');
  tbody.innerHTML = '<tr><td colspan="5" class="loading-cell">Loading...</td></tr>';
  const res = await adminFetch('/admin/users');
  if (!res.ok) { tbody.innerHTML = '<tr><td colspan="5" class="loading-cell">Superadmin required</td></tr>'; return; }
  const users = await res.json();
  tbody.innerHTML = users.map(u => `
    <tr>
      <td><strong>${u.name}</strong>${u.id === currentAdmin?.id ? ' <span style="font-size:11px;color:var(--gray-400)">(you)</span>' : ''}</td>
      <td>${u.email}</td>
      <td><span class="status-pill pill-${u.role === 'superadmin' ? 'active' : 'invited'}">${u.role}</span></td>
      <td>${u.lastLogin ? new Date(u.lastLogin).toLocaleString() : 'Never'}</td>
      <td>${u.id !== currentAdmin?.id ? `<button class="action-btn btn-suspend" onclick="removeAdmin('${u.id}','${u.name}')">Remove</button>` : ''}</td>
    </tr>
  `).join('');
}

async function addAdminUser() {
  const name     = document.getElementById('adm-name').value.trim();
  const email    = document.getElementById('adm-email').value.trim();
  const password = document.getElementById('adm-password').value;
  const role     = document.getElementById('adm-role').value;
  const result   = document.getElementById('adm-result');
  if (!name || !email || !password) { showResult(result, 'All fields required', 'error'); return; }
  const res  = await adminFetch('/admin/users', { method: 'POST', body: JSON.stringify({ name, email, password, role }) });
  const data = await res.json();
  if (!res.ok) { showResult(result, data.error, 'error'); return; }
  showResult(result, `Admin user ${email} created`, 'success');
  document.getElementById('adm-name').value     = '';
  document.getElementById('adm-email').value    = '';
  document.getElementById('adm-password').value = '';
  await loadAdminUsers();
}

async function removeAdmin(id, name) {
  if (!confirm(`Remove admin access for ${name}?`)) return;
  const res  = await adminFetch(`/admin/users/${id}`, { method: 'DELETE' });
  const data = await res.json();
  alert(data.message);
  await loadAdminUsers();
}

// ── Spend Adjustments ─────────────────────────────────────────────────────────
let allAdjustments = [];

function adjPctLabel(mult) {
  const pct = ((mult - 1) * 100).toFixed(1);
  if (pct > 0) return `<span style="color:var(--success)">+${pct}%</span>`;
  if (pct < 0) return `<span style="color:var(--danger)">${pct}%</span>`;
  return '<span style="color:var(--gray-400)">±0%</span>';
}

function renderAdjTable(filter) {
  const tbody = document.getElementById('adj-table-body');
  if (!tbody) return;
  const rows = filter ? allAdjustments.filter(a => a.clientId === filter) : allAdjustments;
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="loading-cell">No adjustments set.</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map(a => `
    <tr>
      <td style="font-size:13px"><strong>${a.companyName}</strong></td>
      <td style="font-size:13px">${a.yearMonth}</td>
      <td><span style="font-weight:600">${a.adType}</span></td>
      <td style="font-size:13px">${Number(a.multiplier).toFixed(4)}</td>
      <td>${adjPctLabel(a.multiplier)}</td>
      <td style="font-size:12px;color:var(--gray-500)">${a.note || '—'}</td>
      <td style="font-size:12px;color:var(--gray-400)">${a.createdBy || '—'}</td>
      <td><button class="action-btn btn-suspend" onclick="deleteAdj(${a.id})">Delete</button></td>
    </tr>
  `).join('');
}

async function loadAdjustments() {
  const tbody = document.getElementById('adj-table-body');
  if (!tbody) return;
  try {
    const res = await adminFetch('/admin/spend-adjustments');
    if (!res.ok) throw new Error();
    allAdjustments = await res.json();

    // Populate client dropdowns — rebuild each time to stay in sync with allClients
    const saClient  = document.getElementById('sa-client');
    const filterSel = document.getElementById('sa-filter-client');
    if (saClient) {
      const prevVal = saClient.value;
      saClient.innerHTML = '<option value="">Select client&hellip;</option>';
      filterSel.innerHTML = '<option value="">All clients</option>';
      allClients.forEach(c => {
        const label = c.companyName || c.name || c.email;
        saClient.insertAdjacentHTML('beforeend',  `<option value="${c.clientId}">${label}</option>`);
        filterSel.insertAdjacentHTML('beforeend', `<option value="${c.clientId}">${label}</option>`);
      });
      if (prevVal) saClient.value = prevVal;
    }

    renderAdjTable(document.getElementById('sa-filter-client')?.value || '');
  } catch {
    if (tbody) tbody.innerHTML = '<tr><td colspan="8" class="loading-cell">Error loading adjustments.</td></tr>';
  }
}

async function saveAdjustment() {
  const result     = document.getElementById('sa-result');
  const clientId   = document.getElementById('sa-client')?.value;
  const yearMonth  = document.getElementById('sa-month')?.value;
  const adType     = document.getElementById('sa-adtype')?.value;
  const multiplier = parseFloat(document.getElementById('sa-multiplier')?.value);
  const note       = document.getElementById('sa-note')?.value?.trim();

  result.className = 'status-msg hidden';

  if (!clientId || !yearMonth || !adType || isNaN(multiplier)) {
    result.className = 'status-msg error';
    result.textContent = 'Client, month, ad type, and multiplier are all required.';
    return;
  }

  const btn = document.getElementById('save-adj-btn');
  btn.disabled = true; btn.textContent = 'Saving…';

  try {
    const res  = await adminFetch('/admin/spend-adjustments', {
      method: 'POST',
      body: JSON.stringify({ clientId, yearMonth, adType, multiplier, note })
    });
    const data = await res.json();
    if (!res.ok) {
      result.className   = 'status-msg error';
      result.textContent = data.error || 'Save failed.';
    } else {
      result.className   = 'status-msg success';
      result.textContent = '✅ Adjustment saved.';
      document.getElementById('sa-multiplier').value = '';
      document.getElementById('sa-note').value       = '';
      await loadAdjustments();
    }
  } catch {
    result.className   = 'status-msg error';
    result.textContent = 'Request failed.';
  } finally {
    btn.disabled = false; btn.textContent = 'Save';
  }
}

window.deleteAdj = async function (id) {
  if (!confirm('Remove this spend adjustment?')) return;
  try {
    const res = await adminFetch(`/admin/spend-adjustments/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error();
    await loadAdjustments();
  } catch { alert('Failed to delete adjustment.'); }
};

// ── Nav Visibility ─────────────────────────────────────────────────────────────────

const NAV_TABS = [
  { path: '/',            label: 'Overview'           },
  { path: '/vendor',      label: 'Vendor Performance' },
  { path: '/seller',      label: 'Seller Sales'       },
  { path: '/forecasting', label: 'Forecasting'        },
  { path: '/cogs',        label: 'COGS & Margins'     },
  { path: '/advertising', label: 'Advertising'        },
  { path: '/pacing',      label: 'Budget Pacing'      },
  { path: '/reports',     label: 'Report Builder'     },
  { path: '/account',     label: 'Account'            },
];

let nvInitialized = false;

function initNavVisibility() {
  if (!nvInitialized) {
    nvInitialized = true;
    // Populate client dropdown
    const sel = document.getElementById('nv-client');
    if (sel) {
      allClients.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.clientId;
        opt.textContent = c.companyName || c.name || c.email;
        sel.appendChild(opt);
      });
      sel.addEventListener('change', () => loadNavConfig(sel.value));
    }
    document.getElementById('nv-save-btn')?.addEventListener('click', saveNavConfig);
  }
}

async function loadNavConfig(clientId) {
  const wrap   = document.getElementById('nv-table-wrap');
  const tbody  = document.getElementById('nv-table-body');
  const title  = document.getElementById('nv-table-title');
  const saveBtn = document.getElementById('nv-save-btn');
  const result = document.getElementById('nv-result');
  result.className = 'status-msg hidden';

  if (!clientId) {
    wrap.style.display = 'none';
    saveBtn.disabled = true;
    return;
  }

  tbody.innerHTML = '<tr><td colspan="3" class="loading-cell">Loading…</td></tr>';
  wrap.style.display = 'block';

  try {
    const res  = await adminFetch(`/admin/nav-config/${clientId}`);
    if (!res.ok) throw new Error('Failed to load');
    const data = await res.json();
    const cfg  = data.config || {};

    const client = allClients.find(c => c.clientId === clientId);
    title.textContent = `Nav Config — ${client?.companyName || client?.name || clientId}`;

    tbody.innerHTML = NAV_TABS.map(tab => {
      const vis = cfg[tab.path] || 'visible';
      const rowStyle = vis !== 'visible' ? 'background:var(--warning-bg)' : '';
      return `
        <tr style="${rowStyle}">
          <td><strong>${tab.label}</strong></td>
          <td style="font-family:monospace;font-size:12px;color:var(--gray-400)">${tab.path}</td>
          <td>
            <select class="nv-vis-select" data-path="${tab.path}"
              style="padding:6px 10px;border:1px solid var(--gray-200);border-radius:var(--radius);font-size:13px;min-width:160px">
              <option value="visible"  ${vis === 'visible'  ? 'selected' : ''}>✅ Visible</option>
              <option value="grayed"   ${vis === 'grayed'   ? 'selected' : ''}>🔴 Grayed Out (coming soon)</option>
              <option value="hidden"   ${vis === 'hidden'   ? 'selected' : ''}>🚫 Hidden</option>
            </select>
          </td>
        </tr>
      `;
    }).join('');

    // Highlight rows when select changes
    tbody.querySelectorAll('.nv-vis-select').forEach(sel => {
      sel.addEventListener('change', () => {
        const row = sel.closest('tr');
        row.style.background = sel.value !== 'visible' ? 'var(--warning-bg)' : '';
      });
    });

    saveBtn.disabled = false;
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="3" class="loading-cell">Error: ${err.message}</td></tr>`;
    saveBtn.disabled = true;
  }
}

async function saveNavConfig() {
  const clientId = document.getElementById('nv-client')?.value;
  const result   = document.getElementById('nv-result');
  const saveBtn  = document.getElementById('nv-save-btn');
  if (!clientId) return;

  const config = {};
  document.querySelectorAll('.nv-vis-select').forEach(sel => {
    config[sel.dataset.path] = sel.value;
  });

  saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
  result.className = 'status-msg hidden';

  try {
    const res  = await adminFetch(`/admin/nav-config/${clientId}`, {
      method: 'PUT',
      body: JSON.stringify({ config })
    });
    const data = await res.json();
    if (!res.ok) {
      result.className   = 'status-msg error';
      result.textContent = data.error || 'Save failed.';
    } else {
      result.className   = 'status-msg success';
      result.textContent = `✅ Nav config saved (${data.updated} entries updated).`;
      setTimeout(() => result.classList.add('hidden'), 4000);
    }
  } catch {
    result.className   = 'status-msg error';
    result.textContent = 'Request failed.';
  } finally {
    saveBtn.disabled = false; saveBtn.textContent = 'Save Changes';
  }
}

// ── Account Structure ─────────────────────────────────────────────────────────
let allManagers = [];

async function loadAccountStructure() {
  const tbody   = document.getElementById('managers-table-body');
  const overview = document.getElementById('agency-overview');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="6" class="loading-cell">Loading…</td></tr>';
  if (overview) overview.textContent = 'Loading…';

  // Load agency overview and managers in parallel
  try {
    const [agencyRes, managersRes] = await Promise.all([
      adminFetch('/admin/agency'),
      adminFetch('/admin/managers'),
    ]);

    if (agencyRes.ok && overview) {
      const ag = await agencyRes.json();
      if (ag.agencies && ag.agencies.length) {
        const a = ag.agencies[0];
        overview.innerHTML = `
          <div style="display:flex;gap:24px;flex-wrap:wrap">
            <div class="kpi-card" style="min-width:160px">
              <div class="kpi-label">Agency</div>
              <div class="kpi-value" style="font-size:18px">${a.name || 'Calbridge'}</div>
            </div>
            <div class="kpi-card" style="min-width:120px">
              <div class="kpi-label">Managers</div>
              <div class="kpi-value" style="font-size:18px">${ag.managerCount}</div>
            </div>
            <div class="kpi-card" style="min-width:120px">
              <div class="kpi-label">Advertisers</div>
              <div class="kpi-value" style="font-size:18px">${ag.advertiserCount}</div>
            </div>
            <div class="kpi-card" style="min-width:140px">
              <div class="kpi-label">Plan</div>
              <div class="kpi-value" style="font-size:18px">${a.subscriptionPlan || '—'}</div>
            </div>
          </div>
        `;
      } else {
        overview.textContent = 'No agency record found.';
      }
    }

    if (!managersRes.ok) throw new Error('Failed to load managers');
    allManagers = await managersRes.json();
    renderManagersTable();

    // Wire refresh button
    document.getElementById('refresh-managers-btn')?.addEventListener('click', loadAccountStructure);
  } catch (err) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="loading-cell">Error: ${err.message}</td></tr>`;
  }
}

function renderManagersTable() {
  const tbody = document.getElementById('managers-table-body');
  if (!tbody) return;
  if (!allManagers.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="loading-cell">No manager accounts found.</td></tr>';
    return;
  }

  tbody.innerHTML = allManagers.map(m => {
    const planBadge = m.subscriptionPlan
      ? `<span class="status-pill" style="background:var(--brand-light);color:var(--brand)">${m.subscriptionPlan}</span>`
      : '<span style="color:var(--gray-300);font-size:12px">—</span>';
    const statusBadge = m.subscriptionStatus
      ? `<span class="status-pill pill-${m.subscriptionStatus === 'active' ? 'active' : m.subscriptionStatus === 'trialing' ? 'invited' : 'pending'}">${m.subscriptionStatus}</span>`
      : '<span style="color:var(--gray-300);font-size:12px">—</span>';
    return `
      <tr>
        <td><strong>${m.name || '—'}</strong>
          <div style="font-size:11px;font-family:monospace;color:var(--gray-400);margin-top:2px">${m.managerId}</div>
        </td>
        <td>${planBadge}</td>
        <td>${statusBadge}</td>
        <td style="font-size:13px">${m.clientEmail || '<span style="color:var(--gray-300)">— no mapping</span>'}</td>
        <td style="text-align:center">${m.advertiserCount}</td>
        <td>
          <button class="action-btn btn-approve" onclick="showUpdatePlan('${m.managerId || m.clientId}','${m.name}','${m.subscriptionPlan || ''}','${m.subscriptionStatus || ''}')">✏️ Plan</button>
        </td>
      </tr>
    `;
  }).join('');
}

window.showUpdatePlan = function(managerId, managerName, currentPlan, currentStatus) {
  const form   = document.getElementById('update-plan-form');
  const idInput = document.getElementById('plan-manager-id');
  const planSel = document.getElementById('plan-select');
  const statusSel = document.getElementById('status-select');
  const result  = document.getElementById('plan-result');

  idInput.value   = `${managerName} (${managerId})`;
  idInput.dataset.managerId = managerId;
  if (currentPlan)   planSel.value   = currentPlan;
  if (currentStatus) statusSel.value = currentStatus;
  result.className = 'status-msg hidden';
  form.style.display = 'block';
  form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  document.getElementById('cancel-plan-btn').onclick = () => { form.style.display = 'none'; };
  document.getElementById('save-plan-btn').onclick   = savePlan;
};

async function savePlan() {
  const form      = document.getElementById('update-plan-form');
  const idInput   = document.getElementById('plan-manager-id');
  const managerId = idInput.dataset.managerId;
  const plan      = document.getElementById('plan-select').value;
  const status    = document.getElementById('status-select').value;
  const result    = document.getElementById('plan-result');
  const btn       = document.getElementById('save-plan-btn');

  if (!managerId || !plan) return;
  btn.disabled = true; btn.textContent = 'Saving…';
  result.className = 'status-msg hidden';

  try {
    const body = { plan };
    if (status) body.status = status;
    const res  = await adminFetch(`/admin/managers/${managerId}/plan`, { method: 'POST', body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) {
      result.className   = 'status-msg error';
      result.textContent = data.error || 'Save failed.';
    } else {
      result.className   = 'status-msg success';
      result.textContent = '\u2705 Plan updated.';
      setTimeout(() => { form.style.display = 'none'; }, 2000);
      await loadAccountStructure();
    }
  } catch {
    result.className   = 'status-msg error';
    result.textContent = 'Request failed.';
  } finally {
    btn.disabled = false; btn.textContent = 'Save Plan';
  }
}


// ── Accounts (client_accounts registry) ──────────────────────────────────────

let allAccounts = [];
let accountsInitialized = false;

async function loadAccounts() {
  const tbody = document.getElementById('accounts-table-body');
  if (tbody) tbody.innerHTML = '<tr><td colspan="10" class="loading-cell">Loading&hellip;</td></tr>';

  // Populate client dropdown once
  if (!accountsInitialized) {
    accountsInitialized = true;
    const sel = document.getElementById('acct-client');
    if (sel) {
      allClients.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.clientId;
        opt.textContent = c.companyName || c.name || c.email;
        sel.appendChild(opt);
      });
    }
    document.getElementById('add-account-btn')?.addEventListener('click', addAccount);
    document.getElementById('refresh-accounts-btn')?.addEventListener('click', () => { accountsInitialized = false; loadAccounts(); });
  }

  try {
    const res = await adminFetch('/admin/accounts');
    if (!res.ok) throw new Error('Failed to load accounts');
    allAccounts = await res.json();
    renderAccountsTable();
  } catch (err) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="10" class="loading-cell">Error: ${err.message}</td></tr>`;
  }
}

const CHANNEL_LABELS = {
  dsp:           'DSP',
  sponsored_ads: 'Sponsored Ads',
  seller:        'Seller Central',
  vendor:        'Vendor Central',
};

function renderAccountsTable() {
  const tbody = document.getElementById('accounts-table-body');
  if (!tbody) return;
  if (!allAccounts.length) {
    tbody.innerHTML = '<tr><td colspan="10" class="loading-cell">No accounts found.</td></tr>';
    return;
  }

  let lastClient = null;
  tbody.innerHTML = allAccounts.map(a => {
    const isNewClient = a.clientName !== lastClient;
    lastClient = a.clientName;
    const clientCell = isNewClient
      ? `<td style="font-weight:700;font-size:13px">${a.clientName || a.clientId}</td>`
      : `<td style="color:var(--gray-300);font-size:11px">&#8627;</td>`;
    const activeBadge = a.isActive
      ? '<span class="status-pill pill-active">Active</span>'
      : '<span class="status-pill pill-suspended">Retired</span>';
    const retireBtn = a.isActive
      ? `<button class="action-btn btn-suspend" onclick="retireAccount('${a.accountId}','${a.accountName}')">Retire</button>`
      : '<span style="color:var(--gray-300);font-size:11px">retired</span>';
    return `
      <tr style="${!a.isActive ? 'opacity:0.55' : ''}">
        ${clientCell}
        <td style="font-size:13px">${a.accountName || '&mdash;'}</td>
        <td><span style="font-size:12px;background:var(--brand-light);color:var(--brand);padding:2px 8px;border-radius:20px;font-weight:600">${CHANNEL_LABELS[a.channel] || a.channel || '&mdash;'}</span></td>
        <td style="font-size:13px">${a.marketplace || '&mdash;'}</td>
        <td style="font-family:monospace;font-size:11px;color:var(--gray-500)">${a.platformProfileId || '&mdash;'}</td>
        <td style="font-size:12px;color:var(--gray-500)">${a.managedBy || '&mdash;'}</td>
        <td>${activeBadge}</td>
        <td style="font-size:12px">${a.validFrom ? new Date(a.validFrom).toLocaleDateString() : '&mdash;'}</td>
        <td style="font-size:12px">${a.validTo   ? new Date(a.validTo).toLocaleDateString()   : '&mdash;'}</td>
        <td>${retireBtn}</td>
      </tr>
    `;
  }).join('');
}

async function addAccount() {
  const result            = document.getElementById('acct-result');
  const clientId          = document.getElementById('acct-client')?.value;
  const accountName       = document.getElementById('acct-name')?.value.trim();
  const channel           = document.getElementById('acct-channel')?.value;
  const marketplace       = document.getElementById('acct-marketplace')?.value.trim();
  const platformProfileId = document.getElementById('acct-platform-id')?.value.trim();
  const agencyProfileId   = document.getElementById('acct-agency-id')?.value.trim();
  const managedBy         = document.getElementById('acct-managed-by')?.value.trim();

  result.className = 'status-msg hidden';

  if (!clientId || !accountName || !channel) {
    result.className   = 'status-msg error';
    result.textContent = 'Client, Account Name, and Channel are required.';
    return;
  }

  const btn = document.getElementById('add-account-btn');
  btn.disabled = true; btn.textContent = 'Adding…';

  try {
    const res  = await adminFetch('/admin/accounts', {
      method: 'POST',
      body: JSON.stringify({ clientId, accountName, channel, marketplace, platformProfileId, agencyProfileId, managedBy })
    });
    const data = await res.json();
    if (!res.ok) {
      result.className   = 'status-msg error';
      result.textContent = data.error || 'Add failed.';
    } else {
      result.className   = 'status-msg success';
      result.textContent = '✅ Account added.';
      ['acct-name','acct-marketplace','acct-platform-id','acct-agency-id','acct-managed-by']
        .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
      document.getElementById('acct-client').value  = '';
      document.getElementById('acct-channel').value = '';
      const res2 = await adminFetch('/admin/accounts');
      if (res2.ok) { allAccounts = await res2.json(); renderAccountsTable(); }
      setTimeout(() => result.classList.add('hidden'), 4000);
    }
  } catch {
    result.className   = 'status-msg error';
    result.textContent = 'Request failed.';
  } finally {
    btn.disabled = false; btn.textContent = 'Add Account';
  }
}

window.retireAccount = async function(accountId, accountName) {
  if (!confirm(`Retire account "${accountName}"?\n\nThis will set is_active=FALSE and valid_to=TODAY. The account row is NOT deleted.`)) return;
  try {
    const res  = await adminFetch(`/admin/accounts/${accountId}/retire`, { method: 'PATCH' });
    const data = await res.json();
    if (!res.ok) { alert(data.error || 'Retire failed'); return; }
    const res2 = await adminFetch('/admin/accounts');
    if (res2.ok) { allAccounts = await res2.json(); renderAccountsTable(); }
  } catch { alert('Request failed.'); }
};

// ── Agencies Roster ──────────────────────────────────────────────────────────
async function initAgenciesRoster() {
  const tbody   = document.getElementById('agencies-table-body');
  const summary = document.getElementById('agencies-summary');
  if (!tbody) return;
  try {
    const res      = await adminFetch('/admin/agencies-roster');
    const agencies = await res.json();
    summary.textContent = `${agencies.length} agenc${agencies.length === 1 ? 'y' : 'ies'} · $${agencies.reduce((s, a) => s + a.mrr, 0).toLocaleString()} MRR`;

    if (!agencies.length) {
      tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--gray-400);padding:24px;">No agencies yet</td></tr>';
      return;
    }

    tbody.innerHTML = agencies.map(a => `
      <tr>
        <td><strong>${a.name}</strong><div style="font-size:11px;color:var(--gray-400);font-family:monospace">${a.agencyId.substring(0, 8)}</div></td>
        <td><span class="status-pill" style="background:${a.plan === 'agency' || a.plan === 'enterprise' ? '#edf5ec' : '#f3f4f6'};color:${a.plan === 'agency' || a.plan === 'enterprise' ? '#2d5a27' : '#374151'}">${a.plan}</span></td>
        <td><span class="status-pill ${a.status === 'active' ? 'status-active' : 'status-inactive'}">${a.status}</span></td>
        <td style="text-align:center;font-weight:600">${a.brandCount}</td>
        <td style="font-weight:600;color:var(--brand)">$${a.mrr.toLocaleString()}/mo</td>
        <td style="font-size:12px">${a.primaryEmail || '<span style="color:var(--gray-400)">—</span>'}</td>
        <td style="font-size:12px;color:var(--gray-400)">${a.lastLoginAt ? new Date(a.lastLoginAt).toLocaleDateString() : '—'}</td>
        <td style="font-size:11px">${a.stripeCustomerId ? '<span style="color:#2d5a27">✓ Stripe</span>' : '<span style="color:var(--gray-400)">No Stripe</span>'}</td>
        <td>
          <button class="action-btn btn-approve" onclick="viewAgencyBrands('${a.agencyId}')">View Brands</button>
          ${a.stripeCustomerId ? `<button class="action-btn" onclick="openStripeCustomer('${a.stripeCustomerId}')" style="margin-left:4px">Stripe ↗</button>` : ''}
        </td>
      </tr>
    `).join('');
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="9" style="color:red;text-align:center;padding:16px;">${e.message}</td></tr>`;
  }
}

window.viewAgencyBrands = function(agencyId) {
  document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.admin-section').forEach(s => s.classList.remove('active'));
  const brandsTab = document.querySelector('[data-tab="brands"]');
  if (brandsTab) {
    brandsTab.classList.add('active');
    document.getElementById('tab-brands').classList.add('active');
  }
  window._filterAgencyId = agencyId;
  initBrandsRoster();
};

window.openStripeCustomer = function(customerId) {
  window.open(`https://dashboard.stripe.com/customers/${customerId}`, '_blank');
};

// ── Brands Roster ────────────────────────────────────────────────────────────
async function initBrandsRoster() {
  const tbody    = document.getElementById('brands-table-body');
  const countEl  = document.getElementById('brands-count');
  const searchEl = document.getElementById('brands-search');
  if (!tbody) return;
  try {
    const res   = await adminFetch('/admin/brands-roster');
    let brands  = await res.json();

    // Filter by agency if navigated from "View Brands"
    if (window._filterAgencyId) {
      brands = brands.filter(b => b.agencyId === window._filterAgencyId);
      window._filterAgencyId = null;
      if (searchEl) searchEl.value = '';
    }

    const renderBrands = (list) => {
      countEl.textContent = `${list.length} brand${list.length !== 1 ? 's' : ''}`;
      if (!list.length) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--gray-400);padding:24px;">No brands found</td></tr>';
        return;
      }
      tbody.innerHTML = list.map(b => `
        <tr>
          <td>
            <strong>${b.brandName}</strong>
            <div style="font-size:11px;color:var(--gray-400);font-family:monospace">${b.clientId ? b.clientId.substring(0, 8) : '—'}</div>
          </td>
          <td style="font-size:12px">${b.agencyName || '<span style="color:var(--gray-400)">—</span>'}</td>
          <td><span class="status-pill ${b.status === 'active' ? 'status-active' : 'status-inactive'}">${b.status}</span></td>
          <td><span class="status-pill" style="background:#f3f4f6;color:#374151">${b.plan}</span></td>
          <td style="font-size:12px">${b.email || '<span style="color:var(--gray-400)">—</span>'}</td>
          <td style="font-size:12px;color:var(--gray-400)">${b.advertiserCount} connection${b.advertiserCount !== 1 ? 's' : ''}</td>
          <td style="font-size:12px;color:var(--gray-400)">${b.lastLoginAt ? new Date(b.lastLoginAt).toLocaleDateString() : 'Never'}</td>
          <td style="display:flex;gap:4px;flex-wrap:wrap;">
            <button class="action-btn btn-approve" onclick="showUpdatePlan('${b.managerId || b.clientId}','${b.brandName}','${b.plan}','${b.status}')">✏️ Plan</button>
            ${b.status === 'active'
              ? `<button class="action-btn btn-suspend" onclick="setBrandStatus('${b.managerId}','inactive')">Deactivate</button>`
              : `<button class="action-btn btn-approve" onclick="setBrandStatus('${b.managerId}','active')">Activate</button>`
            }
          </td>
        </tr>
      `).join('');
    };

    renderBrands(brands);

    if (searchEl) {
      searchEl.oninput = () => {
        const q = searchEl.value.toLowerCase();
        renderBrands(q ? brands.filter(b =>
          b.brandName?.toLowerCase().includes(q) ||
          b.agencyName?.toLowerCase().includes(q) ||
          b.email?.toLowerCase().includes(q)
        ) : brands);
      };
    }
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="8" style="color:red;text-align:center;padding:16px;">${e.message}</td></tr>`;
  }
}

window.setBrandStatus = async function(managerId, status) {
  try {
    const res = await adminFetch(`/admin/brands/${managerId}/status`, {
      method: 'POST',
      body: JSON.stringify({ status }),
    });
    if (!res.ok) throw new Error('Failed to update status');
    initBrandsRoster();
  } catch (e) {
    alert('Error: ' + e.message);
  }
};

// ── Utilities ─────────────────────────────────────────────────────────────────
function showResult(el, msg, type) {
  el.textContent = msg;
  el.className   = `status-msg status-${type}`;
  el.classList.remove('hidden');
  if (type === 'success') setTimeout(() => el.classList.add('hidden'), 4000);
}

// ── Competitors ───────────────────────────────────────────────────────────────
let allCompetitors = [];
let compInitialized = false;

async function initCompetitors() {
  if (!compInitialized) {
    compInitialized = true;

    document.getElementById('comp-add-btn').addEventListener('click', () => showCompForm());
    document.getElementById('comp-save-btn').addEventListener('click', saveCompetitor);
    document.getElementById('comp-cancel-btn').addEventListener('click', hideCompForm);

    document.getElementById('comp-subcategory-suggest').addEventListener('change', function () {
      if (this.value) {
        document.getElementById('comp-subcategory').value = this.value;
        this.value = '';
      }
    });

    await loadCompBrands();
    loadCompSubcategories();
  }
  await loadCompetitors();
}

async function loadCompBrands() {
  try {
    const res = await adminFetch('/brands');
    if (!res.ok) return;
    const brands = await res.json();
    const sel = document.getElementById('comp-brand');
    if (!sel) return;
    sel.innerHTML = '<option value="">All brands (global)</option>';
    brands.forEach(b => {
      const opt = document.createElement('option');
      opt.value = b.brandId;
      opt.textContent = b.name || b.brandId;
      sel.appendChild(opt);
    });
  } catch {}
}

async function loadCompSubcategories() {
  try {
    const res = await fetch('/competitors/subcategories', { credentials: 'include' });
    if (!res.ok) return;
    const subcats = await res.json();
    const sel = document.getElementById('comp-subcategory-suggest');
    if (!sel) return;
    sel.innerHTML = '<option value="">Suggestions\u2026</option>';
    subcats.forEach(sc => {
      const opt = document.createElement('option');
      opt.value = sc;
      opt.textContent = sc;
      sel.appendChild(opt);
    });
  } catch {}
}

async function loadCompetitors() {
  const tbody = document.getElementById('comp-table-body');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="5" class="loading-cell">Loading\u2026</td></tr>';
  try {
    const res = await fetch('/competitors', { credentials: 'include' });
    if (!res.ok) throw new Error('Failed to load competitors');
    allCompetitors = await res.json();
    renderCompetitorsTable();
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="5" class="loading-cell">Error: ' + err.message + '</td></tr>';
  }
}

function renderCompetitorsTable() {
  const tbody = document.getElementById('comp-table-body');
  if (!tbody) return;

  const brandSel = document.getElementById('comp-brand');
  const brandMap = {};
  if (brandSel) {
    Array.from(brandSel.options).forEach(opt => {
      if (opt.value) brandMap[opt.value] = opt.textContent;
    });
  }

  if (!allCompetitors.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="loading-cell">No competitors defined yet. Click \u2795 Add Competitor to get started.</td></tr>';
    return;
  }

  tbody.innerHTML = allCompetitors.map(c => {
    const brandLabel = c.brandId ? (brandMap[c.brandId] || c.brandId) : '<span style="color:var(--gray-300);font-size:12px">All brands</span>';
    const subcatLabel = c.subcategory || '<span style="color:var(--gray-300);font-size:12px">\u2014</span>';
    const termsHtml = c.matchTerms.map(t =>
      '<span style="display:inline-block;background:var(--brand-light);color:var(--brand);font-size:11px;padding:1px 8px;border-radius:20px;margin:1px 2px;font-weight:600">' + t + '</span>'
    ).join('');
    const safeName = c.competitorName.replace(/'/g, "\\'");
    return '<tr>' +
      '<td><strong>' + c.competitorName + '</strong></td>' +
      '<td style="font-size:13px">' + brandLabel + '</td>' +
      '<td style="font-size:13px">' + subcatLabel + '</td>' +
      '<td style="max-width:300px;line-height:1.8">' + (termsHtml || '<span style="color:var(--gray-300);font-size:12px">\u2014</span>') + '</td>' +
      '<td>' +
        '<button class="action-btn btn-approve" onclick="editCompetitor(\'' + c.id + '\')">Edit</button>' +
        '<button class="action-btn btn-suspend" onclick="deleteCompetitor(\'' + c.id + '\',\'' + safeName + '\')">Delete</button>' +
      '</td>' +
    '</tr>';
  }).join('');
}

function showCompForm(comp) {
  const wrap   = document.getElementById('comp-form-wrap');
  const title  = document.getElementById('comp-form-title');
  const editId = document.getElementById('comp-edit-id');
  const result = document.getElementById('comp-form-result');

  result.textContent = '';
  editId.value = comp ? comp.id : '';
  title.textContent = comp ? '\u270F\uFE0F Edit Competitor' : '\u2795 Add Competitor';

  document.getElementById('comp-name').value        = comp ? comp.competitorName : '';
  document.getElementById('comp-subcategory').value = comp ? (comp.subcategory || '') : '';
  document.getElementById('comp-match-terms').value = comp ? comp.matchTerms.join(', ') : '';
  document.getElementById('comp-brand').value       = comp ? (comp.brandId || '') : '';

  wrap.style.display = 'block';
  wrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function hideCompForm() {
  document.getElementById('comp-form-wrap').style.display = 'none';
  document.getElementById('comp-edit-id').value = '';
}

async function saveCompetitor() {
  const result        = document.getElementById('comp-form-result');
  const editId        = document.getElementById('comp-edit-id').value;
  const name          = document.getElementById('comp-name').value.trim();
  const subcategory   = document.getElementById('comp-subcategory').value.trim();
  const matchTermsRaw = document.getElementById('comp-match-terms').value;
  const brandId       = document.getElementById('comp-brand').value;

  result.textContent = '';

  if (!name) {
    result.textContent = '\u274C Competitor Name is required.';
    result.style.color = 'var(--danger)';
    return;
  }

  const matchTerms = matchTermsRaw.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
  if (!matchTerms.length) {
    result.textContent = '\u274C At least one match term is required.';
    result.style.color = 'var(--danger)';
    return;
  }

  const btn = document.getElementById('comp-save-btn');
  btn.disabled = true;
  btn.textContent = 'Saving\u2026';

  try {
    const body = {
      competitorName: name,
      matchTerms,
      subcategory: subcategory || null,
      brandId: brandId || null,
    };

    const url    = editId ? '/competitors/' + editId : '/competitors';
    const method = editId ? 'PUT' : 'POST';
    const res    = await fetch(url, {
      method,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();

    if (!res.ok) {
      result.textContent = '\u274C ' + (data.error || 'Save failed.');
      result.style.color = 'var(--danger)';
      return;
    }

    result.textContent = '\u2705 Saved!';
    result.style.color = 'var(--success)';
    setTimeout(hideCompForm, 1200);
    await loadCompetitors();
  } catch {
    result.textContent = '\u274C Request failed.';
    result.style.color = 'var(--danger)';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save';
  }
}

window.editCompetitor = function(id) {
  const comp = allCompetitors.find(c => c.id === id);
  if (!comp) return;
  showCompForm(comp);
};

window.deleteCompetitor = async function(id, name) {
  if (!confirm('Delete competitor "' + name + '"?\n\nThis cannot be undone.')) return;
  try {
    const res = await fetch('/competitors/' + id, { method: 'DELETE', credentials: 'include' });
    if (!res.ok) { const d = await res.json(); alert(d.error || 'Delete failed'); return; }
    await loadCompetitors();
  } catch { alert('Request failed.'); }
};
