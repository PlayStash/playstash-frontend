import { isTauriApp } from "@/utils/tauri";
import { normalizeServerUrl } from "@/utils/authConfig";
import { setLanguage } from "@/i18n";
import {
  createProfileId,
  findDuplicateProfile,
  getProfilesState,
  loadProfiles,
  profileScopedKey,
  updateProfiles,
  upsertProfile,
  type Profile,
} from "@/utils/profiles";
import {
  getAdditionalRequestHeaderList,
  initRequestHeaders,
  saveAdditionalRequestHeaders,
  type RequestHeader,
} from "@/utils/requestHeaders";
import { serverFetch } from "@/utils/serverFetch";
import { storeRefreshTokenFor } from "@/utils/tokenStorage";
import { addRootPath, getRootPaths } from "@/utils/rootPaths";
import { setDefaultExtractionPassword } from "@/utils/extractionPassword";
import { presenceStorageKey } from "@/utils/communityNotifications";
import { BUILTIN_THEME_SOURCES, getBuiltinThemes } from "@/themes/builtins";

/**
 * Import from the previous WPF client. Rust (`legacy_import.rs`) reads and
 * decrypts the Preferences files; this module decides where every value
 * lands. `LEGACY_SETTING_TARGETS` and Rust `LEGACY_KEYS` list the same keys.
 *
 * Machine settings (download roots, install preferences, …) were per profile
 * in WPF but are global now, so they come from the last used profile (or the
 * first one). Account settings (theme, artwork providers, presence, chat
 * and activity notifications, the default extraction password) stay per
 * profile.
 */

/** `legacy_import_scan` result. */
export interface LegacyScan {
  found: boolean;
  global: Record<string, string>;
  profiles: LegacyProfileScan[];
  skipped: string[];
}

export interface LegacyProfileScan {
  rootDir: string;
  values: Record<string, string>;
  themeFiles: string[];
}

type Converter = (value: string) => unknown;

export type LegacyTarget =
  /** Global localStorage key. */
  | { kind: "local"; key: string; convert: Converter; whenMissing?: string }
  /** localStorage key namespaced to the imported profile. */
  | { kind: "profileLocal"; key: string; convert: Converter }
  /** A field of another package's Rust settings section. */
  | {
      kind: "section";
      section: "integrations" | "cloudsaves" | "startup";
      field: string;
      convert: Converter;
      whenMissing?: string;
    }
  /** Handled explicitly in `importLegacyData`. */
  | { kind: "special"; owner: string };

const flag: Converter = (value) => (value.trim() === "1" ? "1" : "0");
/** Booleans stored as "true"/"false" by their owner (mapped title). */
const trueFalse: Converter = (value) =>
  value.trim() === "1" ? "true" : "false";
const bool: Converter = (value) => value.trim() === "1";
const raw: Converter = (value) => value.trim() || null;
const number: Converter = (value) => {
  const parsed = Number(value.trim().replace(",", "."));
  return Number.isFinite(parsed) && parsed >= 0 ? String(parsed) : null;
};
const integer: Converter = (value) => {
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? String(parsed) : null;
};
const list: Converter = (value) =>
  value
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean);
/** WPF "asc"/"desc" → the Library's "ASC"/"DESC". */
const order: Converter = (value) =>
  ["ASC", "DESC"].includes(value.trim().toUpperCase())
    ? value.trim().toUpperCase()
    : null;
const artworkProviders: Converter = (value) => {
  try {
    const parsed = JSON.parse(value) as { Name?: string; Url?: string }[];
    if (!Array.isArray(parsed)) return null;
    return JSON.stringify(
      parsed
        .filter((entry) => entry?.Name && entry?.Url)
        .map((entry) => ({ name: entry.Name, url: entry.Url })),
    );
  } catch {
    return null;
  }
};

/**
 * WPF key → destination. Keys of other packages follow their specs:
 * WP2 (notifications, integrations section), WP3 (cloudsaves section),
 * WP4 (big picture on start), WP5 (install flags, ISO mount, shortcut),
 * WP7 (theme, library, startup section, artwork providers, media volume).
 */
