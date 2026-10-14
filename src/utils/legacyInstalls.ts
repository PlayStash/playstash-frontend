import { getRootPaths } from "@/utils/rootPaths";

/**
 * Adoption of games installed by the WPF client
 * (`<root>\PlayStash\Installations\(<id>)<Title>`) into the current layout
 * `<root>/PlayStash/<Title>/Versions/<version>/Installation`, so they show as
 * installed and launch without a new download.
 */
export interface LegacyInstallation {
  root: string;
  path: string;
  gameId: number;
  title: string;
  executableRelative: string | null;
  executable: string;
  launchParameter: string;
  installedGameVersion: string;
  forcedGameType: string | null;
  installationId: string;
}

/** `move` renames the folder (same drive); `link` leaves it and links it in. */
export type AdoptionMode = "move" | "link";

export interface AdoptionResult {
  adopted: string[];
  skipped: string[];
}

/** Set after a legacy import until the installations were offered once. */
export const LEGACY_INSTALLS_PENDING_KEY = "playstash_legacy_installs_pending";

interface ServerVersion {
  id: number;
  version?: string | null;
  type?: string | null;
  indexed_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

interface ServerGame {
  id: number;
  title?: string | null;
  type?: string | null;
  versions?: ServerVersion[] | null;
}

/** The folder name rules of the download pipeline (`DownloadContext`). */
export function sanitizeFolderName(value: string): string {
  return (value || "")
    .replace(/[\\/*?"<>|]/g, "_")
    .replace(/:/g, " - ")
    .replace(/\s+/g, " ")
    .trim();
}

function comparable(title: string): string {
  return title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

/**
 * The server version the legacy install corresponds to: the one whose
 * version tag equals `InstalledGameVersion`, else the newest.
 */
export function pickLegacyVersion(
  versions: ServerVersion[],
  installedVersion: string,
): ServerVersion | null {
  if (!versions.length) return null;
  const wanted = installedVersion.trim();
  if (wanted) {
    const match = versions.find(
      (version) => (version.version ?? "").trim() === wanted,
    );
    if (match) return match;
  }
  return [...versions].sort((a, b) => {
    const at = new Date(
      a.indexed_at ?? a.updated_at ?? a.created_at ?? 0,
    ).getTime();
    const bt = new Date(
      b.indexed_at ?? b.updated_at ?? b.created_at ?? 0,
    ).getTime();
    if (at !== bt) return bt - at;
    return (Number(b.id) || 0) - (Number(a.id) || 0);
  })[0]!;
}

/** The version config written for an adopted install. */
export function buildAdoptedConfig(
  installation: LegacyInstallation,
  game: ServerGame,
  version: ServerVersion,
): Record<string, unknown> {
  const config: Record<string, unknown> = {
    versionid: version.id,
    downloadfinished: true,
    extractionfinished: true,
    installationfinished: true,
    downloadprogress: "",
  };
  const type = version.type ?? game.type;
  if (type) config.gametype = type;
  if (installation.executableRelative)
    config.launchexecutable = installation.executableRelative;
  if (installation.launchParameter.trim())
    config.launchparameters = installation.launchParameter.trim();
  if (installation.forcedGameType)
    config.forcedgametype = installation.forcedGameType;
  // Cloud saves keep their identity (WP3 `installationid`).
  if (installation.installationId.trim())
    config.installationid = installation.installationId.trim();
  return config;
}

async function invokeCommand<T>(
  command: string,
  args?: Record<string, unknown>,
) {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}

export function scanLegacyInstallations(
  roots: string[] = getRootPaths().map((entry) => entry.path),
): Promise<LegacyInstallation[]> {
  return invokeCommand<LegacyInstallation[]>("legacy_scan_installations", {
    roots,
  });
}

/** Adopts the installations of the logged-in server. */
export async function adoptLegacyInstallations(
  installations: LegacyInstallation[],
  mode: AdoptionMode,
  {
    serverUrl,
    authFetch,
  }: {
    serverUrl: string;
    authFetch: (input: string, init?: RequestInit) => Promise<Response>;
  },
): Promise<AdoptionResult> {
  const result: AdoptionResult = { adopted: [], skipped: [] };
  let metadataKey = serverUrl;
  try {
    const status = await authFetch(`${serverUrl}/api/status`);
    if (status.ok) {
      const data = (await status.json()) as { server_uuid?: string };
      if (data.server_uuid) metadataKey = data.server_uuid;
    }
  } catch {
    /* fall back to the server URL like the download pipeline */
  }
  for (const installation of installations) {
    try {
      const response = await authFetch(
        `${serverUrl}/api/games/${installation.gameId}`,
      );
      if (!response.ok) {
        result.skipped.push(`${installation.title}: not found on this server`);
        continue;
      }
      const game = (await response.json()) as ServerGame;
      if (comparable(game.title ?? "") !== comparable(installation.title)) {
        // Game ids are per server: a different title means the folder
        // belongs to another server (or the game was renamed).
        result.skipped.push(
          `${installation.title}: belongs to another server or was renamed`,
        );
        continue;
      }
      const version = pickLegacyVersion(
        game.versions ?? [],
        installation.installedGameVersion,
      );
      if (!version) {
        result.skipped.push(
          `${installation.title}: the server has no version of this game`,
        );
        continue;
      }
      await invokeCommand<string>("legacy_adopt_installation", {
        request: {
          root: installation.root,
          legacyPath: installation.path,
          gameFolder:
            sanitizeFolderName(game.title ?? installation.title) ||
            `Game-${game.id}`,
          versionFolder:
            sanitizeFolderName(version.version ?? "") || "Unspecified",
          config: buildAdoptedConfig(installation, game, version),
          metadataKey,
          gameId: installation.gameId,
          mode,
        },
      });
      result.adopted.push(installation.title);
    } catch (error) {
      result.skipped.push(
        `${installation.title}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return result;
}
