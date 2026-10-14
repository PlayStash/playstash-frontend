import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";
import { useAuth } from "@/context/AuthContext";
import { useOnlineStatus } from "@/context/OfflineContext";
import { useAlertDialog } from "@/context/AlertDialogContext";
import { useDownloads } from "@/context/DownloadContext";
import { useTranslation, type TranslationKey } from "@/i18n";
import { useJumpList } from "@/hooks/useJumpList";
import { isTauriApp } from "@/utils/tauri";
import { getRootPaths } from "@/utils/rootPaths";
import { setCurrentRoute } from "@/utils/osNotify";
import {
  DESKTOP_COMMAND_EVENT,
  DESKTOP_EXIT_REQUESTED_EVENT,
  markDesktopCommandsNotReady,
  markDesktopCommandsReady,
  type DesktopCommand,
} from "@/utils/desktopCommands";
import { runDesktopCommand, type DesktopCommandDeps } from "@/utils/deepLink";
import { requestGameDownload } from "@/utils/downloadFlow";
import { launchInstalledGame } from "@/utils/launchInstalledGame";
import { uninstallInstalledGame } from "@/utils/uninstallInstalledGame";

/** Native labels (tray, jump list, notices) in the current language. */
export function trayLabels(t: (key: TranslationKey) => string) {
  return {
    library: t("wp1.tray.library"),
    downloads: t("wp1.tray.downloads"),
    community: t("wp1.tray.community"),
    settings: t("wp1.tray.settings"),
    exit: t("wp1.tray.exit"),
    libraryDescription: t("wp1.tray.libraryDescription"),
    downloadsDescription: t("wp1.tray.downloadsDescription"),
    communityDescription: t("wp1.tray.communityDescription"),
    settingsDescription: t("wp1.tray.settingsDescription"),
    exitDescription: t("wp1.tray.exitDescription"),
    actionsCategory: t("wp1.jumpList.actions"),
    lastPlayedCategory: t("wp1.jumpList.lastPlayed"),
    noticeTitle: t("wp1.tray.noticeTitle"),
    noticeBody: t("wp1.tray.noticeBody"),
    exitConfirm: t("wp1.exit.downloadsRunning"),
  };
}

async function invokeSafe(command: string, args?: Record<string, unknown>) {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke(command, args);
  } catch (error) {
    console.warn(`[desktop] ${command} failed:`, error);
    return undefined;
  }
}

/**
 * Receives desktop commands (CLI, `playstash://` links, Playnite, jump list,
 * tray) and runs them in the UI. Desktop only; renders its children as is.
 *
 * - Opens the Rust ready gate once the auth bootstrap is done (logged in or
 *   offline-bootstrapped) and the listener is attached; closes it on logout.
 * - Pushes the session context Rust needs for the query API.
 * - Confirms exiting while downloads run, keeps the native labels in the
 *   current language, tracks the route for `currentRoute()` and keeps the
 *   jump list in sync.
 */
