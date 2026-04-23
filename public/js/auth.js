// Auth pages — login + signup

const isSignup = document.getElementById('signup-form') !== null;
const form     = document.getElementById(isSignup ? 'signup-form' : 'login-form');
const errorEl  = document.getElementById('auth-error');
const btn      = document.getElementById(isSignup ? 'signup-btn' : 'login-btn');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorEl.classList.add('hidden');
  btn.disabled = true;
  btn.textContent = isSignup ? 'Creating account...' : 'Signing in...';

  const body = isSignup
    ? { name: document.getElementById('name').value, email: document.getElementById('email').value.toLowerCase().trim(), password: document.getElementById('password').value, account_type: (document.querySelector('input[name="account_type"]:checked') || {}).value || 'brand' }
    : { email: document.getElementById('email').value.toLowerCase().trim(), password: document.getElementById('password').value };

  try {
    const res = await fetch(isSignup ? '/auth/signup' : '/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'include'
    });
    const data = await res.json();
    if (!res.ok) {
      if (data.error === 'PENDING_APPROVAL') {
        errorEl.innerHTML = 'Your account is pending approval.<br>You will receive an email once approved.';
        errorEl.classList.remove('hidden');
        btn.disabled = false;
        btn.textContent = isSignup ? 'Create Account' : 'Sign In';
        return;
      }
      throw new Error(data.message || data.error || 'Something went wrong');
    }
    if (isSignup) {
      // Auto-approved — redirect straight to onboarding
      window.location.href = '/onboarding.html?welcome=1';
    } else {
      // Redirect to onboarding if not completed and no connections exist
      const onboardingDone = data.client?.onboardingCompleted;
      if (!onboardingDone) {
        // Check if the client has any Amazon connections before deciding
        try {
          const connRes = await fetch('/amazon/status', { credentials: 'include' });
          const connData = connRes.ok ? await connRes.json() : {};
          const hasConnections = Object.values(connData).some(c => c.connected);
          if (!hasConnections) {
            window.location.href = '/onboarding.html?welcome=1';
            return;
          }
        } catch {
          // If connection check fails, fall through to dashboard
        }
      }
      const params = new URLSearchParams(window.location.search);
      window.location.href = params.get('redirect') || '/dashboard.html';
    }
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove('hidden');
    btn.disabled = false;
    btn.textContent = isSignup ? 'Create Account' : 'Sign In';
  }
});
