import { LibraryCategories } from "@/components/LibraryCategories";
import { RecentlyAddedGames } from "@/components/RecentlyAddedGames";
import { BigPictureButton } from "@/components/BigPicture";
import GameCard from "@/components/GameCard";
import { useAuth } from "@/context/AuthContext";
import { BookmarkFilter, EarlyAccessFilter, useGames } from "@/hooks/useGames";
import { useScrollRestoration } from "@/hooks/useScrollRestoration";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { Divider } from "@tw/divider";
import { Heading } from "@tw/heading";
import { Input } from "@tw/input";
import { Listbox, ListboxLabel, ListboxOption } from "@tw/listbox";
import {
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
  type CSSProperties,
} from "react";
import { XMarkIcon } from "@heroicons/react/24/solid";
import {
  TrashIcon,
  FunnelIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  ArrowPathIcon,
  ChevronUpIcon,
} from "@heroicons/react/24/outline";
import { useLocation, useNavigate } from "react-router";
import { useAlertDialog } from "@/context/AlertDialogContext";
import { useTranslation, type TranslationKey } from "@/i18n";
import { getErrorMessage } from "@/utils/apiError";
import {
  COVER_SIZE_MAX,
  COVER_SIZE_MIN,
  getCoverSize,
  getInstalledOpen,
  getLibraryRetain,
  isLibraryLoadAllowed,
  requestLibraryLoad,
  setCoverSize as persistCoverSize,
  setInstalledOpen,
} from "@/utils/libraryPreferences";
import {
  DEFAULT_INSTALLED_FILTERS,
  filterInstalledGames,
  INSTALLED_SORTS,
  INSTALLED_TYPE_FILTERS,
  sortInstalledGames,
  type InstalledEarlyAccess,
  type InstalledFilters,
  type InstalledSort,
  type InstalledTypeFilter,
} from "@/utils/installedSort";
import {
  ageRatingOptionValue,
  distinctAgeRatings,
  isAgeRatingValue,
} from "@/utils/ageRatings";
import { Button } from "@/components/tailwind/button";
import { Badge } from "../components/tailwind/badge";
import { PlaystashGameTypeEnum } from "@/api/models/PlaystashGame";
import type { PlaystashGame } from "@/api/models/PlaystashGame";
import { ProgressStateEnum } from "@/api/models/Progress";
import MultiSelectFilterDialog, {
  FilterItem,
} from "@/components/MultiSelectFilterDialog";
import { Strong, Text, TextLink } from "@/components/tailwind/text";
import { isTauriApp } from "@/utils/tauri";
import { useInstalledGames } from "@/hooks/useInstalledGames";
import { useOnlineStatus } from "@/context/OfflineContext";
import { SectionExpander } from "@/components/SectionExpander";
import { RowCountControl } from "@/components/RowCountControl";
import { motion } from "motion/react";
import { DURATION_SLOW, EASE_OUT } from "@/lib/motion";
import {
  activeFilterCount as computeActiveFilterCount,
  buildInstalledGameMap,
  filterAndSortInstalledGames,
  getParamValues,
  hasActiveFilters as computeHasActiveFilters,
  isBookmark,
  isEarlyAccess,
  isGameType,
  isProgressState,
  setParamValues,
} from "@/utils/libraryFilters";

const SORT_BY: { label: string; value: string }[] = [
  { label: "Title", value: "sort_title" },
  { label: "Size", value: "size" },
  { label: "Date Added", value: "created_at" },
  { label: "Release Date", value: "metadata.release_date" },
  { label: "Rating", value: "metadata.rating" },
  { label: "Download Count", value: "download_count" },
  { label: "Average Playtime", value: "metadata.average_playtime" },
];

const GAME_TYPES: { label: string; value: PlaystashGameTypeEnum }[] = [
  { label: "Windows Setup", value: PlaystashGameTypeEnum.windows_setup },
  { label: "Windows Portable", value: PlaystashGameTypeEnum.windows_portable },
  { label: "Linux Portable", value: PlaystashGameTypeEnum.linux_portable },
];

// Static items for game type filter (used in MultiSelectFilterDialog)
const GAME_TYPE_FILTER_ITEMS: FilterItem[] = GAME_TYPES.map((t) => ({
  id: t.value,
  name: t.label,
}));

const GAME_STATES: { label: string; value: ProgressStateEnum }[] = [
  { label: "Unplayed", value: ProgressStateEnum.unplayed },
  { label: "Infinite", value: ProgressStateEnum.infinite },
  { label: "Playing", value: ProgressStateEnum.playing },
  { label: "Completed", value: ProgressStateEnum.completed },
  { label: "Aborted (Temporary)", value: ProgressStateEnum.aborted_temporary },
  { label: "Aborted (Permanent)", value: ProgressStateEnum.aborted_permanent },
];

const EARLY_ACCESS_OPTIONS: { label: string; value: EarlyAccessFilter }[] = [
  { label: "All", value: "all" },
  { label: "Early Access Only", value: "true" },
  { label: "No Early Access", value: "false" },
];

const BOOKMARK_OPTIONS: { label: string; value: BookmarkFilter }[] = [
  { label: "All", value: "all" },
  { label: "Bookmarked by Me", value: "mine" },
  { label: "Bookmarked by Others", value: "others" },
];

const LIB_SORT_KEY = "app_library_sort";
const LIB_ORDER_KEY = "app_library_order";

const INSTALLED_SORT_LABELS: Record<InstalledSort, TranslationKey> = {
  "last-played": "library.installed.sort.lastPlayed",
  title: "library.installed.sort.title",
  "release-date": "library.installed.sort.releaseDate",
  rating: "library.installed.sort.rating",
  size: "library.installed.sort.size",
  playtime: "library.installed.sort.playtime",
};

const INSTALLED_TYPE_LABELS: Record<InstalledTypeFilter, TranslationKey> = {
  all: "library.installed.type.all",
  WINDOWS_PORTABLE: "library.installed.type.windowsPortable",
  WINDOWS_SETUP: "library.installed.type.windowsSetup",
  LINUX_PORTABLE: "library.installed.type.linuxPortable",
  UNDETECTABLE: "library.installed.type.undetectable",
};

const INSTALLED_EARLY_ACCESS_LABELS: Record<
  InstalledEarlyAccess,
  TranslationKey
> = {
  all: "library.installed.earlyAccess.all",
  only: "library.installed.earlyAccess.only",
  exclude: "library.installed.earlyAccess.exclude",
};

/** Dice icon for "I'm Feeling Lucky". */
function DiceIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect x="3.5" y="3.5" width="17" height="17" rx="3.5" />
      <circle cx="8.5" cy="8.5" r="1.1" fill="currentColor" />
      <circle cx="15.5" cy="8.5" r="1.1" fill="currentColor" />
      <circle cx="12" cy="12" r="1.1" fill="currentColor" />
      <circle cx="8.5" cy="15.5" r="1.1" fill="currentColor" />
      <circle cx="15.5" cy="15.5" r="1.1" fill="currentColor" />
    </svg>
  );
}

