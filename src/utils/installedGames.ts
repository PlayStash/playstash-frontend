import type { InstalledGameInfo } from "@/hooks/useInstalledGames";

/**
 * Normalize a raw `list_installed_games` result (which may use either
 * camelCase or snake_case keys) into a consistent `InstalledGameInfo`.
 */
export function normalizeInstalledGame(raw: any): InstalledGameInfo {
  return {
    gameId: raw.gameId ?? raw.game_id ?? 0,
    gameTitle: raw.gameTitle ?? raw.game_title ?? "",
    gameMetadata: raw.gameMetadata ?? raw.game_metadata ?? null,
    cachedMetadata: raw.cachedMetadata ?? raw.cached_metadata ?? null,
    gameType: raw.gameType ?? raw.game_type ?? null,
    versionId: raw.versionId ?? raw.version_id ?? 0,
    versionName: raw.versionName ?? raw.version_name ?? "",
    installationDirectory:
      raw.installationDirectory ?? raw.installation_directory ?? "",
    versionDirectory: raw.versionDirectory ?? raw.version_directory ?? "",
    installedAt: Number(raw.installedAt ?? raw.installed_at ?? 0),
    lastLaunchedAt: Number(raw.lastLaunchedAt ?? raw.last_launched_at ?? 0),
    // Until the server's last-played time is merged in, the local launch time
    // keeps the "recently played" order working offline.
    lastPlayedAt: Number(raw.lastLaunchedAt ?? raw.last_launched_at ?? 0),
  };
}

/** Normalize raw results and deduplicate by `gameId:versionDirectory`. */
export function normalizeAndDedupeInstalledGames(
  rawResults: any[],
): InstalledGameInfo[] {
  const seen = new Set<string>();
  const out: InstalledGameInfo[] = [];
  for (const raw of rawResults) {
    const info = normalizeInstalledGame(raw);
    const key = `${info.gameId}:${info.versionDirectory}`;
    if (info.gameId > 0 && !seen.has(key)) {
      seen.add(key);
      out.push(info);
    }
  }
  return out;
}
