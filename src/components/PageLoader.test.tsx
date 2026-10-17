// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PageLoader } from "./PageLoader";

const preferences = vi.hoisted(() => ({ reduceMotion: false }));
vi.mock("motion/react", () => ({
  useReducedMotion: () => preferences.reduceMotion,
}));
vi.mock("@/i18n", () => ({ useTranslation: () => ({ t: () => "Loading…" }) }));

describe("page loading feedback", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    preferences.reduceMotion = false;
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("avoids flashing an indicator for fast navigation and cancels its timer", () => {
    const view = render(<PageLoader />);
    act(() => vi.advanceTimersByTime(159));
    expect(screen.queryByRole("status")).toBeNull();
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("shows accessible feedback without making the route wait for its animation", () => {
    const view = render(<PageLoader />);
    act(() => vi.advanceTimersByTime(160));
    expect(screen.getByRole("status").textContent).toContain("Loading…");
    const image = view.container.querySelector("img")!;
    expect(image.getAttribute("src")).toBe("/motion/playstash-load.webp");
    fireEvent.error(image);
    expect(image.getAttribute("src")).toBe("/playstash-logo.png");
    view.unmount();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("uses still artwork for reduced motion and pauses feedback in a hidden tab", () => {
    preferences.reduceMotion = true;
    const view = render(<PageLoader />);
    act(() => vi.advanceTimersByTime(160));
    expect(view.container.querySelector("img")?.getAttribute("src")).toBe(
      "/motion/playstash-load-still.webp",
    );
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(
      (view.container.querySelector('[aria-hidden="true"]') as HTMLElement)
        .style.animationPlayState,
    ).toBe("paused");
  });
});
