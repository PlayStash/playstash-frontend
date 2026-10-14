import { tauriInvoke } from "@/utils/tauriInvoke";
import type { InstalledGameInfo } from "@/hooks/useInstalledGames";
import { normalizeAndDedupeInstalledGames } from "@/utils/installedGames";
import { getRootPaths } from "@/utils/rootPaths";

/**
 * Dispatched on `window` when games were installed or uninstalled outside the
 * hooks that track them (e.g. a CLI uninstall). `useInstalledGames` refetches.
 */
export const INSTALLED_GAMES_CHANGED_EVENT = "playstash:installed-games-change";

export function notifyInstalledGamesChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(INSTALLED_GAMES_CHANGED_EVENT));
}

/** Every installed version on all configured download roots. */
export async function listAllInstalledGames(): Promise<InstalledGameInfo[]> {
  const roots = getRootPaths();
  if (!roots.length) return [];
  const raw: unknown[] = [];
  for (const root of roots) {
    const results = await tauriInvoke<unknown[]>("list_installed_games", {
      selectedRoot: root.path,
    }).catch(() => [] as unknown[]);
    raw.push(...results);
  }
  return normalizeAndDedupeInstalledGames(raw);
}

/** The newest installed version (highest version id) of a game. */
export function pickNewestInstalledVersion<
  T extends { gameId: number; versionId: number },
>(installed: T[], gameId: number): T | null {
  return (
    installed
      .filter((entry) => entry.gameId === gameId)
      .sort((a, b) => Number(b.versionId) - Number(a.versionId))[0] ?? null
  );
}

/** Finds the newest installed version of a game, scanning the roots. */
export async function findInstalledGame(
  gameId: number,
): Promise<InstalledGameInfo | null> {
  return pickNewestInstalledVersion(await listAllInstalledGames(), gameId);
}
