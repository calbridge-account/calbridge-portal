import { useState } from 'react';

export default function Signup() {
  const [name, setName]               = useState('');
  const [companyName, setCompanyName] = useState('');
  const [email, setEmail]             = useState('');
  const [password, setPassword]       = useState('');
  const [confirmPw, setConfirmPw]     = useState('');
  const [error, setError]             = useState('');
  const [loading, setLoading]         = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPw) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name,
          email,
          password,
          companyName: companyName || undefined,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.error || 'Sign up failed. Please try again.');
        return;
      }

      // Success — redirect to the dashboard
      window.location.href = '/analytics/';
    } catch (err) {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  // ── Styles (mirrors public/index.html auth-card aesthetic) ──────────────
  const pageStyle = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    background: '#d8d0c4',
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    padding: '24px',
  };

  const cardStyle = {
    background: '#fff',
    borderRadius: '12px',
    padding: '40px',
    width: '100%',
    maxWidth: '400px',
    boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
  };

  const logoAreaStyle = {
    textAlign: 'center',
    marginBottom: '28px',
  };

  const logoImgStyle = {
    height: '80px',
    width: 'auto',
    marginBottom: '8px',
  };

  const logoSubStyle = {
    color: '#9ca3af',
    fontSize: '13px',
    margin: 0,
  };

  const errorStyle = {
    background: '#fde8e8',
    color: '#c81e1e',
    borderRadius: '8px',
    padding: '10px 14px',
    marginBottom: '16px',
    fontSize: '13px',
  };

  const groupStyle = {
    marginBottom: '16px',
  };

  const labelStyle = {
    display: 'block',
    fontWeight: '500',
    marginBottom: '6px',
    color: '#4b5563',
    fontSize: '14px',
  };

  const inputStyle = {
    width: '100%',
    padding: '10px 12px',
    border: '1px solid #e5e7eb',
    borderRadius: '8px',
    fontSize: '14px',
    outline: 'none',
    transition: 'border-color 0.15s',
    fontFamily: 'inherit',
  };

  const submitStyle = {
    width: '100%',
    padding: '11px',
    background: loading ? '#6b7280' : '#2d5a27',
    color: '#fff',
    border: 'none',
    borderRadius: '8px',
    fontSize: '15px',
    fontWeight: '600',
    cursor: loading ? 'not-allowed' : 'pointer',
    marginTop: '4px',
    transition: 'background 0.15s',
    fontFamily: 'inherit',
  };

  const switchStyle = {
    textAlign: 'center',
    marginTop: '20px',
    color: '#9ca3af',
    fontSize: '14px',
  };

  const linkStyle = {
    color: '#2d5a27',
    textDecoration: 'none',
    fontWeight: '500',
  };

  return (
    <div style={pageStyle}>
      <div style={cardStyle}>

        {/* Logo */}
        <div style={logoAreaStyle}>
          <img src="/images/calbridge-logo.png" alt="Calbridge" style={logoImgStyle} />
          <p style={logoSubStyle}>Create your account</p>
        </div>

        {/* Error */}
        {error && <div style={errorStyle}>{error}</div>}

        {/* Form */}
        <form onSubmit={handleSubmit}>

          <div style={groupStyle}>
            <label style={labelStyle} htmlFor="signup-name">Full Name</label>
            <input
              id="signup-name"
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              style={inputStyle}
              placeholder="Jane Smith"
              required
              autoComplete="name"
              onFocus={e => { e.target.style.borderColor = '#2d5a27'; e.target.style.boxShadow = '0 0 0 3px rgba(45,90,39,0.12)'; }}
              onBlur={e  => { e.target.style.borderColor = '#e5e7eb'; e.target.style.boxShadow = 'none'; }}
            />
          </div>

          <div style={groupStyle}>
            <label style={labelStyle} htmlFor="signup-company">
              Company Name <span style={{ color: '#9ca3af', fontWeight: 400 }}>(optional)</span>
            </label>
            <input
              id="signup-company"
              type="text"
              value={companyName}
              onChange={e => setCompanyName(e.target.value)}
              style={inputStyle}
              placeholder="Acme Brands LLC"
              autoComplete="organization"
              onFocus={e => { e.target.style.borderColor = '#2d5a27'; e.target.style.boxShadow = '0 0 0 3px rgba(45,90,39,0.12)'; }}
              onBlur={e  => { e.target.style.borderColor = '#e5e7eb'; e.target.style.boxShadow = 'none'; }}
            />
          </div>

          <div style={groupStyle}>
            <label style={labelStyle} htmlFor="signup-email">Email</label>
            <input
              id="signup-email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              style={inputStyle}
              placeholder="you@example.com"
              required
              autoComplete="email"
              onFocus={e => { e.target.style.borderColor = '#2d5a27'; e.target.style.boxShadow = '0 0 0 3px rgba(45,90,39,0.12)'; }}
              onBlur={e  => { e.target.style.borderColor = '#e5e7eb'; e.target.style.boxShadow = 'none'; }}
            />
          </div>

          <div style={groupStyle}>
            <label style={labelStyle} htmlFor="signup-password">Password</label>
            <input
              id="signup-password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              style={inputStyle}
              placeholder="••••••••"
              required
              minLength={8}
              autoComplete="new-password"
              onFocus={e => { e.target.style.borderColor = '#2d5a27'; e.target.style.boxShadow = '0 0 0 3px rgba(45,90,39,0.12)'; }}
              onBlur={e  => { e.target.style.borderColor = '#e5e7eb'; e.target.style.boxShadow = 'none'; }}
            />
          </div>

          <div style={groupStyle}>
            <label style={labelStyle} htmlFor="signup-confirm">Confirm Password</label>
            <input
              id="signup-confirm"
              type="password"
              value={confirmPw}
              onChange={e => setConfirmPw(e.target.value)}
              style={inputStyle}
              placeholder="••••••••"
              required
              autoComplete="new-password"
              onFocus={e => { e.target.style.borderColor = '#2d5a27'; e.target.style.boxShadow = '0 0 0 3px rgba(45,90,39,0.12)'; }}
              onBlur={e  => { e.target.style.borderColor = '#e5e7eb'; e.target.style.boxShadow = 'none'; }}
            />
          </div>

          <button
            type="submit"
            style={submitStyle}
            disabled={loading}
            onMouseOver={e => { if (!loading) e.target.style.background = '#1e3a1a'; }}
            onMouseOut={e  => { if (!loading) e.target.style.background = '#2d5a27'; }}
          >
            {loading ? 'Creating account…' : 'Create Account'}
          </button>
        </form>

        <p style={switchStyle}>
          Already have an account?{' '}
          <a href="/" style={linkStyle}>Sign in</a>
        </p>
      </div>
    </div>
  );
}