export default function Library() {
  const { serverUrl, user, authFetch } = useAuth();
  const { t } = useTranslation();
  const { showAlert } = useAlertDialog();
  const navigate = useNavigate();
  const location = useLocation();
  const { isOnline } = useOnlineStatus();
  const isTauri = isTauriApp();

  const CONTROL_HEIGHT_CLASS = "min-h-11 sm:min-h-9";
  const INPUT_CONTROL_HEIGHT_CLASS = "[&_input]:min-h-11 sm:[&_input]:min-h-9";

  const urlInitializedRef = useRef(false);
  const [search, setSearch] = useState("");
  const [libraryFolder, setLibraryFolder] = useState("");
  const deferredLibraryFolder = useDebouncedValue(libraryFolder.trim(), 300);
  // Sort/order preferences are retained unless the user turned that off
  // (Settings > Startup); URL parameters still apply.
  const [sortBy, setSortBy] = useState(() => {
    try {
      if (typeof window !== "undefined" && getLibraryRetain()) {
        const saved = localStorage.getItem(LIB_SORT_KEY);
        if (saved && SORT_BY.some((o) => o.value === saved)) return saved;
      }
    } catch {}
    return "sort_title";
  });
  const [order, setOrder] = useState<"ASC" | "DESC">(() => {
    try {
      if (typeof window !== "undefined" && getLibraryRetain()) {
        const saved = localStorage.getItem(LIB_ORDER_KEY) as
          "ASC" | "DESC" | null;
        if (saved === "ASC" || saved === "DESC") return saved;
      }
    } catch {}
    return "ASC";
  });
  const [showFilters, setShowFilters] = useState(false);
  const [bookmarkFilter, setBookmarkFilter] = useState<BookmarkFilter>("all");

  // New filter states
  const [selectedGameTypes, setSelectedGameTypes] = useState<FilterItem[]>([]);
  const [selectedTags, setSelectedTags] = useState<FilterItem[]>([]);
  const [selectedGenres, setSelectedGenres] = useState<FilterItem[]>([]);
  const [selectedDevelopers, setSelectedDevelopers] = useState<FilterItem[]>(
    [],
  );
  const [selectedPublishers, setSelectedPublishers] = useState<FilterItem[]>(
    [],
  );
  const [selectedGameState, setSelectedGameState] = useState<
    ProgressStateEnum | ""
  >("");
  const [releaseDateFrom, setReleaseDateFrom] = useState("");
  const [releaseDateTo, setReleaseDateTo] = useState("");
  const [earlyAccess, setEarlyAccess] = useState<EarlyAccessFilter>("all");
  const [ageRating, setAgeRating] = useState("all");
  const [ageRatingOptions, setAgeRatingOptions] = useState<
    (number | null)[] | null
  >(null);
  const ageRatingLoadingRef = useRef(false);
  // Client-side only: hide server cards of installed games (desktop).
  const [hideInstalled, setHideInstalled] = useState(true);
  const [coverSize, setCoverSizeState] = useState(getCoverSize);
  // Auto-load off: server games load after the first search/filter/reload.
  const [loadAllowed, setLoadAllowed] = useState(isLibraryLoadAllowed);
  const [luckyBusy, setLuckyBusy] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [installedSort, setInstalledSort] =
    useState<InstalledSort>("last-played");
  const [installedFilters, setInstalledFilters] = useState<InstalledFilters>(
    DEFAULT_INSTALLED_FILTERS,
  );
  const allowLoad = useCallback(() => {
    requestLibraryLoad();
    setLoadAllowed(true);
  }, []);

  // Dialog states
  const [gameTypesDialogOpen, setGameTypesDialogOpen] = useState(false);
  const [tagsDialogOpen, setTagsDialogOpen] = useState(false);
  const [genresDialogOpen, setGenresDialogOpen] = useState(false);
  const [developersDialogOpen, setDevelopersDialogOpen] = useState(false);
  const [publishersDialogOpen, setPublishersDialogOpen] = useState(false);

  // Check if any filters are active
  const hasActiveFilters = useMemo(() => {
    return (
      !!libraryFolder.trim() ||
      ageRating !== "all" ||
      computeHasActiveFilters({
        bookmarkFilter,
        earlyAccess,
        gameState: selectedGameState,
        releaseDateFrom,
        releaseDateTo,
        gameTypes: selectedGameTypes,
        tags: selectedTags,
        genres: selectedGenres,
        developers: selectedDevelopers,
        publishers: selectedPublishers,
      })
    );
  }, [
    libraryFolder,
    bookmarkFilter,
    selectedGameTypes,
    selectedTags,
    selectedGenres,
    selectedDevelopers,
    selectedPublishers,
    selectedGameState,
    releaseDateFrom,
    releaseDateTo,
    earlyAccess,
    ageRating,
  ]);

  // Number of active filter selections (for the badge on the Filters toggle)
  const activeFilterCount = useMemo(() => {
    return (
      Number(!!libraryFolder.trim()) +
      Number(ageRating !== "all") +
      computeActiveFilterCount({
        bookmarkFilter,
        earlyAccess,
        gameState: selectedGameState,
        releaseDateFrom,
        releaseDateTo,
        gameTypes: selectedGameTypes,
        tags: selectedTags,
        genres: selectedGenres,
        developers: selectedDevelopers,
        publishers: selectedPublishers,
      })
    );
  }, [
    libraryFolder,
    bookmarkFilter,
    selectedGameTypes,
    selectedTags,
    selectedGenres,
    selectedDevelopers,
    selectedPublishers,
    selectedGameState,
    releaseDateFrom,
    releaseDateTo,
    earlyAccess,
    ageRating,
  ]);

  // Clear all filters
  const clearAllFilters = useCallback(() => {
    setBookmarkFilter("all");
    setLibraryFolder("");
    setSelectedGameTypes([]);
    setSelectedTags([]);
    setSelectedGenres([]);
    setSelectedDevelopers([]);
    setSelectedPublishers([]);
    setSelectedGameState("");
    setReleaseDateFrom("");
    setReleaseDateTo("");
    setEarlyAccess("all");
    setAgeRating("all");
  }, []);

  // Debounce search so we only fire the API request once the user pauses
  const deferredSearch = useDebouncedValue(search, 300);

  // Convert selected type FilterItems to PlaystashGameTypeEnum values for API
  const gameTypeValues = useMemo(() => {
    return selectedGameTypes
      .map((item) => String(item.id))
      .filter((v): v is PlaystashGameTypeEnum =>
        Object.values(PlaystashGameTypeEnum).includes(
          v as PlaystashGameTypeEnum,
        ),
      );
  }, [selectedGameTypes]);

  // Memoize array values to prevent unnecessary re-renders
  const tagNames = useMemo(
    () => selectedTags.map((t) => t.name),
    [selectedTags],
  );
  const genreNames = useMemo(
    () => selectedGenres.map((g) => g.name),
    [selectedGenres],
  );
  const developerNames = useMemo(
    () => selectedDevelopers.map((d) => d.name),
    [selectedDevelopers],
  );
  const publisherNames = useMemo(
    () => selectedPublishers.map((p) => p.name),
    [selectedPublishers],
  );

  // Searching, filtering or opening the filters loads the server games when
  // auto-load is off.
  useEffect(() => {
    if (!loadAllowed && (search.trim() || showFilters || hasActiveFilters)) {
      allowLoad();
    }
  }, [loadAllowed, search, showFilters, hasActiveFilters, allowLoad]);

  const { count, games, loading, error, loadMore, hasMore, refetch } = useGames(
    {
      search: deferredSearch,
      sortBy,
      order,
      limit: 50,
      bookmarkFilter,
      gameTypes: gameTypeValues,
      tags: tagNames,
      libraryFolder: deferredLibraryFolder,
      genres: genreNames,
      developers: developerNames,
      publishers: publisherNames,
      gameState: selectedGameState || undefined,
      releaseDateFrom: releaseDateFrom || undefined,
      releaseDateTo: releaseDateTo || undefined,
      earlyAccess,
      ageRating,
      enabled: loadAllowed,
    },
  );

  /** "I'm Feeling Lucky": opens a random game. */
  const openRandomGame = useCallback(async () => {
    if (!serverUrl || luckyBusy) return;
    setLuckyBusy(true);
    try {
      const base = serverUrl.replace(/\/+$/, "");
      const res = await authFetch(`${base}/api/games/random`);
      if (!res.ok) {
        throw new Error(await getErrorMessage(res, t("library.lucky.failed")));
      }
      const game = (await res.json()) as PlaystashGame;
      navigate(`/library/${game.id}`);
    } catch (e) {
      void showAlert({
        title: e instanceof Error ? e.message : String(e),
        tone: "danger",
      });
    } finally {
      setLuckyBusy(false);
    }
  }, [serverUrl, luckyBusy, authFetch, navigate, showAlert, t]);

  /** Reload (WPF "Reload Library (F5)"): loads even with auto-load off. */
  const reloadLibrary = useCallback(() => {
    if (!loadAllowed) {
      allowLoad();
      return;
    }
    void refetch();
  }, [loadAllowed, allowLoad, refetch]);

  /** Age rating options are loaded on the first open (logged in only). */
  const loadAgeRatings = useCallback(async () => {
    if (!serverUrl || !user || ageRatingOptions || ageRatingLoadingRef.current)
      return;
    ageRatingLoadingRef.current = true;
    try {
      const base = serverUrl.replace(/\/+$/, "");
      const res = await authFetch(`${base}/api/games?limit=-1`);
      if (!res.ok) throw new Error(String(res.status));
      const json = await res.json();
      setAgeRatingOptions(distinctAgeRatings(json?.data ?? []));
    } catch {
      // Retried on the next open.
    } finally {
      ageRatingLoadingRef.current = false;
    }
  }, [serverUrl, user, ageRatingOptions, authFetch]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(LIB_SORT_KEY, sortBy);
      localStorage.setItem(LIB_ORDER_KEY, order);
    } catch {}
  }, [sortBy, order]);

  // Initialize from URL (first render)
  useEffect(() => {
    if (typeof window === "undefined") return;

    const params = new URL(window.location.href).searchParams;

    const q = params.get("q");
    if (q) setSearch(q);

    const sort = params.get("sort");
    if (sort && SORT_BY.some((o) => o.value === sort)) setSortBy(sort);

    const ord = params.get("order");
    if (ord === "ASC" || ord === "DESC") setOrder(ord);

    const bookmarked = params.get("bookmarked");
    if (bookmarked && isBookmark(bookmarked)) {
      setBookmarkFilter(bookmarked === "1" ? "mine" : bookmarked);
    }

    const types = getParamValues(params, "types").filter(isGameType);
    if (types.length > 0) {
      setSelectedGameTypes(
        types
          .map((t): FilterItem | null => {
            const match = GAME_TYPES.find((gt) => gt.value === t);
            return match ? { id: t, name: match.label } : null;
          })
          .filter((x): x is FilterItem => x !== null),
      );
    }

    const tags = getParamValues(params, "tags");
    if (tags.length > 0) setSelectedTags(tags.map((t) => ({ id: t, name: t })));

    const genres = getParamValues(params, "genres");
    if (genres.length > 0)
      setSelectedGenres(genres.map((g) => ({ id: g, name: g })));

    const developers = getParamValues(params, "developers");
    if (developers.length > 0)
      setSelectedDevelopers(developers.map((d) => ({ id: d, name: d })));

    const publishers = getParamValues(params, "publishers");
    if (publishers.length > 0)
      setSelectedPublishers(publishers.map((p) => ({ id: p, name: p })));

    const state = params.get("state");
    if (state && isProgressState(state)) setSelectedGameState(state);

    const after = params.get("releasedAfter");
    if (after) setReleaseDateFrom(after);

    const before = params.get("releasedBefore");
    if (before) setReleaseDateTo(before);

    const ea = params.get("earlyAccess");
    if (ea && isEarlyAccess(ea)) setEarlyAccess(ea);

    const rating = params.get("ageRating");
    if (rating && isAgeRatingValue(rating)) setAgeRating(rating);

    // GameView pills open the Library with that single filter shown.
    if ((location.state as { openFilters?: boolean } | null)?.openFilters) {
      setShowFilters(true);
    }

    urlInitializedRef.current = true;
  }, [getParamValues, isBookmark, isEarlyAccess, isGameType, isProgressState]);

  // Sync all filters into URL search params for shareable links (debounced)
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!urlInitializedRef.current) return;

    const timeoutId = setTimeout(() => {
      const url = new URL(window.location.href);
      const params = url.searchParams;

      if (search.trim().length > 0) params.set("q", search.trim());
      else params.delete("q");

      if (sortBy !== "sort_title") params.set("sort", sortBy);
      else params.delete("sort");

      if (order !== "ASC") params.set("order", order);
      else params.delete("order");

      if (bookmarkFilter !== "all") params.set("bookmarked", bookmarkFilter);
      else params.delete("bookmarked");

      setParamValues(
        params,
        "types",
        selectedGameTypes
          .map((i) => String(i.id))
          .filter((v): v is PlaystashGameTypeEnum => isGameType(v)),
      );
      setParamValues(
        params,
        "tags",
        selectedTags.map((t) => t.name),
      );
      setParamValues(
        params,
        "genres",
        selectedGenres.map((g) => g.name),
      );
      setParamValues(
        params,
        "developers",
        selectedDevelopers.map((d) => d.name),
      );
      setParamValues(
        params,
        "publishers",
        selectedPublishers.map((p) => p.name),
      );

      if (selectedGameState) params.set("state", selectedGameState);
      else params.delete("state");

      if (releaseDateFrom) params.set("releasedAfter", releaseDateFrom);
      else params.delete("releasedAfter");

      if (releaseDateTo) params.set("releasedBefore", releaseDateTo);
      else params.delete("releasedBefore");

      if (earlyAccess !== "all") params.set("earlyAccess", earlyAccess);
      else params.delete("earlyAccess");

      if (ageRating !== "all") params.set("ageRating", ageRating);
      else params.delete("ageRating");

      // Only update URL if it actually changed to avoid rate-limiting errors
      const newUrl = url.toString();
      if (newUrl !== window.location.href) {
        window.history.replaceState({}, "", newUrl);
      }
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [
    ageRating,
    bookmarkFilter,
    earlyAccess,
    isGameType,
    order,
    releaseDateFrom,
    releaseDateTo,
    search,
    selectedDevelopers,
    selectedGameState,
    selectedGameTypes,
    selectedGenres,
    selectedPublishers,
    selectedTags,
    setParamValues,
    sortBy,
  ]);

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!hasMore) return;
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            loadMore();
          }
        });
      },
      { root: null, rootMargin: "200px", threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loadMore, games.length]);

  // Persist and restore scroll position across navigation.
  // Saves on scroll events; restores once games are in the DOM.
  useScrollRestoration("library_scroll_position", games.length > 0);

  // --- Installed games (Tauri only) ---
  const { installedGames, refetch: refetchInstalledGames } =
    useInstalledGames();

  const INSTALLED_ROWS_KEY = "installed_games_rows";
  const [installedRows, setInstalledRows] = useState(() => {
    try {
      const saved = localStorage.getItem(INSTALLED_ROWS_KEY);
      if (saved) {
        const n = parseInt(saved, 10);
        if (n >= 1 && n <= 5) return n;
      }
    } catch {
      console.warn("Failed to read installed rows from localStorage");
    }
    return 1;
  });
  const handleRowsChange = useCallback((n: number) => {
    setInstalledRows(n);
    try {
      localStorage.setItem(INSTALLED_ROWS_KEY, String(n));
    } catch {
      console.warn("Failed to persist installed rows to localStorage");
    }
  }, []);

  // Map installed games to a PlaystashGame-compatible shape for GameCard
  const installedAsGames: PlaystashGame[] = useMemo(() => {
    return installedGames.map((ig) => {
      const meta = (ig.cachedMetadata || ig.gameMetadata) as any;
      // Cached data is either a full game (metadata nested) or the metadata.
      const isFullGame = !!meta?.metadata;
      const g = {
        id: ig.gameId,
        created_at: new Date(),
        entity_version: 0,
        title: ig.gameTitle,
        sort_title:
          (isFullGame && meta.sort_title) || ig.gameTitle?.toLowerCase(),
        type: ig.gameType as any,
        size: isFullGame ? meta.size : undefined,
        release_date: isFullGame ? meta.release_date : undefined,
        early_access: isFullGame ? meta.early_access : undefined,
        progresses: isFullGame ? meta.progresses : undefined,
        // Carry the server's version info through so installed-only cards can
        // also show the "update available" indicator.
        version: (meta as any)?.version,
        versions: (meta as any)?.versions,
        metadata: meta
          ? {
              title: isFullGame ? meta.metadata.title : meta.title,
              early_access: meta.early_access ?? meta.metadata?.early_access,
              cover: meta.cover ?? meta.metadata?.cover,
              rating: meta.rating ?? meta.metadata?.rating,
              release_date: meta.release_date ?? meta.metadata?.release_date,
              tags: meta.tags ?? meta.metadata?.tags,
              genres: meta.genres ?? meta.metadata?.genres,
              developers: meta.developers ?? meta.metadata?.developers,
              publishers: meta.publishers ?? meta.metadata?.publishers,
              age_rating: meta.age_rating ?? meta.metadata?.age_rating,
            }
          : undefined,
      } as PlaystashGame;
      // Attach installation info for GameCard play button
      (g as any)._installedInfo = {
        installationDirectory: ig.installationDirectory,
        versionDirectory: ig.versionDirectory,
        versionId: ig.versionId,
        versionName: ig.versionName,
        installedAt: ig.installedAt ?? 0,
        lastPlayedAt: ig.lastPlayedAt ?? 0,
      };
      (g as any)._onUninstalled = refetchInstalledGames;
      return g;
    });
  }, [installedGames]);

  // Map installed game id -> installation info so server games that are
  // already installed locally can be marked (e.g. a small "Installed" badge).
  const installedByGameId = useMemo(
    () => buildInstalledGameMap(installedGames),
    [installedGames],
  );

  // Client-side filter + sort installed games with the same Library criteria
  const filteredInstalledGames = useMemo(() => {
    const matching = filterAndSortInstalledGames(installedAsGames, {
      search: deferredSearch,
      gameTypes: gameTypeValues,
      tags: tagNames,
      genres: genreNames,
      developers: developerNames,
      publishers: publisherNames,
    });
    return sortInstalledGames(
      filterInstalledGames(matching, installedFilters),
      installedSort,
      (user as any)?.id ?? (user as any)?.ID,
    );
  }, [
    installedFilters,
    installedSort,
    user,
    installedAsGames,
    deferredSearch,
    gameTypeValues,
    tagNames,
    genreNames,
    developerNames,
    publisherNames,
  ]);

  const visibleGames = useMemo(
    () =>
      isTauri && hideInstalled
        ? games.filter((g) => !installedByGameId.has(g.id))
        : games,
    [games, hideInstalled, installedByGameId, isTauri],
  );

  // Scroll-to-top button once the page is scrolled more than 10 %.
  useEffect(() => {
    const el = document.querySelector(
      "[data-scroll-container]",
    ) as HTMLElement | null;
    if (!el) return;
    const onScroll = () => {
      const scrollable = el.scrollHeight - el.clientHeight;
      setShowScrollTop(scrollable > 0 && el.scrollTop / scrollable > 0.1);
    };
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  const scrollToTop = useCallback(() => {
    const el = document.querySelector(
      "[data-scroll-container]",
    ) as HTMLElement | null;
    el?.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const coverGridStyle = {
    "--ps-cover-size": `${coverSize}px`,
  } as CSSProperties;

  const libraryNotLoaded = !!serverUrl && !loadAllowed;

  return (
    <div className="flex min-h-full flex-col gap-5">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-2">
            <Heading className="flex items-center gap-3">
              Library {count && <Badge className="ml-1">{count}</Badge>}
            </Heading>
            <BigPictureButton />
            <Text className="max-w-2xl">
              Browse, search, and manage your entire game collection.
            </Text>
          </div>
        </div>
        <Divider className="border-ps-line/80" />
      </div>

      <section className="surface-panel rounded-3xl p-5 sm:p-6">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px_auto_auto] lg:items-end">
          <div className="w-full lg:col-span-1">
            <label className="mb-2 block text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-ps-muted">
              Search
            </label>
            <Input
              name="search"
              value={search}
              onChange={(e: any) => setSearch(e.target.value)}
              clearable
              onClear={() => setSearch("")}
              placeholder="Search games..."
              disabled={!serverUrl}
            />
          </div>

          {/* On mobile: [Sort By + Direction | Filters] in one flex row.
              On lg+: lg:contents dissolves the wrapper so each child is a direct grid cell. */}
          <div className="flex items-end gap-2 lg:contents">
            <div className="flex min-w-0 flex-1 items-end gap-2 lg:contents">
              <div className="min-w-0 flex-1">
                <label className="mb-2 block text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-ps-muted">
                  Sort by
                </label>
                <Listbox
                  name="sortBy"
                  value={sortBy}
                  onChange={(v: any) => setSortBy(String(v))}
                >
                  {SORT_BY.map((opt) => (
                    <ListboxOption key={opt.value} value={opt.value}>
                      <ListboxLabel>{opt.label}</ListboxLabel>
                    </ListboxOption>
                  ))}
                </Listbox>
              </div>

              <div className="shrink-0">
                <Button
                  outline
                  className={`${CONTROL_HEIGHT_CLASS} px-3 gap-1.5`}
                  aria-label="Toggle sorting direction"
                  onClick={() =>
                    setOrder((o) => (o === "ASC" ? "DESC" : "ASC"))
                  }
                >
                  {order === "ASC" ? (
                    <ArrowUpIcon className="h-4 w-4" />
                  ) : (
                    <ArrowDownIcon className="h-4 w-4" />
                  )}
                  <span className="hidden sm:inline">
                    {order === "ASC" ? "Ascending" : "Descending"}
                  </span>
                </Button>
              </div>
            </div>

            <div className="flex shrink-0 gap-2">
              <Button
                outline
                className={`${CONTROL_HEIGHT_CLASS} px-3`}
                aria-label={t("library.reload")}
                title={t("library.reload")}
                disabled={!serverUrl || loading}
                onClick={reloadLibrary}
              >
                <ArrowPathIcon className="h-4 w-4" />
              </Button>
              <Button
                outline
                className={`${CONTROL_HEIGHT_CLASS} px-3`}
                aria-label={t("library.lucky")}
                title={t("library.lucky")}
                disabled={!serverUrl || luckyBusy}
                onClick={() => void openRandomGame()}
              >
                <DiceIcon className="h-4 w-4" />
              </Button>
              <Button
                outline
                className={`${CONTROL_HEIGHT_CLASS} px-3 ${hasActiveFilters ? "text-ps-accent" : ""}`}
                aria-label={
                  showFilters
                    ? "Hide filters"
                    : `Show filters${activeFilterCount > 0 ? ` (${activeFilterCount} active)` : ""}`
                }
                onClick={() => setShowFilters((s) => !s)}
              >
                <FunnelIcon className="h-4 w-4 sm:mr-1" />
                <span>{showFilters ? "Hide filters" : "Filters"}</span>
                {activeFilterCount > 0 && (
                  <span
                    className="ml-1 inline-flex h-[1.125rem] min-w-[1.25rem] items-center justify-center rounded-full bg-ps-accent px-1 text-[0.65rem] font-bold leading-none text-white"
                    aria-label={`${activeFilterCount} active filters`}
                  >
                    <span className="translate-y-[0.2em]">
                      {activeFilterCount}
                    </span>
                  </span>
                )}
              </Button>
            </div>
          </div>
        </div>
      </section>
      {showFilters && (
        <div className="surface-panel mb-2 shrink-0 rounded-3xl animate-[panel-in_0.18s_ease-out]">
          <div className="px-4 pt-4 pb-4 sm:px-6 sm:pt-5 sm:pb-5">
            {/* Header with Clear All Filters Button */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <FunnelIcon className="h-4 w-4 text-ps-muted" />
                <span className="text-xs text-ps-muted">
                  {hasActiveFilters ? "Filters active" : "No filters active"}
                </span>
              </div>
              {hasActiveFilters && (
                <Button
                  outline
                  onClick={clearAllFilters}
                  className={`${CONTROL_HEIGHT_CLASS} px-3 flex items-center gap-1`}
                >
                  <TrashIcon className="h-4 w-4" />
                  Clear All
                </Button>
              )}
            </div>

            {/* Section 1: Multi-Select Filter Buttons */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {/* Types */}
              <div className="col-span-1">
                <label className="mb-2 block text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-ps-muted">
                  Type
                </label>
                <Button
                  outline
                  onClick={() => setGameTypesDialogOpen(true)}
                  className={`w-full justify-start ${CONTROL_HEIGHT_CLASS} px-3`}
                >
                  <span
                    className={`truncate ${selectedGameTypes.length > 0 ? "text-ps-accent-cool" : ""}`}
                  >
                    {selectedGameTypes.length > 0
                      ? `${selectedGameTypes.length} selected`
                      : "All types"}
                  </span>
                </Button>
              </div>

              {/* Tags */}
              <div className="col-span-1">
                <label className="mb-2 block text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-ps-muted">
                  Tags
                </label>
                <Button
                  outline
                  onClick={() => setTagsDialogOpen(true)}
                  className={`w-full justify-start ${CONTROL_HEIGHT_CLASS} px-3`}
                >
                  <span
                    className={`truncate ${selectedTags.length > 0 ? "text-ps-accent-cool" : ""}`}
                  >
                    {selectedTags.length > 0
                      ? `${selectedTags.length} selected`
                      : "All tags"}
                  </span>
                </Button>
              </div>

              {/* Genres */}
              <div className="col-span-1">
                <label className="mb-2 block text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-ps-muted">
                  Genres
                </label>
                <Button
                  outline
                  onClick={() => setGenresDialogOpen(true)}
                  className={`w-full justify-start ${CONTROL_HEIGHT_CLASS} px-3`}
                >
                  <span
                    className={`truncate ${selectedGenres.length > 0 ? "text-ps-accent-cool" : ""}`}
                  >
                    {selectedGenres.length > 0
                      ? `${selectedGenres.length} selected`
                      : "All genres"}
                  </span>
                </Button>
              </div>

              {/* Developers */}
              <div className="col-span-1">
                <label className="mb-2 block text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-ps-muted">
                  Developers
                </label>
                <Button
                  outline
                  onClick={() => setDevelopersDialogOpen(true)}
                  className={`w-full justify-start ${CONTROL_HEIGHT_CLASS} px-3`}
                >
                  <span
                    className={`truncate ${selectedDevelopers.length > 0 ? "text-ps-accent-cool" : ""}`}
                  >
                    {selectedDevelopers.length > 0
                      ? `${selectedDevelopers.length} selected`
                      : "All developers"}
                  </span>
                </Button>
              </div>

              {/* Publishers */}
              <div className="col-span-1">
                <label className="mb-2 block text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-ps-muted">
                  Publishers
                </label>
                <Button
                  outline
                  onClick={() => setPublishersDialogOpen(true)}
                  className={`w-full justify-start ${CONTROL_HEIGHT_CLASS} px-3`}
                >
                  <span
                    className={`truncate ${selectedPublishers.length > 0 ? "text-ps-accent-cool" : ""}`}
                  >
                    {selectedPublishers.length > 0
                      ? `${selectedPublishers.length} selected`
                      : "All publishers"}
                  </span>
                </Button>
              </div>
            </div>

            {/* Section 2: Dropdown Controls & Date Pickers */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mt-4">
              {/* Game State */}
              <div className="col-span-1">
                <label className="mb-2 block text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-ps-muted">
                  State
                </label>
                <Listbox
                  name="gameState"
                  value={selectedGameState}
                  onChange={(v: any) =>
                    setSelectedGameState(v as ProgressStateEnum | "")
                  }
                  disabled={!user}
                >
                  <ListboxOption value="">
                    <ListboxLabel>All</ListboxLabel>
                  </ListboxOption>
                  {GAME_STATES.map((state) => (
                    <ListboxOption key={state.value} value={state.value}>
                      <ListboxLabel>{state.label}</ListboxLabel>
                    </ListboxOption>
                  ))}
                </Listbox>
              </div>

              {/* Release Date From */}
              <div className="col-span-1">
                <label className="mb-2 block text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-ps-muted">
                  Released After
                </label>
                <Input
                  type="date"
                  className={INPUT_CONTROL_HEIGHT_CLASS}
                  value={releaseDateFrom}
                  onChange={(e: any) => setReleaseDateFrom(e.target.value)}
                />
              </div>

              {/* Release Date To */}
              <div className="col-span-1">
                <label className="mb-2 block text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-ps-muted">
                  Released Before
                </label>
                <Input
                  type="date"
                  className={INPUT_CONTROL_HEIGHT_CLASS}
                  value={releaseDateTo}
                  onChange={(e: any) => setReleaseDateTo(e.target.value)}
                />
              </div>

              {/* Early Access */}
              <div className="col-span-1">
                <label className="mb-2 block text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-ps-muted">
                  Early Access
                </label>
                <Listbox
                  name="earlyAccess"
                  value={earlyAccess}
                  onChange={(v: any) => setEarlyAccess(v as EarlyAccessFilter)}
                >
                  {EARLY_ACCESS_OPTIONS.map((opt) => (
                    <ListboxOption key={opt.value} value={opt.value}>
                      <ListboxLabel>{opt.label}</ListboxLabel>
                    </ListboxOption>
                  ))}
                </Listbox>
              </div>

              {/* Bookmarks */}
              <div className="col-span-1">
                <label className="mb-2 block text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-ps-muted">
                  Bookmarked
                </label>
                <Listbox
                  name="bookmarkFilter"
                  value={bookmarkFilter}
                  onChange={(v: any) => setBookmarkFilter(v as BookmarkFilter)}
                  disabled={!user}
                >
                  {BOOKMARK_OPTIONS.map((opt) => (
                    <ListboxOption key={opt.value} value={opt.value}>
                      <ListboxLabel>{opt.label}</ListboxLabel>
                    </ListboxOption>
                  ))}
                </Listbox>
              </div>

              {/* Age Rating (options load on first open) */}
              <div
                className="col-span-1"
                onPointerDownCapture={() => void loadAgeRatings()}
                onKeyDownCapture={() => void loadAgeRatings()}
              >
                <label className="mb-2 block text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-ps-muted">
                  {t("library.ageRating")}
                </label>
                <Listbox
                  name="ageRating"
                  value={ageRating}
                  onChange={(v: any) => setAgeRating(String(v))}
                  disabled={!user}
                >
                  <ListboxOption value="all">
                    <ListboxLabel>{t("library.ageRating.all")}</ListboxLabel>
                  </ListboxOption>
                  {ageRating !== "all" &&
                    !(ageRatingOptions ?? []).some(
                      (value) => ageRatingOptionValue(value) === ageRating,
                    ) && (
                      <ListboxOption value={ageRating}>
                        <ListboxLabel>
                          {ageRating === "null"
                            ? t("library.ageRating.na")
                            : ageRating}
                        </ListboxLabel>
                      </ListboxOption>
                    )}
                  {(ageRatingOptions ?? []).map((value) => (
                    <ListboxOption
                      key={ageRatingOptionValue(value)}
                      value={ageRatingOptionValue(value)}
                    >
                      <ListboxLabel>
                        {value === null ? t("library.ageRating.na") : value}
                      </ListboxLabel>
                    </ListboxOption>
                  ))}
                </Listbox>
              </div>
            </div>

            {/* Display options (client-side, not counted as filters) */}
            <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-ps-line pt-4">
              {isTauri && (
                <label className="flex cursor-pointer items-center gap-2 text-sm text-ps-text">
                  <input
                    type="checkbox"
                    className="size-4 accent-ps-accent"
                    checked={hideInstalled}
                    onChange={(e) => setHideInstalled(e.target.checked)}
                  />
                  {t("library.hideInstalled")}
                </label>
              )}
              <label className="flex items-center gap-3 text-sm text-ps-text">
                <span className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-ps-muted">
                  {t("library.coverSize")}
                </span>
                <input
                  type="range"
                  min={COVER_SIZE_MIN}
                  max={COVER_SIZE_MAX}
                  value={coverSize}
                  aria-label={t("library.coverSize")}
                  className="w-40 accent-ps-accent"
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    setCoverSizeState(next);
                    persistCoverSize(next);
                  }}
                />
              </label>
            </div>

            {/* Selected Items Display */}
            {(selectedGameTypes.length > 0 ||
              selectedTags.length > 0 ||
              selectedGenres.length > 0 ||
              selectedDevelopers.length > 0 ||
              selectedPublishers.length > 0) && (
              <div className="mt-4 border-t border-ps-line pt-4">
                <div className="flex flex-wrap gap-1.5">
                  {selectedGameTypes.map((item) => (
                    <Badge
                      key={item.name}
                      color="pink"
                      className="text-xs flex items-center gap-1"
                    >
                      {item.name}
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedGameTypes((prev) =>
                            prev.filter((t) => t.name !== item.name),
                          )
                        }
                        className="hover:text-red-400 ml-0.5"
                      >
                        <XMarkIcon className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                  {selectedTags.map((tag) => (
                    <Badge
                      key={tag.name}
                      color="blue"
                      className="text-xs flex items-center gap-1"
                    >
                      {tag.name}
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedTags((prev) =>
                            prev.filter((t) => t.name !== tag.name),
                          )
                        }
                        className="hover:text-red-400 ml-0.5"
                      >
                        <XMarkIcon className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                  {selectedGenres.map((genre) => (
                    <Badge
                      key={genre.name}
                      color="green"
                      className="text-xs flex items-center gap-1"
                    >
                      {genre.name}
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedGenres((prev) =>
                            prev.filter((g) => g.name !== genre.name),
                          )
                        }
                        className="hover:text-red-400 ml-0.5"
                      >
                        <XMarkIcon className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                  {selectedDevelopers.map((dev) => (
                    <Badge
                      key={dev.name}
                      color="purple"
                      className="text-xs flex items-center gap-1"
                    >
                      {dev.name}
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedDevelopers((prev) =>
                            prev.filter((d) => d.name !== dev.name),
                          )
                        }
                        className="hover:text-red-400 ml-0.5"
                      >
                        <XMarkIcon className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                  {selectedPublishers.map((pub) => (
                    <Badge
                      key={pub.name}
                      color="orange"
                      className="text-xs flex items-center gap-1"
                    >
                      {pub.name}
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedPublishers((prev) =>
                            prev.filter((p) => p.name !== pub.name),
                          )
                        }
                        className="hover:text-red-400 ml-0.5"
                      >
                        <XMarkIcon className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      <div className="flex-1 overflow-y-auto overflow-x-hidden text-center">
        <LibraryCategories
          storageKey={`playstash_library_categories:${serverUrl}:${user?.id}`}
          tags={tagNames}
          folder={libraryFolder}
          onFolderChange={setLibraryFolder}
          onSelect={(category) => {
            setLibraryFolder(category?.folder || "");
            setSelectedTags(
              (category?.tags || []).map((name) => ({ id: name, name })),
            );
          }}
        />
        {!serverUrl && (
          <div className="surface-panel-soft rounded-3xl p-8 text-sm text-ps-muted">
            Connect to a server to load games.
          </div>
        )}
        {serverUrl && error && (
          <div className="mb-4 rounded-2xl bg-red-500/10 p-4 text-sm text-red-500">
            {error}
          </div>
        )}

        {/* Installed Games Section (Tauri only) */}
        {isTauri && (
          <SectionExpander
            title={`Installed Games (${filteredInstalledGames.length})`}
            defaultOpen={getInstalledOpen()}
            onOpenChange={setInstalledOpen}
            headerRight={
              <div className="flex items-center gap-2">
                <div
                  className="w-48"
                  title={t("library.installed.sortTooltip")}
                >
                  <Listbox
                    name="installedSort"
                    aria-label={t("library.installed.sortTooltip")}
                    value={installedSort}
                    onChange={(v: any) => setInstalledSort(v as InstalledSort)}
                  >
                    {INSTALLED_SORTS.map((sort) => (
                      <ListboxOption key={sort} value={sort}>
                        <ListboxLabel>
                          {t(INSTALLED_SORT_LABELS[sort])}
                        </ListboxLabel>
                      </ListboxOption>
                    ))}
                  </Listbox>
                </div>
                <RowCountControl
                  value={installedRows}
                  onChange={handleRowsChange}
                />
              </div>
            }
          >
            <div className="flex flex-wrap items-end gap-3 pb-2 text-left">
              <div className="w-52">
                <Listbox
                  name="installedEarlyAccess"
                  aria-label={t("library.installed.earlyAccess.label")}
                  value={installedFilters.earlyAccess}
                  onChange={(v: any) =>
                    setInstalledFilters((f) => ({
                      ...f,
                      earlyAccess: v as InstalledEarlyAccess,
                    }))
                  }
                >
                  {(
                    Object.keys(
                      INSTALLED_EARLY_ACCESS_LABELS,
                    ) as InstalledEarlyAccess[]
                  ).map((value) => (
                    <ListboxOption key={value} value={value}>
                      <ListboxLabel>
                        {t(INSTALLED_EARLY_ACCESS_LABELS[value])}
                      </ListboxLabel>
                    </ListboxOption>
                  ))}
                </Listbox>
              </div>
              <div className="w-36">
                <Input
                  name="installedReleaseYear"
                  inputMode="numeric"
                  aria-label={t("library.installed.releaseYear")}
                  placeholder={t("library.installed.releaseYear")}
                  value={installedFilters.releaseYear}
                  onChange={(e: any) =>
                    setInstalledFilters((f) => ({
                      ...f,
                      releaseYear: e.target.value,
                    }))
                  }
                />
              </div>
              <div className="w-48">
                <Listbox
                  name="installedType"
                  aria-label={t("library.installed.type.label")}
                  value={installedFilters.type}
                  onChange={(v: any) =>
                    setInstalledFilters((f) => ({
                      ...f,
                      type: v as InstalledTypeFilter,
                    }))
                  }
                >
                  {INSTALLED_TYPE_FILTERS.map((value) => (
                    <ListboxOption key={value} value={value}>
                      <ListboxLabel>
                        {t(INSTALLED_TYPE_LABELS[value])}
                      </ListboxLabel>
                    </ListboxOption>
                  ))}
                </Listbox>
              </div>
            </div>
            {filteredInstalledGames.length === 0 ? (
              <div className="surface-panel-soft rounded-2xl p-4 text-sm text-ps-muted">
                No installed games found.
              </div>
            ) : (
              <div className="overflow-x-auto overflow-y-hidden pb-3">
                <div
                  className="grid gap-5 py-2"
                  style={{
                    gridTemplateRows: `repeat(${Math.min(installedRows, filteredInstalledGames.length)}, auto)`,
                    gridAutoFlow: "column",
                    gridAutoColumns: "160px",
                  }}
                >
                  {filteredInstalledGames.map((g) => (
                    <GameCard
                      key={`installed-${g.id}`}
                      game={g}
                      sortBy={sortBy}
                      hideInstalledBadge
                    />
                  ))}
                </div>
              </div>
            )}
          </SectionExpander>
        )}

        {serverUrl && isOnline && loadAllowed && <RecentlyAddedGames />}

        {libraryNotLoaded && (
          <div className="surface-panel-soft mb-4 rounded-3xl p-8 text-sm text-ps-muted">
            <p>{t("library.notLoaded")}</p>
            <Button outline className="mt-3" onClick={reloadLibrary}>
              <ArrowPathIcon className="h-4 w-4" />
              {t("library.loadNow")}
            </Button>
          </div>
        )}

        {/* Server Games Section */}
        {isTauri && !isOnline ? (
          <div className="surface-panel-soft rounded-3xl p-8 text-sm text-ps-muted text-center">
            <p className="font-semibold text-ps-text mb-2">Offline Mode</p>
            <p>Server games are unavailable while offline.</p>
            <p className="mt-1">Installed games remain fully playable above.</p>
          </div>
        ) : isTauri ? (
          <SectionExpander
            title={`Server Games (${visibleGames.length} of ${count ?? 0})`}
            defaultOpen={true}
          >
            {serverUrl && loading && games.length === 0 && (
              <div className="grid gap-4 sm:gap-6 grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] sm:grid-cols-[repeat(auto-fill,minmax(12rem,1fr))]">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div
                    key={i}
                    className="aspect-3/4 rounded-3xl bg-ps-panel-strong motion-safe:animate-pulse"
                    aria-hidden="true"
                  />
                ))}
              </div>
            )}
            {serverUrl &&
              loadAllowed &&
              !loading &&
              games.length === 0 &&
              !error && (
                <div className="surface-panel-soft rounded-3xl p-8 text-sm text-ps-muted">
                  No games found.
                  {(search.trim() || hasActiveFilters) && (
                    <div className="mt-2">
                      <TextLink
                        href="#"
                        onClick={() => {
                          clearAllFilters();
                          setShowFilters(false);
                          setSearch("");
                        }}
                      >
                        <Strong>Try clearing all filters and search</Strong>
                      </TextLink>
                    </div>
                  )}
                </div>
              )}
            <div
              className="min-w-0 grid gap-5 grid-cols-[repeat(auto-fill,minmax(var(--ps-cover-size),1fr))] py-2 pb-8"
              style={coverGridStyle}
            >
              {visibleGames.map((g, i) => {
                const installed = installedByGameId.get(g.id);
                const cardGame = installed
                  ? {
                      ...g,
                      _installedInfo: {
                        installationDirectory: installed.installationDirectory,
                        versionDirectory: installed.versionDirectory,
                        versionId: installed.versionId,
                        versionName: installed.versionName,
                      },
                      _onUninstalled: refetchInstalledGames,
                    }
                  : g;
                return (
                  <motion.div
                    key={g.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                      delay: Math.min(i * 0.03, 0.3),
                      duration: DURATION_SLOW,
                      ease: EASE_OUT,
                    }}
                    className="min-w-0"
                  >
                    <GameCard game={cardGame} sortBy={sortBy} />
                  </motion.div>
                );
              })}
            </div>
            {hasMore && <div ref={sentinelRef} className="h-10 -mt-10" />}
            {loading && games.length > 0 && (
              <div className="flex items-center justify-center gap-2 p-4 text-xs text-ps-muted">
                <svg
                  className="h-3.5 w-3.5 motion-safe:animate-spin"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                Loading more…
              </div>
            )}
          </SectionExpander>
        ) : (
          <>
            {serverUrl && loading && games.length === 0 && (
              <div className="grid gap-4 sm:gap-6 grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] sm:grid-cols-[repeat(auto-fill,minmax(12rem,1fr))]">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div
                    key={i}
                    className="aspect-3/4 rounded-3xl bg-ps-panel-strong motion-safe:animate-pulse"
                    aria-hidden="true"
                  />
                ))}
              </div>
            )}
            {serverUrl &&
              loadAllowed &&
              !loading &&
              games.length === 0 &&
              !error && (
                <div className="surface-panel-soft rounded-3xl p-8 text-sm text-ps-muted">
                  No games found.
                  {(search.trim() || hasActiveFilters) && (
                    <div className="mt-2">
                      <TextLink
                        href="#"
                        onClick={() => {
                          clearAllFilters();
                          setShowFilters(false);
                          setSearch("");
                        }}
                      >
                        <Strong>Try clearing all filters and search</Strong>
                      </TextLink>
                    </div>
                  )}
                </div>
              )}
            <div
              className="min-w-0 grid gap-5 grid-cols-[repeat(auto-fill,minmax(var(--ps-cover-size),1fr))] py-2 pb-8"
              style={coverGridStyle}
            >
              {visibleGames.map((g, i) => {
                const installed = installedByGameId.get(g.id);
                const cardGame = installed
                  ? {
                      ...g,
                      _installedInfo: {
                        installationDirectory: installed.installationDirectory,
                        versionDirectory: installed.versionDirectory,
                        versionId: installed.versionId,
                        versionName: installed.versionName,
                      },
                      _onUninstalled: refetchInstalledGames,
                    }
                  : g;
                return (
                  <motion.div
                    key={g.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                      delay: Math.min(i * 0.03, 0.3),
                      duration: DURATION_SLOW,
                      ease: EASE_OUT,
                    }}
                    className="min-w-0"
                  >
                    <GameCard game={cardGame} sortBy={sortBy} />
                  </motion.div>
                );
              })}
            </div>
            {hasMore && <div ref={sentinelRef} className="h-10 -mt-10" />}
            {loading && games.length > 0 && (
              <div className="flex items-center justify-center gap-2 p-4 text-xs text-ps-muted">
                <svg
                  className="h-3.5 w-3.5 motion-safe:animate-spin"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                Loading more…
              </div>
            )}
          </>
        )}
      </div>

      {showScrollTop && (
        <button
          type="button"
          onClick={scrollToTop}
          aria-label={t("library.scrollTop")}
          title={t("library.scrollTop")}
          className="fixed right-6 bottom-6 z-30 flex size-[50px] items-center justify-center rounded-full bg-ps-accent text-ps-on-accent shadow-[var(--shadow-card)] hover:bg-ps-accent-hover active:bg-ps-accent-pressed"
        >
          <ChevronUpIcon className="size-6" />
        </button>
      )}

      {/* Filter Dialogs */}
      <MultiSelectFilterDialog
        open={gameTypesDialogOpen}
        onClose={() => setGameTypesDialogOpen(false)}
        title="Types"
        staticItems={GAME_TYPE_FILTER_ITEMS}
        selectedItems={selectedGameTypes}
        onSelectionChange={setSelectedGameTypes}
        badgeColor="pink"
      />
      <MultiSelectFilterDialog
        open={tagsDialogOpen}
        onClose={() => setTagsDialogOpen(false)}
        title="Tags"
        endpoint="/api/tags"
        selectedItems={selectedTags}
        onSelectionChange={setSelectedTags}
        badgeColor="blue"
      />
      <MultiSelectFilterDialog
        open={genresDialogOpen}
        onClose={() => setGenresDialogOpen(false)}
        title="Genres"
        endpoint="/api/genres"
        selectedItems={selectedGenres}
        onSelectionChange={setSelectedGenres}
        badgeColor="green"
      />
      <MultiSelectFilterDialog
        open={developersDialogOpen}
        onClose={() => setDevelopersDialogOpen(false)}
        title="Developers"
        endpoint="/api/developers"
        selectedItems={selectedDevelopers}
        onSelectionChange={setSelectedDevelopers}
        badgeColor="purple"
      />
      <MultiSelectFilterDialog
        open={publishersDialogOpen}
        onClose={() => setPublishersDialogOpen(false)}
        title="Publishers"
        endpoint="/api/publishers"
        selectedItems={selectedPublishers}
        onSelectionChange={setSelectedPublishers}
        badgeColor="orange"
      />
    </div>
  );
}
