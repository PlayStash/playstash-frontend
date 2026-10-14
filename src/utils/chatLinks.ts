import type { ChatTarget } from "@/utils/chat";

/** Game id of a `game:<id>` room, or null. */
export function gameIdFromRoom(room: string | null | undefined): number | null {
  const match = /^game:(\d+)$/.exec(room ?? "");
  const id = match ? Number(match[1]) : NaN;
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * Conversation from the chat URL: `?user=<id>` (direct message),
 * `?room=game:<id>` or `?room=lobby`. Anything else opens the lobby.
 */
export function chatTargetFromParams(params: URLSearchParams): ChatTarget {
  const recipient = Number(params.get("user"));
  if (Number.isSafeInteger(recipient) && recipient > 0)
    return { recipient_user_id: recipient };
  const gameId = gameIdFromRoom(params.get("room"));
  if (gameId) return { room: `game:${gameId}` };
  return { room: "lobby" };
}

/** URL parameters for a conversation (inverse of `chatTargetFromParams`). */
export function chatTargetParams(target: ChatTarget): Record<string, string> {
  return target.recipient_user_id
    ? { user: String(target.recipient_user_id) }
    : { room: target.room || "lobby" };
}

/** Link to the chat page for a conversation. */
export function chatLink(target: ChatTarget): string {
  // Room names are `lobby` or `game:<id>`; keep the colon readable.
  return `/chat?${Object.entries(chatTargetParams(target))
    .map(
      ([key, value]) =>
        `${key}=${encodeURIComponent(value).replace(/%3A/gi, ":")}`,
    )
    .join("&")}`;
}
