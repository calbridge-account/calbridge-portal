// Calbridge — Account Settings Page

const $ = id => document.getElementById(id);
let profile = {};

document.addEventListener('DOMContentLoaded', async () => {
  await checkAuth();
  await Promise.all([loadProfile(), loadConnections(), loadTeam(), loadCogs()]);
  setupForms();
});

async function checkAuth() {
  try {
    const res = await fetch('/auth/me', { credentials: 'include' });
    if (!res.ok) { window.location.href = '/'; return; }
    const { client } = await res.json();
    $('client-name').textContent = client.name || client.email;

    // Hide ads nav items if no ads connected
    const connRes = await fetch('/amazon/status', { credentials: 'include' });
    const conn = await connRes.json();
    const hasAds = conn.ads?.connected || conn.dsp?.connected;
    if (!hasAds) document.querySelectorAll('.nav-item-ads').forEach(el => el.remove());
  } catch { window.location.href = '/'; }
  $('logout-btn').addEventListener('click', async () => {
    await fetch('/auth/logout', { method: 'POST', credentials: 'include' });
    window.location.href = '/';
  });
}

// ---- Profile ----
async function loadProfile() {
  const res = await fetch('/account/profile', { credentials: 'include' });
  profile = await res.json();

  $('company-name').value  = profile.companyName || '';
  $('contact-name').value  = profile.name || '';
  $('profile-email').value = profile.email || '';

  // Weekly report toggle
  initWeeklyReportToggle(profile.weeklyReportEnabled);

  // Logo
  if (profile.logoUrl) {
    $('logo-preview-img').src = profile.logoUrl;
    $('logo-preview-img').style.display = 'block';
    $('logo-placeholder').style.display = 'none';
    $('remove-logo-btn').style.display = 'inline-block';
    const sidebarLogoEl = $('brand-logo') || $('sidebar-logo');
    if (sidebarLogoEl) { sidebarLogoEl.src = profile.logoUrl; sidebarLogoEl.style.filter = 'none'; }
  }
}

// ---- Logo Upload ----
function setupForms() {
  // Logo file picker
  $('logo-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('logo', file);
    showStatus('logo-status', 'Uploading...', 'info');
    try {
      const res = await fetch('/account/logo', { method: 'POST', body: formData, credentials: 'include' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      $('logo-preview-img').src = data.logoUrl + '?t=' + Date.now();
      $('logo-preview-img').style.display = 'block';
      $('logo-placeholder').style.display = 'none';
      $('remove-logo-btn').style.display = 'inline-block';
      const sidebarLogoElUp = $('brand-logo') || $('sidebar-logo');
      if (sidebarLogoElUp) { sidebarLogoElUp.src = data.logoUrl + '?t=' + Date.now(); sidebarLogoElUp.style.filter = 'none'; }
      showStatus('logo-status', '✅ Logo updated', 'success');
    } catch (err) { showStatus('logo-status', `❌ ${err.message}`, 'error'); }
  });

  // Remove logo
  $('remove-logo-btn').addEventListener('click', async () => {
    await fetch('/account/logo', { method: 'DELETE', credentials: 'include' });
    $('logo-preview-img').style.display = 'none';
    $('logo-placeholder').style.display = 'block';
    $('remove-logo-btn').style.display = 'none';
    const sidebarLogoElRm = $('brand-logo') || $('sidebar-logo');
    if (sidebarLogoElRm) { sidebarLogoElRm.src = '/images/calbridge-logo.png'; sidebarLogoElRm.style.filter = ''; }
    showStatus('logo-status', 'Logo removed', 'info');
  });

  // Profile form
  $('profile-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const res = await fetch('/account/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name: $('contact-name').value, companyName: $('company-name').value })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      $('client-name').textContent = $('contact-name').value;
      showStatus('profile-status', '✅ Profile saved', 'success');
    } catch (err) { showStatus('profile-status', `❌ ${err.message}`, 'error'); }
  });

  // Password form
  $('password-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if ($('new-password').value !== $('confirm-password').value) {
      showStatus('password-status', '❌ Passwords do not match', 'error'); return;
    }
    try {
      const res = await fetch('/account/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ currentPassword: $('current-password').value, newPassword: $('new-password').value })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      $('password-form').reset();
      showStatus('password-status', '✅ Password changed', 'success');
    } catch (err) { showStatus('password-status', `❌ ${err.message}`, 'error'); }
  });

  // Team invite
  $('invite-btn').addEventListener('click', async () => {
    const name  = $('invite-name').value.trim();
    const email = $('invite-email').value.trim();
    const role  = $('invite-role').value;
    if (!name || !email) { showStatus('invite-status', '❌ Name and email required', 'error'); return; }
    try {
      const res = await fetch('/account/team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name, email, role })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      $('invite-name').value = '';
      $('invite-email').value = '';
      showStatus('invite-status', `✅ Invite sent to ${email}`, 'success');
      await loadTeam();
    } catch (err) { showStatus('invite-status', `❌ ${err.message}`, 'error'); }
  });
}

