import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "@/context/AuthContext";
import { useOnlineStatus } from "@/context/OfflineContext";
import { useDownloads } from "@/context/DownloadContext";
import { useAlertDialog } from "@/context/AlertDialogContext";
import { RootPathSelectDialog } from "@/components/RootPathSelectDialog";
import { VersionSelectDialog } from "@/components/VersionSelectDialog";
import { confirmPipeline } from "./PipelineDialogs";
import {
  registerDownloadFlowHost,
  type DownloadFlowHost as FlowHost,
} from "@/utils/downloadFlow";
import type { GameVersion } from "@/api/models/GameVersion";
import type { PlaystashGame } from "@/api/models/PlaystashGame";
import type { RootPathEntry } from "@/utils/rootPaths";

type RootRequest = {
  gameTitle: string;
  roots: RootPathEntry[];
  preselectId: string | null;
  resolve: (value: RootPathEntry | "settings" | null) => void;
};

type VersionRequest = {
  gameTitle: string;
  versions: GameVersion[];
  resolve: (value: GameVersion | null) => void;
};

async function invokeOrNull<T>(
  command: string,
  args: Record<string, unknown>,
): Promise<T | null> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<T>(command, args);
  } catch {
    return null;
  }
}

/**
 * Connects {@link requestGameDownload} to the running app: auth, the download
 * context, dialogs and navigation. Mounted once inside the router (entry in
 * `DesktopProviders`).
 */
export function DownloadFlowHost() {
  const { serverUrl, auth, authFetch } = useAuth();
  const { isOnline } = useOnlineStatus();
  const { downloads, startDownload, deleteDownloadCard } = useDownloads();
  const { showAlert } = useAlertDialog();
  const navigate = useNavigate();
  const [rootRequest, setRootRequest] = useState<RootRequest | null>(null);
  const [versionRequest, setVersionRequest] = useState<VersionRequest | null>(
    null,
  );

  // The host object is registered once; it always reads the latest values.
  const latest = useRef({
    serverUrl,
    auth,
    authFetch,
    isOnline,
    downloads,
    startDownload,
    deleteDownloadCard,
    showAlert,
    navigate,
  });
  latest.current = {
    serverUrl,
    auth,
    authFetch,
    isOnline,
    downloads,
    startDownload,
    deleteDownloadCard,
    showAlert,
    navigate,
  };

  useEffect(() => {
    const host: FlowHost = {
      isReady: () => {
        const current = latest.current;
        return (
          current.isOnline &&
          !!current.serverUrl &&
          !!current.auth?.access_token
        );
      },
      fetchGame: async (gameId) => {
        const current = latest.current;
        const base = current.serverUrl.replace(/\/+$/, "");
        const response = await current.authFetch(`${base}/api/games/${gameId}`);
        if (!response.ok) return null;
        return (await response.json()) as PlaystashGame;
      },
      getDownloads: () => latest.current.downloads,
      startDownload: (request) => latest.current.startDownload(request),
      deleteDownloadCard: (gameId) => latest.current.deleteDownloadCard(gameId),
      toast: (title) => {
        void latest.current.showAlert({ title });
      },
      confirm: ({ title, message, confirmText, cancelText }) =>
        confirmPipeline({ title, message, confirmText, cancelText }),
      pickRoot: (options) =>
        new Promise((resolve) => setRootRequest({ ...options, resolve })),
      pickVersion: (options) =>
        new Promise((resolve) => setVersionRequest({ ...options, resolve })),
      navigate: (path) => latest.current.navigate(path),
      pathExists: (path) => invokeOrNull<boolean>("fs_path_exists", { path }),
      freeSpace: (path) => invokeOrNull<number>("get_free_space", { path }),
    };
    return registerDownloadFlowHost(host);
  }, []);

  // Close pending pickers when the host goes away.
  useEffect(
    () => () => {
      setRootRequest((request) => {
        request?.resolve(null);
        return null;
      });
      setVersionRequest((request) => {
        request?.resolve(null);
        return null;
      });
    },
    [],
  );

  const finishRoot = (value: RootPathEntry | "settings" | null) => {
    rootRequest?.resolve(value);
    setRootRequest(null);
  };

  const finishVersion = (value: GameVersion | null) => {
    versionRequest?.resolve(value);
    setVersionRequest(null);
  };

  return (
    <>
      <RootPathSelectDialog
        open={!!rootRequest}
        gameTitle={rootRequest?.gameTitle ?? ""}
        rootPaths={rootRequest?.roots ?? []}
        preselectId={rootRequest?.preselectId}
        onSelect={(path) =>
          finishRoot(
            rootRequest?.roots.find((root) => root.path === path) ?? null,
          )
        }
        onClose={() => finishRoot(null)}
        onGoToSettings={() => finishRoot("settings")}
      />
      <VersionSelectDialog
        open={!!versionRequest}
        gameTitle={versionRequest?.gameTitle ?? ""}
        versions={versionRequest?.versions ?? []}
        onSelect={(version) => finishVersion(version)}
        onClose={() => finishVersion(null)}
      />
    </>
  );
}
