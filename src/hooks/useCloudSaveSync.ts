import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useOnlineStatus } from "@/context/OfflineContext";
import { useAlertDialog } from "@/context/AlertDialogContext";
import { useTranslation, type TranslationKey } from "@/i18n";
import { isTauriApp } from "@/utils/tauri";
import { registerPreLaunchHook } from "@/utils/launchInstalledGame";
import { registerPreUninstallHook } from "@/utils/uninstallInstalledGame";
import { onGameExited, onGameSession } from "@/utils/gameSessions";
import { isMainWindowFocused, notify } from "@/utils/osNotify";
import {
  CLOUD_SAVES_CHANGE_EVENT,
  addPendingBackup,
  backupCloudSave,
  buildCloudSaveRequest,
  cloudSaveMessageKey,
  cloudSaveSearchTitle,
  cloudSaveTone,
  conflictDialog,
  createBackupDeduper,
  formatTemplate,
  getCloudSaveSettings,
  installedGameTitle,
  listInstalledVersions,
  matchCloudSaveTitle,
  newestInstalledVersion,
  pendingQueueKey,
  readPendingBackups,
  removePendingBackup,
  restoreWithConflictPrompt,
  type CloudSaveOutcome,
  type CloudSaveSettings,
} from "@/utils/cloudSaves";
import type { InstalledGameInfo } from "@/hooks/useInstalledGames";

function samePath(a: string, b: string): boolean {
  const normalize = (value: string) =>
    value
      .replace(/[\\/]+/g, "/")
      .replace(/\/$/, "")
      .toLowerCase();
  return normalize(a) === normalize(b);
}

async function isWindowVisible(): Promise<boolean> {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    return await getCurrentWindow().isVisible();
  } catch {
    return typeof document === "undefined"
      ? true
      : document.visibilityState !== "hidden";
  }
}

async function findInstalledVersion(
  gameId: number,
  versionDirectory?: string,
): Promise<InstalledGameInfo | undefined> {
  const versions = await listInstalledVersions();
  if (versionDirectory) {
    const exact = versions.find(
      (version) =>
        version.gameId === gameId &&
        samePath(version.versionDirectory, versionDirectory),
    );
    if (exact) return exact;
  }
  return newestInstalledVersion(versions, gameId);
}

async function isTrackerRunning(): Promise<boolean> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const status = await invoke<{ trackerRunning?: boolean }>(
      "get_tracker_status",
    );
    return Boolean(status?.trackerRunning);
  } catch {
    return false;
  }
}

/**
 * Automatic cloud saves on desktop: restore before every launch,
 * back up after a game exits, offer a backup before uninstalling, and queue
 * backups while offline until the client reconnects.
 */
