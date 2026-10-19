import {
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";
import { isTauriApp } from "@/utils/tauri";
import { serverFetch } from "@/utils/serverFetch"; // sends the additional request headers
import { OfflineCtx, type OfflineContextValue } from "@/context/OfflineContext";

const FORCE_OFFLINE_KEY = "playstash_force_offline";

function readForceOffline(): boolean {
  try {
    return localStorage.getItem(FORCE_OFFLINE_KEY) === "1";
  } catch {
    return false;
  }
}

// ── Provider ─────────────────────────────────────────────────────────────────

export function OfflineProvider({ children }: { children: ReactNode }) {
  const isTauri = isTauriApp();
  const [forceOffline, setForceOfflineState] = useState(readForceOffline);
  // The outage simulation starts offline when it was left on.
  const [isOnline, setIsOnline] = useState(() => !forceOffline);
  const [isChecking, setIsChecking] = useState(false);
  const [lastOnlineAt, setLastOnlineAt] = useState<number | null>(null);
  // Read server URL from localStorage (same key as AuthContext)
  const [serverUrl, setServerUrl] = useState<string | null>(() =>
    isTauri ? localStorage.getItem("app_server_url") || null : null,
  );

  const setForceOffline = useCallback((enabled: boolean) => {
    try {
      if (enabled) {
        localStorage.setItem(FORCE_OFFLINE_KEY, "1");
      } else {
        localStorage.removeItem(FORCE_OFFLINE_KEY);
      }
    } catch {
      // localStorage unavailable
    }
    setForceOfflineState(enabled);
    if (enabled) {
      // Force offline state while the outage simulation is active
      setIsOnline(false);
    } else if (!isTauriApp()) {
      // When restoring connectivity in web mode there is no poller to
      // re-check, so optimistically assume we are back online.
      setIsOnline(true);
    }
  }, []);

  const reconnectCallbacksRef = useRef<Set<() => void>>(new Set());
  const wasOfflineRef = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isOnlineRef = useRef(isOnline);

  // Keep ref in sync with state so polling closure always sees latest
  useLayoutEffect(() => {
    isOnlineRef.current = isOnline;
  }, [isOnline]);

  // Follow profile switches to another server (AuthContext SERVER_CHANGED_EVENT).
  useEffect(() => {
    if (!isTauri) return;
    const onServerChanged = (event: Event) => {
      const next = (event as CustomEvent<{ serverUrl?: string }>).detail
        ?.serverUrl;
      if (next) setServerUrl(next);
    };
    window.addEventListener("playstash:server-changed", onServerChanged);
    return () =>
      window.removeEventListener("playstash:server-changed", onServerChanged);
  }, [isTauri]);

  // Background poller
  useEffect(() => {
    if (!isTauri || !serverUrl) return;

    const checkStatus = async () => {
      if (forceOffline) {
        setIsOnline(false);
        return;
      }
      try {
        await serverFetch(`${serverUrl}/api/status`, {
          signal: AbortSignal.timeout(8000),
        });
        if (!isOnlineRef.current) {
          // Transition: offline → online
          console.log(
            "[offline] transition: OFFLINE → ONLINE, firing reconnect callbacks",
          );
          wasOfflineRef.current = true;
        }
        // Leave offline mode again (a no-op re-render while already online).
        setIsOnline(true);
        // Only refresh the timestamp once a minute. Writing it on every 15 s
        // poll forces a new context value (and a re-render of every consumer)
        // four times a minute for no benefit, since the value is informational.
        setLastOnlineAt((previous) =>
          previous !== null && Date.now() - previous < 60_000
            ? previous
            : Date.now(),
        );
      } catch {
        // Network error — server unreachable
        if (isOnlineRef.current) {
          console.log("[offline] transition: ONLINE → OFFLINE");
        }
        setIsOnline(false);
      }
    };

    // Initial check
    checkStatus();

    // Poll every 15 seconds
    intervalRef.current = setInterval(checkStatus, 15_000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isTauri, serverUrl, forceOffline]);

  // Fire reconnect callbacks when transitioning offline → online
  useEffect(() => {
    if (isOnline && wasOfflineRef.current) {
      console.log(
        "[offline] reconnect effect firing, callbacks:",
        reconnectCallbacksRef.current.size,
      );
      wasOfflineRef.current = false;
      reconnectCallbacksRef.current.forEach((cb) => {
        try {
          cb();
        } catch {
          // ignore callback errors
        }
      });
    }
  }, [isOnline]);

  const checkNow = useCallback(() => {
    if (!serverUrl || forceOffline) return;
    setIsChecking(true);
    serverFetch(`${serverUrl}/api/status`, {
      signal: AbortSignal.timeout(8000),
    })
      .then(() => {
        setIsOnline(true);
        setLastOnlineAt(Date.now());
      })
      .catch(() => {
        setIsOnline(false);
      })
      .finally(() => setIsChecking(false));
  }, [serverUrl, forceOffline]);

  const onReconnect = useCallback((cb: () => void) => {
    reconnectCallbacksRef.current.add(cb);
    return () => {
      reconnectCallbacksRef.current.delete(cb);
    };
  }, []);

  // Stable value identity: without this, every provider render handed consumers
  // a brand-new object and re-rendered the whole tree.
  const value = useMemo<OfflineContextValue>(
    () => ({
      isOnline,
      isChecking,
      lastOnlineAt,
      checkNow,
      onReconnect,
      forceOffline,
      setForceOffline,
    }),
    [
      isOnline,
      isChecking,
      lastOnlineAt,
      checkNow,
      onReconnect,
      forceOffline,
      setForceOffline,
    ],
  );

  return <OfflineCtx.Provider value={value}>{children}</OfflineCtx.Provider>;
}
