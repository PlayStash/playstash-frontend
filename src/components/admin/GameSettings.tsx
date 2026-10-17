import { Button } from "@/components/tailwind/button";
import { Dialog, DialogBody, DialogTitle } from "@/components/tailwind/dialog";
import { Input } from "@/components/tailwind/input";
import { Text } from "@/components/tailwind/text";
import {
  Listbox,
  ListboxOption,
  ListboxLabel,
} from "@/components/tailwind/listbox";
import {
  PlaystashGame,
  PlaystashGameTypeEnum,
} from "@/api/models/PlaystashGame";
import { GameVersion } from "@/api/models/GameVersion";
import { PlaystashUserRoleEnum } from "@/api/models/PlaystashUser";
import { UpdateGameDto } from "@/api/models/UpdateGameDto";
import { MetadataProviderDto } from "@/api/models/MetadataProviderDto";
import { GameMetadata } from "@/api/models/GameMetadata";
import { MapGameDto } from "@/api/models/MapGameDto";
import { formatBytes } from "@/utils/downloadFormat";
import { useAuth } from "@/context/AuthContext";
import { useAlertDialog } from "@/context/AlertDialogContext";
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { isTauriApp } from "@/utils/tauri";
import { formatDate, formatYear } from "@/utils/date";
import { ArtworkSearchButton } from "@/components/ArtworkSearchDialog";
import { CopyImageButton } from "@/components/admin/CopyImageButton";
import {
  applyDroppedSources,
  isProbablyImageUrl,
  extractImageCandidatesFromDataTransfer,
  pickBestImageUrl,
} from "@/utils/droppedImage";
import { useOnlineStatus } from "@/context/OfflineContext";
import { emitGameDeleted, emitGameUpdated } from "@/utils/gameUpdates";
import { GameMediaSlot, resolveApiMediaBlob } from "@/utils/mediaCache";
import {
  PhotoIcon,
  CircleStackIcon,
  PencilIcon,
  MagnifyingGlassIcon,
  SparklesIcon,
  ArrowUturnLeftIcon,
  ArrowPathIcon,
  FolderOpenIcon,
  LinkSlashIcon,
  TrashIcon,
  DocumentTextIcon,
} from "@heroicons/react/24/outline";
import { PaintBrushIcon } from "@heroicons/react/16/solid";
import { translate, useTranslation } from "@/i18n";
import type { TranslationKey } from "@/i18n";
import { fillTemplate } from "@/utils/downloadPipeline";

interface Props {
  game: PlaystashGame;
  onClose: () => void;
  onGameUpdated?: (g: PlaystashGame) => void;
  onUninstalled?: () => void;
}

// No cool object binding in react, so we manually pick fields for custom metadata. But at least this is type save
type CustomMetadataForm = {
  [
    K in
      | keyof Pick<
          GameMetadata,
          | "title"
          | "description"
          | "notes"
          | "average_playtime"
          | "age_rating"
          | "release_date"
          | "rating"
          | "early_access"
          | "launch_executable"
          | "launch_parameters"
          | "installer_executable"
          | "installer_parameters"
          | "uninstaller_executable"
          | "uninstaller_parameters"
          | "url_websites"
          | "url_trailers"
          | "url_gameplays"
          | "url_screenshots"
        >
      | UmuMetadataFields
  ]: string;
} & {
  sort_title: string;
  genres: string;
  tags: string;
  publishers: string;
  developers: string;
  /** Save folders, one per line (`save_paths`). */
  save_paths: string;
};

/** Save folders of a game's metadata (missing on older servers). */
function metadataSavePaths(metadata: GameMetadata | undefined): string[] {
  const paths = (metadata as { save_paths?: unknown } | undefined)?.save_paths;
  return Array.isArray(paths)
    ? paths.filter((path): path is string => typeof path === "string")
    : [];
}

/**
 * umu-launcher defaults for Linux clients (GAMEID/STORE/PROTONPATH).
 *
 * Declared locally so the form keeps compiling with API clients generated
 * from a server that does not ship these metadata fields yet; the values are
 * sent through the untyped `updateDto` in `saveCustomMetadata`.
 */
type UmuMetadataFields = "umu_game_id" | "umu_store" | "umu_proton_path";

type GameMetadataWithUmu = GameMetadata &
  Partial<Record<UmuMetadataFields, string | undefined>>;

type InstalledGameInfo = SettingsInstalledGame;

import { getRootPaths } from "@/utils/rootPaths";
import { getErrorMessage } from "@/utils/apiError";
import {
  ScreenshotStoreError,
  serverMediaAddress,
  storeScreenshots,
} from "@/utils/storeScreenshots";
import { LibraryMetadataSettings } from "./LibraryMetadataSettings";
import { GameAccessSettings } from "./GameAccessSettings";
import { InstallationTab } from "@/components/gameSettings/InstallationTab";
import { LaunchOptionsTab } from "@/components/gameSettings/LaunchOptionsTab";
import type { SettingsInstalledGame } from "@/components/gameSettings/types";

interface ImageState {
  file: File | null;
  via: "none" | "file" | "url" | "paste" | "drag";
  preview: string | null;
  urlInput: string;
  original: string | null;
  loadedId?: number | null;
}

const IMAGE_SOURCE_LABELS: Record<
  Exclude<ImageState["via"], "none">,
  TranslationKey
> = {
  file: "gameEditor.images.via.file",
  url: "gameEditor.images.via.url",
  paste: "gameEditor.images.via.paste",
  drag: "gameEditor.images.via.drag",
};

type TabKey =
  | "images"
  | "metadata"
  | "custom-metadata"
  | "installation"
  | "launch-options"
  | "game-files";

