
    // Weekly Reports button
    document.getElementById('send-weekly-reports-btn')?.addEventListener('click', async () => {
      const btn = document.getElementById('send-weekly-reports-btn');
      const status = document.getElementById('weekly-report-status');
      btn.disabled = true;
      btn.textContent = '⏳ Sending...';
      status.textContent = '';
      try {
        const res = await fetch('/admin/send-weekly-reports', { method: 'POST', credentials: 'include' });
        const data = await res.json();
        if (res.ok) {
          status.textContent = `✅ Queued for ${data.clientCount} active client(s)`;
          status.style.color = 'var(--success)';
        } else {
          status.textContent = `❌ ${data.error || 'Failed'}`;
          status.style.color = 'var(--danger)';
        }
      } catch (err) {
        status.textContent = '❌ Request failed';
        status.style.color = 'var(--danger)';
      } finally {
        btn.disabled = false;
        btn.textContent = '📧 Send Weekly Reports';
      }
    });
  
// ── Client table ─────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const tbody  = document.getElementById('clients-table-body');
  const search = document.getElementById('client-search');
  if (!tbody) return;

  let allClients = [];

  function fmtDate(ts) {
    if (!ts) return '—';
    try { return new Date(ts).toLocaleString('en-US', { month:'short', day:'numeric', year:'numeric', hour:'2-digit', minute:'2-digit' }); }
    catch { return ts; }
  }

  function renderClients(clients) {
    if (!clients.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="loading-cell">No clients found.</td></tr>';
      return;
    }
    tbody.innerHTML = clients.map(c => {
      const isLinked = !!c.linkedClientId;
      const statusColor = c.status === 'active' ? 'var(--success)' : c.status === 'pending' ? '#b45309' : 'var(--gray-400)';
      return `<tr>
        <td><strong>${c.name}</strong>${isLinked ? ' <span style="font-size:10px;color:var(--gray-400)">(viewer)</span>' : ''}</td>
        <td style="font-size:12px">${c.email}</td>
        <td style="font-size:12px">${c.companyName || '—'}</td>
        <td><span style="color:${statusColor};font-weight:600;font-size:12px">${c.status}</span></td>
        <td style="font-size:12px">—</td>
        <td style="font-size:12px;color:${c.lastLoginAt ? 'var(--gray-800)' : 'var(--gray-400)'}">${fmtDate(c.lastLoginAt)}</td>
        <td style="font-size:12px;color:var(--gray-400)">${fmtDate(c.createdAt)}</td>
        <td><button onclick="window.location='/admin'" style="font-size:11px;padding:3px 8px;border:1px solid var(--gray-200);border-radius:4px;background:#fff;cursor:pointer">View</button></td>
      </tr>`;
    }).join('');
  }

  try {
    const res = await fetch('/admin/clients', { credentials: 'include' });
    if (res.ok) {
      allClients = await res.json();
      renderClients(allClients);
    }
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="8" class="loading-cell">Error loading clients.</td></tr>';
  }

  search?.addEventListener('input', () => {
    const q = search.value.toLowerCase();
    renderClients(q ? allClients.filter(c =>
      c.name?.toLowerCase().includes(q) || c.email?.toLowerCase().includes(q)
    ) : allClients);
  });
});

// ── Spend Adjustments ────────────────────────────────────────────────────────
(function () {
  let allAdjustments = [];
  let allClients = [];

  function pctLabel(mult) {
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
        <td>${pctLabel(a.multiplier)}</td>
        <td style="font-size:12px;color:var(--gray-500)">${a.note || '—'}</td>
        <td style="font-size:12px;color:var(--gray-400)">${a.createdBy || '—'}</td>
        <td>
          <button class="action-btn btn-suspend" onclick="deleteAdj(${a.id})">Delete</button>
        </td>
      </tr>
    `).join('');
  }

  async function loadAdjustments() {
    const tbody = document.getElementById('adj-table-body');
    if (!tbody) return;
    try {
      const res = await fetch('/admin/spend-adjustments', { credentials: 'include' });
      if (!res.ok) throw new Error();
      allAdjustments = await res.json();
      const filterSel = document.getElementById('sa-filter-client');
      const currentFilter = filterSel?.value || '';
      renderAdjTable(currentFilter);
    } catch {
      if (tbody) tbody.innerHTML = '<tr><td colspan="8" class="loading-cell">Error loading adjustments.</td></tr>';
    }
  }

  async function populateClientDropdowns() {
    try {
      const res = await fetch('/admin/clients', { credentials: 'include' });
      if (!res.ok) return;
      allClients = await res.json();
      const saClient = document.getElementById('sa-client');
      const filterSel = document.getElementById('sa-filter-client');
      allClients.forEach(c => {
        const label = c.companyName || c.name || c.email;
        if (saClient) saClient.insertAdjacentHTML('beforeend', `<option value="${c.clientId}">${label}</option>`);
        if (filterSel) filterSel.insertAdjacentHTML('beforeend', `<option value="${c.clientId}">${label}</option>`);
      });
    } catch {}
  }

  window.deleteAdj = async function (id) {
    if (!confirm('Remove this spend adjustment?')) return;
    try {
      const res = await fetch(`/admin/spend-adjustments/${id}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) throw new Error();
      loadAdjustments();
    } catch {
      alert('Failed to delete adjustment.');
    }
  };

  document.addEventListener('DOMContentLoaded', () => {
    // Only wire up if we're on the admin panel
    const saveBtn = document.getElementById('save-adj-btn');
    const filterSel = document.getElementById('sa-filter-client');
    if (!saveBtn) return;

    populateClientDropdowns();
    loadAdjustments();

    filterSel?.addEventListener('change', () => renderAdjTable(filterSel.value));

    saveBtn.addEventListener('click', async () => {
      const result = document.getElementById('sa-result');
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

      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving…';

      try {
        const res = await fetch('/admin/spend-adjustments', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientId, yearMonth, adType, multiplier, note })
        });
        const data = await res.json();
        if (!res.ok) {
          result.className = 'status-msg error';
          result.textContent = data.error || 'Save failed.';
        } else {
          result.className = 'status-msg success';
          result.textContent = '✅ Adjustment saved.';
          // Clear form
          document.getElementById('sa-multiplier').value = '';
          document.getElementById('sa-note').value = '';
          loadAdjustments();
        }
      } catch {
        result.className = 'status-msg error';
        result.textContent = 'Request failed.';
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save';
      }
    });
  });
})();
