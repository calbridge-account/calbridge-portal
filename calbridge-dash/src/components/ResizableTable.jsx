/**
 * ResizableTable
 * Drop-in wrapper that makes a table's <th> elements resizable by drag.
 *
 * Usage — in your JSX wrap the whole <table> with this component:
 *
 *   <ResizableTable defaults={{ campaign: 280, spend: 100, ... }}>
 *     <table>...</table>
 *   </ResizableTable>
 *
 * Each <th> that has a data-col="<key>" attribute gets a drag handle appended.
 * Width is tracked in component state via a MutationObserver; no changes
 * needed to your existing <th> markup except adding data-col.
 *
 * Alternatively, use the lower-level ResizableTh directly:
 *
 *   <ResizableTh col="campaign" colWidths={colWidths} startResize={startResize} ...>
 *     Campaign
 *   </ResizableTh>
 */
import { useResizableColumns } from '../hooks/useResizableColumns';

/**
 * ResizableTh — a single resizable <th> cell.
 * Render a drag handle at the right edge. Double-click handle to reset.
 */
export function ResizableTh({
  col,
  colWidths,
  startResize,
  resetWidth,
  children,
  className = '',
  style = {},
  ...rest
}) {
  const w = colWidths[col];
  return (
    <th
      className={`relative select-none ${className}`}
      style={{ width: w ? `${w}px` : undefined, minWidth: w ? `${w}px` : undefined, maxWidth: w ? `${w}px` : undefined, ...style }}
      {...rest}
    >
      <span className="block overflow-hidden text-ellipsis whitespace-nowrap pr-3">{children}</span>
      {/* Resize handle */}
      <span
        onMouseDown={startResize(col)}
        onDoubleClick={() => resetWidth(col)}
        title="Drag to resize · double-click to reset"
        className="absolute right-0 top-0 bottom-0 w-3 flex items-center justify-center cursor-col-resize group z-10"
        style={{ userSelect: 'none' }}
      >
        <span className="w-0.5 h-4 rounded bg-gray-300 group-hover:bg-blue-400 transition-colors" />
      </span>
    </th>
  );
}

/**
 * useTableResize — convenience hook with sensible defaults for advertising tables.
 */
export function useTableResize(defaults) {
  return useResizableColumns(defaults);
}

export default ResizableTh;
