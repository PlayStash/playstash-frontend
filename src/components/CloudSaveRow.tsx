import { useCallback, useEffect, useState } from "react";
import {
  CloudArrowDownIcon,
  CloudArrowUpIcon,
  CloudIcon,
  FolderPlusIcon,
  MagnifyingGlassIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import type { PlaystashGame } from "@/api";
import type { InstalledGameInfo } from "@/hooks/useInstalledGames";
import { useAuth } from "@/context/AuthContext";
import { useOnlineStatus } from "@/context/OfflineContext";
import { useAlertDialog } from "@/context/AlertDialogContext";
import { useTranslation, type TranslationKey } from "@/i18n";
import { isTauriApp } from "@/utils/tauri";
import {
  CLOUD_SAVES_README_URL,
  backupCloudSave,
  buildCloudSaveRequest,
  cloudSaveMessageKey,
  cloudSaveSearchTitle,
  cloudSaveServerPaths,
  cloudSaveTone,
  formatTemplate,
  conflictDialog,
  getSaveFolders,
  matchCloudSaveTitle,
  restoreWithConflictPrompt,
  setSaveFolders,
  type CloudSaveOutcome,
  type SaveFolders,
} from "@/utils/cloudSaves";

const SOURCE_LABELS: Record<SaveFolders["source"], TranslationKey> = {
  server: "cloudSaves.row.sourceServer",
  local: "cloudSaves.row.sourceLocal",
  detected: "cloudSaves.row.sourceDetected",
  none: "cloudSaves.row.sourceNone",
};

/**
 * GameView row with manual cloud save restore/backup and the game's save
 * folders. Shown on desktop for installed games: Ludusavi's manifest, the
 * folders set on the server, chosen here or detected locate the saves.
 */
export function CloudSaveRow({
  game,
  installed,
}: {
  game: PlaystashGame | null;
  installed: InstalledGameInfo | undefined;
}) {
  const { t } = useTranslation();
  const { serverUrl, user, getAccessToken } = useAuth();
  const { isOnline } = useOnlineStatus();
  const { showAlert } = useAlertDialog();
  const [match, setMatch] = useState("");
  const [folders, setFolders] = useState<SaveFolders | null>(null);
  const [busy, setBusy] = useState<"restore" | "backup" | "folders" | null>(
    null,
  );
  const desktop = isTauriApp();
  const searchTitle = cloudSaveSearchTitle(game);
  const serverPaths = cloudSaveServerPaths(game);
  const serverPathsKey = serverPaths.join("\n");
  const gameId = Number(game?.id ?? 0);
  const installationPath = installed?.installationDirectory ?? "";
  const versionDirectory = installed?.versionDirectory ?? "";
  const isInstalled = Boolean(installed);

  const refresh = useCallback(
    async (detect = false) => {
      if (!desktop || !gameId || !searchTitle || !isInstalled) {
        setMatch("");
        setFolders(null);
        return;
      }
      const savePaths = serverPathsKey ? serverPathsKey.split("\n") : [];
      const current = await getSaveFolders({
        installationPath,
        versionDirectory,
        serverPaths: savePaths,
        detect,
      });
      setFolders(current);
      setMatch(
        await matchCloudSaveTitle({
          gameId,
          title: searchTitle,
          installationPath,
          versionDirectory,
          savePaths,
        }),
      );
    },
    [
      desktop,
      gameId,
      searchTitle,
      isInstalled,
      installationPath,
      versionDirectory,
      serverPathsKey,
    ],
  );

  useEffect(() => {
    let cancelled = false;
    refresh().catch(() => {
      if (!cancelled) setMatch("");
    });
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  if (!desktop || !installed) return null;

  const notifyOutcome = (outcome: CloudSaveOutcome) => {
    const key = cloudSaveMessageKey(outcome);
    if (key) {
      void showAlert({ title: t(key), tone: cloudSaveTone(outcome.status) });
    }
  };
  const toast = (key: TranslationKey, tone: "info" | "warning" = "info") =>
    void showAlert({ title: t(key), tone });

  const request = async () => {
    const accessToken = await getAccessToken();
    if (!accessToken || !user?.id) return null;
    return buildCloudSaveRequest({
      gameId,
      versionDirectory,
      installationPath,
      title: searchTitle,
      serverUrl,
      userId: Number(user.id),
      accessToken,
      savePaths: serverPaths,
    });
  };

  const restore = async () => {
    setBusy("restore");
    toast("cloudSaves.status.syncing");
    try {
      const payload = await request();
      if (!payload || !isOnline) {
        notifyOutcome({ status: "offline" });
        return;
      }
      const outcome = await restoreWithConflictPrompt(payload, {
        interactive: true,
        confirmUseCloud: (conflict) => showAlert(conflictDialog(conflict, t)),
      });
      notifyOutcome(outcome);
    } catch (error) {
      console.error("Cloud save restore failed:", error);
      notifyOutcome({ status: "restoreFailed" });
    } finally {
      setBusy(null);
    }
  };

  const backup = async () => {
    if (!isOnline) {
      notifyOutcome({ status: "offline" });
      return;
    }
    setBusy("backup");
    toast("cloudSaves.status.uploading");
    try {
      const payload = await request();
      notifyOutcome(
        payload ? await backupCloudSave(payload) : { status: "offline" },
      );
    } catch (error) {
      console.error("Cloud save backup failed:", error);
      notifyOutcome({ status: "backupFailed" });
    } finally {
      setBusy(null);
    }
  };

  const changeFolders = async (change: () => Promise<unknown>) => {
    setBusy("folders");
    try {
      await change();
      await refresh();
    } catch (error) {
      console.error("Changing the save folders failed:", error);
      toast("cloudSaves.row.foldersFailed", "warning");
    } finally {
      setBusy(null);
    }
  };

  const localPaths = folders?.source === "local" ? folders.paths : [];
  const addFolder = () =>
    void changeFolders(async () => {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const directory = await open({
        directory: true,
        multiple: false,
        title: t("cloudSaves.row.chooseFolder"),
      });
      if (typeof directory !== "string") return;
      await setSaveFolders({
        installationPath,
        versionDirectory,
        folders: [...localPaths.map((folder) => folder.path), directory],
      });
    });
  const removeFolder = (path: string) =>
    void changeFolders(() =>
      setSaveFolders({
        installationPath,
        versionDirectory,
        folders: localPaths
          .map((folder) => folder.path)
          .filter((known) => known !== path),
      }),
    );
  const detect = () =>
    void changeFolders(async () => {
      const found = await getSaveFolders({
        installationPath,
        versionDirectory,
        detect: true,
      });
      if (found.source === "none") toast("cloudSaves.row.nothingDetected");
    });

  const ludusaviMatch = Boolean(match) && !match.startsWith("PlayStash #");
  const canSync = Boolean(match) && busy === null;
  const buttonClass =
    "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-ps-text ring-1 ring-ps-line transition-colors hover:bg-ps-panel-soft disabled:cursor-not-allowed disabled:opacity-50";
  const shownFolders = folders?.paths ?? [];

  return (
    <div className="surface-panel space-y-3 rounded-2xl px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <CloudIcon className="size-5 shrink-0 text-ps-accent" aria-hidden />
        <a
          href={CLOUD_SAVES_README_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-medium text-ps-accent hover:underline"
        >
          {t("cloudSaves.row.link")}
        </a>
        <div className="ml-auto flex flex-wrap gap-2">
          <button
            type="button"
            className={buttonClass}
            disabled={!canSync}
            title={formatTemplate(t("cloudSaves.row.restoreTooltip"), {
              match,
            })}
            onClick={() => void restore()}
          >
            <CloudArrowDownIcon className="size-4" aria-hidden />
            {t("cloudSaves.row.restore")}
          </button>
          <button
            type="button"
            className={buttonClass}
            disabled={!canSync}
            title={formatTemplate(t("cloudSaves.row.backupTooltip"), {
              match,
            })}
            onClick={() => void backup()}
          >
            <CloudArrowUpIcon className="size-4" aria-hidden />
            {t("cloudSaves.row.backup")}
          </button>
        </div>
      </div>
      <div className="space-y-1.5 text-xs text-ps-muted">
        <p>
          {ludusaviMatch && shownFolders.length === 0
            ? formatTemplate(t("cloudSaves.row.ludusaviMatch"), { match })
            : t(SOURCE_LABELS[folders?.source ?? "none"])}
        </p>
        {shownFolders.length > 0 && (
          <ul className="space-y-1">
            {shownFolders.map((folder) => (
              <li key={folder.path} className="flex items-center gap-2">
                <code
                  className="min-w-0 truncate rounded bg-ps-panel-soft px-1.5 py-0.5 text-ps-text"
                  title={folder.resolved || folder.path}
                >
                  {folder.path}
                </code>
                {!folder.exists && (
                  <span className="shrink-0">
                    {t("cloudSaves.row.folderMissing")}
                  </span>
                )}
                {folders?.source === "local" && (
                  <button
                    type="button"
                    className="ml-auto shrink-0 rounded p-0.5 hover:bg-ps-panel-soft"
                    aria-label={formatTemplate(
                      t("cloudSaves.row.removeFolder"),
                      { path: folder.path },
                    )}
                    disabled={busy !== null}
                    onClick={() => removeFolder(folder.path)}
                  >
                    <XMarkIcon className="size-4" aria-hidden />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {folders?.source !== "server" && (
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              className={buttonClass}
              disabled={busy !== null}
              onClick={addFolder}
            >
              <FolderPlusIcon className="size-4" aria-hidden />
              {t("cloudSaves.row.chooseFolder")}
            </button>
            <button
              type="button"
              className={buttonClass}
              disabled={busy !== null}
              onClick={detect}
            >
              <MagnifyingGlassIcon className="size-4" aria-hidden />
              {t("cloudSaves.row.detect")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
