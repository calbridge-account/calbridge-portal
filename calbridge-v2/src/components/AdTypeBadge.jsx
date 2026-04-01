const COLORS = {
  SPONSORED_PRODUCTS: { bg: '#dbeafe', text: '#1e40af', label: 'SP' },
  SPONSORED_BRANDS:   { bg: '#d1fae5', text: '#065f46', label: 'SB' },
  SPONSORED_DISPLAY:  { bg: '#fef3c7', text: '#92400e', label: 'SD' },
  DSP:                { bg: '#ede9fe', text: '#4c1d95', label: 'DSP' },
};

export default function AdTypeBadge({ type }) {
  const config = COLORS[type] || { bg: '#f3f4f6', text: '#6b7280', label: type || '?' };
  return (
    <span
      style={{ backgroundColor: config.bg, color: config.text }}
      className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold"
    >
      {config.label}
    </span>
  );
}
