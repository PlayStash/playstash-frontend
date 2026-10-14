import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { useAuth } from "@/context/AuthContext";
import { useOnlineStatus } from "@/context/OfflineContext";
import { useCommunity } from "@/context/CommunityContext";
import { useTranslation } from "@/i18n";
import { Button } from "@/components/tailwind/button";
import { Input } from "@/components/tailwind/input";
import { Textarea } from "@/components/tailwind/textarea";
import { Heading } from "@/components/tailwind/heading";
import {
  chatConversation,
  mergeChatMessages,
  messageInConversation,
  type ChatMessage,
  type ChatTarget,
} from "@/utils/chat";
import {
  chatTargetFromParams,
  chatTargetParams,
  gameIdFromRoom,
} from "@/utils/chatLinks";
import {
  ACTIVITY_STATE_LABELS,
  COMMUNITY_PRESENCES,
  normalizePresence,
  type CommunityPresence,
} from "@/utils/communityNotifications";
import { fetchGameTitle } from "@/utils/gameTitles";
import { createUuid } from "@/utils/uuid";

interface ChatUser {
  id: number;
  username: string;
  activated?: boolean;
}

type ConversationType = "lobby" | "this-game" | "game" | "direct";

const PRESENCE_LABEL = {
  ONLINE: "chat.presence.online",
  BUSY: "chat.presence.busy",
  INVISIBLE: "chat.presence.invisible",
} as const;

/** Server-side request timeout for history and sends. */
const RESPONSE_TIMEOUT_MS = 12_000;

function targetKey(target: ChatTarget): string {
  return target.recipient_user_id
    ? `dm:${target.recipient_user_id}`
    : target.room || "lobby";
}

