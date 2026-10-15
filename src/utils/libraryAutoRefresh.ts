/** Background refresh of the library list while the app stays open. */

/** Refresh at most this often when the window regains focus. */
export const LIBRARY_FOCUS_REFRESH_MIN_MS = 30_000;

/** Refresh this often while the window is visible. */
export const LIBRARY_INTERVAL_REFRESH_MS = 5 * 60_000;

/**
 * Whether a background refresh is due: `lastFetchAt` is the time of the last
 * successful fetch (0 = never), `minIntervalMs` the minimum gap.
 */
export function isLibraryRefreshDue(
  lastFetchAt: number,
  now: number,
  minIntervalMs: number,
): boolean {
  if (lastFetchAt <= 0) return false;
  return now - lastFetchAt >= minIntervalMs;
}

/**
 * Page size for a background refresh that keeps every page the user already
 * scrolled through, so the list (and its scroll position) does not shrink.
 */
export function libraryRefreshLimit(
  limit: number,
  loadedPages: number,
): number {
  return limit * Math.max(1, loadedPages);
}
