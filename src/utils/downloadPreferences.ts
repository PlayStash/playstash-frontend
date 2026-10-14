/**
 * Download pipeline preferences (WP5). Plain localStorage keys, booleans as
 * "1"/"0", wrapped in try/catch. Each setter dispatches
 * `playstash:download-preferences-change` so open views can follow along.
 */

export const MOUNT_ISO_KEY = "tauri_mount_iso";
export const CREATE_DESKTOP_SHORTCUT_KEY = "tauri_create_desktop_shortcut";
export const LAST_ROOT_ID_KEY = "playstash_last_root_id";
export const AUTO_INSTALL_KEY = "tauri_auto_install";
/** Marker so the auto-install default is applied exactly once. */
export const AUTO_INSTALL_DEFAULT_APPLIED_KEY =
  "playstash_auto_install_default_applied";
export const DOWNLOAD_PREFERENCES_EVENT =
  "playstash:download-preferences-change";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(DOWNLOAD_PREFERENCES_EVENT, { detail: { key, value } }),
    );
  }
}

/** "Mount ISO instead of extracting" (default off). */
export function getMountIsoEnabled(): boolean {
  return read(MOUNT_ISO_KEY) === "1";
}

export function setMountIsoEnabled(enabled: boolean): void {
  write(MOUNT_ISO_KEY, enabled ? "1" : "0");
}

/** "Create Shortcut" toggle of the install flow (default off). */
export function getCreateDesktopShortcutEnabled(): boolean {
  return read(CREATE_DESKTOP_SHORTCUT_KEY) === "1";
}

export function setCreateDesktopShortcutEnabled(enabled: boolean): void {
  write(CREATE_DESKTOP_SHORTCUT_KEY, enabled ? "1" : "0");
}

/** Id of the download location chosen last in the location picker. */
export function getLastRootId(): string | null {
  return read(LAST_ROOT_ID_KEY);
}

export function setLastRootId(id: string): void {
  write(LAST_ROOT_ID_KEY, id);
}

/**
 * Applies the "Auto-Install Portable Games" default once.
 *
 * The old client installed portable games automatically by default. A fresh
 * installation gets that default ("1"). An existing installation without a
 * stored value keeps the behavior it had so far ("0"), so nobody is surprised
 * by installs starting on their own after an update. "Existing" means that
 * the app already has a download location configured.
 */
export function applyAutoInstallDefault(storage: Storage = localStorage): void {
  try {
    if (storage.getItem(AUTO_INSTALL_DEFAULT_APPLIED_KEY) === "1") return;
    if (storage.getItem(AUTO_INSTALL_KEY) === null) {
      const existingInstallation =
        storage.getItem("tauri_download_paths") !== null ||
        storage.getItem("tauri_download_path") !== null;
      storage.setItem(AUTO_INSTALL_KEY, existingInstallation ? "0" : "1");
    }
    storage.setItem(AUTO_INSTALL_DEFAULT_APPLIED_KEY, "1");
  } catch {
    /* storage unavailable */
  }
}

const SIZE_UNITS = ["B", "KB", "MB", "GB", "TB", "PB"];

/**
 * Drive space as shown in the download-location picker: base 1024, one
 * decimal place (e.g. "512.3 GB"). The old client switched units as soon as
 * the next one rounded to 1 and so showed 512 GB as "0.5 TB"; the next unit
 * is only used from 1024 on here.
 */
export function formatDriveSpace(bytes: number, locale?: string): string {
  let value = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  let unit = 0;
  while (value >= 1024 && unit < SIZE_UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  const formatted = value.toLocaleString(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  return `${formatted} ${SIZE_UNITS[unit]}`;
}
