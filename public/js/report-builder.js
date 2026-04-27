/**
 * public/js/report-builder.js
 * Power BI-style Report Builder — full state machine
 */
(function () {
  'use strict';

  // ─── Grid constants ─────────────────────────────────────────────────────────
  const COLS = 24, ROWS = 13;
  const CANVAS_W = 1280, CANVAS_H = 720;
  const cellW = CANVAS_W / COLS;   // 53.33px
  const cellH = CANVAS_H / ROWS;   // 55.38px

  // ─── State ───────────────────────────────────────────────────────────────────
  const state = {
    report: null,
    currentTabIdx: 0,
    selectedBlockId: null,
    templates: [],
    reports: [],
    dirty: false,
  };

  // ─── Source → available fields ───────────────────────────────────────────────
  const SOURCE_FIELDS = {
    ad_performance: {
      dimensions: ['date', 'ad_type', 'marketplace'],
      metrics: ['spend', 'sales', 'impressions', 'clicks', 'orders', 'acos', 'roas'],
    },
    campaigns: {
      dimensions: ['campaign_name', 'ad_type', 'date'],
      metrics: ['spend', 'sales', 'impressions', 'clicks', 'orders', 'acos', 'roas'],
    },
    vendor_sales: {
      dimensions: ['date'],
      metrics: ['ordered_revenue', 'units_ordered'],
    },
    seller_sales: {
      dimensions: ['date'],
      metrics: ['ordered_revenue', 'units_ordered'],
    },
    budget_pacing: {
      dimensions: ['campaign_name', 'ad_type'],
      metrics: ['monthly_budget', 'spend_to_date', 'pacing_pct', 'days_elapsed', 'days_in_month'],
    },
    inventory: {
      dimensions: ['asin'],
      metrics: ['sellable_units', 'open_po_units', 'weeks_of_cover'],
    },
    forecasting: {
      dimensions: ['asin', 'title'],
      metrics: ['mean_units', 'p70', 'p80', 'p90'],
    },
  };

  // ─── Helpers ─────────────────────────────────────────────────────────────────
  function fmt$(v) {
    if (v == null || isNaN(v)) return '—';
    return '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmtPct(v) {
    if (v == null || isNaN(v)) return '—';
    return (Number(v) * 100).toFixed(1) + '%';
  }
  function fmtNum(v) {
    if (v == null || isNaN(v)) return '—';
    return Number(v).toLocaleString();
  }
  function fmtROAS(v) {
    if (v == null || isNaN(v)) return '—';
    return Number(v).toFixed(2) + 'x';
  }

  const METRIC_LABELS = {
    spend: 'Total Spend', sales: 'Total Sales', acos: 'ACoS', roas: 'ROAS',
    impressions: 'Impressions', clicks: 'Clicks', orders: 'Orders',
    total_budget: 'Total Budget', total_spend: 'Total Spend', avg_pacing: 'Avg Pacing',
    total_revenue: 'Total Revenue', total_units: 'Total Units',
    ordered_revenue: 'Ordered Revenue', units_ordered: 'Units Ordered',
    monthly_budget: 'Monthly Budget', spend_to_date: 'Spend to Date',
    pacing_pct: 'Pacing %', days_elapsed: 'Days Elapsed', days_in_month: 'Days in Month',
    sellable_units: 'Sellable Units', open_po_units: 'Open PO Units', weeks_of_cover: 'Weeks of Cover',
    mean_units: 'Mean Units', p70: 'P70', p80: 'P80', p90: 'P90',
  };

  const KPI_METRICS = [
    'spend','sales','acos','roas','impressions','clicks','orders',
    'total_budget','total_spend','avg_pacing','total_revenue','total_units',
  ];

  function formatMetricValue(metric, val, format) {
    if (val == null) return '—';
    // Use explicit format if provided
    if (format === 'currency') return fmt$(val);
    if (format === 'percent')  return fmtPct(val);
    if (format === 'roas')     return fmtROAS(val);
    if (format === 'number')   return fmtNum(val);
    // Fallback to metric-name inference
    if (['spend','sales','total_budget','total_spend','total_revenue','ordered_revenue','monthly_budget','spend_to_date'].includes(metric)) return fmt$(val);
    if (['acos','avg_pacing','pacing_pct'].includes(metric)) return fmtPct(val);
    if (['roas'].includes(metric)) return fmtROAS(val);
    return fmtNum(val);
  }

  function getDateRange() {
    const s = document.getElementById('global-start-date').value;
    const e = document.getElementById('global-end-date').value;
    return { startDate: s, endDate: e };
  }

  function getMarketplace() {
    return document.getElementById('global-marketplace').value || 'US';
  }

  function currentTab() {
    return state.report && state.report.tabs ? state.report.tabs[state.currentTabIdx] : null;
  }

  function blockById(blockId) {
    const tab = currentTab();
    if (!tab) return null;
    return tab.blocks.find(b => b.blockId === blockId) || null;
  }

  function gridToPos(grid) {
    return {
      left:   grid.x * cellW,
      top:    grid.y * cellH,
      width:  grid.w * cellW,
      height: grid.h * cellH,
    };
  }

  function posToGrid(left, top, width, height) {
    return {
      x: Math.max(0, Math.min(COLS - 1, Math.round(left / cellW))),
      y: Math.max(0, Math.min(ROWS - 1, Math.round(top  / cellH))),
      w: Math.max(1, Math.min(COLS,      Math.round(width  / cellW))),
      h: Math.max(1, Math.min(ROWS,      Math.round(height / cellH))),
    };
  }

  // ─── Defaults ─────────────────────────────────────────────────────────────────
  function defaultReport() {
    return {
      report_id: null,
      name: 'Untitled Report',
      global_filters: {},
      tabs: [{
        tabId: 'tab-' + Date.now(),
        name: 'Tab 1',
        filters: {},
        pageFilters: {},
        blocks: [],
      }],
      brand_config: {
        primaryColor: '#2d5a27',
        showFooter: true,
        footerText: 'Prepared by Calbridge',
      },
    };
  }

  function blockDefaults(type) {
    const id = 'b-' + Date.now();
    if (type === 'kpi') {
      return { blockId: id, type, metric: 'spend', aggregation: 'sum', format: 'currency', grid: { x: 0, y: 0, w: 6, h: 3 } };
    }
    if (type === 'bar_chart') {
      return { blockId: id, type, source: 'ad_performance', groupBy: 'ad_type', metrics: ['spend'], chartColor: '#2d5a27', grid: { x: 0, y: 0, w: 12, h: 8 } };
    }
    if (type === 'line_chart') {
      return { blockId: id, type, source: 'ad_performance', groupBy: 'date', metrics: ['spend'], chartColor: '#2d5a27', grid: { x: 0, y: 0, w: 12, h: 8 } };
    }
    if (type === 'table') {
      return { blockId: id, type, source: 'campaigns', columns: ['campaign_name', 'spend', 'sales', 'acos'], sortCol: '', sortDir: 'desc', limit: 20, showTotals: false, grid: { x: 0, y: 0, w: 16, h: 9 } };
    }
    if (type === 'text') {
      return { blockId: id, type, content: 'Click to edit text', fontSize: 14, bold: false, textColor: '#1a1a1a', bgColor: '#ffffff', align: 'left', grid: { x: 0, y: 0, w: 8, h: 3 } };
    }
    if (type === 'image') {
      return { blockId: id, type, imageUrl: null, objectFit: 'contain', bgColor: '#ffffff', grid: { x: 0, y: 0, w: 8, h: 5 } };
    }
    return { blockId: id, type, grid: { x: 0, y: 0, w: 8, h: 5 } };
  }

  // ─── API helpers ─────────────────────────────────────────────────────────────
  async function api(method, path, body) {
    const opts = { method, credentials: 'include', headers: {} };
    if (body) { opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; }
    const r = await fetch(path, opts);
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  }

  // Apply filters to a row array (client-side filtering).
  // pageFilters are applied first; blockFilters take precedence for same dimension.
  function applyBlockFilters(rows, blockFilterValues, pageFilterValues) {
    // Merge: page filters as base, block filters override per-dimension
    const merged = {};
    if (pageFilterValues) {
      Object.entries(pageFilterValues).forEach(([dim, vals]) => {
        if (vals && vals.length) merged[dim] = vals;
      });
    }
    if (blockFilterValues) {
      Object.entries(blockFilterValues).forEach(([dim, vals]) => {
        if (vals && vals.length) merged[dim] = vals; // block takes precedence
      });
    }
    if (!Object.keys(merged).length) return rows;
    return rows.filter(row => {
      return Object.entries(merged).every(([dim, vals]) => {
        if (!vals || !vals.length) return true;
        const v = row[dim] || row[dim.toUpperCase()] || '';
        return vals.includes(String(v));
      });
    });
  }

  async function fetchData(source, extraParams) {
    const { startDate, endDate } = getDateRange();
    const marketplace = getMarketplace();
    const tab = currentTab();
    const adType = (tab && tab.filters && tab.filters.adType) ? tab.filters.adType.join(',') : '';
    const params = new URLSearchParams({ startDate, endDate, marketplace, limit: 50 });
    if (adType) params.set('adType', adType);
    if (extraParams) Object.entries(extraParams).forEach(([k, v]) => params.set(k, v));
    try {
      const r = await fetch(`/api/report-builder/data/${source}?${params}`, { credentials: 'include' });
      if (!r.ok) return [];
      return r.json();
    } catch { return []; }
  }

  // ─── Init ─────────────────────────────────────────────────────────────────────
  async function init() {
    if (new URLSearchParams(window.location.search).get('embed') === '1') {
      document.body.classList.add('embed-mode');
    }

    const now = new Date();
    const end = now.toISOString().substring(0, 10);
    const start = new Date(now); start.setDate(start.getDate() - 30);
    document.getElementById('global-start-date').value = start.toISOString().substring(0, 10);
    document.getElementById('global-end-date').value = end;

    const auth = await fetch('/analytics-auth', { credentials: 'include' }).then(r => r.json()).catch(() => ({ authenticated: false }));
    if (!auth.authenticated) { window.location.href = '/?redirect=/report-builder.html'; return; }

    [state.templates, state.reports] = await Promise.all([
      api('GET', '/api/report-builder/templates').catch(() => []),
      api('GET', '/api/report-builder/reports').catch(() => []),
    ]);

    renderReportsList();

    const params = new URLSearchParams(window.location.search);
    const rid = params.get('reportId');
    if (rid) {
      try {
        const report = await api('GET', `/api/report-builder/reports/${rid}`);
        loadReport(report);
        return;
      } catch { /* fall through */ }
    }

    showTemplateModal();
    wireEvents();
    updateScale();
    window.addEventListener('resize', updateScale);
  }

  // ─── Scale: just ensure canvas is natural size, wrapper scrolls ──────────────
  function updateScale() {
    const canvas = document.getElementById('report-canvas');
    if (canvas) {
      canvas.style.transform = '';
      canvas.style.width  = CANVAS_W + 'px';
      canvas.style.height = CANVAS_H + 'px';
    }
  }

  // ─── Load report ─────────────────────────────────────────────────────────────
  function loadReport(report) {
    state.report = JSON.parse(JSON.stringify(report));
    // Ensure every tab has pageFilters (backfill for old reports)
    (state.report.tabs || []).forEach(t => { if (!t.pageFilters) t.pageFilters = {}; });
    state.currentTabIdx = 0;
    state.selectedBlockId = null;
    state.dirty = false;
    // Reset filter panel wiring flag so it re-wires for new report
    const toggleBtn = document.getElementById('tab-filter-toggle');
    if (toggleBtn) delete toggleBtn.dataset.wired;
    const panel = document.getElementById('tab-filter-panel');
    if (panel) { panel.classList.add('hidden'); panel.innerHTML = ''; }
    document.getElementById('report-name').value = report.name || 'Untitled Report';
    applyBrandConfig(report.brand_config || {});
    renderAll();
    wireEvents();
    updateScale();
    window.addEventListener('resize', updateScale);
    if (report.report_id) {
      history.replaceState({}, '', `/report-builder.html?reportId=${report.report_id}`);
    }
  }

  function applyBrandConfig(cfg) {
    if (cfg.primaryColor) document.documentElement.style.setProperty('--brand-report', cfg.primaryColor);
    const col = document.getElementById('brand-color');
    if (col) col.value = cfg.primaryColor || '#2d5a27';
    const footer = document.getElementById('brand-footer-text');
    if (footer) footer.value = cfg.footerText || '';
    const showFooter = document.getElementById('brand-show-footer');
    if (showFooter) showFooter.checked = cfg.showFooter !== false;
  }

  // ─── Render all ─────────────────────────────────────────────────────────────
  function renderAll() {
    renderTabs();
    renderCanvas();
    updateTabFilters();
  }

  // ─── Tab bar ─────────────────────────────────────────────────────────────────
  function renderTabs() {
    if (!state.report) return;
    const container = document.getElementById('tabs-container');
    container.innerHTML = '';
    state.report.tabs.forEach((tab, idx) => {
      const btn = document.createElement('div');
      btn.className = 'tab-btn' + (idx === state.currentTabIdx ? ' active' : '');
      btn.dataset.idx = idx;
      btn.innerHTML = `<span class="tab-label" data-idx="${idx}">${tab.name}</span>
        <span class="tab-close" data-idx="${idx}">×</span>`;
      container.appendChild(btn);
      btn.querySelector('.tab-label').addEventListener('click', () => switchTab(idx));
      btn.querySelector('.tab-label').addEventListener('dblclick', () => renameTab(idx));
      btn.querySelector('.tab-close').addEventListener('click', (e) => { e.stopPropagation(); removeTab(idx); });
    });
  }

  function switchTab(idx) {
    state.currentTabIdx = idx;
    state.selectedBlockId = null;
    // Close and reset the filter panel so it reloads for the new tab
    const panel = document.getElementById('tab-filter-panel');
    if (panel) { panel.classList.add('hidden'); panel.innerHTML = ''; }
    renderTabs();
    renderCanvas();
    updateTabFilters();
    showBlockSettings(null);
  }

  function renameTab(idx) {
    const tab = state.report.tabs[idx];
    const newName = prompt('Tab name:', tab.name);
    if (newName && newName.trim()) {
      tab.name = newName.trim();
      renderTabs();
      state.dirty = true;
    }
  }

  function addTab() {
    if (!state.report) return;
    const idx = state.report.tabs.length + 1;
    state.report.tabs.push({
      tabId: 'tab-' + Date.now(),
      name: 'Tab ' + idx,
      filters: {},
      pageFilters: {},
      blocks: [],
    });
    state.currentTabIdx = state.report.tabs.length - 1;
    renderAll();
    state.dirty = true;
  }

  function removeTab(idx) {
    if (state.report.tabs.length === 1) { alert('Report must have at least one tab.'); return; }
    if (!confirm('Remove this tab?')) return;
    state.report.tabs.splice(idx, 1);
    if (state.currentTabIdx >= state.report.tabs.length) state.currentTabIdx = state.report.tabs.length - 1;
    renderAll();
    state.dirty = true;
  }

  // ─── Page-level filter bar ─────────────────────────────────────────────────────
  // Cache for page filter bar values (separate from block-level cache)
  const _pageFilterCache = {};

  function renderPageFilterBar() {
    const tab = currentTab();
    if (!tab) return;

    const toggleBtn = document.getElementById('tab-filter-toggle');
    const panel     = document.getElementById('tab-filter-panel');
    const countEl   = document.getElementById('tab-filter-count');
    if (!toggleBtn || !panel) return;

    // Ensure pageFilters exists
    if (!tab.pageFilters) tab.pageFilters = {};

    // Collect all unique dimensions across all blocks on this tab
    const dimSet = new Set();
    (tab.blocks || []).forEach(block => {
      const sf = SOURCE_FIELDS[block.source || ''];
      if (!sf) return;
      sf.dimensions.filter(d => d !== 'date').forEach(d => dimSet.add(JSON.stringify({ source: block.source, dim: d })));
    });

    // Build a unique list of {source, dim} pairs — deduplicate by dim name (prefer first source found)
    const dimMap = new Map(); // dim -> source
    (tab.blocks || []).forEach(block => {
      const sf = SOURCE_FIELDS[block.source || ''];
      if (!sf) return;
      sf.dimensions.filter(d => d !== 'date').forEach(d => {
        if (!dimMap.has(d)) dimMap.set(d, block.source);
      });
    });

    // Update the active-filter count badge
    const activeCount = Object.values(tab.pageFilters)
      .filter(arr => arr && arr.length > 0).length;
    countEl.textContent = activeCount > 0 ? String(activeCount) : '';

    // Wire the toggle button (idempotent — use a flag to avoid duplicate listeners)
    if (!toggleBtn.dataset.wired) {
      toggleBtn.dataset.wired = '1';
      toggleBtn.addEventListener('click', () => {
        const isOpen = panel.classList.toggle('hidden') === false;
        const countSpan = document.getElementById('tab-filter-count');
        const ac = Object.values(currentTab()?.pageFilters || {}).filter(a => a && a.length).length;
        const arrow = isOpen ? '🔼' : '🔽';
        toggleBtn.childNodes[0].textContent = arrow + ' Page Filters ';
        if (countSpan) countSpan.textContent = ac > 0 ? String(ac) : '';
        if (isOpen) {
          const t = currentTab();
          // Rebuild dimMap for current tab
          const dm = new Map();
          (t && t.blocks || []).forEach(b => {
            const sf2 = SOURCE_FIELDS[b.source || ''];
            if (!sf2) return;
            sf2.dimensions.filter(d => d !== 'date').forEach(d => { if (!dm.has(d)) dm.set(d, b.source); });
          });
          populatePageFilterPanel(t, dm, panel);
        }
      });
    }

    // If panel is already open, refresh it
    if (!panel.classList.contains('hidden')) {
      populatePageFilterPanel(tab, dimMap, panel);
    }
  }

  async function populatePageFilterPanel(tab, dimMap, panel) {
    panel.innerHTML = '';
    if (dimMap.size === 0) {
      panel.innerHTML = '<span style="font-size:12px;color:var(--gray-400)">No filterable dimensions on this tab</span>';
      return;
    }

    for (const [dim, source] of dimMap) {
      const group = document.createElement('div');
      group.className = 'filter-group';

      const selected = (tab.pageFilters && tab.pageFilters[dim]) || [];
      const badge = selected.length ? `<span class="filter-count-badge">${selected.length}</span>` : '';
      const header = document.createElement('div');
      header.className = 'filter-group-header';
      header.dataset.dim = dim;
      header.innerHTML = `<span>${(METRIC_LABELS[dim] || dim).replace(/_/g, ' ')}</span>${badge}`;
      group.appendChild(header);

      const search = document.createElement('input');
      search.type = 'text';
      search.className = 'filter-search';
      search.placeholder = 'Search…';
      group.appendChild(search);

      const valueList = document.createElement('div');
      valueList.className = 'filter-value-list';
      valueList.innerHTML = '<span style="font-size:11px;color:var(--gray-400)">Loading…</span>';
      group.appendChild(valueList);

      panel.appendChild(group);

      // Load values async
      const cacheKey = `pf:${source}:${dim}`;
      let vals;
      if (_pageFilterCache[cacheKey]) {
        vals = _pageFilterCache[cacheKey];
      } else {
        try {
          const rows = await fetchData(source, { limit: 500 });
          vals = [...new Set(rows.map(r => r[dim] || r[dim.toUpperCase()] || '').filter(Boolean))].sort();
          _pageFilterCache[cacheKey] = vals;
        } catch { vals = []; }
      }

      function renderValueList(filter) {
        const filtered = filter
          ? vals.filter(v => v.toLowerCase().includes(filter.toLowerCase()))
          : vals;
        valueList.innerHTML = '';
        if (!filtered.length) {
          valueList.innerHTML = '<span style="font-size:11px;color:var(--gray-400)">No values</span>';
          return;
        }
        const sel = (tab.pageFilters && tab.pageFilters[dim]) || [];
        filtered.forEach(v => {
          const chip = document.createElement('label');
          chip.className = 'filter-chip' + (sel.includes(v) ? ' active' : '');
          chip.innerHTML = `<input type="checkbox" ${sel.includes(v) ? 'checked' : ''}><span>${v}</span>`;
          const cb = chip.querySelector('input');
          cb.addEventListener('change', () => {
            if (!tab.pageFilters) tab.pageFilters = {};
            if (!tab.pageFilters[dim]) tab.pageFilters[dim] = [];
            if (cb.checked) {
              if (!tab.pageFilters[dim].includes(v)) tab.pageFilters[dim].push(v);
              chip.classList.add('active');
            } else {
              tab.pageFilters[dim] = tab.pageFilters[dim].filter(x => x !== v);
              chip.classList.remove('active');
            }
            state.dirty = true;
            // Update badge in group header
            const selNow = (tab.pageFilters[dim] || []).length;
            const hdr = group.querySelector('.filter-group-header');
            const existBadge = hdr.querySelector('.filter-count-badge');
            if (selNow > 0) {
              if (existBadge) existBadge.textContent = selNow;
              else hdr.insertAdjacentHTML('beforeend', `<span class="filter-count-badge">${selNow}</span>`);
            } else {
              if (existBadge) existBadge.remove();
            }
            // Update toggle button count
            const activeCount = Object.values(tab.pageFilters).filter(arr => arr && arr.length > 0).length;
            const countEl2 = document.getElementById('tab-filter-count');
            if (countEl2) countEl2.textContent = activeCount > 0 ? String(activeCount) : '';
            renderCanvas();
          });
          valueList.appendChild(chip);
        });
      }

      renderValueList('');

      search.addEventListener('input', () => renderValueList(search.value));
    }
  }

  function updateTabFilters() {
    renderPageFilterBar();
  }

  // ─── Canvas ──────────────────────────────────────────────────────────────────
  function renderCanvas() {
    const canvas = document.getElementById('report-canvas');
    canvas.innerHTML = '';
    canvas.style.width  = CANVAS_W + 'px';
    canvas.style.height = CANVAS_H + 'px';
    canvas.style.position = 'relative';

    const tab = currentTab();
    if (!tab) return;

    tab.blocks.forEach(block => {
      const el = createBlockEl(block);
      canvas.appendChild(el);
      renderBlockContent(block, el);
      setupInteract(block, el);
    });
  }

  function createBlockEl(block) {
    const pos = gridToPos(block.grid);
    const el = document.createElement('div');
    el.className = 'report-block block-type-' + block.type + (block.blockId === state.selectedBlockId ? ' selected' : '');
    el.dataset.blockId = block.blockId;
    el.style.left   = pos.left   + 'px';
    el.style.top    = pos.top    + 'px';
    el.style.width  = pos.width  + 'px';
    el.style.height = pos.height + 'px';
    el.style.position = 'absolute';

    const del = document.createElement('button');
    del.className = 'block-delete-btn';
    del.textContent = '×';
    del.title = 'Remove block';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      removeBlock(block.blockId);
    });
    el.appendChild(del);

    el.addEventListener('click', () => selectBlock(block.blockId));
    return el;
  }

  async function renderBlockContent(block, el) {
    const content = document.createElement('div');
    content.className = 'block-content';
    el.appendChild(content);

    if (block.type === 'image') {
      el.style.backgroundColor = block.bgColor || '#ffffff';
      if (block.imageUrl) {
        content.innerHTML = `<img src="${block.imageUrl}" class="block-image" style="object-fit:${block.objectFit||'contain'}" alt="">`;
      } else {
        content.innerHTML = `<div class="block-image-placeholder">🖼️<br><span>Click to upload image</span></div>`;
        content.querySelector('.block-image-placeholder').addEventListener('click', () => {
          selectBlock(block.blockId);
          switchRightPanel('block');
          setTimeout(() => document.getElementById('bs-image-file')?.click(), 50);
        });
      }
      return;
    }

    if (block.type === 'text') {
      const fs   = block.fontSize  || 14;
      const bold = block.bold      ? 'bold' : 'normal';
      const col  = block.textColor || '#1a1a1a';
      const bg   = block.bgColor   || 'transparent';
      const align = block.align   || 'left';
      el.style.backgroundColor = bg;
      content.innerHTML = `<div class="block-text" contenteditable="true"
        style="font-size:${fs}px;font-weight:${bold};color:${col};text-align:${align}">${block.content || 'Click to edit'}</div>`;
      content.querySelector('.block-text').addEventListener('blur', (e) => {
        block.content = e.target.innerHTML;
        state.dirty = true;
      });
      return;
    }

    if (block.type === 'kpi') {
      content.innerHTML = `<div class="kpi-loading">Loading…</div>`;
      const metric = block.metric || 'spend';
      const agg    = block.aggregation || 'sum';
      const format = block.format || null;
      let val = null;

      if (['total_budget','total_spend','avg_pacing'].includes(metric)) {
        const pRows = await fetchData('budget_pacing', {});
        if (pRows && pRows.length) {
          if (metric === 'total_budget')  val = pRows.reduce((s,r)=>s+Number(r.monthly_budget||r.MONTHLY_BUDGET||0),0);
          else if (metric === 'total_spend') val = pRows.reduce((s,r)=>s+Number(r.spend_to_date||r.SPEND_TO_DATE||0),0);
          else { const pacings = pRows.map(r=>Number(r.pacing_pct||r.PACING_PCT||0)).filter(n=>n>0); val = pacings.length ? pacings.reduce((a,b)=>a+b,0)/pacings.length : null; }
        }
      } else if (['total_revenue','total_units'].includes(metric)) {
        const vRows = await fetchData('vendor_sales', {});
        if (vRows && vRows.length) {
          if (metric === 'total_revenue') val = vRows.reduce((s,r)=>s+Number(r.ordered_revenue||r.ORDERED_REVENUE||0),0);
          else val = vRows.reduce((s,r)=>s+Number(r.units_ordered||r.UNITS_ORDERED||0),0);
        }
      } else {
        const rows = await fetchData('ad_performance', {});
        if (rows && rows.length) {
          if (metric === 'acos') {
            const ts = rows.reduce((s,r)=>s+Number(r.spend||r.SPEND||0),0);
            const tv = rows.reduce((s,r)=>s+Number(r.sales||r.SALES||0),0);
            val = tv > 0 ? ts / tv : null;
          } else if (metric === 'roas') {
            const ts = rows.reduce((s,r)=>s+Number(r.spend||r.SPEND||0),0);
            const tv = rows.reduce((s,r)=>s+Number(r.sales||r.SALES||0),0);
            val = ts > 0 ? tv / ts : null;
          } else {
            const key = metric.toLowerCase();
            if (agg === 'avg') {
              const vals = rows.map(r=>Number(r[key]||r[key.toUpperCase()]||0));
              val = vals.length ? vals.reduce((a,b)=>a+b,0)/vals.length : null;
            } else if (agg === 'last') {
              const last = rows[rows.length - 1];
              val = last ? Number(last[key]||last[key.toUpperCase()]||0) : null;
            } else {
              val = rows.reduce((s,r)=>s+Number(r[key]||r[key.toUpperCase()]||0),0);
            }
          }
        }
      }

      content.innerHTML = `
        <div class="kpi-block">
          <div class="kpi-label">${METRIC_LABELS[metric] || metric}</div>
          <div class="kpi-value">${formatMetricValue(metric, val, format)}</div>
        </div>`;
      return;
    }

    if (block.type === 'bar_chart' || block.type === 'line_chart') {
      content.innerHTML = '<div class="chart-title">' + (block.title || '') + '</div><div class="chart-wrap"><canvas class="chart-canvas"></canvas></div>';
      const canvas = content.querySelector('canvas');
      let rows = await fetchData(block.source || 'ad_performance', {});
      const _tabPF1 = (currentTab() && currentTab().pageFilters) || {};
      rows = applyBlockFilters(rows, block.filterValues, _tabPF1);
      if (!rows || !rows.length) { content.innerHTML = '<div class="block-empty">No data</div>'; return; }

      const groupBy  = block.groupBy || 'ad_type';
      const metrics  = (block.metrics && block.metrics.length) ? block.metrics : ['spend'];
      const primary  = block.chartColor || (state.report.brand_config && state.report.brand_config.primaryColor) || '#2d5a27';

      const labels = rows.map(r => r[groupBy] || r[groupBy.toUpperCase()] || r.date || r.DATE || '');

      const PALETTE = [primary, '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#14b8a6', '#f97316'];
      const datasets = metrics.map((m, i) => ({
        label: METRIC_LABELS[m] || m,
        data: rows.map(r => Number(r[m] || r[m.toUpperCase()] || 0)),
        backgroundColor: PALETTE[i % PALETTE.length] + (block.type === 'line_chart' ? '33' : 'aa'),
        borderColor: PALETTE[i % PALETTE.length],
        borderWidth: block.type === 'line_chart' ? 2 : 1,
        fill: block.type === 'line_chart',
        tension: 0.4,
      }));

      new Chart(canvas, {
        type: block.type === 'line_chart' ? 'line' : 'bar',
        data: { labels, datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: metrics.length > 1, position: 'top', labels: { font: { size: 10 } } } },
          scales: { y: { ticks: { callback: v => v >= 1000 ? '$' + (v/1000).toFixed(0) + 'k' : v.toLocaleString(), font: { size: 10 } }, grid: { color: '#f0f0f0' } }, x: { ticks: { font: { size: 10 } }, grid: { display: false } } },
        },
      });
      return;
    }

    if (block.type === 'table') {
      content.innerHTML = '<div class="table-loading">Loading…</div>';
      let rows = await fetchData(block.source || 'campaigns', { limit: 500 }); // fetch more, filter client-side
      const _tabPF2 = (currentTab() && currentTab().pageFilters) || {};
      rows = applyBlockFilters(rows, block.filterValues, _tabPF2);
      if (!rows || !rows.length) { content.innerHTML = '<div class="block-empty">No data</div>'; return; }
      const cols = block.columns || Object.keys(rows[0]).map(k => k.toLowerCase());

      // ── Rollup mode: aggregate rows when 'date' is not in columns ──
      const sf = SOURCE_FIELDS[block.source || 'campaigns'];
      const dimCols = cols.filter(c => sf && sf.dimensions.includes(c));
      const metCols = cols.filter(c => sf && sf.metrics.includes(c));
      let isRollup = false;
      if (!cols.includes('date') && dimCols.length && metCols.length) {
        isRollup = true;
        const grouped = new Map();
        rows.forEach(row => {
          const key = dimCols.map(d => String(row[d] || row[d.toUpperCase()] || '')).join('|');
          if (!grouped.has(key)) {
            const base = {};
            dimCols.forEach(d => { base[d] = row[d] || row[d.toUpperCase()] || ''; });
            metCols.forEach(m => { base[m] = 0; });
            grouped.set(key, base);
          }
          const g = grouped.get(key);
          metCols.forEach(m => { g[m] += Number(row[m] || row[m.toUpperCase()] || 0); });
        });
        rows = [...grouped.values()];
      }

      let data = rows.slice(0, block.limit || 20);
      if (block.sortCol && cols.includes(block.sortCol)) {
        data = [...data].sort((a, b) => {
          const av = a[block.sortCol] ?? a[block.sortCol.toUpperCase()];
          const bv = b[block.sortCol] ?? b[block.sortCol.toUpperCase()];
          return block.sortDir === 'asc' ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
        });
      }


      // Rollup badge above the table
      const rollupBadgeHtml = isRollup ? '<div style="padding:2px 6px 4px"><span class="rollup-badge">Σ Rolled up</span></div>' : '';
      let html = rollupBadgeHtml + '<div class="table-wrap"><table class="block-table"><thead><tr>';
      cols.forEach(c => { html += `<th>${(METRIC_LABELS[c] || c).replace(/_/g,' ')}</th>`; });
      html += '</tr></thead><tbody>';
      data.forEach(row => {
        html += '<tr>';
        cols.forEach(c => {
          const v = row[c] ?? row[c.toUpperCase()] ?? '—';
          html += `<td>${typeof v === 'number' ? v.toLocaleString(undefined, {maximumFractionDigits:2}) : v}</td>`;
        });
        html += '</tr>';
      });

      if (block.showTotals) {
        html += '<tr class="totals-row">';
        cols.forEach(c => {
          const nums = data.map(r => Number(r[c] ?? r[c.toUpperCase()] ?? NaN)).filter(n => !isNaN(n));
          html += `<td>${nums.length ? nums.reduce((a,b)=>a+b,0).toLocaleString(undefined,{maximumFractionDigits:2}) : '—'}</td>`;
        });
        html += '</tr>';
      }

      html += '</tbody></table></div>';
      content.innerHTML = html;
      return;
    }
  }

  // ─── interact.js drag + resize (no scale math) ───────────────────────────────
  function setupInteract(block, el) {
    if (typeof interact === 'undefined') return;

    interact(el)
      .draggable({
        listeners: {
          move(event) {
            const curLeft = parseFloat(el.style.left) || 0;
            const curTop  = parseFloat(el.style.top)  || 0;
            el.style.left = (curLeft + event.dx) + 'px';
            el.style.top  = (curTop  + event.dy) + 'px';
          },
          end(event) {
            const g = posToGrid(
              parseFloat(el.style.left), parseFloat(el.style.top),
              block.grid.w * cellW, block.grid.h * cellH
            );
            block.grid.x = g.x;
            block.grid.y = g.y;
            const snapped = gridToPos(block.grid);
            el.style.left = snapped.left + 'px';
            el.style.top  = snapped.top  + 'px';
            state.dirty = true;
          },
        },
      })
      .resizable({
        edges: { right: true, bottom: true },
        listeners: {
          move(event) {
            el.style.width  = event.rect.width  + 'px';
            el.style.height = event.rect.height + 'px';
          },
          end(event) {
            const pos = gridToPos(block.grid);
            const g = posToGrid(pos.left, pos.top, event.rect.width, event.rect.height);
            block.grid.w = Math.max(2, g.w);
            block.grid.h = Math.max(1, g.h);
            const snapped = gridToPos(block.grid);
            el.style.width  = snapped.width  + 'px';
            el.style.height = snapped.height + 'px';
            state.dirty = true;
            const contentEl = el.querySelector('.block-content');
            if (contentEl) { contentEl.remove(); renderBlockContent(block, el); }
          },
        },
      });
  }

  // ─── Block selection + settings ──────────────────────────────────────────────
  function selectBlock(blockId) {
    state.selectedBlockId = blockId;
    document.querySelectorAll('.report-block').forEach(el => {
      el.classList.toggle('selected', el.dataset.blockId === blockId);
    });
    const block = blockById(blockId);
    showBlockSettings(block);
    switchRightPanel('block');
  }

  function showBlockSettings(block) {
    const noSel = document.getElementById('no-block-selected');
    const form  = document.getElementById('block-settings-form');
    if (!block) {
      noSel.style.display = '';
      form.style.display = 'none';
      return;
    }
    noSel.style.display = 'none';
    form.style.display = '';
    form.innerHTML = renderBlockSettingsHTML(block);
    wireBlockSettingsEvents(block);
    // Async-populate filter value chips after render
    if (block.type === 'bar_chart' || block.type === 'line_chart' || block.type === 'table') {
      populateFilterValues(block);
    }
  }

  // ─── Filter value loader ───────────────────────────────────────────────────────
  const _filterValueCache = {};

  async function loadFilterValues(source, dimension) {
    const key = `${source}:${dimension}`;
    if (_filterValueCache[key]) return _filterValueCache[key];
    const { startDate, endDate } = getDateRange();
    try {
      const rows = await fetchData(source, { startDate, endDate, limit: 500 });
      const vals = [...new Set(rows.map(r => r[dimension] || r[dimension.toUpperCase()] || '').filter(Boolean))].sort();
      _filterValueCache[key] = vals;
      return vals;
    } catch { return []; }
  }

  function renderFilterSection(block) {
    const sf = SOURCE_FIELDS[block.source] || { dimensions: [] };
    const filterDims = sf.dimensions.filter(d => d !== 'date');
    if (!filterDims.length) return '';
    let html = `<div class="fw-section" id="fw-filters-section">
      <div class="fw-label">Filters <span class="fw-hint">(optional)</span></div>`;
    filterDims.forEach(dim => {
      html += `
        <div class="fw-filter-dim">
          <div class="fw-filter-label">${(METRIC_LABELS[dim]||dim).replace(/_/g,' ')}</div>
          <div class="fw-filter-values" data-dim="${dim}"><span class="fw-hint">Loading…</span></div>
        </div>`;
    });
    html += `</div>`;
    return html;
  }

  async function populateFilterValues(block) {
    const sf = SOURCE_FIELDS[block.source] || { dimensions: [] };
    const filterDims = sf.dimensions.filter(d => d !== 'date');
    for (const dim of filterDims) {
      const container = document.querySelector(`.fw-filter-values[data-dim="${dim}"]`);
      if (!container) continue;
      const vals = await loadFilterValues(block.source, dim);
      const selected = (block.filterValues && block.filterValues[dim]) || [];
      container.innerHTML = vals.length
        ? vals.map(v => `<label class="fw-filter-chip${selected.includes(v)?' active':''}" data-dim="${dim}" data-val="${v}">${v}</label>`).join('')
        : '<span class="fw-hint">No values</span>';
      container.querySelectorAll('.fw-filter-chip').forEach(chip => {
        chip.addEventListener('click', () => {
          const d = chip.dataset.dim, v = chip.dataset.val;
          if (!block.filterValues) block.filterValues = {};
          if (!block.filterValues[d]) block.filterValues[d] = [];
          const idx = block.filterValues[d].indexOf(v);
          if (idx === -1) { block.filterValues[d].push(v); chip.classList.add('active'); }
          else { block.filterValues[d].splice(idx, 1); chip.classList.remove('active'); }
          state.dirty = true;
          refreshBlockContent(block);
        });
      });
    }
  }

  // ─── Field well HTML ──────────────────────────────────────────────────────────
  function renderBlockSettingsHTML(block) {
    if (block.type === 'kpi') {
      const metricOpts = KPI_METRICS.map(v =>
        `<option value="${v}" ${block.metric === v ? 'selected' : ''}>${METRIC_LABELS[v] || v}</option>`).join('');
      const aggOpts = ['sum','avg','last'].map(v =>
        `<option value="${v}" ${(block.aggregation||'sum') === v ? 'selected' : ''}>${v.charAt(0).toUpperCase()+v.slice(1)}</option>`).join('');
      const fmtOpts = ['currency','percent','number','roas'].map(v =>
        `<option value="${v}" ${(block.format||'currency') === v ? 'selected' : ''}>${v.charAt(0).toUpperCase()+v.slice(1)}</option>`).join('');
      return `
        <div class="field-well">
          <div class="fw-section">
            <div class="fw-label">Metric</div>
            <select id="bs-metric">${metricOpts}</select>
          </div>
          <div class="fw-section">
            <div class="fw-label">Aggregation</div>
            <select id="bs-aggregation">${aggOpts}</select>
          </div>
          <div class="fw-section">
            <div class="fw-label">Format</div>
            <select id="bs-format">${fmtOpts}</select>
          </div>
        </div>`;
    }

    if (block.type === 'bar_chart' || block.type === 'line_chart') {
      const sources = Object.keys(SOURCE_FIELDS);
      const srcOpts = sources.map(s =>
        `<option value="${s}" ${block.source===s?'selected':''}>${s.replace(/_/g,' ')}</option>`).join('');
      const sf = SOURCE_FIELDS[block.source || 'ad_performance'];
      const dimOpts = sf.dimensions.map(d =>
        `<option value="${d}" ${(block.groupBy||'date')===d?'selected':''}>${d.replace(/_/g,' ')}</option>`).join('');
      const selectedMetrics = block.metrics || ['spend'];
      const pillsHtml = selectedMetrics.map(m =>
        `<span class="field-pill" data-metric="${m}">${METRIC_LABELS[m]||m}<button class="pill-remove" data-metric="${m}">×</button></span>`).join('');
      const availHtml = sf.metrics
        .filter(m => !selectedMetrics.includes(m))
        .map(m => `<span class="available-chip" data-metric="${m}">+ ${METRIC_LABELS[m]||m}</span>`).join('');
      const chartTypeOpts = ['bar_chart','line_chart'].map(t =>
        `<option value="${t}" ${block.type===t?'selected':''}>${t==='bar_chart'?'Bar':'Line'}</option>`).join('');
      const color = block.chartColor || '#2d5a27';
      return `
        <div class="field-well">
          <div class="fw-section">
            <div class="fw-label">Chart Type</div>
            <select id="bs-chart-type">${chartTypeOpts}</select>
          </div>
          <div class="fw-section">
            <div class="fw-label">Data Source</div>
            <select id="bs-source">${srcOpts}</select>
          </div>
          <div class="fw-section">
            <div class="fw-label">X Axis</div>
            <select id="bs-groupby">${dimOpts}</select>
          </div>
          <div class="fw-section">
            <div class="fw-label">Values</div>
            <div id="bs-metrics-pills" class="pills-container">${pillsHtml}</div>
            <div id="bs-metrics-available" class="available-fields">${availHtml}</div>
          </div>
          <div class="fw-section">
            <div class="fw-label">Color</div>
            <input type="color" id="bs-color" value="${color}">
          </div>
          ${renderFilterSection(block)}
        </div>`;
    }

    if (block.type === 'table') {
      const sources = Object.keys(SOURCE_FIELDS);
      const srcOpts = sources.map(s =>
        `<option value="${s}" ${block.source===s?'selected':''}>${s.replace(/_/g,' ')}</option>`).join('');
      const sf = SOURCE_FIELDS[block.source || 'campaigns'];
      const allCols = [...sf.dimensions, ...sf.metrics];
      const selectedCols = block.columns || [];
      // Column list — drag-sortable
      const colListHtml = selectedCols.map((c, i) =>
        `<div class="col-sort-item" data-col="${c}" draggable="true">
          <span class="col-sort-handle">⋮⋮</span>
          <span class="col-sort-label">${(METRIC_LABELS[c]||c).replace(/_/g,' ')}</span>
          <button class="col-sort-remove" data-col="${c}">×</button>
        </div>`).join('');
      const availHtml = allCols
        .filter(c => !selectedCols.includes(c))
        .map(c => `<span class="available-chip" data-col="${c}">+ ${(METRIC_LABELS[c]||c).replace(/_/g,' ')}</span>`).join('');
      const sortColOpts = allCols.map(c =>
        `<option value="${c}" ${(block.sortCol||'')===c?'selected':''}>${(METRIC_LABELS[c]||c).replace(/_/g,' ')}</option>`).join('');
      const limitOpts = [5,10,20,50,100].map(n =>
        `<option value="${n}" ${(block.limit||20)==n?'selected':''}>${n} rows</option>`).join('');
      return `
        <div class="field-well">
          <div class="fw-section">
            <div class="fw-label">Data Source</div>
            <select id="bs-source">${srcOpts}</select>
          </div>
          <div class="fw-section">
            <div class="fw-label">Columns <span class="fw-hint">(drag to reorder)</span></div>
            <div id="bs-columns-list" class="col-sort-list">${colListHtml}</div>
            <div class="fw-label" style="margin-top:8px">Add Column</div>
            <div id="bs-columns-available" class="available-fields">${availHtml}</div>
          </div>
          <div class="fw-section">
            <div class="fw-label">Sort By</div>
            <div class="fw-row">
              <select id="bs-sort-col"><option value="">None</option>${sortColOpts}</select>
              <select id="bs-sort-dir">
                <option value="desc" ${(block.sortDir||'desc')==='desc'?'selected':''}>Desc</option>
                <option value="asc"  ${(block.sortDir||'desc')==='asc' ?'selected':''}>Asc</option>
              </select>
            </div>
          </div>
          <div class="fw-section">
            <div class="fw-label">Row Limit</div>
            <select id="bs-limit">${limitOpts}</select>
          </div>
          <div class="fw-section">
            <div class="fw-label">Show Totals Row</div>
            <label class="fw-toggle"><input type="checkbox" id="bs-totals" ${block.showTotals?'checked':''}><span>Show totals</span></label>
          </div>
          ${renderFilterSection(block)}
        </div>`;
    }

    if (block.type === 'text') {
      const fs    = block.fontSize  || 14;
      const bold  = block.bold      || false;
      const tcol  = block.textColor || '#1a1a1a';
      const bgcol = block.bgColor   || '#ffffff';
      const align = block.align     || 'left';
      return `
        <div class="field-well">
          <div class="fw-section">
            <div class="fw-label">Font Size <span id="bs-fontsize-val">${fs}px</span></div>
            <input type="range" id="bs-fontsize" min="12" max="32" value="${fs}">
          </div>
          <div class="fw-section">
            <label class="fw-toggle"><input type="checkbox" id="bs-bold" ${bold?'checked':''}><span>Bold</span></label>
          </div>
          <div class="fw-section">
            <div class="fw-label">Alignment</div>
            <div class="fw-row">
              <button class="fw-align-btn ${align==='left'?'active':''}"   data-align="left"   title="Left">⬤⬤⬤⬤<br>⬤⬤⬤</button>
              <button class="fw-align-btn ${align==='center'?'active':''}" data-align="center" title="Center">&#8203; ⬤⬤⬤⬤</button>
              <button class="fw-align-btn ${align==='right'?'active':''}"  data-align="right"  title="Right">⬤⬤⬤⬤</button>
            </div>
            <select id="bs-align">
              <option value="left"   ${align==='left'  ?'selected':''}>Left</option>
              <option value="center" ${align==='center'?'selected':''}>Center</option>
              <option value="right"  ${align==='right' ?'selected':''}>Right</option>
            </select>
          </div>
          <div class="fw-section">
            <div class="fw-label">Text Color</div>
            <input type="color" id="bs-textcolor" value="${tcol}">
          </div>
          <div class="fw-section">
            <div class="fw-label">Background Color</div>
            <input type="color" id="bs-bgcolor" value="${bgcol}">
          </div>
        </div>`;
    }

    if (block.type === 'image') {
      return `
        <div class="field-well">
          <div class="fw-section">
            <div class="fw-label">Image</div>
            ${block.imageUrl
              ? `<div class="image-preview-wrap"><img src="${block.imageUrl}" class="image-preview-thumb" alt=""></div>`
              : '<div class="image-preview-empty">No image uploaded yet</div>'}
            <label class="btn-image-upload" for="bs-image-file">📂 Choose Image</label>
            <input type="file" id="bs-image-file" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml" style="display:none">
            <div id="bs-image-status" class="fw-hint"></div>
          </div>
          <div class="fw-section">
            <div class="fw-label">Fit</div>
            <select id="bs-object-fit">
              <option value="contain" ${(block.objectFit||'contain')==='contain'?'selected':''}>Contain (show whole image)</option>
              <option value="cover"   ${(block.objectFit||'contain')==='cover'  ?'selected':''}>Cover (fill block)</option>
              <option value="fill"    ${(block.objectFit||'contain')==='fill'   ?'selected':''}>Stretch</option>
            </select>
          </div>
          <div class="fw-section">
            <div class="fw-label">Background</div>
            <input type="color" id="bs-img-bg" value="${block.bgColor||'#ffffff'}">
          </div>
        </div>`;
    }

    return `<div class="form-group"><p class="hint">Select a block to configure it.</p></div>`;
  }

  function wireBlockSettingsEvents(block) {
    // KPI
    const metricEl = document.getElementById('bs-metric');
    if (metricEl) metricEl.addEventListener('change', () => { block.metric = metricEl.value; state.dirty = true; refreshBlockContent(block); });
    const aggEl = document.getElementById('bs-aggregation');
    if (aggEl) aggEl.addEventListener('change', () => { block.aggregation = aggEl.value; state.dirty = true; refreshBlockContent(block); });
    const fmtEl = document.getElementById('bs-format');
    if (fmtEl) fmtEl.addEventListener('change', () => { block.format = fmtEl.value; state.dirty = true; refreshBlockContent(block); });

    // Chart type toggle
    const chartTypeEl = document.getElementById('bs-chart-type');
    if (chartTypeEl) chartTypeEl.addEventListener('change', () => {
      block.type = chartTypeEl.value;
      state.dirty = true;
      // Re-create block element with new type class
      const el = document.querySelector(`.report-block[data-block-id="${block.blockId}"]`);
      if (el) {
        el.className = 'report-block block-type-' + block.type + ' selected';
        const old = el.querySelector('.block-content');
        if (old) old.remove();
        renderBlockContent(block, el);
      }
    });

    // Chart/Table: Data Source
    const srcEl = document.getElementById('bs-source');
    if (srcEl) srcEl.addEventListener('change', () => {
      block.source = srcEl.value;
      // Reset axes/columns to source defaults
      const sf = SOURCE_FIELDS[block.source] || { dimensions: [], metrics: [] };
      if (block.type === 'bar_chart' || block.type === 'line_chart') {
        block.groupBy = sf.dimensions[0] || '';
        block.metrics = sf.metrics.slice(0, 1);
      } else if (block.type === 'table') {
        block.columns = [...sf.dimensions, ...sf.metrics.slice(0, 2)];
      }
      state.dirty = true;
      // Re-render settings AND block
      showBlockSettings(block);
      refreshBlockContent(block);
    });

    // Chart: X axis
    const gbEl = document.getElementById('bs-groupby');
    if (gbEl) gbEl.addEventListener('change', () => { block.groupBy = gbEl.value; state.dirty = true; refreshBlockContent(block); });

    // Chart: metrics pills — remove
    document.querySelectorAll('#bs-metrics-pills .pill-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        const m = btn.dataset.metric;
        block.metrics = (block.metrics || []).filter(x => x !== m);
        state.dirty = true;
        showBlockSettings(block);
        refreshBlockContent(block);
      });
    });
    // Chart: metrics available — add
    document.querySelectorAll('#bs-metrics-available .available-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const m = chip.dataset.metric;
        if (!block.metrics) block.metrics = [];
        if (!block.metrics.includes(m)) {
          block.metrics.push(m);
          state.dirty = true;
          showBlockSettings(block);
          refreshBlockContent(block);
        }
      });
    });

    // Chart: color
    const colorEl = document.getElementById('bs-color');
    if (colorEl) colorEl.addEventListener('input', () => { block.chartColor = colorEl.value; state.dirty = true; refreshBlockContent(block); });

    // Table: column list drag-to-reorder
    const colList = document.getElementById('bs-columns-list');
    if (colList) {
      let dragSrc = null;
      colList.querySelectorAll('.col-sort-item').forEach(item => {
        item.addEventListener('dragstart', e => { dragSrc = item; item.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
        item.addEventListener('dragend',   () => { item.classList.remove('dragging'); dragSrc = null; });
        item.addEventListener('dragover',  e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; });
        item.addEventListener('drop', e => {
          e.preventDefault();
          if (!dragSrc || dragSrc === item) return;
          const items = [...colList.querySelectorAll('.col-sort-item')];
          const srcIdx  = items.indexOf(dragSrc);
          const destIdx = items.indexOf(item);
          if (srcIdx < destIdx) colList.insertBefore(dragSrc, item.nextSibling);
          else colList.insertBefore(dragSrc, item);
          // Sync block.columns from DOM order
          block.columns = [...colList.querySelectorAll('.col-sort-item')].map(el => el.dataset.col);
          state.dirty = true;
          refreshBlockContent(block);
        });
        // Remove button
        item.querySelector('.col-sort-remove')?.addEventListener('click', () => {
          const c = item.dataset.col;
          block.columns = (block.columns || []).filter(x => x !== c);
          state.dirty = true;
          showBlockSettings(block);
          refreshBlockContent(block);
        });
      });
    }
    // Table: columns available — add
    document.querySelectorAll('#bs-columns-available .available-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const c = chip.dataset.col;
        if (!block.columns) block.columns = [];
        if (!block.columns.includes(c)) {
          block.columns.push(c);
          state.dirty = true;
          showBlockSettings(block);
          refreshBlockContent(block);
        }
      });
    });

    // Table: sort col/dir
    const sortColEl = document.getElementById('bs-sort-col');
    if (sortColEl) sortColEl.addEventListener('change', () => { block.sortCol = sortColEl.value; state.dirty = true; refreshBlockContent(block); });
    const sortDirEl = document.getElementById('bs-sort-dir');
    if (sortDirEl) sortDirEl.addEventListener('change', () => { block.sortDir = sortDirEl.value; state.dirty = true; refreshBlockContent(block); });

    // Table: limit
    const limEl = document.getElementById('bs-limit');
    if (limEl) limEl.addEventListener('change', () => { block.limit = parseInt(limEl.value) || 20; state.dirty = true; refreshBlockContent(block); });

    // Table: totals toggle
    const totalsEl = document.getElementById('bs-totals');
    if (totalsEl) totalsEl.addEventListener('change', () => { block.showTotals = totalsEl.checked; state.dirty = true; refreshBlockContent(block); });

    // Text: font size
    const fsEl = document.getElementById('bs-fontsize');
    if (fsEl) {
      fsEl.addEventListener('input', () => {
        block.fontSize = parseInt(fsEl.value);
        document.getElementById('bs-fontsize-val').textContent = block.fontSize + 'px';
        state.dirty = true;
        refreshBlockContent(block);
      });
    }
    // Text: bold
    const boldEl = document.getElementById('bs-bold');
    if (boldEl) boldEl.addEventListener('change', () => { block.bold = boldEl.checked; state.dirty = true; refreshBlockContent(block); });
    // Text: alignment
    const alignEl = document.getElementById('bs-align');
    if (alignEl) alignEl.addEventListener('change', () => { block.align = alignEl.value; state.dirty = true; refreshBlockContent(block); });
    // Text: text color
    const tcolEl = document.getElementById('bs-textcolor');
    if (tcolEl) tcolEl.addEventListener('input', () => { block.textColor = tcolEl.value; state.dirty = true; refreshBlockContent(block); });
    // Text: bg color
    const bgcolEl = document.getElementById('bs-bgcolor');
    if (bgcolEl) bgcolEl.addEventListener('input', () => { block.bgColor = bgcolEl.value; state.dirty = true; refreshBlockContent(block); });

    // Image block
    const imgFileEl = document.getElementById('bs-image-file');
    if (imgFileEl) {
      imgFileEl.addEventListener('change', async () => {
        const file = imgFileEl.files[0];
        if (!file) return;
        const statusEl = document.getElementById('bs-image-status');
        if (statusEl) statusEl.textContent = 'Uploading…';
        const fd = new FormData();
        fd.append('image', file);
        try {
          const r = await fetch('/api/report-builder/upload-image', { method: 'POST', body: fd, credentials: 'include' });
          const d = await r.json();
          if (!r.ok) throw new Error(d.error || 'Upload failed');
          block.imageUrl = d.url;
          state.dirty = true;
          if (statusEl) statusEl.textContent = '✅ Uploaded';
          showBlockSettings(block);   // re-render settings to show preview
          refreshBlockContent(block);
        } catch (e) {
          if (statusEl) statusEl.textContent = '❌ ' + e.message;
        }
      });
    }
    const fitEl = document.getElementById('bs-object-fit');
    if (fitEl) fitEl.addEventListener('change', () => { block.objectFit = fitEl.value; state.dirty = true; refreshBlockContent(block); });
    const imgBgEl = document.getElementById('bs-img-bg');
    if (imgBgEl) imgBgEl.addEventListener('input', () => { block.bgColor = imgBgEl.value; state.dirty = true; refreshBlockContent(block); });
  }

  function refreshBlockContent(block) {
    const el = document.querySelector(`.report-block[data-block-id="${block.blockId}"]`);
    if (!el) return;
    const old = el.querySelector('.block-content');
    if (old) old.remove();
    renderBlockContent(block, el);
  }

  // ─── Add / remove blocks ─────────────────────────────────────────────────────
  function addBlock(type) {
    const tab = currentTab();
    if (!tab) return;
    const block = blockDefaults(type);
    block.grid.x = 0;
    block.grid.y = Math.min(ROWS - block.grid.h, tab.blocks.length * 3 % ROWS);
    tab.blocks.push(block);
    const canvas = document.getElementById('report-canvas');
    const el = createBlockEl(block);
    canvas.appendChild(el);
    renderBlockContent(block, el);
    setupInteract(block, el);
    state.dirty = true;
    selectBlock(block.blockId);
  }

  function removeBlock(blockId) {
    const tab = currentTab();
    if (!tab) return;
    const idx = tab.blocks.findIndex(b => b.blockId === blockId);
    if (idx === -1) return;
    tab.blocks.splice(idx, 1);
    const el = document.querySelector(`.report-block[data-block-id="${blockId}"]`);
    if (el) el.remove();
    if (state.selectedBlockId === blockId) {
      state.selectedBlockId = null;
      showBlockSettings(null);
    }
    state.dirty = true;
  }

  // ─── Drop from library ────────────────────────────────────────────────────────
  function wireLibraryDrop() {
    const canvas = document.getElementById('report-canvas');
    canvas.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
    canvas.addEventListener('drop', (e) => {
      e.preventDefault();
      const type = e.dataTransfer.getData('text/block-type');
      if (!type) return;
      addBlock(type);
    });
    document.querySelectorAll('.block-item').forEach(item => {
      item.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/block-type', item.dataset.type);
      });
      item.addEventListener('click', () => addBlock(item.dataset.type));
    });
  }

  // ─── Reports list ─────────────────────────────────────────────────────────────
  function renderReportsList() {
    const list = document.getElementById('reports-list');
    if (!list) return;
    list.innerHTML = '';
    if (!state.reports.length) {
      list.innerHTML = '<div class="reports-empty">No saved reports</div>';
      return;
    }
    state.reports.forEach(r => {
      const item = document.createElement('div');
      item.className = 'report-list-item';
      item.textContent = r.name || 'Untitled';
      item.title = r.name;
      item.addEventListener('click', async () => {
        const full = await api('GET', `/api/report-builder/reports/${r.report_id}`);
        loadReport(full);
        document.getElementById('template-modal').style.display = 'none';
      });
      list.appendChild(item);
    });
  }

  // ─── Template modal ──────────────────────────────────────────────────────────
  function showTemplateModal() {
    const modal = document.getElementById('template-modal');
    modal.style.display = 'flex';
    const grid = document.getElementById('template-grid');
    grid.innerHTML = '';
    state.templates.forEach(t => {
      const card = document.createElement('div');
      card.className = 'template-card';
      card.innerHTML = `<div class="template-name">${t.name}</div><div class="template-desc">${t.description || ''}</div>`;
      card.addEventListener('click', () => {
        initFromTemplate(t);
        modal.style.display = 'none';
      });
      grid.appendChild(card);
    });
  }

  function initFromTemplate(template) {
    const report = {
      report_id: null,
      name: template.name + ' — ' + new Date().toLocaleDateString(),
      global_filters: {},
      tabs: JSON.parse(JSON.stringify(template.tabs)),
      brand_config: JSON.parse(JSON.stringify(template.brand_config || {})),
      template_id: template.template_id,
    };
    loadReport(report);
  }

  // ─── Save ────────────────────────────────────────────────────────────────────
  async function saveReport() {
    if (!state.report) return;
    const payload = {
      name: document.getElementById('report-name').value || 'Untitled Report',
      global_filters: state.report.global_filters || {},
      tabs: state.report.tabs,
      brand_config: {
        primaryColor: document.getElementById('brand-color').value,
        footerText: document.getElementById('brand-footer-text').value,
        showFooter: document.getElementById('brand-show-footer').checked,
      },
      template_id: state.report.template_id || null,
    };
    try {
      let saved;
      if (state.report.report_id) {
        saved = await api('PUT', `/api/report-builder/reports/${state.report.report_id}`, payload);
      } else {
        saved = await api('POST', '/api/report-builder/reports', payload);
        state.report.report_id = saved.report_id;
        history.replaceState({}, '', `/report-builder.html?reportId=${saved.report_id}`);
      }
      state.dirty = false;
      state.report.name = payload.name;
      state.reports = await api('GET', '/api/report-builder/reports').catch(() => state.reports);
      renderReportsList();
      showToast('Report saved');
    } catch (e) {
      alert('Save failed: ' + e.message);
    }
  }

  // ─── Save as template ─────────────────────────────────────────────────────────
  async function saveAsTemplate() {
    const name = prompt('Template name:', state.report.name + ' Template');
    if (!name) return;
    try {
      await api('POST', '/api/report-builder/templates', {
        name,
        tabs: state.report.tabs,
        brand_config: state.report.brand_config,
      });
      state.templates = await api('GET', '/api/report-builder/templates').catch(() => state.templates);
      showToast('Template saved');
    } catch (e) {
      alert('Save template failed: ' + e.message);
    }
  }

  // ─── Preview ─────────────────────────────────────────────────────────────────
  async function openPreview() {
    if (!state.report.report_id) { alert('Save the report first before previewing.'); return; }
    window.open(`/reports-preview/${state.report.report_id}`, '_blank');
  }

  // ─── Export PDF ──────────────────────────────────────────────────────────────
  async function exportPDF() {
    if (!state.report.report_id) { alert('Save the report first.'); return; }
    showToast('Generating PDF…');
    try {
      const res = await fetch(`/api/report-builder/reports/${state.report.report_id}/pdf`, {
        method: 'POST', credentials: 'include',
      });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = (state.report.name || 'report') + '.pdf';
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert('PDF export failed: ' + e.message);
    }
  }

  // ─── Export CSV ──────────────────────────────────────────────────────────────
  async function exportCSV() {
    if (!state.report.report_id) { alert('Save the report first.'); return; }
    window.location.href = `/api/report-builder/reports/${state.report.report_id}/export-csv`;
  }

  // ─── Toast ────────────────────────────────────────────────────────────────────
  function showToast(msg) {
    let t = document.getElementById('rb-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'rb-toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.className = 'rb-toast show';
    setTimeout(() => t.classList.remove('show'), 2500);
  }

  // ─── Right panel tab switch ───────────────────────────────────────────────────
  function switchRightPanel(which) {
    document.querySelectorAll('.rpanel-tab').forEach(b => b.classList.toggle('active', b.dataset.panel === which));
    document.getElementById('block-settings-panel').style.display = which === 'block' ? '' : 'none';
    document.getElementById('branding-panel').style.display        = which === 'branding' ? '' : 'none';
  }

  // ─── Wire all events ──────────────────────────────────────────────────────────
  function wireEvents() {
    document.getElementById('btn-save').addEventListener('click', saveReport);
    document.getElementById('btn-preview').addEventListener('click', openPreview);
    document.getElementById('btn-export-pdf').addEventListener('click', exportPDF);
    document.getElementById('btn-export-csv').addEventListener('click', exportCSV);
    document.getElementById('btn-new-report').addEventListener('click', showTemplateModal);
    document.getElementById('btn-new-from-template').addEventListener('click', showTemplateModal);
    document.getElementById('btn-blank-report').addEventListener('click', () => {
      loadReport(defaultReport());
      document.getElementById('template-modal').style.display = 'none';
    });
    document.getElementById('btn-add-tab').addEventListener('click', addTab);

    document.getElementById('report-name').addEventListener('input', () => { state.dirty = true; });

    document.querySelectorAll('.rpanel-tab').forEach(btn => {
      btn.addEventListener('click', () => switchRightPanel(btn.dataset.panel));
    });


    document.getElementById('brand-color').addEventListener('input', (e) => {
      document.documentElement.style.setProperty('--brand-report', e.target.value);
      if (state.report) state.report.brand_config = state.report.brand_config || {};
      if (state.report) state.report.brand_config.primaryColor = e.target.value;
      state.dirty = true;
    });

    document.getElementById('report-canvas').addEventListener('click', (e) => {
      if (e.target === document.getElementById('report-canvas')) {
        state.selectedBlockId = null;
        document.querySelectorAll('.report-block').forEach(el => el.classList.remove('selected'));
        showBlockSettings(null);
      }
    });

    const logoutBtn = document.getElementById('btn-logout');
    if (logoutBtn) logoutBtn.addEventListener('click', async () => {
      await fetch('/auth/logout', { method: 'POST', credentials: 'include' });
      window.location.href = '/';
    });

    window.addEventListener('beforeunload', (e) => {
      if (state.dirty) { e.preventDefault(); e.returnValue = ''; }
    });

    wireLibraryDrop();
  }

  // ─── Boot ─────────────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', init);

})();
