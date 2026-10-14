/**
 * Cloud saves: pure helpers plus thin wrappers around the Rust
 * `cloud_saves` commands. Ludusavi runs in Rust; this module maps results to
 * messages, persists the offline backup queue and builds request payloads.
 */
import type { TranslationKey } from "@/i18n";
import type { InstalledGameInfo } from "@/hooks/useInstalledGames";
import { normalizeAndDedupeInstalledGames } from "@/utils/installedGames";
import { getRootPaths } from "@/utils/rootPaths";
import { getCurrentProfileId } from "@/utils/profiles";

export const CLOUD_SAVES_README_URL =
  "https://github.com/PlayStash/playstash-app#readme";

/** Fired with the new settings whenever they change. */
export const CLOUD_SAVES_CHANGE_EVENT = "playstash:cloud-saves-change";

export interface CloudSaveSettings {
  enabled: boolean;
  usePrimaryManifest: boolean;
  customManifests: string[];
}

export const DEFAULT_CLOUD_SAVE_SETTINGS: CloudSaveSettings = {
  enabled: false,
  usePrimaryManifest: true,
  customManifests: [],
};

export type CloudSaveStatus =
  | "backupSuccess"
  | "backupFailed"
  | "backupCreationFailed"
  | "backupUploadFailed"
  | "restoreSuccess"
  | "restoreFailed"
  | "upToDate"
  | "settingDisabled"
  | "offline"
  | "localNewer"
  | "keptLocal"
  | "toolMissing";

export interface CloudSaveOutcome {
  status: CloudSaveStatus;
  httpStatus?: number;
  detail?: string;
  /** Unix ms of the newest local save file (`localNewer` / `keptLocal`). */
  localModifiedAt?: number;
  /** Unix ms when the cloud save was created (`localNewer` / `keptLocal`). */
  cloudCreatedAt?: number;
}

export type RestorePolicy = "ask" | "overwrite" | "keepLocal";

/** Payload of `cloud_save_backup` / `cloud_save_restore`. */
export interface CloudSaveRequest {
  gameId: number;
  versionDirectory: string;
  installationPath: string;
  title: string;
  serverUrl: string;
  userId: number;
  accessToken: string;
  winePrefix?: string | null;
  roots: string[];
  /** The login profile; its folder holds the Ludusavi config (Rust). */
  profileKey?: string | null;
}

const STATUS_MESSAGES: Record<CloudSaveStatus, TranslationKey> = {
  backupSuccess: "cloudSaves.status.backupSuccess",
  backupFailed: "cloudSaves.status.backupFailed",
  backupCreationFailed: "cloudSaves.status.backupCreationFailed",
  backupUploadFailed: "cloudSaves.status.backupUploadFailed",
  restoreSuccess: "cloudSaves.status.restoreSuccess",
  restoreFailed: "cloudSaves.status.restoreFailed",
  upToDate: "cloudSaves.status.upToDate",
  settingDisabled: "cloudSaves.status.settingDisabled",
  offline: "cloudSaves.status.offline",
  localNewer: "cloudSaves.status.keptLocal",
  keptLocal: "cloudSaves.status.keptLocal",
  toolMissing: "cloudSaves.status.toolMissing",
};

/**
 * The message for an outcome, or `null` when nothing should be shown. HTTP
 * 405 means cloud saves are disabled on the server; 404 means there is no
 * cloud save yet and stays silent.
 */
export function cloudSaveMessageKey(
  outcome: Pick<CloudSaveOutcome, "status" | "httpStatus">,
): TranslationKey | null {
  if (outcome.httpStatus === 405) return "cloudSaves.status.serverDisabled";
  if (outcome.status === "restoreFailed" && outcome.httpStatus === 404) {
    return null;
  }
  return STATUS_MESSAGES[outcome.status] ?? null;
}

/** Toast tone for an outcome. */
export function cloudSaveTone(
  status: CloudSaveStatus,
): "success" | "info" | "warning" | "danger" {
  switch (status) {
    case "backupSuccess":
    case "restoreSuccess":
      return "success";
    case "upToDate":
    case "keptLocal":
    case "localNewer":
      return "info";
    case "settingDisabled":
    case "offline":
    case "toolMissing":
      return "warning";
    default:
      return "danger";
  }
}

/** Replaces `{name}` placeholders in a translated template. */
export function formatTemplate(
  template: string,
  values: Record<string, string | number>,
): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name)
      ? String(values[name])
      : match,
  );
}

