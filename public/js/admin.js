// Calbridge Admin Panel — session-based auth

let currentAdmin = null;
let allClients = [];
let healthScores = {}; // clientId -> { score, breakdown }

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
      if (tab.dataset.tab === 'logs')   loadLogs();
      if (tab.dataset.tab === 'admins') loadAdminUsers();
    });
  });

  document.getElementById('client-search').addEventListener('input', e => {
    renderClients(e.target.value.toLowerCase());
  });

  document.getElementById('send-invite-btn').addEventListener('click', sendInvite);
  document.getElementById('add-admin-btn')?.addEventListener('click', addAdminUser);
});

async function checkAdminAuth() {
  const res = await fetch('/admin/me', { credentials: 'include' });
  if (res.ok) {
    currentAdmin = await res.json();
    showPanel();
  }
  // else stay on login screen
}

async function tryLogin() {
  const email    = document.getElementById('admin-email-input').value.trim();
  const password = document.getElementById('admin-password-input').value;
  const errEl    = document.getElementById('admin-login-error');
  const btn      = document.getElementById('admin-login-btn');

  if (!email || !password) { showLoginError('Email and password required'); return; }
  btn.disabled = true; btn.textContent = 'Signing in...';

  const res = await fetch('/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
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
  document.getElementById('admin-login').style.display = 'none';
  document.getElementById('admin-panel').style.display = 'block';
  document.getElementById('admin-name-display').textContent = currentAdmin?.name || 'Admin';
  // Show admin users tab for superadmins
  if (currentAdmin?.role === 'superadmin') {
    document.getElementById('admins-tab').style.display = '';
  }
  loadAll();
}

async function adminFetch(path, options = {}) {
  return fetch(path, { credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...options });
}

async function loadAll() {
  await Promise.all([loadClients()]);
}

async function loadClients() {
  const [clientsRes, scoresRes] = await Promise.all([
    adminFetch('/admin/clients'),
    adminFetch('/admin/health-scores')
  ]);
  if (!clientsRes.ok) return;
  allClients = await clientsRes.json();

  if (scoresRes.ok) {
    const scores = await scoresRes.json();
    healthScores = {};
    scores.forEach(s => { healthScores[s.clientId] = s; });
  }

  renderClients('');
  updateStats();
  document.getElementById('admin-subtitle').textContent = `${allClients.length} total clients · Updated ${new Date().toLocaleTimeString()}`;
}

function updateStats() {
  document.getElementById('stat-total').textContent     = allClients.length;
  document.getElementById('stat-pending').textContent   = allClients.filter(c => c.status === 'pending').length;
  document.getElementById('stat-active').textContent    = allClients.filter(c => c.status === 'active').length;
  document.getElementById('stat-suspended').textContent = allClients.filter(c => c.status === 'suspended').length;
}

function healthBadge(clientId) {
  const hs = healthScores[clientId];
  if (!hs) return '<span class="health-badge" style="background:var(--gray-100);color:var(--gray-400)">—</span>';
  const score = hs.score;
  let cls, label;
  if (score >= 80) { cls = 'health-healthy'; label = '✅ Healthy'; }
  else if (score >= 50) { cls = 'health-fair'; label = '⚠️ Fair'; }
  else { cls = 'health-at-risk'; label = '🔴 At Risk'; }
  return `<span class="health-badge ${cls}" title="Score: ${score}\nCM Trend: ${hs.breakdown.cmTrend}\nACOS: ${hs.breakdown.acosVsBreakEven}\nFreshness: ${hs.breakdown.dataFreshness}\nConnections: ${hs.breakdown.amazonConnections}\nLogin: ${hs.breakdown.loginRecency}">${label} ${score}</span>`;
}

function renderClients(search) {
  const tbody = document.getElementById('clients-table-body');
  const filtered = search
    ? allClients.filter(c => c.name?.toLowerCase().includes(search) || c.email?.toLowerCase().includes(search) || c.companyName?.toLowerCase().includes(search))
    : allClients;

  if (!filtered.length) { tbody.innerHTML = '<tr><td colspan="7" class="loading-cell">No clients found</td></tr>'; return; }

  tbody.innerHTML = filtered.map(c => `
    <tr>
      <td><strong>${c.name || '—'}</strong></td>
      <td>${c.email}</td>
      <td>${c.companyName || '—'}</td>
      <td><span class="status-pill pill-${c.status || 'active'}">${c.status || 'active'}</span></td>
      <td>${healthBadge(c.id)}</td>
      <td>${c.createdAt ? new Date(c.createdAt).toLocaleDateString() : '—'}</td>
      <td>
        ${['pending','invited'].includes(c.status) ? `<button class="action-btn btn-approve" onclick="approveClient('${c.id}','${c.email}')">Approve</button>` : ''}
        ${c.status === 'active'    ? `<button class="action-btn btn-suspend"   onclick="suspendClient('${c.id}','${c.email}')">Suspend</button>` : ''}
        ${c.status === 'suspended' ? `<button class="action-btn btn-unsuspend" onclick="approveClient('${c.id}','${c.email}')">Reinstate</button>` : ''}
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
  const res = await adminFetch('/admin/invite', { method: 'POST', body: JSON.stringify({ name, email, companyName: company }) });
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
      <td style="font-size:11px;color:var(--danger);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${l.ERROR_MESSAGE || ''}">${l.ERROR_MESSAGE ? l.ERROR_MESSAGE.substring(0,60)+'...' : '—'}</td>
    </tr>
  `).join('');
}

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
  const res = await adminFetch('/admin/users', { method: 'POST', body: JSON.stringify({ name, email, password, role }) });
  const data = await res.json();
  if (!res.ok) { showResult(result, data.error, 'error'); return; }
  showResult(result, `Admin user ${email} created`, 'success');
  document.getElementById('adm-name').value = '';
  document.getElementById('adm-email').value = '';
  document.getElementById('adm-password').value = '';
  await loadAdminUsers();
}

async function removeAdmin(id, name) {
  if (!confirm(`Remove admin access for ${name}?`)) return;
  const res = await adminFetch(`/admin/users/${id}`, { method: 'DELETE' });
  const data = await res.json();
  alert(data.message);
  await loadAdminUsers();
}

function showResult(el, msg, type) {
  el.textContent = msg;
  el.className = `status-msg status-${type}`;
  el.classList.remove('hidden');
  if (type === 'success') setTimeout(() => el.classList.add('hidden'), 4000);
}
