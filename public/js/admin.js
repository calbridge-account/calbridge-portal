
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
