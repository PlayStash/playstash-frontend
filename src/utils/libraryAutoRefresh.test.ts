import { describe, expect, it } from "vitest";
import {
  hasMoreGames,
  isLibraryRefreshDue,
  libraryRefreshLimit,
  loadedPageCount,
} from "@/utils/libraryAutoRefresh";

describe("loadedPageCount", () => {
  it("counts the pages covered by the loaded games", () => {
    expect(loadedPageCount(0, 50)).toBe(1);
    expect(loadedPageCount(50, 50)).toBe(1);
    expect(loadedPageCount(53, 50)).toBe(2);
    expect(loadedPageCount(100, 50)).toBe(2);
  });
});

describe("hasMoreGames", () => {
  it("is true until every server game is loaded", () => {
    expect(hasMoreGames(50, 53)).toBe(true);
    expect(hasMoreGames(53, 53)).toBe(false);
    expect(hasMoreGames(0, 0)).toBe(false);
  });
});

describe("isLibraryRefreshDue", () => {
  it("never refreshes before the first fetch", () => {
    expect(isLibraryRefreshDue(0, 1_000_000, 30_000)).toBe(false);
  });

  it("waits for the minimum interval", () => {
    expect(isLibraryRefreshDue(1_000, 30_999, 30_000)).toBe(false);
    expect(isLibraryRefreshDue(1_000, 31_000, 30_000)).toBe(true);
  });
});

describe("libraryRefreshLimit", () => {
  it("covers every loaded page", () => {
    expect(libraryRefreshLimit(50, 0)).toBe(50);
    expect(libraryRefreshLimit(50, 1)).toBe(50);
    expect(libraryRefreshLimit(50, 3)).toBe(150);
  });
});
