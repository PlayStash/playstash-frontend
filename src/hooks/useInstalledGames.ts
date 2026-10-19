import { useCallback, useEffect, useRef, useState } from "react";
import { isTauriApp } from "@/utils/tauri";
import { useAuth } from "@/context/AuthContext";
import { useOnlineStatus } from "@/context/OfflineContext";
import { getRootPaths } from "@/utils/rootPaths";
import { onGameUpdated } from "@/utils/gameUpdates";
import { getServerNamespace, resolveApiMediaBlob } from "@/utils/mediaCache";
import { normalizeInstalledGame } from "@/utils/installedGames";
import { INSTALLED_GAMES_CHANGED_EVENT } from "@/utils/installedGameLookup";

export interface InstalledGameInfo {
  gameId: number;
  gameTitle: string;
  gameMetadata: Record<string, any> | null;
  cachedMetadata: Record<string, any> | null;
  gameType: string | null;
  versionId: number;
  versionName: string;
  installationDirectory: string;
  versionDirectory: string;
  /** Unix timestamp (ms) when this version was installed; 0 if unknown. */
  installedAt: number;
  /** Unix timestamp (ms) of the last time the game was played; 0 if unknown. */
  lastPlayedAt: number;
  /** Unix timestamp (ms) of the last launch through this client; 0 if never. */
  lastLaunchedAt?: number;
}

// Games whose metadata + images have already been cached during this app
// session. Without this, every `isOnline` transition re-ran the whole cache for
// every installed game — a burst of multi-megabyte IPC transfers that kept the
// renderer and the Tauri event loop busy.
const cachedGameIds = new Set<number>();

