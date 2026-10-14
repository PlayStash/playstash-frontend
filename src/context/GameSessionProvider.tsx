import { useEffect, type ReactNode } from "react";
import { useAuth } from "@/context/AuthContext";
import { useGameMetrics } from "@/hooks/useGameMetrics";
import {
  applySessionEvent,
  applySnapshot,
  resetActiveGames,
  updateActiveGames,
} from "@/utils/activeGames";
import {
  openFullscreenLibrary,
  readBigPictureOnStart,
} from "@/utils/bigPictureInstalled";
import { setGameEventReporter } from "@/utils/gameEventReporter";
import { getActiveGameSessions, onGameSession } from "@/utils/gameSessions";
import { isTauriApp } from "@/utils/tauri";

/** How often the running games are re-read from the tracker. */
const RESYNC_INTERVAL_MS = 60_000;

/**
 * Keeps the shared "running games" store (`useActiveGames`) in sync with the
 * time tracker and makes game metrics available to the launch and uninstall
 * paths, which run outside React (desktop commands).
 */
export function GameSessionProvider({ children }: { children: ReactNode }) {
  const reportGameEvent = useGameMetrics();

  useEffect(() => setGameEventReporter(reportGameEvent), [reportGameEvent]);

  useEffect(() => {
    if (!isTauriApp()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;

    const resync = async () => {
      try {
        const sessions = await getActiveGameSessions();
        if (!disposed) {
          updateActiveGames((state) =>
            applySnapshot(state, sessions, Date.now()),
          );
        }
      } catch {
        // Simulated desktop mode or an older backend: keep the event state.
      }
    };

    void onGameSession((event) => {
      updateActiveGames((state) => applySessionEvent(state, event, Date.now()));
    })
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch(() => undefined);

    void resync();
    const timer = window.setInterval(() => void resync(), RESYNC_INTERVAL_MS);

    return () => {
      disposed = true;
      window.clearInterval(timer);
      unlisten?.();
      resetActiveGames();
    };
  }, []);

  return <>{children}</>;
}

let startupApplied = false;

/**
 * "Open fullscreen library when the client starts": switches to Big Picture
 * once per app start, right after the user is signed in (or started offline).
 */
export function BigPictureStartupEffect() {
  const { user, bootstrapping } = useAuth();

  useEffect(() => {
    if (!isTauriApp() || bootstrapping || !user) return;
    if (startupApplied) return;
    startupApplied = true;
    if (!readBigPictureOnStart()) return;
    void openFullscreenLibrary().catch(() => undefined);
  }, [user, bootstrapping]);

  return null;
}
