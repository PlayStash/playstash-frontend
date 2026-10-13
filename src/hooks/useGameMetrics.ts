import { createUuid } from "@/utils/uuid";
import { useCallback, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { useOnlineStatus } from "@/context/OfflineContext";
import {
  discardPendingGameEvents,
  enqueueGameEvent,
  flushGameEvents,
  type GameEventType,
} from "@/utils/gameMetrics";

export function useFlushGameMetrics() {
  const { serverUrl, user, authFetch } = useAuth();
  const { isOnline } = useOnlineStatus();
  const key =
    user?.id && serverUrl
      ? `playstash:game-events:${encodeURIComponent(serverUrl)}:${user.id}`
      : "";
  const enabled = user?.report_game_metrics !== false;
  useEffect(() => {
    if (!key) return;
    if (!enabled) {
      discardPendingGameEvents(key);
      return;
    }
    if (!isOnline) return;
    void flushGameEvents(key, serverUrl, authFetch);
    const timer = setInterval(
      () => void flushGameEvents(key, serverUrl, authFetch),
      60_000,
    );
    return () => clearInterval(timer);
  }, [key, serverUrl, authFetch, isOnline, enabled]);
}
export function useGameMetrics() {
  const { serverUrl, user, authFetch } = useAuth();
  const { isOnline } = useOnlineStatus();
  const key =
    user?.id && serverUrl
      ? `playstash:game-events:${encodeURIComponent(serverUrl)}:${user.id}`
      : "";
  const enabled = user?.report_game_metrics !== false;
  return useCallback(
    (
      gameId: number,
      type: GameEventType,
      versionId?: number,
      occurrence?: string,
    ) => {
      if (!key || !enabled) return;
      enqueueGameEvent(
        key,
        `${gameId}:${versionId || ""}:${type}:${occurrence || createUuid()}`,
        gameId,
        type,
        versionId,
      );
      if (isOnline) void flushGameEvents(key, serverUrl, authFetch);
    },
    [key, enabled, isOnline, serverUrl, authFetch],
  );
}
