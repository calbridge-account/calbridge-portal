// Calbridge Admin Panel

let adminSecret = '';
let allClients = [];

document.addEventListener('DOMContentLoaded', () => {
  const stored = sessionStorage.getItem('admin_secret');
  if (stored) { adminSecret = stored; showPanel(); }

  document.getElementById('admin-login-btn').addEventListener('click', tryLogin);
  document.getElementById('admin-secret-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') tryLogin();
  });

  document.getElementById('admin-logout-btn').addEventListener('click', () => {
    sessionStorage.removeItem('admin_secret');
    location.reload();
  });

  document.getElementById('refresh-btn').addEventListener('click', loadAll);

  document.querySelectorAll('.admin-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.admin-section').forEach(s => s.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
      if (tab.dataset.tab === 'logs') loadLogs();
    });
  });

  document.getElementById('client-search').addEventListener('input', e => {
    renderClients(e.target.value.toLowerCase());
  });

  document.getElementById('send-invite-btn').addEventListener('click', sendInvite);
});

async function tryLogin() {
  const secret = document.getElementById('admin-secret-input').value.trim();
  if (!secret) return;
  const res = await fetch('/admin/clients', { headers: { 'X-Admin-Secret': secret } });
  if (!res.ok) {
    document.getElementById('admin-login-error').textContent = 'Invalid admin secret';
    document.getElementById('admin-login-error').classList.remove('hidden');
    return;
  }
  adminSecret = secret;
  sessionStorage.setItem('admin_secret', secret);
  showPanel();
}

function showPanel() {
  document.getElementById('admin-login').style.display = 'none';
  document.getElementById('admin-panel').style.display = 'block';
  loadAll();
}

async function adminFetch(path, options = {}) {
  return fetch(path, {
    ...options,
    headers: { 'X-Admin-Secret': adminSecret, 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
}

async function loadAll() {
  await Promise.all([loadClients(), loadStats()]);
}

async function loadClients() {
  const res = await adminFetch('/admin/clients');
  allClients = await res.json();
  renderClients('');
  updateStats();
  document.getElementById('admin-subtitle').textContent = `${allClients.length} total clients · Last updated ${new Date().toLocaleTimeString()}`;
}

function updateStats() {
  document.getElementById('stat-total').textContent     = allClients.length;
  document.getElementById('stat-pending').textContent   = allClients.filter(c => c.status === 'pending').length;
  document.getElementById('stat-active').textContent    = allClients.filter(c => c.status === 'active').length;
  document.getElementById('stat-suspended').textContent = allClients.filter(c => c.status === 'suspended').length;
}

async function loadStats() { /* stats loaded via loadClients */ }

function renderClients(search) {
  const tbody = document.getElementById('clients-table-body');
  const filtered = search
    ? allClients.filter(c => c.name?.toLowerCase().includes(search) || c.email?.toLowerCase().includes(search) || c.companyName?.toLowerCase().includes(search))
    : allClients;

  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="loading-cell">No clients found</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(c => `
    <tr>
      <td><strong>${c.name || '—'}</strong></td>
      <td>${c.email}</td>
      <td>${c.companyName || '—'}</td>
      <td><span class="status-pill pill-${c.status || 'active'}">${c.status || 'active'}</span></td>
      <td>${c.createdAt ? new Date(c.createdAt).toLocaleDateString() : '—'}</td>
      <td>
        ${c.status === 'pending' || c.status === 'invited'
          ? `<button class="action-btn btn-approve" onclick="approveClient('${c.id}', '${c.email}')">Approve</button>`
          : ''}
        ${c.status === 'active'
          ? `<button class="action-btn btn-suspend" onclick="suspendClient('${c.id}', '${c.email}')">Suspend</button>`
          : ''}
        ${c.status === 'suspended'
          ? `<button class="action-btn btn-unsuspend" onclick="approveClient('${c.id}', '${c.email}')">Reinstate</button>`
          : ''}
      </td>
    </tr>
  `).join('');
}

async function approveClient(id, email) {
  if (!confirm(`Approve ${email}?`)) return;
  const res = await adminFetch(`/admin/approve/${id}`, { method: 'POST' });
  const data = await res.json();
  alert(data.message);
  await loadClients();
}

async function suspendClient(id, email) {
  if (!confirm(`Suspend ${email}? They will lose access immediately.`)) return;
  const res = await adminFetch(`/admin/suspend/${id}`, { method: 'POST' });
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

  const res = await adminFetch('/admin/invite', {
    method: 'POST',
    body: JSON.stringify({ name, email, companyName: company })
  });
  const data = await res.json();
  if (!res.ok) { showResult(result, data.error, 'error'); return; }

  showResult(result, `Invite sent to ${email}`, 'success');
  document.getElementById('inv-name').value = '';
  document.getElementById('inv-company').value = '';
  document.getElementById('inv-email').value = '';
  await loadClients();
}

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
      <td style="font-size:11px;color:var(--danger);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${l.ERROR_MESSAGE || ''}">${l.ERROR_MESSAGE ? l.ERROR_MESSAGE.substring(0, 60) + '...' : '—'}</td>
    </tr>
  `).join('');
}

function showResult(el, msg, type) {
  el.textContent = msg;
  el.className = `status-msg status-${type}`;
  el.classList.remove('hidden');
  if (type === 'success') setTimeout(() => el.classList.add('hidden'), 4000);
}
