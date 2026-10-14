import { createElement, useEffect, useRef } from "react";
import { useAuth } from "@/context/AuthContext";
import { useDownloads } from "@/context/DownloadContext";
import { useOnlineStatus } from "@/context/OfflineContext";
import {
  useInstalledGames,
  type InstalledGameInfo,
} from "@/hooks/useInstalledGames";
import { onGameDeleted } from "@/utils/gameUpdates";
import { useIntegrationsSettings } from "@/utils/integrationsSettings";
import { getServerNamespace, resolveApiMediaBlob } from "@/utils/mediaCache";
import {
  newestInstalledVersions,
  resolveLaunchTarget,
  steamShortcutSignature,
  toSteamShortcutGame,
  type SteamShortcutGame,
} from "@/utils/steamShortcuts";
import { isTauriApp } from "@/utils/tauri";

/** Wait before a sync so bursts of changes write `shortcuts.vdf` once. */
export const STEAM_SYNC_DEBOUNCE_MS = 2_000;
/** Rescan interval, picks up launch executable/parameter edits. */
const RESCAN_INTERVAL_MS = 60_000;

function isWindowsPlatform(): boolean {
  return (
    typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent)
  );
}

async function readVersionConfig(
  versionDirectory: string,
): Promise<Record<string, any> | null> {
  const { invoke } = await import("@tauri-apps/api/core");
  const { join } = await import("@tauri-apps/api/path");
  const path = await join(versionDirectory, ".playstash.game.config.json");
  if (!(await invoke<boolean>("fs_path_exists", { path }))) return null;
  try {
    return JSON.parse(await invoke<string>("fs_read_text_file", { path }));
  } catch {
    return null;
  }
}

/** Builds the shortcut list from the newest installed version of each game. */
export async function buildSteamShortcutGames(
  installed: InstalledGameInfo[],
): Promise<SteamShortcutGame[]> {
  const { join } = await import("@tauri-apps/api/path");
  const isWindows = isWindowsPlatform();
  const games: SteamShortcutGame[] = [];
  for (const info of newestInstalledVersions(installed)) {
    try {
      const config = await readVersionConfig(info.versionDirectory);
      const target = resolveLaunchTarget(config, info);
      if (!target || !info.installationDirectory) continue;
      const exe =
        target.kind === "emulator"
          ? target.exe
          : await join(
              info.installationDirectory,
              ...target.relativeExe.split(/[\\/]+/).filter(Boolean),
            );
      const game = toSteamShortcutGame(info, config, target, exe, isWindows);
      if (game) games.push(game);
    } catch {
      // Skip games whose configuration cannot be read.
    }
  }
  return games;
}

/** Downloads covers/backgrounds that are not in the offline cache yet. */
async function ensureArtwork(
  games: SteamShortcutGame[],
  serverUrl: string,
  authFetch: (input: string, init?: RequestInit) => Promise<Response>,
): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  const serverNamespace = getServerNamespace(serverUrl);
  const owners = new Map<
    number,
    { gameId: number; slot: "cover" | "background" }
  >();
  for (const game of games) {
    if (game.coverMediaId)
      owners.set(game.coverMediaId, { gameId: game.gameId, slot: "cover" });
    if (game.heroMediaId)
      owners.set(game.heroMediaId, { gameId: game.gameId, slot: "background" });
  }
  if (!owners.size) return;
  const missing = await invoke<number[]>("steam_missing_cached_media", {
    serverNamespace,
    mediaIds: [...owners.keys()],
  });
  const { blobToBase64 } = await import("@/utils/binary");
  for (const mediaId of missing) {
    try {
      const blob = await resolveApiMediaBlob({
        serverUrl,
        mediaId,
        authFetch,
        owner: owners.get(mediaId)!,
      });
      await invoke("cache_game_image", {
        serverNamespace,
        mediaId,
        dataBase64: await blobToBase64(blob),
        contentType: blob.type || "image/png",
      });
    } catch {
      // The shortcut works without artwork.
    }
  }
}

/**
 * Keeps Steam's non-Steam shortcuts in sync with the installed games while
 * the setting is on: on start, when installs finish or are removed, and when
 * launch executables or parameters change (debounced 2 s).
 */
export function useSteamShortcutSync(): void {
  const { installedGames, loading, refetch } = useInstalledGames();
  const { serverUrl, authFetch } = useAuth();
  const { isOnline } = useOnlineStatus();
  const { downloads } = useDownloads();
  const lastSynced = useRef<string | null>(null);
  const contextRef = useRef({ serverUrl, authFetch, isOnline });
  contextRef.current = { serverUrl, authFetch, isOnline };

  // Rescan when downloads/extractions/installations change state.
  const downloadSignature = Object.values(downloads)
    .map(
      (download) =>
        `${download.gameId}:${download.status}:${download.extractionStatus ?? ""}:${download.installationStatus ?? ""}`,
    )
    .sort()
    .join("|");
  const firstSignature = useRef(downloadSignature);
  useEffect(() => {
    if (firstSignature.current === downloadSignature) return;
    firstSignature.current = downloadSignature;
    const timer = setTimeout(() => void refetch(), STEAM_SYNC_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [downloadSignature, refetch]);

  useEffect(() => {
    const interval = setInterval(() => void refetch(), RESCAN_INTERVAL_MS);
    const onFocus = () => void refetch();
    window.addEventListener("focus", onFocus);
    const offDeleted = onGameDeleted(() => void refetch());
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      offDeleted();
    };
  }, [refetch]);

  useEffect(() => {
    if (loading) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        const games = await buildSteamShortcutGames(installedGames);
        const signature = steamShortcutSignature(games);
        if (cancelled || signature === lastSynced.current) return;
        const { serverUrl, authFetch, isOnline } = contextRef.current;
        if (isOnline && serverUrl)
          await ensureArtwork(games, serverUrl, authFetch).catch(() => {});
        if (cancelled) return;
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("steam_sync_shortcuts", {
          serverNamespace: serverUrl ? getServerNamespace(serverUrl) : null,
          games,
        });
        lastSynced.current = signature;
      })().catch((error) => console.warn("Steam shortcut sync failed:", error));
    }, STEAM_SYNC_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [installedGames, loading]);
}

function SteamShortcutSyncRunner(): null {
  useSteamShortcutSync();
  return null;
}

/**
 * Effect-only component for `DesktopProviders`. The runner (and its disk
 * scans) only mounts while the setting is on and a user is signed in.
 */
export function SteamShortcutSyncEffect() {
  const { user } = useAuth();
  const { settings, loaded } = useIntegrationsSettings();
  const enabled =
    isTauriApp() && loaded && settings.syncSteamShortcuts && !!user;
  return enabled ? createElement(SteamShortcutSyncRunner) : null;
}
