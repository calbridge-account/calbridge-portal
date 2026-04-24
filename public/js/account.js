// Calbridge — Account Settings Page

const $ = id => document.getElementById(id);
let profile = {};

document.addEventListener('DOMContentLoaded', async () => {
  await checkAuth();
  await Promise.all([loadProfile(), loadConnections(), loadTeam(), loadCogs(), loadAiSettings()]);
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

// ---- AI Settings ----

const AI_SETTINGS = [
  // Growth
  { key: 'bid_optimization',      tier: 'growth', group: 'Bids',       label: 'Bid Optimization',           desc: 'AI adjusts keyword bids to hit your target ROAS' },
  { key: 'placement_bids',        tier: 'growth', group: 'Bids',       label: 'Placement Bid Adjustments',  desc: 'Top of Search, Product Pages, and Rest of Search multipliers set by where conversions occur' },
  { key: 'keyword_harvesting',    tier: 'growth', group: 'Keywords',   label: 'Keyword Harvesting',         desc: 'High-converting search terms promoted from auto/broad into exact match campaigns' },
  { key: 'negative_keywords',     tier: 'growth', group: 'Keywords',   label: 'Negative Keyword Addition',  desc: 'Poor-performing search terms added as negatives to cut wasted spend' },
  { key: 'budget_automation',     tier: 'growth', group: 'Budget',     label: 'Budget Automation',          desc: 'Campaigns auto-pause when daily budget is exhausted; resume next day' },
  { key: 'dayparting',            tier: 'growth', group: 'Scheduling', label: 'AI Dayparting',              desc: 'AI analyzes hourly performance and automatically sets bid multipliers by time of day' },
  { key: 'campaign_pausing',      tier: 'growth', group: 'Campaigns',  label: 'Campaign Pausing',           desc: 'Underperforming campaigns paused automatically when below threshold' },
  { key: 'smart_alerts',          tier: 'growth', group: 'Campaigns',  label: 'Smart Alerts',               desc: 'Automated alerts when spend spikes, ACoS drifts, or budgets burn early' },
  // Pro
  { key: 'ntb_optimization',      tier: 'pro',    group: 'Bids',       label: 'New-to-Brand Optimization',  desc: 'Bids tuned to hit your NTB% target for brand growth goals' },
  { key: 'intraday_budget',       tier: 'pro',    group: 'Budget',     label: 'Intraday Budget Shifting',   desc: 'Budget reallocated mid-day from exhausted campaigns to available high-ROAS ones' },
  { key: 'portfolio_reallocation',tier: 'pro',    group: 'Budget',     label: 'Portfolio Reallocation',     desc: 'Weekly budget shifted toward higher-ROAS campaigns within each portfolio' },
  { key: 'seasonal_scaling',      tier: 'pro',    group: 'Scheduling', label: 'Seasonal Bid Scaling',       desc: 'Bids proactively raised ahead of high-traffic periods (Prime Day, BFCM, etc.)' },
  { key: 'asin_targeting',        tier: 'pro',    group: 'Campaigns',  label: 'ASIN Target Optimization',   desc: 'Product targets added or removed based on conversion performance' },
];

const FUNCTIONAL_GROUPS = ['Bids', 'Keywords', 'Budget', 'Scheduling', 'Campaigns'];

async function loadAiSettings() {
  try {
    // Always show the card — all plans see it (locked for Starter/Free)
    const card = $('ai-settings-card');
    if (card) card.style.display = '';

    const res = await fetch('/account/ai-settings', { credentials: 'include' });
    if (!res.ok) return;
    const data = await res.json();
    renderAiSettings(data);
  } catch (err) {
    console.warn('[AI Settings] Failed to load:', err.message);
  }
}

function renderAiSettings(data) {
  const body = $('ai-settings-body');
  if (!body) return;

  const { settings, targets, isStarterLocked, availableSettings } = data;
  // availableSettings: [] for free/starter, growth keys for growth, all for pro/agency
  const isPro = availableSettings && AI_SETTINGS.filter(s => s.tier === 'pro').every(s => availableSettings.includes(s.key));
  const isGrowth = !isPro && availableSettings && availableSettings.length > 0;

  let html = '';

  // ── Target settings row ──
  html += '<div class="ai-targets-row">';
  if (isStarterLocked) {
    html += `
      <div class="ai-target-field">
        <label>Target ROAS</label>
        <div style="font-size:0.9rem;font-weight:600;padding:7px 0">${targets.target_roas.toFixed(1)}x</div>
        <div class="ai-target-hint">System optimizes toward this return on ad spend</div>
      </div>
      <div class="ai-target-field">
        <label>Minimum Bid ($)</label>
        <div style="font-size:0.9rem;font-weight:600;padding:7px 0">$${targets.min_bid.toFixed(2)}</div>
        <div class="ai-target-hint">No keyword bid will go below this floor</div>
      </div>
      <div style="align-self:flex-end">
        <div class="ai-starter-locked-note">Starter plan default &middot; <a href="/billing.html" style="color:var(--accent)">Upgrade to customize</a></div>
      </div>`;
  } else {
    html += `
      <div class="ai-target-field">
        <label for="ai-target-roas">Target ROAS</label>
        <input type="number" id="ai-target-roas" step="0.1" min="0.1" value="${targets.target_roas.toFixed(1)}" />
        <div class="ai-target-hint">System optimizes toward this return on ad spend</div>
      </div>
      <div class="ai-target-field">
        <label for="ai-target-minbid">Minimum Bid ($)</label>
        <input type="number" id="ai-target-minbid" step="0.01" min="0.01" value="${targets.min_bid.toFixed(2)}" />
        <div class="ai-target-hint">No keyword bid will go below this floor</div>
      </div>
      <div style="align-self:flex-end">
        <button class="btn-primary" id="ai-save-targets-btn" style="padding:8px 18px">Save Targets</button>
        <div id="ai-targets-status" style="font-size:0.78rem;margin-top:4px;"></div>
      </div>`;
  }
  html += '</div>';

  if (isStarterLocked) {
    // Locked preview: show all 13 settings greyed out with upgrade note
    html += `<div class="ai-starter-locked-note" style="margin-bottom:16px">🔒 AI automation requires <a href="/billing.html" style="color:var(--accent)">Growth plan or above</a>. These settings are shown as a preview.</div>`;
    FUNCTIONAL_GROUPS.forEach(group => {
      const groupSettings = AI_SETTINGS.filter(s => s.group === group);
      html += `<div class="ai-settings-group-heading">${group}</div>`;
      groupSettings.forEach(s => {
        html += `
          <div class="ai-setting-row ai-setting-locked">
            <div class="ai-setting-info">
              <div class="ai-setting-label">${s.label}</div>
              <div class="ai-setting-desc">${s.desc}</div>
            </div>
            <div class="ai-setting-toggle">
              <button class="btn-ai-mode" disabled>Automatic</button>
              <button class="btn-ai-mode active" disabled>Manual</button>
            </div>
          </div>`;
      });
    });

  } else if (isPro) {
    // Pro/Agency: all 13 unlocked, functional groupings — no tier labels
    FUNCTIONAL_GROUPS.forEach(group => {
      const groupSettings = AI_SETTINGS.filter(s => s.group === group);
      html += `<div class="ai-settings-group-heading">${group}</div>`;
      groupSettings.forEach(s => {
        html += renderSettingRow(s, settings[s.key], true);
      });
    });

  } else if (isGrowth) {
    // Growth: Growth settings unlocked, Pro settings locked with upgrade box
    FUNCTIONAL_GROUPS.forEach(group => {
      const groupSettings = AI_SETTINGS.filter(s => s.group === group);
      if (!groupSettings.length) return;
      html += `<div class="ai-settings-group-heading">${group}</div>`;
      groupSettings.forEach(s => {
        const unlocked = availableSettings.includes(s.key);
        html += renderSettingRow(s, settings[s.key], unlocked);
      });
    });

    // Pro upgrade prompt box
    const proSettings = AI_SETTINGS.filter(s => s.tier === 'pro');
    html += `
      <div class="ai-pro-upgrade-box">
        <p><strong>🚀 Unlock Pro automations</strong> — upgrade to get 5 additional AI decisions:</p>
        <ul class="ai-pro-upgrade-list">
          ${proSettings.map(s => `<li>${s.label}</li>`).join('')}
        </ul>
        <a href="/billing.html" class="btn-primary" style="display:inline-block;padding:8px 18px;text-decoration:none;font-size:0.85rem">View Pro Plan →</a>
      </div>`;
  }

  body.innerHTML = html;

  // Wire up target save button
  const saveBtn = $('ai-save-targets-btn');
  if (saveBtn) saveBtn.addEventListener('click', saveTargets);

  // Wire up toggle buttons
  body.querySelectorAll('.btn-ai-mode[data-key]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const key   = btn.dataset.key;
      const value = btn.dataset.value;
      const row   = document.getElementById(`ai-row-${key}`);
      if (!row) return;

      // Optimistic UI
      row.querySelectorAll('.btn-ai-mode').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const existingErr = row.querySelector('.ai-setting-error');
      if (existingErr) existingErr.remove();

      try {
        const res = await fetch('/account/ai-settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ setting: key, value })
        });
        if (!res.ok) {
          const d = await res.json();
          throw new Error(d.error || 'Failed to save');
        }
      } catch (err) {
        // Revert
        row.querySelectorAll('.btn-ai-mode').forEach(b => {
          b.classList.toggle('active', b.dataset.value !== value);
        });
        const errEl = document.createElement('div');
        errEl.className = 'ai-setting-error';
        errEl.style.cssText = 'font-size:0.75rem;color:#e53e3e;margin-top:4px;';
        errEl.textContent = `❌ ${err.message}`;
        row.appendChild(errEl);
        setTimeout(() => errEl.remove(), 4000);
      }
    });
  });
}

