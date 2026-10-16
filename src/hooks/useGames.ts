import {
  PlaystashGame,
  PlaystashGameTypeEnum,
} from "@/api/models/PlaystashGame";
import { ProgressStateEnum } from "@/api/models/Progress";
import { useAuth } from "@/context/AuthContext";
import { useOnlineStatus } from "@/context/OfflineContext";
import { isTauriApp } from "@/utils/tauri";
import { translate } from "@/i18n";
import { fillTemplate } from "@/utils/downloadPipeline";
import {
  buildCacheKey,
  buildGamesQueryParams,
  BookmarkFilter,
  EarlyAccessFilter,
} from "@/utils/gamesQuery";
export type { BookmarkFilter, EarlyAccessFilter } from "@/utils/gamesQuery";
import { onGameDeleted } from "@/utils/gameUpdates";
import {
  hasMoreGames,
  isLibraryRefreshDue,
  LIBRARY_FOCUS_REFRESH_MIN_MS,
  LIBRARY_INTERVAL_REFRESH_MS,
  libraryRefreshLimit,
  loadedPageCount,
} from "@/utils/libraryAutoRefresh";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

interface PaginatedData<T> {
  data: T[];
  meta: { totalItems: number };
}

export interface UseGamesOptions {
  search: string;
  sortBy: string; // e.g. sort_title, size
  order: "ASC" | "DESC";
  limit?: number;
  // Bookmark filter: "all", "mine" (my bookmarks), "others" (bookmarked by others)
  bookmarkFilter?: BookmarkFilter;
  // Game type filter (e.g. WINDOWS_SETUP, WINDOWS_PORTABLE, LINUX_PORTABLE)
  gameTypes?: PlaystashGameTypeEnum[];
  // Tag names to filter by
  tags?: string[];
  // Genre names to filter by
  genres?: string[];
  // Developer names to filter by
  developers?: string[];
  // Publisher names to filter by
  publishers?: string[];
  // Game state filter (requires user id)
  gameState?: ProgressStateEnum;
  // Release date range filter
  releaseDateFrom?: string;
  releaseDateTo?: string;
  // Early access filter
  earlyAccess?: EarlyAccessFilter;
  addedSince?: string;
  libraryFolder?: string;
  /** Age rating filter: `"all"`, `"null"` (N/A) or a number. */
  ageRating?: string;
  /** When false, nothing is fetched (Library auto-load off). */
  enabled?: boolean;
}

interface CachedGamesState {
  count: number;
  games: PlaystashGame[];
}

// Module-level cache that survives component unmount/remount cycles.
// Keyed by a serialization of all filter/sort/search params + user ID.
// This prevents losing infinite-scroll pages when navigating away and back
// (e.g. Library → GameView → back).
const gamesCache = new Map<string, CachedGamesState>();

// Upper bound for `gamesCache`. Each entry holds a full games array, and the
// key includes the search text, so without a cap every search/filter the user
// ever typed would stay in memory for the rest of the session.
const MAX_GAMES_CACHE_ENTRIES = 12;

function setGamesCache(key: string, state: CachedGamesState): void {
  // Delete before re-adding so the key moves to the end of the Map's insertion
  // order; the least recently written key is then the eviction victim.
  gamesCache.delete(key);
  gamesCache.set(key, state);
  while (gamesCache.size > MAX_GAMES_CACHE_ENTRIES) {
    const oldestKey = gamesCache.keys().next().value;
    if (oldestKey === undefined) break;
    gamesCache.delete(oldestKey);
  }
}

// Game IDs that have been fully removed from the library (e.g. by deleting a
// game's last version file). Kept at module scope so the game stays out of the
// list even when the Library remounts and re-fetches from the server.
const removedGameIds = new Set<number>();

// Keep the module-level cache in sync even when no Library instance is mounted
// (e.g. a game is deleted while the user is on the game view).
/** Drops every cached result so the next Library mount re-fetches. */
export function invalidateGamesCache(): void {
  gamesCache.clear();
}

onGameDeleted((gameId) => {
  removedGameIds.add(gameId);
  // Snapshot before iterating: `setGamesCache` re-inserts the key, which would
  // otherwise move it during iteration.
  for (const [key, state] of [...gamesCache]) {
    if (state.games.some((g) => g.id === gameId)) {
      setGamesCache(key, {
        count: Math.max(0, state.count - 1),
        games: state.games.filter((g) => g.id !== gameId),
      });
    }
  }
});

