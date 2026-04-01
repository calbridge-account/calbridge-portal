import { useState } from 'react';
import { useDateRange, DATE_PRESETS } from '../context/DateRangeContext';

export default function DateRangePicker() {
  const { range, setPreset, setCustom } = useDateRange();
  const [showCustom, setShowCustom] = useState(false);
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  function handleSelect(value) {
    if (value === 'custom') {
      setShowCustom(true);
    } else {
      setShowCustom(false);
      setPreset(value);
    }
  }

  function applyCustom() {
    if (customStart && customEnd) {
      setCustom(customStart, customEnd);
      setShowCustom(false);
    }
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex rounded-lg border border-gray-200 bg-white overflow-hidden shadow-sm">
        {DATE_PRESETS.map(p => (
          <button
            key={p.value}
            onClick={() => handleSelect(p.value)}
            className={`px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
              range.type === p.value
                ? 'bg-brand text-white'
                : 'text-gray-600 hover:bg-gray-50'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {showCustom && (
        <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-1.5 shadow-sm">
          <input
            type="date"
            value={customStart}
            onChange={e => setCustomStart(e.target.value)}
            className="text-xs border-0 outline-none text-gray-700"
          />
          <span className="text-gray-400 text-xs">→</span>
          <input
            type="date"
            value={customEnd}
            onChange={e => setCustomEnd(e.target.value)}
            className="text-xs border-0 outline-none text-gray-700"
          />
          <button
            onClick={applyCustom}
            className="ml-1 px-2 py-0.5 bg-brand text-white text-xs rounded font-medium"
          >
            Apply
          </button>
        </div>
      )}
    </div>
  );
}
