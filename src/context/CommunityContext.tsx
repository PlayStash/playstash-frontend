/**
 * App-wide community connection (socket.io): presence, activities, the chat
 * transport and chat/activity OS notifications. Port of the WPF
 * `CommunityConnection`, which connected once after login instead of only
 * while the chat page was open.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { io, type Socket } from "socket.io-client";
import { useAuth } from "@/context/AuthContext";
import { useOnlineStatus } from "@/context/OfflineContext";
import { useActiveGames } from "@/hooks/useActiveGames";
import { translate, useTranslation, type TranslationKey } from "@/i18n";
import {
  activityNotification,
  activityPayload,
  applyActivityEvent,
  chatNotification,
  getCommunityNotificationsEnabled,
  loadPresence,
  normalizePresence,
  savePresence,
  type ActivityEntry,
  type ActivityEventName,
  type CommunityPresence,
  type NotificationLabels,
  type OpenConversation,
} from "@/utils/communityNotifications";
import type { ChatMessage } from "@/utils/chat";
import { onGameExited, onGameSession } from "@/utils/gameSessions";
import { isMainWindowFocused, notify } from "@/utils/osNotify";
import { REQUEST_HEADERS_CHANGE_EVENT } from "@/utils/requestHeaders";
import { socketIoHeaderOptions } from "@/utils/serverSocketTransport";
import { isTauriApp } from "@/utils/tauri";

export type CommunityStatus =
  "offline" | "missing-api-key" | "connecting" | "connected" | "unavailable";

const STATUS_TEXT: Record<CommunityStatus, TranslationKey> = {
  offline: "community.status.offline",
  "missing-api-key": "community.status.missingApiKey",
  connecting: "community.status.connecting",
  connected: "community.status.connected",
  unavailable: "community.status.unavailable",
};

/** Delay before reconnecting after a drop or failed attempt (WPF: 5 s). */
export const COMMUNITY_RECONNECT_DELAY_MS = 5_000;

/** Events forwarded from the socket to subscribers. */
const FORWARDED_EVENTS = [
  "activities",
  "activity",
  "remove-activity",
  "chat-history",
  "chat-message",
  "chat-sent",
  "chat-left",
  "exception",
] as const;

/** Pseudo event raised after every (re)connect, after activity publishing. */
export const COMMUNITY_CONNECTED_EVENT = "connected";

/** Events raised by the provider itself, never forwarded from the socket. */
const LOCAL_EVENTS = new Set([
  COMMUNITY_CONNECTED_EVENT,
  "disconnect",
  "connect",
  "connect_error",
]);

type Listener = (payload: any) => void;

export interface CommunityContextValue {
  /** Machine-readable connection status. */
  statusCode: CommunityStatus;
  /** Translated status text, e.g. "Connected to community." */
  status: string;
  connected: boolean;
  /** Visible activities by user id, cleared on disconnect. */
  activities: Map<number, ActivityEntry>;
  presence: CommunityPresence;
  setPresence: (presence: CommunityPresence) => void;
  /** The game the published activity shows as PLAYING (desktop only). */
  playingGameId: number | null;
  /** Throws "Community is offline. Please wait for a connection." when disconnected. */
  emit: (event: string, data?: unknown) => void;
  /** Subscribe to a socket event (or `connected`). Returns the unsubscribe function. */
  on: (event: string, listener: Listener) => () => void;
  /** Reconnect now instead of waiting for the next retry. */
  reconnect: () => void;
  /** The conversation the chat page shows; suppresses its toasts. */
  setOpenConversation: (conversation: OpenConversation) => void;
}

const CommunityContext = createContext<CommunityContextValue | null>(null);

const USER_NAMES_TTL_MS = 5 * 60_000;