export function useGames({
  search,
  sortBy,
  order,
  limit = 50,
  bookmarkFilter = "all",
  gameTypes = [],
  tags = [],
  genres = [],
  developers = [],
  publishers = [],
  gameState,
  releaseDateFrom,
  releaseDateTo,
  earlyAccess = "all",
  addedSince,
  libraryFolder,
  ageRating,
  enabled = true,
}: UseGamesOptions) {
  const { serverUrl, authFetch, user } = useAuth();
  const { isOnline } = useOnlineStatus();

  // Build a cache key from all filter/sort/search params so we can restore
  // game data after component remount (e.g. navigating back from detail page).
  const cacheKey = buildCacheKey(
    {
      search,
      sortBy,
      order,
      limit,
      bookmarkFilter,
      gameTypes,
      tags,
      genres,
      developers,
      publishers,
      gameState,
      releaseDateFrom,
      releaseDateTo,
      earlyAccess,
      addedSince,
      libraryFolder,
      ageRating,
    },
    serverUrl || "",
    (user as any)?.id ?? (user as any)?.ID ?? null,
  );
  const cached = gamesCache.get(cacheKey);

  const [count, setCount] = useState(cached?.count ?? 0);
  const [games, setGames] = useState<PlaystashGame[]>(cached?.games ?? []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Every list load bumps the generation; a page that arrives for an older
  // list (e.g. after a refresh or filter change) is discarded.
  const generationRef = useRef(0);
  // The filters of the list on screen. A fetch for the same filters refreshes
  // it in place; other filters start over at the first page.
  const shownKeyRef = useRef<string | null>(cached ? cacheKey : null);
  const countRef = useRef(count);
  countRef.current = count;
  const cacheKeyRef = useRef(cacheKey);
  cacheKeyRef.current = cacheKey;
  const gamesRef = useRef<PlaystashGame[]>(games);
  gamesRef.current = games;
  // Time of the last successful fetch, for the background refresh.
  const lastFetchAtRef = useRef(0);
  const loadingRef = useRef(false);
  loadingRef.current = loading;

  // Serialize arrays to stable strings to use as dependencies (prevent re-fetching when array reference changes but contents are same)
  const gameTypesKey = useMemo(
    () => JSON.stringify(gameTypes.slice().sort()),
    [gameTypes],
  );
  const tagsKey = useMemo(() => JSON.stringify(tags.slice().sort()), [tags]);
  const genresKey = useMemo(
    () => JSON.stringify(genres.slice().sort()),
    [genres],
  );
  const developersKey = useMemo(
    () => JSON.stringify(developers.slice().sort()),
    [developers],
  );
  const publishersKey = useMemo(
    () => JSON.stringify(publishers.slice().sort()),
    [publishers],
  );

  // Store current array values in refs so callback doesn't depend on array references
  const gameTypesRef = useRef(gameTypes);
  const tagsRef = useRef(tags);
  const genresRef = useRef(genres);
  const developersRef = useRef(developers);
  const publishersRef = useRef(publishers);

  // Update refs synchronously when arrays change (before any effects run)
  gameTypesRef.current = gameTypes;
  tagsRef.current = tags;
  genresRef.current = genres;
  developersRef.current = developers;
  publishersRef.current = publishers;

  /** Query for one page of `pageLimit` games with the current filters. */
  const buildQuery = useCallback(
    (pageLimit: number, page: number) => {
      const userId = (user as any)?.id ?? (user as any)?.ID;
      const params = buildGamesQueryParams({
        search,
        sortBy,
        order,
        limit: pageLimit,
        bookmarkFilter,
        userId,
        gameTypes: gameTypesRef.current,
        tags: tagsRef.current,
        genres: genresRef.current,
        developers: developersRef.current,
        publishers: publishersRef.current,
        gameState,
        releaseDateFrom,
        releaseDateTo,
        earlyAccess,
        addedSince,
        libraryFolder,
        ageRating,
      });
      params.set("page", String(page));
      return params;
    },
    // The array filters are read from refs; their serialized keys are the
    // dependencies.
    [
      search,
      sortBy,
      order,
      bookmarkFilter,
      user,
      gameTypesKey,
      tagsKey,
      genresKey,
      developersKey,
      publishersKey,
      gameState,
      releaseDateFrom,
      releaseDateTo,
      earlyAccess,
      addedSince,
      libraryFolder,
      ageRating,
    ],
  );

  /**
   * Loads the list from the server. For the filters already on screen it
   * reloads every page scrolled through, so the list (and its scroll
   * position) does not shrink back to the first page; new filters start at
   * the first page. A silent fetch (background refresh) also leaves errors
   * and the loading state untouched.
   */
  const fetchGamesWith = useCallback(
    async (silent: boolean) => {
      if (!serverUrl) return;
      if (!enabled) return;
      // Skip fetch when offline in Tauri mode — installed games handle themselves
      if (isTauriApp() && !isOnline) {
        if (!silent) setLoading(false);
        return;
      }
      if (silent && loadingRef.current) return;
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      if (!silent) {
        setLoading(true);
        setError(null);
      }
      const key = cacheKeyRef.current;
      const sameList = shownKeyRef.current === key;
      const pages = sameList
        ? loadedPageCount(gamesRef.current.length, limit)
        : 1;
      const generation = ++generationRef.current;
      try {
        const base = serverUrl.replace(/\/+$/, "");
        const params = buildQuery(libraryRefreshLimit(limit, pages), 1);
        const url = `${base}/api/games?${params.toString()}`;
        const res = await authFetch(url, { method: "GET", signal: ac.signal });
        if (!res.ok)
          throw new Error(
            fillTemplate(translate("library.fetchFailed"), {
              status: res.status,
            }),
          );
        const json: PaginatedData<PlaystashGame> = await res.json();
        // Drop games that were removed from the library (e.g. their last version
        // was deleted) so they don't reappear after a re-fetch.
        const fetchedGames = (json.data || []).filter(
          (g) => !removedGameIds.has(g.id),
        );
        if (generation !== generationRef.current) return;
        const fetchedCount = Math.max(
          0,
          json.meta.totalItems - removedGameIds.size,
        );
        setCount(fetchedCount);
        setGames(fetchedGames);
        shownKeyRef.current = key;
        lastFetchAtRef.current = Date.now();
        // Persist the results to the module-level cache so that navigating
        // away and back (e.g. Library → GameView → back) restores instantly.
        setGamesCache(key, { count: fetchedCount, games: fetchedGames });
      } catch (e: any) {
        if (e?.name === "AbortError") return;
        // A failed background refresh keeps the list as it is.
        if (!silent) setError(e.message || String(e));
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [serverUrl, authFetch, limit, buildQuery, isOnline, enabled],
  );

  const fetchGames = useCallback(() => fetchGamesWith(false), [fetchGamesWith]);

  // Keep the list current while the app stays open: refresh in the background
  // when the window regains focus and every few minutes while it is visible,
  // so changes made elsewhere (other clients, admins, the API) show up.
  useEffect(() => {
    if (!enabled) return;
    const refreshIfDue = (minIntervalMs: number) => {
      if (document.visibilityState !== "visible") return;
      if (
        !isLibraryRefreshDue(lastFetchAtRef.current, Date.now(), minIntervalMs)
      )
        return;
      void fetchGamesWith(true);
    };
    const onFocus = () => refreshIfDue(LIBRARY_FOCUS_REFRESH_MIN_MS);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    const interval = window.setInterval(
      () => refreshIfDue(LIBRARY_INTERVAL_REFRESH_MS),
      LIBRARY_INTERVAL_REFRESH_MS,
    );
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      window.clearInterval(interval);
    };
  }, [enabled, fetchGamesWith]);

  const hasMore = hasMoreGames(games.length, count);

  /**
   * Appends the next page. The URL is built here from the current filters
   * instead of following the server's absolute `links.next`, which points
   * at whatever host the server saw (e.g. an internal proxy address) and at
   * the page size of the last refresh.
   */
  const loadMore = useCallback(async () => {
    if (!serverUrl || loadingRef.current) return;
    const loaded = gamesRef.current.length;
    if (!hasMoreGames(loaded, countRef.current)) return;
    const generation = generationRef.current;
    const key = cacheKeyRef.current;
    try {
      setLoading(true);
      const base = serverUrl.replace(/\/+$/, "");
      const page = loadedPageCount(loaded, limit) + 1;
      const params = buildQuery(limit, page);
      const res = await authFetch(`${base}/api/games?${params.toString()}`, {
        method: "GET",
      });
      if (!res.ok)
        throw new Error(
          fillTemplate(translate("library.fetchFailed"), {
            status: res.status,
          }),
        );
      const json: PaginatedData<PlaystashGame> = await res.json();
      if (generation !== generationRef.current) return;
      const fetchedCount = Math.max(
        0,
        json.meta.totalItems - removedGameIds.size,
      );
      const known = new Set(gamesRef.current.map((g) => g.id));
      const merged = [
        ...gamesRef.current,
        ...(json.data || []).filter(
          (g) => !removedGameIds.has(g.id) && !known.has(g.id),
        ),
      ];
      setGames(merged);
      setCount(fetchedCount);
      // Persist all loaded pages so infinite-scroll position is preserved
      // when navigating back to the library.
      setGamesCache(key, { count: fetchedCount, games: merged });
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [serverUrl, authFetch, limit, buildQuery]);

  useEffect(() => {
    // The same filters already on screen (restored from the cache or a
    // re-created callback) refresh quietly; new filters load visibly.
    void fetchGamesWith(shownKeyRef.current === cacheKeyRef.current);
    return () => abortRef.current?.abort();
  }, [fetchGamesWith]);

  // Drop a deleted game from the live list as soon as the event fires, so the
  // Library updates without waiting for a refresh.
  useEffect(() => {
    return onGameDeleted((gameId) => {
      if (!gamesRef.current.some((g) => g.id === gameId)) return;
      setGames((prev) => prev.filter((g) => g.id !== gameId));
      setCount((c) => Math.max(0, c - 1));
    });
  }, []);

  return {
    count,
    games,
    loading,
    error,
    refetch: fetchGames,
    loadMore,
    hasMore,
  };
}

export function getGameCoverMediaId(
  game: PlaystashGame,
): number | string | null {
  const id = game.metadata?.cover?.id;
  return id ?? null;
}
