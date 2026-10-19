import { createContext, useContext } from "react";

// ── Types ────────────────────────────────────────────────────────────────────

export interface OfflineContextValue {
  /** Whether the server is currently reachable */
  isOnline: boolean;
  /** Whether a status check is in-flight */
  isChecking: boolean;
  /** Timestamp (ms) of last successful status check */
  lastOnlineAt: number | null;
  /** Force an immediate status check */
  checkNow: () => void;
  /** Registered callbacks invoked when transitioning offline → online */
  onReconnect: (cb: () => void) => () => void;
  /** Dev-only: simulate a network outage (forces offline state on/off) */
  forceOffline: boolean;
  setForceOffline: (enabled: boolean) => void;
}

export const OfflineCtx = createContext<OfflineContextValue>({
  isOnline: true,
  isChecking: false,
  lastOnlineAt: null,
  checkNow: () => {},
  onReconnect: () => () => {},
  forceOffline: false,
  setForceOffline: () => {},
});

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useOnlineStatus() {
  return useContext(OfflineCtx);
}
