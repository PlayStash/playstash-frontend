import "@/styles/game-view.css";
import { GameWebsites } from "@/components/GameWebsites";
import { PlaystashGame } from "@/api/models/PlaystashGame";
import { Progress, ProgressStateEnum } from "@/api/models/Progress";
import CoverPlaceholder from "@/components/CoverPlaceholder";
import { UserAvatar } from "@/components/UserAvatar";
import { Media } from "@/components/Media";
import { DecodedImage } from "@/components/DecodedImage";
import MediaSlider from "@/components/MediaSlider";
import MarkdownContent from "@/components/MarkdownContent";
import { PackageContents } from "@/components/PackageContents";
import { GameReviews } from "@/components/GameReviews";
import { GameSaves } from "@/components/GameSaves";
import { GameMetrics } from "@/components/admin/GameMetrics";
import type { LaunchProfileDto } from "@/api";
import BackButton from "@/components/BackButton";
import { Spinner } from "@/components/Spinner";
import { useAuth } from "@/context/AuthContext";
import { useOnlineStatus } from "@/context/OfflineContext";
import { useAlertDialog } from "@/context/AlertDialogContext";
import { Button } from "@tw/button";
import { Listbox, ListboxOption, ListboxLabel } from "@tw/listbox";
import { useDownloads } from "@/context/DownloadContext";
import { GameDownloadProgress } from "@/components/downloads/GameDownloadProgress";
import { GameVersion } from "@/api/models/GameVersion";
import { VersionSelectDialog } from "@/components/VersionSelectDialog";
import { RootPathSelectDialog } from "@/components/RootPathSelectDialog";
import { getRootPaths } from "@/utils/rootPaths";
import { requestGameDownload } from "@/utils/downloadFlow";
import { buildShareUrl } from "@/utils/shareUrl";
import { formatDate, formatTime, formatYear } from "@/utils/date";
import { hasOpenOverlay, isEditableTarget } from "@/utils/overlay";
import { formatDecimal } from "@/utils/number";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useCallback,
  useRef,
} from "react";
import { useParams, useNavigate } from "react-router";
import {
  CloudArrowDownIcon,
  Cog8ToothIcon,
  ShareIcon,
  StarIcon as StarSolid,
  WrenchScrewdriverIcon,
  BuildingOffice2Icon,
  ShieldCheckIcon,
  ArrowUpCircleIcon,
} from "@heroicons/react/24/solid";
import {
  StarIcon as StarOutline,
  CalendarDaysIcon,
  GlobeAltIcon,
  HashtagIcon,
} from "@heroicons/react/24/outline";
import clsx from "clsx";
import {
  Dropdown,
  DropdownButton,
  DropdownItem,
  DropdownLabel,
  DropdownMenu,
} from "@tw/dropdown";
import { GameSettings } from "@/components/admin/GameSettings";
import { useAuthMediaUrl } from "@/hooks/useAuthMediaUrl";
import { useInstalledGames } from "@/hooks/useInstalledGames";
import { launchInstalledGame } from "@/utils/launchInstalledGame";
import { isTauriApp } from "@/utils/tauri";
import { onGameDeleted } from "@/utils/gameUpdates";
import { maskDisplayName, useStreamerMode } from "@/utils/streamerMode";
import {
  isGameUpdateAvailable,
  resolveServerVersionTag,
} from "@/utils/gameUpdate";
import { motion, useReducedMotion } from "motion/react";
import { EASE_OUT } from "@/lib/motion";
import { GameChatButton } from "@/components/GameChatButton";
import { translate, useTranslation, type TranslationKey } from "@/i18n";
import { fillTemplate } from "@/utils/downloadPipeline";
import {
  displayTitle,
  setShowMappedTitle,
  titleYearSuffix,
  useShowMappedTitle,
} from "@/utils/mappedTitle";
import { libraryFilterLink } from "@/utils/libraryLinks";
import { CloudSaveRow } from "@/components/CloudSaveRow";

const PROGRESS_LABEL: Record<string, TranslationKey> = {
  UNPLAYED: "gameView.progress.unplayed",
  INFINITE: "gameView.progress.infinite",
  PLAYING: "gameView.progress.playing",
  COMPLETED: "gameView.progress.completed",
  ABORTED_TEMPORARY: "gameView.progress.abortedTemporary",
  ABORTED_PERMANENT: "gameView.progress.abortedPermanent",
};

const GAME_TYPE_LABEL: Record<string, TranslationKey> = {
  WINDOWS_SETUP: "gameView.type.windowsSetup",
  WINDOWS_PORTABLE: "gameView.type.windowsPortable",
  LINUX_PORTABLE: "gameView.type.linuxPortable",
};

