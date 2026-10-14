/**
 * Cache sizes as the WPF `GameSizeConverter` prints them: base 1024,
 * B/KB/MB/GB/TB, 2 decimals, in parentheses, e.g. "(12.34 MB)".
 */
const UNITS = ["B", "KB", "MB", "GB", "TB", "PB"];

export function formatSize(bytes: number): string {
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${(Math.round(value * 100) / 100).toFixed(2)} ${UNITS[unit]}`;
}

/** `"(12.34 MB)"`, or an empty string while the size is unknown. */
export function formatCacheSize(bytes: number | null | undefined): string {
  return bytes === null || bytes === undefined ? "" : `(${formatSize(bytes)})`;
}
