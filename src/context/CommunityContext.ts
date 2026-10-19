import { createContext, useContext } from "react";
import type {
  ActivityEntry,
  CommunityPresence,
  OpenConversation,
} from "@/utils/communityNotifications";

export type CommunityStatus =
  "offline" | "missing-api-key" | "connecting" | "connected" | "unavailable";

/** Delay before reconnecting after a drop or failed attempt (WPF: 5 s). */
export const COMMUNITY_RECONNECT_DELAY_MS = 5_000;

/** Pseudo event raised after every (re)connect, after activity publishing. */
export const COMMUNITY_CONNECTED_EVENT = "connected";

export type Listener = (payload: any) => void;

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

export const CommunityContext = createContext<CommunityContextValue | null>(
  null,
);

export function useCommunity(): CommunityContextValue {
  const context = useContext(CommunityContext);
  if (!context)
    throw new Error("useCommunity must be used within CommunityProvider");
  return context;
}