export function DesktopCommandProvider({ children }: { children: ReactNode }) {
  const desktop = isTauriApp();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, bootstrapping, serverUrl, auth, authFetch } = useAuth();
  const { isOnline } = useOnlineStatus();
  const { showAlert } = useAlertDialog();
  const downloads = useDownloads();
  const { t, locale } = useTranslation();
  const [listening, setListening] = useState(false);

  // Latest values for the long-lived event listeners.
  const latest = useRef({
    navigate,
    user,
    serverUrl,
    authFetch,
    isOnline,
    showAlert,
    downloads,
    t,
  });
  latest.current = {
    navigate,
    user,
    serverUrl,
    authFetch,
    isOnline,
    showAlert,
    downloads,
    t,
  };

  const signedIn = !bootstrapping && !!user;
  useJumpList(desktop && signedIn, location.pathname);

  // Route tracking for currentRoute() (notifications suppress themselves on
  // the page they are about).
  useEffect(() => {
    setCurrentRoute(location.pathname);
  }, [location.pathname]);

  // Desktop command and exit listeners.
  useEffect(() => {
    if (!desktop) return;
    let disposed = false;
    const unlisteners: Array<() => void> = [];
    let chain: Promise<void> = Promise.resolve();

    const deps: DesktopCommandDeps = {
      navigate: (path) => latest.current.navigate(path),
      userRole: () => (latest.current.user as any)?.role,
      gameExists: async (gameId) => {
        const {
          serverUrl: url,
          authFetch: fetcher,
          isOnline: online,
          user: current,
        } = latest.current;
        if (online && current && url) {
          try {
            const response = await fetcher(
              `${url.replace(/\/+$/, "")}/api/games/${gameId}`,
            );
            if (response.ok) return true;
          } catch {
            // Fall back to the offline cache.
          }
        }
        const cached = await invokeSafe("load_cached_game", { gameId });
        return typeof cached === "string" && cached.length > 0;
      },
      alert: async (message) => {
        await latest.current.showAlert({
          title: message,
          tone: "danger",
        });
      },
      gameNotFoundMessage: (gameId) =>
        latest.current
          .t("wp1.command.gameNotFound")
          .replace("{id}", String(gameId)),
      requestGameDownload,
      uninstallInstalledGame,
      launchInstalledGame,
    };

    const handle = (command: DesktopCommand) => {
      chain = chain.then(async () => {
        let ok = false;
        let message: string | undefined;
        try {
          const outcome = await runDesktopCommand(command, deps);
          ok = outcome.ok;
          message = outcome.message;
        } catch (error) {
          message = error instanceof Error ? error.message : String(error);
          console.error("[desktop] command failed:", command, error);
          await latest.current.showAlert({
            title: latest.current.t("wp1.command.failed"),
            description: message,
            tone: "danger",
          });
        }
        await invokeSafe("desktop_command_done", {
          id: command.id,
          ok,
          message: message ?? null,
        });
      });
    };

    const confirmExit = async () => {
      const {
        showAlert: ask,
        t: translate,
        downloads: current,
      } = latest.current;
      const accepted = await ask({
        title: translate("wp1.exit.downloadsRunning"),
        affirmativeText: translate("wp1.common.yes"),
        negativeText: translate("wp1.common.no"),
      });
      if (!accepted) return;
      try {
        const withCancelAll = current as typeof current & {
          cancelAllDownloads?: () => void | Promise<void>;
        };
        if (typeof withCancelAll.cancelAllDownloads === "function") {
          await withCancelAll.cancelAllDownloads();
        } else {
          for (const [gameId, download] of Object.entries(current.downloads)) {
            if (download?.status === "downloading") {
              current.cancelDownload(Number(gameId));
            }
          }
        }
      } finally {
        await invokeSafe("exit_app");
      }
    };

    void (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        const offCommand = await listen<DesktopCommand>(
          DESKTOP_COMMAND_EVENT,
          (event) => handle(event.payload),
        );
        const offExit = await listen(DESKTOP_EXIT_REQUESTED_EVENT, () => {
          void confirmExit();
        });
        if (disposed) {
          offCommand();
          offExit();
          return;
        }
        unlisteners.push(offCommand, offExit);
        await invokeSafe("desktop_frontend_attached");
        setListening(true);
      } catch (error) {
        console.warn("[desktop] cannot listen for desktop commands:", error);
      }
    })();

    return () => {
      disposed = true;
      unlisteners.forEach((off) => off());
      setListening(false);
    };
  }, [desktop]);

  // Ready gate: commands queue in Rust until the session is usable and the
  // listener is attached; logout queues them again.
  const wasReadyRef = useRef(false);
  const ready = desktop && listening && signedIn;
  useEffect(() => {
    if (!desktop) return;
    if (ready) {
      wasReadyRef.current = true;
      markDesktopCommandsReady().catch((error) =>
        console.warn("[desktop] desktop_commands_ready failed:", error),
      );
    } else if (wasReadyRef.current && !signedIn) {
      wasReadyRef.current = false;
      markDesktopCommandsNotReady().catch((error) =>
        console.warn("[desktop] desktop_commands_not_ready failed:", error),
      );
    }
  }, [desktop, ready, signedIn]);

  // A start that kept the window hidden (autostart, `start --gameid`,
  // `minimized=true`) still needs the window when a login is required.
  const loginCheckedRef = useRef(false);
  useEffect(() => {
    if (!desktop || bootstrapping || loginCheckedRef.current) return;
    loginCheckedRef.current = true;
    if (!user) void invokeSafe("show_main_window");
  }, [desktop, bootstrapping, user]);

  // Session context for the query API (Playnite) and installed checks.
  const accessToken = auth?.access_token ?? null;
  const userId = (user as any)?.id ?? null;
  useEffect(() => {
    if (!desktop) return;
    void invokeSafe("set_desktop_context", {
      context: {
        roots: getRootPaths().map((root) => root.path),
        serverUrl: user ? serverUrl : "",
        userId: typeof userId === "number" ? userId : null,
        accessToken: user && isOnline ? accessToken : null,
        loggedIn: !!user && !!accessToken && isOnline,
      },
    });
  }, [
    desktop,
    user,
    userId,
    serverUrl,
    accessToken,
    isOnline,
    location.pathname,
  ]);

  // Native labels follow the interface language.
  useEffect(() => {
    if (!desktop) return;
    void invokeSafe("set_tray_labels", { labels: trayLabels(t) });
    // `t` is recreated on every render; the locale is what matters.
  }, [desktop, locale]);

  return <>{children}</>;
}
