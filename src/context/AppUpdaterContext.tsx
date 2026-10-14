import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useAlertDialog } from "@/context/AlertDialogContext";
import { isTauriApp } from "@/utils/tauri";
import {
  channelLabel,
  clearSkippedVersion,
  compareVersions,
  formatUpdateError,
  formatUpdatePrompt,
  isMissingUpdaterFeedError,
  normalizeVersion,
  readSkippedVersion,
  readUpdateChannel,
  writeSkippedVersion,
  writeUpdateChannel,
} from "@/utils/updater";
import type { UpdateChannel } from "@/utils/updater";
import { translate, type TranslationKey } from "@/i18n";
import { fillTemplate } from "@/utils/downloadPipeline";

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

interface GithubReleaseFallback {
  tag_name: string;
  html_url?: string;
  body?: string | null;
  published_at?: string;
  updated_at?: string;
}

interface CheckForUpdatesOptions {
  manual?: boolean;
}

interface AppUpdaterContextValue {
  updateChannel: UpdateChannel;
  updaterEnabled: boolean;
  updaterReady: boolean;
  isChecking: boolean;
  isInstalling: boolean;
  availableVersion: string | null;
  errorText: string | null;
  statusText: string | null;
  setUpdateChannel: (channel: UpdateChannel) => void;
  checkForUpdates: (options?: CheckForUpdatesOptions) => Promise<void>;
}

const AppUpdaterContext = createContext<AppUpdaterContextValue | undefined>(
  undefined,
);

async function fetchGithubReleaseFallback(
  channel: UpdateChannel,
): Promise<GithubReleaseFallback> {
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

  return (await response.json()) as GithubReleaseFallback;
}

