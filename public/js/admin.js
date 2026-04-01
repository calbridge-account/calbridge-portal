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
    });
  });

  document.getElementById('client-search').addEventListener('input', e => {
    renderClients(e.target.value.toLowerCase());
  });

  document.getElementById('send-invite-btn').addEventListener('click', sendInvite);
  document.getElementById('add-admin-btn')?.addEventListener('click', addAdminUser);

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
  await Promise.all([loadClients(), loadAdjustments()]);
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
        c.companyName?.toLowerCase().includes(search))
    : allClients;

  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="loading-cell">No clients found</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(c => `
    <tr>
      <td><strong>${c.name || '—'}</strong></td>
      <td>${c.email}</td>
      <td>${c.companyName || '—'}</td>
      <td><span class="status-pill pill-${c.status || 'active'}">${c.status || 'active'}</span></td>
      <td>—</td>
      <td>${c.lastLoginAt ? new Date(c.lastLoginAt).toLocaleString() : '—'}</td>
      <td>${c.createdAt  ? new Date(c.createdAt).toLocaleDateString() : '—'}</td>
      <td>
        ${['pending','invited'].includes(c.status) ? `<button class="action-btn btn-approve"   onclick="approveClient('${c.clientId}','${c.email}')">Approve</button>` : ''}
        ${c.status === 'active'    ? `<button class="action-btn btn-suspend"   onclick="suspendClient('${c.clientId}','${c.email}')">Suspend</button>`   : ''}
        ${c.status === 'suspended' ? `<button class="action-btn btn-unsuspend" onclick="approveClient('${c.clientId}','${c.email}')">Reinstate</button>` : ''}
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

    // Populate client dropdowns if not already done
    const saClient    = document.getElementById('sa-client');
    const filterSel   = document.getElementById('sa-filter-client');
    if (saClient && saClient.options.length <= 1) {
      allClients.forEach(c => {
        const label = c.companyName || c.name || c.email;
        saClient.insertAdjacentHTML('beforeend',  `<option value="${c.clientId}">${label}</option>`);
        filterSel?.insertAdjacentHTML('beforeend', `<option value="${c.clientId}">${label}</option>`);
      });
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

// ── Utilities ─────────────────────────────────────────────────────────────────
function showResult(el, msg, type) {
  el.textContent = msg;
  el.className   = `status-msg status-${type}`;
  el.classList.remove('hidden');
  if (type === 'success') setTimeout(() => el.classList.add('hidden'), 4000);
}