// ---- Connections ----
async function loadConnections() {
  const res = await fetch('/amazon/status', { credentials: 'include' });
  const status = await res.json();
  const grid = $('connections-grid');
  const icons = { ads: '📢', dsp: '🎯', seller: '🛒', vendor: '🏭' };

  grid.innerHTML = Object.entries(status).map(([type, info]) => `
    <div class="connection-card ${info.connected ? 'connected' : ''}">
      <div class="connection-info">
        <h4>${icons[type]} ${info.label}</h4>
        <p>${info.connected ? `Connected · expires ${new Date(info.expiresAt).toLocaleDateString()}` : 'Not connected'}</p>
      </div>
      ${info.connected
        ? `<span class="connection-badge badge-connected">Connected</span>`
        : `<a href="/amazon/connect/${type}" class="btn-connect">Connect</a>`
      }
    </div>
  `).join('');
}

// ---- Team ----
async function loadTeam() {
  const res = await fetch('/account/team', { credentials: 'include' });
  const members = await res.json();
  const tbody = $('team-table-body');

  if (!members.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="loading-cell">No team members yet — invite someone above</td></tr>';
    return;
  }

  tbody.innerHTML = members.map(m => `
    <tr>
      <td>${m.name}</td>
      <td>${m.email}</td>
      <td><span class="role-badge role-${m.role}">${m.role}</span></td>
      <td><span class="status-badge status-${m.status}">${m.status}</span></td>
      <td>${new Date(m.invitedAt).toLocaleDateString()}</td>
      <td><button class="btn-remove" onclick="removeMember('${m.id}')">Remove</button></td>
    </tr>
  `).join('');
}

async function removeMember(id) {
  if (!confirm('Remove this team member?')) return;
  await fetch(`/account/team/${id}`, { method: 'DELETE', credentials: 'include' });
  await loadTeam();
}

// ---- COGS ----
async function loadCogs() {
  const res = await fetch('/cogs/current', { credentials: 'include' });
  const rows = await res.json();
  const tbody = $('cogs-table-body');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="loading-cell">No COGS data yet — download the template and upload your costs</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map(r => `<tr>
    <td>${r.ASIN || '—'}</td>
    <td>${r.SKU  || '—'}</td>
    <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.TITLE || '—'}</td>
    <td>${r.COGS != null ? '$' + Number(r.COGS).toFixed(2) : '—'}</td>
    <td>${r.FBA_FEES != null ? '$' + Number(r.FBA_FEES).toFixed(2) : '—'}</td>
    <td>${r.PRICE != null ? '$' + Number(r.PRICE).toFixed(2) : '—'}</td>
  </tr>`).join('');
}

// COGS file upload
document.addEventListener('DOMContentLoaded', () => {
  const cogsInput = $('cogs-input');
  if (!cogsInput) return;
  cogsInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('cogs', file);
    showStatus('cogs-status', 'Uploading...', 'info');
    try {
      const res = await fetch('/cogs/upload', { method: 'POST', body: formData, credentials: 'include' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      let msg = `✅ ${data.updated} SKUs updated. ${data.note}`;
      if (data.errors?.length) msg += ` (${data.errors.length} rows skipped)`;
      showStatus('cogs-status', msg, 'success');
      await loadCogs();
    } catch (err) { showStatus('cogs-status', `❌ ${err.message}`, 'error'); }
  });
});

// ---- Weekly Report Toggle ----
function initWeeklyReportToggle(enabled) {
  const toggle   = $('weekly-report-toggle');
  const slider   = $('weekly-report-slider');
  if (!toggle || !slider) return;

  function applyState(checked) {
    toggle.checked = checked;
    slider.style.background = checked ? '#2d5a27' : '#ccc';
    // Move the pseudo-element via inline style on the span
    slider.style.backgroundImage = 'none';
  }

  applyState(enabled !== false);

  toggle.addEventListener('change', async () => {
    const newVal = toggle.checked;
    applyState(newVal);
    try {
      const res = await fetch('/account/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ weeklyReportEnabled: newVal })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      showStatus('prefs-status', newVal ? '✅ Weekly emails enabled' : '✅ Weekly emails disabled', 'success');
    } catch (err) {
      // Revert on failure
      applyState(!newVal);
      showStatus('prefs-status', `❌ ${err.message}`, 'error');
    }
  });
}

// ---- Helpers ----
function showStatus(elId, msg, type) {
  const el = $(elId);
  el.textContent = msg;
  el.className = `status-msg status-${type}`;
  el.classList.remove('hidden');
  if (type === 'success') setTimeout(() => el.classList.add('hidden'), 4000);
}