export const LEGACY_SETTING_TARGETS: Record<string, LegacyTarget> = {
  LoginRememberMe: { kind: "special", owner: "WP6 profiles.rememberMe" },
  LastUserProfile: { kind: "special", owner: "WP6 profiles.lastProfileId" },
  AdditionalRequestHeaders: { kind: "special", owner: "WP6 request headers" },
  ApplicationLanguage: {
    kind: "special",
    owner: "playstash_interface_language",
  },
  ServerUrl: { kind: "special", owner: "WP6 profile.serverUrl" },
  Username: { kind: "special", owner: "WP6 profile.username" },
  IsLoggedInWithSSO: { kind: "special", owner: "WP6 profile.sso" },
  UserID: { kind: "special", owner: "WP6 profile.userId" },
  SessionToken: { kind: "special", owner: "WP6 refresh_token:<profileId>" },
  ExtractionPassword: {
    kind: "special",
    owner: "default_extraction_password:<profileId> (extractionPassword.ts)",
  },
  Theme: { kind: "special", owner: "WP7 playstash_theme (per profile)" },
  RootDirectories: { kind: "special", owner: "tauri_download_paths" },
  CommunityPresence: {
    kind: "special",
    owner: "WP2 presence (per profile and account)",
  },
  BackgroundStart: {
    kind: "special",
    owner: "tauri_start_minimized + set_start_minimized",
  },
  AutoExtract: { kind: "local", key: "tauri_auto_extract", convert: flag },
  AutoInstallPortable: {
    kind: "local",
    key: "tauri_auto_install",
    convert: flag,
    whenMissing: "1",
  },
  AutoDeletePortable: {
    kind: "local",
    key: "tauri_auto_delete_source",
    convert: flag,
  },
  DownloadLimit: {
    kind: "local",
    key: "download_speed_limit_kb",
    convert: integer,
  },
  ShowMappedTitle: {
    kind: "local",
    key: "playstash_show_mapped_title",
    convert: trueFalse,
    whenMissing: "1",
  },
  FullscreenLibrary: {
    kind: "local",
    key: "playstash_big_picture_on_start",
    convert: flag,
  },
  StartupSound: {
    kind: "section",
    section: "startup",
    field: "startupSound",
    convert: raw,
  },
  ChatNotifications: {
    kind: "profileLocal",
    key: "playstash_chat_notifications",
    convert: flag,
  },
  ActivityNotifications: {
    kind: "profileLocal",
    key: "playstash_activity_notifications",
    convert: flag,
  },
  SyncSteamShortcuts: {
    kind: "section",
    section: "integrations",
    field: "syncSteamShortcuts",
    convert: bool,
  },
  SyncDiscordPresence: {
    kind: "section",
    section: "integrations",
    field: "syncDiscordPresence",
    convert: bool,
  },
  DiscordApplicationId: {
    kind: "section",
    section: "integrations",
    field: "discordApplicationId",
    convert: raw,
  },
  CloudSaves: {
    kind: "section",
    section: "cloudsaves",
    field: "enabled",
    convert: bool,
  },
  UsePrimaryCloudSaveManifest: {
    kind: "section",
    section: "cloudsaves",
    field: "usePrimaryManifest",
    convert: bool,
    whenMissing: "1",
  },
  CustomCloudSaveManifests: {
    kind: "section",
    section: "cloudsaves",
    field: "customManifests",
    convert: list,
  },
  MountIso: { kind: "local", key: "tauri_mount_iso", convert: flag },
  CreateDesktopShortcut: {
    kind: "local",
    key: "tauri_create_desktop_shortcut",
    convert: flag,
  },
  LibStartup: {
    kind: "local",
    key: "playstash_library_autoload",
    convert: flag,
    whenMissing: "1",
  },
  RetainLibarySortByAndOrderBy: {
    kind: "local",
    key: "playstash_library_retain",
    convert: flag,
  },
  LastLibrarySortBy: { kind: "local", key: "app_library_sort", convert: raw },
  LastLibraryOrderBy: {
    kind: "local",
    key: "app_library_order",
    convert: order,
  },
  ArtworkSearchProviders: {
    kind: "profileLocal",
    key: "playstash_artwork_search_providers",
    convert: artworkProviders,
  },
  MediaSliderVolume: {
    kind: "local",
    key: "playstash_media_volume",
    convert: number,
  },
};

