/**
 * Community presence, activity publishing and chat/activity notification
 * rules (pure). Mirrors the WPF `CommunityConnection`.
 */
import type { ChatMessage, ChatTarget } from "@/utils/chat";
import { profileScopedKey } from "@/utils/profiles";

export type CommunityPresence = "ONLINE" | "BUSY" | "INVISIBLE";
export type ActivityState = CommunityPresence | "PLAYING" | "OFFLINE";

export const COMMUNITY_PRESENCES: CommunityPresence[] = [
  "ONLINE",
  "BUSY",
  "INVISIBLE",
];

/** `BUSY` and `INVISIBLE` are kept; anything else becomes `ONLINE`. */
export function normalizePresence(value: unknown): CommunityPresence {
  return value === "BUSY" || value === "INVISIBLE" ? value : "ONLINE";
}

/**
 * localStorage key of the saved presence for one account on one server
 * (inside the active profile's namespace on the desktop, see
 * `profileScopedKey`).
 */
export function presenceStorageKey(serverUrl: string, userId: number): string {
  return `playstash:community-presence:${serverUrl.replace(/\/+$/, "")}:${userId}`;
}

export function loadPresence(
  serverUrl: string,
  userId: number | null | undefined,
): CommunityPresence {
  if (!userId) return "ONLINE";
  try {
    return normalizePresence(
      localStorage.getItem(
        profileScopedKey(presenceStorageKey(serverUrl, userId)),
      ),
    );
  } catch {
    return "ONLINE";
  }
}

export function savePresence(
  serverUrl: string,
  userId: number | null | undefined,
  presence: CommunityPresence,
): void {
  if (!userId) return;
  try {
    localStorage.setItem(
      profileScopedKey(presenceStorageKey(serverUrl, userId)),
      presence,
    );
  } catch {
    // Presence still applies for this session.
  }
}

export interface PublishedActivity {
  state: CommunityPresence | "PLAYING";
  game_id: number | null;
}

/**
 * The `set-activity` payload: `PLAYING` with the game while a game runs,
 * unless the user is invisible; otherwise the presence.
 */
export function activityPayload(
  presence: CommunityPresence,
  playingGameId: number | null | undefined,
): PublishedActivity {
  const playing =
    presence !== "INVISIBLE" &&
    typeof playingGameId === "number" &&
    playingGameId > 0;
  return playing
    ? { state: "PLAYING", game_id: playingGameId }
    : { state: presence, game_id: null };
}

// ── Notification settings ──────────────────────────────────────────────────

export const CHAT_NOTIFICATIONS_KEY = "playstash_chat_notifications";
export const ACTIVITY_NOTIFICATIONS_KEY = "playstash_activity_notifications";
export const COMMUNITY_NOTIFICATIONS_EVENT =
  "playstash:community-notifications-change";

export type CommunityNotificationKind = "chat" | "activity";

/** Per profile like the WPF client (plain key without a profile). */
function notificationKey(kind: CommunityNotificationKind): string {
  return profileScopedKey(
    kind === "chat" ? CHAT_NOTIFICATIONS_KEY : ACTIVITY_NOTIFICATIONS_KEY,
  );
}

/** Both notification kinds are off unless explicitly enabled. */
export function getCommunityNotificationsEnabled(
  kind: CommunityNotificationKind,
): boolean {
  try {
    return localStorage.getItem(notificationKey(kind)) === "1";
  } catch {
    return false;
  }
}

export function setCommunityNotificationsEnabled(
  kind: CommunityNotificationKind,
  enabled: boolean,
): void {
  try {
    localStorage.setItem(notificationKey(kind), enabled ? "1" : "0");
  } catch {
    // Not persisted; the toggle still reflects the click.
  }
  if (typeof window !== "undefined")
    window.dispatchEvent(
      new CustomEvent(COMMUNITY_NOTIFICATIONS_EVENT, {
        detail: { kind, enabled },
      }),
    );
}

// ── Rules ──────────────────────────────────────────────────────────────────

export interface NotificationContent {
  title: string;
  body: string;
}

export const CHAT_NOTIFICATION_MAX_LENGTH = 160;

/** Translatable notification texts; English defaults match the WPF client. */
export interface NotificationLabels {
  /** `{username}` is replaced with the sender's name. */
  chatTitle: string;
  activityTitle: string;
  /** `{id}` is replaced with the user id. */
  unknownUser: string;
}

export const DEFAULT_NOTIFICATION_LABELS: NotificationLabels = {
  chatTitle: "PlayStash — {username}",
  activityTitle: "PlayStash Activity",
  unknownUser: "User #{id}",
};

/** Cuts the text after 160 characters (code points) and appends "…". */
export function truncateNotificationText(
  text: string,
  max = CHAT_NOTIFICATION_MAX_LENGTH,
): string {
  const characters = Array.from(text);
  return characters.length > max
    ? `${characters.slice(0, max).join("")}…`
    : text;
}

