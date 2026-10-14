import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applySessionEvent,
  applySnapshot,
  getActiveGamesSnapshot,
  OPTIMISTIC_TTL_MS,
  resetActiveGames,
  sortedSessions,
  subscribeActiveGames,
  updateActiveGames,
  type ActiveGamesState,
} from "./activeGames";

const empty: ActiveGamesState = new Map();

describe("active games state", () => {
  afterEach(() => resetActiveGames());

  it("adds started and removes ended sessions", () => {
    let state = applySessionEvent(
      empty,
      { gameId: 1, versionDirectory: "/a", state: "started" },
      100,
    );
    expect(sortedSessions(state)).toEqual([
      { gameId: 1, versionDirectory: "/a", startedAt: 100 },
    ]);
    state = applySessionEvent(
      state,
      { gameId: 1, versionDirectory: "/a", state: "ended", minutes: 3 },
      200,
    );
    expect(sortedSessions(state)).toEqual([]);
  });

  it("keeps tracker sessions authoritative and ignores duplicate starts", () => {
    const tracked = applySnapshot(
      empty,
      [{ gameId: 2, versionDirectory: "/b", startedAt: 50 }],
      100,
    );
    const again = applySessionEvent(
      tracked,
      { gameId: 2, versionDirectory: "/b", state: "started" },
      120,
    );
    expect(again).toBe(tracked);
  });

  it("keeps optimistic launches until the tracker had time to see them", () => {
    const launched = applySessionEvent(
      empty,
      { gameId: 3, versionDirectory: "/c", state: "started" },
      1_000,
    );
    expect(sortedSessions(applySnapshot(launched, [], 2_000))).toHaveLength(1);
    expect(
      sortedSessions(
        applySnapshot(launched, [], 1_000 + OPTIMISTIC_TTL_MS + 1),
      ),
    ).toEqual([]);
  });

  it("orders sessions by start time", () => {
    const state = applySnapshot(
      empty,
      [
        { gameId: 5, versionDirectory: "/e", startedAt: 300 },
        { gameId: 4, versionDirectory: "/d", startedAt: 100 },
      ],
      400,
    );
    expect(sortedSessions(state).map((session) => session.gameId)).toEqual([
      4, 5,
    ]);
  });

  it("notifies subscribers only on real changes", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeActiveGames(listener);
    const snapshot = [{ gameId: 1, versionDirectory: "/a", startedAt: 1 }];
    updateActiveGames((state) => applySnapshot(state, snapshot, 2));
    updateActiveGames((state) => applySnapshot(state, snapshot, 3));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getActiveGamesSnapshot()).toEqual(snapshot);
    unsubscribe();
  });
});