export interface MappedSettings {
  local: Record<string, string>;
  profileLocal: Record<string, string>;
  sections: Record<string, Record<string, unknown>>;
}

/** Maps the non-special WPF keys of one profile to their destinations. */
export function mapLegacySettings(
  values: Record<string, string>,
): MappedSettings {
  const mapped: MappedSettings = { local: {}, profileLocal: {}, sections: {} };
  for (const [key, target] of Object.entries(LEGACY_SETTING_TARGETS)) {
    if (target.kind === "special") continue;
    const present = typeof values[key] === "string" && values[key] !== "";
    const source = present
      ? values[key]
      : "whenMissing" in target
        ? target.whenMissing
        : undefined;
    if (source === undefined) continue;
    const converted = target.convert(source);
    if (converted === null || converted === undefined) continue;
    if (target.kind === "local") mapped.local[target.key] = String(converted);
    else if (target.kind === "profileLocal")
      mapped.profileLocal[target.key] = String(converted);
    else {
      mapped.sections[target.section] ??= {};
      mapped.sections[target.section][target.field] = converted;
    }
  }
  return mapped;
}

/** WPF `AdditionalRequestHeaders`: JSON `[{Name, Value}]`. */
export function parseLegacyHeaders(value: string | undefined): RequestHeader[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as { Name?: string; Value?: string }[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry) => entry?.Name?.trim() && entry?.Value?.trim())
      .map((entry) => ({
        name: entry.Name!.trim(),
        value: entry.Value!.trim(),
      }));
  } catch {
    return [];
  }
}

const BUILTIN_THEME_IDS = new Set(BUILTIN_THEME_SOURCES.map(([id]) => id));

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? "";
}

/**
 * The path of `path` below `dir` (both WPF paths) with `\` separators, or
 * null when it is not inside.
 */
function relativeToDir(path: string, dir: string): string | null {
  const normalize = (value: string) =>
    value.replace(/[\\/]+/g, "\\").replace(/\\$/, "");
  const base = normalize(dir);
  const full = normalize(path);
  if (!base || !full.toLowerCase().startsWith(`${base.toLowerCase()}\\`))
    return null;
  const relative = full.slice(base.length + 1);
  return relative.split("\\").some((part) => !part || part === "..")
    ? null
    : relative;
}

/**
 * WPF `Theme`: JSON `ThemeItem {DisplayName, Description, Author, Path}`.
 *
 * - Built-in themes have a `pack://…/Themes/<Id>.xaml` path; `<Id>` is the
 *   WP7 built-in id (`ThemeDefaultDark`, …). Other values fall back to a
 *   built-in theme with the same display name.
 * - Custom themes point into the WPF profile's `themes` folder
 *   (`legacyThemesDir`), which was copied to `copiedThemeDir` keeping its
 *   sub folders.
 *
 * Returns the WP7 `playstash_theme` selection JSON, or null (default theme).
 */
export function mapLegacyTheme(
  value: string | undefined,
  copiedThemeDir: string | null,
  legacyThemesDir?: string,
): string | null {
  if (!value) return null;
  try {
    const item = JSON.parse(value) as { DisplayName?: string; Path?: string };
    const displayName = item?.DisplayName?.trim();
    if (!displayName) return null;
    const path = (item.Path ?? "").trim();
    const name = fileName(path);
    const builtinId = name.replace(/\.xaml$/i, "");
    if (/^pack:/i.test(path) && BUILTIN_THEME_IDS.has(builtinId)) {
      return JSON.stringify({ source: "builtin", id: builtinId, displayName });
    }
    const isFile =
      /\.xaml$/i.test(name) && !/^[a-z][a-z0-9+.-]+:\/\//i.test(path);
    if (copiedThemeDir && isFile) {
      const relative =
        (legacyThemesDir ? relativeToDir(path, legacyThemesDir) : null) ?? name;
      const separator = copiedThemeDir.includes("\\") ? "\\" : "/";
      return JSON.stringify({
        source: "file",
        path: `${copiedThemeDir}${separator}${relative.split("\\").join(separator)}`,
        displayName,
      });
    }
    const builtin = getBuiltinThemes().find(
      (theme) =>
        theme.definition.displayName.trim().toLowerCase() ===
        displayName.toLowerCase(),
    );
    return builtin
      ? JSON.stringify({
          source: "builtin",
          id: builtin.id,
          displayName: builtin.definition.displayName,
        })
      : null;
  } catch {
    return null;
  }
}

