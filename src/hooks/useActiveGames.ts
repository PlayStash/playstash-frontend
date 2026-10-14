import { useSyncExternalStore } from "react";
import type { ActiveGameSession } from "@/utils/gameSessions";
import {
  getActiveGamesSnapshot,
  subscribeActiveGames,
} from "@/utils/activeGames";

const NO_ACTIVE_GAMES: ActiveGameSession[] = [];

/**
 * Games that are running right now, earliest `startedAt` first (WP4
 * contract). `GameSessionProvider` keeps the list in sync with
 * `get_active_game_sessions` (re-synced every 60 s) and the `game-session`
 * events; outside the desktop app it is always empty.
 */
export function useActiveGames(): ActiveGameSession[] {
  return useSyncExternalStore(
    subscribeActiveGames,
    getActiveGamesSnapshot,
    () => NO_ACTIVE_GAMES,
  );
}
