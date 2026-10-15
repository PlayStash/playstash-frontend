import { describe, expect, it } from "vitest";
import {
  isLibraryRefreshDue,
  libraryRefreshLimit,
} from "@/utils/libraryAutoRefresh";

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
