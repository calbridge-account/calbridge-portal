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
    ? { name: document.getElementById('name').value, email: document.getElementById('email').value.toLowerCase().trim(), password: document.getElementById('password').value }
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
      errorEl.style.background = 'var(--success-bg)';
      errorEl.style.color = 'var(--success)';
      errorEl.innerHTML = 'Account created! Your access is pending approval.<br>You will receive an email once approved.';
      errorEl.classList.remove('hidden');
      document.getElementById('signup-form').style.display = 'none';
    } else {
      window.location.href = '/dashboard.html';
    }
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove('hidden');
    btn.disabled = false;
    btn.textContent = isSignup ? 'Create Account' : 'Sign In';
  }
});