export default function GameView() {
  const { id } = useParams<{ id: string }>();
  const reducedMotion = useReducedMotion();
  const numericId = Number(id);
  const navigate = useNavigate();
  const { t } = useTranslation();
  const showMappedTitle = useShowMappedTitle();
  const { serverUrl, authFetch, user } = useAuth();
  const streamerMode = useStreamerMode();
  const [loadedGame, setGame] = useState<PlaystashGame | null>(null);
  const currentUserId = (user as any)?.id ?? (user as any)?.ID;
  // A user without progress for this game gets a local placeholder
  // ("unplayed"), so the progress controls have something to show. Created
  // once per game and user, so its identity stays stable across game updates.
  const [placeholderCreatedAt] = useState(() => new Date());
  const loadedGameId = loadedGame?.id;
  const placeholderProgress = useMemo(
    () =>
      loadedGameId && currentUserId
        ? ({
            id: -currentUserId, // temporary local id
            created_at: placeholderCreatedAt,
            updated_at: undefined,
            deleted_at: undefined,
            entity_version: 0,
            user: { id: currentUserId } as any,
            game: { id: loadedGameId } as any,
            minutes_played: 0,
            state: ProgressStateEnum.unplayed,
            last_played_at: undefined,
          } as any as Progress)
        : null,
    [loadedGameId, currentUserId, placeholderCreatedAt],
  );
  const game = useMemo(() => {
    if (!loadedGame || !placeholderProgress) return loadedGame;
    const progresses: Progress[] | undefined = (loadedGame as any).progresses;
    const exists =
      Array.isArray(progresses) &&
      progresses.some(
        (p) =>
          (p.user as any)?.id === currentUserId ||
          (p.user as any)?.ID === currentUserId,
      );
    if (exists) return loadedGame;
    return {
      ...loadedGame,
      progresses: [...(progresses || []), placeholderProgress],
    } as PlaystashGame;
  }, [loadedGame, placeholderProgress, currentUserId]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bookmarkBusy, setBookmarkBusy] = useState(false);
  const [bookmarked, setBookmarked] = useState(false);
  const { startDownload } = useDownloads() as any;
  const { showAlert } = useAlertDialog();
  const [progressState, setProgressState] = useState<
    keyof typeof ProgressStateEnum | null
  >(null);
  const [progressUpdating, setProgressUpdating] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [versionDialogOpen, setVersionDialogOpen] = useState(false);
  const [pendingDownloadAction, setPendingDownloadAction] = useState<
    "direct" | "tauri" | "client" | null
  >(null);
  const [selectableVersions, setSelectableVersions] = useState<GameVersion[]>(
    [],
  );
  const [rootSelectOpen, setRootSelectOpen] = useState(false);
  const [pendingRootPath, setPendingRootPath] = useState<string | null>(null);
  const isTauri = isTauriApp();
  const { isOnline } = useOnlineStatus();
  const { installedGames, refetch: refetchInstalledGames } =
    useInstalledGames();
  const installedInfo = useMemo(
    () => installedGames.find((ig) => ig.gameId === numericId),
    [installedGames, numericId],
  );

  // Whether the locally installed version differs from the server's current
  // default version (i.e. a newer version is available to download).
  const serverVersionTag = useMemo(() => resolveServerVersionTag(game), [game]);
  const updateAvailable = useMemo(
    () => isGameUpdateAvailable(game, installedInfo),
    [game, installedInfo],
  );

  // ESC returns to the library (same as the Back button). Open overlays
  // (dialogs/popovers) and editable inputs handle their own Escape first.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (hasOpenOverlay() || isEditableTarget(event)) return;
      navigate(-1);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [navigate]);

  // If the currently-viewed game is removed from the library (e.g. its last
  // version file was deleted), close the settings modal and return to library.
  useEffect(() => {
    return onGameDeleted((gameId) => {
      if (gameId !== numericId) return;
      setSettingsOpen(false);
      navigate("/library", { replace: true });
    });
  }, [numericId, navigate]);
  const backgroundMediaId = game?.metadata?.background?.id;
  const {
    url: backgroundUrl,
    error: backgroundError,
    retryAfterDecodeError: retryBackgroundDecode,
  } = useAuthMediaUrl(
    backgroundMediaId,
    game?.id ? { gameId: game.id, slot: "background" } : undefined,
  );
  // Loading an existing backdrop must not remove a cover from the title row.
  // The composition is decided by metadata, independently of fetch/decode
  // time; only a backdrop that definitively failed falls back to the cover.
  const hasBackgroundMedia = Boolean(backgroundMediaId) && !backgroundError;

  useEffect(() => {
    if (!serverUrl || !numericId || Number.isNaN(numericId)) return;
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const base = serverUrl.replace(/\/+$/, "");
        const res = await authFetch(`${base}/api/games/${numericId}`, {
          method: "GET",
        });
        if (!res.ok)
          throw new Error(
            fillTemplate(translate("gameView.loadFailedStatus"), {
              status: res.status,
            }),
          );
        const json = await res.json();
        if (!cancelled) setGame(json);
      } catch (e: any) {
        // Offline fallback: try loading from local cache
        if (isTauriApp() && !isOnline) {
          try {
            const { invoke } = await import("@tauri-apps/api/core");
            const cached = await invoke<string | null>("load_cached_game", {
              gameId: Number(numericId),
            });
            if (cached && !cancelled) {
              const json = JSON.parse(cached);
              setGame(json as PlaystashGame);
              return;
            }
          } catch {
            /* cache not available */
          }
        }
        if (!cancelled)
          setError(e?.message || translate("gameView.loadFailed"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [serverUrl, authFetch, numericId, isOnline]);

  const coverId = game?.metadata?.cover?.id;
  const trailers = [
    ...(game?.metadata?.url_trailers || []),
    ...((game as any)?.metadata?.url_gameplays || []),
  ];
  const screenshots = game?.metadata?.url_screenshots || [];
  const title = game?.metadata?.title || game?.title;
  // Header title follows the mapped-title preference (click to toggle).
  const shownTitle = displayTitle(game, showMappedTitle);
  const shownYear = titleYearSuffix(game, showMappedTitle);
  const isDeleted = !!(game as any)?.deleted_at;
  /** Opens the Library with exactly this one filter (GameView pills). */
  const openLibraryFilter = useCallback(
    (
      param: "types" | "genres" | "tags" | "developers" | "publishers",
      value: string,
    ) =>
      navigate(libraryFilterLink(param, value), {
        state: { openFilters: true },
      }),
    [navigate],
  );
  const description = game?.metadata?.description || null;
  const notes = (game as any)?.metadata?.notes || "";
  // Tags now sourced from metadata.tags (array of objects with name)
  const tags: string[] = ((game as any)?.metadata?.tags || [])
    .map((t: any) => t?.name)
    .filter((n: any) => typeof n === "string" && n.trim());
  const [detailsTab, setDetailsTab] = useState<
    | "description"
    | "notes"
    | "tags"
    | "package"
    | "requirements"
    | "metrics"
    | "reviews"
    | "saves"
  >("description");
  const mediaSliderRef = useRef<HTMLDivElement | null>(null);
  const detailsCardRef = useRef<HTMLDivElement | null>(null);
  const detailTabsRef = useRef<HTMLElement | null>(null);
  const tabIndicatorRef = useRef<HTMLSpanElement | null>(null);
  const detailsVisible = !loading && !error && Boolean(game);
  const userRole = user?.role;

  // One shared tab indicator glides between tabs. It is positioned with a
  // composite-only transform (translateX + scaleX of a 100px bar), and its CSS
  // transition retargets mid-flight when tabs are switched rapidly. The first
  // placement and any resize snap without animating.
  useLayoutEffect(() => {
    const nav = detailTabsRef.current;
    const indicator = tabIndicatorRef.current;
    if (!detailsVisible || !nav || !indicator) return;
    const place = (animate: boolean) => {
      const active = nav.querySelector<HTMLElement>("button.is-active");
      if (!active || !active.offsetWidth) {
        indicator.style.opacity = "0";
        return;
      }
      indicator.dataset.animate = animate ? "true" : "false";
      indicator.style.transform = `translateX(${active.offsetLeft}px) scaleX(${active.offsetWidth / 100})`;
      indicator.style.opacity = "1";
    };
    place(indicator.dataset.placed === "true");
    indicator.dataset.placed = "true";
    if (typeof ResizeObserver === "undefined") return;
    // The observer reports every target once on observe(); that first batch
    // must not cancel the transition that place(true) just started.
    let initialBatch = true;
    const observer = new ResizeObserver(() => {
      if (initialBatch) {
        initialBatch = false;
        return;
      }
      place(false);
    });
    observer.observe(nav);
    nav
      .querySelectorAll("button")
      .forEach((button) => observer.observe(button));
    return () => observer.disconnect();
  }, [detailsTab, detailsVisible, userRole, t]);
  const rawGenres = (game as any)?.metadata?.genres || [];
  const genres: string[] = Array.isArray(rawGenres)
    ? rawGenres
        .map((g: any) => (typeof g === "string" ? g : g?.name))
        .filter((g: any) => typeof g === "string" && g.trim())
    : [];

  // Derive current user's progress among progresses
  const userProgress: Progress | null = useMemo(() => {
    if (!game || !Array.isArray((game as any).progresses) || !currentUserId)
      return null;
    return (
      (game as any).progresses.find(
        (p: any) => (p.user?.id ?? p.user?.ID) === currentUserId,
      ) || null
    );
  }, [game, currentUserId]);

  // Follow the progress state of the loaded progress (adjusted during render
  // when it changes; local changes in between are kept).
  const [syncedProgress, setSyncedProgress] = useState<Progress | null>(null);
  if (userProgress !== syncedProgress) {
    setSyncedProgress(userProgress);
    if (userProgress?.state) {
      // Map to key form matching ProgressStateEnum keys
      const val = Object.entries(ProgressStateEnum).find(
        ([, v]) => v === userProgress.state,
      )?.[0] as keyof typeof ProgressStateEnum | undefined;
      if (val) setProgressState(val);
    }
  }

  // Bookmark detection: re-read whenever the game or user changes.
  const [bookmarkSource, setBookmarkSource] = useState<{
    game: PlaystashGame | null;
    userId: unknown;
  }>({ game: null, userId: undefined });
  if (bookmarkSource.game !== game || bookmarkSource.userId !== currentUserId) {
    setBookmarkSource({ game, userId: currentUserId });
    if (game && currentUserId) {
      const arr =
        (game as any).bookmarked_users || (game as any).bookmarkedUsers || [];
      setBookmarked(
        Array.isArray(arr) &&
          arr.some((u: any) => (u?.id ?? u?.ID) === currentUserId),
      );
    }
  }

  const toggleBookmark = useCallback(async () => {
    if (!serverUrl || !game || !currentUserId || bookmarkBusy) return;
    setBookmarkBusy(true);
    const base = serverUrl.replace(/\/+$/, "");
    const next = !bookmarked;
    setBookmarked(next);
    try {
      const url = `${base}/api/users/me/bookmark/${game.id}`;
      const res = await authFetch(url, { method: next ? "POST" : "DELETE" });
      if (!res.ok) throw new Error("Bookmark toggle failed");
    } catch {
      setBookmarked(!next);
      showAlert({
        title: t("gameView.bookmark.failedTitle"),
        description: t("gameView.bookmark.failed"),
      });
    } finally {
      setBookmarkBusy(false);
    }
  }, [
    serverUrl,
    game,
    currentUserId,
    bookmarked,
    authFetch,
    bookmarkBusy,
    showAlert,
    t,
  ]);

  const handleShare = useCallback(async () => {
    // Anchor the link to the PlayStash server instead of the current origin:
    // Tauri builds serve the bundled Web UI from `http://tauri.localhost`, so
    // `window.location.href` would produce a link that is useless to anyone
    // else.
    const route = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const shareUrl = buildShareUrl(serverUrl, route);
    if (isTauri && game) {
      // Desktop: a deep link that opens the game in the PlayStash client.
      try {
        await navigator.clipboard.writeText(
          `playstash://show?gameid=${game.id}`,
        );
        showAlert({
          title: t("gameView.share.copied"),
          action: {
            label: t("gameView.share.copyWeb"),
            onClick: () => {
              void navigator.clipboard.writeText(shareUrl).catch(() => {});
            },
          },
        });
      } catch {
        showAlert({
          title: t("gameView.share.copyFailed"),
          description: shareUrl,
        });
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
      // Show global alert notification
      showAlert({
        title: t("gameView.share.linkCopied"),
      });
    } catch {
      showAlert({
        title: t("gameView.share.copyFailed"),
        description: shareUrl,
      });
    }
  }, [serverUrl, showAlert, isTauri, game, t]);

  const resolveVersions = useCallback(async (): Promise<GameVersion[]> => {
    if (game && Array.isArray(game.versions) && game.versions.length > 0) {
      return game.versions;
    }
    if (!serverUrl || !numericId || Number.isNaN(numericId)) return [];
    const base = serverUrl.replace(/\/+$/, "");
    const res = await authFetch(`${base}/api/games/${numericId}`, {
      method: "GET",
    });
    if (!res.ok) return [];
    const fullGame = (await res.json()) as PlaystashGame;
    const fullVersions = Array.isArray(fullGame.versions)
      ? fullGame.versions
      : [];
    if (fullVersions.length > 0) {
      setGame((prev) => (prev ? { ...prev, versions: fullVersions } : prev));
    }
    return fullVersions;
  }, [game, serverUrl, numericId, authFetch]);

  const executeDownloadAction = useCallback(
    (
      action: "direct" | "tauri" | "client",
      selectedVersion: GameVersion,
      rootPath?: string,
    ) => {
      if (!game) return;
      const resolvedTitle = title || game.title;
      const filePathFallback = selectedVersion.file_path
        ? selectedVersion.file_path.split(/[/\\]/).pop()
        : undefined;
      const selectedFilename =
        filePathFallback && filePathFallback.trim().length > 0
          ? filePathFallback
          : `${resolvedTitle}.zip`;

      if (action === "client") {
        window.location.href = `playstash://install?gameid=${game.id}&versionid=${selectedVersion.id}`;
        return;
      }

      startDownload({
        gameId: game.id,
        versionId: selectedVersion.id,
        versionName: selectedVersion.version,
        gameTitle: resolvedTitle,
        fileTitle: game.title,
        gameMetadata: game.metadata,
        gameType: (selectedVersion.type || game.type) as any,
        filename: selectedFilename,
        downloadRootPath: rootPath,
      });

      showAlert({
        title: fillTemplate(t("gameView.download.queued"), {
          title: resolvedTitle ?? "",
        }),
      });
    },
    [game, title, startDownload, showAlert, t],
  );

  const selectVersionAndRun = useCallback(
    async (action: "direct" | "tauri" | "client", rootPath?: string) => {
      const versions = await resolveVersions();

      if (!versions.length) {
        showAlert({
          title: t("pipeline.flow.noVersionTitle"),
          description: t("pipeline.flow.noVersionMessage"),
        });
        return;
      }

      if (versions.length === 1) {
        executeDownloadAction(action, versions[0], rootPath);
        return;
      }

      setSelectableVersions(versions);
      setPendingDownloadAction(action);
      setPendingRootPath(rootPath ?? null);
      setVersionDialogOpen(true);
    },
    [resolveVersions, showAlert, executeDownloadAction, t],
  );

  const handleDirectDownload = useCallback(() => {
    if (!game) return;
    void selectVersionAndRun("direct");
  }, [game, selectVersionAndRun]);

  // Location pick, version pick, overwrite and free-space checks live in the
  // shared download flow (also used by GameCard and the CLI `install`).
  const handleTauriDownload = useCallback(async () => {
    if (!game) return;
    await requestGameDownload({ gameId: game.id });
  }, [game]);

  const handleRootPathSelect = useCallback(
    (rootPath: string) => {
      setRootSelectOpen(false);
      void selectVersionAndRun("tauri", rootPath);
    },
    [selectVersionAndRun],
  );

  const handleGoToSettingsFromRootSelect = useCallback(() => {
    setRootSelectOpen(false);
    navigate("/settings?section=downloads");
  }, [navigate]);

  const handleClientDownload = useCallback(() => {
    if (!game) return;
    void selectVersionAndRun("client");
  }, [game, selectVersionAndRun]);

  // A launch runs pre-launch hooks and executable detection before the
  // process starts; a second click during that window must not spawn twice.
  const launchPendingRef = useRef(false);
  const [launchPending, setLaunchPending] = useState(false);
  const handlePlayGame = useCallback(
    async (e: React.MouseEvent, profile?: LaunchProfileDto) => {
      e.preventDefault();
      e.stopPropagation();
      if (!installedInfo || launchPendingRef.current) return;
      launchPendingRef.current = true;
      setLaunchPending(true);
      try {
        // Shared launch path: hooks, emulator, auto-detection, metrics and
        // error alerts all live in launchInstalledGame.
        await launchInstalledGame({
          gameId: installedInfo.gameId,
          profile,
          source: "game-view",
          game,
          installed: installedInfo,
        });
      } finally {
        launchPendingRef.current = false;
        setLaunchPending(false);
      }
    },
    [installedInfo, game],
  );

  const handleVersionSelect = useCallback(
    (selectedVersion: GameVersion) => {
      if (!pendingDownloadAction) return;
      executeDownloadAction(
        pendingDownloadAction,
        selectedVersion,
        pendingRootPath ?? undefined,
      );
      setVersionDialogOpen(false);
      setPendingDownloadAction(null);
      setPendingRootPath(null);
      setSelectableVersions([]);
    },
    [pendingDownloadAction, pendingRootPath, executeDownloadAction],
  );

  const progressStateOptions = Object.entries(ProgressStateEnum).map(
    ([k, v]) => ({
      key: k,
      value: v,
      label: PROGRESS_LABEL[v] ? t(PROGRESS_LABEL[v]) : v,
    }),
  );

  const updateProgressState = useCallback(
    async (nextKey: string) => {
      if (!serverUrl || !game || !currentUserId) return;
      const enumVal = (ProgressStateEnum as any)[nextKey];
      if (!enumVal) return;
      setProgressUpdating(true);
      const base = serverUrl.replace(/\/+$/, "");
      try {
        const payload = { state: enumVal };
        const res = await authFetch(
          `${base}/api/progresses/user/${currentUserId}/game/${game.id}`,
          {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify(payload),
          },
        );
        if (res.ok) {
          // Refresh game data to reflect progress changes
          const updated = await res.json().catch(() => null);
          if (updated && updated.state) {
            // mutate local userProgress optimistic
            setProgressState(nextKey as any);
          }
        }
      } finally {
        setProgressUpdating(false);
      }
    },
    [serverUrl, game, currentUserId, authFetch],
  );

  const playtimeMinutes = userProgress?.minutes_played || 0;
  const playtimeHours = playtimeMinutes / 60;
  const lastPlayedDate = userProgress?.last_played_at
    ? new Date(userProgress.last_played_at)
    : null;
  const lastPlayedValid =
    !!lastPlayedDate && !Number.isNaN(lastPlayedDate.getTime());
  // Locale-aware date + time (first line date, second line time), e.g.
  // `15.08.2025` / `16:01` (de) or `08/15/2025` / `4:01 PM` (en-US).
  const lastPlayedDay = lastPlayedValid ? formatDate(lastPlayedDate, "—") : "—";
  const lastPlayedTime = lastPlayedValid ? formatTime(lastPlayedDate) : null;
  const avgPlaytime =
    game?.metadata?.average_playtime ||
    (game as any)?.metadata?.average_playtime ||
    null;
  const gameSizeBytes = useMemo(() => {
    const sizeStr =
      (game as any)?.size ??
      (Array.isArray(game?.versions) ? game.versions[0]?.size : undefined);
    if (sizeStr === undefined || sizeStr === null) return null;
    const n = Number(sizeStr);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [game]);

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes}\u00a0B`;
    const units = ["KB", "MB", "GB", "TB", "PB"];
    let value = bytes / 1024;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex++;
    }
    return `${formatDecimal(value, value < 10 ? 2 : value < 100 ? 1 : 0)}\u00a0${units[unitIndex]}`;
  };

  const formattedSize = useMemo(
    () => (gameSizeBytes !== null ? formatBytes(gameSizeBytes) : null),
    [gameSizeBytes],
  );
  const downloadLabel = formattedSize
    ? `${t("common.download")} (${formattedSize})`
    : t("common.download");

  // Derive additional metadata fields
  // The merged metadata (provider data and admin edits) knows the real
  // release date; the game's own date is only parsed from the file name.
  const releaseDate =
    (game as any)?.metadata?.release_date || game?.release_date || null;
  const releaseYear = releaseDate ? formatYear(releaseDate) : null;
  const versionTag = game?.version || (game as any)?.metadata?.version || null;
  const websites: string[] = (game as any)?.metadata?.url_websites || [];
  const devNames: string[] = ((game as any)?.metadata?.developers || [])
    .map((d: any) => d?.name || d)
    .filter(Boolean);
  const publisherNames: string[] = ((game as any)?.metadata?.publishers || [])
    .map((p: any) => p?.name || p)
    .filter(Boolean);
  const ageRating = (game as any)?.metadata?.age_rating ?? null;
  let rating = (game as any)?.metadata?.rating ?? null; // numeric rating
  const formattedRating =
    typeof rating === "number"
      ? (() => {
          const val =
            rating <= 1 ? Math.round(rating * 100) : Math.round(rating);
          return `${val}%`;
        })()
      : null;
  const metadataEmpty = <span className="game-metadata-empty">—</span>;
  const titleLength = (shownTitle ?? "").length;
  const titleLengthClass =
    titleLength > 48 ? "long" : titleLength > 28 ? "medium" : undefined;
  return (
    <div className="game-view">
      {(loading || error || !game) && (
        <div className="game-view-message">
          <BackButton />
          {loading && <Spinner label={t("gameView.loading")} />}
          {error && (
            <p role="alert" className="text-ps-danger">
              {error}
            </p>
          )}
        </div>
      )}
      {!loading && !error && game && (
        <>
          <section
            className={clsx(
              "game-hero",
              !hasBackgroundMedia && "game-hero-without-art",
            )}
          >
            {backgroundUrl && hasBackgroundMedia && (
              <DecodedImage
                className="game-hero-art"
                src={backgroundUrl}
                alt=""
                decoding="async"
                draggable={false}
                onError={retryBackgroundDecode}
              />
            )}
            <div className="game-hero-navigation">
              <BackButton />
            </div>
            <div className="game-hero-heading">
              {!hasBackgroundMedia && (
                <div className="game-hero-cover">
                  {coverId ? (
                    <Media
                      media={game.metadata?.cover}
                      width={92}
                      height={124}
                      square
                      fit="cover"
                      alt={title}
                      gameId={game.id}
                      mediaSlot="cover"
                      fallback={
                        <CoverPlaceholder
                          title={title || t("gameView.fallbackTitle")}
                          className="h-full w-full"
                        />
                      }
                    />
                  ) : (
                    <CoverPlaceholder
                      title={title || t("gameView.fallbackTitle")}
                      className="h-full w-full"
                    />
                  )}
                </div>
              )}
              <div className="min-w-0">
                <h1>
                  <button
                    type="button"
                    onClick={() => setShowMappedTitle(!showMappedTitle)}
                    title={
                      showMappedTitle
                        ? t("gameView.title.showFile")
                        : t("gameView.title.showMapped")
                    }
                    data-length={titleLengthClass}
                    className={clsx(
                      "game-hero-title",
                      isDeleted && "line-through opacity-70",
                    )}
                  >
                    <span className="game-hero-title-text">
                      {shownTitle}
                      {shownYear && (
                        <span className="game-hero-year">{shownYear}</span>
                      )}
                    </span>
                  </button>
                </h1>
                <div className="game-hero-genres">
                  {genres.map((genre) => (
                    <button
                      key={genre}
                      type="button"
                      onClick={() => openLibraryFilter("genres", genre)}
                      title={t("gameView.pill.filter")}
                    >
                      {genre}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className={clsx("game-hero-utilities", isDeleted && "hidden")}>
              <Button
                plain
                onClick={toggleBookmark}
                disabled={!user || bookmarkBusy || (isTauri && !isOnline)}
                className={clsx(
                  "game-hero-icon",
                  bookmarked && "game-hero-icon-selected",
                )}
                title={
                  bookmarked
                    ? t("gameView.bookmark.remove")
                    : t("gameView.bookmark.add")
                }
                aria-label={
                  bookmarked
                    ? t("gameView.bookmark.remove")
                    : t("gameView.bookmark.add")
                }
                aria-pressed={bookmarked}
              >
                {bookmarked ? <StarSolid /> : <StarOutline />}
              </Button>
              <Button
                plain
                onClick={handleShare}
                className="game-hero-icon"
                title={t("gameView.share.copyLink")}
                aria-label={t("gameView.share.copyLink")}
              >
                <ShareIcon />
              </Button>
              <GameChatButton gameId={game.id} className="game-hero-icon" />
              <Button
                plain
                onClick={() => setSettingsOpen(true)}
                className="game-hero-icon"
                title={t("gameView.settings")}
                aria-label={t("gameView.settings")}
              >
                <Cog8ToothIcon />
              </Button>
            </div>
          </section>
          <section
            className="game-command-bar"
            aria-label={t("gameView.details.title")}
          >
            <div
              className={clsx("game-primary-actions", isDeleted && "hidden")}
            >
              {isTauri && installedInfo && (
                <Button
                  color="indigo"
                  className="game-play-button"
                  aria-label={t("common.play")}
                  aria-busy={launchPending || undefined}
                  onClick={handlePlayGame}
                >
                  {launchPending ? (
                    <svg
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                      className="game-play-spinner size-5"
                    >
                      <circle
                        cx="12"
                        cy="12"
                        r="8.5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeDasharray="40 14"
                      />
                    </svg>
                  ) : (
                    <svg
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                      className="size-5 fill-current"
                    >
                      <path d="M7 4v16l14-8z" />
                    </svg>
                  )}
                  {t("common.play")}
                </Button>
              )}
              {isTauri ? (
                <Button
                  {...(installedInfo
                    ? { outline: true }
                    : { color: "indigo" as const })}
                  aria-label={
                    installedInfo ? downloadLabel : t("common.install")
                  }
                  title={downloadLabel}
                  className={clsx(
                    "game-download-button",
                    !installedInfo && "game-play-button",
                  )}
                  onClick={handleTauriDownload}
                  disabled={!isOnline}
                >
                  <CloudArrowDownIcon className="size-5" />
                  {updateAvailable
                    ? t("gameView.update.available")
                    : installedInfo
                      ? t("common.download")
                      : t("common.install")}
                </Button>
              ) : (
                <Dropdown>
                  <DropdownButton
                    as={Button}
                    color="indigo"
                    aria-label={downloadLabel}
                    title={downloadLabel}
                    className="game-play-button"
                  >
                    <CloudArrowDownIcon className="size-5" />
                    {t("common.download")}
                  </DropdownButton>
                  <DropdownMenu anchor="bottom start" className="min-w-56">
                    <DropdownItem onClick={handleDirectDownload}>
                      <DropdownLabel>
                        {t("gameView.download.direct")}
                      </DropdownLabel>
                    </DropdownItem>
                    <DropdownItem onClick={handleClientDownload}>
                      <DropdownLabel>
                        {t("gameView.download.client")}
                      </DropdownLabel>
                    </DropdownItem>
                  </DropdownMenu>
                </Dropdown>
              )}
            </div>
            <div className="game-build-info">
              {formattedSize && <span>{formattedSize}</span>}
              {(installedInfo?.versionName ||
                serverVersionTag ||
                versionTag) && (
                <span>
                  {t("common.version")}{" "}
                  {installedInfo?.versionName || serverVersionTag || versionTag}
                </span>
              )}
              {updateAvailable && (
                <span className="game-update-notice">
                  <ArrowUpCircleIcon className="size-3.5" />
                  {t("gameView.update.available")}
                </span>
              )}
            </div>
            <dl className="game-session-stats">
              <div>
                <dt>{t("gameView.stats.playtime")}</dt>
                <dd>
                  {playtimeHours >= 1
                    ? `${formatDecimal(playtimeHours, playtimeHours < 10 ? 1 : 0)}\u00a0h`
                    : `${playtimeMinutes}\u00a0m`}
                </dd>
              </div>
              <div>
                <dt>{t("gameView.stats.lastPlayed")}</dt>
                <dd
                  title={
                    lastPlayedTime
                      ? `${lastPlayedDay}, ${lastPlayedTime}`
                      : lastPlayedDay
                  }
                >
                  {lastPlayedDay}
                </dd>
              </div>
              {avgPlaytime ? (
                <div>
                  <dt>{t("gameView.stats.avgTime")}</dt>
                  <dd>
                    {formatDecimal(
                      avgPlaytime / 60,
                      avgPlaytime / 60 < 10 ? 1 : 0,
                    )}
                    {"\u00a0h"}
                  </dd>
                </div>
              ) : null}
            </dl>
          </section>
          <div className="game-state-bar">
            <div className="game-platform-tags">
              {game.type && game.type !== "UNDETECTABLE" && (
                <button
                  type="button"
                  onClick={() => openLibraryFilter("types", game.type!)}
                  title={t("gameView.pill.filter")}
                >
                  {GAME_TYPE_LABEL[game.type]
                    ? t(GAME_TYPE_LABEL[game.type])
                    : game.type.replace(/_/g, " ")}
                </button>
              )}
              {(game.early_access || game.metadata?.early_access) && (
                <span>{t("gameView.earlyAccess")}</span>
              )}
            </div>
            <label className="game-progress-state">
              <span>{t("gameView.progress.label")}</span>
              <Listbox
                name="progressState"
                aria-label={t("gameView.progress.label")}
                value={progressState || "UNPLAYED"}
                onChange={(value: any) => updateProgressState(value)}
                disabled={!user || progressUpdating || (isTauri && !isOnline)}
              >
                {progressStateOptions.map((option) => (
                  <ListboxOption key={option.key} value={option.key}>
                    <ListboxLabel>{option.label}</ListboxLabel>
                  </ListboxOption>
                ))}
              </Listbox>
            </label>
          </div>
          {isTauri && (
            <div className="game-inline-download">
              <GameDownloadProgress gameId={game.id} />
            </div>
          )}
          <div className="game-detail-area">
            <nav
              ref={detailTabsRef}
              className="game-detail-tabs"
              aria-label={t("gameView.details.title")}
            >
              <span
                ref={tabIndicatorRef}
                className="game-detail-tab-indicator"
                aria-hidden="true"
              />
              {(
                [
                  ["description", "common.description"],
                  ["package", "gameView.tab.package"],
                  ["saves", "gameView.tab.saves"],
                  ["reviews", "gameView.tab.reviews"],
                  ["requirements", "gameView.tab.requirements"],
                  ["notes", "common.notes"],
                  ["tags", "common.tags"],
                  ...(Number(user?.role) >= 3
                    ? [["metrics", "gameView.tab.metrics"]]
                    : []),
                ] as [typeof detailsTab, TranslationKey][]
              ).map(([tab, label]) => (
                <button
                  type="button"
                  key={tab}
                  onClick={() => setDetailsTab(tab)}
                  aria-pressed={detailsTab === tab}
                  className={clsx(detailsTab === tab && "is-active")}
                >
                  {t(label)}
                </button>
              ))}
            </nav>
            <div className="game-detail-columns">
              <div className="game-detail-main">
                <section ref={detailsCardRef} className="game-detail-content">
                  <motion.div
                    key={detailsTab}
                    initial={reducedMotion ? false : { opacity: 0.68 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.24, ease: EASE_OUT }}
                    className="space-y-4 text-sm leading-relaxed"
                  >
                    {detailsTab === "metrics" && Number(user?.role) >= 3 && (
                      <GameMetrics gameId={numericId} />
                    )}
                    {detailsTab === "reviews" && (
                      <GameReviews gameId={numericId} />
                    )}
                    {detailsTab === "saves" && (
                      <GameSaves
                        gameId={numericId}
                        gameTitle={game?.title ?? undefined}
                      />
                    )}
                    {detailsTab === "package" && (
                      <PackageContents
                        gameId={numericId}
                        installationPath={installedInfo?.installationDirectory}
                        archivePassword={game?.metadata?.archive_password}
                        launchProfiles={game?.metadata?.launch_profiles}
                        onLaunch={(event, profile) =>
                          void handlePlayGame(event, profile)
                        }
                        onRecipe={(recipe) => {
                          setGame((previous) =>
                            previous
                              ? ({
                                  ...previous,
                                  metadata: {
                                    ...previous.metadata,
                                    installer_executable: recipe.executable,
                                    installer_parameters: recipe.parameters,
                                  },
                                } as PlaystashGame)
                              : previous,
                          );
                          void showAlert({
                            title: t("gameView.package.recipeSelected"),
                          });
                        }}
                      />
                    )}
                    {detailsTab === "requirements" && (
                      <div className="space-y-4">
                        {game?.metadata?.system_requirements_minimum ||
                        game?.metadata?.system_requirements_recommended ? (
                          <>
                            {game?.metadata?.system_requirements_minimum && (
                              <div>
                                <h4 className="mb-2 font-semibold">
                                  {t("gameView.requirements.minimum")}
                                </h4>
                                <MarkdownContent
                                  content={
                                    game.metadata.system_requirements_minimum
                                  }
                                />
                              </div>
                            )}
                            {game?.metadata
                              ?.system_requirements_recommended && (
                              <div>
                                <h4 className="mb-2 font-semibold">
                                  {t("gameView.requirements.recommended")}
                                </h4>
                                <MarkdownContent
                                  content={
                                    game.metadata
                                      .system_requirements_recommended
                                  }
                                />
                              </div>
                            )}
                          </>
                        ) : (
                          <p className="italic text-ps-muted">
                            {t("gameView.requirements.empty")}
                          </p>
                        )}
                      </div>
                    )}
                    {detailsTab === "description" &&
                      (description ? (
                        <MarkdownContent content={description} />
                      ) : (
                        <p className="italic text-ps-muted">
                          {t("gameView.description.empty")}
                        </p>
                      ))}
                    {detailsTab === "notes" &&
                      (notes ? (
                        <MarkdownContent content={notes} />
                      ) : (
                        <p className="italic text-ps-muted">
                          {t("gameView.notes.empty")}
                        </p>
                      ))}
                    {detailsTab === "tags" &&
                      (tags && tags.length ? (
                        <div className="flex flex-wrap gap-2">
                          {tags.map((tag) => (
                            <button
                              type="button"
                              key={tag}
                              onClick={() => openLibraryFilter("tags", tag)}
                              title={t("gameView.pill.filter")}
                              className="game-tag"
                            >
                              {tag}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <p className="italic text-ps-muted">
                          {t("gameView.tags.empty")}
                        </p>
                      ))}
                  </motion.div>
                </section>
                {(trailers.length > 0 || screenshots.length > 0) && (
                  <section className="game-media" ref={mediaSliderRef}>
                    <MediaSlider
                      trailers={trailers}
                      screenshots={screenshots}
                      aspect="aspect-[16/9]"
                    />
                  </section>
                )}
              </div>
              <aside className="game-metadata-rail">
                <section className="game-metadata">
                  <h2>{t("gameView.metadata.title")}</h2>
                  <ul className="space-y-4 text-sm text-ps-text">
                    <li className="flex items-start gap-3">
                      <CalendarDaysIcon className="w-5 h-5 mt-0.5 text-ps-muted" />
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] uppercase tracking-wide text-ps-muted whitespace-nowrap">
                          {t("gameView.metadata.releaseYear")}
                        </div>
                        <div
                          className="font-medium whitespace-nowrap truncate"
                          title={(releaseYear || "—") + ""}
                        >
                          {releaseYear || (
                            <span className="game-metadata-empty">—</span>
                          )}
                        </div>
                      </div>
                    </li>
                    <li className="flex items-start gap-3">
                      <StarOutline className="w-5 h-5 mt-0.5 text-ps-muted" />
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] uppercase tracking-wide text-ps-muted whitespace-nowrap">
                          {t("gameView.metadata.rating")}
                        </div>
                        <div
                          className="font-medium whitespace-nowrap"
                          title={formattedRating || "—"}
                        >
                          {formattedRating ?? (
                            <span className="game-metadata-empty">—</span>
                          )}
                        </div>
                      </div>
                    </li>
                    <li className="flex items-start gap-3">
                      <HashtagIcon className="w-5 h-5 mt-0.5 text-ps-muted" />
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] uppercase tracking-wide text-ps-muted whitespace-nowrap">
                          {t("common.version")}
                        </div>
                        <div
                          className="font-medium whitespace-nowrap truncate"
                          title={versionTag || "—"}
                        >
                          {versionTag || (
                            <span className="game-metadata-empty">—</span>
                          )}
                        </div>
                      </div>
                    </li>
                    <li className="flex items-start gap-3">
                      <GlobeAltIcon className="w-5 h-5 mt-0.5 text-ps-muted" />
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] uppercase tracking-wide text-ps-muted whitespace-nowrap">
                          {t("gameView.metadata.websites")}
                        </div>
                        <GameWebsites urls={websites} />
                      </div>
                    </li>
                    <li className="flex items-start gap-3">
                      <WrenchScrewdriverIcon className="w-5 h-5 mt-0.5 text-ps-muted" />
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] uppercase tracking-wide text-ps-muted whitespace-nowrap">
                          {devNames.length > 1
                            ? t("gameView.metadata.developers")
                            : t("gameView.metadata.developer")}
                        </div>
                        <div
                          className="font-medium whitespace-nowrap truncate"
                          title={devNames.length ? devNames.join(", ") : "—"}
                        >
                          {devNames.length
                            ? devNames.map((name, index) => (
                                <span key={name}>
                                  {index > 0 && ", "}
                                  <button
                                    type="button"
                                    className="cursor-pointer hover:text-ps-accent-cool"
                                    onClick={() =>
                                      openLibraryFilter("developers", name)
                                    }
                                  >
                                    {name}
                                  </button>
                                </span>
                              ))
                            : metadataEmpty}
                        </div>
                      </div>
                    </li>
                    <li className="flex items-start gap-3">
                      <BuildingOffice2Icon className="w-5 h-5 mt-0.5 text-ps-muted" />
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] uppercase tracking-wide text-ps-muted whitespace-nowrap">
                          {publisherNames.length > 1
                            ? t("gameView.metadata.publishers")
                            : t("gameView.metadata.publisher")}
                        </div>
                        <div
                          className="font-medium whitespace-nowrap truncate"
                          title={
                            publisherNames.length
                              ? publisherNames.join(", ")
                              : "—"
                          }
                        >
                          {publisherNames.length
                            ? publisherNames.map((name, index) => (
                                <span key={name}>
                                  {index > 0 && ", "}
                                  <button
                                    type="button"
                                    className="cursor-pointer hover:text-ps-accent-cool"
                                    onClick={() =>
                                      openLibraryFilter("publishers", name)
                                    }
                                  >
                                    {name}
                                  </button>
                                </span>
                              ))
                            : metadataEmpty}
                        </div>
                      </div>
                    </li>
                    <li className="flex items-start gap-3">
                      <ShieldCheckIcon className="w-5 h-5 mt-0.5 text-ps-muted" />
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] uppercase tracking-wide text-ps-muted whitespace-nowrap">
                          {t("gameView.metadata.ageRating")}
                        </div>
                        <div
                          className="font-medium whitespace-nowrap"
                          title={ageRating ?? "—"}
                        >
                          {ageRating ?? (
                            <span className="game-metadata-empty">—</span>
                          )}
                        </div>
                      </div>
                    </li>
                  </ul>
                </section>
                <div className="game-cloud-state">
                  <CloudSaveRow game={game} installed={installedInfo} />
                </div>
                <section className="game-activity">
                  <h2>{t("gameView.activity.title")}</h2>
                  {(() => {
                    const progresses: Progress[] =
                      (game as any)?.progresses || [];
                    // Exclude placeholder negative IDs and optionally current user (we show others)
                    const others = progresses.filter(
                      (p) =>
                        p.id > 0 &&
                        (p.user?.id ?? (p.user as any)?.ID) !== currentUserId,
                    );
                    if (!others.length) {
                      return (
                        <div className="text-xs text-ps-muted italic">
                          {t("gameView.activity.empty")}
                        </div>
                      );
                    }
                    const formatState = (s: string) =>
                      PROGRESS_LABEL[s]
                        ? t(PROGRESS_LABEL[s])
                        : s
                            .replace(/_/g, " ")
                            .toLowerCase()
                            .replace(/\b\w/g, (c) => c.toUpperCase());
                    return (
                      <ul className="flex flex-col gap-3 text-sm">
                        {others.map((p) => {
                          const uid = p.user?.id ?? (p.user as any)?.ID;
                          const rawUname =
                            (p.user as any)?.username ||
                            fillTemplate(t("community.userFallback"), {
                              id: uid,
                            });
                          const userSeed = uid != null ? String(uid) : rawUname;
                          const uname = streamerMode
                            ? maskDisplayName(userSeed)
                            : rawUname;
                          const avatarMedia = (p.user as any)?.avatar;
                          const lastPlayedStr = p.last_played_at
                            ? formatDate(new Date(p.last_played_at), "—")
                            : "—";
                          const minutes = p.minutes_played || 0;
                          const hours = minutes / 60;
                          return (
                            <li key={p.id} className="flex items-center gap-3">
                              <UserAvatar
                                media={avatarMedia}
                                size={32}
                                alt={uname}
                                seed={userSeed}
                                fallback={
                                  <div className="flex h-full w-full items-center justify-center rounded-[20%] bg-ps-panel-soft text-[10px] font-semibold text-ps-text">
                                    {uname.slice(0, 2).toUpperCase()}
                                  </div>
                                }
                              />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-medium truncate text-ps-text">
                                    {uname}
                                  </span>
                                  <span className="shrink-0 whitespace-nowrap text-[10px] px-1.5 py-0.5 rounded bg-ps-panel-soft text-ps-muted font-medium">
                                    {formatState(p.state)}
                                  </span>
                                </div>
                                <div className="text-[11px] text-ps-muted mt-0.5 flex items-center justify-between gap-4 tabular-nums">
                                  <span className="truncate">
                                    {fillTemplate(
                                      t("gameView.activity.played"),
                                      {
                                        time:
                                          hours >= 1
                                            ? `${formatDecimal(hours, hours < 10 ? 1 : 0)}\u00a0h`
                                            : `${minutes}\u00a0m`,
                                      },
                                    )}
                                  </span>
                                  <span className="shrink-0 text-right">
                                    {fillTemplate(t("gameView.activity.last"), {
                                      date: lastPlayedStr,
                                    })}
                                  </span>
                                </div>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    );
                  })()}
                </section>
              </aside>
            </div>
          </div>
        </>
      )}
      {/* Game Settings Modal */}
      {settingsOpen && game && (
        <GameSettings
          game={game}
          onClose={() => setSettingsOpen(false)}
          onGameUpdated={(updatedGame) => setGame(updatedGame)}
          onUninstalled={refetchInstalledGames}
        />
      )}
      <RootPathSelectDialog
        open={rootSelectOpen}
        gameTitle={title || game?.title || t("gameView.fallbackTitle")}
        rootPaths={(() => {
          try {
            return getRootPaths();
          } catch {
            return [];
          }
        })()}
        onSelect={handleRootPathSelect}
        onClose={() => setRootSelectOpen(false)}
        onGoToSettings={handleGoToSettingsFromRootSelect}
      />
      <VersionSelectDialog
        open={versionDialogOpen}
        gameTitle={title || game?.title || t("gameView.fallbackTitle")}
        versions={selectableVersions}
        onClose={() => {
          setVersionDialogOpen(false);
          setPendingDownloadAction(null);
          setPendingRootPath(null);
          setSelectableVersions([]);
        }}
        onSelect={handleVersionSelect}
      />
    </div>
  );
}
