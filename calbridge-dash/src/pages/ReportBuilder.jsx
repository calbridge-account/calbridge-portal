/**
 * ReportBuilder.jsx
 * Full report builder embedded inside the React Layout shell.
 * Renders the /reports page content inline via iframe sized to fill the
 * main content area — same look & feel as the rest of /analytics/.
 * Gated to Pro+ plans; shows upgrade prompt for free/starter/growth.
 */
import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

function useplan() {
  const [plan, setPlan] = useState(null);
  useEffect(() => {
    fetch('/billing/status', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => setPlan(d?.plan || 'free'))
      .catch(() => setPlan('free'));
  }, []);
  return plan;
}

function UpgradeWall() {
  const navigate = useNavigate();
  return (
    <div className="flex flex-col items-center justify-center h-full py-24 px-6 text-center">
      <div className="text-5xl mb-4">📋</div>
      <h2 className="text-xl font-semibold text-gray-800 mb-2">Report Builder</h2>
      <p className="text-gray-500 mb-6 max-w-md">
        Build branded, multi-tab reports with drag-and-drop charts, KPI cards, and tables.
        Export to PDF or CSV. Available on <strong>Pro</strong> and <strong>Agency</strong> plans.
      </p>
      <button
        onClick={() => navigate('/pricing')}
        className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-full transition-colors text-sm"
      >
        Upgrade to Pro →
      </button>
    </div>
  );
}

export default function ReportBuilder() {
  const plan = useplan();
  const location = useLocation();
  const search = location.search || '';
  const src = `/reports${search}`;

  // Still loading plan
  if (plan === null) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400 text-sm">
        Loading…
      </div>
    );
  }

  // Gate: Pro and Agency only
  if (plan !== 'pro' && plan !== 'agency') {
    return <UpgradeWall />;
  }

  // Pro+: render builder iframe sized to fill the main content area
  // The iframe uses /reports which has its own sidebar — we hide that sidebar
  // via a ?embed=1 param and CSS so it feels native to /analytics/
  return (
    <div
      style={{
        margin: '-24px',           // undo Layout's p-6 padding so we go edge-to-edge
        height: 'calc(100vh - 56px)', // full height minus TopBar (56px)
        overflow: 'hidden',
      }}
    >
      <iframe
        src={`${src}${search ? '&' : '?'}embed=1`}
        title="Report Builder"
        style={{
          width: '100%',
          height: '100%',
          border: 'none',
          display: 'block',
        }}
        allowFullScreen
      />
    </div>
  );
}
