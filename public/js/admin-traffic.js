/**
 * admin-traffic.js
 * Traffic dashboard tab for Calbridge admin panel.
 * Loaded lazily when the Traffic tab is first clicked.
 * No inline scripts — loaded via <script src> tag in admin.html.
 */

(function () {
  'use strict';

  let trafficLoaded = false;

  // ─── Helpers ───────────────────────────────────────────────────────────────

  function fmt(n) {
    if (n == null) return '—';
    return n.toLocaleString();
  }

  function buildBarChart(containerId, items, labelKey, valueKey) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';

    if (!items || items.length === 0) {
      container.textContent = 'No data';
      return;
    }

    const max = Math.max(...items.map(i => i[valueKey] || 0), 1);

    items.forEach(item => {
      const val   = item[valueKey] || 0;
      const pct   = Math.round((val / max) * 100);
      const label = item[labelKey] || '';

      const col = document.createElement('div');
      col.className = 'bar-col';

      const valEl = document.createElement('div');
      valEl.className = 'bar-val';
      valEl.textContent = val > 0 ? val : '';

      const bar = document.createElement('div');
      bar.className = 'bar';
      bar.style.height = Math.max(pct, val > 0 ? 2 : 0) + '%';
      bar.title = `${label}: ${val}`;

      const labelEl = document.createElement('div');
      labelEl.className = 'bar-label';
      labelEl.textContent = label;

      col.appendChild(valEl);
      col.appendChild(bar);
      col.appendChild(labelEl);
      container.appendChild(col);
    });
  }

  function buildTable(tbodyId, rows, col1Key, col2Key) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    if (!rows || rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="2" class="loading-cell">No data</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(r => `
      <tr>
        <td style="font-family:monospace;font-size:12px;word-break:break-all">${escHtml(String(r[col1Key] || ''))}</td>
        <td style="text-align:right;font-weight:600">${fmt(r[col2Key])}</td>
      </tr>
    `).join('');
  }

  function escHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  // ─── Load data ─────────────────────────────────────────────────────────────

  async function loadTrafficData() {
    const loadingEl = document.getElementById('traffic-loading');
    const contentEl = document.getElementById('traffic-content');
    const errorEl   = document.getElementById('traffic-error');

    if (loadingEl) loadingEl.style.display = 'block';
    if (contentEl) contentEl.style.display = 'none';
    if (errorEl)   errorEl.style.display   = 'none';

    try {
      const resp = await fetch('/admin/traffic', { credentials: 'include' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();

      // ── KPI cards ──
      setText('kpi-visitors',    fmt(data.today?.uniqueVisitors));
      setText('kpi-pageviews',   fmt(data.today?.pageviews));
      setText('kpi-landing',     fmt(data.today?.landingPageViews));
      setText('kpi-signups',     fmt(data.today?.signups));
      setText('kpi-new-accounts', fmt(data.today?.newAccounts));
      setText('kpi-7d-visitors', fmt(data.last7days?.uniqueVisitors));
      setText('kpi-7d-pageviews',fmt(data.last7days?.pageviews));
      setText('kpi-30d-visitors',fmt(data.last30days?.uniqueVisitors));
      setText('kpi-30d-pageviews',fmt(data.last30days?.pageviews));

      // ── Domain breakdown ──
      const domains = [
        { key: 'calbridge.ai',       label: 'calbridge.ai',       id: 'domain-landing' },
        { key: 'app.calbridge.ai',   label: 'app.calbridge.ai',   id: 'domain-app' },
        { key: 'teamcalbridge.com',  label: 'teamcalbridge.com',  id: 'domain-team' },
      ];
      const byDomain = data.today?.byDomain || {};
      const domainEl = document.getElementById('traffic-by-domain');
      if (domainEl) {
        domainEl.innerHTML = domains.map(d => {
          const s = byDomain[d.key] || {};
          return '<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border:1px solid var(--gray-200);border-radius:8px;margin-bottom:8px;background:#fff">'
            + '<div style="font-weight:600;font-size:13px;color:var(--gray-800)">' + d.label + '</div>'
            + '<div style="display:flex;gap:20px;font-size:13px;color:var(--gray-600)">'
            + '<span><strong style="color:var(--gray-900)">' + fmt(s.uniqueVisitors || 0) + '</strong> visitors</span>'
            + '<span><strong style="color:var(--gray-900)">' + fmt(s.pageviews || 0) + '</strong> pageviews</span>'
            + '<span><strong style="color:#16a34a">' + fmt(s.signups || 0) + '</strong> signups</span>'
            + '</div></div>';
        }).join('');
      }

      // ── Charts ──
      buildBarChart('chart-hourly', data.today?.hourlyChart || [], 'hour', 'views');
      buildBarChart('chart-daily',  data.last7days?.dailyChart || [], 'date', 'views');

      // ── Tables ──
      buildTable('traffic-pages-body', data.today?.topPages     || [], 'page',     'views');
      buildTable('traffic-refs-body',  data.today?.topReferrers || [], 'referrer', 'visits');

      if (loadingEl) loadingEl.style.display = 'none';
      if (contentEl) contentEl.style.display = 'block';
    } catch (err) {
      if (loadingEl) loadingEl.style.display = 'none';
      if (errorEl) {
        errorEl.textContent = 'Failed to load traffic data: ' + err.message;
        errorEl.style.display = 'block';
      }
    }
  }

  // ─── Tab integration ───────────────────────────────────────────────────────

  function onTabClick(e) {
    const btn = e.target.closest('[data-tab]');
    if (!btn) return;
    if (btn.dataset.tab === 'traffic' && !trafficLoaded) {
      trafficLoaded = true;
      loadTrafficData();
    }
  }

  function bindRefreshButton() {
    const btn = document.getElementById('traffic-refresh-btn');
    if (btn) {
      btn.addEventListener('click', () => {
        trafficLoaded = true; // keep flag set, just re-fetch
        loadTrafficData();
      });
    }
  }

  // ─── Init ──────────────────────────────────────────────────────────────────

  function init() {
    // Hook into existing tab-switching mechanism (admin.js uses click on .admin-tabs)
    const tabContainer = document.querySelector('.admin-tabs');
    if (tabContainer) {
      tabContainer.addEventListener('click', onTabClick);
    }
    bindRefreshButton();

    // If traffic tab is already active on load (e.g. deep link), load immediately
    const trafficSection = document.getElementById('tab-traffic');
    if (trafficSection && trafficSection.classList.contains('active')) {
      trafficLoaded = true;
      loadTrafficData();
    }
  }

  // Expose globally so admin.js tab handler can call it
  window.loadTrafficData = loadTrafficData;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