export interface LegacyImportReport {
  profiles: number;
  sessionsRestored: number;
  roots: string[];
  skipped: string[];
}

async function invokeCommand<T>(
  command: string,
  args?: Record<string, unknown>,
) {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}

export async function isLegacyImportAvailable(): Promise<boolean> {
  if (!isTauriApp()) return false;
  try {
    return await invokeCommand<boolean>("legacy_import_available");
  } catch {
    return false;
  }
}

export function scanLegacyData(): Promise<LegacyScan> {
  return invokeCommand<LegacyScan>("legacy_import_scan");
}

/** Trades a WPF session token for a fresh refresh token (no re-login needed). */
async function exchangeSessionToken(
  server: string,
  token: string,
): Promise<string | null> {
  try {
    const response = await serverFetch(
      `${server}/api/auth/refresh`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: "",
        signal: AbortSignal.timeout(10_000),
        redirect: "error",
      },
      server,
    );
    if (!response.ok) return null;
    const data = (await response.json()) as { refresh_token?: string };
    return data.refresh_token || null;
  } catch {
    return null;
  }
}

function writeLocal(entries: Record<string, string>) {
  for (const [key, value] of Object.entries(entries)) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* storage unavailable */
    }
  }
}

/**
 * Imports the scanned WPF profiles and settings. Returns what happened;
 * failures of single values are reported in `skipped`, never thrown.
 */
