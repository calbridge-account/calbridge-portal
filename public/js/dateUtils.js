/**
 * Calbridge Date Range Utilities
 * Converts filter value to { days, startDate, endDate } for API calls
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
      // Use explicit startDate/endDate so the API queries the exact calendar month,
      // not a rolling window that drifts as the month progresses.
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
      // Pass explicit dates — the 'days' param alone would query backwards from TODAY,
      // not from the selected historical window. This was showing Jan data as Feb/Mar data.
      return { days: Math.max(days, 1), label: `${customFrom} → ${customTo}`, startDate: customFrom, endDate: customTo };
    }
    default:
      // Rolling window — no fixed anchor needed, rolling from today is correct
      return { days: Number(filterValue) || 30, label: `Last ${filterValue} days`, startDate: null, endDate: null };
  }
}

/**
 * Set up the date filter select + custom range picker
 * @param {string} selectId  - ID of the <select>
 * @param {Function} onChange - callback(days, label)
 */
function setupDateFilter(selectId, onChange) {
  const select      = document.getElementById(selectId);
  const customRange = document.getElementById('custom-range');
  const dateFrom    = document.getElementById('date-from');
  const dateTo      = document.getElementById('date-to');
  const applyBtn    = document.getElementById('apply-custom');

  if (!select) return;

  // Default dates for custom picker
  const today = new Date();
  const thirtyAgo = new Date(today - 30 * 86400000);
  if (dateFrom) dateFrom.value = thirtyAgo.toISOString().split('T')[0];
  if (dateTo)   dateTo.value   = today.toISOString().split('T')[0];

  select.addEventListener('change', () => {
    const val = select.value;
    if (val === 'custom') {
      customRange?.classList.remove('hidden');
      return; // wait for Apply
    }
    customRange?.classList.add('hidden');
    const { days, label, startDate, endDate } = getDateRange(val);
    onChange(days, label, startDate, endDate);
  });

  applyBtn?.addEventListener('click', () => {
    const { days, label, startDate, endDate } = getDateRange('custom', dateFrom?.value, dateTo?.value);
    onChange(days, label, startDate, endDate);
  });
}