export function useCloudSaveSync(): void {
  const enabledInApp = isTauriApp();
  const { serverUrl, user, getAccessToken } = useAuth();
  const { isOnline } = useOnlineStatus();
  const { showAlert } = useAlertDialog();
  const { t } = useTranslation();
  const [settings, setSettings] = useState<CloudSaveSettings | null>(null);

  const userId = Number((user as { id?: number } | null)?.id ?? 0);
  const state = useRef({
    enabled: false,
    isOnline,
    serverUrl,
    userId,
    getAccessToken,
    showAlert,
    t,
  });
  state.current = {
    enabled: Boolean(settings?.enabled),
    isOnline,
    serverUrl,
    userId,
    getAccessToken,
    showAlert,
    t,
  };
  const deduper = useRef(createBackupDeduper());

  useEffect(() => {
    if (!enabledInApp) return;
    let cancelled = false;
    void getCloudSaveSettings()
      .then((value) => {
        if (!cancelled) setSettings(value);
      })
      .catch(() => undefined);
    const onChange = (event: Event) =>
      setSettings((event as CustomEvent<CloudSaveSettings>).detail);
    window.addEventListener(CLOUD_SAVES_CHANGE_EVENT, onChange);
    return () => {
      cancelled = true;
      window.removeEventListener(CLOUD_SAVES_CHANGE_EVENT, onChange);
    };
  }, [enabledInApp]);

  /** Shows a result as a toast, and as an OS notification when unfocused. */
  const report = useCallback(
    async (outcome: CloudSaveOutcome, automatic: boolean) => {
      const key = cloudSaveMessageKey(outcome);
      if (!key) return;
      const message = state.current.t(key);
      void state.current.showAlert({
        title: message,
        tone: cloudSaveTone(outcome.status),
      });
      if (automatic && !(await isMainWindowFocused())) {
        await notify({ title: "PlayStash", body: message, tag: "cloud-save" });
      }
    },
    [],
  );

  const toast = useCallback(
    (key: TranslationKey, tone: "info" | "warning" = "info") => {
      void state.current.showAlert({ title: state.current.t(key), tone });
    },
    [],
  );

  const runBackup = useCallback(
    async (
      gameId: number,
      versionDirectory?: string,
      automatic = true,
    ): Promise<CloudSaveOutcome | null> => {
      const current = state.current;
      const queueKey = pendingQueueKey(current.serverUrl, current.userId);
      if (!current.isOnline || !current.userId) {
        addPendingBackup(queueKey, gameId);
        toast("cloudSaves.status.offlineQueued", "warning");
        return null;
      }
      try {
        const installed = await findInstalledVersion(gameId, versionDirectory);
        if (!installed) return null;
        const accessToken = await current.getAccessToken();
        if (!accessToken) {
          addPendingBackup(queueKey, gameId);
          toast("cloudSaves.status.offlineQueued", "warning");
          return null;
        }
        toast("cloudSaves.status.uploading");
        const outcome = await backupCloudSave(
          buildCloudSaveRequest({
            gameId,
            versionDirectory: installed.versionDirectory,
            installationPath: installed.installationDirectory,
            title: await installedGameTitle(installed),
            serverUrl: current.serverUrl,
            userId: current.userId,
            accessToken,
          }),
        );
        if (outcome.status === "offline") addPendingBackup(queueKey, gameId);
        await report(outcome, automatic);
        return outcome;
      } catch (error) {
        console.error("Cloud save backup failed:", error);
        await report({ status: "backupFailed" }, automatic);
        return null;
      }
    },
    [report, toast],
  );

  const scheduleBackup = useCallback(
    (gameId: number, versionDirectory?: string) => {
      if (!state.current.enabled || gameId <= 0) return;
      if (!deduper.current.shouldRun(gameId)) return;
      void runBackup(gameId, versionDirectory);
    },
    [runBackup],
  );

  // Restore before every launch. A failure never blocks the launch.
  useEffect(() => {
    if (!enabledInApp) return;
    return registerPreLaunchHook("cloud-saves", async (context) => {
      const current = state.current;
      if (!current.enabled || !current.isOnline || !current.userId) return;
      try {
        const accessToken = await current.getAccessToken();
        if (!accessToken) return;
        toast("cloudSaves.status.syncing");
        let title = cloudSaveSearchTitle(context.game);
        if (!title) {
          const installed = await findInstalledVersion(
            context.gameId,
            context.versionDirectory,
          );
          title = installed ? await installedGameTitle(installed) : "";
        }
        const request = buildCloudSaveRequest({
          gameId: context.gameId,
          versionDirectory: context.versionDirectory,
          installationPath: context.installationPath,
          title,
          serverUrl: current.serverUrl,
          userId: current.userId,
          accessToken,
          winePrefix: context.umuWinePrefix,
        });
        // A hidden window (CLI / jump-list start) cannot ask: keep local.
        const outcome = await restoreWithConflictPrompt(request, {
          interactive: await isWindowVisible(),
          confirmUseCloud: (conflict) =>
            current.showAlert(conflictDialog(conflict, current.t)),
        });
        await report(outcome, false);
      } catch (error) {
        console.error("Cloud save restore before launch failed:", error);
        await report({ status: "restoreFailed" }, false);
      }
    });
  }, [enabledInApp, report, toast]);

  // Back up after a game exits: the tracker's session end survives launcher
  // hand-off; the launch monitor's exit event is the fallback while the
  // tracker is not running.
  useEffect(() => {
    if (!enabledInApp) return;
    let disposed = false;
    const unlisteners: (() => void)[] = [];
    const keep = (unlisten: () => void) => {
      if (disposed) unlisten();
      else unlisteners.push(unlisten);
    };
    void onGameSession((event) => {
      if (event.state === "ended") {
        scheduleBackup(event.gameId, event.versionDirectory);
      }
    })
      .then(keep)
      .catch(() => undefined);
    void onGameExited((event) => {
      void isTrackerRunning().then((running) => {
        if (!running) scheduleBackup(event.gameId, event.versionDirectory);
      });
    })
      .then(keep)
      .catch(() => undefined);
    return () => {
      disposed = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [enabledInApp, scheduleBackup]);

  // Offer a backup before a game (or its Wine prefix) is removed.
  useEffect(() => {
    if (!enabledInApp) return;
    return registerPreUninstallHook(async (context) => {
      const current = state.current;
      if (!current.enabled || !current.isOnline || !current.userId) return;
      try {
        const installed = await findInstalledVersion(
          context.gameId,
          context.versionDirectory,
        );
        const title = installed ? await installedGameTitle(installed) : "";
        if (!title) return;
        const match = await matchCloudSaveTitle({
          gameId: context.gameId,
          title,
          installationPath: context.installationPath,
        });
        if (!match) return;
        const confirmed = await current.showAlert({
          title: current.t("cloudSaves.uninstall.title"),
          description: formatTemplate(
            current.t("cloudSaves.uninstall.description"),
            { title: match },
          ),
          affirmativeText: current.t("cloudSaves.uninstall.backup"),
          negativeText: current.t("cloudSaves.uninstall.skip"),
        });
        if (confirmed) {
          await runBackup(context.gameId, context.versionDirectory, false);
        }
      } catch (error) {
        console.error("Cloud save backup before uninstall failed:", error);
      }
    });
  }, [enabledInApp, runBackup]);

  // Run backups queued while offline once the client is back online.
  const enabled = Boolean(settings?.enabled);
  useEffect(() => {
    if (!enabledInApp || !enabled || !isOnline || !userId || !serverUrl) {
      return;
    }
    const queueKey = pendingQueueKey(serverUrl, userId);
    const pending = readPendingBackups(queueKey);
    if (!pending.length) return;
    let cancelled = false;
    void (async () => {
      for (const gameId of pending) {
        if (cancelled) return;
        removePendingBackup(queueKey, gameId);
        await runBackup(gameId);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabledInApp, enabled, isOnline, userId, serverUrl, runBackup]);
}

/** Effect component for `DesktopProviders`. */
export function CloudSaveSync(): null {
  useCloudSaveSync();
  return null;
}
