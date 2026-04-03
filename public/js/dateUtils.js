/**
 * Calbridge Date Range Utilities
 * Converts filter value to { days, startDate, endDate } for API calls
 * Supports URL persistence via ?range= query param.
 */

function getDateRange(filterValue, customFrom, customTo) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().split('T')[0];

  switch (filterValue) {
    case 'mtd': {
      const start = new Date(today.getFullYear(), today.getMonth(), 1);
      const startStr = start.toISOString().split('T')[0];
      const days = Math.ceil((today - start) / 86400000) || 1;
      return { days, label: 'Month to Date', startDate: startStr, endDate: todayStr };
    }
    case 'ytd': {
      const start = new Date(today.getFullYear(), 0, 1);
      const startStr = start.toISOString().split('T')[0];
      const days = Math.ceil((today - start) / 86400000) || 1;
      return { days, label: 'Year to Date', startDate: startStr, endDate: todayStr };
    }
    case 'custom': {
      if (!customFrom || !customTo) return { days: 30, label: 'Last 30 days', startDate: null, endDate: null };
      const from = new Date(customFrom);
      const to   = new Date(customTo);
      const days = Math.ceil((to - from) / 86400000) + 1;
      return { days: Math.max(days, 1), label: `${customFrom} → ${customTo}`, startDate: customFrom, endDate: customTo };
    }
    case '7':
    case 7:
      return { days: 7, label: 'Last 7 Days', startDate: null, endDate: null };
    case '14':
    case 14:
      return { days: 14, label: 'Last 14 Days', startDate: null, endDate: null };
    default:
      return { days: Number(filterValue) || 30, label: `Last ${filterValue} days`, startDate: null, endDate: null };
  }
}

/**
 * Read the current range selection from the URL search params.
 * Returns { range, customFrom, customTo } or defaults.
 */
function getRangeFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const range  = params.get('range') || 'mtd';
  const from   = params.get('from')  || null;
  const to     = params.get('to')    || null;
  return { range, customFrom: from, customTo: to };
}

/**
 * Persist the range selection into the URL without triggering a page reload.
 */
function setRangeInUrl(range, customFrom, customTo) {
  const params = new URLSearchParams(window.location.search);
  params.set('range', range);
  if (range === 'custom' && customFrom && customTo) {
    params.set('from', customFrom);
    params.set('to', customTo);
  } else {
    params.delete('from');
    params.delete('to');
  }
  const newUrl = window.location.pathname + '?' + params.toString();
  window.history.replaceState({}, '', newUrl);
}

/**
 * Set up the date filter select + custom range picker.
 * Reads initial state from URL; writes back on every change.
 *
 * @param {string}   selectId  - ID of the <select>
 * @param {Function} onChange  - callback(days, label, startDate, endDate)
 */
function setupDateFilter(selectId, onChange) {
  const select      = document.getElementById(selectId);
  const customRange = document.getElementById('custom-range');
  const dateFrom    = document.getElementById('date-from');
  const dateTo      = document.getElementById('date-to');
  const applyBtn    = document.getElementById('apply-custom');

  if (!select) return;

  // ── Restore state from URL ────────────────────────────────────────────────
  const { range: urlRange, customFrom: urlFrom, customTo: urlTo } = getRangeFromUrl();

  // Only set if the option actually exists in this select
  const validOptions = Array.from(select.options).map(o => o.value);
  const initialRange = validOptions.includes(urlRange) ? urlRange : 'mtd';

  select.value = initialRange;

  if (initialRange === 'custom') {
    customRange?.classList.remove('hidden');
    if (dateFrom && urlFrom) dateFrom.value = urlFrom;
    if (dateTo   && urlTo)   dateTo.value   = urlTo;
  } else {
    customRange?.classList.add('hidden');
    // Set default dates for custom picker (30 days back)
    const today    = new Date();
    const thirtyAgo = new Date(today - 30 * 86400000);
    if (dateFrom) dateFrom.value = thirtyAgo.toISOString().split('T')[0];
    if (dateTo)   dateTo.value   = today.toISOString().split('T')[0];
  }

  // ── Trigger initial load ──────────────────────────────────────────────────
  const initFrom = initialRange === 'custom' ? (urlFrom || dateFrom?.value) : null;
  const initTo   = initialRange === 'custom' ? (urlTo   || dateTo?.value)   : null;
  const { days: initDays, label: initLabel, startDate: initStart, endDate: initEnd } = getDateRange(initialRange, initFrom, initTo);
  // Persist initial URL (normalises any missing params)
  setRangeInUrl(initialRange, initFrom, initTo);
  // Fire immediately so the caller can set its own state before the first fetch
  onChange(initDays, initLabel, initStart, initEnd);

  // ── Wire up the select ────────────────────────────────────────────────────
  select.addEventListener('change', () => {
    const val = select.value;
    if (val === 'custom') {
      customRange?.classList.remove('hidden');
      setRangeInUrl('custom', null, null);
      return; // wait for Apply
    }
    customRange?.classList.add('hidden');
    const { days, label, startDate, endDate } = getDateRange(val);
    setRangeInUrl(val, null, null);
    onChange(days, label, startDate, endDate);
  });

  // ── Wire up Apply button ──────────────────────────────────────────────────
  applyBtn?.addEventListener('click', () => {
    const from = dateFrom?.value;
    const to   = dateTo?.value;
    const { days, label, startDate, endDate } = getDateRange('custom', from, to);
    setRangeInUrl('custom', from, to);
    onChange(days, label, startDate, endDate);
  });
}
