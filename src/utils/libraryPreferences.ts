/**
 * Library preferences: auto-load on startup, retain sorting/filters,
 * cover size and the installed games section state.
 */

export const LIBRARY_AUTOLOAD_KEY = "playstash_library_autoload";
export const LIBRARY_RETAIN_KEY = "playstash_library_retain";
export const LIBRARY_COVER_SIZE_KEY = "playstash_library_cover_size";
export const INSTALLED_OPEN_KEY = "playstash_installed_open";
export const LIBRARY_PREFERENCES_EVENT = "playstash:library-preferences-change";

export const COVER_SIZE_MIN = 90;
export const COVER_SIZE_MAX = 220;
export const COVER_SIZE_DEFAULT = 140;

function readBool(key: string, fallback: boolean): boolean {
  try {
    const value = localStorage.getItem(key);
    if (value === "true" || value === "1") return true;
    if (value === "false" || value === "0") return false;
  } catch {
    // storage unavailable
  }
  return fallback;
}

function writeValue(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage unavailable
  }
  try {
    window.dispatchEvent(
      new CustomEvent(LIBRARY_PREFERENCES_EVENT, { detail: { key, value } }),
    );
  } catch {
    // events unavailable
  }
}

/** "Auto-Load Library from Server on Startup" (default on). */
export function getLibraryAutoload(): boolean {
  return readBool(LIBRARY_AUTOLOAD_KEY, true);
}

export function setLibraryAutoload(value: boolean): void {
  writeValue(LIBRARY_AUTOLOAD_KEY, value ? "true" : "false");
}

/** "Retain Sorting and Filter preferences after restart" (default on). */
export function getLibraryRetain(): boolean {
  return readBool(LIBRARY_RETAIN_KEY, true);
}

export function setLibraryRetain(value: boolean): void {
  writeValue(LIBRARY_RETAIN_KEY, value ? "true" : "false");
}

export function clampCoverSize(value: number): number {
  if (!Number.isFinite(value)) return COVER_SIZE_DEFAULT;
  return Math.min(COVER_SIZE_MAX, Math.max(COVER_SIZE_MIN, Math.round(value)));
}

export function getCoverSize(): number {
  try {
    const raw = localStorage.getItem(LIBRARY_COVER_SIZE_KEY);
    if (raw !== null && raw.trim() !== "") return clampCoverSize(Number(raw));
  } catch {
    // storage unavailable
  }
  return COVER_SIZE_DEFAULT;
}

export function setCoverSize(value: number): void {
  writeValue(LIBRARY_COVER_SIZE_KEY, String(clampCoverSize(value)));
}

/** Installed games expander state (default open). */
export function getInstalledOpen(): boolean {
  return readBool(INSTALLED_OPEN_KEY, true);
}

export function setInstalledOpen(value: boolean): void {
  writeValue(INSTALLED_OPEN_KEY, value ? "true" : "false");
}

/**
 * The Library loads server games without user action only once per app
 * session when auto-load is off: the first search, reload or filter opens
 * the gate for the rest of the session.
 */
let sessionLoadRequested = false;

export function isLibraryLoadAllowed(): boolean {
  return sessionLoadRequested || getLibraryAutoload();
}

export function requestLibraryLoad(): void {
  sessionLoadRequested = true;
}

/** Test helper. */
export function resetLibraryLoadGate(): void {
  sessionLoadRequested = false;
}