export function CommunityProvider({ children }: { children: ReactNode }) {
  const { serverUrl, user, authFetch } = useAuth();
  const { isOnline } = useOnlineStatus();
  const { t } = useTranslation();
  const activeGames = useActiveGames();
  const userId: number | null = user?.id ?? null;
  const apiKey = user?.api_key ?? "";

  const [statusCode, setStatusCode] = useState<CommunityStatus>("offline");
  const [connected, setConnected] = useState(false);
  const [activities, setActivities] = useState<Map<number, ActivityEntry>>(
    () => new Map(),
  );
  const [presence, setPresenceState] = useState<CommunityPresence>(() =>
    loadPresence(serverUrl, userId),
  );
  const [optimisticGameId, setOptimisticGameId] = useState<number | null>(null);

  const socketRef = useRef<Socket | null>(null);
  const listenersRef = useRef(new Map<string, Set<Listener>>());
  const attachedRef = useRef(new Set<string>());
  const presenceRef = useRef(presence);
  presenceRef.current = presence;
  const userIdRef = useRef(userId);
  userIdRef.current = userId;
  const openConversationRef = useRef<OpenConversation>(null);
  const activitiesRef = useRef(activities);
  const snapshotRef = useRef(false);
  const publishedRef = useRef<string | null>(null);
  const playingRef = useRef<number | null>(null);
  const userNamesRef = useRef<{ at: number; names: Map<number, string> }>({
    at: 0,
    names: new Map(),
  });
  const tRef = useRef(t);
  tRef.current = t;

  // ── Presence: reload the saved value for the signed-in account ──────────
  useEffect(() => {
    setPresenceState(loadPresence(serverUrl, userId));
  }, [serverUrl, userId]);

  // ── Playing game (desktop only, tracker based + optimistic launch) ───────
  const trackedGameId = isTauriApp() ? (activeGames[0]?.gameId ?? null) : null;
  useEffect(() => {
    // The tracker is authoritative once it reports a game.
    if (trackedGameId != null) setOptimisticGameId(null);
  }, [trackedGameId]);
  useEffect(() => {
    if (!isTauriApp()) return;
    let disposed = false;
    const unlisteners: (() => void)[] = [];
    const keep = (promise: Promise<() => void>) =>
      promise
        .then((unlisten) => {
          if (disposed) unlisten();
          else unlisteners.push(unlisten);
        })
        .catch(() => undefined);
    keep(
      onGameSession((event) => {
        if (event.state === "started") setOptimisticGameId(event.gameId);
        else
          setOptimisticGameId((current) =>
            current === event.gameId ? null : current,
          );
      }),
    );
    keep(
      onGameExited((event) =>
        setOptimisticGameId((current) =>
          current === event.gameId ? null : current,
        ),
      ),
    );
    return () => {
      disposed = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, []);
  const playingGameId = isTauriApp()
    ? (trackedGameId ?? optimisticGameId)
    : null;
  playingRef.current = playingGameId;

  // ── Publishing ───────────────────────────────────────────────────────────
  const publish = useCallback((force = false) => {
    const socket = socketRef.current;
    if (!socket?.connected) return;
    const payload = activityPayload(presenceRef.current, playingRef.current);
    const key = JSON.stringify(payload);
    if (!force && publishedRef.current === key) return;
    publishedRef.current = key;
    socket.emit("set-activity", payload);
  }, []);

  useEffect(() => {
    publish();
  }, [presence, playingGameId, publish]);

  const setPresence = useCallback(
    (next: CommunityPresence) => {
      const value = normalizePresence(next);
      savePresence(serverUrl, userIdRef.current, value);
      presenceRef.current = value;
      setPresenceState(value);
      publish();
    },
    [serverUrl, publish],
  );

  // ── Event fan-out ────────────────────────────────────────────────────────
  const dispatch = useCallback((event: string, payload: unknown) => {
    listenersRef.current.get(event)?.forEach((listener) => {
      try {
        listener(payload);
      } catch (error) {
        console.error(`Community listener for ${event} failed:`, error);
      }
    });
  }, []);

  const attach = useCallback(
    (socket: Socket, event: string) => {
      if (LOCAL_EVENTS.has(event) || attachedRef.current.has(event)) return;
      attachedRef.current.add(event);
      socket.on(event, (payload: unknown) => dispatch(event, payload));
    },
    [dispatch],
  );

  const on = useCallback(
    (event: string, listener: Listener) => {
      const listeners = listenersRef.current;
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(listener);
      if (socketRef.current) attach(socketRef.current, event);
      return () => {
        listeners.get(event)?.delete(listener);
      };
    },
    [attach],
  );

  const emit = useCallback((event: string, data?: unknown) => {
    const socket = socketRef.current;
    if (!socket?.connected)
      throw new Error(translate("community.error.offline"));
    socket.emit(event, data ?? {});
  }, []);

  const reconnect = useCallback(() => {
    const socket = socketRef.current;
    if (socket && !socket.connected) socket.connect();
  }, []);

  const setOpenConversation = useCallback((conversation: OpenConversation) => {
    openConversationRef.current = conversation;
  }, []);

  // ── Notifications (desktop) ──────────────────────────────────────────────
  const labels = (): NotificationLabels => ({
    chatTitle: tRef.current("community.notify.chatTitle"),
    activityTitle: tRef.current("community.notify.activityTitle"),
    unknownUser: tRef.current("community.userFallback"),
  });

  const userName = useCallback(
    async (id: number): Promise<string | null> => {
      const cache = userNamesRef.current;
      if (Date.now() - cache.at > USER_NAMES_TTL_MS || !cache.names.has(id)) {
        try {
          const response = await authFetch(
            `${serverUrl.replace(/\/+$/, "")}/api/users`,
          );
          if (response.ok) {
            const list = (await response.json()) as {
              id: number;
              username: string;
            }[];
            userNamesRef.current = {
              at: Date.now(),
              names: new Map(
                (Array.isArray(list) ? list : []).map((entry) => [
                  entry.id,
                  entry.username,
                ]),
              ),
            };
          }
        } catch {
          // Fall back to "User #<id>".
        }
      }
      return userNamesRef.current.names.get(id) ?? null;
    },
    [authFetch, serverUrl],
  );

  const handleActivity = useCallback(
    (event: ActivityEventName, payload: unknown) => {
      const hadSnapshot = snapshotRef.current;
      const update = applyActivityEvent(
        activitiesRef.current,
        hadSnapshot,
        event,
        payload,
      );
      activitiesRef.current = update.activities;
      snapshotRef.current = update.snapshotReceived;
      setActivities(update.activities);
      if (!isTauriApp() || !update.changed) return;
      const enabled = getCommunityNotificationsEnabled("activity");
      const base = {
        update,
        snapshotReceived: hadSnapshot,
        ownUserId: userIdRef.current,
        presence: presenceRef.current,
        enabled,
      };
      if (!activityNotification(base)) return;
      void userName(update.changed.userId).then((username) => {
        const content = activityNotification({
          ...base,
          username,
          labels: labels(),
        });
        if (content) void notify({ ...content, tag: "community-activity" });
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [userName],
  );

  const handleChatMessage = useCallback(async (message: ChatMessage) => {
    if (!isTauriApp() || !message) return;
    const base = {
      message,
      ownUserId: userIdRef.current,
      presence: presenceRef.current,
      enabled: getCommunityNotificationsEnabled("chat"),
      openConversation: openConversationRef.current,
    };
    // Cheap checks first; the focus query is async.
    if (!chatNotification({ ...base, windowFocused: false })) return;
    const content = chatNotification({
      ...base,
      windowFocused: await isMainWindowFocused().catch(() => false),
      labels: labels(),
    });
    if (content) void notify({ ...content, tag: "community-chat" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Connection lifecycle ────────────────────────────────────────────────
  const [headersVersion, setHeadersVersion] = useState(0);
  useEffect(() => {
    const onChange = () => setHeadersVersion((version) => version + 1);
    window.addEventListener(REQUEST_HEADERS_CHANGE_EVENT, onChange);
    return () =>
      window.removeEventListener(REQUEST_HEADERS_CHANGE_EVENT, onChange);
  }, []);
  const canConnect = Boolean(isOnline && userId && apiKey && serverUrl);
  useEffect(() => {
    const reset = () => {
      activitiesRef.current = new Map();
      snapshotRef.current = false;
      publishedRef.current = null;
      setActivities(new Map());
      setConnected(false);
    };
    if (!canConnect) {
      reset();
      openConversationRef.current = null;
      setOptimisticGameId(null);
      setStatusCode(
        user && !apiKey && isOnline ? "missing-api-key" : "offline",
      );
      return;
    }

    const socket = io(serverUrl, {
      auth: { api_key: apiKey },
      autoConnect: false,
      reconnectionDelay: COMMUNITY_RECONNECT_DELAY_MS,
      reconnectionDelayMax: COMMUNITY_RECONNECT_DELAY_MS,
      randomizationFactor: 0,
      // Additional request headers: polling through the desktop app (browser
      // WebSockets cannot carry them, see serverSocketTransport.ts).
      ...socketIoHeaderOptions(),
    });
    socketRef.current = socket;
    attachedRef.current = new Set();
    let disposed = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRetry = () => {
      if (retryTimer || disposed) return;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        if (!disposed && !socket.connected) {
          setStatusCode("connecting");
          socket.connect();
        }
      }, COMMUNITY_RECONNECT_DELAY_MS);
    };

    socket.on("connect", () => {
      if (disposed) return;
      setStatusCode("connected");
      setConnected(true);
      socket.emit("get-activities", {});
      publish(true);
      dispatch(COMMUNITY_CONNECTED_EVENT, undefined);
    });
    socket.on("disconnect", (reason: string) => {
      if (disposed) return;
      reset();
      setStatusCode("unavailable");
      dispatch("disconnect", reason);
      // socket.io only reconnects by itself after transport errors; the
      // WPF client always retried after 5 s.
      if (reason === "io server disconnect") scheduleRetry();
    });
    socket.on("connect_error", () => {
      if (disposed) return;
      reset();
      setStatusCode("unavailable");
      if (!socket.active) scheduleRetry();
    });

    socket.on("activities", (payload: unknown) =>
      handleActivity("activities", payload),
    );
    socket.on("activity", (payload: unknown) =>
      handleActivity("activity", payload),
    );
    socket.on("remove-activity", (payload: unknown) =>
      handleActivity("remove-activity", payload),
    );
    socket.on("chat-message", (payload: ChatMessage) => {
      void handleChatMessage(payload);
    });
    // Automatic reconnect attempts show "Connecting…" like the WPF loop.
    socket.io?.on?.("reconnect_attempt", () => {
      if (!disposed) setStatusCode("connecting");
    });
    for (const event of FORWARDED_EVENTS) attach(socket, event);
    for (const event of listenersRef.current.keys()) attach(socket, event);

    setStatusCode("connecting");
    socket.connect();
    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      socket.disconnect();
      if (socketRef.current === socket) socketRef.current = null;
      reset();
      openConversationRef.current = null;
      setStatusCode("offline");
    };
    // Reconnect only when the account, server, key, connectivity or the
    // additional request headers change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canConnect, serverUrl, userId, apiKey, headersVersion]);

  const value = useMemo<CommunityContextValue>(
    () => ({
      statusCode,
      status: t(STATUS_TEXT[statusCode]),
      connected,
      activities,
      presence,
      setPresence,
      playingGameId,
      emit,
      on,
      reconnect,
      setOpenConversation,
    }),
    [
      statusCode,
      t,
      connected,
      activities,
      presence,
      setPresence,
      playingGameId,
      emit,
      on,
      reconnect,
      setOpenConversation,
    ],
  );

  return (
    <CommunityContext.Provider value={value}>
      {children}
    </CommunityContext.Provider>
  );
}

export function useCommunity(): CommunityContextValue {
  const context = useContext(CommunityContext);
  if (!context)
    throw new Error("useCommunity must be used within CommunityProvider");
  return context;
}
