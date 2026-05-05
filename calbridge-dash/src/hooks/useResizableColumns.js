/**
 * useResizableColumns
 * Hook that provides column resize state and drag handlers.
 * Usage:
 *   const { colWidths, startResize, resetWidth } = useResizableColumns(defaults);
 *   // In <th>: style={{ width: colWidths[col] }}
 *   //          <ResizeHandle onMouseDown={startResize(col)} />
 *
 * @param {Object} defaults  — { colName: pixelWidth }
 */
import { useState, useCallback } from 'react';

export function useResizableColumns(defaults = {}) {
  const [colWidths, setColWidths] = useState(defaults);

  const startResize = useCallback((col) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = colWidths[col] ?? 100;

    const onMove = (mv) => {
      const delta = mv.clientX - startX;
      const newW = Math.max(40, startW + delta);
      setColWidths(prev => ({ ...prev, [col]: newW }));
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [colWidths]);

  const resetWidth = useCallback((col) => {
    setColWidths(prev => {
      const next = { ...prev };
      if (defaults[col] != null) next[col] = defaults[col];
      else delete next[col];
      return next;
    });
  }, [defaults]);

  return { colWidths, startResize, resetWidth };
}