export function useInstalledGames() {
  const [installedGames, setInstalledGames] = useState<InstalledGameInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { authFetch, serverUrl, user } = useAuth();
  const { isOnline } = useOnlineStatus();
  const currentUserId = (user as any)?.id ?? (user as any)?.ID ?? 0;
  const cacheInFlightRef = useRef<Set<number>>(new Set());

  const ensureGameCache = useCallback(
    async (gameId: number, force = false) => {
      if (!isTauriApp() || !isOnline) return;
      if (cacheInFlightRef.current.has(gameId)) return;
      if (!force && cachedGameIds.has(gameId)) return;
      cacheInFlightRef.current.add(gameId);

      try {
        const base = serverUrl.replace(/\/+$/, "");
        const { invoke } = await import("@tauri-apps/api/core");
        const { blobToBase64 } = await import("@/utils/binary");
        const serverNamespace = getServerNamespace(serverUrl);

        // Fetch full game object
        const gameRes = await authFetch(`${base}/api/games/${gameId}`);
        if (!gameRes.ok) return;
        const gameJson = await gameRes.json();

        // Cache game data
        await invoke("cache_game_data", {
          gameId,
          json: JSON.stringify(gameJson),
        });

        // Cache cover image
        const coverId = gameJson?.metadata?.cover?.id;
        if (coverId) {
          try {
            const blob = await resolveApiMediaBlob({
              serverUrl,
              mediaId: coverId,
              authFetch,
              owner: { gameId, slot: "cover" },
            });
            const bytes = await blobToBase64(blob);
            await invoke("cache_game_image", {
              serverNamespace,
              mediaId: Number(coverId),
              dataBase64: bytes,
              contentType: blob.type || "image/png",
            });
          } catch {
            /* ignore */
          }
        }

        // Cache background image
        const bgId = gameJson?.metadata?.background?.id;
        if (bgId) {
          try {
            const blob = await resolveApiMediaBlob({
              serverUrl,
              mediaId: bgId,
              authFetch,
              owner: { gameId, slot: "background" },
            });
            const bytes = await blobToBase64(blob);
            await invoke("cache_game_image", {
              serverNamespace,
              mediaId: Number(bgId),
              dataBase64: bytes,
              contentType: blob.type || "image/png",
            });
          } catch {
            /* ignore */
          }
        }

        // Update local state to include the new cached metadata
        cachedGameIds.add(gameId);
        setInstalledGames((prev) =>
          prev.map((g) =>
            g.gameId === gameId ? { ...g, cachedMetadata: gameJson } : g,
          ),
        );
      } catch {
        // Best-effort: never block the user
      } finally {
        cacheInFlightRef.current.delete(gameId);
      }
    },
    [serverUrl, authFetch, isOnline],
  );

  // Fetch the current user's last-played timestamps (used for recency
  // sorting in the library carousel). Resolves to null when unavailable.
  const fetchLastPlayed = useCallback(async (): Promise<Map<
    number,
    number
  > | null> => {
    if (!isOnline || !serverUrl || !currentUserId) return null;
    try {
      const base = serverUrl.replace(/\/+$/, "");
      const res = await authFetch(
        `${base}/api/progresses?filter[user.id]=${currentUserId}&sort[last_played_at]=desc&limit=10000`,
      );
      if (!res.ok) return null;
      const json = await res.json();
      const items: any[] = Array.isArray(json?.data)
        ? json.data
        : Array.isArray(json)
          ? json
          : [];
      const lastPlayed = new Map<number, number>();
      for (const p of items) {
        const gid = Number(p?.game?.id ?? p?.game_id ?? 0);
        const ts = p?.last_played_at
          ? new Date(String(p.last_played_at)).getTime()
          : 0;
        if (gid > 0 && ts > 0) {
          lastPlayed.set(gid, Math.max(lastPlayed.get(gid) ?? 0, ts));
        }
      }
      return lastPlayed;
    } catch {
      // Best-effort; last-played enrichment is non-critical.
      return null;
    }
  }, [serverUrl, authFetch, isOnline, currentUserId]);

  // Merge last-played timestamps into the installed-games list.
  const applyLastPlayed = useCallback(
    (lastPlayed: Map<number, number> | null) => {
      if (!lastPlayed) return;
      setInstalledGames((prev) =>
        prev.map((g) => ({
          ...g,
          // The local launch time also counts, so a game launched while the
          // server was unreachable still sorts first.
          lastPlayedAt: Math.max(
            lastPlayed.get(g.gameId) ?? 0,
            g.lastLaunchedAt ?? 0,
          ),
        })),
      );
    },
    [],
  );

  // Reads the installed games from every download location (no state).
  const scanInstalledGames = useCallback(async (): Promise<
    InstalledGameInfo[]
  > => {
    const rootPaths = getRootPaths();
    if (!rootPaths.length) return [];
    const { invoke } = await import("@tauri-apps/api/core");
    const allResults: InstalledGameInfo[] = [];
    const seen = new Set<string>(); // deduplicate by gameId+versionDirectory combo

    for (const root of rootPaths) {
      const rawResults = await invoke<any[]>("list_installed_games", {
        selectedRoot: root.path,
      }).catch(() => [] as any[]);

      for (const r of rawResults) {
        const info = normalizeInstalledGame(r);
        const key = `${info.gameId}:${info.versionDirectory}`;
        if (info.gameId > 0 && !seen.has(key)) {
          seen.add(key);
          allResults.push(info);
        }
      }
    }

    // Load cached metadata from offline-cache for games missing it.
    // list_installed_games reads from {root}/.cache/games/ but
    // cache_game_data writes to {app_data}/offline-cache/games/ —
    // two different paths. load_cached_game bridges the gap.
    if (isTauriApp()) {
      for (const game of allResults) {
        if (game.gameId <= 0) continue;
        if (game.cachedMetadata) continue;
        try {
          const cached = await invoke<string | null>("load_cached_game", {
            gameId: game.gameId,
          });
          if (cached) {
            game.cachedMetadata = JSON.parse(cached);
          }
        } catch {
          /* ignore */
        }
      }
    }
    return allResults;
  }, []);

  // Shows a scan result and starts the online enrichment for it.
  const applyScan = useCallback(
    (allResults: InstalledGameInfo[]) => {
      setInstalledGames(allResults);
      setError(null);

      // While online, enrich installed games with the last-played timestamp
      // from the server so the installed carousel can sort by recency.
      void fetchLastPlayed().then(applyLastPlayed);

      // Refresh server metadata while online so changed media IDs replace stale
      // cache bindings. Run these strictly one at a time: each call transfers a
      // cover and a background over IPC, and firing them for every installed
      // game at once is what produced the multi-megabyte IPC burst (and the
      // ~140MB JS heap spike) that stalled the webview in the field log.
      if (isOnline) {
        void allResults
          .filter((game) => game.gameId > 0)
          .reduce(
            (chain, game) => chain.then(() => ensureGameCache(game.gameId)),
            Promise.resolve() as Promise<void>,
          )
          .catch(() => undefined);
      }
    },
    [ensureGameCache, isOnline, fetchLastPlayed, applyLastPlayed],
  );

  const failScan = useCallback((err: any) => {
    setError(err?.message ?? String(err));
    setInstalledGames([]);
  }, []);

  const fetchInstalledGames = useCallback(async () => {
    if (!isTauriApp()) return;
    setLoading(true);
    setError(null);
    try {
      applyScan(await scanInstalledGames());
    } catch (err: any) {
      failScan(err);
    } finally {
      setLoading(false);
    }
  }, [scanInstalledGames, applyScan, failScan]);

  // (Re)scan whenever the enrichment inputs change. The list counts as
  // loading until the first scan has settled, so the effect never sets state
  // synchronously.
  const [initialScanDone, setInitialScanDone] = useState(false);
  useEffect(() => {
    if (!isTauriApp()) return;
    let cancelled = false;
    scanInstalledGames()
      .then(
        (results) => {
          if (!cancelled) applyScan(results);
        },
        (err) => {
          if (!cancelled) failScan(err);
        },
      )
      .finally(() => {
        if (!cancelled) setInitialScanDone(true);
      });
    return () => {
      cancelled = true;
    };
  }, [scanInstalledGames, applyScan, failScan]);

  // Installs/uninstalls done outside this hook (e.g. from a desktop command).
  useEffect(() => {
    const handleChange = () => void fetchInstalledGames();
    window.addEventListener(INSTALLED_GAMES_CHANGED_EVENT, handleChange);
    return () =>
      window.removeEventListener(INSTALLED_GAMES_CHANGED_EVENT, handleChange);
  }, [fetchInstalledGames]);

  useEffect(() => {
    if (!isOnline || !currentUserId) return;
    let cancelled = false;
    void fetchLastPlayed().then((lastPlayed) => {
      if (!cancelled) applyLastPlayed(lastPlayed);
    });
    return () => {
      cancelled = true;
    };
  }, [isOnline, currentUserId, fetchLastPlayed, applyLastPlayed]);

  useEffect(
    () =>
      onGameUpdated((updatedGame) => {
        setInstalledGames((previous) =>
          previous.map((game) =>
            game.gameId === updatedGame.id
              ? {
                  ...game,
                  gameTitle:
                    updatedGame.metadata?.title ||
                    updatedGame.title ||
                    game.gameTitle,
                  cachedMetadata: updatedGame,
                }
              : game,
          ),
        );
        if (isOnline) void ensureGameCache(updatedGame.id, true);
      }),
    [ensureGameCache, isOnline],
  );

  return {
    installedGames,
    loading: loading || (isTauriApp() && !initialScanDone),
    error,
    refetch: fetchInstalledGames,
  };
}
