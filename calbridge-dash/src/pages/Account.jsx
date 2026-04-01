import { useState, useEffect, useRef } from 'react';
import PageHeader from '../components/PageHeader';

// ─── Reusable section card ────────────────────────────────────────────────────
function Section({ title, children }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
      <h2 className="text-sm font-semibold text-gray-700 mb-4">{title}</h2>
      {children}
    </div>
  );
}

// ─── Connection badge ─────────────────────────────────────────────────────────
function ConnectionBadge({ label, connected, connectedAt }) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-gray-100 last:border-0">
      <div className="flex items-center gap-3">
        <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${connected ? 'bg-green-500' : 'bg-gray-300'}`} />
        <span className="text-sm font-medium text-gray-700">{label}</span>
      </div>
      <div className="text-right">
        {connected ? (
          <div>
            <span className="text-xs font-medium text-green-700 bg-green-50 px-2 py-0.5 rounded-full">Connected</span>
            {connectedAt && (
              <div className="text-xs text-gray-400 mt-0.5">
                {new Date(connectedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </div>
            )}
          </div>
        ) : (
          <span className="text-xs font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">Not connected</span>
        )}
      </div>
    </div>
  );
}

function ConnectButton({ label, href }) {
  return (
    <a
      href={href}
      className="flex items-center justify-between w-full px-4 py-3 rounded-lg border border-gray-200 bg-white hover:border-brand hover:bg-brand-light transition-colors group"
    >
      <span className="text-sm font-medium text-gray-700 group-hover:text-brand">{label}</span>
      <svg className="w-4 h-4 text-gray-400 group-hover:text-brand" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
      </svg>
    </a>
  );
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function Toast({ message, type = 'success', onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 3500);
    return () => clearTimeout(t);
  }, [onClose]);
  return (
    <div className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium flex items-center gap-2 ${
      type === 'success' ? 'bg-green-700 text-white' : 'bg-red-600 text-white'
    }`}>
      {type === 'success' ? '✅' : '❌'} {message}
      <button onClick={onClose} className="ml-2 opacity-70 hover:opacity-100">×</button>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function Account() {
  const [profile, setProfile]     = useState(null);
  const [connStatus, setConnStatus] = useState(null);
  const [loading, setLoading]     = useState(true);
  const [toast, setToast]         = useState(null);

  // Profile form state
  const [companyName, setCompanyName] = useState('');
  const [contactName, setContactName] = useState('');
  const [weeklyReport, setWeeklyReport] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);

  // Password form state
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw]         = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [savingPw, setSavingPw]   = useState(false);

  // Logo state
  const [logoUrl, setLogoUrl]     = useState(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const logoInputRef = useRef(null);

  // Team members
  const [team, setTeam]           = useState([]);
  const [newEmail, setNewEmail]   = useState('');
  const [newName, setNewMemberName] = useState('');
  const [newRole, setNewRole]     = useState('viewer');
  const [addingMember, setAddingMember] = useState(false);

  function showToast(message, type = 'success') {
    setToast({ message, type });
  }

  useEffect(() => {
    Promise.all([
      fetch('/account/profile',  { credentials: 'include' }).then(r => r.ok ? r.json() : null),
      fetch('/amazon/status',    { credentials: 'include' }).then(r => r.ok ? r.json() : null),
      fetch('/account/team',     { credentials: 'include' }).then(r => r.ok ? r.json() : []),
    ]).then(([prof, conn, teamData]) => {
      if (prof) {
        setProfile(prof);
        setCompanyName(prof.companyName || '');
        setContactName(prof.name || '');
        setWeeklyReport(prof.weeklyReportEnabled !== false);
        setLogoUrl(prof.logoUrl || null);
      }
      if (conn) setConnStatus(conn);
      // API returns array directly
      if (Array.isArray(teamData)) setTeam(teamData);
      setLoading(false);
    });
  }, []);

  // ── Profile save ────────────────────────────────────────────────────────────
  async function saveProfile(e) {
    e.preventDefault();
    setSavingProfile(true);
    try {
      const res = await fetch('/account/profile', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: contactName, companyName, weeklyReportEnabled: weeklyReport }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Save failed');
      showToast('Profile updated');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSavingProfile(false);
    }
  }

  // ── Password change ─────────────────────────────────────────────────────────
  async function changePassword(e) {
    e.preventDefault();
    if (newPw !== confirmPw) { showToast('Passwords do not match', 'error'); return; }
    if (newPw.length < 8)    { showToast('Password must be at least 8 characters', 'error'); return; }
    setSavingPw(true);
    try {
      const res = await fetch('/account/change-password', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: currentPw, newPassword: newPw }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Change failed');
      showToast('Password updated');
      setCurrentPw(''); setNewPw(''); setConfirmPw('');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSavingPw(false);
    }
  }

  // ── Logo upload ─────────────────────────────────────────────────────────────
  async function uploadLogo(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingLogo(true);
    const form = new FormData();
    form.append('logo', file);
    try {
      const res = await fetch('/account/logo', {
        method: 'POST',
        credentials: 'include',
        body: form,
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Upload failed');
      const data = await res.json();
      setLogoUrl(data.logoUrl);
      showToast('Logo updated');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setUploadingLogo(false);
      if (logoInputRef.current) logoInputRef.current.value = '';
    }
  }

  async function deleteLogo() {
    try {
      const res = await fetch('/account/logo', { method: 'DELETE', credentials: 'include' });
      if (!res.ok) throw new Error('Delete failed');
      setLogoUrl(null);
      showToast('Logo removed');
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  // ── Team members ────────────────────────────────────────────────────────────
  async function addTeamMember(e) {
    e.preventDefault();
    if (!newEmail) return;
    setAddingMember(true);
    try {
      const res = await fetch('/account/team', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: newEmail, name: newName, role: newRole }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to add member');
      // API returns { message, member } — refetch full list
      const list = await fetch('/account/team', { credentials: 'include' }).then(r => r.json()).catch(() => []);
      setTeam(Array.isArray(list) ? list : []);
      setNewEmail(''); setNewMemberName(''); setNewRole('viewer');
      showToast('Team member added');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setAddingMember(false);
    }
  }

  async function removeTeamMember(memberId) {
    if (!confirm('Remove this team member?')) return;
    try {
      const res = await fetch(`/account/team/${memberId}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) throw new Error('Remove failed');
      // Refetch updated list
      const list = await fetch('/account/team', { credentials: 'include' }).then(r => r.json()).catch(() => []);
      setTeam(Array.isArray(list) ? list : []);
      showToast('Team member removed');
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  const inputClass = "w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent";
  const btnPrimary = "px-4 py-2 bg-brand text-white text-sm font-medium rounded-lg hover:bg-brand-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

  return (
    <div className="max-w-2xl">
      <PageHeader title="Account" subtitle="Manage your profile, connections, and team" />

      {/* ── Branding ─────────────────────────────────────────────────────────── */}
      <Section title="🖼️ Branding">
        <div className="flex items-center gap-4">
          <div className="w-20 h-20 rounded-lg border border-gray-200 bg-gray-50 flex items-center justify-center overflow-hidden flex-shrink-0">
            {logoUrl
              ? <img src={logoUrl} alt="Logo" className="w-full h-full object-contain p-1" />
              : <span className="text-xs text-gray-400 text-center px-1">No logo</span>
            }
          </div>
          <div className="space-y-2">
            <input type="file" ref={logoInputRef} accept="image/*" onChange={uploadLogo} className="hidden" />
            <button
              onClick={() => logoInputRef.current?.click()}
              disabled={uploadingLogo}
              className={btnPrimary}
            >
              {uploadingLogo ? 'Uploading…' : 'Upload Logo'}
            </button>
            {logoUrl && (
              <button onClick={deleteLogo} className="ml-2 text-sm text-red-600 hover:text-red-700">
                Remove
              </button>
            )}
            <p className="text-xs text-gray-400">PNG, JPG or SVG. Appears in the sidebar and reports.</p>
          </div>
        </div>
      </Section>

      {/* ── Profile ──────────────────────────────────────────────────────────── */}
      <Section title="👤 Profile">
        {loading ? (
          <div className="space-y-3">
            {[1,2,3].map(i => <div key={i} className="h-9 bg-gray-100 rounded-lg animate-pulse" />)}
          </div>
        ) : (
          <form onSubmit={saveProfile} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Email</label>
              <input value={profile?.email || ''} disabled className={`${inputClass} bg-gray-50 text-gray-500`} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Contact Name</label>
              <input value={contactName} onChange={e => setContactName(e.target.value)} className={inputClass} placeholder="Jane Smith" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Company Name</label>
              <input value={companyName} onChange={e => setCompanyName(e.target.value)} className={inputClass} placeholder="Acme Brands LLC" />
            </div>
            <div className="flex items-center gap-2 pt-1">
              <input
                type="checkbox"
                id="weekly-report"
                checked={weeklyReport}
                onChange={e => setWeeklyReport(e.target.checked)}
                className="w-4 h-4 text-brand rounded border-gray-300"
              />
              <label htmlFor="weekly-report" className="text-sm text-gray-600">Receive weekly performance email</label>
            </div>
            <button type="submit" disabled={savingProfile} className={btnPrimary}>
              {savingProfile ? 'Saving…' : 'Save Profile'}
            </button>
          </form>
        )}
      </Section>

      {/* ── Password ─────────────────────────────────────────────────────────── */}
      <Section title="🔒 Change Password">
        <form onSubmit={changePassword} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Current Password</label>
            <input type="password" value={currentPw} onChange={e => setCurrentPw(e.target.value)} className={inputClass} placeholder="••••••••" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">New Password</label>
            <input type="password" value={newPw} onChange={e => setNewPw(e.target.value)} className={inputClass} placeholder="••••••••" minLength={8} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Confirm New Password</label>
            <input type="password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)} className={inputClass} placeholder="••••••••" />
          </div>
          <button type="submit" disabled={savingPw || !currentPw || !newPw || !confirmPw} className={btnPrimary}>
            {savingPw ? 'Updating…' : 'Update Password'}
          </button>
        </form>
      </Section>

      {/* ── Amazon Connections ───────────────────────────────────────────────── */}
      <Section title="🔗 Amazon Connections">
        {loading ? (
          <div className="space-y-3">
            {[1,2,3,4].map(i => <div key={i} className="h-10 bg-gray-100 rounded animate-pulse" />)}
          </div>
        ) : (
          <div>
            <ConnectionBadge label="Advertising API (SP / SB / SD)" connected={connStatus?.ads?.connected}    connectedAt={connStatus?.ads?.connectedAt} />
            <ConnectionBadge label="DSP"                             connected={connStatus?.dsp?.connected}    connectedAt={connStatus?.dsp?.connectedAt} />
            <ConnectionBadge label="Vendor Central"                  connected={connStatus?.vendor?.connected} connectedAt={connStatus?.vendor?.connectedAt} />
            <ConnectionBadge label="Seller Central"                  connected={connStatus?.seller?.connected} connectedAt={connStatus?.seller?.connectedAt} />
            <div className="pt-3 mt-3 border-t border-gray-100 space-y-2">
              <ConnectButton label="Connect / Reconnect Advertising"    href="/amazon/connect/ads" />
              <ConnectButton label="Connect / Reconnect DSP"            href="/amazon/connect/dsp" />
              <ConnectButton label="Connect / Reconnect Vendor Central" href="/amazon/connect/vendor" />
              <ConnectButton label="Connect / Reconnect Seller Central" href="/amazon/connect/seller" />
            </div>
          </div>
        )}
      </Section>

      {/* ── Team Members ─────────────────────────────────────────────────────── */}
      <Section title="👥 Team Members">
        {team.length > 0 && (
          <div className="mb-4 divide-y divide-gray-100">
            {team.map(m => (
              <div key={m.id} className="flex items-center justify-between py-2.5">
                <div>
                  <p className="text-sm font-medium text-gray-800">{m.name || m.email}</p>
                  <p className="text-xs text-gray-400">{m.email} · <span className="capitalize">{m.role}</span></p>
                </div>
                <button onClick={() => removeTeamMember(m.id)} className="text-xs text-red-500 hover:text-red-700">
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
        <form onSubmit={addTeamMember} className="space-y-2 pt-2 border-t border-gray-100">
          <p className="text-xs font-medium text-gray-500 mb-2">Add team member</p>
          <div className="flex gap-2">
            <input value={newName}  onChange={e => setNewMemberName(e.target.value)} className={`${inputClass} flex-1`} placeholder="Name" />
            <input value={newEmail} onChange={e => setNewEmail(e.target.value)}      className={`${inputClass} flex-1`} placeholder="Email" type="email" required />
          </div>
          <div className="flex gap-2">
            <select value={newRole} onChange={e => setNewRole(e.target.value)} className={`${inputClass} flex-1`}>
              <option value="viewer">Viewer</option>
              <option value="analyst">Analyst</option>
              <option value="manager">Manager</option>
            </select>
            <button type="submit" disabled={addingMember || !newEmail} className={`${btnPrimary} flex-shrink-0`}>
              {addingMember ? 'Adding…' : 'Add'}
            </button>
          </div>
        </form>
      </Section>

      {/* ── Sign Out ─────────────────────────────────────────────────────────── */}
      <div className="pt-2">
        <a href="/auth/logout" className="text-sm text-red-600 hover:text-red-700 font-medium">
          Sign out
        </a>
      </div>

      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
      )}
    </div>
  );
}
