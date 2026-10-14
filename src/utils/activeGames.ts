import type { ActiveGameSession, GameSessionEvent } from "@/utils/gameSessions";

/**
 * Running games, kept in sync by `GameSessionProvider` from the tracker
 * (`get_active_game_sessions` + `game-session` events) and read through
 * `useActiveGames()`.
 *
 * A session only reported by the launch path (not yet seen by the tracker,
 * which matches once per minute) is kept for `OPTIMISTIC_TTL_MS` so the next
 * re-sync does not drop it before the tracker had a chance to see the game.
 */
export const OPTIMISTIC_TTL_MS = 150_000;

export interface ActiveGameEntry extends ActiveGameSession {
  /** Set while the entry is only known from a `started` event. */
  optimisticUntil?: number;
}

export type ActiveGamesState = ReadonlyMap<number, ActiveGameEntry>;

/** Applies a `game-session` event. */
export function applySessionEvent(
  state: ActiveGamesState,
  event: GameSessionEvent,
  now: number,
): ActiveGamesState {
  const next = new Map(state);
  if (event.state === "ended") {
    next.delete(event.gameId);
    return next;
  }
  const existing = next.get(event.gameId);
  if (existing && !existing.optimisticUntil) return state;
  next.set(event.gameId, {
    gameId: event.gameId,
    versionDirectory:
      event.versionDirectory || existing?.versionDirectory || "",
    startedAt: existing?.startedAt ?? now,
    optimisticUntil: now + OPTIMISTIC_TTL_MS,
  });
  return next;
}

/**
 * Replaces the state with the tracker's list, keeping optimistic entries that
 * have not expired yet.
 */
export function applySnapshot(
  state: ActiveGamesState,
  sessions: ActiveGameSession[],
  now: number,
): ActiveGamesState {
  const next = new Map<number, ActiveGameEntry>();
  for (const session of sessions) {
    next.set(session.gameId, {
      gameId: session.gameId,
      versionDirectory: session.versionDirectory,
      startedAt: session.startedAt,
    });
  }
  for (const entry of state.values()) {
    if (
      !next.has(entry.gameId) &&
      entry.optimisticUntil &&
      entry.optimisticUntil > now
    ) {
      next.set(entry.gameId, entry);
    }
  }
  return next;
}

/** Sessions ordered by start, earliest first ("first active game" first). */
export function sortedSessions(state: ActiveGamesState): ActiveGameSession[] {
  return Array.from(state.values())
    .sort((a, b) => a.startedAt - b.startedAt || a.gameId - b.gameId)
    .map(({ gameId, versionDirectory, startedAt }) => ({
      gameId,
      versionDirectory,
      startedAt,
    }));
}

let current: ActiveGamesState = new Map();
let snapshot: ActiveGameSession[] = [];
const listeners = new Set<() => void>();

export function getActiveGamesSnapshot(): ActiveGameSession[] {
  return snapshot;
}

export function subscribeActiveGames(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Updates the shared store and notifies subscribers when it changed. */
export function updateActiveGames(
  update: (state: ActiveGamesState) => ActiveGamesState,
): void {
  const next = update(current);
  if (next === current) return;
  current = next;
  const sorted = sortedSessions(next);
  const unchanged =
    sorted.length === snapshot.length &&
    sorted.every(
      (session, index) =>
        session.gameId === snapshot[index].gameId &&
        session.versionDirectory === snapshot[index].versionDirectory &&
        session.startedAt === snapshot[index].startedAt,
    );
  if (unchanged) return;
  snapshot = sorted;
  listeners.forEach((listener) => listener());
}

/** Clears the store (sign-out, tests). */
export function resetActiveGames(): void {
  updateActiveGames(() => new Map());
}
