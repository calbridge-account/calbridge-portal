/**
 * public/js/reports-preview.js
 * Clean print-ready preview page — used by Puppeteer for PDF generation.
 * Renders each tab as a 1280×720 .report-page div, then sets window.__reportReady = true.
 */
(function () {
  'use strict';

  const COLS = 24, ROWS = 13;
  const CANVAS_W = 1280, CANVAS_H = 720;
  const cellW = CANVAS_W / COLS;
  const cellH = CANVAS_H / ROWS;

  function gridToPos(grid) {
    return {
      left:   grid.x * cellW,
      top:    grid.y * cellH,
      width:  grid.w * cellW,
      height: grid.h * cellH,
    };
  }

  function fmt$(v) {
    if (v == null || isNaN(v)) return '—';
    return '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmtPct(v) { return v == null ? '—' : (Number(v) * 100).toFixed(1) + '%'; }
  function fmtNum(v) { return v == null ? '—' : Number(v).toLocaleString(); }

  const METRIC_LABELS = {
    spend: 'Total Spend', sales: 'Total Sales', acos: 'ACoS', roas: 'ROAS',
    impressions: 'Impressions', clicks: 'Clicks', orders: 'Orders',
    total_budget: 'Total Budget', total_spend: 'Total Spend', avg_pacing: 'Avg Pacing',
    total_revenue: 'Total Revenue', total_units: 'Total Units',
  };

  function formatMetric(metric, val) {
    if (val == null) return '—';
    if (['spend','sales','total_budget','total_spend','total_revenue'].includes(metric)) return fmt$(val);
    if (['acos','avg_pacing'].includes(metric)) return fmtPct(val);
    if (metric === 'roas') return Number(val).toFixed(2) + 'x';
    return fmtNum(val);
  }

  async function fetchData(source, params, token) {
    const qs = new URLSearchParams(params);
    if (token) qs.set('token', token);
    try {
      const r = await fetch(`/api/report-builder/data/${source}?${qs}`, { credentials: 'include' });
      if (!r.ok) return [];
      return r.json();
    } catch { return []; }
  }

  async function renderBlock(block, containerEl, globalFilters, tabFilters, token) {
    const pos = gridToPos(block.grid);
    const el = document.createElement('div');
    el.className = 'preview-block';
    el.style.left   = pos.left   + 'px';
    el.style.top    = pos.top    + 'px';
    el.style.width  = pos.width  + 'px';
    el.style.height = pos.height + 'px';
    el.style.position = 'absolute';
    el.style.overflow = 'hidden';
    containerEl.appendChild(el);

    // Merge filters: global → tab → block
    const merged = Object.assign({}, globalFilters || {}, tabFilters || {}, block.filters || {});
    const p = {
      startDate:   merged.startDate   || merged.start_date   || '',
      endDate:     merged.endDate     || merged.end_date     || '',
      marketplace: merged.marketplace || 'US',
      limit:       block.limit || 50,
    };
    if (merged.adType && Array.isArray(merged.adType)) p.adType = merged.adType.join(',');

    if (block.type === 'text') {
      el.innerHTML = `<div class="preview-text">${block.content || ''}</div>`;
      return;
    }

    if (block.type === 'kpi') {
      const metric = block.metric || 'spend';
      const rows = await fetchData(block.source || 'ad_performance', p, token);
      let val = null;
      if (rows && rows.length) {
        const k = (r, key) => Number(r[key] || r[key.toUpperCase()] || 0);
        if (['spend','sales','impressions','clicks','orders'].includes(metric)) {
          val = rows.reduce((s, r) => s + k(r, metric), 0);
        } else if (metric === 'acos') {
          const ts = rows.reduce((s,r)=>s+k(r,'spend'),0);
          const tv = rows.reduce((s,r)=>s+k(r,'sales'),0);
          val = tv > 0 ? ts/tv : null;
        } else if (metric === 'roas') {
          const ts = rows.reduce((s,r)=>s+k(r,'spend'),0);
          const tv = rows.reduce((s,r)=>s+k(r,'sales'),0);
          val = ts > 0 ? tv/ts : null;
        }
      }
      el.innerHTML = `
        <div class="preview-kpi">
          <div class="preview-kpi-label">${METRIC_LABELS[metric] || metric}</div>
          <div class="preview-kpi-value">${formatMetric(metric, val)}</div>
        </div>`;
      return;
    }

    if (block.type === 'bar_chart' || block.type === 'line_chart') {
      const rows = await fetchData(block.source || 'ad_performance', p, token);
      const canvas = document.createElement('canvas');
      canvas.style.width  = pos.width  + 'px';
      canvas.style.height = pos.height + 'px';
      el.appendChild(canvas);
      if (!rows || !rows.length) { el.innerHTML = '<div class="preview-empty">No data</div>'; return; }

      const labels = rows.map(r => r.date || r.DATE || r.ad_type || r.AD_TYPE || r.campaign_name || r.CAMPAIGN_NAME || '');
      const values = rows.map(r => Number(r.spend || r.SPEND || r.ordered_revenue || r.ORDERED_REVENUE || 0));
      const primary = (window.__reportBrandColor) || '#2d5a27';

      if (typeof Chart !== 'undefined') {
        new Chart(canvas, {
          type: block.type === 'line_chart' ? 'line' : 'bar',
          data: {
            labels,
            datasets: [{
              label: 'Value',
              data: values,
              backgroundColor: primary + 'aa',
              borderColor: primary,
              borderWidth: 1,
              fill: block.type === 'line_chart',
            }],
          },
          options: {
            responsive: false,
            animation: false,
            plugins: { legend: { display: false } },
            scales: { y: { ticks: { callback: v => '$' + Number(v).toLocaleString() } } },
          },
        });
      }
      return;
    }

    if (block.type === 'table') {
      const rows = await fetchData(block.source || 'campaigns', p, token);
      if (!rows || !rows.length) { el.innerHTML = '<div class="preview-empty">No data</div>'; return; }
      const cols = block.columns || Object.keys(rows[0]).map(k => k.toLowerCase()).slice(0, 6);
      let html = '<div class="preview-table-wrap"><table class="preview-table"><thead><tr>';
      cols.forEach(c => { html += `<th>${c.replace(/_/g,' ')}</th>`; });
      html += '</tr></thead><tbody>';
      rows.slice(0, block.limit || 30).forEach(row => {
        html += '<tr>';
        cols.forEach(c => {
          const v = row[c] ?? row[c.toUpperCase()] ?? '—';
          html += `<td>${typeof v === 'number' ? v.toLocaleString(undefined,{maximumFractionDigits:2}) : v}</td>`;
        });
        html += '</tr>';
      });
      html += '</tbody></table></div>';
      el.innerHTML = html;
      return;
    }
  }

  async function renderTab(tab, globalFilters, brand, token, showFooter) {
    const page = document.createElement('div');
    page.className = 'report-page';

    // Brand header bar
    const color = (brand && brand.primaryColor) || '#2d5a27';
    window.__reportBrandColor = color;
    const header = document.createElement('div');
    header.className = 'preview-header';
    header.style.background = color;
    header.style.color = '#fff';
    header.style.padding = '8px 20px';
    header.style.fontSize = '14px';
    header.style.fontWeight = '600';
    header.textContent = tab.name || '';
    page.appendChild(header);

    const canvas = document.createElement('div');
    canvas.className = 'preview-canvas';
    canvas.style.position = 'relative';
    canvas.style.width  = CANVAS_W + 'px';
    canvas.style.height = (CANVAS_H - 40 - (showFooter ? 24 : 0)) + 'px';
    canvas.style.overflow = 'hidden';
    page.appendChild(canvas);

    // Render all blocks in parallel
    await Promise.all((tab.blocks || []).map(block =>
      renderBlock(block, canvas, globalFilters, tab.filters || {}, token)
    ));

    // Footer
    if (showFooter && brand && brand.footerText) {
      const footer = document.createElement('div');
      footer.className = 'preview-footer';
      footer.style.background = '#f3f4f6';
      footer.style.borderTop  = '1px solid #e5e7eb';
      footer.style.padding    = '4px 20px';
      footer.style.fontSize   = '11px';
      footer.style.color      = '#6b7280';
      footer.textContent      = brand.footerText;
      page.appendChild(footer);
    }

    return page;
  }

  async function init() {
    const pathParts = window.location.pathname.split('/').filter(Boolean);
    const reportId  = pathParts[pathParts.length - 1];
    const params    = new URLSearchParams(window.location.search);
    const token     = params.get('token') || '';
    const tabParam  = params.get('tab');   // if set, render only that tab index

    // Fetch report config
    let report;
    try {
      const qs = token ? `?token=${encodeURIComponent(token)}` : '';
      const r  = await fetch(`/api/report-builder/reports/${reportId}${qs}`, { credentials: 'include' });
      if (!r.ok) throw new Error('Failed to load report: ' + r.status);
      report = await r.json();
    } catch (e) {
      document.getElementById('report-container').innerHTML = `<p style="padding:40px;color:red">${e.message}</p>`;
      window.__reportReady = true;
      return;
    }

    const brand       = report.brand_config || {};
    const globalF     = report.global_filters || {};
    const showFooter  = brand.showFooter !== false;
    const container   = document.getElementById('report-container');

    const tabs = report.tabs || [];
    const tabsToRender = tabParam !== null
      ? [tabs[parseInt(tabParam, 10)]].filter(Boolean)
      : tabs;

    for (const tab of tabsToRender) {
      const pageEl = await renderTab(tab, globalF, brand, token, showFooter);
      container.appendChild(pageEl);
    }

    // Signal Puppeteer
    window.__reportReady = true;
  }

  document.addEventListener('DOMContentLoaded', init);
})();
