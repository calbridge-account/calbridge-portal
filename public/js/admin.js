
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
  