function renderSettingRow(s, currentValue, unlocked) {
  const lockedClass = unlocked ? '' : 'ai-setting-locked';
  const upgradeBadge = unlocked ? '' : '<span class="ai-upgrade-badge">Pro</span>';
  const isAuto   = currentValue === 'auto';
  const isManual = !isAuto;
  return `
    <div class="ai-setting-row ${lockedClass}" id="ai-row-${s.key}">
      <div class="ai-setting-info">
        <div class="ai-setting-label">${s.label}${upgradeBadge}</div>
        <div class="ai-setting-desc">${s.desc}</div>
      </div>
      <div class="ai-setting-toggle">
        <button class="btn-ai-mode ${isAuto ? 'active' : ''}" data-key="${s.key}" data-value="auto" ${unlocked ? '' : 'disabled'}>Automatic</button>
        <button class="btn-ai-mode ${isManual ? 'active' : ''}" data-key="${s.key}" data-value="manual" ${unlocked ? '' : 'disabled'}>Manual</button>
      </div>
    </div>`;
}

async function saveTargets() {
  const roasInput   = $('ai-target-roas');
  const minBidInput = $('ai-target-minbid');
  const statusEl    = $('ai-targets-status');

  const roas   = parseFloat(roasInput?.value);
  const minBid = parseFloat(minBidInput?.value);

  if (isNaN(roas) || roas <= 0 || isNaN(minBid) || minBid <= 0) {
    if (statusEl) { statusEl.style.color = '#e53e3e'; statusEl.textContent = '❌ Enter valid positive values for both fields.'; }
    return;
  }

  if (statusEl) { statusEl.style.color = 'var(--text-muted)'; statusEl.textContent = 'Saving…'; }

  try {
    for (const [setting, value] of [['target_roas', roas], ['min_bid', minBid]]) {
      const res = await fetch('/account/ai-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ setting, value })
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || `Failed to save ${setting}`);
      }
    }
    if (statusEl) {
      statusEl.style.color = '#2d5a27';
      statusEl.textContent = '✅ Targets saved';
      setTimeout(() => { statusEl.textContent = ''; }, 4000);
    }
  } catch (err) {
    if (statusEl) { statusEl.style.color = '#e53e3e'; statusEl.textContent = `❌ ${err.message}`; }
  }
}

// ---- Helpers ----
function showStatus(elId, msg, type) {
  const el = $(elId);
  el.textContent = msg;
  el.className = `status-msg status-${type}`;
  el.classList.remove('hidden');
  if (type === 'success') setTimeout(() => el.classList.add('hidden'), 4000);
}
