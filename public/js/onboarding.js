
    let currentStep = 0;
    const totalSteps = 4;

    // ── Auth check ──────────────────────────────────────────────────────────
    (async () => {
      try {
        const r = await fetch('/auth/me', { credentials: 'include' });
        if (!r.ok) { window.location.href = '/'; return; }
        const { client } = await r.json();
        // Pre-fill name if available
        const nameInput = document.getElementById('ob-name');
        if (nameInput && client.name) nameInput.value = client.name;
      } catch { window.location.href = '/'; }
    })();

    // ── Load Amazon connection status ───────────────────────────────────────
    async function loadConnectionStatus() {
      try {
        const r = await fetch('/amazon/status', { credentials: 'include' });
        if (!r.ok) return;
        const data = await r.json();
        for (const [type, info] of Object.entries(data)) {
          const badge = document.getElementById(`badge-${type}`);
          if (badge) {
            badge.textContent = info.connected ? 'Connected ✓' : 'Not connected';
            badge.className   = info.connected ? 'badge-connected' : 'badge-disconnected';
          }
        }
      } catch { /* ignore */ }
    }

    // ── Step navigation ─────────────────────────────────────────────────────
    function updateProgress() {
      document.querySelectorAll('.step-indicator').forEach((el, i) => {
        el.classList.remove('active', 'done');
        if (i === currentStep) el.classList.add('active');
        if (i < currentStep)  el.classList.add('done');
      });
      document.querySelectorAll('.step-view').forEach((el, i) => {
        el.classList.toggle('active', i === currentStep);
      });
    }

    async function nextStep() {
      // Step 0: save profile if filled
      if (currentStep === 0) {
        const name    = document.getElementById('ob-name').value.trim();
        const company = document.getElementById('ob-company').value.trim();
        if (name) {
          await fetch('/account/profile', {
            method:  'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ name, companyName: company || name }),
            credentials: 'include'
          }).catch(() => {});
        }
      }
      if (currentStep === 1) {
        // Refresh connection badges when entering this step
        loadConnectionStatus();
      }
      currentStep = Math.min(currentStep + 1, totalSteps - 1);
      updateProgress();
      if (currentStep === 1) loadConnectionStatus();
    }

    function prevStep() {
      currentStep = Math.max(currentStep - 1, 0);
      updateProgress();
    }

    // ── COGS upload handler ─────────────────────────────────────────────────
    async function handleCogsUpload(input) {
      const file = input.files[0];
      if (!file) return;
      const statusEl = document.getElementById('ob-cogs-status');
      statusEl.className = 'status-msg status-info';
      statusEl.textContent = 'Uploading...';
      statusEl.classList.remove('hidden');

      const formData = new FormData();
      formData.append('file', file);

      try {
        const r = await fetch('/cogs/upload', {
          method: 'POST',
          body:   formData,
          credentials: 'include'
        });
        const data = await r.json();
        if (r.ok) {
          statusEl.className = 'status-msg status-success';
          statusEl.textContent = `✓ ${data.message || 'COGS uploaded successfully'}`;
        } else {
          statusEl.className = 'status-msg status-error';
          statusEl.textContent = data.error || 'Upload failed';
        }
      } catch {
        statusEl.className = 'status-msg status-error';
        statusEl.textContent = 'Network error — please try again';
      }
    }

    // ── Complete onboarding ─────────────────────────────────────────────────
    async function completeOnboarding() {
      const btn = document.getElementById('btn-go-dashboard');
      btn.disabled = true;
      btn.textContent = 'Setting up...';
      try {
        await fetch('/account/complete-onboarding', {
          method: 'POST',
          credentials: 'include'
        });
      } catch { /* ignore — redirect anyway */ }
      window.location.href = '/dashboard.html';
    }
  