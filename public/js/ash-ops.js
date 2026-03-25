// ── Auth ──────────────────────────────────────────
let isLoggedIn = false;

async function checkAuth() {
  try {
    const res = await fetch('/admin/me', { credentials: 'include' });
    if (res.ok) {
      isLoggedIn = true;
      document.getElementById('ash-login').style.display = 'none';
      document.getElementById('ash-app').style.display = 'block';
      loadData();
      startAutoRefresh();
    }
  } catch {}
}

document.getElementById('ash-login-btn').addEventListener('click', async () => {
  const email    = document.getElementById('ash-email-input').value.trim();
  const password = document.getElementById('ash-password-input').value;
  const errEl    = document.getElementById('ash-login-error');
  const btn      = document.getElementById('ash-login-btn');
  errEl.classList.add('hidden');
  if (!email || !password) { errEl.textContent = 'Email and password required'; errEl.classList.remove('hidden'); return; }
  btn.disabled = true;
  btn.textContent = 'Signing in…';
  try {
    const res = await fetch('/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
      credentials: 'include'
    });
    const data = await res.json();
    if (res.ok) {
      isLoggedIn = true;
      document.getElementById('ash-login').style.display = 'none';
      document.getElementById('ash-app').style.display = 'block';
      loadData();
      startAutoRefresh();
    } else {
      errEl.textContent = data.error || 'Login failed';
      errEl.classList.remove('hidden');
      btn.disabled = false;
      btn.textContent = 'Sign In';
    }
  } catch (e) {
    errEl.textContent = 'Request failed: ' + e.message;
    errEl.classList.remove('hidden');
    btn.disabled = false;
    btn.textContent = 'Sign In';
  }
});

// Allow enter key on password field
document.getElementById('ash-password-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('ash-login-btn').click();
});

// ── Data Loading ──────────────────────────────────
let azureOverride = null;

async function loadData() {
  try {
    const res = await fetch('/admin/ash-ops/data', { credentials: 'include' });
    if (res.status === 401) { location.reload(); return; }
    const d = await res.json();

    document.getElementById('loading-state').style.display = 'none';
    document.getElementById('dashboard-content').style.display = 'block';

    renderCostOverview(d);
    renderJobStatus(d);
    renderScheduler(d);
    renderDocs(d.docs);
    renderMemory(d);
    renderGitHub(d.git);

    document.getElementById('last-refresh-label').textContent = 'Last refreshed ' + new Date().toLocaleTimeString();
  } catch (err) {
    console.error('Failed to load ash-ops data:', err);
  }
}

// ── Cost Overview ──
function renderCostOverview(d) {
  const azureVmCost = azureOverride !== null ? azureOverride : (d.azureVmCost || 0);
  document.getElementById('azure-override-input').placeholder = azureVmCost;

  let orBalance = null;
  let orText = 'N/A';
  if (d.openrouter && !d.openrouter.error) {
    // OpenRouter credits response shape: { data: { total_credits, usage, ... } }
    const credits = d.openrouter?.data;
    if (credits) {
      orBalance = credits.total_credits !== undefined ? parseFloat(credits.total_credits) : null;
      orText = orBalance !== null ? '$' + orBalance.toFixed(2) : 'N/A';
      document.getElementById('or-source').textContent = 'Auto — openrouter.ai/api/v1/credits';
    }
  } else if (d.openrouter?.error) {
    orText = 'N/A';
    document.getElementById('or-source').textContent = d.openrouter.error;
  }

  document.getElementById('or-balance').textContent = orText;
  document.getElementById('azure-cost').textContent = '$' + azureVmCost.toFixed(2) + '/mo';

  const total = (orBalance !== null ? 0 : 0) + azureVmCost; // OpenRouter shows remaining credits, not monthly cost
  document.getElementById('cost-total').textContent = '$' + total.toFixed(2) + '/mo (est.)';

  // KPIs
  document.getElementById('cost-kpis').innerHTML = `
    <div class="ops-kpi highlight">
      <div class="ops-kpi-label">OpenRouter Balance</div>
      <div class="ops-kpi-value">${orText}</div>
      <div class="ops-kpi-sub">Remaining credits</div>
    </div>
    <div class="ops-kpi">
      <div class="ops-kpi-label">Azure VM Cost</div>
      <div class="ops-kpi-value">$${azureVmCost.toFixed(0)}</div>
      <div class="ops-kpi-sub">Per month</div>
    </div>
    <div class="ops-kpi">
      <div class="ops-kpi-label">Est. Monthly AI Cost</div>
      <div class="ops-kpi-value">$${azureVmCost.toFixed(0)}</div>
      <div class="ops-kpi-sub">VM + OpenRouter</div>
    </div>
  `;
}

function applyAzureOverride() {
  const val = parseFloat(document.getElementById('azure-override-input').value);
  if (!isNaN(val) && val >= 0) azureOverride = val;
  loadData();
}

