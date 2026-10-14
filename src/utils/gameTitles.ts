/**
 * Small cache of game titles by id (metadata title first), used by the chat
 * activity list and the "This game" conversation label.
 */
const titles = new Map<string, Promise<string | null>>();

export function gameTitleFromJson(game: any): string | null {
  const title = game?.metadata?.title || game?.title;
  return typeof title === "string" && title.trim() ? title.trim() : null;
}

/** Resolves the title of a game, or null when it cannot be loaded. */
export function fetchGameTitle(
  authFetch: (input: string, init?: RequestInit) => Promise<Response>,
  serverUrl: string,
  gameId: number,
): Promise<string | null> {
  const base = serverUrl.replace(/\/+$/, "");
  const key = `${base}:${gameId}`;
  const cached = titles.get(key);
  if (cached) return cached;
  const request = authFetch(`${base}/api/games/${gameId}`)
    .then(async (response) =>
      response.ok ? gameTitleFromJson(await response.json()) : null,
    )
    .catch(() => null)
    .then((title) => {
      // Retry failed lookups next time instead of caching the failure.
      if (title === null) titles.delete(key);
      return title;
    });
  titles.set(key, request);
  return request;
}

/**
 * Folder title of an installed version:
 * `<root>/PlayStash/<Title>/Versions/<version>` → `<Title>`.
 */
export function folderTitleFromVersionDirectory(
  versionDirectory: string,
): string | null {
  const parts = versionDirectory.split(/[\\/]+/).filter(Boolean);
  const index = parts.lastIndexOf("Versions");
  const title = index > 0 ? parts[index - 1] : parts[parts.length - 2];
  return title?.trim() || null;
}

/**
 * Title of an installed game without the network: the cached server game
 * (metadata title first), else the install folder name.
 */
export async function resolveInstalledGameTitle(
  gameId: number,
  versionDirectory: string,
): Promise<string | null> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const cached = await invoke<string | null>("load_cached_game", { gameId });
    const title = cached ? gameTitleFromJson(JSON.parse(cached)) : null;
    if (title) return title;
  } catch {
    // Fall back to the folder name.
  }
  return folderTitleFromVersionDirectory(versionDirectory);
}

/** Test helper. */
export function clearGameTitleCache(): void {
  titles.clear();
}
