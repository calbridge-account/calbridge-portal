/**
 * exportUtils.js
 * Shared utilities for exporting tables to .xlsx/.csv and charts to .png
 */

// ─── Table export (xlsx / csv) ────────────────────────────────────────────────

/**
 * Export an array of objects to .xlsx
 * @param {Object[]} rows   - plain data objects (all keys become columns)
 * @param {string}   filename - without extension
 */
export async function exportToXlsx(rows, filename = 'export') {
  const XLSX = await import('xlsx');
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Data');
  XLSX.writeFile(wb, `${filename}.xlsx`);
}

/**
 * Export an array of objects to .csv
 */
export async function exportToCsv(rows, filename = 'export') {
  const XLSX = await import('xlsx');
  const ws = XLSX.utils.json_to_sheet(rows);
  const csv = XLSX.utils.sheet_to_csv(ws);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  triggerDownload(blob, `${filename}.csv`);
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Chart export (png via html2canvas) ──────────────────────────────────────

/**
 * Export a DOM element (chart wrapper) to a .png file
 * @param {HTMLElement} el        - element to snapshot
 * @param {string}      filename  - without extension
 */
export async function exportChartToPng(el, filename = 'chart') {
  const { default: html2canvas } = await import('html2canvas');
  const canvas = await html2canvas(el, { backgroundColor: '#ffffff', scale: 2 });
  canvas.toBlob((blob) => {
    triggerDownload(blob, `${filename}.png`);
  }, 'image/png');
}
