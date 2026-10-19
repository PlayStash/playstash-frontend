import { LibraryCategories } from "@/components/LibraryCategories";
import { RecentlyAddedGames } from "@/components/RecentlyAddedGames";
import { BigPictureButton } from "@/components/BigPicture";
import GameCard from "@/components/GameCard";
import { useAuth } from "@/context/AuthContext";
import { BookmarkFilter, EarlyAccessFilter, useGames } from "@/hooks/useGames";
import { useScrollRestoration } from "@/hooks/useScrollRestoration";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { Heading } from "@tw/heading";
import { Input } from "@tw/input";
import { Listbox, ListboxLabel, ListboxOption } from "@tw/listbox";
import {
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
  useSyncExternalStore,
  type CSSProperties,
  type PropsWithChildren,
} from "react";
import {
  AnimatePresence,
  motion,
  useIsPresent,
  useReducedMotion,
} from "motion/react";
import { EASE_OUT } from "@/lib/motion";
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
import { translate, useTranslation, type TranslationKey } from "@/i18n";
import { fillTemplate } from "@/utils/downloadPipeline";
import { getErrorMessage } from "@/utils/apiError";
import {
  COVER_SIZE_MAX,
  COVER_SIZE_MIN,
  getCoverSize,
  getInstalledOpen,
  getLibraryRetain,
  isLibraryLoadAllowed,
  LIBRARY_COVER_SIZE_KEY,
  LIBRARY_PREFERENCES_EVENT,
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
import "@/styles/library.css";
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

const SORT_BY: { label: TranslationKey; value: string }[] = [
  { label: "library.sort.title", value: "sort_title" },
  { label: "library.sort.size", value: "size" },
  { label: "library.sort.dateAdded", value: "created_at" },
  { label: "library.sort.releaseDate", value: "metadata.release_date" },
  { label: "library.sort.rating", value: "metadata.rating" },
  { label: "library.sort.downloadCount", value: "download_count" },
  {
    label: "library.sort.averagePlaytime",
    value: "metadata.average_playtime",
  },
];

const GAME_TYPES: { label: TranslationKey; value: PlaystashGameTypeEnum }[] = [
  {
    label: "libraryFilters.gameType.windowsSetup",
    value: PlaystashGameTypeEnum.windows_setup,
  },
  {
    label: "libraryFilters.gameType.windowsPortable",
    value: PlaystashGameTypeEnum.windows_portable,
  },
  {
    label: "libraryFilters.gameType.linuxPortable",
    value: PlaystashGameTypeEnum.linux_portable,
  },
];

const GAME_STATES: { label: TranslationKey; value: ProgressStateEnum }[] = [
  { label: "libraryFilters.state.unplayed", value: ProgressStateEnum.unplayed },
  { label: "libraryFilters.state.infinite", value: ProgressStateEnum.infinite },
  { label: "libraryFilters.state.playing", value: ProgressStateEnum.playing },
  {
    label: "libraryFilters.state.completed",
    value: ProgressStateEnum.completed,
  },
  {
    label: "libraryFilters.state.abortedTemporary",
    value: ProgressStateEnum.aborted_temporary,
  },
  {
    label: "libraryFilters.state.abortedPermanent",
    value: ProgressStateEnum.aborted_permanent,
  },
];

const EARLY_ACCESS_OPTIONS: {
  label: TranslationKey;
  value: EarlyAccessFilter;
}[] = [
  { label: "common.all", value: "all" },
  { label: "libraryFilters.earlyAccess.only", value: "true" },
  { label: "libraryFilters.earlyAccess.none", value: "false" },
];

const BOOKMARK_OPTIONS: { label: TranslationKey; value: BookmarkFilter }[] = [
  { label: "common.all", value: "all" },
  { label: "libraryFilters.bookmarked.mine", value: "mine" },
  { label: "libraryFilters.bookmarked.others", value: "others" },
];

/** Display name of a game type filter item (its id is the enum value). */
function gameTypeLabel(
  t: (key: TranslationKey) => string,
  item: FilterItem,
): string {
  const match = GAME_TYPES.find((gt) => gt.value === item.id);
  return match ? t(match.label) : item.name;
}

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

/** A selected filter value with a remove control sized for touch. */
function RemovableFilterChip({
  label,
  color,
  onRemove,
}: {
  label: string;
  color: "pink" | "blue" | "green" | "purple" | "orange";
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Badge
      color={color}
      className="flex max-w-full min-w-0 items-center gap-1 text-xs"
    >
      <span className="min-w-0 truncate" title={label}>
        {label}
      </span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={fillTemplate(t("libraryFilters.removeItem"), {
          name: label,
        })}
        className="ps-library-chip-remove"
      >
        <XMarkIcon className="h-3 w-3" aria-hidden="true" />
      </button>
    </Badge>
  );
}

/** Cards that take part in the one-time grid entrance (about one screen). */
const GRID_INTRO_COUNT = 12;

const compactLibraryQuery = "(max-width: 640px)";

function subscribeCompactLibrary(onChange: () => void) {
  const query = window.matchMedia?.(compactLibraryQuery);
  if (!query) return () => {};
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

const getCompactLibrarySnapshot = () =>
  window.matchMedia?.(compactLibraryQuery).matches ?? false;

function LibraryFiltersPanel({ children }: PropsWithChildren) {
  const isPresent = useIsPresent();
  const reduceMotion = useReducedMotion();
  const compact = useSyncExternalStore(
    subscribeCompactLibrary,
    getCompactLibrarySnapshot,
    () => false,
  );
  const gap = compact ? 20 : 24;

  return (
    <motion.div
      className="shrink-0 overflow-hidden"
      inert={!isPresent}
      aria-hidden={isPresent ? undefined : true}
      // Absorb the responsive flex gap before removing this child.
      initial={{ height: 0, opacity: 0, marginBottom: -gap }}
      animate={{ height: "auto", opacity: 1, marginBottom: 0 }}
      exit={{ height: 0, opacity: 0, marginBottom: -gap }}
      transition={{
        duration: reduceMotion ? 0 : 0.24,
        ease: EASE_OUT,
        opacity: { duration: reduceMotion ? 0.1 : 0.16 },
      }}
    >
      {children}
    </motion.div>
  );
}

export default function Library() {
  const { serverUrl, user, authFetch } = useAuth();
  const { t, locale } = useTranslation();
  const { showAlert } = useAlertDialog();
  // Static items for the game type filter (used in MultiSelectFilterDialog).
  // Keyed on the locale so the array stays stable between renders.
  const gameTypeFilterItems: FilterItem[] = useMemo(
    () =>
      GAME_TYPES.map((gt) => ({
        id: gt.value,
        name: translate(gt.label, locale),
      })),
    [locale],
  );
  const navigate = useNavigate();
  const location = useLocation();
  const { isOnline } = useOnlineStatus();
  const isTauri = isTauriApp();

  const CONTROL_HEIGHT_CLASS = "min-h-11 sm:min-h-9";
  const INPUT_CONTROL_HEIGHT_CLASS = "[&_input]:min-h-11 sm:[&_input]:min-h-9";

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
  const [coverSize, setCoverSizeState] = useState(() => {
    try {
      if (localStorage.getItem(LIBRARY_COVER_SIZE_KEY) === null) return 190;
    } catch {}
    return getCoverSize();
  });
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
    window.dispatchEvent(new Event("playstash:library-load-requested"));
  }, []);

  useEffect(() => {
    const syncLoading = () => setLoadAllowed(isLibraryLoadAllowed());
    window.addEventListener("playstash:library-load-requested", syncLoading);
    window.addEventListener(LIBRARY_PREFERENCES_EVENT, syncLoading);
    return () => {
      window.removeEventListener(
        "playstash:library-load-requested",
        syncLoading,
      );
      window.removeEventListener(LIBRARY_PREFERENCES_EVENT, syncLoading);
    };
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
  // The page switches loading on during render; the effect records the
  // request for the session and tells the other listeners.
  const wantsLoad = !!search.trim() || showFilters || hasActiveFilters;
  if (!loadAllowed && wantsLoad) setLoadAllowed(true);
  useEffect(() => {
    if (!wantsLoad || isLibraryLoadAllowed()) return;
    requestLibraryLoad();
    window.dispatchEvent(new Event("playstash:library-load-requested"));
  }, [wantsLoad]);

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

  // Reapply links from the persistent rail and browser history, including
  // navigation between filters while this page stays mounted. Applied during
  // render whenever the location changes, so the filters are in place before
  // the first fetch and before the URL sync below runs.
  const locationKey = `${location.key}|${location.search}`;
  const [appliedLocationKey, setAppliedLocationKey] = useState<string | null>(
    null,
  );
  if (appliedLocationKey !== locationKey) {
    setAppliedLocationKey(locationKey);

    const params = new URLSearchParams(location.search);

    const q = params.get("q");
    setSearch(q || "");

    const sort = params.get("sort");
    if (sort && SORT_BY.some((o) => o.value === sort)) setSortBy(sort);

    const ord = params.get("order");
    if (ord === "ASC" || ord === "DESC") setOrder(ord);

    const bookmarked = params.get("bookmarked");
    setBookmarkFilter(
      bookmarked && isBookmark(bookmarked)
        ? bookmarked === "1"
          ? "mine"
          : bookmarked
        : "all",
    );

    const types = getParamValues(params, "types").filter(isGameType);
    setSelectedGameTypes(
      types
        .map((t): FilterItem | null => {
          const match = GAME_TYPES.find((gt) => gt.value === t);
          return match ? { id: t, name: translate(match.label) } : null;
        })
        .filter((x): x is FilterItem => x !== null),
    );

    const tags = getParamValues(params, "tags");
    setSelectedTags(tags.map((t) => ({ id: t, name: t })));

    const genres = getParamValues(params, "genres");
    setSelectedGenres(genres.map((g) => ({ id: g, name: g })));

    const developers = getParamValues(params, "developers");
    setSelectedDevelopers(developers.map((d) => ({ id: d, name: d })));

    const publishers = getParamValues(params, "publishers");
    setSelectedPublishers(publishers.map((p) => ({ id: p, name: p })));

    const state = params.get("state");
    setSelectedGameState(state && isProgressState(state) ? state : "");

    const after = params.get("releasedAfter");
    setReleaseDateFrom(after || "");

    const before = params.get("releasedBefore");
    setReleaseDateTo(before || "");

    const ea = params.get("earlyAccess");
    setEarlyAccess(ea && isEarlyAccess(ea) ? ea : "all");

    const rating = params.get("ageRating");
    setAgeRating(rating && isAgeRatingValue(rating) ? rating : "all");
    setLibraryFolder(params.get("folder") || "");

    // GameView pills open the Library with that single filter shown.
    if ((location.state as { openFilters?: boolean } | null)?.openFilters) {
      setShowFilters(true);
    }
  }

  // Sync all filters into URL search params for shareable links (debounced)
  useEffect(() => {
    if (typeof window === "undefined") return;

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

      if (libraryFolder.trim()) params.set("folder", libraryFolder.trim());
      else params.delete("folder");

      // Only update URL if it actually changed to avoid rate-limiting errors
      const newUrl = url.toString();
      if (newUrl !== window.location.href) {
        window.history.replaceState({}, "", newUrl);
        window.dispatchEvent(new Event("playstash:library-location-change"));
      }
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [
    ageRating,
    libraryFolder,
    bookmarkFilter,
    earlyAccess,
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
    sortBy,
  ]);

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!hasMore) return;
    const el = sentinelRef.current;
    if (!el) return;
    // Observe within the library's own scroll container so the margin starts
    // loading the next page well before the end is reached.
    const root = el.closest("[data-scroll-container]") as HTMLElement | null;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            loadMore();
          }
        });
      },
      { root, rootMargin: "800px", threshold: 0 },
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
  }, [installedGames, refetchInstalledGames]);

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

  // Settle the first page of covers once, right after the skeleton gives way.
  // Results already present on mount (returning from a game), later pages and
  // filter changes appear immediately.
  const [gridIntro, setGridIntro] = useState(false);
  const gridIntroPhase = useRef<"idle" | "pending" | "done">("idle");
  useEffect(() => {
    if (gridIntroPhase.current === "done") return;
    if (visibleGames.length === 0) {
      gridIntroPhase.current = "pending";
      return;
    }
    const wasPending = gridIntroPhase.current === "pending";
    gridIntroPhase.current = "done";
    if (wasPending) setGridIntro(true);
  }, [visibleGames.length]);
  useEffect(() => {
    if (!gridIntro) return;
    const timer = window.setTimeout(() => setGridIntro(false), 700);
    return () => window.clearTimeout(timer);
  }, [gridIntro]);

  const coverGridStyle = {
    "--ps-cover-size": `${coverSize}px`,
  } as CSSProperties;

  const libraryNotLoaded = !!serverUrl && !loadAllowed;

  return (
    <div className="ps-library flex min-h-full flex-col">
      <div className="ps-library-heading">
        <div>
          <Heading className="flex flex-wrap items-center gap-3">
            {t("library.collection.title")}
            {loadAllowed && !!count && (
              <Badge>{count.toLocaleString(locale)}</Badge>
            )}
          </Heading>
          <Text>{t("library.subtitle")}</Text>
        </div>
        <BigPictureButton />
      </div>

      <section
        className="ps-library-toolbar"
        aria-label={t("library.collection.controls")}
      >
        <div className="ps-library-toolbar-grid">
          <div className="w-full lg:col-span-1">
            <label className="mb-2 block text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-ps-muted">
              {t("common.search")}
            </label>
            <Input
              name="search"
              aria-label={t("library.search.placeholder")}
              value={search}
              onChange={(e: any) => setSearch(e.target.value)}
              clearable
              onClear={() => setSearch("")}
              placeholder={t("library.search.placeholder")}
              disabled={!serverUrl}
            />
          </div>

          {/* On mobile: [Sort By + Direction | Filters] in one flex row.
              On lg+: lg:contents dissolves the wrapper so each child is a direct grid cell. */}
          <div className="flex items-end gap-2 lg:contents">
            <div className="flex min-w-0 flex-1 items-end gap-2 lg:contents">
              <div className="min-w-0 flex-1">
                <label className="mb-2 block text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-ps-muted">
                  {t("library.sortBy")}
                </label>
                <Listbox
                  name="sortBy"
                  value={sortBy}
                  onChange={(v: any) => setSortBy(String(v))}
                >
                  {SORT_BY.map((opt) => (
                    <ListboxOption key={opt.value} value={opt.value}>
                      <ListboxLabel>{t(opt.label)}</ListboxLabel>
                    </ListboxOption>
                  ))}
                </Listbox>
              </div>

              <div className="shrink-0">
                <Button
                  outline
                  className={`${CONTROL_HEIGHT_CLASS} px-3 gap-1.5`}
                  aria-label={t("library.sortDirection.toggle")}
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
                    {order === "ASC"
                      ? t("library.sortDirection.ascending")
                      : t("library.sortDirection.descending")}
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
                    ? t("libraryFilters.hide")
                    : activeFilterCount > 0
                      ? fillTemplate(t("libraryFilters.showActive"), {
                          count: activeFilterCount,
                        })
                      : t("libraryFilters.show")
                }
                aria-expanded={showFilters}
                onClick={() => setShowFilters((s) => !s)}
              >
                <FunnelIcon className="h-4 w-4 sm:mr-1" />
                <span>
                  {showFilters
                    ? t("libraryFilters.hide")
                    : t("libraryFilters.toggle")}
                </span>
                {activeFilterCount > 0 && (
                  <span
                    className="ps-library-filter-count ml-1 inline-flex h-[1.125rem] min-w-[1.25rem] items-center justify-center rounded-full bg-ps-accent px-1 text-[0.65rem] font-bold leading-none text-ps-on-accent"
                    aria-label={fillTemplate(t("libraryFilters.activeCount"), {
                      count: activeFilterCount,
                    })}
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
      <AnimatePresence initial={false}>
        {showFilters && (
          <LibraryFiltersPanel key="library-filters">
            <div className="ps-library-filters mb-2 shrink-0">
              <div className="px-4 pt-4 pb-4 sm:px-6 sm:pt-5 sm:pb-5">
                {/* Header with Clear All Filters Button */}
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <FunnelIcon className="h-4 w-4 text-ps-muted" />
                    <span className="text-xs text-ps-muted">
                      {hasActiveFilters
                        ? t("libraryFilters.active")
                        : t("libraryFilters.noneActive")}
                    </span>
                  </div>
                  {hasActiveFilters && (
                    <Button
                      outline
                      onClick={clearAllFilters}
                      className={`${CONTROL_HEIGHT_CLASS} px-3 flex items-center gap-1`}
                    >
                      <TrashIcon className="h-4 w-4" />
                      {t("libraryFilters.clearAll")}
                    </Button>
                  )}
                </div>

                {/* Section 1: Multi-Select Filter Buttons */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                  {/* Types */}
                  <div className="col-span-1">
                    <label className="mb-2 block text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-ps-muted">
                      {t("libraryFilters.type")}
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
                          ? fillTemplate(t("libraryFilters.selectedCount"), {
                              count: selectedGameTypes.length,
                            })
                          : t("libraryFilters.allTypes")}
                      </span>
                    </Button>
                  </div>

                  {/* Tags */}
                  <div className="col-span-1">
                    <label className="mb-2 block text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-ps-muted">
                      {t("common.tags")}
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
                          ? fillTemplate(t("libraryFilters.selectedCount"), {
                              count: selectedTags.length,
                            })
                          : t("libraryFilters.allTags")}
                      </span>
                    </Button>
                  </div>

                  {/* Genres */}
                  <div className="col-span-1">
                    <label className="mb-2 block text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-ps-muted">
                      {t("common.genres")}
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
                          ? fillTemplate(t("libraryFilters.selectedCount"), {
                              count: selectedGenres.length,
                            })
                          : t("libraryFilters.allGenres")}
                      </span>
                    </Button>
                  </div>

                  {/* Developers */}
                  <div className="col-span-1">
                    <label className="mb-2 block text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-ps-muted">
                      {t("libraryFilters.developers")}
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
                          ? fillTemplate(t("libraryFilters.selectedCount"), {
                              count: selectedDevelopers.length,
                            })
                          : t("libraryFilters.allDevelopers")}
                      </span>
                    </Button>
                  </div>

                  {/* Publishers */}
                  <div className="col-span-1">
                    <label className="mb-2 block text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-ps-muted">
                      {t("libraryFilters.publishers")}
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
                          ? fillTemplate(t("libraryFilters.selectedCount"), {
                              count: selectedPublishers.length,
                            })
                          : t("libraryFilters.allPublishers")}
                      </span>
                    </Button>
                  </div>
                </div>

                {/* Section 2: Dropdown Controls & Date Pickers */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mt-4">
                  {/* Game State */}
                  <div className="col-span-1">
                    <label className="mb-2 block text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-ps-muted">
                      {t("libraryFilters.state")}
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
                        <ListboxLabel>{t("common.all")}</ListboxLabel>
                      </ListboxOption>
                      {GAME_STATES.map((state) => (
                        <ListboxOption key={state.value} value={state.value}>
                          <ListboxLabel>{t(state.label)}</ListboxLabel>
                        </ListboxOption>
                      ))}
                    </Listbox>
                  </div>

                  {/* Release Date From */}
                  <div className="col-span-1">
                    <label className="mb-2 block text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-ps-muted">
                      {t("libraryFilters.releasedAfter")}
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
                      {t("libraryFilters.releasedBefore")}
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
                      {t("libraryFilters.earlyAccess")}
                    </label>
                    <Listbox
                      name="earlyAccess"
                      value={earlyAccess}
                      onChange={(v: any) =>
                        setEarlyAccess(v as EarlyAccessFilter)
                      }
                    >
                      {EARLY_ACCESS_OPTIONS.map((opt) => (
                        <ListboxOption key={opt.value} value={opt.value}>
                          <ListboxLabel>{t(opt.label)}</ListboxLabel>
                        </ListboxOption>
                      ))}
                    </Listbox>
                  </div>

                  {/* Bookmarks */}
                  <div className="col-span-1">
                    <label className="mb-2 block text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-ps-muted">
                      {t("libraryFilters.bookmarked")}
                    </label>
                    <Listbox
                      name="bookmarkFilter"
                      value={bookmarkFilter}
                      onChange={(v: any) =>
                        setBookmarkFilter(v as BookmarkFilter)
                      }
                      disabled={!user}
                    >
                      {BOOKMARK_OPTIONS.map((opt) => (
                        <ListboxOption key={opt.value} value={opt.value}>
                          <ListboxLabel>{t(opt.label)}</ListboxLabel>
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
                        <ListboxLabel>
                          {t("library.ageRating.all")}
                        </ListboxLabel>
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
                        <RemovableFilterChip
                          key={item.name}
                          label={gameTypeLabel(t, item)}
                          color="pink"
                          onRemove={() =>
                            setSelectedGameTypes((prev) =>
                              prev.filter((x) => x.name !== item.name),
                            )
                          }
                        />
                      ))}
                      {selectedTags.map((tag) => (
                        <RemovableFilterChip
                          key={tag.name}
                          label={tag.name}
                          color="blue"
                          onRemove={() =>
                            setSelectedTags((prev) =>
                              prev.filter((x) => x.name !== tag.name),
                            )
                          }
                        />
                      ))}
                      {selectedGenres.map((genre) => (
                        <RemovableFilterChip
                          key={genre.name}
                          label={genre.name}
                          color="green"
                          onRemove={() =>
                            setSelectedGenres((prev) =>
                              prev.filter((x) => x.name !== genre.name),
                            )
                          }
                        />
                      ))}
                      {selectedDevelopers.map((dev) => (
                        <RemovableFilterChip
                          key={dev.name}
                          label={dev.name}
                          color="purple"
                          onRemove={() =>
                            setSelectedDevelopers((prev) =>
                              prev.filter((x) => x.name !== dev.name),
                            )
                          }
                        />
                      ))}
                      {selectedPublishers.map((pub) => (
                        <RemovableFilterChip
                          key={pub.name}
                          label={pub.name}
                          color="orange"
                          onRemove={() =>
                            setSelectedPublishers((prev) =>
                              prev.filter((x) => x.name !== pub.name),
                            )
                          }
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </LibraryFiltersPanel>
        )}
      </AnimatePresence>
      <div className="ps-library-content flex-1">
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
          <div className="surface-panel-soft rounded-lg p-8 text-sm text-ps-muted">
            {t("library.noServer")}
          </div>
        )}
        {serverUrl && error && (
          <div
            role="alert"
            className="mb-4 rounded-md border border-ps-danger/30 bg-ps-danger/10 p-4 text-sm break-words text-ps-danger"
          >
            {error}
          </div>
        )}

        {/* Installed Games Section (Tauri only) */}
        {isTauri && (
          <SectionExpander
            title={fillTemplate(t("library.installed.section"), {
              count: filteredInstalledGames.length.toLocaleString(locale),
            })}
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
              <div className="surface-panel-soft rounded-lg p-4 text-sm text-ps-muted">
                {t("library.installed.empty")}
              </div>
            ) : (
              <div className="-mx-1.5 overflow-x-auto overflow-y-hidden px-1.5 pb-3 [overscroll-behavior-x:contain]">
                <div
                  className="grid gap-5 py-2"
                  style={{
                    gridTemplateRows: `repeat(${Math.min(installedRows, filteredInstalledGames.length)}, auto)`,
                    gridAutoFlow: "column",
                    gridAutoColumns: "180px",
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

        {serverUrl && isOnline && loadAllowed && (
          <RecentlyAddedGames search={deferredSearch} />
        )}

        {libraryNotLoaded && (
          <div className="surface-panel-soft mb-4 rounded-lg p-8 text-sm text-ps-muted">
            <p>{t("library.notLoaded")}</p>
            <Button outline className="mt-3" onClick={reloadLibrary}>
              <ArrowPathIcon className="h-4 w-4" />
              {t("library.loadNow")}
            </Button>
          </div>
        )}

        {/* Server Games Section */}
        {isTauri && !isOnline ? (
          <div className="surface-panel-soft rounded-lg p-8 text-sm text-ps-muted text-center">
            <p className="font-semibold text-ps-text mb-2">
              {t("library.offline.title")}
            </p>
            <p>{t("library.offline.unavailable")}</p>
            <p className="mt-1">{t("library.offline.installedPlayable")}</p>
          </div>
        ) : (
          <SectionExpander
            title={fillTemplate(t("library.server.section"), {
              // Only installed games hidden from this list are missing; games
              // of further pages are still loaded while scrolling.
              visible: Math.max(
                0,
                (count ?? 0) - (games.length - visibleGames.length),
              ).toLocaleString(locale),
              total: (count ?? 0).toLocaleString(locale),
            })}
            defaultOpen={true}
          >
            {serverUrl && loading && games.length === 0 && (
              <>
                <p role="status" className="sr-only">
                  {t("common.loading")}
                </p>
                {/* Same grid and card rhythm as the real covers, so nothing
                    shifts when the first page replaces it. */}
                <div
                  className="ps-library-grid grid min-w-0 py-2 pb-8 motion-safe:animate-pulse"
                  style={coverGridStyle}
                  aria-hidden="true"
                >
                  {Array.from({ length: GRID_INTRO_COUNT }).map((_, i) => (
                    <div key={i} className="ps-library-skeleton-card">
                      <div className="ps-library-skeleton" />
                      <div className="ps-library-skeleton-line" />
                      <div className="ps-library-skeleton-line" />
                    </div>
                  ))}
                </div>
              </>
            )}
            {serverUrl &&
              loadAllowed &&
              !loading &&
              games.length === 0 &&
              !error && (
                <div className="surface-panel-soft rounded-lg p-8 text-sm text-ps-muted">
                  {t("library.empty")}
                  {(search.trim() || hasActiveFilters) && (
                    <div className="mt-2">
                      <TextLink
                        href="#"
                        onClick={(event: React.MouseEvent) => {
                          event.preventDefault();
                          clearAllFilters();
                          setShowFilters(false);
                          setSearch("");
                        }}
                      >
                        <Strong>{t("library.empty.clearFilters")}</Strong>
                      </TextLink>
                    </div>
                  )}
                </div>
              )}
            <div
              className="ps-library-grid min-w-0 grid py-2 pb-8"
              style={coverGridStyle}
              data-intro={gridIntro ? "" : undefined}
            >
              {visibleGames.map((g, index) => {
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
                const intro = gridIntro && index < GRID_INTRO_COUNT;
                return (
                  <div
                    key={g.id}
                    className="min-w-0"
                    data-intro-index={intro ? index : undefined}
                    style={
                      intro
                        ? ({ "--ps-intro-index": index } as CSSProperties)
                        : undefined
                    }
                  >
                    <GameCard game={cardGame} sortBy={sortBy} />
                  </div>
                );
              })}
            </div>
            {hasMore && <div ref={sentinelRef} className="h-10 -mt-10" />}
            {loading && games.length > 0 && (
              <div
                role="status"
                className="flex items-center justify-center gap-2 p-4 text-xs text-ps-muted"
              >
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
                {t("library.loadingMore")}
              </div>
            )}
          </SectionExpander>
        )}
      </div>

      {showScrollTop && (
        <button
          type="button"
          onClick={scrollToTop}
          aria-label={t("library.scrollTop")}
          title={t("library.scrollTop")}
          className="ps-library-scroll-top fixed right-6 bottom-6 z-30 flex size-[50px] items-center justify-center rounded-full bg-ps-accent text-ps-on-accent shadow-[var(--shadow-card)] hover:bg-ps-accent-hover active:bg-ps-accent-pressed"
        >
          <ChevronUpIcon className="size-6" aria-hidden="true" />
        </button>
      )}

      {/* Filter Dialogs */}
      <MultiSelectFilterDialog
        open={gameTypesDialogOpen}
        onClose={() => setGameTypesDialogOpen(false)}
        title={t("libraryFilters.types")}
        searchPlaceholder={t("libraryFilters.search.types")}
        emptyText={t("libraryFilters.empty.types")}
        staticItems={gameTypeFilterItems}
        selectedItems={selectedGameTypes}
        onSelectionChange={setSelectedGameTypes}
        badgeColor="pink"
      />
      <MultiSelectFilterDialog
        open={tagsDialogOpen}
        onClose={() => setTagsDialogOpen(false)}
        title={t("common.tags")}
        searchPlaceholder={t("libraryFilters.search.tags")}
        emptyText={t("libraryFilters.empty.tags")}
        endpoint="/api/tags"
        selectedItems={selectedTags}
        onSelectionChange={setSelectedTags}
        badgeColor="blue"
      />
      <MultiSelectFilterDialog
        open={genresDialogOpen}
        onClose={() => setGenresDialogOpen(false)}
        title={t("common.genres")}
        searchPlaceholder={t("libraryFilters.search.genres")}
        emptyText={t("libraryFilters.empty.genres")}
        endpoint="/api/genres"
        selectedItems={selectedGenres}
        onSelectionChange={setSelectedGenres}
        badgeColor="green"
      />
      <MultiSelectFilterDialog
        open={developersDialogOpen}
        onClose={() => setDevelopersDialogOpen(false)}
        title={t("libraryFilters.developers")}
        searchPlaceholder={t("libraryFilters.search.developers")}
        emptyText={t("libraryFilters.empty.developers")}
        endpoint="/api/developers"
        selectedItems={selectedDevelopers}
        onSelectionChange={setSelectedDevelopers}
        badgeColor="purple"
      />
      <MultiSelectFilterDialog
        open={publishersDialogOpen}
        onClose={() => setPublishersDialogOpen(false)}
        title={t("libraryFilters.publishers")}
        searchPlaceholder={t("libraryFilters.search.publishers")}
        emptyText={t("libraryFilters.empty.publishers")}
        endpoint="/api/publishers"
        selectedItems={selectedPublishers}
        onSelectionChange={setSelectedPublishers}
        badgeColor="orange"
      />
    </div>
  );
}
