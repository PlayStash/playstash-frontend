/**
 * Reusable download flow (WP5 contract): root pick, version pick, free-space
 * check and overwrite confirmation, then queue the download.
 * Used by GameView, GameCard and desktop commands (CLI `install`).
 *
 * The flow itself is plain TypeScript ({@link runDownloadFlow}); everything it
 * needs from React (auth, the download context, dialogs, navigation) comes
 * from a host that `DownloadFlowHost` registers while the app is mounted.
 */
import { translate } from "@/i18n";
import type { GameVersion } from "@/api/models/GameVersion";
import type {
  PlaystashGame,
  PlaystashGameTypeEnum,
} from "@/api/models/PlaystashGame";
import type { ActiveDownload } from "@/context/DownloadContext";
import type { RootPathEntry } from "@/utils/rootPaths";
import { getRootPaths } from "@/utils/rootPaths";
import { getLastRootId, setLastRootId } from "@/utils/downloadPreferences";
import { isTauriApp } from "@/utils/tauri";
import { fillTemplate as fill, isCardBusy } from "@/utils/downloadPipeline";

export type RequestGameDownloadResult = "queued" | "cancelled" | "error";

export interface RequestGameDownloadOptions {
  gameId: number;
  /**
   * No dialogs that need an answer: the last used download location (or the
   * first) and the newest version are chosen, overwrites are confirmed.
   */
  background?: boolean;
  /** Extract and install this download automatically (CLI `--autoinstall`). */
  autoInstall?: boolean;
  /** Download this version instead of asking. */
  versionId?: number;
}

export interface StartDownloadRequest {
  gameId: number;
  versionId: number;
  versionName?: string;
  gameTitle: string;
  gameMetadata?: PlaystashGame["metadata"];
  gameType?: PlaystashGameTypeEnum;
  filename: string;
  downloadRootPath?: string;
  autoInstall?: boolean;
}

/** What the flow needs from the running app. */
export interface DownloadFlowHost {
  /** Logged in and the server is reachable. */
  isReady(): boolean;
  /** `GET /api/games/{id}`; null when the game does not exist. */
  fetchGame(gameId: number): Promise<PlaystashGame | null>;
  getDownloads(): Record<number, ActiveDownload>;
  startDownload(request: StartDownloadRequest): void;
  /** Removes an existing card and its download/extraction files. */
  deleteDownloadCard(gameId: number): Promise<void>;
  /** Title-only toast. */
  toast(title: string): void;
  /** Message dialog; with `cancelText` it is a confirmation. */
  confirm(options: {
    title: string;
    message: string;
    confirmText: string;
    cancelText?: string;
  }): Promise<boolean>;
  /** Download-location picker. "settings" = the user opened the settings. */
  pickRoot(options: {
    gameTitle: string;
    roots: RootPathEntry[];
    preselectId: string | null;
  }): Promise<RootPathEntry | "settings" | null>;
  pickVersion(options: {
    gameTitle: string;
    versions: GameVersion[];
  }): Promise<GameVersion | null>;
  navigate(path: string): void;
  /** null when it cannot be determined (the check is then skipped). */
  pathExists(path: string): Promise<boolean | null>;
  /** Free bytes on the drive of `path`; null when unknown. */
  freeSpace(path: string): Promise<number | null>;
}

let host: DownloadFlowHost | null = null;
const pendingGameIds = new Set<number>();

/** Registers the app host. Returns the unregister function. */
export function registerDownloadFlowHost(next: DownloadFlowHost): () => void {
  host = next;
  return () => {
    if (host === next) host = null;
  };
}

export function gameDisplayTitle(game: PlaystashGame): string {
  return game.metadata?.title || game.title || `Game ${game.id}`;
}

function indexedAtMs(version: GameVersion): number {
  const value = version.indexed_at as Date | string | undefined;
  const time =
    value instanceof Date ? value.getTime() : Date.parse(value ?? "");
  return Number.isFinite(time) ? time : 0;
}

/** The most recently indexed version. */
export function newestVersion(versions: GameVersion[]): GameVersion | null {
  if (!versions.length) return null;
  return versions.reduce((best, version) =>
    indexedAtMs(version) > indexedAtMs(best) ? version : best,
  );
}

export function versionFilename(
  version: GameVersion,
  gameTitle: string,
): string {
  const fromPath = version.file_path?.split(/[/\\]/).pop()?.trim();
  return fromPath ? fromPath : `${gameTitle}.zip`;
}

/** Drive label for messages: `D:\` on Windows paths, otherwise the path. */
export function driveLabel(path: string): string {
  const match = /^([a-zA-Z]):[\\/]?/.exec(path);
  return match ? `${match[1].toUpperCase()}:\\` : path;
}

/** The version size in bytes (the API sends it as a string). */
export function versionSizeBytes(version: GameVersion): number {
  const size = Number(version.size);
  return Number.isFinite(size) && size > 0 ? size : 0;
}

/** Same rule as the old client: free - 1000 must exceed the size. */
export function hasEnoughSpace(freeBytes: number, sizeBytes: number): boolean {
  return freeBytes - 1000 > sizeBytes;
}

/** Background choice: the last used location if still configured, else the first. */
export function pickBackgroundRoot(
  roots: RootPathEntry[],
  lastRootId: string | null,
): RootPathEntry | null {
  if (!roots.length) return null;
  return roots.find((root) => root.id === lastRootId) ?? roots[0];
}