/** The title Ludusavi searches for: `metadata.title`, falling back to `title`. */
export function cloudSaveSearchTitle(
  game:
    | { title?: string | null; metadata?: { title?: string | null } | null }
    | null
    | undefined,
): string {
  const metadataTitle = game?.metadata?.title?.trim();
  if (metadataTitle) return metadataTitle;
  return game?.title?.trim() ?? "";
}

// ── Offline backup queue ────────────────────────────────────────────────────

const PENDING_PREFIX = "playstash:cloudsave-pending:";

export function pendingQueueKey(serverUrl: string, userId: number): string {
  return `${PENDING_PREFIX}${serverUrl.replace(/\/+$/, "")}:${userId}`;
}

export function readPendingBackups(key: string): number[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return Array.from(
      new Set(
        parsed.map(Number).filter((id) => Number.isInteger(id) && id > 0),
      ),
    );
  } catch {
    return [];
  }
}

function writePendingBackups(key: string, ids: number[]): void {
  try {
    if (ids.length) localStorage.setItem(key, JSON.stringify(ids));
    else localStorage.removeItem(key);
  } catch {
    // Without storage the queue only lives as long as this call.
  }
}

/** Queues a game for backup once the client is online again (deduplicated). */
export function addPendingBackup(key: string, gameId: number): number[] {
  const ids = readPendingBackups(key);
  if (!ids.includes(gameId)) ids.push(gameId);
  writePendingBackups(key, ids);
  return ids;
}

export function removePendingBackup(key: string, gameId: number): number[] {
  const ids = readPendingBackups(key).filter((id) => id !== gameId);
  writePendingBackups(key, ids);
  return ids;
}

/**
 * Remembers when each game was last backed up and allows a new backup only
 * after `windowMs`, so the tracker and the launch monitor do not both upload
 * the same session.
 */
export function createBackupDeduper(
  windowMs = 60_000,
  now: () => number = Date.now,
) {
  const last = new Map<number, number>();
  return {
    shouldRun(gameId: number): boolean {
      const time = now();
      const previous = last.get(gameId);
      if (previous !== undefined && time - previous < windowMs) return false;
      last.set(gameId, time);
      return true;
    },
    forget(gameId: number): void {
      last.delete(gameId);
    },
  };
}

// ── Installed games ─────────────────────────────────────────────────────────

/** All installed versions on every download root (desktop only). */
export async function listInstalledVersions(): Promise<InstalledGameInfo[]> {
  const { invoke } = await import("@tauri-apps/api/core");
  const raw: unknown[] = [];
  for (const root of getRootPaths()) {
    const results = await invoke<unknown[]>("list_installed_games", {
      selectedRoot: root.path,
    }).catch(() => [] as unknown[]);
    raw.push(...results);
  }
  return normalizeAndDedupeInstalledGames(raw);
}

/** The most recently installed version of a game, if any. */
export function newestInstalledVersion(
  versions: InstalledGameInfo[],
  gameId: number,
): InstalledGameInfo | undefined {
  return versions
    .filter((version) => version.gameId === gameId)
    .sort((a, b) => b.installedAt - a.installedAt)[0];
}

/** Title of an installed game from its cached server data or folder name. */
export async function installedGameTitle(
  installed: InstalledGameInfo,
): Promise<string> {
  const fromMetadata = cloudSaveSearchTitle(
    (installed.cachedMetadata as Parameters<typeof cloudSaveSearchTitle>[0]) ??
      null,
  );
  if (fromMetadata) return fromMetadata;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const cached = await invoke<string | null>("load_cached_game", {
      gameId: installed.gameId,
    });
    const title = cached ? cloudSaveSearchTitle(JSON.parse(cached)) : "";
    if (title) return title;
  } catch {
    // Fall back to the folder name below.
  }
  return installed.gameTitle.trim();
}

// ── Rust commands ───────────────────────────────────────────────────────────

function emitSettings(settings: CloudSaveSettings): CloudSaveSettings {
  try {
    window.dispatchEvent(
      new CustomEvent<CloudSaveSettings>(CLOUD_SAVES_CHANGE_EVENT, {
        detail: settings,
      }),
    );
  } catch {
    // No window (tests without DOM).
  }
  return settings;
}

export async function getCloudSaveSettings(): Promise<CloudSaveSettings> {
  const { invoke } = await import("@tauri-apps/api/core");
  return {
    ...DEFAULT_CLOUD_SAVE_SETTINGS,
    ...(await invoke<CloudSaveSettings>("get_cloud_save_settings")),
  };
}

