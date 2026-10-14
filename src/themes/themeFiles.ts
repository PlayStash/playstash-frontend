/**
 * Installed (custom) theme files.
 *
 * - Desktop: XAML files in `<app_data_dir>/themes/` (per profile
 *   `<app_data_dir>/profiles/<id>/themes/`), handled by `themes.rs`.
 * - Web: the same documents (and overlay images) kept in IndexedDB, with
 *   paths of the form `web:<id>`.
 *
 * Every document is validated with {@link parseThemeXaml}; invalid files are
 * skipped silently when listing (WPF behaviour).
 */
import { openDB, type IDBPDatabase } from "idb";
import { isTauriApp } from "@/utils/tauri";
import { getCurrentProfileId } from "@/utils/profiles";
import {
  parseThemeXaml,
  pathExtension,
  THEME_ERRORS,
  THEME_MAX_OVERLAY_BYTES,
  ThemeValidationError,
  tryParseThemeXaml,
  type ThemeDefinition,
} from "./xamlTheme";

export interface InstalledTheme {
  /** Absolute file path (desktop) or `web:<id>`. */
  path: string;
  definition: ThemeDefinition;
}

export const WEB_THEME_PREFIX = "web:";

export function isWebThemePath(path: string): boolean {
  return path.startsWith(WEB_THEME_PREFIX);
}

async function invoke<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
  return tauriInvoke<T>(command, args);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

const IMAGE_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
};

export function imageMimeType(path: string): string {
  return IMAGE_TYPES[pathExtension(path)] ?? "application/octet-stream";
}

// ── Web store (IndexedDB) ───────────────────────────────────────────────

interface WebThemeRecord {
  id: string;
  profileId: string;
  content: string;
  overlayName?: string;
  overlay?: Blob;
  addedAt: number;
}

const DB_NAME = "playstash-themes";
const STORE = "themes";
let dbPromise: Promise<IDBPDatabase> | null = null;

function webDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "id" });
        }
      },
    });
  }
  return dbPromise;
}

function profileKey(): string {
  return getCurrentProfileId() ?? "";
}

function newId(): string {
  try {
    return crypto.randomUUID().replace(/-/g, "");
  } catch {
    return `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  }
}

async function webRecords(): Promise<WebThemeRecord[]> {
  const db = await webDb();
  const all = (await db.getAll(STORE)) as WebThemeRecord[];
  return all
    .filter((record) => record.profileId === profileKey())
    .sort((a, b) => a.addedAt - b.addedAt);
}

async function webRecord(path: string): Promise<WebThemeRecord | undefined> {
  const db = await webDb();
  return (await db.get(STORE, path.slice(WEB_THEME_PREFIX.length))) as
    WebThemeRecord | undefined;
}

// ── Public API ──────────────────────────────────────────────────────────

/** The themes folder (desktop). Created when `create` is set. */
export async function getThemesDirectory(create = false): Promise<string> {
  return invoke<string>("themes_dir", {
    profileId: getCurrentProfileId(),
    create,
  });
}

/** Lists valid installed themes (invalid files are skipped). */
export async function listInstalledThemes(): Promise<InstalledTheme[]> {
  if (isTauriApp()) {
    try {
      const files = await invoke<{ path: string; content: string }[]>(
        "themes_list",
        { profileId: getCurrentProfileId() },
      );
      return files.flatMap((file) => {
        const definition = tryParseThemeXaml(file.content);
        return definition ? [{ path: file.path, definition }] : [];
      });
    } catch {
      return [];
    }
  }
  try {
    const records = await webRecords();
    return records.flatMap((record) => {
      const definition = tryParseThemeXaml(record.content);
      if (!definition) return [];
      if (definition.overlay && !record.overlay) return [];
      return [{ path: `${WEB_THEME_PREFIX}${record.id}`, definition }];
    });
  } catch {
    return [];
  }
}

/** Reads and validates one installed theme. Throws the WPF error text. */
export async function readInstalledTheme(
  path: string,
): Promise<ThemeDefinition> {
  if (isWebThemePath(path)) {
    const record = await webRecord(path);
    if (!record) throw new ThemeValidationError(THEME_ERRORS.localFiles);
    return parseThemeXaml(record.content);
  }
  const content = await invoke<string>("theme_read", {
    profileId: getCurrentProfileId(),
    path,
  });
  return parseThemeXaml(content);
}

/** Loads the overlay image of an installed theme as a Blob. */
export async function loadThemeOverlay(
  path: string,
  definition: ThemeDefinition,
): Promise<Blob | null> {
  if (!definition.overlay) return null;
  if (isWebThemePath(path)) {
    const record = await webRecord(path);
    return record?.overlay ?? null;
  }
  const base64 = await invoke<string>("theme_overlay_bytes", {
    profileId: getCurrentProfileId(),
    themePath: path,
    relPath: definition.overlay,
  });
  return new Blob([base64ToBytes(base64) as BlobPart], {
    type: imageMimeType(definition.overlay),
  });
}

export interface ThemeInstallInput {
  /** File name incl. `.xaml` (desktop). */
  fileName: string;
  content: string;
  overlay?: { relPath: string; bytes: Uint8Array } | null;
}

/** Validates and stores a theme. Returns its path. */
export async function installThemeFile(
  input: ThemeInstallInput,
): Promise<string> {
  const definition = parseThemeXaml(input.content);
  if (definition.overlay && !input.overlay) {
    throw new ThemeValidationError(THEME_ERRORS.localFiles);
  }
  if (input.overlay && input.overlay.bytes.length > THEME_MAX_OVERLAY_BYTES) {
    throw new ThemeValidationError(THEME_ERRORS.imageTooLarge);
  }
  if (isTauriApp()) {
    return invoke<string>("theme_write", {
      profileId: getCurrentProfileId(),
      fileName: input.fileName,
      content: input.content,
      overlayRelPath: input.overlay?.relPath ?? null,
      overlayBase64: input.overlay ? bytesToBase64(input.overlay.bytes) : null,
    });
  }
  const db = await webDb();
  const record: WebThemeRecord = {
    id: newId(),
    profileId: profileKey(),
    content: input.content,
    addedAt: Date.now(),
  };
  if (input.overlay && definition.overlay) {
    record.overlayName = definition.overlay;
    record.overlay = new Blob([input.overlay.bytes as BlobPart], {
      type: imageMimeType(definition.overlay),
    });
  }
  await db.put(STORE, record);
  return `${WEB_THEME_PREFIX}${record.id}`;
}

/** Deletes a theme file and its overlay image. */
export async function deleteInstalledTheme(
  path: string,
  definition?: ThemeDefinition | null,
): Promise<void> {
  if (isWebThemePath(path)) {
    const db = await webDb();
    await db.delete(STORE, path.slice(WEB_THEME_PREFIX.length));
    return;
  }
  await invoke("theme_delete", {
    profileId: getCurrentProfileId(),
    path,
    overlayRelPath: definition?.overlay ?? null,
  });
}

/** `Theme-<guid without dashes>.xaml`, the WPF install file name. */
export function newThemeFileName(): string {
  return `Theme-${newId()}.xaml`;
}

/** Opens the themes folder, creating it first when missing (desktop). */
export async function openThemesFolder(): Promise<void> {
  const dir = await getThemesDirectory(true);
  await invoke("open_in_file_explorer", { path: dir });
}