export async function importLegacyData(
  scan: LegacyScan,
): Promise<LegacyImportReport> {
  await loadProfiles();
  await initRequestHeaders();
  const report: LegacyImportReport = {
    profiles: 0,
    sessionsRestored: 0,
    roots: [],
    skipped: [...scan.skipped],
  };

  // Global: request headers (appended), language.
  const headers = parseLegacyHeaders(scan.global.AdditionalRequestHeaders);
  if (headers.length) {
    const existing = getAdditionalRequestHeaderList();
    const names = new Set(existing.map((entry) => entry.name.toLowerCase()));
    try {
      await saveAdditionalRequestHeaders([
        ...existing,
        ...headers.filter((entry) => !names.has(entry.name.toLowerCase())),
      ]);
    } catch (error) {
      report.skipped.push(
        `AdditionalRequestHeaders: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  const language = (scan.global.ApplicationLanguage ?? "").toLowerCase();
  if (language.startsWith("de")) setLanguage("de");
  else if (language.startsWith("en")) setLanguage("en");

  const lastLegacyDir = scan.global.LastUserProfile ?? "";
  const importedIds = new Map<string, string>();
  for (const legacy of scan.profiles) {
    const values = legacy.values;
    const serverUrl = normalizeServerUrl(values.ServerUrl ?? "");
    const username = (values.Username ?? "").trim();
    if (!serverUrl || !username) {
      report.skipped.push(`${legacy.rootDir}: invalid server URL or username`);
      continue;
    }
    const existing = findDuplicateProfile(
      getProfilesState().profiles,
      serverUrl,
      username,
    );
    const id = existing?.id ?? createProfileId();
    const userId = Number.parseInt(values.UserID ?? "", 10);
    const now = Date.now();
    const profile: Profile = {
      createdAt: now,
      displayName: null,
      avatarMediaId: null,
      lastUsedAt: legacy.rootDir === lastLegacyDir ? now : 0,
      ...existing,
      id,
      serverUrl,
      username,
      sso: values.IsLoggedInWithSSO === "1",
      userId:
        Number.isFinite(userId) && userId > 0
          ? userId
          : (existing?.userId ?? null),
    };
    await updateProfiles((state) => upsertProfile(state, profile));
    importedIds.set(legacy.rootDir, id);
    report.profiles += 1;

    if (values.SessionToken) {
      const refreshToken = await exchangeSessionToken(
        serverUrl,
        values.SessionToken,
      );
      if (refreshToken) {
        try {
          await storeRefreshTokenFor(id, refreshToken);
          report.sessionsRestored += 1;
        } catch {
          report.skipped.push(`${username}: the session could not be stored`);
        }
      } else {
        report.skipped.push(
          `${username} (${serverUrl}): the session expired, sign in once`,
        );
      }
    }

    // Per-profile settings.
    let themeDir: string | null = null;
    if (legacy.themeFiles.length) {
      try {
        await invokeCommand<number>("legacy_import_copy_themes", {
          legacyProfileDir: legacy.rootDir,
          profileId: id,
        });
        const profileDir = await invokeCommand<string>("get_profile_dir", {
          profileId: id,
        });
        themeDir = `${profileDir}${profileDir.includes("\\") ? "\\" : "/"}themes`;
      } catch (error) {
        report.skipped.push(
          `${username}: themes could not be copied (${String(error)})`,
        );
      }
    }
    const separator = legacy.rootDir.includes("\\") ? "\\" : "/";
    const theme = mapLegacyTheme(
      values.Theme,
      themeDir,
      `${legacy.rootDir}${separator}themes`,
    );
    if (theme) writeLocal({ [profileScopedKey("playstash_theme", id)]: theme });
    const mapped = mapLegacySettings(values);
    writeLocal(
      Object.fromEntries(
        Object.entries(mapped.profileLocal).map(([key, value]) => [
          profileScopedKey(key, id),
          value,
        ]),
      ),
    );
    if (values.CommunityPresence && profile.userId) {
      writeLocal({
        [profileScopedKey(presenceStorageKey(serverUrl, profile.userId), id)]:
          values.CommunityPresence,
      });
    }
    if (values.ExtractionPassword) {
      try {
        await setDefaultExtractionPassword(values.ExtractionPassword, id);
      } catch {
        report.skipped.push(
          `${username}: ExtractionPassword (the vault is unavailable)`,
        );
      }
    }
    for (const root of list(values.RootDirectories ?? "") as string[]) {
      if (!report.roots.includes(root)) report.roots.push(root);
    }
  }

  // Remember me / last profile.
  const lastId = importedIds.get(lastLegacyDir) ?? null;
  await updateProfiles((state) => ({
    ...state,
    rememberMe: scan.global.LoginRememberMe === "1" ? true : state.rememberMe,
    lastProfileId:
      scan.global.LoginRememberMe === "1" && lastId
        ? lastId
        : state.lastProfileId,
  }));

  // Machine settings from the last used (else the first) profile.
  const primary =
    scan.profiles.find((profile) => profile.rootDir === lastLegacyDir) ??
    scan.profiles[0];
  if (primary) {
    const mapped = mapLegacySettings(primary.values);
    writeLocal(mapped.local);
    for (const [section, values] of Object.entries(mapped.sections)) {
      try {
        await invokeCommand("legacy_import_write_section", { section, values });
      } catch (error) {
        report.skipped.push(`${section}: ${String(error)}`);
      }
    }
    if (primary.values.BackgroundStart !== undefined) {
      const minimized = primary.values.BackgroundStart === "1";
      writeLocal({ tauri_start_minimized: minimized ? "1" : "0" });
      try {
        await invokeCommand("set_start_minimized", { minimized });
      } catch {
        /* simulated desktop mode */
      }
    }
  }

  // Download roots: appended (the WPF games live in <root>\PlayStash).
  const known = new Set(
    getRootPaths().map((entry) => entry.path.toLowerCase()),
  );
  for (const root of report.roots) {
    if (known.has(root.toLowerCase())) continue;
    addRootPath(root);
    known.add(root.toLowerCase());
    try {
      await invokeCommand("fs_create_dir_all", { path: `${root}\\PlayStash` });
    } catch {
      /* created on the first download */
    }
  }
  await updateProfiles((state) => ({ ...state, legacyImportOffered: true }));
  return report;
}