// ── Job Status ──
function renderJobStatus(d) {
  const counts = d.jobCounts;
  if (counts && !counts.error) {
    document.getElementById('job-counts-grid').innerHTML = `
      <div class="ops-kpi"><div class="ops-kpi-label">Queued</div><div class="ops-kpi-value">${counts.queued}</div></div>
      <div class="ops-kpi"><div class="ops-kpi-label">Active</div><div class="ops-kpi-value" style="color:var(--warning)">${counts.active}</div></div>
      <div class="ops-kpi"><div class="ops-kpi-label">Completed Today</div><div class="ops-kpi-value" style="color:var(--success)">${counts.completedToday}</div></div>
      <div class="ops-kpi"><div class="ops-kpi-label">Failed Today</div><div class="ops-kpi-value" style="color:var(--danger)">${counts.failedToday}</div></div>
    `;
  } else if (counts?.error) {
    document.getElementById('job-counts-grid').innerHTML = `<div class="err-text">${counts.error}</div>`;
  }

  const jobs = d.recentJobs;
  const tbody = document.getElementById('jobs-tbody');
  if (!jobs || jobs.error) {
    tbody.innerHTML = `<tr><td colspan="6" class="err-text" style="padding:14px">${jobs?.error || 'No data'}</td></tr>`;
    return;
  }
  if (!jobs.length) { tbody.innerHTML = `<tr><td colspan="6" class="err-text" style="padding:14px">No jobs found</td></tr>`; return; }

  tbody.innerHTML = jobs.map(j => {
    const pillClass = j.status === 'success' ? 'pill-success' : j.status === 'failed' ? 'pill-failed' : j.status === 'running' ? 'pill-running' : 'pill-queued';
    return `<tr>
      <td style="font-family:monospace;font-size:11px">${esc(j.clientId || '—')}</td>
      <td>${esc(j.jobType || '—')}</td>
      <td><span class="pill ${pillClass}">${esc(j.status || '—')}</span></td>
      <td>${j.recordsWritten !== null && j.recordsWritten !== undefined ? Number(j.recordsWritten).toLocaleString() : '—'}</td>
      <td style="font-size:12px;color:var(--gray-600)">${fmtDate(j.startedAt)}</td>
      <td style="font-size:12px;color:var(--gray-600)">${fmtDate(j.completedAt)}</td>
    </tr>`;
  }).join('');
}

// ── Scheduler ──
function renderScheduler(d) {
  const nextRun = d.nextScheduledRun;
  document.getElementById('next-run').textContent = nextRun ? new Date(nextRun).toLocaleString() : 'N/A';

  const syncs = d.lastSyncPerClient;
  const tbody = document.getElementById('sync-tbody');
  if (!syncs || syncs.error) {
    tbody.innerHTML = `<tr><td colspan="2" class="err-text" style="padding:14px">${syncs?.error || 'No data'}</td></tr>`;
    return;
  }
  if (!syncs.length) { tbody.innerHTML = `<tr><td colspan="2" class="err-text" style="padding:14px">No sync history found</td></tr>`; return; }

  tbody.innerHTML = syncs.map(s => `
    <tr>
      <td style="font-family:monospace;font-size:11px">${esc(s.clientId || '—')}</td>
      <td style="font-size:12px;color:var(--gray-600)">${fmtDate(s.lastSync)}</td>
    </tr>
  `).join('');
}

// ── Docs ──
function renderDocs(docs) {
  const grid = document.getElementById('docs-grid');
  const countEl = document.getElementById('doc-count');
  if (!docs || docs.error) {
    grid.innerHTML = `<div class="err-text">${docs?.error || 'Could not load docs'}</div>`;
    return;
  }
  countEl.textContent = `${docs.length} files in docs/`;
  if (!docs.length) { grid.innerHTML = `<div class="err-text">No .md files found</div>`; return; }

  grid.innerHTML = docs.map(doc => `
    <div class="doc-card">
      <div class="doc-card-name">📄 ${esc(doc.filename)}</div>
      <div class="doc-card-meta">
        ${doc.lastModified ? new Date(doc.lastModified).toLocaleDateString() : 'N/A'}
        &bull; ${doc.size ? fmtBytes(doc.size) : 'N/A'}
      </div>
      ${doc.viewUrl ? `<a href="${esc(doc.viewUrl)}" target="_blank">View →</a>` : ''}
    </div>
  `).join('');
}

// ── Memory ──
function renderMemory(d) {
  // Memory files table
  const memFiles = d.memoryFiles;
  const tbody = document.getElementById('memory-tbody');
  if (!memFiles || memFiles.error) {
    tbody.innerHTML = `<tr><td colspan="3" class="err-text" style="padding:10px">${memFiles?.error || 'No data'}</td></tr>`;
  } else if (!memFiles.length) {
    tbody.innerHTML = `<tr><td colspan="3" class="err-text" style="padding:10px">No memory files</td></tr>`;
  } else {
    tbody.innerHTML = memFiles.map(f => `
      <tr>
        <td style="font-size:12px">${esc(f.filename)}</td>
        <td style="font-size:12px;color:var(--gray-600)">${f.lastModified ? new Date(f.lastModified).toLocaleDateString() : 'N/A'}</td>
        <td style="font-size:12px;color:var(--gray-600)">${f.size ? fmtBytes(f.size) : 'N/A'}</td>
      </tr>
    `).join('');
  }

  // Disk usage in card header
  if (d.git?.diskUsage) document.getElementById('disk-usage').textContent = `Workspace: ${d.git.diskUsage}`;

  // Git commits
  const commits = d.git?.commits || [];
  document.getElementById('git-commits').textContent = commits.length ? commits.join('\n') : 'No commits found';
}

// ── GitHub ──
function renderGitHub(git) {
  if (!git) return;
  document.getElementById('git-branch').textContent = git.branch || 'unknown';
  document.getElementById('git-branch-label').textContent = `Branch: ${git.branch || 'unknown'}`;
  document.getElementById('git-last-push').textContent = git.lastPush || 'N/A';

  const statusEl = document.getElementById('git-status-output');
  if (!git.status || git.status.trim() === '') {
    statusEl.textContent = '✓ Working tree clean';
    statusEl.className = 'git-log git-clean';
  } else {
    statusEl.textContent = git.status;
    statusEl.className = 'git-log git-changed';
  }
}

// ── Helpers ──
function esc(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function fmtDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString(); } catch { return '—'; }
}
function fmtBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

// ── Auto-refresh ──
let refreshTimer = null;
function startAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(loadData, 60000);
}

// ── Init ──
checkAuth();