/** The conversation the chat page currently shows, used to suppress toasts. */
export type OpenConversation = ChatTarget | null;

export interface ChatNotificationInput {
  message: Pick<
    ChatMessage,
    "user_id" | "username" | "text" | "room" | "recipient_user_id"
  >;
  ownUserId: number | null | undefined;
  presence: CommunityPresence;
  enabled: boolean;
  windowFocused: boolean;
  openConversation: OpenConversation;
  labels?: NotificationLabels;
}

/** True when the message belongs to the open conversation. */
export function isOpenConversation(
  message: ChatNotificationInput["message"],
  openConversation: OpenConversation,
): boolean {
  if (!openConversation) return false;
  if (message.recipient_user_id != null)
    return openConversation.recipient_user_id === message.user_id;
  return (
    openConversation.recipient_user_id == null &&
    (openConversation.room ?? null) === (message.room ?? null)
  );
}

/**
 * Toast for a `chat-message`, or null when suppressed: invisible, setting off,
 * own message, or the window is focused and shows that conversation.
 */
export function chatNotification(
  input: ChatNotificationInput,
): NotificationContent | null {
  const { message } = input;
  if (input.presence === "INVISIBLE" || !input.enabled) return null;
  if (input.ownUserId != null && message.user_id === input.ownUserId)
    return null;
  if (
    input.windowFocused &&
    isOpenConversation(message, input.openConversation)
  )
    return null;
  const labels = input.labels ?? DEFAULT_NOTIFICATION_LABELS;
  return {
    title: labels.chatTitle.replace("{username}", message.username ?? ""),
    body: truncateNotificationText(message.text ?? ""),
  };
}

export type ActivityEventName = "activities" | "activity" | "remove-activity";

export interface ActivityEntry {
  state: string;
  gameId?: number;
}

export interface RawActivity {
  user_id: number;
  state?: string;
  game_id?: number | null;
}

/** Normalises a server activity into a map entry (state defaults to ONLINE). */
export function toActivityEntry(activity: RawActivity): ActivityEntry {
  const gameId =
    typeof activity.game_id === "number" && activity.game_id > 0
      ? activity.game_id
      : undefined;
  return {
    state: activity.state || "ONLINE",
    ...(gameId !== undefined ? { gameId } : {}),
  };
}

export interface ActivityUpdate {
  activities: Map<number, ActivityEntry>;
  snapshotReceived: boolean;
  /** Set when the change is worth a toast (before the per-user rules). */
  changed?: { userId: number; state: string };
}

/**
 * Applies `activities` (snapshot), `activity` (upsert) or `remove-activity`
 * (counts as `OFFLINE`) to the map. Returns a new map.
 */
export function applyActivityEvent(
  activities: Map<number, ActivityEntry>,
  snapshotReceived: boolean,
  event: ActivityEventName,
  payload: unknown,
): ActivityUpdate {
  if (event === "activities") {
    const next = new Map<number, ActivityEntry>();
    if (Array.isArray(payload))
      for (const item of payload as RawActivity[])
        if (item && typeof item.user_id === "number")
          next.set(item.user_id, toActivityEntry(item));
    return { activities: next, snapshotReceived: true };
  }
  const item = payload as RawActivity | null;
  if (!item || typeof item.user_id !== "number")
    return { activities, snapshotReceived };
  const previous = activities.get(item.user_id)?.state;
  const next = new Map(activities);
  let state: string;
  if (event === "remove-activity") {
    state = "OFFLINE";
    next.delete(item.user_id);
  } else {
    const entry = toActivityEntry(item);
    state = entry.state;
    next.set(item.user_id, entry);
  }
  return {
    activities: next,
    snapshotReceived,
    ...(state !== previous ? { changed: { userId: item.user_id, state } } : {}),
  };
}

export interface ActivityNotificationInput {
  update: ActivityUpdate;
  /** Whether the snapshot had been received before this event. */
  snapshotReceived: boolean;
  ownUserId: number | null | undefined;
  presence: CommunityPresence;
  enabled: boolean;
  /** Display name of the user, if known. */
  username?: string | null;
  labels?: NotificationLabels;
}

/**
 * Toast for an activity change, or null: before the first snapshot, without a
 * state change, for yourself, while invisible or with the setting off.
 */
export function activityNotification(
  input: ActivityNotificationInput,
): NotificationContent | null {
  const changed = input.update.changed;
  if (!changed || !input.snapshotReceived) return null;
  if (input.ownUserId != null && changed.userId === input.ownUserId)
    return null;
  if (input.presence === "INVISIBLE" || !input.enabled) return null;
  const labels = input.labels ?? DEFAULT_NOTIFICATION_LABELS;
  const name =
    input.username?.trim() ||
    labels.unknownUser.replace("{id}", String(changed.userId));
  return { title: labels.activityTitle, body: `${name}: ${changed.state}` };
}
