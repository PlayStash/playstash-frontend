import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { useAuth } from "@/context/AuthContext";
import { useOnlineStatus } from "@/context/OfflineContext";
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
import { createUuid } from "@/utils/uuid";
interface Activity {
  user_id: number;
  state: string;
  game_id?: number;
}
interface ChatUser {
  id: number;
  username: string;
}
type Presence = "ONLINE" | "BUSY" | "INVISIBLE";
export default function Chat() {
  const { serverUrl, user, authFetch } = useAuth();
  const { isOnline } = useOnlineStatus();
  const [target, setTarget] = useState<ChatTarget>({ room: "lobby" });
  const targetRef = useRef(target);
  targetRef.current = target;
  const [type, setType] = useState("lobby");
  const [gameId, setGameId] = useState("");
  const [recipient, setRecipient] = useState("");
  const [users, setUsers] = useState<ChatUser[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [presence, setPresence] = useState<Presence>("ONLINE");
  const presenceRef = useRef(presence);
  presenceRef.current = presence;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [connected, setConnected] = useState(false);
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
  const socketRef = useRef<Socket | null>(null);
  const sendTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const historyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearTimers = () => {
    if (sendTimer.current) clearTimeout(sendTimer.current);
    if (historyTimer.current) clearTimeout(historyTimer.current);
  };
  const requestHistory = (socket: Socket, next: ChatTarget) => {
    setLoading(true);
    if (historyTimer.current) clearTimeout(historyTimer.current);
    socket.emit("chat-history", { ...next, limit: 100 });
    historyTimer.current = setTimeout(() => {
      setLoading(false);
      setError(
        "Chat did not respond. Your administrator may have disabled online activities. Try reconnecting.",
      );
    }, 12_000);
  };
  useEffect(() => {
    let cancelled = false;
    void authFetch(`${serverUrl}/api/users`)
      .then(async (response) => {
        if (response.ok && !cancelled)
          setUsers(
            (await response.json()).filter(
              (entry: ChatUser) => entry.id !== user?.id,
            ),
          );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [serverUrl, authFetch, user?.id]);
  useEffect(() => {
    if (!isOnline || !user?.api_key) {
      setConnected(false);
      setLoading(false);
      return;
    }
    const socket = io(serverUrl, {
      auth: { api_key: user.api_key },
      autoConnect: false,
    });
    socketRef.current = socket;
    const accept = (message: ChatMessage) => {
      if (messageInConversation(message, targetRef.current, user.id))
        setMessages((previous) => mergeChatMessages(previous, [message]));
    };
    socket.on("connect", () => {
      setConnected(true);
      setError("");
      socket.emit("get-activities");
      socket.emit("set-activity", { state: presenceRef.current });
      requestHistory(socket, targetRef.current);
    });
    socket.on("disconnect", () => {
      setConnected(false);
      setWaiting(false);
    });
    socket.on("connect_error", () => {
      setConnected(false);
      setLoading(false);
      setError(
        "Could not connect to chat. Check your connection and account access.",
      );
    });
    socket.on(
      "chat-history",
      (history: { conversation: string; messages: ChatMessage[] }) => {
        if (
          history.conversation !== chatConversation(targetRef.current, user.id)
        )
          return;
        if (historyTimer.current) clearTimeout(historyTimer.current);
        setMessages((previous) =>
          mergeChatMessages(history.messages, previous),
        );
        setLoading(false);
        setError("");
      },
    );
    socket.on("chat-message", accept);
    socket.on("chat-sent", (message: ChatMessage) => {
      accept(message);
      if (message.client_message_id === pendingRef.current?.id) {
        if (sendTimer.current) clearTimeout(sendTimer.current);
        setPending(null);
        setWaiting(false);
        setText("");
        setError("");
      }
    });
    socket.on("activities", setActivities);
    socket.on("activity", (activity: Activity) =>
      setActivities((previous) => [
        ...previous.filter((entry) => entry.user_id !== activity.user_id),
        activity,
      ]),
    );
    socket.on("remove-activity", ({ user_id }: { user_id: number }) =>
      setActivities((previous) =>
        previous.filter((entry) => entry.user_id !== user_id),
      ),
    );
    socket.on("exception", (exception: { message?: string | string[] }) => {
      clearTimers();
      setLoading(false);
      setWaiting(false);
      setError(
        Array.isArray(exception?.message)
          ? exception.message.join(" ")
          : exception?.message || "The server rejected this chat action.",
      );
    });
    socket.connect();
    return () => {
      clearTimers();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [serverUrl, user?.api_key, user?.id, isOnline]);
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket?.connected) return;
    requestHistory(socket, target);
    return () => {
      socket.emit("chat-leave", target);
    };
  }, [target]);
  const send = () => {
    const socket = socketRef.current;
    if (!socket?.connected) return;
    const message = pending || { id: createUuid(), text: text.trim(), target };
    if (!message.text) return;
    setPending(message);
    pendingRef.current = message;
    setWaiting(true);
    setError("");
    socket.emit("chat-send", {
      ...message.target,
      text: message.text,
      client_message_id: message.id,
    });
    if (sendTimer.current) clearTimeout(sendTimer.current);
    sendTimer.current = setTimeout(() => {
      setWaiting(false);
      setError(
        "Delivery is unconfirmed. Retry uses the same message ID to avoid duplicates.",
      );
    }, 12_000);
  };
  const open = () => {
    const next =
      type === "game"
        ? { room: `game:${Number(gameId)}` }
        : type === "direct"
          ? { recipient_user_id: Number(recipient) }
          : { room: "lobby" };
    if (sendTimer.current) clearTimeout(sendTimer.current);
    setPending(null);
    setWaiting(false);
    setMessages([]);
    setError("");
    setTarget(next);
  };
  const validTarget =
    type === "lobby" ||
    (type === "game"
      ? Number.isInteger(Number(gameId)) && Number(gameId) > 0
      : Number(recipient) > 0);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Heading>Library chat</Heading>
          <p className="mt-2 max-w-2xl text-sm text-ps-muted">
            Talk in the lobby, a game room or a direct conversation. Messages
            are kept for up to 24 hours and disappear when the server restarts.
          </p>
        </div>
        <label className="text-sm text-ps-muted">
          My visibility
          <select
            aria-label="My visibility"
            value={presence}
            className="mt-1 block min-h-11 rounded-lg bg-ps-panel px-3 text-ps-text"
            onChange={(event) => {
              const next = event.target.value as Presence;
              setPresence(next);
              socketRef.current?.emit("set-activity", { state: next });
            }}
          >
            <option value="ONLINE">Online</option>
            <option value="BUSY">Busy</option>
            <option value="INVISIBLE">Invisible</option>
          </select>
          <span className="mt-1 block text-xs">
            While this chat page is connected
          </span>
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
          Conversation
          <select
            value={type}
            className="mt-1 block min-h-11 rounded-lg bg-ps-panel-soft px-3 text-ps-text"
            onChange={(event) => setType(event.target.value)}
          >
            <option value="lobby">Lobby</option>
            <option value="game">Game room</option>
            <option value="direct">Direct message</option>
          </select>
        </label>
        {type === "game" && (
          <label className="text-sm text-ps-muted">
            Game ID
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
            Recipient
            <select
              value={recipient}
              className="mt-1 block min-h-11 rounded-lg bg-ps-panel-soft px-3 text-ps-text"
              onChange={(event) => setRecipient(event.target.value)}
            >
              <option value="">Choose a user</option>
              {users.map((entry) => (
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
          Open conversation
        </Button>
      </form>
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <span>
          {target.recipient_user_id
            ? `Direct message · ${users.find((entry) => entry.id === target.recipient_user_id)?.username || target.recipient_user_id}`
            : target.room === "lobby"
              ? "Lobby"
              : `Game ${target.room?.slice(5)}`}{" "}
          · {connected ? "Connected" : "Disconnected"}
        </span>
        <span className="text-ps-muted">
          {
            activities.filter(
              (entry) =>
                entry.user_id !== user?.id && entry.state !== "INVISIBLE",
            ).length
          }{" "}
          visible users
        </span>
        {!connected && isOnline && (
          <Button outline onClick={() => socketRef.current?.connect()}>
            Reconnect
          </Button>
        )}
      </div>
      <section
        className="surface-panel min-h-48 space-y-4 rounded-2xl p-4"
        aria-label="Chat messages"
        aria-live="polite"
      >
        {loading && <p role="status">Loading conversation…</p>}
        {!loading && !messages.length && (
          <p className="text-ps-muted">
            No recent messages in this conversation.
          </p>
        )}
        {messages.map((message) => (
          <article key={message.id}>
            <p className="text-xs text-ps-muted">
              <span className="font-medium text-ps-text">
                {message.username}
              </span>{" "}
              · {new Date(message.created_at).toLocaleString()}
            </p>
            <p className="mt-1 whitespace-pre-wrap break-words text-sm">
              {message.text}
            </p>
          </article>
        ))}
      </section>
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
      {!user?.api_key && (
        <p role="status" className="text-sm text-ps-muted">
          Chat requires an API key from your signed-in account. Reconnect to the
          server or sign in again.
        </p>
      )}
      {!isOnline && (
        <p role="status" className="text-sm text-ps-muted">
          Chat requires a connection to your server.
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
          Message
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
              ? "Sending…"
              : pending
                ? "Retry same message"
                : "Send message"}
          </Button>
          {pending && !waiting && (
            <Button
              outline
              onClick={() => {
                setPending(null);
                setError("");
              }}
            >
              Discard unconfirmed message
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
