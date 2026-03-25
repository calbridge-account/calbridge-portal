// ── State ──
let pageData = null;
let arpu = 0;

// ── Auth ──────────────────────────────────────────
async function checkAuth() {
  try {
    const res = await fetch('/admin/me', { credentials: 'include' });
    if (res.ok) {
      showApp();
    }
  } catch {}
}

function showApp() {
  document.getElementById('pc-login').style.display = 'none';
  document.getElementById('pc-app').style.display = 'block';
  loadData();
  startAutoRefresh();
}

document.getElementById('pc-login-btn').addEventListener('click', async () => {
  const email    = document.getElementById('pc-email-input').value.trim();
  const password = document.getElementById('pc-password-input').value;
  const errEl    = document.getElementById('pc-login-error');
  const btn      = document.getElementById('pc-login-btn');
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
    if (res.ok) { showApp(); }
    else {
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

document.getElementById('pc-password-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('pc-login-btn').click();
});

// ── Load Data ──────────────────────────────────────
async function loadData() {
  try {
    const res = await fetch('/admin/platform-costs/data', { credentials: 'include' });
    if (res.status === 401) { location.reload(); return; }
    pageData = await res.json();

    document.getElementById('loading-state').style.display = 'none';
    document.getElementById('dashboard-content').style.display = 'block';

    renderCostSummary(pageData);
    renderUnitEconomics(pageData);
    renderStripe(pageData);
    renderAlerts(pageData);

    document.getElementById('last-refresh-label').textContent = 'Last refreshed ' + new Date().toLocaleTimeString();
    document.getElementById('cost-month').textContent = 'Period: ' + new Date().toLocaleString('default', { month: 'long', year: 'numeric' });
  } catch (err) {
    console.error('Failed to load platform-costs data:', err);
  }
}

// ── Cost Summary ──
function renderCostSummary(d) {
  const manual     = d.manualCosts || {};
  const sfCompute  = d.snowflakeCompute;
  const sfStorage  = d.snowflakeStorage;
  const resend     = d.resend;
  const openrouter = d.openrouter;
  const azure      = d.azure;

  // Build line items
  const rows = [
    {
      service: 'Azure (VM + all services)',
      cost:   azure?.error ? null : azure?.totalCostUsd,
      error:  azure?.error,
      source: 'auto',
      period: azure?.period || 'This month',
      sub:    azure && !azure.error ? `Live from Azure Cost Management` : null
    },
    {
      service: 'Snowflake Compute',
      cost:   sfCompute?.error ? null : sfCompute?.estimatedCostUsd,
      error:  sfCompute?.error,
      source: 'auto',
      period: 'This month'
    },
    {
      service: 'Snowflake Storage',
      cost:   sfStorage?.error ? null : sfStorage?.estimatedCostUsd,
      error:  sfStorage?.error,
      source: 'auto',
      period: 'This month'
    },
    // OpenRouter — one row per key, plus a credits-remaining summary
    ...(openrouter && !openrouter.error
      ? openrouter.keys.map(k => ({
          service: `OpenRouter — ${k.name}`,
          cost:    k.usageMonthly,
          error:   null,
          source:  'auto',
          period:  'This month',
          sub:     `All-time: $${k.usageAllTime.toFixed(2)}`
        }))
      : [{
          service: 'OpenRouter (AI)',
          cost:    null,
          error:   openrouter?.error || 'Not configured',
          source:  'auto',
          period:  'This month'
        }]
    ),
    {
      service: 'Resend (Email)',
      cost:   resend?.error ? null : (resend?.estimatedCostUsd || 0),
      error:  resend?.error,
      source: 'auto',
      period: 'This month',
      sub:    resend && !resend.error ? `${resend.emailsThisMonth} emails sent` : null
    },
    {
      service: 'Domain / SSL',
      cost:   manual.domainSsl || 0,
      source: 'manual',
      period: 'Annual ÷ 12'
    },
    {
      service: 'GitHub',
      cost:   d.github?.error ? null : (d.github?.monthlyCost || 0),
      error:  d.github?.error,
      source: 'auto',
      period: 'Monthly',
      sub:    d.github && !d.github.error ? `Plan: ${d.github.plan} (@${d.github.login})` : null
    }
  ];

  // Total (only known numeric values)
  let total = 0;
  rows.forEach(r => { if (typeof r.cost === 'number') total += r.cost; });

  window._platformTotal = total;

  const tbody = document.getElementById('cost-tbody');
  tbody.innerHTML = rows.map(r => {
    const badge = r.source === 'auto'
      ? `<span class="cost-source-badge badge-auto">Auto</span>`
      : `<span class="cost-source-badge badge-manual">Manual</span>`;
    let costCell;
    if (r.error) {
      costCell = `<span class="cost-source-badge badge-na">N/A</span> <span style="font-size:11px;color:var(--gray-400)">${esc(r.error)}</span>`;
    } else if (typeof r.cost === 'number') {
      costCell = `<strong>$${r.cost.toFixed(2)}</strong>${r.sub ? `<br><span style="font-size:11px;color:var(--gray-400)">${esc(r.sub)}</span>` : ''}`;
    } else {
      costCell = `<span style="color:var(--gray-400)">$0.00</span>`;
    }
    return `<tr>
      <td>${esc(r.service)}</td>
      <td>${costCell}</td>
      <td>${badge}</td>
      <td style="color:var(--gray-400)">${esc(r.period)}</td>
    </tr>`;
  }).join('') + `<tr class="total-row">
    <td>Total (Known Costs)</td>
    <td>$${total.toFixed(2)}</td>
    <td></td>
    <td>Monthly est.</td>
  </tr>`;

  // Summary KPIs
  const activeClients = typeof d.activeClients === 'number' ? d.activeClients : 0;
  const mrr = d.stripe && !d.stripe.error ? (d.stripe.mrr || 0) : 0;
  const costPerClient = activeClients > 0 ? total / activeClients : 0;

  document.getElementById('summary-kpis').innerHTML = `
    <div class="ops-kpi highlight">
      <div class="ops-kpi-label">Total Monthly Cost</div>
      <div class="ops-kpi-value">$${total.toFixed(0)}</div>
      <div class="ops-kpi-sub">Known line items</div>
    </div>
    <div class="ops-kpi">
      <div class="ops-kpi-label">Active Clients</div>
      <div class="ops-kpi-value">${typeof d.activeClients === 'number' ? d.activeClients : 'N/A'}</div>
      <div class="ops-kpi-sub">In Snowflake</div>
    </div>
    <div class="ops-kpi">
      <div class="ops-kpi-label">Cost per Client</div>
      <div class="ops-kpi-value">$${activeClients > 0 ? costPerClient.toFixed(2) : '—'}</div>
      <div class="ops-kpi-sub">Total ÷ clients</div>
    </div>
    <div class="ops-kpi ${mrr > 0 && mrr >= total ? 'highlight' : 'warning'}">
      <div class="ops-kpi-label">MRR</div>
      <div class="ops-kpi-value">$${mrr > 0 ? mrr.toFixed(0) : '—'}</div>
      <div class="ops-kpi-sub">From Stripe</div>
    </div>
    ${d.openrouter && !d.openrouter.error ? `
    <div class="ops-kpi ${d.openrouter.remaining < 50 ? 'danger' : ''}">
      <div class="ops-kpi-label">OpenRouter Credits</div>
      <div class="ops-kpi-value">$${d.openrouter.remaining.toFixed(2)}</div>
      <div class="ops-kpi-sub">Remaining of $${d.openrouter.totalCredits.toFixed(0)}</div>
    </div>` : ''}
  `;
}

// ── Unit Economics ──
function applyArpu() {
  arpu = parseFloat(document.getElementById('arpu-input').value) || 0;
  if (pageData) renderUnitEconomics(pageData);
}

function renderUnitEconomics(d) {
  const activeClients = typeof d.activeClients === 'number' ? d.activeClients : 0;
  const total = window._platformTotal || 0;
  const costPerClient = activeClients > 0 ? total / activeClients : 0;
  const mrrArpu = d.stripe && !d.stripe.error && d.stripe.activeSubscriptions > 0
    ? (d.stripe.mrr / d.stripe.activeSubscriptions)
    : arpu;
  const effectiveArpu = arpu > 0 ? arpu : mrrArpu;

  document.getElementById('active-clients-label').textContent = `${activeClients} active client${activeClients !== 1 ? 's' : ''}`;

  const metrics = [
    { label: 'Active Clients', value: activeClients },
    { label: 'Total Platform Cost (est.)', value: '$' + total.toFixed(2) },
    { label: 'Cost per Client', value: activeClients > 0 ? '$' + costPerClient.toFixed(2) : '—' },
    { label: 'ARPU (effective)', value: effectiveArpu > 0 ? '$' + effectiveArpu.toFixed(2) : 'Set below ↓' }
  ];

  document.getElementById('econ-metrics').innerHTML = metrics.map(m => `
    <div class="econ-metric">
      <span class="econ-label">${esc(String(m.label))}</span>
      <span class="econ-value">${esc(String(m.value))}</span>
    </div>
  `).join('');

  // Margin calculations
  const calcEl = document.getElementById('margin-calc');
  if (effectiveArpu > 0) {
    const grossMargin = ((effectiveArpu - costPerClient) / effectiveArpu) * 100;
    const breakEven = total > 0 && effectiveArpu > 0 ? Math.ceil(total / effectiveArpu) : null;
    const marginClass = grossMargin >= 50 ? 'positive' : grossMargin >= 0 ? '' : 'negative';

    calcEl.innerHTML = `
      <div class="econ-metric">
        <span class="econ-label">Gross Margin (per client)</span>
        <span class="econ-value ${marginClass}">${grossMargin.toFixed(1)}%</span>
      </div>
      <div class="econ-metric">
        <span class="econ-label">Break-even Clients</span>
        <span class="econ-value">${breakEven !== null ? breakEven : '—'}</span>
      </div>
      <div class="econ-metric">
        <span class="econ-label">Monthly Profit (est.)</span>
        <span class="econ-value ${effectiveArpu * activeClients - total >= 0 ? 'positive' : 'negative'}">
          $${((effectiveArpu * activeClients) - total).toFixed(2)}
        </span>
      </div>
    `;
  } else {
    calcEl.innerHTML = `<div class="err-text">Enter ARPU above to calculate margins and break-even.</div>`;
  }

  // Pre-fill ARPU from Stripe if available
  if (d.stripe && !d.stripe.error && d.stripe.activeSubscriptions > 0 && arpu === 0) {
    const stripeArpu = d.stripe.mrr / d.stripe.activeSubscriptions;
    document.getElementById('arpu-input').placeholder = stripeArpu.toFixed(2) + ' (from Stripe)';
  }
}

// ── Stripe ──
function renderStripe(d) {
  const stripeEl = document.getElementById('stripe-body');
  const stripe = d.stripe;

  if (!stripe || stripe.error) {
    stripeEl.innerHTML = `
      <div class="err-text" style="margin-bottom:14px">${stripe?.error || 'No Stripe data'}</div>
      <p style="font-size:13px;color:var(--gray-600)">No active Stripe subscriptions — use ARPU field in Unit Economics for manual MRR entry.</p>
      <div style="display:flex;align-items:center;gap:10px;margin-top:12px">
        <label style="font-size:12px;color:var(--gray-600)">Manual MRR ($):</label>
        <input type="number" id="manual-mrr" placeholder="0" min="0" style="padding:7px 10px;border:1px solid var(--gray-200);border-radius:var(--radius);font-size:13px;width:140px"/>
        <button class="btn-secondary" onclick="applyManualMrr()">Apply</button>
      </div>
    `;
    return;
  }

  const planRows = Object.entries(stripe.planDistribution || {}).map(([plan, count]) => `
    <tr>
      <td>${esc(plan)}</td>
      <td>${count}</td>
    </tr>
  `).join('') || '<tr><td colspan="2" class="err-text" style="padding:10px">No plans</td></tr>';

  stripeEl.innerHTML = `
    <div class="ops-kpi-grid" style="margin-bottom:16px">
      <div class="ops-kpi highlight">
        <div class="ops-kpi-label">Active Subscriptions</div>
        <div class="ops-kpi-value">${stripe.activeSubscriptions}</div>
      </div>
      <div class="ops-kpi highlight">
        <div class="ops-kpi-label">MRR</div>
        <div class="ops-kpi-value">$${stripe.mrr.toFixed(0)}</div>
        <div class="ops-kpi-sub">Monthly Recurring Revenue</div>
      </div>
    </div>
    <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--gray-400);margin-bottom:8px">Plan Distribution</div>
    <table class="ops-table">
      <thead><tr><th>Plan</th><th>Subscriptions</th></tr></thead>
      <tbody>${planRows}</tbody>
    </table>
  `;
}

// ── Alerts ──
function renderAlerts(d) {
  const alerts = [];
  const total = window._platformTotal || 0;
  const mrr = d.stripe && !d.stripe.error ? (d.stripe.mrr || 0) : 0;
  const resend = d.resend;
  const sfCompute = d.snowflakeCompute;

  // Snowflake compute > $50
  if (sfCompute && !sfCompute.error && sfCompute.estimatedCostUsd > 50) {
    alerts.push({
      type: 'danger',
      icon: '🔴',
      title: 'Snowflake compute over $50/month',
      message: `Current estimate: $${sfCompute.estimatedCostUsd.toFixed(2)} — unexpected usage, investigate warehouse activity.`
    });
  }

  // Resend approaching free tier (>2,500)
  if (resend && !resend.error && resend.emailsThisMonth > 2500) {
    alerts.push({
      type: 'warning',
      icon: '🟡',
      title: 'Resend approaching free tier limit',
      message: `${resend.emailsThisMonth} emails sent this month (free tier: 3,000). Paid tier begins at $0.001/email.`
    });
  }

  // Total costs > MRR
  if (mrr > 0 && total > mrr) {
    alerts.push({
      type: 'danger',
      icon: '🔴',
      title: 'Costs exceed MRR',
      message: `Monthly costs ($${total.toFixed(2)}) exceed Stripe MRR ($${mrr.toFixed(2)}). You're spending more than you're making.`
    });
  } else if (mrr > 0 && total <= mrr) {
    alerts.push({
      type: 'ok',
      icon: '✅',
      title: 'Costs within MRR',
      message: `Monthly costs ($${total.toFixed(2)}) are below MRR ($${mrr.toFixed(2)}). Margin: ${(((mrr - total) / mrr) * 100).toFixed(1)}%.`
    });
  }

  if (alerts.length === 0) {
    alerts.push({ type: 'ok', icon: '✅', title: 'No alerts', message: 'All monitored metrics are within normal thresholds.' });
  }

  document.getElementById('alert-count').textContent = `${alerts.filter(a => a.type !== 'ok').length} alert(s)`;
  document.getElementById('alerts-body').innerHTML = alerts.map(a => `
    <div class="alert-item alert-${a.type}">
      <span class="alert-icon">${a.icon}</span>
      <div class="alert-text">
        <strong>${esc(a.title)}</strong>
        ${esc(a.message)}
      </div>
    </div>
  `).join('');
}

function applyManualMrr() {
  const val = parseFloat(document.getElementById('manual-mrr')?.value) || 0;
  if (pageData) {
    if (!pageData.stripe) pageData.stripe = {};
    pageData.stripe.mrr = val;
    pageData.stripe.activeSubscriptions = 1;
    pageData.stripe.planDistribution = { 'Manual Entry': 1 };
    pageData.stripe.error = null;
    renderStripe(pageData);
    renderAlerts(pageData);
    renderUnitEconomics(pageData);
    renderCostSummary(pageData);
  }
}

// ── Helpers ──
function esc(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Auto-refresh ──
let refreshTimer = null;
function startAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(loadData, 60000);
}

// ── Init ──
checkAuth();
