import { GameTypeBadge } from "./GameTypeBadge";
import { PlaystashGame } from "@/api/models/PlaystashGame";
import { Media } from "@/components/Media";
import CoverPlaceholder from "@/components/CoverPlaceholder";
import { useAuth } from "@/context/AuthContext";
import { useAlertDialog } from "@/context/AlertDialogContext";
import { useDownloads } from "@/context/DownloadContext";
import { getGameCoverMediaId } from "@/hooks/useGames";
import { CloudArrowDownIcon } from "@heroicons/react/16/solid";
import {
  StarIcon as StarSolid,
  Cog8ToothIcon,
  ArrowUpCircleIcon,
} from "@heroicons/react/24/solid";
import { StarIcon as StarOutline } from "@heroicons/react/24/outline";
import { Button } from "@tw/button";
import { GameSettings } from "@/components/admin/GameSettings";
import { VersionSelectDialog } from "@/components/VersionSelectDialog";
import { RootPathSelectDialog } from "@/components/RootPathSelectDialog";
import { getRootPaths } from "@/utils/rootPaths";
import { requestGameDownload } from "@/utils/downloadFlow";
import { isTauriApp } from "@/utils/tauri";
import {
  formatGameSize,
  initialGameBookmarked,
  resolveSortMetric,
} from "@/utils/gameCard";
import { isGameUpdateAvailable } from "@/utils/gameUpdate";
import { launchInstalledGame } from "@/utils/launchInstalledGame";
import { Alert, AlertTitle } from "@tw/alert";
import {
  Dropdown,
  DropdownButton,
  DropdownItem,
  DropdownLabel,
  DropdownMenu,
} from "@tw/dropdown";
import clsx from "clsx";
import { memo, useCallback, useMemo, useState, useEffect } from "react";
import { Link, useNavigate } from "react-router";
import { GameVersion } from "@/api/models/GameVersion";
import { useMappedTitle } from "@/utils/mappedTitle";
import { useTranslation } from "@/i18n";
import { fillTemplate } from "@/utils/downloadPipeline";
import "@/styles/library.css";