async function chooseRoot(
  flowHost: DownloadFlowHost,
  gameTitle: string,
  background: boolean,
): Promise<RootPathEntry | "cancelled" | "error"> {
  const roots = getRootPaths();
  if (roots.length === 0) {
    const openSettings = await flowHost.confirm({
      title: translate("wp5.flow.noRootTitle"),
      message: translate("wp5.flow.noRootMessage"),
      confirmText: translate("wp5.flow.openSettings"),
      cancelText: translate("wp5.dialog.cancel"),
    });
    if (openSettings) flowHost.navigate("/settings?section=downloads");
    return "error";
  }
  if (roots.length === 1) return roots[0];

  const lastRootId = getLastRootId();
  if (background) return pickBackgroundRoot(roots, lastRootId) ?? "error";

  const picked = await flowHost.pickRoot({
    gameTitle,
    roots,
    preselectId: roots.some((root) => root.id === lastRootId)
      ? lastRootId
      : roots[0].id,
  });
  if (picked === "settings") {
    flowHost.navigate("/settings?section=downloads");
    return "cancelled";
  }
  if (!picked) return "cancelled";
  setLastRootId(picked.id);
  return picked;
}

async function chooseVersion(
  flowHost: DownloadFlowHost,
  game: PlaystashGame,
  gameTitle: string,
  options: RequestGameDownloadOptions,
): Promise<GameVersion | "cancelled" | "error"> {
  const versions = Array.isArray(game.versions) ? game.versions : [];
  if (options.versionId !== undefined) {
    const requested = versions.find((v) => v.id === options.versionId);
    if (requested) return requested;
  }
  if (!versions.length) {
    await flowHost.confirm({
      title: translate("wp5.flow.noVersionTitle"),
      message: translate("wp5.flow.noVersionMessage"),
      confirmText: translate("wp5.dialog.ok"),
    });
    return "error";
  }
  if (versions.length === 1) return versions[0];
  if (options.background) return newestVersion(versions) ?? "error";
  const picked = await flowHost.pickVersion({ gameTitle, versions });
  return picked ?? "cancelled";
}

/** The download flow, run against an explicit host (used by the tests). */
export async function runDownloadFlow(
  flowHost: DownloadFlowHost,
  options: RequestGameDownloadOptions,
): Promise<RequestGameDownloadResult> {
  const { gameId } = options;
  const background = options.background ?? false;

  if (!flowHost.isReady()) {
    flowHost.toast(translate("wp5.flow.offline"));
    return "error";
  }

  let game: PlaystashGame | null;
  try {
    game = await flowHost.fetchGame(gameId);
  } catch {
    game = null;
  }
  if (!game) {
    flowHost.toast(fill(translate("wp5.flow.gameNotFound"), { id: gameId }));
    return "error";
  }
  const gameTitle = gameDisplayTitle(game);

  const existing = flowHost.getDownloads()[gameId];
  if (existing?.status === "downloading") {
    flowHost.toast(
      fill(translate("wp5.flow.alreadyQueued"), { title: gameTitle }),
    );
    return "cancelled";
  }

  const root = await chooseRoot(flowHost, gameTitle, background);
  if (root === "cancelled" || root === "error") return root;

  if ((await flowHost.pathExists(root.path)) === false) {
    flowHost.toast(translate("wp5.flow.directoryMissing"));
    return "error";
  }

  const version = await chooseVersion(flowHost, game, gameTitle, options);
  if (version === "cancelled" || version === "error") return version;

  // Re-read: the card may have changed while a dialog was open.
  const card = flowHost.getDownloads()[gameId];
  if (card) {
    if (card.status === "downloading") {
      flowHost.toast(
        fill(translate("wp5.flow.alreadyQueued"), { title: gameTitle }),
      );
      return "cancelled";
    }
    if (isCardBusy(card)) {
      flowHost.toast(translate("wp5.delete.busy"));
      return "cancelled";
    }
    if (!background) {
      const overwrite = await flowHost.confirm({
        title: translate("wp5.flow.overwriteTitle"),
        message: translate("wp5.flow.overwriteMessage"),
        confirmText: translate("wp5.dialog.yes"),
        cancelText: translate("wp5.dialog.no"),
      });
      if (!overwrite) return "cancelled";
    }
  }

  const free = await flowHost.freeSpace(root.path);
  const size = versionSizeBytes(version);
  if (free !== null && !hasEnoughSpace(free, size)) {
    flowHost.toast(
      fill(translate("wp5.flow.notEnoughSpace"), {
        drive: driveLabel(root.path),
      }),
    );
    return "error";
  }

  // A different version of the game leaves its old files behind otherwise.
  if (card && card.versionId !== version.id) {
    await flowHost.deleteDownloadCard(gameId);
  }

  flowHost.startDownload({
    gameId: game.id,
    versionId: version.id,
    versionName: version.version,
    gameTitle,
    gameMetadata: game.metadata,
    gameType: (version.type || game.type) as PlaystashGameTypeEnum,
    filename: versionFilename(version, gameTitle),
    downloadRootPath: root.path,
    autoInstall: options.autoInstall ?? false,
  });
  flowHost.toast(fill(translate("wp5.flow.queued"), { title: gameTitle }));
  return "queued";
}

export async function requestGameDownload(
  options: RequestGameDownloadOptions,
): Promise<RequestGameDownloadResult> {
  if (!isTauriApp()) return "error";
  if (!host) {
    console.warn("requestGameDownload: the download flow is not mounted yet");
    return "error";
  }
  // A second request for the same game while one is pending is ignored.
  if (pendingGameIds.has(options.gameId)) return "cancelled";
  pendingGameIds.add(options.gameId);
  try {
    return await runDownloadFlow(host, options);
  } catch (error) {
    console.error("requestGameDownload failed:", error);
    return "error";
  } finally {
    pendingGameIds.delete(options.gameId);
  }
}
