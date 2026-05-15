// Auth pages — login + signup

const isSignup = document.getElementById('signup-form') !== null;
const form     = document.getElementById(isSignup ? 'signup-form' : 'login-form');
const errorEl  = document.getElementById('auth-error');
const btn      = document.getElementById(isSignup ? 'signup-btn' : 'login-btn');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorEl.classList.add('hidden');

  // Client-side validation for signup
  if (isSignup) {
    const emailVal = document.getElementById('email').value.toLowerCase().trim();
    const passwordVal = document.getElementById('password').value;
    const nameVal = document.getElementById('name').value.trim();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

    if (!nameVal) {
      errorEl.textContent = 'Please enter your name.';
      errorEl.classList.remove('hidden');
      return;
    }
    if (!emailRegex.test(emailVal)) {
      errorEl.textContent = 'Please enter a valid email address.';
      errorEl.classList.remove('hidden');
      return;
    }
    if (passwordVal.length < 8) {
      errorEl.textContent = 'Password must be at least 8 characters.';
      errorEl.classList.remove('hidden');
      return;
    }
  }

  btn.disabled = true;
  btn.textContent = isSignup ? 'Creating account...' : 'Signing in...';

  const body = isSignup
    ? { name: document.getElementById('name').value.trim(), email: document.getElementById('email').value.toLowerCase().trim(), password: document.getElementById('password').value, account_type: (document.querySelector('input[name="account_type"]:checked') || {}).value || 'brand' }
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
      if (data.error === 'EMAIL_NOT_VERIFIED') {
        errorEl.textContent = 'Please verify your email before signing in. Check your inbox for a verification link.';
        errorEl.classList.remove('hidden');
        btn.disabled = false;
        btn.textContent = 'Sign In';
        return;
      }
      throw new Error(data.message || data.error || 'Something went wrong');
    }
    if (isSignup) {
      // Show "check your email" instead of redirecting — account is pending_verification
      const email = body.email;
      form.style.display = 'none';
      errorEl.style.background = '#f0fdf4';
      errorEl.style.color = '#15803d';
      errorEl.style.border = '1px solid #bbf7d0';
      errorEl.style.borderRadius = '8px';
      errorEl.style.padding = '16px';
      errorEl.innerHTML = `
        <strong>Check your email!</strong><br>
        We sent a verification link to <strong>${email}</strong>.<br>
        <span style="font-size:12px;color:#6b7280;margin-top:4px;display:block;">Didn't get it? Check your spam folder or <a href="mailto:ash@teamcalbridge.com?subject=Resend verification email&body=Please resend my verification email. Account: ${email}" style="color:#15803d;">contact us to resend</a>.</span>
      `;
      errorEl.classList.remove('hidden');
      return; // Don't redirect
    } else {
      // Smart post-login routing by account type
      const params = new URLSearchParams(window.location.search);
      const redirect = params.get('redirect');
      if (redirect) {
        window.location.href = redirect;
      } else if (data.client?.accountType === 'agency') {
        window.location.href = '/analytics/brands';
      } else if (!data.client?.onboardingCompleted) {
        // Check connections to decide brand-setup vs dashboard
        try {
          const connRes = await fetch('/amazon/status', { credentials: 'include' });
          const connData = connRes.ok ? await connRes.json() : {};
          const hasConnections = Object.values(connData).some(c => c?.connected);
          window.location.href = '/analytics/';
        } catch {
          window.location.href = '/analytics/';
        }
      } else {
        window.location.href = '/analytics/';
      }
    }
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove('hidden');
    btn.disabled = false;
    btn.textContent = isSignup ? 'Create Account' : 'Sign In';
  }
});
