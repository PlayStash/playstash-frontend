import { useCallback, useEffect, useRef, useState } from "react";
import { useAlertDialog } from "@/context/AlertDialogContext";
import UpdatePromptDialog, {
  type UpdatePromptInfo,
} from "@/components/UpdatePromptDialog";
import { isTauriApp } from "@/utils/tauri";
import {
  channelLabel,
  compareVersions,
  formatUpdateError,
  githubReleaseVersion,
  isMissingUpdaterFeedError,
  isUpdateSnoozed,
  readUpdateChannel,
  UPDATE_CHECK_INTERVAL_MS,
  UPDATE_SNOOZE_MS,
  writeUpdateChannel,
} from "@/utils/updater";
import type {
  GithubReleaseInfo,
  UpdateChannel,
  UpdateSnooze,
} from "@/utils/updater";
import { translate, type TranslationKey } from "@/i18n";
import { fillTemplate } from "@/utils/downloadPipeline";
import {
  AppUpdaterContext,
  type CheckForUpdatesOptions,
} from "@/context/AppUpdaterContext";

/** Translates at call time and fills `{placeholders}`. */
function tr(
  key: TranslationKey,
  values?: Record<string, string | number>,
): string {
  return values ? fillTemplate(translate(key), values) : translate(key);
}

const AUTO_CHECK_DELAY_MS = 1500;
const APP_UPDATER_EVENT = "app-updater-progress";
const GITHUB_RELEASE_API_URLS: Record<UpdateChannel, string> = {
  stable:
    "https://api.github.com/repos/PlayStash/playstash-frontend/releases/latest",
  unstable:
    "https://api.github.com/repos/PlayStash/playstash-frontend/releases/tags/unstable",
};
const GITHUB_RELEASE_PAGE_URLS: Record<UpdateChannel, string> = {
  stable: "https://github.com/PlayStash/playstash-frontend/releases/latest",
  unstable:
    "https://github.com/PlayStash/playstash-frontend/releases/tag/unstable",
};

type UpdateDownloadEvent =
  | {
      event: "Started";
      contentLength?: number | null;
      chunkLength?: number | null;
    }
  | {
      event: "Progress";
      contentLength?: number | null;
      chunkLength?: number | null;
    }
  | {
      event: "Installing";
      contentLength?: number | null;
      chunkLength?: number | null;
    }
  | {
      event: "Finished";
      contentLength?: number | null;
      chunkLength?: number | null;
    };

type PendingUpdate = {
  version: string;
  body?: string | null;
  currentVersion: string;
  channel: UpdateChannel;
};

async function fetchGithubRelease(
  channel: UpdateChannel,
): Promise<GithubReleaseInfo> {
  const response = await fetch(GITHUB_RELEASE_API_URLS[channel], {
    headers: {
      Accept: "application/vnd.github+json",
    },
  });

  if (!response.ok) {
    throw new Error(
      tr("updater.error.githubLookup", { status: response.status }),
    );
  }

  return (await response.json()) as GithubReleaseInfo;
}

function openExternalReleasePage(channel: UpdateChannel, url?: string): void {
  const targetUrl = url || GITHUB_RELEASE_PAGE_URLS[channel];
  window.open(targetUrl, "_blank", "noopener,noreferrer");
}

/**
 * Desktop app updates.
 *
 * Checks the signed Tauri updater feed of the selected channel (stable:
 * `latest.json` of the latest GitHub release, unstable: `unstable.json`)
 * shortly after startup, every few hours while the app runs and on
 * "Check for Updates". A newer version is proposed in a dialog with its
 * release notes; "Update now" downloads, verifies and installs it, "Later"
 * keeps automatic checks quiet about that version for a day.
 *
 * When the signed feed cannot be used (not published yet, no entry for this
 * platform) the GitHub release is checked instead and a newer version is
 * offered as a manual download from its release page.
 */