export async function setCloudSavesEnabled(
  enabled: boolean,
): Promise<CloudSaveSettings> {
  const { invoke } = await import("@tauri-apps/api/core");
  return emitSettings(
    await invoke<CloudSaveSettings>("set_cloud_saves_enabled", { enabled }),
  );
}

export async function setUsePrimaryManifest(
  enabled: boolean,
): Promise<CloudSaveSettings> {
  const { invoke } = await import("@tauri-apps/api/core");
  return emitSettings(
    await invoke<CloudSaveSettings>("set_cloud_save_use_primary_manifest", {
      enabled,
    }),
  );
}

export async function setCustomManifests(
  manifests: string[],
): Promise<CloudSaveSettings> {
  const { invoke } = await import("@tauri-apps/api/core");
  return emitSettings(
    await invoke<CloudSaveSettings>("set_cloud_save_custom_manifests", {
      manifests,
    }),
  );
}

export async function getLudusaviStatus(): Promise<{
  available: boolean;
  path: string | null;
}> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke("get_ludusavi_status");
}

/** Ludusavi's title for a game, or "" (cached per game in Rust). */
export async function matchCloudSaveTitle(options: {
  gameId: number;
  title: string;
  installationPath?: string;
}): Promise<string> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string>("cloud_save_match_title", {
    gameId: options.gameId,
    title: options.title,
    installationPath: options.installationPath ?? null,
    roots: getRootPaths().map((root) => root.path),
    profileKey: getCurrentProfileId(),
  });
}

export function buildCloudSaveRequest(options: {
  gameId: number;
  versionDirectory: string;
  installationPath: string;
  title: string;
  serverUrl: string;
  userId: number;
  accessToken: string;
  winePrefix?: string | null;
  roots?: string[];
  profileKey?: string | null;
}): CloudSaveRequest {
  return {
    gameId: options.gameId,
    versionDirectory: options.versionDirectory,
    installationPath: options.installationPath,
    title: options.title,
    serverUrl: options.serverUrl.replace(/\/+$/, ""),
    userId: options.userId,
    accessToken: options.accessToken,
    winePrefix: options.winePrefix?.trim() || null,
    roots: options.roots ?? getRootPaths().map((root) => root.path),
    profileKey:
      options.profileKey === undefined
        ? getCurrentProfileId()
        : options.profileKey,
  };
}

export async function backupCloudSave(
  request: CloudSaveRequest,
): Promise<CloudSaveOutcome> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<CloudSaveOutcome>("cloud_save_backup", { request });
}

export async function restoreCloudSave(
  request: CloudSaveRequest,
  policy: RestorePolicy = "ask",
): Promise<CloudSaveOutcome> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<CloudSaveOutcome>("cloud_save_restore", { request, policy });
}

/**
 * Restores the cloud save. When the local save is newer, an interactive
 * restore asks `confirmUseCloud`; otherwise the local save is kept.
 */
export async function restoreWithConflictPrompt(
  request: CloudSaveRequest,
  options: {
    interactive: boolean;
    confirmUseCloud: (outcome: CloudSaveOutcome) => Promise<boolean>;
  },
): Promise<CloudSaveOutcome> {
  const outcome = await restoreCloudSave(
    request,
    options.interactive ? "ask" : "keepLocal",
  );
  if (outcome.status !== "localNewer") return outcome;
  return (await options.confirmUseCloud(outcome))
    ? restoreCloudSave(request, "overwrite")
    : { ...outcome, status: "keptLocal" };
}

/** `showAlert` options for the "local save is newer" question. */
export function conflictDialog(
  outcome: CloudSaveOutcome,
  t: (key: TranslationKey) => string,
) {
  const formatTime = (value?: number) =>
    value ? new Date(value).toLocaleString() : "—";
  return {
    title: t("cloudSaves.conflict.title"),
    description: formatTemplate(t("cloudSaves.conflict.description"), {
      local: formatTime(outcome.localModifiedAt),
      cloud: formatTime(outcome.cloudCreatedAt),
    }),
    affirmativeText: t("cloudSaves.conflict.useCloud"),
    negativeText: t("cloudSaves.conflict.keepLocal"),
    tone: "warning" as const,
  };
}

/** Installation ids already stored for the given version folders. */
export async function getInstallationIds(
  versionDirectories: string[],
): Promise<string[]> {
  if (!versionDirectories.length) return [];
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string[]>("get_cloud_save_installation_ids", {
    versionDirectories,
  });
}

/** The installation id of a version folder (created on first use). */
export async function getInstallationId(
  versionDirectory: string,
): Promise<string> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string>("get_cloud_save_installation_id", {
    versionDirectory,
  });
}
