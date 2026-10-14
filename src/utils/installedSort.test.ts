import { describe, expect, it } from "vitest";
import type { PlaystashGame } from "@/api/models/PlaystashGame";
import {
  DEFAULT_INSTALLED_FILTERS,
  filterInstalledGames,
  sortInstalledGames,
} from "./installedSort";

function game(id: number, extra: Record<string, unknown>): PlaystashGame {
  return { id, title: `Game ${id}`, ...extra } as unknown as PlaystashGame;
}

const games = [
  game(1, {
    title: "beta",
    size: "300",
    release_date: "2010-01-01",
    metadata: { rating: 70, early_access: true },
    progresses: [{ user: { id: 7 }, minutes_played: 10 }],
    type: "WINDOWS_SETUP",
  }),
  game(2, {
    title: "Alpha",
    size: "1000",
    metadata: { rating: 90, release_date: "2020-06-01", early_access: false },
    progresses: [{ user: { id: 7 }, minutes_played: 500 }],
    type: "WINDOWS_PORTABLE",
  }),
  game(3, {
    title: "gamma",
    sort_title: "aardvark",
    size: "not-a-number",
    early_access: true,
    metadata: { rating: 50 },
    progresses: [{ user: { id: 8 }, minutes_played: 9999 }],
    type: "LINUX_PORTABLE",
  }),
  game(4, {
    title: "delta",
    size: "50",
    release_date: "2015-03-03",
    metadata: {},
    type: "UNDETECTABLE",
  }),
];

const ids = (list: PlaystashGame[]) => list.map((g) => g.id);

describe("sortInstalledGames", () => {
  it("keeps the last played / installed order by default", () => {
    expect(ids(sortInstalledGames(games, "last-played"))).toEqual([1, 2, 3, 4]);
  });

  it("sorts by sort_title ?? title, case-insensitive", () => {
    expect(ids(sortInstalledGames(games, "title"))).toEqual([3, 2, 1, 4]);
  });

  it("sorts by release date descending with nulls last", () => {
    expect(ids(sortInstalledGames(games, "release-date"))).toEqual([
      2, 4, 1, 3,
    ]);
  });

  it("sorts by rating descending", () => {
    expect(ids(sortInstalledGames(games, "rating"))).toEqual([2, 1, 3, 4]);
  });

  it("sorts by numeric size descending (unparseable = 0)", () => {
    expect(ids(sortInstalledGames(games, "size"))).toEqual([2, 1, 4, 3]);
  });

  it("sorts by the current user's playtime descending", () => {
    expect(ids(sortInstalledGames(games, "playtime", 7))).toEqual([2, 1, 3, 4]);
  });

  it("does not mutate the input", () => {
    sortInstalledGames(games, "title");
    expect(ids(games)).toEqual([1, 2, 3, 4]);
  });
});

describe("filterInstalledGames", () => {
  it("filters early access using metadata ?? game and excludes nulls", () => {
    const only = filterInstalledGames(games, {
      ...DEFAULT_INSTALLED_FILTERS,
      earlyAccess: "only",
    });
    expect(ids(only)).toEqual([1, 3]);
    const exclude = filterInstalledGames(games, {
      ...DEFAULT_INSTALLED_FILTERS,
      earlyAccess: "exclude",
    });
    // Game 4 has no early access value and matches neither.
    expect(ids(exclude)).toEqual([2]);
  });

  it("filters by exact release year and ignores unparseable text", () => {
    expect(
      ids(
        filterInstalledGames(games, {
          ...DEFAULT_INSTALLED_FILTERS,
          releaseYear: "2020",
        }),
      ),
    ).toEqual([2]);
    expect(
      ids(
        filterInstalledGames(games, {
          ...DEFAULT_INSTALLED_FILTERS,
          releaseYear: "20x0",
        }),
      ),
    ).toEqual([1, 2, 3, 4]);
  });

  it("filters by type", () => {
    expect(
      ids(
        filterInstalledGames(games, {
          ...DEFAULT_INSTALLED_FILTERS,
          type: "UNDETECTABLE",
        }),
      ),
    ).toEqual([4]);
  });
});