export default function Chat() {
  const { serverUrl, user, authFetch } = useAuth();
  const { isOnline } = useOnlineStatus();
  const {
    connected,
    status,
    emit,
    on,
    presence,
    setPresence,
    activities,
    setOpenConversation,
    reconnect,
  } = useCommunity();
  const { t, locale } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const search = searchParams.toString();
  const linkTarget = useMemo(
    () => chatTargetFromParams(new URLSearchParams(search)),
    [search],
  );
  const linkedGameId = gameIdFromRoom(linkTarget.room);

  const [target, setTarget] = useState<ChatTarget>(linkTarget);
  const targetRef = useRef(target);
  targetRef.current = target;
  // The game this page was opened for keeps its "This game" entry.
  const [thisGameId, setThisGameId] = useState<number | null>(linkedGameId);
  const [type, setType] = useState<ConversationType>(
    linkTarget.recipient_user_id
      ? "direct"
      : linkedGameId
        ? "this-game"
        : "lobby",
  );
  const [gameId, setGameId] = useState("");
  const [recipient, setRecipient] = useState(
    linkTarget.recipient_user_id ? String(linkTarget.recipient_user_id) : "",
  );
  const [users, setUsers] = useState<ChatUser[]>([]);
  const [gameTitles, setGameTitles] = useState<Map<number, string>>(
    () => new Map(),
  );
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<{
    id: string;
    text: string;
    target: ChatTarget;
  } | null>(null);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const [waiting, setWaiting] = useState(false);
  const sendTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const historyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ownId = user?.id ?? 0;

  const clearTimers = () => {
    if (sendTimer.current) clearTimeout(sendTimer.current);
    if (historyTimer.current) clearTimeout(historyTimer.current);
  };

  // ── Follow the URL (?room=lobby, ?room=game:<id>, ?user=<id>) ───────────
  useEffect(() => {
    setTarget((current) =>
      targetKey(current) === targetKey(linkTarget) ? current : linkTarget,
    );
    const linkedGame = gameIdFromRoom(linkTarget.room);
    if (linkTarget.recipient_user_id) {
      setType("direct");
      setRecipient(String(linkTarget.recipient_user_id));
    } else if (linkedGame) {
      setThisGameId(linkedGame);
      setType((current) =>
        current === "game" && Number(gameId) === linkedGame
          ? "game"
          : "this-game",
      );
    } else {
      setType("lobby");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkTarget]);

  // ── Users (names, direct message targets) ───────────────────────────────
  useEffect(() => {
    let cancelled = false;
    void authFetch(`${serverUrl}/api/users`)
      .then(async (response) => {
        if (response.ok && !cancelled) {
          const list = (await response.json()) as ChatUser[];
          setUsers(
            (Array.isArray(list) ? list : []).slice().sort((a, b) =>
              a.username.localeCompare(b.username, undefined, {
                sensitivity: "base",
              }),
            ),
          );
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [serverUrl, authFetch]);
  const userNames = useMemo(
    () => new Map(users.map((entry) => [entry.id, entry.username])),
    [users],
  );
  const directUsers = useMemo(
    () =>
      users.filter((entry) => entry.id !== ownId && entry.activated !== false),
    [users, ownId],
  );

  // ── Game titles for "This game" and the activity list ───────────────────
  const neededGameIds = useMemo(() => {
    const ids = new Set<number>();
    if (thisGameId) ids.add(thisGameId);
    const room = gameIdFromRoom(target.room);
    if (room) ids.add(room);
    for (const entry of activities.values())
      if (entry.gameId) ids.add(entry.gameId);
    return [...ids].sort((a, b) => a - b);
  }, [activities, thisGameId, target.room]);
  useEffect(() => {
    let cancelled = false;
    for (const id of neededGameIds) {
      if (gameTitles.has(id)) continue;
      void fetchGameTitle(authFetch, serverUrl, id).then((title) => {
        if (!cancelled && title)
          setGameTitles((previous) => new Map(previous).set(id, title));
      });
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [neededGameIds.join(","), authFetch, serverUrl]);
  const gameLabel = (id: number) =>
    gameTitles.get(id) ??
    t("community.gameFallback").replace("{id}", String(id));

  // ── Socket events ────────────────────────────────────────────────────────
  useEffect(() => {
    const accept = (message: ChatMessage) => {
      if (message && messageInConversation(message, targetRef.current, ownId))
        setMessages((previous) => mergeChatMessages(previous, [message]));
    };
    const offs = [
      on(
        "chat-history",
        (history: { conversation: string; messages: ChatMessage[] }) => {
          if (
            history?.conversation !== chatConversation(targetRef.current, ownId)
          )
            return;
          if (historyTimer.current) clearTimeout(historyTimer.current);
          setMessages((previous) =>
            mergeChatMessages(
              Array.isArray(history.messages) ? history.messages : [],
              previous,
            ),
          );
          setLoading(false);
          setError("");
        },
      ),
      on("chat-message", accept),
      on("chat-sent", (message: ChatMessage) => {
        accept(message);
        if (message?.client_message_id === pendingRef.current?.id) {
          if (sendTimer.current) clearTimeout(sendTimer.current);
          setPending(null);
          setWaiting(false);
          setText("");
          setError("");
        }
      }),
      on("exception", (exception: { message?: string | string[] }) => {
        clearTimers();
        setLoading(false);
        setWaiting(false);
        setError(
          Array.isArray(exception?.message)
            ? exception.message.join(" ")
            : exception?.message || t("chat.error.rejected"),
        );
      }),
    ];
    return () => offs.forEach((off) => off());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, ownId]);

  // ── Open conversation: history, toast suppression, leave ────────────────
  const key = targetKey(target);
  const firstKey = useRef(key);
  useEffect(() => {
    if (firstKey.current === key) return;
    firstKey.current = key;
    // A different conversation: drop the old messages and unsent state.
    if (sendTimer.current) clearTimeout(sendTimer.current);
    setPending(null);
    setWaiting(false);
    setMessages([]);
    setError("");
  }, [key]);
  useEffect(() => {
    setOpenConversation(target);
    return () => setOpenConversation(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, setOpenConversation]);

  useEffect(() => {
    if (!connected) {
      setLoading(false);
      return;
    }
    const current = target;
    setLoading(true);
    if (historyTimer.current) clearTimeout(historyTimer.current);
    try {
      emit("chat-history", { ...current, limit: 100 });
      historyTimer.current = setTimeout(() => {
        setLoading(false);
        setError(t("chat.error.noResponse"));
      }, RESPONSE_TIMEOUT_MS);
    } catch (reason) {
      setLoading(false);
      setError(reason instanceof Error ? reason.message : String(reason));
    }
    return () => {
      try {
        emit("chat-leave", current);
      } catch {
        // Already disconnected: the server dropped the subscription.
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, connected]);

  useEffect(() => () => clearTimers(), []);

  const send = () => {
    if (!connected) return;
    const message = pending || { id: createUuid(), text: text.trim(), target };
    if (!message.text) return;
    setPending(message);
    pendingRef.current = message;
    setWaiting(true);
    setError("");
    try {
      emit("chat-send", {
        ...message.target,
        text: message.text,
        client_message_id: message.id,
      });
    } catch (reason) {
      setWaiting(false);
      setError(reason instanceof Error ? reason.message : String(reason));
      return;
    }
    if (sendTimer.current) clearTimeout(sendTimer.current);
    sendTimer.current = setTimeout(() => {
      setWaiting(false);
      setError(t("chat.error.unconfirmed"));
    }, RESPONSE_TIMEOUT_MS);
  };

  const open = () => {
    const next: ChatTarget =
      type === "this-game" && thisGameId
        ? { room: `game:${thisGameId}` }
        : type === "game"
          ? { room: `game:${Number(gameId)}` }
          : type === "direct"
            ? { recipient_user_id: Number(recipient) }
            : { room: "lobby" };
    setTarget(next);
    setSearchParams(chatTargetParams(next), { replace: true });
  };

  const validTarget =
    type === "lobby" ||
    (type === "this-game" && !!thisGameId) ||
    (type === "game"
      ? Number.isInteger(Number(gameId)) && Number(gameId) > 0
      : type === "direct" && Number(recipient) > 0);

  const activityRows = useMemo(
    () =>
      [...activities.entries()]
        .map(([userId, entry]) => {
          const name =
            userNames.get(userId) ??
            t("community.userFallback").replace("{id}", String(userId));
          const rawState = entry.state || "ONLINE";
          const state = ACTIVITY_STATE_LABELS[rawState]
            ? t(ACTIVITY_STATE_LABELS[rawState])
            : rawState;
          const game = entry.gameId ? ` — ${gameLabel(entry.gameId)}` : "";
          return {
            userId,
            name,
            detail: `${state}${game}`,
            display: `${name}\n${state}${game}`,
          };
        })
        .sort((a, b) => a.display.localeCompare(b.display)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activities, userNames, gameTitles, t],
  );

  const currentLabel = target.recipient_user_id
    ? t("chat.current.direct").replace(
        "{name}",
        userNames.get(target.recipient_user_id) ??
          String(target.recipient_user_id),
      )
    : target.room === "lobby" || !target.room
      ? t("chat.current.lobby")
      : t("chat.current.game").replace(
          "{title}",
          gameLabel(gameIdFromRoom(target.room) ?? 0),
        );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Heading>{t("chat.title")}</Heading>
          <p className="mt-2 max-w-2xl text-sm text-ps-muted">
            {t("chat.description")}
          </p>
        </div>
        <label className="text-sm text-ps-muted">
          {t("chat.presence")}
          <select
            aria-label={t("chat.presence")}
            value={presence}
            className="mt-1 block min-h-11 rounded-lg bg-ps-panel px-3 text-ps-text"
            onChange={(event) =>
              setPresence(
                normalizePresence(event.target.value) as CommunityPresence,
              )
            }
          >
            {COMMUNITY_PRESENCES.map((value) => (
              <option key={value} value={value}>
                {t(PRESENCE_LABEL[value])}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs">{t("chat.presenceHint")}</span>
        </label>
      </div>
      <form
        className="surface-panel flex flex-wrap items-end gap-3 rounded-2xl p-4"
        onSubmit={(event) => {
          event.preventDefault();
          open();
        }}
      >
        <label className="text-sm text-ps-muted">
          {t("chat.conversation")}
          <select
            aria-label={t("chat.conversation")}
            value={type}
            className="mt-1 block min-h-11 rounded-lg bg-ps-panel-soft px-3 text-ps-text"
            onChange={(event) =>
              setType(event.target.value as ConversationType)
            }
          >
            <option value="lobby">{t("chat.type.lobby")}</option>
            {thisGameId && (
              <option value="this-game">
                {t("chat.type.thisGame").replace(
                  "{title}",
                  gameLabel(thisGameId),
                )}
              </option>
            )}
            <option value="game">{t("chat.type.game")}</option>
            <option value="direct">{t("chat.type.direct")}</option>
          </select>
        </label>
        {type === "game" && (
          <label className="text-sm text-ps-muted">
            {t("chat.gameId")}
            <Input
              type="number"
              min={1}
              value={gameId}
              onChange={(event) => setGameId(event.target.value)}
            />
          </label>
        )}
        {type === "direct" && (
          <label className="text-sm text-ps-muted">
            {t("chat.recipient")}
            <select
              aria-label={t("chat.recipient")}
              value={recipient}
              className="mt-1 block min-h-11 rounded-lg bg-ps-panel-soft px-3 text-ps-text"
              onChange={(event) => setRecipient(event.target.value)}
            >
              <option value="">{t("chat.chooseUser")}</option>
              {directUsers.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.username}
                </option>
              ))}
            </select>
          </label>
        )}
        <Button
          type="submit"
          outline
          disabled={!connected || !validTarget || waiting || !!pending}
        >
          {t("chat.open")}
        </Button>
      </form>
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <span>
          {currentLabel} · {status}
        </span>
        <span className="text-ps-muted">
          {t("chat.visibleUsers").replace(
            "{count}",
            String(
              [...activities.entries()].filter(
                ([userId, entry]) =>
                  userId !== ownId && entry.state !== "INVISIBLE",
              ).length,
            ),
          )}
        </span>
        {!connected && isOnline && !!user?.api_key && (
          <Button outline onClick={reconnect}>
            {t("chat.reconnect")}
          </Button>
        )}
      </div>
      <p className="text-xs text-ps-muted">{t("chat.info")}</p>
      <div className="grid gap-4 md:grid-cols-[210px_minmax(0,1fr)]">
        <section
          className="surface-panel space-y-2 rounded-2xl p-4"
          aria-label={t("chat.activity.title")}
        >
          <h2 className="text-base font-semibold text-ps-text">
            {t("chat.activity.title")}
          </h2>
          {activityRows.length === 0 ? (
            <p className="text-xs text-ps-muted">{t("chat.activity.empty")}</p>
          ) : (
            <ul className="space-y-2">
              {activityRows.map((row) => (
                <li key={row.userId} className="text-sm">
                  <span className="block truncate font-medium text-ps-text">
                    {row.name}
                  </span>
                  <span className="block break-words text-xs text-ps-muted">
                    {row.detail}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section
          className="surface-panel min-h-48 min-w-0 space-y-4 rounded-2xl p-4"
          aria-label={t("chat.messagesLabel")}
          aria-live="polite"
        >
          {loading && <p role="status">{t("chat.loading")}</p>}
          {!loading && !messages.length && (
            <p className="text-ps-muted">{t("chat.empty")}</p>
          )}
          {messages.map((message) => (
            <article key={message.id}>
              <p className="text-xs text-ps-muted">
                <span className="font-medium text-ps-text">
                  {message.username}
                </span>{" "}
                · {new Date(message.created_at).toLocaleString(locale)}
              </p>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm">
                {message.text}
              </p>
            </article>
          ))}
        </section>
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
      {!user?.api_key && (
        <p role="status" className="text-sm text-ps-muted">
          {t("chat.missingKey")}
        </p>
      )}
      {!isOnline && (
        <p role="status" className="text-sm text-ps-muted">
          {t("chat.offline")}
        </p>
      )}
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <label className="block text-sm text-ps-muted">
          {t("chat.message")}
          <Textarea
            rows={3}
            maxLength={2000}
            value={pending?.text ?? text}
            disabled={!!pending || !connected}
            onChange={(event) => setText(event.target.value)}
          />
        </label>
        <div className="flex flex-wrap gap-3">
          <Button
            type="submit"
            color="indigo"
            disabled={!connected || waiting || (!pending && !text.trim())}
          >
            {waiting
              ? t("chat.sending")
              : pending
                ? t("chat.retry")
                : t("chat.send")}
          </Button>
          {pending && !waiting && (
            <Button
              outline
              onClick={() => {
                setPending(null);
                setError("");
              }}
            >
              {t("chat.discard")}
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
