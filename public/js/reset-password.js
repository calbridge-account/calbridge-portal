
    const params  = new URLSearchParams(window.location.search);
    const token   = params.get('token');
    const forgot  = params.get('forgot');

    const forgotView       = document.getElementById('forgot-view');
    const resetView        = document.getElementById('reset-view');
    const invalidTokenView = document.getElementById('invalid-token-view');

    // Determine which view to show
    if (token) {
      forgotView.classList.add('hidden');
      resetView.classList.remove('hidden');
    } else {
      // Show forgot form (either ?forgot=1 or bare URL)
      forgotView.classList.remove('hidden');
    }

    // ── Forgot password form ────────────────────────────────────────────────
    document.getElementById('forgot-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const errorEl   = document.getElementById('forgot-error');
      const successEl = document.getElementById('forgot-success');
      const btn       = document.getElementById('forgot-btn');
      const email     = document.getElementById('forgot-email').value.toLowerCase().trim();

      errorEl.classList.add('hidden');
      successEl.classList.add('hidden');
      btn.disabled = true;
      btn.textContent = 'Sending...';

      try {
        const r = await fetch('/auth/forgot-password', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ email })
        });
        const data = await r.json();
        if (!r.ok) {
          errorEl.textContent = data.error || 'Something went wrong';
          errorEl.classList.remove('hidden');
        } else {
          successEl.textContent = data.message;
          successEl.classList.remove('hidden');
          document.getElementById('forgot-form').style.display = 'none';
        }
      } catch (err) {
        errorEl.textContent = 'Network error — please try again';
        errorEl.classList.remove('hidden');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Send Reset Link';
      }
    });

    // ── Reset password form ─────────────────────────────────────────────────
    document.getElementById('reset-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const errorEl   = document.getElementById('reset-error');
      const successEl = document.getElementById('reset-success');
      const btn       = document.getElementById('reset-btn');

      const newPass     = document.getElementById('new-password').value;
      const confirmPass = document.getElementById('confirm-password').value;

      errorEl.classList.add('hidden');
      successEl.classList.add('hidden');

      if (newPass !== confirmPass) {
        errorEl.textContent = 'Passwords do not match';
        errorEl.classList.remove('hidden');
        return;
      }
      if (newPass.length < 8) {
        errorEl.textContent = 'Password must be at least 8 characters';
        errorEl.classList.remove('hidden');
        return;
      }

      btn.disabled = true;
      btn.textContent = 'Updating...';

      try {
        const r = await fetch('/auth/reset-password', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ token, password: newPass })
        });
        const data = await r.json();
        if (!r.ok) {
          // Token expired or invalid
          if (r.status === 400 && data.error?.includes('expired')) {
            resetView.classList.add('hidden');
            invalidTokenView.classList.remove('hidden');
          } else {
            errorEl.textContent = data.error || 'Something went wrong';
            errorEl.classList.remove('hidden');
            btn.disabled = false;
            btn.textContent = 'Set New Password';
          }
        } else {
          successEl.textContent = data.message + ' Redirecting to login...';
          successEl.classList.remove('hidden');
          document.getElementById('reset-form').style.display = 'none';
          setTimeout(() => { window.location.href = '/'; }, 2500);
        }
      } catch (err) {
        errorEl.textContent = 'Network error — please try again';
        errorEl.classList.remove('hidden');
        btn.disabled = false;
        btn.textContent = 'Set New Password';
      }
    });
  