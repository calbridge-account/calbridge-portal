import { useState } from 'react';
import { useDateRange, PRESETS } from '../context/DateRangeContext';

export default function DateRangePicker() {
  const { range, setRange } = useDateRange();
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [showCustom, setShowCustom] = useState(false);

  function handlePreset(value) {
    if (value === 'custom') {
      setShowCustom(true);
    } else {
      setShowCustom(false);
      setRange({ type: value });
    }
  }

  function applyCustom() {
    if (customStart && customEnd) {
      setRange({ type: 'custom', start: customStart, end: customEnd });
      setShowCustom(false);
    }
  }

  const activeType = range.type;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Preset buttons */}
      <div className="flex rounded-lg border border-gray-200 bg-white overflow-hidden">
        {PRESETS.map(p => (
          <button
            key={p.value}
            onClick={() => handlePreset(p.value)}
            className={`px-3 py-1.5 text-sm font-medium transition-colors ${
              activeType === p.value
                ? 'bg-brand text-white'
                : 'text-gray-600 hover:bg-gray-50'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Custom date inputs */}
      {showCustom && (
        <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-1.5">
          <input
            type="date"
            value={customStart}
            onChange={e => setCustomStart(e.target.value)}
            className="text-sm border-0 outline-none text-gray-700"
          />
          <span className="text-gray-400 text-sm">→</span>
          <input
            type="date"
            value={customEnd}
            onChange={e => setCustomEnd(e.target.value)}
            className="text-sm border-0 outline-none text-gray-700"
          />
          <button
            onClick={applyCustom}
            className="ml-1 px-2 py-0.5 bg-brand text-white text-xs rounded font-medium hover:bg-brand-dark"
          >
            Apply
          </button>
        </div>
      )}

      {/* Active range label */}
      {range.type === 'custom' && range.start && (
        <span className="text-sm text-gray-500">
          {range.start} → {range.end}
        </span>
      )}
    </div>
  );
}