export function GameSettings({
  game,
  onClose,
  onGameUpdated,
  onUninstalled,
}: Props) {
  const { serverUrl, authFetch, user } = useAuth() as any;
  const { showAlert } = useAlertDialog();
  const { t } = useTranslation();
  const isAdmin = Number(user?.role) >= Number(PlaystashUserRoleEnum._3);
  const [activeTab, setActiveTab] = useState<TabKey>("images");
  const [saving, setSaving] = useState(false);
  const [deletingVersionId, setDeletingVersionId] = useState<number | null>(
    null,
  );
  const [fullGame, setFullGame] = useState<PlaystashGame | null>(null);
  const [loadingFullGame, setLoadingFullGame] = useState(true);
  const [installedGame, setInstalledGame] = useState<InstalledGameInfo | null>(
    null,
  );
  const [uninstalling, setUninstalling] = useState(false);
  const isTauri = isTauriApp();
  const { isOnline } = useOnlineStatus();

  // Image state & logic
  const [coverImg, setCoverImg] = useState<ImageState>({
    file: null,
    via: "none",
    preview: null,
    urlInput: "",
    original: null,
    loadedId: undefined,
  });
  const [bgImg, setBgImg] = useState<ImageState>({
    file: null,
    via: "none",
    preview: null,
    urlInput: "",
    original: null,
    loadedId: undefined,
  });
  const [savingImages, setSavingImages] = useState(false);
  const [imagesMsg, setImagesMsg] = useState<{
    text: string;
    ok: boolean;
  } | null>(null);
  const revokeRef = useRef<string[]>([]);
  const dragTargetRef = useRef<"cover" | "bg" | null>(null);
  const nativeDragHandledRef = useRef(false);
  const coverZoneRef = useRef<HTMLDivElement | null>(null);
  const bgZoneRef = useRef<HTMLDivElement | null>(null);

  // Custom metadata state - initialize empty object with all editable GameMetadata fields
  const getEmptyCustomMetadata = (): CustomMetadataForm => ({
    title: "",
    sort_title: "",
    description: "",
    notes: "",
    average_playtime: "",
    age_rating: "",
    release_date: "",
    rating: "",
    early_access: "",
    launch_executable: "",
    launch_parameters: "",
    installer_executable: "",
    installer_parameters: "",
    uninstaller_executable: "",
    uninstaller_parameters: "",
    umu_game_id: "",
    umu_store: "",
    umu_proton_path: "",
    url_websites: "",
    genres: "",
    tags: "",
    publishers: "",
    developers: "",
    url_trailers: "",
    url_gameplays: "",
    url_screenshots: "",
    save_paths: "",
  });

  const [customMetadata, setCustomMetadata] = useState<CustomMetadataForm>(
    getEmptyCustomMetadata(),
  );
  const [savingCustomMetadata, setSavingCustomMetadata] = useState(false);

  // Metadata providers state
  const [metadataProviders, setMetadataProviders] = useState<
    MetadataProviderDto[]
  >([]);
  const [loadingProviders, setLoadingProviders] = useState(false);
  const [selectedMetadataProviderIndex, setSelectedMetadataProviderIndex] =
    useState<number>(0);
  const [remapSearchResults, setRemapSearchResults] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [customPriority, setCustomPriority] = useState<string>("");
  const [remapping, setRemapping] = useState(false);
  const searchTimeoutRef = useRef<number | null>(null);
  const [gameCoverUrl, setGameCoverUrl] = useState<string | null>(null);
  const [mappedGameCoverUrl, setMappedGameCoverUrl] = useState<string | null>(
    null,
  );

  // Fetch full game object on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoadingFullGame(true);
        const base = serverUrl.replace(/\/+$/, "");
        const res = await authFetch(`${base}/api/games/${game.id}`, {
          method: "GET",
        });
        if (!res.ok) throw new Error(`Failed to load game (${res.status})`);
        const json = await res.json();
        if (!cancelled) setFullGame(json);
      } catch (e: any) {
        console.error("Failed to fetch full game:", e);
        if (!cancelled) setFullGame(game); // fallback to slim version
      } finally {
        if (!cancelled) setLoadingFullGame(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [serverUrl, authFetch, game]);

  // Use fullGame if available, otherwise fallback to game prop
  const workingGame = fullGame || game;
  const installationTabsVisible = isTauri && !!installedGame;

  const openImageSearch = useCallback(
    async (searchTerms: string) => {
      const gameTitle =
        workingGame.metadata?.title || workingGame.title || "Game";
      const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(
        `${gameTitle} ${searchTerms}`,
      )}&tbm=isch`;

      try {
        if (isTauri) {
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("open_external_url", { url: searchUrl });
          return;
        }

        window.open(searchUrl, "_blank", "noopener,noreferrer");
      } catch (error) {
        console.error("Failed to open image search:", error);
        await showAlert({
          title: t("gameEditor.images.searchFailed"),
          description: error instanceof Error ? error.message : String(error),
          affirmativeText: t("common.ok"),
        });
      }
    },
    [isTauri, showAlert, t, workingGame.metadata?.title, workingGame.title],
  );

  const findInstalledGame =
    useCallback(async (): Promise<InstalledGameInfo | null> => {
      if (!isTauri) return null;
      const rootPaths = getRootPaths();
      if (!rootPaths.length) return null;

      const { invoke } = await import("@tauri-apps/api/core");

      const allResults: any[] = [];
      const seen = new Set<string>();

      for (const root of rootPaths) {
        const rawResults = await invoke<any[]>("list_installed_games", {
          selectedRoot: root.path,
        }).catch(() => [] as any[]);

        for (const r of rawResults) {
          const id = r.gameId ?? r.game_id ?? 0;
          const vd = r.versionDirectory ?? r.version_directory ?? "";
          const key = `${id}:${vd}`;
          if (id > 0 && !seen.has(key)) {
            seen.add(key);
            allResults.push(r);
          }
        }
      }

      const match = allResults
        .filter(
          (r) =>
            Number(r.gameId ?? r.game_id ?? 0) === workingGame.id &&
            typeof (r.installationDirectory ?? r.installation_directory) ===
              "string" &&
            (r.installationDirectory ?? r.installation_directory ?? "").trim()
              .length > 0 &&
            typeof (r.versionDirectory ?? r.version_directory) === "string" &&
            (r.versionDirectory ?? r.version_directory ?? "").trim().length > 0,
        )
        .sort(
          (a, b) =>
            Number(b.versionId ?? b.version_id ?? 0) -
            Number(a.versionId ?? a.version_id ?? 0),
        )[0];

      if (!match) return null;

      return {
        gameId: Number(match.gameId ?? match.game_id ?? workingGame.id),
        gameTitle:
          String(match.gameTitle ?? match.game_title ?? "").trim() ||
          workingGame.metadata?.title ||
          workingGame.title ||
          "Game",
        gameType:
          typeof (match.gameType ?? match.game_type) === "string" &&
          (match.gameType ?? match.game_type ?? "").trim().length > 0
            ? (match.gameType ?? match.game_type)
            : undefined,
        versionId: Number(match.versionId ?? match.version_id ?? 0),
        versionName: String(
          match.versionName ?? match.version_name ?? "",
        ).trim(),
        installationDirectory: String(
          match.installationDirectory ?? match.installation_directory ?? "",
        ),
        versionDirectory: String(
          match.versionDirectory ?? match.version_directory ?? "",
        ),
      };
    }, [
      isTauri,
      workingGame.id,
      workingGame.metadata?.title,
      workingGame.title,
    ]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const nextInstalledGame = await findInstalledGame();
        if (!cancelled) {
          setInstalledGame(nextInstalledGame);
        }
      } catch (error) {
        console.warn("Failed to detect installed game state:", error);
        if (!cancelled) {
          setInstalledGame(null);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [findInstalledGame]);

  useEffect(() => {
    if (
      !installationTabsVisible &&
      (activeTab === "installation" || activeTab === "launch-options")
    ) {
      setActiveTab("images");
    }
  }, [activeTab, installationTabsVisible]);

  // If offline, redirect away from server-dependent tabs
  useEffect(() => {
    const serverTabs: TabKey[] = [
      "images",
      "metadata",
      "custom-metadata",
      "game-files",
    ];
    if (isTauri && !isOnline && serverTabs.includes(activeTab)) {
      if (installationTabsVisible) {
        setActiveTab("installation");
      } else {
        setActiveTab("launch-options");
      }
    }
  }, [isTauri, isOnline, activeTab, installationTabsVisible]);

  const handleUninstalled = useCallback(async () => {
    setInstalledGame(await findInstalledGame().catch(() => null));
    onUninstalled?.();
    onClose();
  }, [findInstalledGame, onClose, onUninstalled]);

  /** Re-fetches the full game so the version list reflects server state. */
  const refetchGame = useCallback(async (): Promise<PlaystashGame | null> => {
    if (!serverUrl) return null;
    const base = serverUrl.replace(/\/+$/, "");
    const res = await authFetch(`${base}/api/games/${workingGame.id}`, {
      method: "GET",
    });
    if (!res.ok) throw new Error(`Failed to reload game (${res.status})`);
    return (await res.json()) as PlaystashGame;
  }, [authFetch, serverUrl, workingGame.id]);

  const handleDeleteGameVersion = useCallback(
    async (version: GameVersion) => {
      const versionLabel =
        version.version ||
        fillTemplate(t("gameEditor.files.versionFallback"), {
          id: version.id,
        });

      const confirmed = await showAlert({
        title: fillTemplate(t("gameEditor.files.deleteConfirm.title"), {
          version: versionLabel,
        }),
        description: fillTemplate(
          t("gameEditor.files.deleteConfirm.description"),
          { path: version.file_path ?? "" },
        ),
        affirmativeText: t("common.delete"),
        negativeText: t("common.cancel"),
      });
      if (!confirmed) return;

      setDeletingVersionId(version.id);
      try {
        // Deleting the only version removes the game from the library.
        const wasLastVersion = (workingGame.versions?.length ?? 0) <= 1;

        const base = serverUrl?.replace(/\/+$/, "");
        if (!base) throw new Error(t("gameEditor.error.missingServerUrl"));
        const res = await authFetch(
          `${base}/api/game/${workingGame.id}/versions/${version.id}`,
          { method: "DELETE" },
        );
        if (!res.ok) {
          const message = await getErrorMessage(
            res,
            t("gameEditor.files.deleteFailedFallback"),
          );
          throw new Error(message);
        }

        let updatedGame: PlaystashGame | null = null;
        try {
          updatedGame = await refetchGame();
        } catch {
          updatedGame = null;
        }

        const hasRemainingVersions =
          !!updatedGame &&
          Array.isArray(updatedGame.versions) &&
          updatedGame.versions.length > 0;

        // The game is fully removed once its last version file is gone: close
        // the settings modal and let the library/game view react.
        if (wasLastVersion || !hasRemainingVersions) {
          emitGameDeleted(workingGame.id);
          onClose();
          return;
        }

        if (updatedGame) {
          setFullGame(updatedGame);
          onGameUpdated?.(updatedGame);
          emitGameUpdated(updatedGame);
        }

        await showAlert({
          title: t("gameEditor.files.deleted.title"),
          description: fillTemplate(t("gameEditor.files.deleted.description"), {
            version: versionLabel,
          }),
          affirmativeText: t("common.ok"),
        });
      } catch (e: any) {
        await showAlert({
          title: t("gameEditor.files.deleteFailed"),
          description: e?.message || t("gameEditor.files.deleteFailedFallback"),
          affirmativeText: t("common.ok"),
        });
      } finally {
        setDeletingVersionId(null);
      }
    },
    [
      authFetch,
      emitGameDeleted,
      emitGameUpdated,
      onGameUpdated,
      refetchGame,
      serverUrl,
      showAlert,
      t,
      workingGame.id,
      workingGame.metadata?.title,
      workingGame.title,
      workingGame.versions,
    ],
  );

  // Computed: Current shown mapped game
  const currentShownMappedGame = useMemo<GameMetadata | null>(() => {
    if (!workingGame.provider_metadata || metadataProviders.length === 0)
      return null;
    const selectedProvider = metadataProviders[selectedMetadataProviderIndex];
    if (!selectedProvider) return null;

    return (
      workingGame.provider_metadata.find(
        (meta) => meta.provider_slug === selectedProvider.slug,
      ) || null
    );
  }, [
    workingGame.provider_metadata,
    metadataProviders,
    selectedMetadataProviderIndex,
  ]);

  // Initialize providers on metadata tab open
  useEffect(() => {
    if (
      activeTab === "metadata" &&
      metadataProviders.length === 0 &&
      !loadingProviders
    ) {
      const initializeProviders = async () => {
        setLoadingProviders(true);
        try {
          const base = serverUrl?.replace(/\/+$/, "");
          if (!base)
            throw new Error(translate("gameEditor.error.missingServerUrl"));

          const res = await authFetch(`${base}/api/metadata/providers`);
          if (!res.ok) {
            throw new Error(
              fillTemplate(
                translate("gameEditor.metadata.providersFetchFailed"),
                {
                  status: res.status,
                },
              ),
            );
          }

          let providers: MetadataProviderDto[] = await res.json();
          console.log(
            "📦 Providers from API:",
            providers.map((p) => ({
              slug: p.slug,
              name: p.name,
              priority: p.priority,
            })),
          );

          // Override priorities from game's provider_metadata
          if (workingGame.provider_metadata) {
            console.log(
              "🎮 Game provider_metadata:",
              workingGame.provider_metadata.map((m) => ({
                slug: m.provider_slug,
                priority: m.provider_priority,
              })),
            );
            providers = providers.map((provider) => {
              const gameProviderMeta = workingGame.provider_metadata?.find(
                (meta) => meta.provider_slug === provider.slug,
              );
              if (gameProviderMeta?.provider_priority != null) {
                console.log(
                  `✅ Overriding ${provider.slug}: ${provider.priority} -> ${gameProviderMeta.provider_priority}`,
                );
                return {
                  ...provider,
                  priority: gameProviderMeta.provider_priority,
                };
              }
              return provider;
            });
          }

          // Sort by priority descending
          providers.sort((a, b) => b.priority - a.priority);
          console.log(
            "🔄 Providers after sort:",
            providers.map((p) => ({
              slug: p.slug,
              name: p.name,
              priority: p.priority,
            })),
          );

          setMetadataProviders(providers);
          setSelectedMetadataProviderIndex(0);
        } catch (e: any) {
          console.error("Failed to fetch metadata providers:", e);
          await showAlert({
            title: translate("common.error"),
            description:
              e?.message ||
              translate("gameEditor.metadata.providersLoadFailed"),
            affirmativeText: translate("common.ok"),
          });
        } finally {
          setLoadingProviders(false);
        }
      };

      initializeProviders();
    }
  }, [
    activeTab,
    metadataProviders.length,
    loadingProviders,
    serverUrl,
    authFetch,
    workingGame.provider_metadata,
    showAlert,
  ]);

  // Clear search results when provider selection changes
  useEffect(() => {
    setRemapSearchResults([]);
    setSearchQuery("");
    setMappedGameCoverUrl(null);

    // Set the current priority as the input value
    if (currentShownMappedGame?.provider_priority != null) {
      setCustomPriority(currentShownMappedGame.provider_priority.toString());
    } else {
      setCustomPriority("");
    }
  }, [selectedMetadataProviderIndex, currentShownMappedGame]);

  // Debounced search function
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (!searchQuery.trim() || metadataProviders.length === 0) {
      setRemapSearchResults([]);
      return;
    }

    searchTimeoutRef.current = setTimeout(async () => {
      const selectedProvider = metadataProviders[selectedMetadataProviderIndex];
      if (!selectedProvider) return;

      setSearching(true);
      try {
        const base = serverUrl?.replace(/\/+$/, "");
        if (!base)
          throw new Error(translate("gameEditor.error.missingServerUrl"));

        const res = await authFetch(
          `${base}/api/metadata/providers/${selectedProvider.slug}/search?query=${encodeURIComponent(searchQuery)}`,
        );

        if (!res.ok) {
          throw new Error(`Search failed (${res.status})`);
        }

        const results = await res.json();
        setRemapSearchResults(Array.isArray(results) ? results : []);
      } catch (e: any) {
        console.error("Search failed:", e);
        setRemapSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 400);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [
    searchQuery,
    metadataProviders,
    selectedMetadataProviderIndex,
    serverUrl,
    authFetch,
  ]);

  // Core remap function
  const remapGame = async (
    providerDataId: string | null,
    priority?: number,
  ) => {
    const selectedProvider = metadataProviders[selectedMetadataProviderIndex];
    if (!selectedProvider) return;

    setRemapping(true);
    try {
      const base = serverUrl?.replace(/\/+$/, "");
      if (!base) throw new Error(t("gameEditor.error.missingServerUrl"));

      const mappingRequest: MapGameDto = {
        provider_slug: selectedProvider.slug,
        provider_data_id: providerDataId || undefined,
        provider_priority:
          priority !== undefined ? priority : selectedProvider.priority,
      };

      const updateDto: UpdateGameDto = {
        mapping_requests: [mappingRequest],
      };

      const res = await authFetch(`${base}/api/games/${workingGame.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(updateDto),
      });

      if (!res.ok) {
        const txt = await res.text();
        throw new Error(
          fillTemplate(t("gameEditor.metadata.remapFailedStatus"), {
            status: res.status,
            details: txt || res.statusText,
          }),
        );
      }

      const updatedGame = await res.json();
      setFullGame(updatedGame);
      onGameUpdated?.(updatedGame);
      emitGameUpdated(updatedGame);

      // Refresh providers to get updated priorities
      setMetadataProviders([]);

      await showAlert({
        title: t("gameEditor.success"),
        description: providerDataId
          ? t("gameEditor.metadata.remapped")
          : t("gameEditor.metadata.unmapped"),
        affirmativeText: t("common.ok"),
      });
    } catch (e: any) {
      await showAlert({
        title: t("common.error"),
        description: e?.message || t("gameEditor.metadata.remapFailed"),
        affirmativeText: t("common.ok"),
      });
    } finally {
      setRemapping(false);
    }
  };

  const handleSavePriority = async () => {
    const priority = parseInt(customPriority, 10);
    if (isNaN(priority)) {
      await showAlert({
        title: t("gameEditor.metadata.invalidPriority.title"),
        description: t("gameEditor.metadata.invalidPriority.description"),
        affirmativeText: t("common.ok"),
      });
      return;
    }

    if (!currentShownMappedGame?.provider_data_id) {
      await showAlert({
        title: t("gameEditor.metadata.noMapping.title"),
        description: t("gameEditor.metadata.noMapping.description"),
        affirmativeText: t("common.ok"),
      });
      return;
    }

    await remapGame(currentShownMappedGame.provider_data_id, priority);
    setCustomPriority("");
  };

  const handleUnmap = async () => {
    const result = await showAlert({
      title: t("gameEditor.metadata.unmapConfirm.title"),
      description: t("gameEditor.metadata.unmapConfirm.description"),
      affirmativeText: t("common.yes"),
      negativeText: t("common.cancel"),
    });

    if (result) {
      await remapGame(null);
    }
  };

  const handleRecache = async () => {
    if (!currentShownMappedGame?.provider_data_id) return;
    await remapGame(currentShownMappedGame.provider_data_id);
  };

  const handleRemapToResult = async (providerDataId: string) => {
    await remapGame(providerDataId);
    setRemapSearchResults([]);
    setSearchQuery("");
  };

  useEffect(
    () => () => {
      revokeRef.current.forEach((u) => {
        try {
          URL.revokeObjectURL(u);
        } catch {}
      });
    },
    [],
  );

  const coverMediaId = workingGame.metadata?.cover?.id;
  const backgroundMediaId = workingGame.metadata?.background?.id;

  const fetchMediaBlobUrl = useCallback(
    async (id: number, slot?: GameMediaSlot): Promise<string | null> => {
      if (!serverUrl || !id) return null;
      try {
        const blob = await resolveApiMediaBlob({
          serverUrl,
          mediaId: id,
          authFetch,
          owner: slot ? { gameId: workingGame.id, slot } : undefined,
        });
        const url = URL.createObjectURL(blob);
        revokeRef.current.push(url);
        return url;
      } catch {
        return null;
      }
    },
    [serverUrl, authFetch, workingGame.id],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (coverMediaId && coverImg.original == null) {
        const url = await fetchMediaBlobUrl(Number(coverMediaId), "cover");
        if (!cancelled && url)
          setCoverImg((s) => ({
            ...s,
            preview: url,
            original: url,
            loadedId: Number(coverMediaId),
          }));
      }
      if (backgroundMediaId && bgImg.original == null) {
        const url = await fetchMediaBlobUrl(
          Number(backgroundMediaId),
          "background",
        );
        if (!cancelled && url)
          setBgImg((s) => ({
            ...s,
            preview: url,
            original: url,
            loadedId: Number(backgroundMediaId),
          }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    coverMediaId,
    backgroundMediaId,
    fetchMediaBlobUrl,
    coverImg.original,
    bgImg.original,
  ]);

  // Load game cover image for metadata tab
  useEffect(() => {
    let cancelled = false;
    const loadGameCover = async () => {
      if (workingGame.metadata?.cover?.id) {
        const url = await fetchMediaBlobUrl(
          Number(workingGame.metadata.cover.id),
          "cover",
        );
        if (!cancelled && url) {
          setGameCoverUrl(url);
        }
      }
    };
    loadGameCover();
    return () => {
      cancelled = true;
    };
  }, [workingGame.metadata?.cover?.id, fetchMediaBlobUrl]);

  // Load mapped game cover image for metadata tab
  useEffect(() => {
    let cancelled = false;
    const loadMappedCover = async () => {
      if (currentShownMappedGame?.cover?.id) {
        const url = await fetchMediaBlobUrl(
          Number(currentShownMappedGame.cover.id),
        );
        if (!cancelled && url) {
          setMappedGameCoverUrl(url);
        }
      } else {
        setMappedGameCoverUrl(null);
      }
    };
    loadMappedCover();
    return () => {
      cancelled = true;
    };
  }, [currentShownMappedGame?.cover?.id, fetchMediaBlobUrl]);

  const loadFile = (
    file: File,
    target: "cover" | "bg",
    via: ImageState["via"],
  ) => {
    if (!file.type.startsWith("image/")) return;
    const url = URL.createObjectURL(file);
    revokeRef.current.push(url);
    const update = { file, via, preview: url };
    if (target === "cover") setCoverImg((prev) => ({ ...prev, ...update }));
    else setBgImg((prev) => ({ ...prev, ...update }));
  };
  const loadUrl = (url: string, target: "cover" | "bg") => {
    if (!url.trim()) return;
    const safe = url.trim();
    const update = { file: null, via: "url" as const, preview: safe };
    if (target === "cover")
      setCoverImg((prev) => ({ ...prev, ...update, urlInput: safe }));
    else setBgImg((prev) => ({ ...prev, ...update, urlInput: safe }));
  };
  const handlePaste = (e: React.ClipboardEvent, target: "cover" | "bg") => {
    const items = e.clipboardData?.items;
    if (items) {
      for (const it of items) {
        if (it.kind === "file" && it.type.startsWith("image/")) {
          const f = it.getAsFile();
          if (f) {
            loadFile(f, target, "paste");
            e.preventDefault();
            return;
          }
        }
      }
    }
    const text = e.clipboardData?.getData("text");
    if (text && isProbablyImageUrl(text)) {
      loadUrl(text, target);
      e.preventDefault();
    }
  };
  const handleDrop = (e: React.DragEvent, target: "cover" | "bg") => {
    e.preventDefault();
    dragTargetRef.current = null;
    // In Tauri, external drags are handled by the native onDragDropEvent
    // listener; skip here so we don't double-load.
    if (isTauri && nativeDragHandledRef.current) return;
    const f = e.dataTransfer.files?.[0];
    if (f) {
      if (isTauri) nativeDragHandledRef.current = true;
      loadFile(f, target, "drag");
      return;
    }
    // Browser image drags expose multiple URLs (page URL first, image link
    // second) and `<img src>` in text/html — prefer the direct image link.
    const best = pickBestImageUrl(
      extractImageCandidatesFromDataTransfer(e.dataTransfer),
    );
    if (best && isProbablyImageUrl(best)) {
      loadUrl(best, target);
    }
  };
  const handleDragOver = (e: React.DragEvent, target: "cover" | "bg") => {
    e.preventDefault();
    dragTargetRef.current = target;
    nativeDragHandledRef.current = false;
  };
  const loadDroppedPath = async (paths: string[], target: "cover" | "bg") => {
    await applyDroppedSources(paths, {
      onUrl: (url) => loadUrl(url, target),
      onFile: (file) => {
        if (file.type.startsWith("image/")) loadFile(file, target, "drag");
      },
    });
  };
  const resolveDropTargetByPosition = (position: {
    x: number;
    y: number;
  }): "cover" | "bg" | null => {
    const dpr = window.devicePixelRatio || 1;
    const x = position.x / dpr;
    const y = position.y / dpr;
    for (const [ref, target] of [
      [coverZoneRef, "cover"],
      [bgZoneRef, "bg"],
    ] as const) {
      const el = ref.current;
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom)
        return target;
    }
    return null;
  };
  useEffect(() => {
    if (!isTauri) return;
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        unlisten = await getCurrentWindow().onDragDropEvent((event) => {
          const payload = event.payload;
          if (payload.type === "enter" || payload.type === "over") {
            nativeDragHandledRef.current = false;
            return;
          }
          if (payload.type !== "drop") return;
          const target =
            dragTargetRef.current ??
            resolveDropTargetByPosition(payload.position);
          const paths = payload.paths ?? [];
          if (!target || !paths.length) return;
          nativeDragHandledRef.current = true;
          void loadDroppedPath(paths, target);
        });
      } catch (err) {
        console.error("Failed to init native drag-drop listener:", err);
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTauri]);
  const coverFileInputRef = useRef<HTMLInputElement | null>(null);
  const bgFileInputRef = useRef<HTMLInputElement | null>(null);
  const imagesDirty =
    coverImg.preview !== coverImg.original || bgImg.preview !== bgImg.original;
  const obtainFileForState = async (
    state: ImageState,
    fallbackName: string,
  ): Promise<File | null> => {
    if (state.file) return state.file;
    if (state.via === "url" && state.preview) {
      try {
        if (isTauri) {
          const { invoke } = await import("@tauri-apps/api/core");
          const { base64ToBytes } = await import("@/utils/binary");
          const res = (await invoke("fetch_url_bytes", {
            url: state.preview,
          })) as { bytesBase64: string; content_type: string };
          const bytes = base64ToBytes(res.bytesBase64);
          const mime = res.content_type || "image/png";
          const ext = (mime.split("/")[1] || "png").replace(/[^a-z0-9]/gi, "");
          return new File([bytes], `${fallbackName}.${ext}`, { type: mime });
        }
        const r = await fetch(state.preview);
        if (!r.ok) throw new Error("url fetch failed");
        const b = await r.blob();
        const ext = (b.type && b.type.split("/")[1]) || "png";
        return new File([b], `${fallbackName}.${ext}`, {
          type: b.type || "image/png",
        });
      } catch {
        return null;
      }
    }
    return null;
  };
  const resolveImageFile = async (
    state: ImageState,
    fallbackName: string,
  ): Promise<File> => {
    const f = await obtainFileForState(state, fallbackName);
    if (!f) {
      throw new Error(t("gameEditor.images.urlDownloadFailed"));
    }
    return f;
  };
  const uploadImage = async (file: File): Promise<number> => {
    if (!serverUrl) throw new Error(t("gameEditor.error.noServerUrl"));
    const base = serverUrl.replace(/\/+$/, "");
    const formData = new FormData();
    formData.append("file", file, file.name);
    const res = await authFetch(`${base}/api/media`, {
      method: "POST",
      body: formData,
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(
        fillTemplate(t("gameEditor.images.uploadFailed"), {
          status: res.status,
          details: txt || res.statusText,
        }),
      );
    }
    const media = await res.json();
    const mid = media?.id ?? media?.ID;
    if (!mid) throw new Error(t("gameEditor.images.uploadMissingId"));
    return mid;
  };

  /** Address of an uploaded image on the connected server. */
  const mediaUrl = (id: number) => serverMediaAddress(serverUrl ?? "", id);

  /**
   * Custom screenshots are stored on the server: links to other sites are
   * downloaded and uploaded as images, so no external link is saved. A link
   * that cannot be stored stops the save instead of being kept.
   */
  const importScreenshots = async (urls: string[]): Promise<string[]> => {
    try {
      return await storeScreenshots(urls, {
        serverUrl: serverUrl ?? "",
        upload: uploadImage,
      });
    } catch (error) {
      if (!(error instanceof ScreenshotStoreError)) throw error;
      throw new Error(
        fillTemplate(t("gameEditor.custom.screenshotImportFailed"), {
          url: error.url,
        }),
      );
    }
  };

  const screenshotInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadingScreenshots, setUploadingScreenshots] = useState(false);
  const uploadScreenshotFiles = async (files: File[]) => {
    if (!files.length) return;
    setUploadingScreenshots(true);
    try {
      const added: string[] = [];
      for (const file of files) added.push(mediaUrl(await uploadImage(file)));
      setCustomMetadata((current) => {
        const existing = current.url_screenshots
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        return {
          ...current,
          url_screenshots: [...existing, ...added].join(", "),
        };
      });
    } catch (e: any) {
      await showAlert({
        title: t("gameEditor.custom.saveFailed"),
        description: e?.message || t("gameEditor.custom.saveFailedFallback"),
        affirmativeText: t("common.ok"),
      });
    } finally {
      setUploadingScreenshots(false);
      if (screenshotInputRef.current) screenshotInputRef.current.value = "";
    }
  };

  const saveImages = async () => {
    if (!imagesDirty || savingImages) return;
    setSavingImages(true);
    setImagesMsg(null);

    try {
      const newCover = coverImg.preview !== coverImg.original;
      const newBg = bgImg.preview !== bgImg.original;

      // Upload new images and get their IDs
      const coverId = newCover
        ? await uploadImage(await resolveImageFile(coverImg, "cover"))
        : undefined;
      const backgroundId = newBg
        ? await uploadImage(await resolveImageFile(bgImg, "background"))
        : undefined;

      // Update game with new media IDs
      if (coverId || backgroundId) {
        const base = serverUrl?.replace(/\/+$/, "");
        if (!base) throw new Error(t("gameEditor.error.missingServerUrl"));

        const updateGame: UpdateGameDto = {
          user_metadata: {},
        };

        if (coverId) updateGame.user_metadata!.cover = { id: coverId } as any;
        if (backgroundId)
          updateGame.user_metadata!.background = { id: backgroundId } as any;

        const res = await authFetch(`${base}/api/games/${workingGame.id}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(updateGame),
        });

        if (!res.ok) {
          const txt = await res.text();
          throw new Error(
            fillTemplate(t("gameEditor.images.gameUpdateFailed"), {
              status: res.status,
              details: txt || res.statusText,
            }),
          );
        }

        const updatedGame = await res.json();
        setFullGame(updatedGame);
        onGameUpdated?.(updatedGame);
        emitGameUpdated(updatedGame);
      }

      // Update local state to mark as saved
      setImagesMsg({ text: t("gameEditor.images.saved"), ok: true });
      if (newCover) {
        setCoverImg((s) => ({
          ...s,
          original: s.preview,
          via: "none",
          file: null,
          urlInput: "",
          loadedId: coverId ?? s.loadedId,
        }));
      }
      if (newBg) {
        setBgImg((s) => ({
          ...s,
          original: s.preview,
          via: "none",
          file: null,
          urlInput: "",
          loadedId: backgroundId ?? s.loadedId,
        }));
      }
    } catch (e: any) {
      setImagesMsg({
        text: e?.message || t("gameEditor.images.saveFailed"),
        ok: false,
      });
    } finally {
      setSavingImages(false);
    }
  };

  const applyWatermark = (field: keyof CustomMetadataForm) => {
    const metadata = workingGame.metadata as GameMetadataWithUmu | undefined;
    let value: any = "";

    switch (field) {
      case "title":
        value = metadata?.title || workingGame.title || "";
        break;
      case "sort_title":
        value = workingGame.sort_title || "";
        break;
      case "description":
        value = metadata?.description || "";
        break;
      case "notes":
        value = metadata?.notes || "";
        break;
      case "average_playtime":
        value = metadata?.average_playtime?.toString() || "";
        break;
      case "age_rating":
        value = metadata?.age_rating?.toString() || "";
        break;
      case "release_date":
        if (metadata?.release_date) {
          const date = new Date(metadata.release_date);
          value = date.toISOString().split("T")[0];
        } else if (workingGame.release_date) {
          const date = new Date(workingGame.release_date);
          value = date.toISOString().split("T")[0];
        }
        break;
      case "rating":
        value = metadata?.rating?.toString() || "";
        break;
      case "early_access":
        value =
          metadata?.early_access !== undefined
            ? metadata.early_access.toString()
            : workingGame.early_access !== undefined
              ? workingGame.early_access.toString()
              : "";
        break;
      case "launch_executable":
        value = metadata?.launch_executable || "";
        break;
      case "launch_parameters":
        value = metadata?.launch_parameters || "";
        break;
      case "installer_executable":
        value = metadata?.installer_executable || "";
        break;
      case "installer_parameters":
        value = metadata?.installer_parameters || "";
        break;
      case "uninstaller_executable":
        value = metadata?.uninstaller_executable || "";
        break;
      case "uninstaller_parameters":
        value = metadata?.uninstaller_parameters || "";
        break;
      case "umu_game_id":
        value = metadata?.umu_game_id || "";
        break;
      case "umu_store":
        value = metadata?.umu_store || "";
        break;
      case "umu_proton_path":
        value = metadata?.umu_proton_path || "";
        break;
      case "save_paths":
        value = metadataSavePaths(metadata).join("\n");
        break;
      case "url_websites":
        value = Array.isArray(metadata?.url_websites)
          ? metadata.url_websites.join(", ")
          : "";
        break;
      case "genres":
        value = Array.isArray(metadata?.genres)
          ? metadata.genres.map((g: any) => g.name || g).join(", ")
          : "";
        break;
      case "tags":
        value = Array.isArray(metadata?.tags)
          ? metadata.tags.map((t: any) => t.name || t).join(", ")
          : "";
        break;
      case "publishers":
        value = Array.isArray(metadata?.publishers)
          ? metadata.publishers.map((p: any) => p.name || p).join(", ")
          : "";
        break;
      case "developers":
        value = Array.isArray(metadata?.developers)
          ? metadata.developers.map((d: any) => d.name || d).join(", ")
          : "";
        break;
      case "url_trailers":
        value = Array.isArray(metadata?.url_trailers)
          ? metadata.url_trailers.join(", ")
          : "";
        break;
      case "url_gameplays":
        value = Array.isArray(metadata?.url_gameplays)
          ? metadata.url_gameplays.join(", ")
          : "";
        break;
      case "url_screenshots":
        value = Array.isArray(metadata?.url_screenshots)
          ? metadata.url_screenshots.join(", ")
          : "";
        break;
    }

    setCustomMetadata((prev) => ({ ...prev, [field]: value }));
  };

  const getWatermark = (field: keyof CustomMetadataForm): string => {
    const metadata = workingGame.metadata as GameMetadataWithUmu | undefined;

    switch (field) {
      case "title":
        return metadata?.title || workingGame.title || "";
      case "sort_title":
        return workingGame.sort_title || "";
      case "description":
        return metadata?.description || "";
      case "notes":
        return metadata?.notes || "";
      case "average_playtime":
        return metadata?.average_playtime?.toString() || "";
      case "age_rating":
        return metadata?.age_rating?.toString() || "";
      case "release_date":
        if (metadata?.release_date) {
          const date = new Date(metadata.release_date);
          return date.toISOString().split("T")[0];
        } else if (workingGame.release_date) {
          const date = new Date(workingGame.release_date);
          return date.toISOString().split("T")[0];
        }
        return "";
      case "rating":
        return metadata?.rating?.toString() || "";
      case "early_access":
        return metadata?.early_access !== undefined
          ? metadata.early_access
            ? "true"
            : "false"
          : workingGame.early_access !== undefined
            ? workingGame.early_access
              ? "true"
              : "false"
            : "";
      case "launch_executable":
        return metadata?.launch_executable || "";
      case "launch_parameters":
        return metadata?.launch_parameters || "";
      case "installer_executable":
        return metadata?.installer_executable || "";
      case "installer_parameters":
        return metadata?.installer_parameters || "";
      case "uninstaller_executable":
        return metadata?.uninstaller_executable || "";
      case "uninstaller_parameters":
        return metadata?.uninstaller_parameters || "";
      case "umu_game_id":
        return metadata?.umu_game_id || "";
      case "umu_store":
        return metadata?.umu_store || "";
      case "umu_proton_path":
        return metadata?.umu_proton_path || "";
      case "save_paths":
        return metadataSavePaths(metadata).join("\n");
      case "url_websites":
        return Array.isArray(metadata?.url_websites)
          ? metadata.url_websites.join(", ")
          : "";
      case "genres":
        return Array.isArray(metadata?.genres)
          ? metadata.genres.map((g: any) => g.name || g).join(", ")
          : "";
      case "tags":
        return Array.isArray(metadata?.tags)
          ? metadata.tags.map((t: any) => t.name || t).join(", ")
          : "";
      case "publishers":
        return Array.isArray(metadata?.publishers)
          ? metadata.publishers.map((p: any) => p.name || p).join(", ")
          : "";
      case "developers":
        return Array.isArray(metadata?.developers)
          ? metadata.developers.map((d: any) => d.name || d).join(", ")
          : "";
      case "url_trailers":
        return Array.isArray(metadata?.url_trailers)
          ? metadata.url_trailers.join(", ")
          : "";
      case "url_gameplays":
        return Array.isArray(metadata?.url_gameplays)
          ? metadata.url_gameplays.join(", ")
          : "";
      case "url_screenshots":
        return Array.isArray(metadata?.url_screenshots)
          ? metadata.url_screenshots.join(", ")
          : "";
      default:
        return "";
    }
  };

  const saveCustomMetadata = async () => {
    setSavingCustomMetadata(true);
    try {
      const base = serverUrl?.replace(/\/+$/, "");
      if (!base) throw new Error(t("gameEditor.error.missingServerUrl"));

      const updateDto: any = {};

      if (customMetadata.title) updateDto.title = customMetadata.title;
      if (customMetadata.sort_title)
        updateDto.sort_title = customMetadata.sort_title;
      if (customMetadata.description)
        updateDto.description = customMetadata.description;
      if (customMetadata.notes) updateDto.notes = customMetadata.notes;
      if (customMetadata.average_playtime)
        updateDto.average_playtime = Number(customMetadata.average_playtime);
      if (customMetadata.age_rating)
        updateDto.age_rating = Number(customMetadata.age_rating);
      if (customMetadata.release_date)
        updateDto.release_date = customMetadata.release_date;
      if (customMetadata.rating)
        updateDto.rating = Number(customMetadata.rating);
      if (customMetadata.early_access !== "")
        updateDto.early_access = customMetadata.early_access === "true";

      if (customMetadata.launch_executable)
        updateDto.launch_executable = customMetadata.launch_executable;
      if (customMetadata.launch_parameters)
        updateDto.launch_parameters = customMetadata.launch_parameters;
      if (customMetadata.installer_executable)
        updateDto.installer_executable = customMetadata.installer_executable;
      if (customMetadata.installer_parameters)
        updateDto.installer_parameters = customMetadata.installer_parameters;
      if (customMetadata.uninstaller_executable)
        updateDto.uninstaller_executable =
          customMetadata.uninstaller_executable;
      if (customMetadata.uninstaller_parameters)
        updateDto.uninstaller_parameters =
          customMetadata.uninstaller_parameters;
      if (customMetadata.umu_game_id)
        updateDto.umu_game_id = customMetadata.umu_game_id;
      if (customMetadata.umu_store)
        updateDto.umu_store = customMetadata.umu_store;
      if (customMetadata.umu_proton_path)
        updateDto.umu_proton_path = customMetadata.umu_proton_path;
      const savePaths = customMetadata.save_paths
        .split(/\r?\n/)
        .map((path) => path.trim())
        .filter(Boolean);
      // Like the other fields, an empty input keeps the current folders.
      if (savePaths.length) updateDto.save_paths = savePaths;

      if (customMetadata.url_websites)
        updateDto.url_websites = customMetadata.url_websites
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      if (customMetadata.genres)
        updateDto.genres = customMetadata.genres
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      if (customMetadata.tags)
        updateDto.tags = customMetadata.tags
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      if (customMetadata.publishers)
        updateDto.publishers = customMetadata.publishers
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      if (customMetadata.developers)
        updateDto.developers = customMetadata.developers
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      if (customMetadata.url_trailers)
        updateDto.url_trailers = customMetadata.url_trailers
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      if (customMetadata.url_gameplays)
        updateDto.url_gameplays = customMetadata.url_gameplays
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      if (customMetadata.url_screenshots)
        updateDto.url_screenshots = await importScreenshots(
          customMetadata.url_screenshots
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        );

      const payload: UpdateGameDto = {
        user_metadata: updateDto,
      };

      const res = await authFetch(`${base}/api/games/${workingGame.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const message = await getErrorMessage(
          res,
          t("gameEditor.custom.saveFailedFallback"),
        );
        throw new Error(message);
      }

      const updatedGame = await res.json();
      setFullGame(updatedGame);
      onGameUpdated?.(updatedGame);
      emitGameUpdated(updatedGame);

      await showAlert({
        title: t("gameEditor.success"),
        description: t("gameEditor.custom.saved"),
        affirmativeText: t("common.ok"),
      });

      // Reset form
      setCustomMetadata(getEmptyCustomMetadata());
    } catch (e: any) {
      await showAlert({
        title: t("gameEditor.custom.saveFailed"),
        description: e?.message || t("gameEditor.custom.saveFailedFallback"),
        affirmativeText: t("common.ok"),
      });
    } finally {
      setSavingCustomMetadata(false);
    }
  };

  const handleWipeCustomMetadata = async () => {
    const result = await showAlert({
      title: t("gameEditor.custom.wipeConfirm.title"),
      description: t("gameEditor.custom.wipeConfirm.description"),
      affirmativeText: t("common.yes"),
      negativeText: t("common.no"),
    });

    if (result) {
      setSaving(true);
      try {
        const base = serverUrl?.replace(/\/+$/, "");
        if (!base) throw new Error(t("gameEditor.error.missingServerUrl"));

        const updateGame: UpdateGameDto = {
          mapping_requests: [
            {
              provider_slug: "user",
              provider_priority: 0,
            },
          ],
        };

        const res = await authFetch(`${base}/api/games/${workingGame.id}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(updateGame),
        });

        if (!res.ok) {
          const message = await getErrorMessage(
            res,
            t("gameEditor.custom.wipeFailedFallback"),
          );
          throw new Error(message);
        }

        const updatedGame = await res.json();
        setFullGame(updatedGame);
        onGameUpdated?.(updatedGame);
        emitGameUpdated(updatedGame);

        await showAlert({
          title: t("gameEditor.success"),
          description: t("gameEditor.custom.wiped"),
          affirmativeText: t("common.ok"),
        });
      } catch (e: any) {
        await showAlert({
          title: t("gameEditor.custom.wipeFailed"),
          description: e?.message || t("gameEditor.custom.wipeFailedFallback"),
          affirmativeText: t("common.ok"),
        });
      } finally {
        setSaving(false);
      }
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      size="7xl"
      className="!max-w-[min(95vw,1200px)] sm:!max-w-[min(85vw,1200px)] !h-[min(90vh,900px)] !w-full flex flex-col"
    >
      <DialogTitle className="flex items-center justify-between gap-2 sm:gap-4 pb-1 flex-shrink-0">
        <span>{t("gameEditor.title")}</span>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-ps-line text-ps-muted hover:text-ps-text hover:bg-ps-panel-soft transition-colors"
          aria-label={t("common.close")}
          disabled={saving}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            stroke="currentColor"
            fill="none"
          >
            <path strokeWidth="2" strokeLinecap="round" d="M6 6 18 18" />
            <path strokeWidth="2" strokeLinecap="round" d="M18 6 6 18" />
          </svg>
        </button>
      </DialogTitle>

      {loadingFullGame ? (
        <div className="flex items-center justify-center p-8">
          <div className="text-sm text-fg-muted">
            {t("gameEditor.loadingGame")}
          </div>
        </div>
      ) : (
        <>
          {/* Vertical tab navigation layout */}
          <div className="flex flex-col sm:flex-row gap-0 flex-1 min-h-0">
            {/* Left sidebar - vertical tabs */}
            <div className="w-full sm:w-52 border-b sm:border-b-0 sm:border-r border-ps-line py-2 sm:py-4">
              <nav className="flex flex-row sm:flex-col gap-1 px-2 sm:px-3 overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                {(!isTauri || isOnline) && (
                  <>
                    <button
                      onClick={() => setActiveTab("images")}
                      className={
                        "flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2 sm:py-3 rounded-xl text-xs sm:text-sm font-medium transition-colors text-left whitespace-nowrap " +
                        (activeTab === "images"
                          ? "bg-ps-accent text-white"
                          : "text-ps-muted hover:bg-ps-panel-soft hover:text-ps-text")
                      }
                    >
                      <PhotoIcon className="w-5 h-5 flex-shrink-0" />
                      <span>{t("gameEditor.tabs.images")}</span>
                    </button>
                    <button
                      onClick={() => setActiveTab("metadata")}
                      className={
                        "flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2 sm:py-3 rounded-xl text-xs sm:text-sm font-medium transition-colors text-left whitespace-nowrap " +
                        (activeTab === "metadata"
                          ? "bg-ps-accent text-white"
                          : "text-ps-muted hover:bg-ps-panel-soft hover:text-ps-text")
                      }
                    >
                      <CircleStackIcon className="w-5 h-5 flex-shrink-0" />
                      <span>{t("gameEditor.tabs.metadata")}</span>
                    </button>
                    <button
                      onClick={() => setActiveTab("custom-metadata")}
                      className={
                        "flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2 sm:py-3 rounded-xl text-xs sm:text-sm font-medium transition-colors text-left whitespace-nowrap " +
                        (activeTab === "custom-metadata"
                          ? "bg-ps-accent text-white"
                          : "text-ps-muted hover:bg-ps-panel-soft hover:text-ps-text")
                      }
                    >
                      <PencilIcon className="w-5 h-5 flex-shrink-0" />
                      <span className="whitespace-nowrap">
                        {t("gameEditor.tabs.customMetadata")}
                      </span>
                    </button>
                    {isAdmin && (
                      <button
                        onClick={() => setActiveTab("game-files")}
                        className={
                          "flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2 sm:py-3 rounded-xl text-xs sm:text-sm font-medium transition-colors text-left whitespace-nowrap " +
                          (activeTab === "game-files"
                            ? "bg-ps-accent text-white"
                            : "text-ps-muted hover:bg-ps-panel-soft hover:text-ps-text")
                        }
                      >
                        <DocumentTextIcon className="w-5 h-5 flex-shrink-0" />
                        <span>{t("gameEditor.tabs.gameFiles")}</span>
                      </button>
                    )}
                  </>
                )}
                {installationTabsVisible && (
                  <>
                    <button
                      onClick={() => setActiveTab("installation")}
                      className={
                        "flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2 sm:py-3 rounded-xl text-xs sm:text-sm font-medium transition-colors text-left whitespace-nowrap " +
                        (activeTab === "installation"
                          ? "bg-ps-accent text-white"
                          : "text-ps-muted hover:bg-ps-panel-soft hover:text-ps-text")
                      }
                    >
                      <FolderOpenIcon className="w-5 h-5 flex-shrink-0" />
                      <span>{t("gameEditor.tabs.installation")}</span>
                    </button>
                    <button
                      onClick={() => setActiveTab("launch-options")}
                      className={
                        "flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2 sm:py-3 rounded-xl text-xs sm:text-sm font-medium transition-colors text-left whitespace-nowrap " +
                        (activeTab === "launch-options"
                          ? "bg-ps-accent text-white"
                          : "text-ps-muted hover:bg-ps-panel-soft hover:text-ps-text")
                      }
                    >
                      <SparklesIcon className="w-5 h-5 flex-shrink-0" />
                      <span>{t("gameEditor.tabs.launchOptions")}</span>
                    </button>
                  </>
                )}
              </nav>
            </div>

            {/* Right content area */}
            <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden">
              <DialogBody className="flex-1 px-6 py-4 overflow-y-auto overflow-x-hidden [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-ps-panel-strong [&::-webkit-scrollbar-thumb]:rounded-full">
                {activeTab === "images" && (
                  <div className="grid gap-6 md:gap-8 md:grid-cols-2">
                    {/* Cover zone */}
                    <div className="flex flex-col gap-4">
                      <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-[0.14em] text-ps-muted">
                        <span>{t("gameEditor.images.cover")}</span>
                        {coverImg.via !== "none" && (
                          <span className="rounded-full bg-ps-panel px-2 py-0.5 text-[10px] font-semibold text-ps-muted">
                            {t(IMAGE_SOURCE_LABELS[coverImg.via])}
                          </span>
                        )}
                      </div>

                      <div
                        ref={coverZoneRef}
                        onPaste={(e) => handlePaste(e, "cover")}
                        onDrop={(e) => handleDrop(e, "cover")}
                        onDragOver={(e) => handleDragOver(e, "cover")}
                        className="relative rounded-2xl border-2 border-dashed border-ps-line bg-ps-panel-soft h-56 flex items-center justify-center cursor-pointer overflow-hidden transition-colors hover:border-ps-accent/50 hover:bg-ps-panel"
                        onClick={() => coverFileInputRef.current?.click()}
                      >
                        {coverImg.preview ? (
                          <img
                            src={coverImg.preview}
                            alt={t("gameEditor.images.coverPreview")}
                            className="object-contain w-full h-full"
                            draggable={false}
                          />
                        ) : (
                          <div className="text-xs text-ps-muted text-center px-4">
                            {coverMediaId
                              ? t("common.loading")
                              : t("gameEditor.images.dropHint")}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <Input
                          type="text"
                          placeholder={t("gameEditor.images.urlPlaceholder")}
                          value={coverImg.urlInput}
                          onChange={(e) =>
                            setCoverImg((p) => ({
                              ...p,
                              urlInput: e.target.value,
                            }))
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && coverImg.urlInput.trim()) {
                              loadUrl(coverImg.urlInput, "cover");
                            }
                          }}
                          onPaste={(e) => {
                            const text = e.clipboardData?.getData("text");
                            if (text && isProbablyImageUrl(text)) {
                              loadUrl(text, "cover");
                              e.preventDefault();
                            }
                          }}
                        />
                        {coverImg.preview &&
                          coverImg.preview !== coverImg.original && (
                            <Button
                              color="rose"
                              type="button"
                              onClick={() =>
                                setCoverImg((p) => ({
                                  ...p,
                                  file: null,
                                  via: "none",
                                  preview: p.original,
                                  urlInput: "",
                                }))
                              }
                            >
                              {t("common.reset")}
                            </Button>
                          )}
                      </div>
                      <input
                        ref={coverFileInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) loadFile(f, "cover", "file");
                          e.target.value = "";
                        }}
                      />
                      <Button
                        type="button"
                        color="zinc"
                        onClick={() => void openImageSearch("Game Box Art")}
                        className="w-full"
                      >
                        <MagnifyingGlassIcon className="w-4 h-4" />
                        {t("gameEditor.images.find")}
                      </Button>
                      <ArtworkSearchButton
                        title={workingGame.title || "Game"}
                      />
                    </div>
                    {/* Background zone */}
                    <div className="flex flex-col gap-4">
                      <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-[0.14em] text-ps-muted">
                        <span>{t("gameEditor.images.background")}</span>
                        {bgImg.via !== "none" && (
                          <span className="rounded-full bg-ps-panel px-2 py-0.5 text-[10px] font-semibold text-ps-muted">
                            {t(IMAGE_SOURCE_LABELS[bgImg.via])}
                          </span>
                        )}
                      </div>

                      <div
                        ref={bgZoneRef}
                        onPaste={(e) => handlePaste(e, "bg")}
                        onDrop={(e) => handleDrop(e, "bg")}
                        onDragOver={(e) => handleDragOver(e, "bg")}
                        className="relative rounded-2xl border-2 border-dashed border-ps-line bg-ps-panel-soft h-56 flex items-center justify-center cursor-pointer overflow-hidden transition-colors hover:border-ps-accent/50 hover:bg-ps-panel"
                        onClick={() => bgFileInputRef.current?.click()}
                      >
                        {bgImg.preview ? (
                          <img
                            src={bgImg.preview}
                            alt={t("gameEditor.images.backgroundPreview")}
                            className="object-cover w-full h-full"
                            draggable={false}
                          />
                        ) : (
                          <div className="text-xs text-ps-muted text-center px-4">
                            {backgroundMediaId
                              ? t("common.loading")
                              : t("gameEditor.images.dropHint")}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        <Input
                          type="text"
                          placeholder={t("gameEditor.images.urlPlaceholder")}
                          value={bgImg.urlInput}
                          onChange={(e) =>
                            setBgImg((p) => ({
                              ...p,
                              urlInput: e.target.value,
                            }))
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && bgImg.urlInput.trim()) {
                              loadUrl(bgImg.urlInput, "bg");
                            }
                          }}
                          onPaste={(e) => {
                            const text = e.clipboardData?.getData("text");
                            if (text && isProbablyImageUrl(text)) {
                              loadUrl(text, "bg");
                              e.preventDefault();
                            }
                          }}
                        />
                        {bgImg.preview && bgImg.preview !== bgImg.original && (
                          <Button
                            color="rose"
                            type="button"
                            onClick={() =>
                              setBgImg((p) => ({
                                ...p,
                                file: null,
                                via: "none",
                                preview: p.original,
                                urlInput: "",
                              }))
                            }
                          >
                            {t("common.reset")}
                          </Button>
                        )}
                      </div>
                      <input
                        ref={bgFileInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) loadFile(f, "bg", "file");
                          e.target.value = "";
                        }}
                      />
                      <Button
                        type="button"
                        color="zinc"
                        onClick={() =>
                          void openImageSearch("Game Background Art")
                        }
                        className="w-full"
                      >
                        <MagnifyingGlassIcon className="w-4 h-4" />
                        {t("gameEditor.images.find")}
                      </Button>
                    </div>
                    {/* Save button for images tab */}
                    <div className="md:col-span-2 flex items-center gap-4 pt-2">
                      {imagesMsg && (
                        <Text
                          className={
                            "text-xs " +
                            (imagesMsg.ok
                              ? "text-emerald-400"
                              : "text-rose-400")
                          }
                        >
                          {imagesMsg.text}
                        </Text>
                      )}
                      <div className="flex-1" />
                      <Button
                        color="indigo"
                        disabled={!imagesDirty || savingImages}
                        onClick={saveImages}
                      >
                        {savingImages
                          ? t("gameEditor.images.saving")
                          : t("gameEditor.images.save")}
                      </Button>
                    </div>
                  </div>
                )}

                {activeTab === "metadata" && (
                  <div className="h-full flex flex-col overflow-hidden">
                    {loadingProviders ? (
                      <div className="flex items-center justify-center py-12">
                        <div className="text-sm text-ps-muted">
                          {t("gameEditor.metadata.loadingProviders")}
                        </div>
                      </div>
                    ) : metadataProviders.length === 0 ? (
                      <div className="flex items-center justify-center py-12">
                        <div className="text-sm text-ps-muted">
                          {t("gameEditor.metadata.noProviders")}
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col h-full overflow-hidden">
                        {/* Provider Selector */}
                        <div className="flex-shrink-0 flex gap-2 flex-wrap mb-4 pb-4 border-b border-ps-line">
                          {metadataProviders.map((provider, index) => {
                            const isMapped =
                              workingGame.provider_metadata?.some(
                                (meta) => meta.provider_slug === provider.slug,
                              );
                            return (
                              <button
                                key={provider.slug}
                                onClick={() =>
                                  setSelectedMetadataProviderIndex(index)
                                }
                                disabled={remapping}
                                className={
                                  "px-3 py-1.5 rounded-lg text-sm font-medium transition-all " +
                                  (selectedMetadataProviderIndex === index
                                    ? "bg-ps-accent text-white shadow-sm"
                                    : isMapped
                                      ? "bg-ps-panel-soft text-ps-text hover:bg-ps-panel"
                                      : "bg-ps-panel-soft text-ps-muted opacity-60 hover:opacity-100")
                                }
                              >
                                {provider.name} ({provider.priority})
                              </button>
                            );
                          })}
                        </div>

                        {/* Content Area with fixed sections */}
                        <div className="flex-1 flex flex-col gap-4 min-h-0 overflow-y-auto overflow-x-hidden pr-2 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-ps-panel-strong [&::-webkit-scrollbar-thumb]:rounded-full max-w-full">
                          {/* Comparison cards with separate action panel */}
                          <div className="grid grid-cols-1 gap-4 2xl:grid-cols-[minmax(0,1fr)_220px] shrink-0 w-full max-w-full">
                            <div className="space-y-4 min-w-0">
                              <div className="surface-panel-soft rounded-2xl p-4">
                                <div className="mb-4">
                                  <h4 className="text-base font-semibold text-ps-text">
                                    PlayStash
                                  </h4>
                                  <div className="text-xs text-ps-muted">
                                    {t("gameEditor.metadata.sourceDescription")}
                                  </div>
                                </div>

                                <div className="flex flex-col gap-4 lg:flex-row">
                                  {gameCoverUrl && (
                                    <div className="group/copy relative shrink-0 self-start rounded-lg overflow-hidden border border-ps-line">
                                      <CopyImageButton src={gameCoverUrl} />
                                      <img
                                        src={gameCoverUrl}
                                        alt={t("gameEditor.metadata.coverAlt")}
                                        className="w-32 h-44 object-cover"
                                        style={{ aspectRatio: "2/3" }}
                                        onError={(e) => {
                                          (
                                            e.target as HTMLImageElement
                                          ).style.display = "none";
                                        }}
                                      />
                                    </div>
                                  )}

                                  <div className="grid flex-1 gap-3 text-sm min-w-0 sm:grid-cols-2">
                                    <div className="sm:col-span-2">
                                      <div className="mb-1 text-ps-muted">
                                        {t("gameEditor.metadata.filePath")}
                                      </div>
                                      <div
                                        className="font-mono text-xs leading-relaxed text-ps-text break-all"
                                        title={
                                          workingGame.file_path ||
                                          t("gameEditor.notAvailable")
                                        }
                                      >
                                        {workingGame.file_path ||
                                          t("gameEditor.notAvailable")}
                                      </div>
                                    </div>
                                    <div>
                                      <div className="mb-1 text-ps-muted">
                                        {t("gameEditor.metadata.releaseDate")}
                                      </div>
                                      <div className="text-ps-text">
                                        {workingGame.release_date
                                          ? formatDate(workingGame.release_date)
                                          : t("gameEditor.notAvailable")}
                                      </div>
                                    </div>
                                    <div>
                                      <div className="mb-1 text-ps-muted">
                                        {t("gameEditor.metadata.added")}
                                      </div>
                                      <div className="text-ps-text">
                                        {formatDate(workingGame.created_at)}
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </div>

                              <div className="surface-panel-soft rounded-2xl p-4">
                                <div className="mb-4">
                                  <h4 className="text-base font-semibold text-ps-text">
                                    {t("gameEditor.metadata.mappedGame")}
                                  </h4>
                                  <div className="text-xs text-ps-muted">
                                    {t(
                                      "gameEditor.metadata.mappedGameDescription",
                                    )}
                                  </div>
                                </div>

                                {currentShownMappedGame ? (
                                  <div className="flex flex-col gap-4 lg:flex-row">
                                    {mappedGameCoverUrl && (
                                      <div className="group/copy relative shrink-0 self-start rounded-lg overflow-hidden border border-ps-line">
                                        <CopyImageButton
                                          src={mappedGameCoverUrl}
                                        />
                                        <img
                                          src={mappedGameCoverUrl}
                                          alt={t(
                                            "gameEditor.metadata.providerCoverAlt",
                                          )}
                                          className="w-32 h-44 object-cover"
                                          style={{ aspectRatio: "2/3" }}
                                          onError={(e) => {
                                            (
                                              e.target as HTMLImageElement
                                            ).style.display = "none";
                                          }}
                                        />
                                      </div>
                                    )}

                                    <div className="grid flex-1 gap-3 text-sm min-w-0 sm:grid-cols-2">
                                      <div className="sm:col-span-2">
                                        <div className="mb-1 text-ps-muted">
                                          {t("gameEditor.metadata.titleLabel")}
                                        </div>
                                        <div className="leading-relaxed text-ps-text">
                                          {currentShownMappedGame.title ||
                                            t("gameEditor.notAvailable")}
                                        </div>
                                      </div>
                                      <div>
                                        <div className="mb-1 text-ps-muted">
                                          {t("gameEditor.metadata.releaseDate")}
                                        </div>
                                        <div className="text-ps-text">
                                          {currentShownMappedGame.release_date
                                            ? formatDate(
                                                currentShownMappedGame.release_date,
                                              )
                                            : t("gameEditor.notAvailable")}
                                        </div>
                                      </div>
                                      <div>
                                        <div className="mb-1 text-ps-muted">
                                          {t("gameEditor.metadata.lastCached")}
                                        </div>
                                        <div className="text-ps-text">
                                          {currentShownMappedGame.updated_at
                                            ? formatDate(
                                                currentShownMappedGame.updated_at,
                                              )
                                            : t("gameEditor.notAvailable")}
                                        </div>
                                      </div>
                                      {currentShownMappedGame.provider_data_url && (
                                        <div className="sm:col-span-2">
                                          <a
                                            href={
                                              currentShownMappedGame.provider_data_url
                                            }
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-xs text-ps-accent hover:underline"
                                          >
                                            {fillTemplate(
                                              t("gameEditor.metadata.viewOn"),
                                              {
                                                provider:
                                                  metadataProviders[
                                                    selectedMetadataProviderIndex
                                                  ]?.name ?? "",
                                              },
                                            )}
                                          </a>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                ) : (
                                  <div className="flex min-h-24 items-center justify-center text-sm text-ps-muted">
                                    {t("gameEditor.metadata.notMapped")}
                                  </div>
                                )}
                              </div>
                            </div>

                            <div className="flex flex-col gap-4 surface-panel-soft rounded-2xl p-4 w-full max-w-full 2xl:max-w-none">
                              <div>
                                <h4 className="text-base font-semibold text-ps-text">
                                  {t("gameEditor.metadata.actions")}
                                </h4>
                                <div className="text-xs text-ps-muted">
                                  {t("gameEditor.metadata.actionsDescription")}
                                </div>
                              </div>

                              {currentShownMappedGame ? (
                                <div className="space-y-3 w-full max-w-full">
                                  <div className="w-full max-w-full">
                                    <label className="block text-xs font-medium text-ps-muted mb-2">
                                      {t("gameEditor.metadata.priority")}
                                    </label>
                                    <div className="flex gap-2 w-full max-w-full">
                                      <Input
                                        type="number"
                                        placeholder={`${currentShownMappedGame?.provider_priority ?? metadataProviders[selectedMetadataProviderIndex]?.priority ?? ""}`}
                                        value={customPriority}
                                        onChange={(e) =>
                                          setCustomPriority(e.target.value)
                                        }
                                        disabled={remapping}
                                        className="flex-1"
                                      />
                                      <Button
                                        color="indigo"
                                        onClick={handleSavePriority}
                                        disabled={!customPriority || remapping}
                                      >
                                        {t("common.save")}
                                      </Button>
                                    </div>
                                  </div>

                                  <Button
                                    color="amber"
                                    onClick={handleRecache}
                                    disabled={remapping}
                                    className="w-full"
                                  >
                                    <ArrowPathIcon className="w-4 h-4" />
                                    {t("gameEditor.metadata.recache")}
                                  </Button>
                                  <Button
                                    color="rose"
                                    onClick={handleUnmap}
                                    disabled={remapping}
                                    className="w-full"
                                  >
                                    <LinkSlashIcon className="w-4 h-4" />
                                    {t("gameEditor.metadata.unmap")}
                                  </Button>
                                </div>
                              ) : (
                                <div className="flex items-center justify-center flex-1 text-sm text-ps-muted text-center">
                                  {t("gameEditor.metadata.noActions")}
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Search & Remap Section - Full Width with own scrollbar */}
                          <div className="flex-1 min-h-[300px] flex flex-col space-y-4 pt-4 border-t border-ps-line min-w-0 max-w-full">
                            <div className="flex-shrink-0">
                              <h4 className="text-base font-semibold mb-3 text-ps-text">
                                {t("gameEditor.metadata.searchRemap")}
                              </h4>
                              <Input
                                type="text"
                                placeholder={fillTemplate(
                                  t("gameEditor.metadata.searchPlaceholder"),
                                  {
                                    provider:
                                      metadataProviders[
                                        selectedMetadataProviderIndex
                                      ]?.name ?? "",
                                  },
                                )}
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                disabled={remapping}
                              />
                            </div>

                            {searching && (
                              <div className="text-center py-4 text-sm text-ps-muted">
                                {t("gameEditor.metadata.searching")}
                              </div>
                            )}

                            {!searching && remapSearchResults.length > 0 && (
                              <div className="flex-1 overflow-y-auto space-y-2 pr-2 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-ps-line [&::-webkit-scrollbar-thumb]:rounded-full min-w-0">
                                {remapSearchResults.map((result, idx) => (
                                  <div
                                    key={idx}
                                    className="relative flex gap-3 p-3 rounded-lg border border-ps-line bg-ps-panel-soft min-w-0 max-w-full overflow-hidden"
                                  >
                                    {result.provider_data_id && (
                                      <div className="absolute top-2 right-2 text-[10px] text-ps-muted text-ps-muted font-mono bg-ps-panel-soft px-1.5 py-0.5 rounded z-10">
                                        ID: {result.provider_data_id}
                                      </div>
                                    )}
                                    {result.cover_url && (
                                      <img
                                        src={result.cover_url}
                                        alt={result.title}
                                        className="w-16 h-20 object-cover rounded flex-shrink-0"
                                        onError={(e) => {
                                          (
                                            e.target as HTMLImageElement
                                          ).style.display = "none";
                                        }}
                                      />
                                    )}
                                    <div className="flex-1 min-w-0 pr-20">
                                      <div className="font-medium text-sm text-ps-text truncate">
                                        {result.title ||
                                          t("gameEditor.metadata.untitled")}
                                      </div>
                                      {result.release_date && (
                                        <div className="text-xs text-ps-muted">
                                          {formatYear(result.release_date)}
                                        </div>
                                      )}
                                      {result.description && (
                                        <div className="text-xs text-ps-muted mt-1 line-clamp-2">
                                          {result.description}
                                        </div>
                                      )}
                                    </div>
                                    <div className="absolute right-2 top-1/2 -translate-y-1/2 mt-5 z-10">
                                      <Button
                                        color="indigo"
                                        onClick={() =>
                                          handleRemapToResult(
                                            result.provider_data_id,
                                          )
                                        }
                                        disabled={
                                          remapping || !result.provider_data_id
                                        }
                                      >
                                        {t("gameEditor.metadata.remap")}
                                      </Button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {activeTab === "custom-metadata" && (
                  <div className="flex flex-col h-full">
                    {/* Header - fixed */}
                    <div className="flex justify-between items-start mb-6">
                      <div>
                        <h3 className="text-lg font-semibold mb-4 text-ps-text">
                          {t("gameEditor.custom.heading")}
                        </h3>
                        <p className="text-sm text-ps-muted">
                          {t("gameEditor.custom.description")}
                        </p>
                      </div>
                      <Button
                        color="rose"
                        onClick={handleWipeCustomMetadata}
                        disabled={saving}
                      >
                        <PaintBrushIcon className="w-4 h-4" />
                        {t("gameEditor.custom.wipe")}
                      </Button>
                    </div>

                    {/* Scrollable content */}
                    <div className="flex-1 overflow-y-auto pr-2 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-ps-line [&::-webkit-scrollbar-thumb]:rounded-full">
                      <div className="space-y-4">
                        <LibraryMetadataSettings
                          game={workingGame}
                          onGameUpdated={(updated) => {
                            setFullGame(updated);
                            onGameUpdated?.(updated);
                          }}
                        />
                        {isAdmin && (
                          <GameAccessSettings
                            game={workingGame}
                            onGameUpdated={(updated) => {
                              setFullGame(updated);
                              onGameUpdated?.(updated);
                            }}
                          />
                        )}
                        {/* Title */}
                        <div>
                          <label className="block text-sm font-medium text-ps-muted mb-1">
                            {t("gameEditor.custom.title")}
                          </label>
                          <div className="relative">
                            <Input
                              type="text"
                              value={customMetadata.title}
                              onChange={(e) =>
                                setCustomMetadata({
                                  ...customMetadata,
                                  title: e.target.value,
                                })
                              }
                              placeholder={getWatermark("title")}
                              className="pr-10"
                            />
                            {getWatermark("title") && (
                              <button
                                type="button"
                                onClick={() => applyWatermark("title")}
                                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-ps-muted hover:text-ps-text"
                                title={t("gameEditor.custom.applyCurrent")}
                              >
                                <ArrowUturnLeftIcon className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Sort Title */}
                        <div>
                          <label className="block text-sm font-medium text-ps-muted mb-1">
                            {t("gameEditor.custom.sortTitle")}
                          </label>
                          <div className="relative">
                            <Input
                              type="text"
                              value={customMetadata.sort_title}
                              onChange={(e) =>
                                setCustomMetadata({
                                  ...customMetadata,
                                  sort_title: e.target.value,
                                })
                              }
                              placeholder={getWatermark("sort_title")}
                              className="pr-10"
                            />
                            {getWatermark("sort_title") && (
                              <button
                                type="button"
                                onClick={() => applyWatermark("sort_title")}
                                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-ps-muted hover:text-ps-text"
                                title={t("gameEditor.custom.applyCurrent")}
                              >
                                <ArrowUturnLeftIcon className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Description */}
                        <div>
                          <label className="block text-sm font-medium text-ps-muted mb-1">
                            {t("common.description")}
                          </label>
                          <div className="relative">
                            <textarea
                              value={customMetadata.description}
                              onChange={(e) =>
                                setCustomMetadata({
                                  ...customMetadata,
                                  description: e.target.value,
                                })
                              }
                              placeholder={getWatermark("description")}
                              rows={4}
                              className="w-full rounded-md border border-ps-line-strong bg-ps-panel px-3 py-2 text-sm text-ps-text placeholder:text-ps-muted focus:outline-none focus:ring-2 focus:ring-ps-accent-cool pr-10 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
                            />
                            {getWatermark("description") && (
                              <button
                                type="button"
                                onClick={() => applyWatermark("description")}
                                className="absolute right-2 top-2 p-1 text-ps-muted hover:text-ps-text"
                                title={t("gameEditor.custom.applyCurrent")}
                              >
                                <ArrowUturnLeftIcon className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Notes */}
                        <div>
                          <label className="block text-sm font-medium text-ps-muted mb-1">
                            {t("common.notes")}
                          </label>
                          <div className="relative">
                            <textarea
                              value={customMetadata.notes}
                              onChange={(e) =>
                                setCustomMetadata({
                                  ...customMetadata,
                                  notes: e.target.value,
                                })
                              }
                              placeholder={getWatermark("notes")}
                              rows={3}
                              className="w-full rounded-md border border-ps-line-strong bg-ps-panel px-3 py-2 text-sm text-ps-text placeholder:text-ps-muted focus:outline-none focus:ring-2 focus:ring-ps-accent-cool pr-10 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
                            />
                            {getWatermark("notes") && (
                              <button
                                type="button"
                                onClick={() => applyWatermark("notes")}
                                className="absolute right-2 top-2 p-1 text-ps-muted hover:text-ps-text"
                                title={t("gameEditor.custom.applyCurrent")}
                              >
                                <ArrowUturnLeftIcon className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          {/* Average Playtime */}
                          <div>
                            <label className="block text-sm font-medium text-ps-muted mb-1">
                              {t("gameEditor.custom.avgPlaytime")}
                            </label>
                            <div className="relative">
                              <Input
                                type="number"
                                value={customMetadata.average_playtime}
                                onChange={(e) =>
                                  setCustomMetadata({
                                    ...customMetadata,
                                    average_playtime: e.target.value,
                                  })
                                }
                                placeholder={getWatermark("average_playtime")}
                                className="pr-10"
                              />
                              {getWatermark("average_playtime") && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    applyWatermark("average_playtime")
                                  }
                                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-ps-muted hover:text-ps-text"
                                  title={t("gameEditor.custom.applyCurrent")}
                                >
                                  <ArrowUturnLeftIcon className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Age Rating */}
                          <div>
                            <label className="block text-sm font-medium text-ps-muted mb-1">
                              {t("gameEditor.custom.ageRating")}
                            </label>
                            <div className="relative">
                              <Input
                                type="number"
                                value={customMetadata.age_rating}
                                onChange={(e) =>
                                  setCustomMetadata({
                                    ...customMetadata,
                                    age_rating: e.target.value,
                                  })
                                }
                                placeholder={getWatermark("age_rating")}
                                className="pr-10"
                              />
                              {getWatermark("age_rating") && (
                                <button
                                  type="button"
                                  onClick={() => applyWatermark("age_rating")}
                                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-ps-muted hover:text-ps-text"
                                  title={t("gameEditor.custom.applyCurrent")}
                                >
                                  <ArrowUturnLeftIcon className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Release Date */}
                          <div>
                            <label className="block text-sm font-medium text-ps-muted mb-1">
                              {t("gameEditor.custom.releaseDate")}
                            </label>
                            <div className="relative">
                              <Input
                                type="date"
                                value={customMetadata.release_date}
                                onChange={(e) =>
                                  setCustomMetadata({
                                    ...customMetadata,
                                    release_date: e.target.value,
                                  })
                                }
                                placeholder={getWatermark("release_date")}
                                className="pr-10"
                              />
                              {getWatermark("release_date") && (
                                <button
                                  type="button"
                                  onClick={() => applyWatermark("release_date")}
                                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-ps-muted hover:text-ps-text"
                                  title={t("gameEditor.custom.applyCurrent")}
                                >
                                  <ArrowUturnLeftIcon className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                            {getWatermark("release_date") &&
                              !customMetadata.release_date && (
                                <p className="mt-1 text-xs text-ps-muted">
                                  {fillTemplate(
                                    t("gameEditor.custom.current"),
                                    {
                                      value: formatDate(
                                        getWatermark("release_date"),
                                      ),
                                    },
                                  )}
                                </p>
                              )}
                          </div>

                          {/* Rating */}
                          <div>
                            <label className="block text-sm font-medium text-ps-muted mb-1">
                              {t("gameEditor.custom.rating")}
                            </label>
                            <div className="relative">
                              <Input
                                type="number"
                                step="0.1"
                                value={customMetadata.rating}
                                onChange={(e) =>
                                  setCustomMetadata({
                                    ...customMetadata,
                                    rating: e.target.value,
                                  })
                                }
                                placeholder={getWatermark("rating")}
                                className="pr-10"
                              />
                              {getWatermark("rating") && (
                                <button
                                  type="button"
                                  onClick={() => applyWatermark("rating")}
                                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-ps-muted hover:text-ps-text"
                                  title={t("gameEditor.custom.applyCurrent")}
                                >
                                  <ArrowUturnLeftIcon className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Early Access */}
                        <div>
                          <label className="block text-sm font-medium text-ps-muted mb-1">
                            {t("gameEditor.custom.earlyAccess")}
                          </label>
                          <Listbox
                            value={customMetadata.early_access || null}
                            onChange={(value) =>
                              setCustomMetadata({
                                ...customMetadata,
                                early_access: value as string,
                              })
                            }
                            placeholder={
                              getWatermark("early_access")
                                ? fillTemplate(t("gameEditor.custom.current"), {
                                    value: t(
                                      getWatermark("early_access") === "true"
                                        ? "gameEditor.custom.true"
                                        : "gameEditor.custom.false",
                                    ),
                                  })
                                : t("gameEditor.custom.selectPlaceholder")
                            }
                          >
                            <ListboxOption value="true">
                              <ListboxLabel>
                                {t("gameEditor.custom.true")}
                              </ListboxLabel>
                            </ListboxOption>
                            <ListboxOption value="false">
                              <ListboxLabel>
                                {t("gameEditor.custom.false")}
                              </ListboxLabel>
                            </ListboxOption>
                          </Listbox>
                        </div>

                        {/* Launch Executable */}
                        <div>
                          <label className="block text-sm font-medium text-ps-muted mb-1">
                            {t("gameEditor.custom.launchExecutable")}
                          </label>
                          <div className="relative">
                            <Input
                              type="text"
                              value={customMetadata.launch_executable}
                              onChange={(e) =>
                                setCustomMetadata({
                                  ...customMetadata,
                                  launch_executable: e.target.value,
                                })
                              }
                              placeholder={getWatermark("launch_executable")}
                              className="pr-10"
                            />
                            {getWatermark("launch_executable") && (
                              <button
                                type="button"
                                onClick={() =>
                                  applyWatermark("launch_executable")
                                }
                                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-ps-muted hover:text-ps-text"
                                title={t("gameEditor.custom.applyCurrent")}
                              >
                                <ArrowUturnLeftIcon className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Launch Parameters */}
                        <div>
                          <label className="block text-sm font-medium text-ps-muted mb-1">
                            {t("gameEditor.custom.launchParameters")}
                          </label>
                          <div className="relative">
                            <Input
                              type="text"
                              value={customMetadata.launch_parameters}
                              onChange={(e) =>
                                setCustomMetadata({
                                  ...customMetadata,
                                  launch_parameters: e.target.value,
                                })
                              }
                              placeholder={getWatermark("launch_parameters")}
                              className="pr-10"
                            />
                            {getWatermark("launch_parameters") && (
                              <button
                                type="button"
                                onClick={() =>
                                  applyWatermark("launch_parameters")
                                }
                                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-ps-muted hover:text-ps-text"
                                title={t("gameEditor.custom.applyCurrent")}
                              >
                                <ArrowUturnLeftIcon className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* umu-launcher defaults (Linux) */}
                        <div className="rounded-lg border border-ps-line/60 p-3 space-y-4">
                          <p className="text-sm font-medium text-ps-text">
                            umu-launcher (Linux)
                          </p>
                          <p className="text-xs text-ps-muted">
                            {t("gameEditor.custom.umu.description")}
                          </p>

                          <div>
                            <label className="block text-sm font-medium text-ps-muted mb-1">
                              {t("gameEditor.custom.umu.gameId")}
                            </label>
                            <div className="relative">
                              <Input
                                type="text"
                                value={customMetadata.umu_game_id}
                                onChange={(e) =>
                                  setCustomMetadata({
                                    ...customMetadata,
                                    umu_game_id: e.target.value,
                                  })
                                }
                                placeholder={
                                  getWatermark("umu_game_id") || "umu-12345"
                                }
                                className="pr-10"
                              />
                              {getWatermark("umu_game_id") && (
                                <button
                                  type="button"
                                  onClick={() => applyWatermark("umu_game_id")}
                                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-ps-muted hover:text-ps-text"
                                  title={t("gameEditor.custom.applyCurrent")}
                                >
                                  <ArrowUturnLeftIcon className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          </div>

                          <div>
                            <label className="block text-sm font-medium text-ps-muted mb-1">
                              {t("gameEditor.custom.umu.store")}
                            </label>
                            <div className="relative">
                              <Input
                                type="text"
                                value={customMetadata.umu_store}
                                onChange={(e) =>
                                  setCustomMetadata({
                                    ...customMetadata,
                                    umu_store: e.target.value,
                                  })
                                }
                                placeholder={getWatermark("umu_store") || "egs"}
                                className="pr-10"
                              />
                              {getWatermark("umu_store") && (
                                <button
                                  type="button"
                                  onClick={() => applyWatermark("umu_store")}
                                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-ps-muted hover:text-ps-text"
                                  title={t("gameEditor.custom.applyCurrent")}
                                >
                                  <ArrowUturnLeftIcon className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          </div>

                          <div>
                            <label className="block text-sm font-medium text-ps-muted mb-1">
                              {t("gameEditor.custom.umu.protonPath")}
                            </label>
                            <div className="relative">
                              <Input
                                type="text"
                                value={customMetadata.umu_proton_path}
                                onChange={(e) =>
                                  setCustomMetadata({
                                    ...customMetadata,
                                    umu_proton_path: e.target.value,
                                  })
                                }
                                placeholder={
                                  getWatermark("umu_proton_path") ||
                                  "GE-Proton9-5"
                                }
                                className="pr-10"
                              />
                              {getWatermark("umu_proton_path") && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    applyWatermark("umu_proton_path")
                                  }
                                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-ps-muted hover:text-ps-text"
                                  title={t("gameEditor.custom.applyCurrent")}
                                >
                                  <ArrowUturnLeftIcon className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Save folders */}
                        <div>
                          <label className="block text-sm font-medium text-ps-muted mb-1">
                            {t("gameEditor.custom.savePaths")}
                          </label>
                          <div className="relative">
                            <textarea
                              value={customMetadata.save_paths}
                              onChange={(e) =>
                                setCustomMetadata({
                                  ...customMetadata,
                                  save_paths: e.target.value,
                                })
                              }
                              placeholder={
                                getWatermark("save_paths") ||
                                "%LOCALAPPDATALOW%/PinkySoul/ExquisiteFishing"
                              }
                              rows={2}
                              className="w-full rounded-md border border-ps-line-strong bg-ps-panel px-3 py-2 font-mono text-xs text-ps-text placeholder:text-ps-muted focus:outline-none focus:ring-2 focus:ring-ps-accent-cool pr-10"
                            />
                            {getWatermark("save_paths") && (
                              <button
                                type="button"
                                onClick={() => applyWatermark("save_paths")}
                                className="absolute right-2 top-2 p-1 text-ps-muted hover:text-ps-text"
                                title={t("gameEditor.custom.applyCurrent")}
                              >
                                <ArrowUturnLeftIcon className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                          <p className="mt-1 text-xs text-ps-muted">
                            {t("gameEditor.custom.savePathsHelp")}
                          </p>
                        </div>

                        {/* Installer Executable */}
                        <div>
                          <label className="block text-sm font-medium text-ps-muted mb-1">
                            {t("gameEditor.custom.installerExecutable")}
                          </label>
                          <div className="relative">
                            <Input
                              type="text"
                              value={customMetadata.installer_executable}
                              onChange={(e) =>
                                setCustomMetadata({
                                  ...customMetadata,
                                  installer_executable: e.target.value,
                                })
                              }
                              placeholder={getWatermark("installer_executable")}
                              className="pr-10"
                            />
                            {getWatermark("installer_executable") && (
                              <button
                                type="button"
                                onClick={() =>
                                  applyWatermark("installer_executable")
                                }
                                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-ps-muted hover:text-ps-text"
                                title={t("gameEditor.custom.applyCurrent")}
                              >
                                <ArrowUturnLeftIcon className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Installer Parameters */}
                        <div>
                          <label className="block text-sm font-medium text-ps-muted mb-1">
                            {t("gameEditor.custom.installerParameters")}
                          </label>
                          <div className="relative">
                            <Input
                              type="text"
                              value={customMetadata.installer_parameters}
                              onChange={(e) =>
                                setCustomMetadata({
                                  ...customMetadata,
                                  installer_parameters: e.target.value,
                                })
                              }
                              placeholder={getWatermark("installer_parameters")}
                              className="pr-10"
                            />
                            {getWatermark("installer_parameters") && (
                              <button
                                type="button"
                                onClick={() =>
                                  applyWatermark("installer_parameters")
                                }
                                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-ps-muted hover:text-ps-text"
                                title={t("gameEditor.custom.applyCurrent")}
                              >
                                <ArrowUturnLeftIcon className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Uninstaller Executable */}
                        <div>
                          <label className="block text-sm font-medium text-ps-muted mb-1">
                            {t("gameEditor.custom.uninstallerExecutable")}
                          </label>
                          <div className="relative">
                            <Input
                              type="text"
                              value={customMetadata.uninstaller_executable}
                              onChange={(e) =>
                                setCustomMetadata({
                                  ...customMetadata,
                                  uninstaller_executable: e.target.value,
                                })
                              }
                              placeholder={getWatermark(
                                "uninstaller_executable",
                              )}
                              className="pr-10"
                            />
                            {getWatermark("uninstaller_executable") && (
                              <button
                                type="button"
                                onClick={() =>
                                  applyWatermark("uninstaller_executable")
                                }
                                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-ps-muted hover:text-ps-text"
                                title={t("gameEditor.custom.applyCurrent")}
                              >
                                <ArrowUturnLeftIcon className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Uninstaller Parameters */}
                        <div>
                          <label className="block text-sm font-medium text-ps-muted mb-1">
                            {t("gameEditor.custom.uninstallerParameters")}
                          </label>
                          <div className="relative">
                            <Input
                              type="text"
                              value={customMetadata.uninstaller_parameters}
                              onChange={(e) =>
                                setCustomMetadata({
                                  ...customMetadata,
                                  uninstaller_parameters: e.target.value,
                                })
                              }
                              placeholder={getWatermark(
                                "uninstaller_parameters",
                              )}
                              className="pr-10"
                            />
                            {getWatermark("uninstaller_parameters") && (
                              <button
                                type="button"
                                onClick={() =>
                                  applyWatermark("uninstaller_parameters")
                                }
                                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-ps-muted hover:text-ps-text"
                                title={t("gameEditor.custom.applyCurrent")}
                              >
                                <ArrowUturnLeftIcon className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Website URLs */}
                        <div>
                          <label className="block text-sm font-medium text-ps-muted mb-1">
                            {t("gameEditor.custom.websiteUrls")}{" "}
                            <span className="text-xs text-ps-muted">
                              {t("gameEditor.custom.commaSeparated")}
                            </span>
                          </label>
                          <div className="relative">
                            <Input
                              type="text"
                              value={customMetadata.url_websites}
                              onChange={(e) =>
                                setCustomMetadata({
                                  ...customMetadata,
                                  url_websites: e.target.value,
                                })
                              }
                              placeholder={getWatermark("url_websites")}
                              className="pr-10"
                            />
                            {getWatermark("url_websites") && (
                              <button
                                type="button"
                                onClick={() => applyWatermark("url_websites")}
                                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-ps-muted hover:text-ps-text"
                                title={t("gameEditor.custom.applyCurrent")}
                              >
                                <ArrowUturnLeftIcon className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Genres */}
                        <div>
                          <label className="block text-sm font-medium text-ps-muted mb-1">
                            {t("common.genres")}{" "}
                            <span className="text-xs text-ps-muted">
                              {t("gameEditor.custom.commaSeparated")}
                            </span>
                          </label>
                          <div className="relative">
                            <Input
                              type="text"
                              value={customMetadata.genres}
                              onChange={(e) =>
                                setCustomMetadata({
                                  ...customMetadata,
                                  genres: e.target.value,
                                })
                              }
                              placeholder={getWatermark("genres")}
                              className="pr-10"
                            />
                            {getWatermark("genres") && (
                              <button
                                type="button"
                                onClick={() => applyWatermark("genres")}
                                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-ps-muted hover:text-ps-text"
                                title={t("gameEditor.custom.applyCurrent")}
                              >
                                <ArrowUturnLeftIcon className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Tags */}
                        <div>
                          <label className="block text-sm font-medium text-ps-muted mb-1">
                            {t("common.tags")}{" "}
                            <span className="text-xs text-ps-muted">
                              {t("gameEditor.custom.commaSeparated")}
                            </span>
                          </label>
                          <div className="relative">
                            <Input
                              type="text"
                              value={customMetadata.tags}
                              onChange={(e) =>
                                setCustomMetadata({
                                  ...customMetadata,
                                  tags: e.target.value,
                                })
                              }
                              placeholder={getWatermark("tags")}
                              className="pr-10"
                            />
                            {getWatermark("tags") && (
                              <button
                                type="button"
                                onClick={() => applyWatermark("tags")}
                                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-ps-muted hover:text-ps-text"
                                title={t("gameEditor.custom.applyCurrent")}
                              >
                                <ArrowUturnLeftIcon className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Publishers */}
                        <div>
                          <label className="block text-sm font-medium text-ps-muted mb-1">
                            {t("gameEditor.custom.publishers")}{" "}
                            <span className="text-xs text-ps-muted">
                              {t("gameEditor.custom.commaSeparated")}
                            </span>
                          </label>
                          <div className="relative">
                            <Input
                              type="text"
                              value={customMetadata.publishers}
                              onChange={(e) =>
                                setCustomMetadata({
                                  ...customMetadata,
                                  publishers: e.target.value,
                                })
                              }
                              placeholder={getWatermark("publishers")}
                              className="pr-10"
                            />
                            {getWatermark("publishers") && (
                              <button
                                type="button"
                                onClick={() => applyWatermark("publishers")}
                                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-ps-muted hover:text-ps-text"
                                title={t("gameEditor.custom.applyCurrent")}
                              >
                                <ArrowUturnLeftIcon className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Developers */}
                        <div>
                          <label className="block text-sm font-medium text-ps-muted mb-1">
                            {t("gameEditor.custom.developers")}{" "}
                            <span className="text-xs text-ps-muted">
                              {t("gameEditor.custom.commaSeparated")}
                            </span>
                          </label>
                          <div className="relative">
                            <Input
                              type="text"
                              value={customMetadata.developers}
                              onChange={(e) =>
                                setCustomMetadata({
                                  ...customMetadata,
                                  developers: e.target.value,
                                })
                              }
                              placeholder={getWatermark("developers")}
                              className="pr-10"
                            />
                            {getWatermark("developers") && (
                              <button
                                type="button"
                                onClick={() => applyWatermark("developers")}
                                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-ps-muted hover:text-ps-text"
                                title={t("gameEditor.custom.applyCurrent")}
                              >
                                <ArrowUturnLeftIcon className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Trailer URLs */}
                        <div>
                          <label className="block text-sm font-medium text-ps-muted mb-1">
                            {t("gameEditor.custom.trailerUrls")}{" "}
                            <span className="text-xs text-ps-muted">
                              {t("gameEditor.custom.commaSeparated")}
                            </span>
                          </label>
                          <div className="relative">
                            <Input
                              type="text"
                              value={customMetadata.url_trailers}
                              onChange={(e) =>
                                setCustomMetadata({
                                  ...customMetadata,
                                  url_trailers: e.target.value,
                                })
                              }
                              placeholder={getWatermark("url_trailers")}
                              className="pr-10"
                            />
                            {getWatermark("url_trailers") && (
                              <button
                                type="button"
                                onClick={() => applyWatermark("url_trailers")}
                                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-ps-muted hover:text-ps-text"
                                title={t("gameEditor.custom.applyCurrent")}
                              >
                                <ArrowUturnLeftIcon className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Gameplay URLs */}
                        <div>
                          <label className="block text-sm font-medium text-ps-muted mb-1">
                            {t("gameEditor.custom.gameplayUrls")}{" "}
                            <span className="text-xs text-ps-muted">
                              {t("gameEditor.custom.commaSeparated")}
                            </span>
                          </label>
                          <div className="relative">
                            <Input
                              type="text"
                              value={customMetadata.url_gameplays}
                              onChange={(e) =>
                                setCustomMetadata({
                                  ...customMetadata,
                                  url_gameplays: e.target.value,
                                })
                              }
                              placeholder={getWatermark("url_gameplays")}
                              className="pr-10"
                            />
                            {getWatermark("url_gameplays") && (
                              <button
                                type="button"
                                onClick={() => applyWatermark("url_gameplays")}
                                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-ps-muted hover:text-ps-text"
                                title={t("gameEditor.custom.applyCurrent")}
                              >
                                <ArrowUturnLeftIcon className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Screenshot URLs */}
                        <div>
                          <label className="block text-sm font-medium text-ps-muted mb-1">
                            {t("gameEditor.custom.screenshotUrls")}{" "}
                            <span className="text-xs text-ps-muted">
                              {t("gameEditor.custom.commaSeparated")}
                            </span>
                          </label>
                          <div className="relative">
                            <Input
                              type="text"
                              value={customMetadata.url_screenshots}
                              onChange={(e) =>
                                setCustomMetadata({
                                  ...customMetadata,
                                  url_screenshots: e.target.value,
                                })
                              }
                              placeholder={getWatermark("url_screenshots")}
                              className="pr-10"
                            />
                            {getWatermark("url_screenshots") && (
                              <button
                                type="button"
                                onClick={() =>
                                  applyWatermark("url_screenshots")
                                }
                                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-ps-muted hover:text-ps-text"
                                title={t("gameEditor.custom.applyCurrent")}
                              >
                                <ArrowUturnLeftIcon className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-3">
                            <input
                              ref={screenshotInputRef}
                              type="file"
                              accept="image/*"
                              multiple
                              hidden
                              onChange={(e) =>
                                void uploadScreenshotFiles(
                                  Array.from(e.target.files ?? []),
                                )
                              }
                            />
                            <Button
                              outline
                              type="button"
                              disabled={uploadingScreenshots}
                              onClick={() =>
                                screenshotInputRef.current?.click()
                              }
                            >
                              {uploadingScreenshots
                                ? t("gameEditor.custom.uploadingScreenshots")
                                : t("gameEditor.custom.uploadScreenshots")}
                            </Button>
                            <span className="text-xs text-ps-muted">
                              {t("gameEditor.custom.screenshotsStoredHint")}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Fixed save button at bottom */}
                    <div className="flex justify-end pt-4 mt-4">
                      <Button
                        color="indigo"
                        onClick={saveCustomMetadata}
                        disabled={savingCustomMetadata}
                      >
                        {savingCustomMetadata
                          ? t("gameEditor.custom.saving")
                          : t("gameEditor.custom.save")}
                      </Button>
                    </div>
                  </div>
                )}

                {activeTab === "installation" && installedGame && (
                  <InstallationTab
                    installedGame={installedGame}
                    game={workingGame}
                    onUninstalled={() => void handleUninstalled()}
                  />
                )}

                {activeTab === "launch-options" && installedGame && (
                  <LaunchOptionsTab
                    installedGame={installedGame}
                    game={workingGame}
                  />
                )}

                {activeTab === "game-files" && isAdmin && (
                  <div className="max-w-3xl space-y-6">
                    <div>
                      <h3 className="text-lg font-semibold text-ps-text">
                        {t("gameEditor.files.heading")}
                      </h3>
                      <p className="mt-1 text-sm text-ps-muted">
                        {t("gameEditor.files.description")}
                      </p>
                    </div>

                    {!workingGame.versions ||
                    workingGame.versions.length === 0 ? (
                      <div className="rounded-xl border border-ps-line bg-ps-panel-soft p-6 text-center text-sm text-ps-muted">
                        {t("gameEditor.files.empty")}
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {[...workingGame.versions]
                          .sort(
                            (a, b) =>
                              new Date(b.indexed_at).getTime() -
                              new Date(a.indexed_at).getTime(),
                          )
                          .map((version) => {
                            const versionLabel =
                              version.version ||
                              t("gameEditor.files.unspecified");
                            const isDeleting = deletingVersionId === version.id;
                            const bytes = Number(version.size);
                            const fileSize = Number.isFinite(bytes)
                              ? formatBytes(bytes)
                              : t("common.unknown");
                            const filePath = version.file_path || "";
                            const gameType = version.type
                              ? version.type
                                  .replace(/_/g, " ")
                                  .toLowerCase()
                                  .replace(/\b\w/g, (c) => c.toUpperCase())
                              : t("gameEditor.files.undetectable");
                            const indexedAt = (() => {
                              const d = new Date(version.indexed_at);
                              return Number.isNaN(d.getTime())
                                ? "-"
                                : d.toLocaleString();
                            })();

                            return (
                              <div
                                key={version.id}
                                className="rounded-xl border border-ps-line bg-ps-panel-soft p-4"
                              >
                                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                  <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="font-medium text-ps-text">
                                        {versionLabel}
                                      </span>
                                      {version.early_access && (
                                        <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-300">
                                          {t("gameEditor.files.earlyAccess")}
                                        </span>
                                      )}
                                    </div>
                                    <div
                                      className="mt-1 break-all font-mono text-xs text-ps-muted"
                                      title={filePath}
                                    >
                                      {filePath}
                                    </div>
                                  </div>
                                  <Button
                                    color="rose"
                                    onClick={() =>
                                      void handleDeleteGameVersion(version)
                                    }
                                    disabled={
                                      isDeleting || deletingVersionId !== null
                                    }
                                    aria-label={fillTemplate(
                                      t("gameEditor.files.deleteAria"),
                                      {
                                        version: versionLabel,
                                      },
                                    )}
                                  >
                                    <TrashIcon className="w-4 h-4" />
                                    {isDeleting
                                      ? t("gameEditor.files.deleting")
                                      : t("common.delete")}
                                  </Button>
                                </div>

                                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 border-t border-ps-line pt-3 text-xs sm:grid-cols-3">
                                  <div>
                                    <dt className="text-ps-muted">
                                      {t("common.size")}
                                    </dt>
                                    <dd className="mt-0.5 text-ps-text">
                                      {fileSize}
                                    </dd>
                                  </div>
                                  <div>
                                    <dt className="text-ps-muted">
                                      {t("gameEditor.files.type")}
                                    </dt>
                                    <dd className="mt-0.5 text-ps-text">
                                      {gameType}
                                    </dd>
                                  </div>
                                  <div>
                                    <dt className="text-ps-muted">
                                      {t("gameEditor.files.added")}
                                    </dt>
                                    <dd className="mt-0.5 text-ps-text">
                                      {indexedAt}
                                    </dd>
                                  </div>
                                </dl>
                              </div>
                            );
                          })}
                      </div>
                    )}
                  </div>
                )}
              </DialogBody>
            </div>
          </div>

          {/* Bottom left info */}
          <div className="absolute bottom-4 left-4 text-xs text-ps-muted flex flex-row gap-4 lg:flex-col lg:gap-0 lg:space-y-0.5">
            <div className="truncate max-w-[200px] lg:max-w-none">
              {workingGame.metadata?.title ||
                workingGame.title ||
                t("common.unknown")}
            </div>
            <div>
              {fillTemplate(t("gameEditor.footer.id"), { id: workingGame.id })}
            </div>
            <div>
              {fillTemplate(t("gameEditor.footer.latestVersion"), {
                version:
                  workingGame.versions?.[0]?.version ||
                  workingGame.version ||
                  t("gameEditor.notAvailable"),
              })}
            </div>
            {installedGame && (
              <div>
                {fillTemplate(t("gameEditor.footer.installedVersion"), {
                  version:
                    installedGame.versionName || t("gameEditor.notAvailable"),
                })}
              </div>
            )}
          </div>
        </>
      )}
    </Dialog>
  );
}
