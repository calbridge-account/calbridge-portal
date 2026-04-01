export function fmtCurrency(v) {
  if (v == null || isNaN(v)) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v);
}

export function fmtPct(v, decimals = 1) {
  if (v == null || isNaN(v)) return '—';
  return `${(v * 100).toFixed(decimals)}%`;
}

export function fmtRoas(v) {
  if (v == null || isNaN(v)) return '—';
  return `${Number(v).toFixed(2)}x`;
}

export function fmtCompact(v) {
  if (v == null || isNaN(v)) return '—';
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(v);
}

export function acosColor(acos) {
  if (acos == null) return 'text-gray-500';
  if (acos < 0.10) return 'text-green-700 font-semibold';
  if (acos < 0.20) return 'text-yellow-700';
  return 'text-red-700 font-semibold';
}
