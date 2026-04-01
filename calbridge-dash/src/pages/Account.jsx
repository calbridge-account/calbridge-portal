import { useState, useEffect } from 'react';
import PageHeader from '../components/PageHeader';

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

export default function Account() {
  const [status, setStatus] = useState(null);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch('/amazon/status', { credentials: 'include' }).then(r => r.json()).catch(() => null),
      fetch('/auth/me', { credentials: 'include' }).then(r => r.json()).catch(() => null),
    ]).then(([amazonStatus, me]) => {
      setStatus(amazonStatus);
      setUser(me?.client);
      setLoading(false);
    });
  }, []);

  return (
    <div className="max-w-2xl">
      <PageHeader
        title="Account"
        subtitle="Manage your connections and settings"
      />

      {/* Profile */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">Profile</h2>
        {loading ? (
          <div className="h-8 bg-gray-100 rounded animate-pulse w-48" />
        ) : (
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Email</span>
              <span className="font-medium text-gray-800">{user?.email || '—'}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Account</span>
              <span className="font-medium text-gray-800">{user?.name || '—'}</span>
            </div>
          </div>
        )}
      </div>

      {/* Amazon Connections */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">Amazon Connections</h2>
        {loading ? (
          <div className="space-y-3">
            {[1,2,3,4].map(i => <div key={i} className="h-10 bg-gray-100 rounded animate-pulse" />)}
          </div>
        ) : (
          <div>
            <ConnectionBadge
              label="Advertising API (SP/SB/SD)"
              connected={status?.ads?.connected}
              connectedAt={status?.ads?.connectedAt}
            />
            <ConnectionBadge
              label="DSP"
              connected={status?.dsp?.connected}
              connectedAt={status?.dsp?.connectedAt}
            />
            <ConnectionBadge
              label="Vendor Central"
              connected={status?.vendor?.connected}
              connectedAt={status?.vendor?.connectedAt}
            />
            <ConnectionBadge
              label="Seller Central"
              connected={status?.seller?.connected}
              connectedAt={status?.seller?.connectedAt}
            />
          </div>
        )}
      </div>

      {/* Connect / Reconnect */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">Connect or Reconnect</h2>
        <div className="space-y-2">
          <ConnectButton label="Connect Advertising (SP/SB/SD)" href="/amazon/connect/ads" />
          <ConnectButton label="Connect DSP" href="/amazon/connect/dsp" />
          <ConnectButton label="Connect Vendor Central" href="/amazon/connect/vendor" />
          <ConnectButton label="Connect Seller Central" href="/amazon/connect/seller" />
        </div>
      </div>

      {/* Legacy portal link */}
      <div className="bg-gray-50 rounded-xl border border-gray-200 p-5 mb-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-1">Advanced Tools</h2>
        <p className="text-xs text-gray-500 mb-3">Campaign management, contribution margin analysis, and budget pacing.</p>
        <a
          href="/dashboard.html"
          className="inline-flex items-center gap-2 text-sm font-medium text-brand hover:text-brand-dark"
        >
          Open legacy portal
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </a>
      </div>

      {/* Sign out */}
      <div className="pt-2">
        <a
          href="/auth/logout"
          className="text-sm text-red-600 hover:text-red-700 font-medium"
        >
          Sign out
        </a>
      </div>
    </div>
  );
}
