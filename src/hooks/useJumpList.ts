import { useEffect, useRef } from "react";
import type { InstalledGameInfo } from "@/hooks/useInstalledGames";
import { useInstalledGames } from "@/hooks/useInstalledGames";
import { isTauriApp } from "@/utils/tauri";

/** Games shown in the jump list's "Last Played" category. */
export const JUMP_LIST_GAME_LIMIT = 5;

export interface JumpListGame {
  gameId: number;
  title: string;
  iconPath?: string;
}

/** Title shown for an installed game (the mapped metadata title first). */
export function installedGameTitle(game: InstalledGameInfo): string {
  const meta = (game.cachedMetadata ?? game.gameMetadata) as Record<
    string,
    any
  > | null;
  const candidates = [meta?.metadata?.title, meta?.title, game.gameTitle];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim())
      return candidate.trim();
  }
  return "";
}

/**
 * Installed games in the order of the Library's installed row (most recently
 * played or installed first, then by title), one entry per game.
 */
export function orderJumpListCandidates(
  games: InstalledGameInfo[],
): InstalledGameInfo[] {
  const recency = (game: InstalledGameInfo) =>
    Math.max(Number(game.installedAt) || 0, Number(game.lastPlayedAt) || 0);
  const sorted = [...games].sort((a, b) => {
    const diff = recency(b) - recency(a);
    if (diff !== 0) return diff;
    return installedGameTitle(a).localeCompare(installedGameTitle(b));
  });
  const seen = new Set<number>();
  return sorted.filter((game) => {
    if (game.gameId <= 0 || seen.has(game.gameId)) return false;
    seen.add(game.gameId);
    return true;
  });
}

/**
 * Absolute path of the configured launch executable when it is an `.exe`
 * (used as the jump-list icon), else `undefined`.
 */
export function launchIconPath(
  installationDirectory: string,
  launchExecutable: unknown,
): string | undefined {
  if (typeof launchExecutable !== "string") return undefined;
  const exe = launchExecutable.trim();
  if (!exe.toLowerCase().endsWith(".exe")) return undefined;
  if (/^([a-zA-Z]:[\\/]|[\\/])/.test(exe)) return exe;
  const separator = installationDirectory.includes("\\") ? "\\" : "/";
  const base = installationDirectory.replace(/[\\/]+$/, "");
  return `${base}${separator}${exe.replace(/^[\\/]+/, "")}`;
}

async function readLaunchExecutable(
  versionDirectory: string,
): Promise<unknown> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const separator = versionDirectory.includes("\\") ? "\\" : "/";
    const path = `${versionDirectory.replace(/[\\/]+$/, "")}${separator}.playstash.game.config.json`;
    if (!(await invoke<boolean>("fs_path_exists", { path }))) return undefined;
    const raw = JSON.parse(await invoke<string>("fs_read_text_file", { path }));
    return raw?.launchexecutable;
  } catch {
    return undefined;
  }
}

/** Builds the jump-list entries (top five, duplicate titles skipped). */
export async function buildJumpListGames(
  games: InstalledGameInfo[],
  readExecutable: (
    versionDirectory: string,
  ) => Promise<unknown> = readLaunchExecutable,
): Promise<JumpListGame[]> {
  const result: JumpListGame[] = [];
  const titles = new Set<string>();
  for (const game of orderJumpListCandidates(games)) {
    const title = installedGameTitle(game);
    if (!title || titles.has(title)) continue;
    titles.add(title);
    const iconPath = launchIconPath(
      game.installationDirectory,
      await readExecutable(game.versionDirectory),
    );
    result.push({
      gameId: game.gameId,
      title,
      ...(iconPath ? { iconPath } : {}),
    });
    if (result.length === JUMP_LIST_GAME_LIMIT) break;
  }
  return result;
}

/** How often navigation may rescan the installed games for the jump list. */
const RESCAN_INTERVAL_MS = 60_000;

/**
 * Keeps the Windows jump list's "Last Played" category in sync with the
 * installed games (desktop only). Clears it when `enabled` turns false
 * (logout). `refreshKey` changes (for example the route) trigger a rescan at
 * most once a minute, so new installs show up without a restart.
 */
export function useJumpList(enabled: boolean, refreshKey?: unknown): void {
  const { installedGames, refetch } = useInstalledGames();
  // Time of the last scan; the mount counts as one (useInstalledGames loads
  // on mount). Set by the first effect run, as reading the clock during
  // render is impure.
  const lastScanRef = useRef<number | null>(null);
  const wasEnabledRef = useRef(false);

  useEffect(() => {
    const now = Date.now();
    lastScanRef.current ??= now;
    if (!enabled || !isTauriApp()) return;
    if (now - lastScanRef.current < RESCAN_INTERVAL_MS) return;
    lastScanRef.current = now;
    void refetch();
  }, [enabled, refreshKey, refetch]);

  useEffect(() => {
    if (!isTauriApp()) return;
    let cancelled = false;
    void (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        if (!enabled) {
          if (wasEnabledRef.current) {
            wasEnabledRef.current = false;
            await invoke("reset_jump_list_games");
          }
          return;
        }
        wasEnabledRef.current = true;
        const games = await buildJumpListGames(installedGames);
        if (!cancelled) await invoke("set_jump_list_games", { games });
      } catch (error) {
        console.warn("[jumpList] update failed:", error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, installedGames]);
}
