// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  displayTitle,
  getShowMappedTitle,
  MAPPED_TITLE_CHANGE_EVENT,
  setShowMappedTitle,
  SHOW_MAPPED_TITLE_KEY,
  titleYearSuffix,
} from "./mappedTitle";

const game = {
  title: "game_file_v1.2",
  release_date: "2001-05-01T00:00:00Z",
  metadata: { title: "The Game", release_date: "2003-09-10T00:00:00Z" },
};

beforeEach(() => localStorage.clear());

describe("displayTitle", () => {
  it("shows the mapped title by default", () => {
    expect(getShowMappedTitle()).toBe(true);
    expect(displayTitle(game)).toBe("The Game");
  });

  it("shows the file title when the preference is off", () => {
    setShowMappedTitle(false);
    expect(localStorage.getItem(SHOW_MAPPED_TITLE_KEY)).toBe("false");
    expect(displayTitle(game)).toBe("game_file_v1.2");
  });

  it("falls back to the file title without a mapped title", () => {
    expect(displayTitle({ title: "Raw", metadata: null }, true)).toBe("Raw");
    expect(displayTitle({ title: "Raw", metadata: { title: "" } }, true)).toBe(
      "Raw",
    );
    expect(displayTitle(null)).toBe("");
  });

  it("notifies listeners on change", () => {
    const listener = vi.fn();
    window.addEventListener(MAPPED_TITLE_CHANGE_EVENT, listener);
    setShowMappedTitle(false);
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener(MAPPED_TITLE_CHANGE_EVENT, listener);
  });
});

describe("titleYearSuffix", () => {
  it("uses the mapped release date when the mapped title is shown", () => {
    expect(titleYearSuffix(game, true)).toBe(" (2003)");
  });

  it("uses the game's release date for the file title", () => {
    expect(titleYearSuffix(game, false)).toBe(" (2001)");
  });

  it("falls back to the game date and is empty without dates", () => {
    expect(
      titleYearSuffix(
        { ...game, metadata: { title: "The Game", release_date: null } },
        true,
      ),
    ).toBe(" (2001)");
    expect(titleYearSuffix({ title: "x" }, true)).toBe("");
    expect(
      titleYearSuffix({ title: "x", release_date: "garbage" }, false),
    ).toBe("");
  });
});
