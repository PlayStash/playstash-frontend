import type { ActiveGameSession } from "@/utils/gameSessions";

const NO_ACTIVE_GAMES: ActiveGameSession[] = [];

/**
 * Games that are running right now, earliest `startedAt` first (WP4 contract,
 * Step 0 stub). WP4 keeps this in sync with `get_active_game_sessions` and
 * the `game-session` events.
 */
export function useActiveGames(): ActiveGameSession[] {
  return NO_ACTIVE_GAMES;
}
