import { Card } from '@tremor/react';
import { fmtCurrency, fmtPct, fmtRoas, fmtCompact, acosColor } from '../utils/format';

function formatValue(value, format) {
  switch (format) {
    case 'currency': return fmtCurrency(value);
    case 'percent':  return fmtPct(value);
    case 'roas':     return fmtRoas(value);
    case 'compact':  return fmtCompact(value);
    case 'number':   return value == null ? '—' : Number(value).toLocaleString();
    default:         return value ?? '—';
  }
}

export default function MetricCard({ title, value, format = 'number', colorFn, loading }) {
  const displayValue = formatValue(value, format);
  const colorClass = colorFn ? colorFn(value) : '';

  return (
    <Card className="p-4">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">{title}</p>
      {loading ? (
        <div className="h-7 bg-gray-200 animate-pulse rounded w-24" />
      ) : (
        <p className={`text-2xl font-bold text-gray-900 ${colorClass}`}>{displayValue}</p>
      )}
    </Card>
  );
}