export function AppUpdaterProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { showAlert } = useAlertDialog();
  const [updateChannel, setUpdateChannelState] = useState<UpdateChannel>(() =>
    readUpdateChannel(),
  );
  const [updaterEnabled, setUpdaterEnabled] = useState(false);
  const [updaterReady, setUpdaterReady] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [availableVersion, setAvailableVersion] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<UpdatePromptInfo | null>(null);
  const promptResolveRef = useRef<((accepted: boolean) => void) | null>(null);
  const runningRef = useRef(false);
  const autoCheckedRef = useRef(false);
  const snoozeRef = useRef<UpdateSnooze | null>(null);

  const setUpdateChannel = useCallback(
    (channel: UpdateChannel) => {
      writeUpdateChannel(channel);
      if (channel === updateChannel) return;
      setUpdateChannelState(channel);
      // A new channel starts over: forget the previous channel's result and
      // let the startup check run again.
      autoCheckedRef.current = false;
      setAvailableVersion(null);
      setErrorText(null);
      setStatusText(null);
    },
    [updateChannel],
  );

  /** Shows the update proposal and resolves with the user's answer. */
  const askToUpdate = useCallback(
    (info: UpdatePromptInfo) =>
      new Promise<boolean>((resolve) => {
        promptResolveRef.current = resolve;
        setPrompt(info);
      }),
    [],
  );

  const answerPrompt = useCallback((accepted: boolean) => {
    const resolve = promptResolveRef.current;
    promptResolveRef.current = null;
    setPrompt(null);
    resolve?.(accepted);
  }, []);

  /** "Later": automatic checks stay quiet about this version for a while. */
  const snooze = useCallback((channel: UpdateChannel, version: string) => {
    snoozeRef.current = {
      channel,
      version,
      until: Date.now() + UPDATE_SNOOZE_MS,
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!isTauriApp()) {
        if (!cancelled) {
          setUpdaterEnabled(false);
          setUpdaterReady(true);
        }
        return;
      }

      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const enabled = await invoke<boolean>("is_updater_enabled");
        if (!cancelled) {
          setUpdaterEnabled(enabled);
        }
      } catch (error) {
        console.warn("Updater probe failed:", error);
        if (!cancelled) {
          setUpdaterEnabled(false);
        }
      } finally {
        if (!cancelled) {
          setUpdaterReady(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Re-attach to an update that is already downloading or installing.
  //
  // The update keeps running in the backend when the webview is reloaded, but
  // its progress listener is gone. Restore the status text, and keep
  // `runningRef` set so the auto-check (and a manual check) can't start a
  // second download of the same update on top of it.
  useEffect(() => {
    if (!isTauriApp()) return;
    let cancelled = false;

    void (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const states = await invoke<{
          appUpdate?: {
            status: string;
            version?: string | null;
            error?: string | null;
          } | null;
        }>("get_background_states");
        const snapshot = states?.appUpdate;
        if (cancelled || !snapshot) return;

        if (
          snapshot.status === "downloading" ||
          snapshot.status === "installing"
        ) {
          runningRef.current = true;
          setIsInstalling(true);
          setStatusText(
            snapshot.status === "installing"
              ? tr("updater.status.installing")
              : tr("updater.status.downloading"),
          );

          // The backend keeps streaming progress; follow it so the status text
          // stays accurate while the update finishes in the background.
          const { listen } = await import("@tauri-apps/api/event");
          const unlisten = await listen<UpdateDownloadEvent>(
            APP_UPDATER_EVENT,
            (event) => {
              if (cancelled) return;
              switch (event.payload.event) {
                case "Installing":
                  setStatusText(tr("updater.status.installing"));
                  break;
                case "Finished":
                  runningRef.current = false;
                  setIsInstalling(false);
                  setStatusText(tr("updater.status.installed"));
                  break;
                default:
                  break;
              }
            },
          );
          if (cancelled) unlisten();
        } else if (snapshot.status === "finished") {
          setAvailableVersion(null);
          setStatusText(tr("updater.status.installed"));
        } else if (snapshot.status === "error" && snapshot.error) {
          setErrorText(snapshot.error);
        }
      } catch {
        // Older builds without the background state command; ignore.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const showUpToDate = useCallback(
    async (manual: boolean) => {
      setAvailableVersion(null);
      setStatusText(
        tr("updater.status.upToDate", {
          channel: channelLabel(updateChannel),
        }),
      );
      if (manual) {
        await showAlert({
          title: tr("updater.upToDate.title"),
          description: tr("updater.upToDate.description", {
            channel: channelLabel(updateChannel),
            version: __APP_VERSION__,
          }),
          affirmativeText: tr("common.ok"),
        });
      }
    },
    [showAlert, updateChannel],
  );

  /**
   * The signed feed could not be used: look the release up on GitHub and
   * offer a newer version as a manual download from its release page.
   */
  const checkReleasePage = useCallback(
    async (manual: boolean) => {
      const release = await fetchGithubRelease(updateChannel);
      const remoteVersion = githubReleaseVersion(release);
      if (
        !remoteVersion ||
        compareVersions(remoteVersion, __APP_VERSION__) <= 0
      ) {
        await showUpToDate(manual);
        return;
      }

      setAvailableVersion(remoteVersion);
      setStatusText(
        tr("updater.status.available", {
          channel: channelLabel(updateChannel),
          version: remoteVersion,
        }),
      );
      if (
        !manual &&
        isUpdateSnoozed(snoozeRef.current, updateChannel, remoteVersion)
      ) {
        return;
      }

      const approved = await askToUpdate({
        version: remoteVersion,
        currentVersion: __APP_VERSION__,
        channel: updateChannel,
        notes: release.body,
        mode: "page",
      });
      if (!approved) {
        snooze(updateChannel, remoteVersion);
        return;
      }
      openExternalReleasePage(updateChannel, release.html_url ?? undefined);
      setStatusText(
        tr("updater.status.openedPage", { version: remoteVersion }),
      );
    },
    [askToUpdate, showUpToDate, snooze, updateChannel],
  );

  const checkForUpdates = useCallback(
    async ({ manual = false }: CheckForUpdatesOptions = {}) => {
      if (runningRef.current) {
        return;
      }

      if (!isTauriApp()) {
        if (manual) {
          await showAlert({
            title: tr("updater.unavailable.title"),
            description: tr("updater.unavailable.description"),
            affirmativeText: tr("common.ok"),
          });
        }
        return;
      }

      if (!updaterEnabled) {
        if (manual) {
          await showAlert({
            title: tr("updater.notConfigured.title"),
            description: tr("updater.notConfigured.description"),
            affirmativeText: tr("common.ok"),
          });
        }
        return;
      }

      runningRef.current = true;
      setIsChecking(true);
      setErrorText(null);
      setStatusText(
        tr("updater.status.checking", { channel: channelLabel(updateChannel) }),
      );
      let removeProgressListener: (() => void) | null = null;

      try {
        const { invoke } = await import("@tauri-apps/api/core");
        let update: PendingUpdate | null;
        try {
          update = await invoke<PendingUpdate | null>("check_for_app_update", {
            channel: updateChannel,
          });
        } catch (error) {
          if (!isMissingUpdaterFeedError(error)) throw error;
          console.warn("Signed updater feed unavailable:", error);
          await checkReleasePage(manual);
          return;
        }

        if (!update) {
          await showUpToDate(manual);
          return;
        }

        setAvailableVersion(update.version);
        setStatusText(
          tr("updater.status.available", {
            channel: channelLabel(updateChannel),
            version: update.version,
          }),
        );

        if (
          !manual &&
          isUpdateSnoozed(snoozeRef.current, updateChannel, update.version)
        ) {
          return;
        }

        const approved = await askToUpdate({
          version: update.version,
          currentVersion: update.currentVersion || __APP_VERSION__,
          channel: updateChannel,
          notes: update.body,
          mode: "install",
        });

        if (!approved) {
          snooze(updateChannel, update.version);
          return;
        }

        snoozeRef.current = null;
        setIsInstalling(true);
        setStatusText(tr("updater.status.downloading"));
        void showAlert({ title: tr("updater.status.downloading") });

        let contentLength = 0;
        let downloaded = 0;

        const { listen } = await import("@tauri-apps/api/event");
        removeProgressListener = await listen<UpdateDownloadEvent>(
          APP_UPDATER_EVENT,
          (event) => {
            switch (event.payload.event) {
              case "Started":
                contentLength = event.payload.contentLength ?? 0;
                setStatusText(
                  contentLength > 0
                    ? tr("updater.status.downloadingPercent", { percent: 0 })
                    : tr("updater.status.downloading"),
                );
                break;
              case "Progress":
                downloaded += event.payload.chunkLength ?? 0;
                if (contentLength > 0) {
                  const percent = Math.min(
                    99,
                    Math.round((downloaded / contentLength) * 100),
                  );
                  setStatusText(
                    tr("updater.status.downloadingPercent", { percent }),
                  );
                }
                break;
              case "Installing":
                setStatusText(tr("updater.status.installing"));
                void showAlert({ title: tr("updater.status.installing") });
                break;
              case "Finished":
                setStatusText(tr("updater.status.installed"));
                break;
            }
          },
        );

        // On Windows the installer closes PlayStash and starts the new
        // version itself; elsewhere the new version loads after a restart.
        await invoke<string | null>("download_and_install_app_update", {
          channel: updateChannel,
        });

        setAvailableVersion(null);
        setStatusText(tr("updater.status.installed"));

        const restart = await showAlert({
          title: tr("updater.installed.title"),
          description: tr("updater.installed.description"),
          affirmativeText: tr("updater.restartNow"),
          negativeText: tr("updater.later"),
        });
        if (restart) {
          await invoke("restart_app");
        }
      } catch (error) {
        const message = formatUpdateError(error);
        console.error("Update check failed:", error);
        setErrorText(message);
        setStatusText(null);

        if (manual) {
          await showAlert({
            title: tr("updater.failed.title"),
            description: message,
            affirmativeText: tr("common.ok"),
          });
        }
      } finally {
        if (removeProgressListener) {
          removeProgressListener();
        }

        runningRef.current = false;
        setIsChecking(false);
        setIsInstalling(false);
      }
    },
    [
      askToUpdate,
      checkReleasePage,
      showAlert,
      showUpToDate,
      snooze,
      updateChannel,
      updaterEnabled,
    ],
  );

  // Check shortly after startup (and after switching the channel).
  useEffect(() => {
    if (!updaterReady || !updaterEnabled || autoCheckedRef.current) {
      return;
    }

    autoCheckedRef.current = true;
    const timer = window.setTimeout(() => {
      void checkForUpdates();
    }, AUTO_CHECK_DELAY_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [checkForUpdates, updaterEnabled, updaterReady]);

  // Keep checking while the app runs (it often stays open in the tray).
  useEffect(() => {
    if (!updaterReady || !updaterEnabled) return;
    const interval = window.setInterval(() => {
      void checkForUpdates();
    }, UPDATE_CHECK_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [checkForUpdates, updaterEnabled, updaterReady]);

  return (
    <AppUpdaterContext.Provider
      value={{
        updateChannel,
        updaterEnabled,
        updaterReady,
        isChecking,
        isInstalling,
        availableVersion,
        errorText,
        statusText,
        setUpdateChannel,
        checkForUpdates,
      }}
    >
      {children}
      <UpdatePromptDialog prompt={prompt} onAnswer={answerPrompt} />
    </AppUpdaterContext.Provider>
  );
}