function openExternalReleasePage(channel: UpdateChannel, url?: string): void {
  const targetUrl = url || GITHUB_RELEASE_PAGE_URLS[channel];
  window.open(targetUrl, "_blank", "noopener,noreferrer");
}

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
  const runningRef = useRef(false);
  const autoCheckedRef = useRef(false);

  const setUpdateChannel = useCallback((channel: UpdateChannel) => {
    setUpdateChannelState(channel);
    writeUpdateChannel(channel);
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
      let update: PendingUpdate | null = null;
      let removeProgressListener: (() => void) | null = null;

      const handleMissingFeedFallback = async (cause: unknown) => {
        const fallbackMessage = tr("updater.feedMissing");

        try {
          const release = await fetchGithubReleaseFallback(updateChannel);
          const releaseUrl =
            release.html_url || GITHUB_RELEASE_PAGE_URLS[updateChannel];

          if (updateChannel === "stable") {
            const remoteVersion = normalizeVersion(release.tag_name);
            const hasNewerStable =
              compareVersions(remoteVersion, __APP_VERSION__) > 0;

            if (!hasNewerStable) {
              setAvailableVersion(null);
              setErrorText(fallbackMessage);
              setStatusText(tr("updater.stable.feedMissingStatus"));

              if (!manual) {
                return;
              }

              const approved = await showAlert({
                title: tr("updater.stable.pageAvailable.title"),
                description: tr("updater.stable.pageAvailable.description", {
                  version: remoteVersion,
                }),
                affirmativeText: tr("updater.openGithubRelease"),
                negativeText: tr("common.cancel"),
              });

              if (approved) {
                openExternalReleasePage(updateChannel, releaseUrl);
                setStatusText(tr("updater.stable.openedPage"));
              }

              return;
            }

            setAvailableVersion(remoteVersion);
            setErrorText(fallbackMessage);
            setStatusText(
              tr("updater.stable.newerStatus", { version: remoteVersion }),
            );

            if (
              !manual &&
              readSkippedVersion(updateChannel) === remoteVersion
            ) {
              return;
            }

            if (!manual) {
              return;
            }

            const approved = await showAlert({
              title: tr("updater.stable.newer.title", {
                version: remoteVersion,
              }),
              description: tr("updater.stable.newer.description"),
              affirmativeText: tr("updater.openGithubRelease"),
              negativeText: tr("common.cancel"),
            });

            if (approved) {
              clearSkippedVersion(updateChannel);
              openExternalReleasePage(updateChannel, releaseUrl);
              setStatusText(tr("updater.stable.openedPage"));
            }
            return;
          }

          const label = channelLabel(updateChannel);
          setAvailableVersion(null);
          setErrorText(fallbackMessage);
          setStatusText(
            tr("updater.channel.feedMissingStatus", { channel: label }),
          );

          if (!manual) {
            return;
          }

          const updatedLabel = release.updated_at || release.published_at;
          const description = updatedLabel
            ? tr("updater.channel.pageAvailable.descriptionUpdated", {
                channel: label,
                date: new Date(updatedLabel).toLocaleString(),
              })
            : tr("updater.channel.pageAvailable.description", {
                channel: label,
              });

          const approved = await showAlert({
            title: tr("updater.channel.pageAvailable.title", {
              channel: label,
            }),
            description,
            affirmativeText: tr("updater.channel.openRelease", {
              channel: label,
            }),
            negativeText: tr("common.cancel"),
          });

          if (approved) {
            openExternalReleasePage(updateChannel, releaseUrl);
            setStatusText(tr("updater.channel.openedPage", { channel: label }));
          }
        } catch (fallbackError) {
          const message = formatUpdateError(fallbackError);
          console.error(
            "GitHub release fallback failed:",
            cause,
            fallbackError,
          );
          setAvailableVersion(null);
          setErrorText(message);
          setStatusText(null);

          if (manual) {
            await showAlert({
              title: tr("updater.failed.title"),
              description: message,
              affirmativeText: tr("common.ok"),
            });
          }
        }
      };

      try {
        const { invoke } = await import("@tauri-apps/api/core");
        update = (await invoke<PendingUpdate | null>("check_for_app_update", {
          channel: updateChannel,
        })) as PendingUpdate | null;

        if (!update) {
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
          return;
        }

        setAvailableVersion(update.version);

        if (!manual && readSkippedVersion(updateChannel) === update.version) {
          setStatusText(
            tr("updater.status.available", {
              channel: channelLabel(updateChannel),
              version: update.version,
            }),
          );
          return;
        }

        const approved = await showAlert({
          title: tr("updater.available.title", { version: update.version }),
          description: formatUpdatePrompt(
            update.version,
            updateChannel,
            update.body,
          ),
          affirmativeText: tr("updater.updateNow"),
          negativeText: tr("updater.later"),
        });

        if (!approved) {
          if (!manual) {
            writeSkippedVersion(updateChannel, update.version);
          }
          setStatusText(
            tr("updater.status.available", {
              channel: channelLabel(updateChannel),
              version: update.version,
            }),
          );
          return;
        }

        clearSkippedVersion(updateChannel);
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

        await invoke<string | null>("download_and_install_app_update", {
          channel: updateChannel,
        });

        setAvailableVersion(null);
        setStatusText(tr("updater.status.installed"));

        await showAlert({
          title: tr("updater.installed.title"),
          description: tr("updater.installed.description"),
          affirmativeText: tr("common.ok"),
        });
      } catch (error) {
        if (isMissingUpdaterFeedError(error)) {
          await handleMissingFeedFallback(error);
          return;
        }

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
    [showAlert, updateChannel, updaterEnabled],
  );

  useEffect(() => {
    autoCheckedRef.current = false;
    setAvailableVersion(null);
    setErrorText(null);
    setStatusText(null);
  }, [updateChannel]);

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
    </AppUpdaterContext.Provider>
  );
}

export function useAppUpdater() {
  const context = useContext(AppUpdaterContext);

  if (!context) {
    throw new Error("useAppUpdater must be used within an AppUpdaterProvider");
  }

  return context;
}
