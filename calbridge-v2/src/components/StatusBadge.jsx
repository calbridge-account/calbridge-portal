const STATUS_COLORS = {
  ENABLED:  { bg: '#d1fae5', text: '#065f46' },
  PAUSED:   { bg: '#fef3c7', text: '#92400e' },
  ARCHIVED: { bg: '#f3f4f6', text: '#6b7280' },
};

export default function StatusBadge({ status }) {
  const config = STATUS_COLORS[status] || { bg: '#f3f4f6', text: '#6b7280' };
  const label = status ? status.charAt(0) + status.slice(1).toLowerCase() : '—';
  return (
    <span
      style={{ backgroundColor: config.bg, color: config.text }}
      className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
    >
      {label}
    </span>
  );
}