const GameCard = memo(function GameCard({
  game,
  sortBy,
  hideInstalledBadge = false,
}: {
  game: PlaystashGame;
  sortBy?: string;
  hideInstalledBadge?: boolean;
}) {
  const { serverUrl, user, authFetch } = useAuth();
  const { showAlert } = useAlertDialog();
  const { t } = useTranslation();
  // Detect if this is a locally installed game (set by Library for installed games)
  const installedInfo = (game as any)?._installedInfo as
    | {
        installationDirectory: string;
        versionDirectory: string;
        versionId: number;
        versionName: string;
      }
    | undefined;
  const onUninstalledCallback = (game as any)?._onUninstalled as
    (() => void) | undefined;
  const isInstalled = !!installedInfo;
  // Derive initial bookmarked state from raw API shape (bookmarked_users or bookmarkedUsers)
  const currentUserId = (user as any)?.id ?? (user as any)?.ID;
  const initialBookmarked = useMemo(
    () => initialGameBookmarked(game, currentUserId),
    [game, currentUserId],
  );
  const [bookmarked, setBookmarked] = useState<boolean>(initialBookmarked);
  const [bookmarkBusy, setBookmarkBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [localGame, setLocalGame] = useState<PlaystashGame>(game);
  const shownTitle = useMappedTitle(localGame);
  const [versionDialogOpen, setVersionDialogOpen] = useState(false);
  const [selectableVersions, setSelectableVersions] = useState<GameVersion[]>(
    [],
  );
  const [pendingDownloadAction, setPendingDownloadAction] = useState<
    "direct" | "tauri" | "client" | null
  >(null);
  const [rootSelectOpen, setRootSelectOpen] = useState(false);
  const [pendingRootPath, setPendingRootPath] = useState<string | null>(null);
  const navigate = useNavigate();

  const coverId = getGameCoverMediaId(localGame) as number | string | null;

  useEffect(() => {
    setLocalGame(game);
    setBookmarked(initialBookmarked);
  }, [game, initialBookmarked]);

  // A game only has an update when it is installed locally and the server's
  // current default version tag differs from the installed one.
  const updateAvailable = useMemo(
    () => isGameUpdateAvailable(localGame, installedInfo),
    [localGame, installedInfo],
  );

  const toggleBookmark = useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!serverUrl || !currentUserId || bookmarkBusy) return;
      const base = serverUrl.replace(/\/+$/, "");
      const url = `${base}/api/users/me/bookmark/${game.id}`;
      const next = !bookmarked;
      setBookmarked(next); // optimistic
      setBookmarkBusy(true);
      try {
        const res = await authFetch(url, { method: next ? "POST" : "DELETE" });
        if (!res.ok) throw new Error(`Bookmark toggle failed (${res.status})`);
      } catch (err) {
        // Roll back the optimistic state and surface the failure instead of
        // failing silently (e.g. when the game no longer exists on the server).
        setBookmarked(!next);
        showAlert({
          title: t("gameCard.bookmark.failedTitle"),
          description: t("gameCard.bookmark.failedDescription"),
        });
      } finally {
        setBookmarkBusy(false);
      }
    },
    [
      serverUrl,
      currentUserId,
      bookmarkBusy,
      authFetch,
      game.id,
      bookmarked,
      showAlert,
      t,
    ],
  );
  const { startDownload } = useDownloads() as any;

  const isTauri = isTauriApp();

  const rawSize = localGame.size;

  const formattedSize = formatGameSize(
    typeof rawSize === "number" ? rawSize : Number(rawSize),
  );

  // Dynamic metric based on current sort
  const sortMetric = useMemo(
    () => resolveSortMetric(sortBy, localGame, formattedSize),
    [sortBy, formattedSize, localGame],
  );

  const resolveVersions = useCallback(async (): Promise<GameVersion[]> => {
    if (Array.isArray(localGame.versions) && localGame.versions.length > 0) {
      return localGame.versions;
    }
    if (!serverUrl) return [];

    const base = serverUrl.replace(/\/+$/, "");
    const res = await authFetch(`${base}/api/games/${game.id}`, {
      method: "GET",
    });
    if (!res.ok) return [];
    const fullGame = (await res.json()) as PlaystashGame;
    const fullVersions = Array.isArray(fullGame.versions)
      ? fullGame.versions
      : [];
    if (fullVersions.length > 0) {
      setLocalGame((prev) => ({ ...prev, versions: fullVersions }));
    }
    return fullVersions;
  }, [localGame.versions, serverUrl, authFetch, game.id]);

  const executeDownloadAction = useCallback(
    (
      action: "direct" | "tauri" | "client",
      selectedVersion: GameVersion,
      rootPath?: string,
    ) => {
      const resolvedTitle = localGame.metadata?.title || localGame.title;
      const filePathFallback = selectedVersion.file_path
        ? selectedVersion.file_path.split(/[/\\]/).pop()
        : undefined;
      const selectedFilename =
        filePathFallback && filePathFallback.trim().length > 0
          ? filePathFallback
          : `${resolvedTitle}.zip`;

      if (action === "client") {
        const url = `playstash://install?gameid=${game.id}&versionid=${selectedVersion.id}`;
        window.location.href = url;
        return;
      }

      startDownload({
        gameId: game.id,
        versionId: selectedVersion.id,
        versionName: selectedVersion.version,
        gameTitle: resolvedTitle,
        fileTitle: localGame.title,
        gameMetadata: localGame.metadata,
        gameType: (selectedVersion.type || localGame.type) as any,
        filename: selectedFilename,
        downloadRootPath: rootPath,
      });

      showAlert({
        title: fillTemplate(t("gameCard.queued"), {
          title: String(resolvedTitle),
        }),
      });
    },
    [game.id, localGame, showAlert, startDownload, t],
  );

  const selectVersionAndRun = useCallback(
    async (action: "direct" | "tauri" | "client", rootPath?: string) => {
      const versions = await resolveVersions();

      if (!versions.length) {
        showAlert({
          title: t("gameCard.noVersion.title"),
          description: t("gameCard.noVersion.description"),
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

  const handleDirectDownload = useCallback(async () => {
    if (!serverUrl) return;
    await selectVersionAndRun("direct");
  }, [serverUrl, selectVersionAndRun]);

  const handleTauriDownload = useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!serverUrl) return;
      // Location pick, version pick, overwrite and free-space checks live in
      // the shared download flow (also used by GameView and the CLI).
      await requestGameDownload({ gameId: game.id });
    },
    [serverUrl, game.id],
  );

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

  const handlePlayGame = useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!installedInfo) return;
      await launchInstalledGame({
        gameId: game.id,
        source: "game-card",
        game: localGame,
        installed: installedInfo,
      });
    },
    [installedInfo, game.id, localGame],
  );

  const handleClientDownload = useCallback(async () => {
    await selectVersionAndRun("client");
  }, [selectVersionAndRun]);

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

  const gameViewUrl = `/library/${game.id}`;
  const fallbackTitle =
    localGame.metadata?.title || localGame.title || t("gameCard.fallbackTitle");
  const downloadLabel = formattedSize
    ? fillTemplate(t("gameCard.downloadWithSize"), {
        title: String(localGame.title),
        size: formattedSize,
      })
    : fillTemplate(t("gameCard.download"), { title: String(localGame.title) });

  const handleOpenSettings = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setSettingsOpen(true);
  }, []);

  return (
    <>
      <div className="ps-game-card group/card">
        <div className="ps-game-card-body">
          <Link
            to={gameViewUrl}
            aria-label={shownTitle || fallbackTitle}
            className="ps-game-card-link"
          />
          <div className="ps-game-card-cover">
            <div className="ps-game-card-art">
              {coverId ? (
                <Media
                  media={
                    {
                      id:
                        typeof coverId === "number"
                          ? coverId
                          : Number(coverId) || 0,
                      created_at: new Date(0),
                      entity_version: 0,
                    } as any
                  }
                  size={300}
                  className="ps-game-card-media"
                  fit="cover"
                  square
                  alt={localGame.title}
                  gameId={localGame.id}
                  mediaSlot="cover"
                  fallback={
                    <CoverPlaceholder
                      title={fallbackTitle}
                      size="large"
                      className="ps-game-card-placeholder h-full w-full"
                    />
                  }
                />
              ) : (
                <CoverPlaceholder
                  title={fallbackTitle}
                  size="large"
                  className="ps-game-card-placeholder h-full w-full"
                />
              )}
            </div>

            {/* Icon-only "Installed" / "Update available" indicator in the
              lower-right corner so server games that are already installed
              locally are recognizable at a glance. When a newer version exists
              on the server it turns into an amber up-arrow. It is a passive
              marker (no text, tooltip only) and fades out on hover so it never
              clashes with the centered Play/Download action button. */}
            {isInstalled && !hideInstalledBadge && (
              <span
                title={
                  updateAvailable
                    ? t("gameCard.updateAvailable")
                    : t("gameCard.installed")
                }
                aria-label={
                  updateAvailable
                    ? t("gameCard.updateAvailable")
                    : t("gameCard.installed")
                }
                className={clsx(
                  "pointer-events-none absolute bottom-2 right-2 z-10 flex size-6 items-center justify-center rounded border bg-ps-panel transition-opacity duration-200 group-hover/card:opacity-0! group-focus-within/card:opacity-0!",
                  updateAvailable
                    ? "border-ps-line-strong text-ps-warning"
                    : "border-ps-line-strong text-ps-success",
                )}
              >
                {updateAvailable ? (
                  <ArrowUpCircleIcon
                    className="h-3.5 w-3.5"
                    aria-hidden="true"
                  />
                ) : (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    className="h-3.5 w-3.5"
                    aria-hidden="true"
                  >
                    <path
                      fillRule="evenodd"
                      d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z"
                      clipRule="evenodd"
                    />
                  </svg>
                )}
              </span>
            )}

            <GameTypeBadge type={localGame.type} />

            {/* Corner action buttons - hidden until hover */}
            {/* Bookmark */}
            <button
              type="button"
              onClick={toggleBookmark}
              aria-label={
                bookmarked
                  ? t("gameCard.bookmark.remove")
                  : t("gameCard.bookmark.add")
              }
              aria-pressed={bookmarked}
              disabled={!currentUserId || bookmarkBusy}
              className={clsx(
                "ps-card-action ps-card-action-top absolute top-2 right-2 flex size-9 cursor-pointer items-center justify-center border",
                "opacity-0 group-hover/card:opacity-100! group-focus-within/card:opacity-100!",
                "disabled:cursor-not-allowed disabled:opacity-50",
                bookmarked
                  ? "border-ps-warning/40 bg-ps-warning/15"
                  : "border-ps-line bg-ps-panel-soft/80 hover:border-ps-line-strong hover:bg-ps-panel",
                "active:scale-[0.98]",
              )}
            >
              {bookmarked ? (
                <StarSolid
                  className="h-5 w-5 text-ps-warning"
                  aria-hidden="true"
                />
              ) : (
                <StarOutline
                  className="h-5 w-5 text-ps-muted"
                  aria-hidden="true"
                />
              )}
            </button>

            {/* Settings */}
            <button
              type="button"
              onClick={handleOpenSettings}
              aria-label={t("nav.settings")}
              className={clsx(
                "ps-card-action ps-card-action-top absolute top-2 left-2 flex size-9 cursor-pointer items-center justify-center border border-ps-line text-ps-muted",
                "opacity-0 group-hover/card:opacity-100! group-focus-within/card:opacity-100!",
                "hover:border-ps-line-strong hover:bg-ps-panel hover:text-ps-text",
                "active:scale-[0.98]",
              )}
              title={t("nav.settings")}
            >
              <Cog8ToothIcon className="h-5 w-5" aria-hidden="true" />
            </button>

            {/* Centered primary action: Download / Play */}
            {isInstalled ? (
              <button
                type="button"
                aria-label={t("common.play")}
                onClick={handlePlayGame}
                className={clsx(
                  "ps-card-action ps-card-action-primary ps-card-action-bottom absolute bottom-3 left-1/2 flex min-h-9 cursor-pointer items-center justify-center gap-2 px-4 py-2 text-sm font-semibold",
                  "opacity-0 group-hover/card:opacity-100! group-focus-within/card:opacity-100!",
                  "active:scale-[0.97]",
                )}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  className="h-4 w-4 shrink-0 fill-current"
                  aria-hidden="true"
                >
                  <path d="M8 17.175V6.825q0-.425.3-.713t.7-.287q.125 0 .263.037t.262.113l8.15 5.175q.225.15.338.375t.112.475t-.112.475t-.338.375l-8.15 5.175q-.125.075-.262.113T9 18.175q-.4 0-.7-.288t-.3-.712" />
                </svg>
                {t("common.play")}
              </button>
            ) : (
              <div
                className={clsx(
                  "ps-card-action ps-card-action-bottom absolute bottom-3 left-1/2 flex items-center",
                  "opacity-0 group-hover/card:opacity-100! group-focus-within/card:opacity-100!",
                )}
              >
                {isTauri ? (
                  <Button
                    color="indigo"
                    aria-label={downloadLabel}
                    className="h-9 px-3 gap-2 flex items-center justify-center"
                    title={downloadLabel}
                    onClick={handleTauriDownload}
                  >
                    <CloudArrowDownIcon className="w-5 h-5 shrink-0" />
                    {formattedSize ? (
                      <span className="text-xs font-medium whitespace-nowrap">
                        {formattedSize}
                      </span>
                    ) : (
                      <span className="text-xs font-medium whitespace-nowrap">
                        {t("common.download")}
                      </span>
                    )}
                  </Button>
                ) : (
                  <Dropdown>
                    <DropdownButton
                      as={Button}
                      color="indigo"
                      aria-label={downloadLabel}
                      className="h-9 px-3 gap-2 flex items-center justify-center"
                      onClick={(e: React.MouseEvent) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                    >
                      <CloudArrowDownIcon className="w-5 h-5 shrink-0" />
                      {formattedSize ? (
                        <span className="text-xs font-medium whitespace-nowrap">
                          {formattedSize}
                        </span>
                      ) : (
                        <span className="text-xs font-medium whitespace-nowrap">
                          {t("common.download")}
                        </span>
                      )}
                    </DropdownButton>
                    <DropdownMenu className="min-w-48" anchor="top end">
                      <DropdownItem
                        onClick={(e: React.MouseEvent) => {
                          e.preventDefault();
                          e.stopPropagation();
                          void handleDirectDownload();
                        }}
                      >
                        <DropdownLabel>
                          {t("gameCard.directDownload")}
                        </DropdownLabel>
                      </DropdownItem>
                      <DropdownItem
                        onClick={(e: React.MouseEvent) => {
                          e.preventDefault();
                          e.stopPropagation();
                          void handleClientDownload();
                        }}
                      >
                        <DropdownLabel>
                          {t("gameCard.clientDownload")}
                        </DropdownLabel>
                      </DropdownItem>
                    </DropdownMenu>
                  </Dropdown>
                )}
              </div>
            )}
          </div>

          {/* Metadata footer */}
          <div className="ps-game-card-footer">
            {/* Two lines: long titles stay identifiable instead of collapsing
              into a shared prefix ("The Legend of Zelda: …"). */}
            <h3
              className="line-clamp-2 text-sm font-semibold tracking-[-0.02em] text-ps-text"
              title={shownTitle}
            >
              {shownTitle}
            </h3>
            {sortMetric && (
              <p className="truncate text-xs text-ps-muted tabular-nums">
                {sortMetric}
              </p>
            )}
          </div>
        </div>
      </div>
      {settingsOpen && (
        <GameSettings
          game={game}
          onClose={() => setSettingsOpen(false)}
          onGameUpdated={(updatedGame) => setLocalGame(updatedGame)}
          onUninstalled={onUninstalledCallback}
        />
      )}
      <RootPathSelectDialog
        open={rootSelectOpen}
        gameTitle={fallbackTitle}
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
        gameTitle={fallbackTitle}
        versions={selectableVersions}
        onClose={() => {
          setVersionDialogOpen(false);
          setPendingDownloadAction(null);
          setPendingRootPath(null);
          setSelectableVersions([]);
        }}
        onSelect={handleVersionSelect}
      />
    </>
  );
});

export default GameCard;
