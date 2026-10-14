/**
 * Building the Steam shortcut list from installed games (pure helpers for
 * `useSteamShortcutSync`).
 */
import type { InstalledGameInfo } from "@/hooks/useInstalledGames";

/** Payload item of the `steam_sync_shortcuts` command. */
export interface SteamShortcutGame {
  gameId: number;
  title: string;
  /** Absolute executable (or emulator) path. */
  exe: string;
  launchOptions: string;
  coverMediaId?: number;
  heroMediaId?: number;
  /** Start through PlayStash (`start --gameid=<id>`). */
  viaPlaystash: boolean;
}

/** The newest installed version of every game. */
export function newestInstalledVersions(
  installed: InstalledGameInfo[],
): InstalledGameInfo[] {
  const newest = new Map<number, InstalledGameInfo>();
  for (const info of installed) {
    if (!info.gameId || info.gameId <= 0) continue;
    const current = newest.get(info.gameId);
    if (
      !current ||
      info.installedAt > current.installedAt ||
      (info.installedAt === current.installedAt &&
        info.versionId > current.versionId)
    )
      newest.set(info.gameId, info);
  }
  return [...newest.values()].sort((a, b) => a.gameId - b.gameId);
}

function serverGame(info: InstalledGameInfo): Record<string, any> | null {
  return (info.cachedMetadata as Record<string, any> | null) ?? null;
}

/** Metadata title, else the server title, else the install folder name. */
export function installedGameTitle(info: InstalledGameInfo): string {
  const game = serverGame(info);
  const title = game?.metadata?.title || game?.title || info.gameTitle;
  return String(title ?? "").trim();
}

function positiveId(value: unknown): number | undefined {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : undefined;
}

export type LaunchTarget =
  | { kind: "emulator"; exe: string; launchOptions: string }
  | { kind: "relative"; relativeExe: string; launchOptions: string };

/**
 * The executable the Play button starts: an emulator configuration (absolute
 * path), else `launchexecutable` from the version config, else the server's
 * `launch_executable`. Null when nothing is configured.
 */
export function resolveLaunchTarget(
  config: Record<string, any> | null,
  info: InstalledGameInfo,
): LaunchTarget | null {
  const metadata = serverGame(info)?.metadata ?? null;
  const launchOptions = String(
    config?.launchparameters ?? metadata?.launch_parameters ?? "",
  );
  const emulator = String(config?.emulatorexecutable ?? "").trim();
  if (emulator) return { kind: "emulator", exe: emulator, launchOptions };
  const relativeExe = String(
    config?.launchexecutable || metadata?.launch_executable || "",
  ).trim();
  if (!relativeExe) return null;
  return { kind: "relative", relativeExe, launchOptions };
}

/**
 * Steam cannot replicate emulator configs, run-as-admin or umu/Proton
 * launches, so those shortcuts start PlayStash instead (Rust additionally
 * routes Windows executables on Linux/macOS through PlayStash).
 */
export function needsPlaystashLaunch(
  config: Record<string, any> | null,
  target: LaunchTarget,
  isWindows: boolean,
): boolean {
  if (target.kind === "emulator") return true;
  if (config?.launchasadmin) return true;
  if (
    !isWindows &&
    (config?.umugameid || config?.umuprotonpath || config?.umuwineprefix)
  )
    return true;
  return false;
}

export function toSteamShortcutGame(
  info: InstalledGameInfo,
  config: Record<string, any> | null,
  target: LaunchTarget,
  absoluteExe: string,
  isWindows: boolean,
): SteamShortcutGame | null {
  const title = installedGameTitle(info);
  if (!title || !absoluteExe) return null;
  const metadata = serverGame(info)?.metadata ?? null;
  const coverMediaId = positiveId(metadata?.cover?.id);
  const heroMediaId = positiveId(metadata?.background?.id);
  return {
    gameId: info.gameId,
    title,
    exe: absoluteExe,
    launchOptions: target.launchOptions,
    ...(coverMediaId ? { coverMediaId } : {}),
    ...(heroMediaId ? { heroMediaId } : {}),
    viaPlaystash: needsPlaystashLaunch(config, target, isWindows),
  };
}

/** Stable fingerprint: a resync only happens when this changes. */
export function steamShortcutSignature(games: SteamShortcutGame[]): string {
  return JSON.stringify(
    [...games]
      .sort((a, b) => a.gameId - b.gameId)
      .map((game) => [
        game.gameId,
        game.title,
        game.exe,
        game.launchOptions,
        game.coverMediaId ?? 0,
        game.heroMediaId ?? 0,
        game.viaPlaystash,
      ]),
  );
}
