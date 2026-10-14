import { describe, expect, it, vi } from "vitest";
import {
  isDownloadsRoute,
  notifyDownloadEvent,
  shouldShowDownloadNotification,
} from "./downloadNotifications";
import { DownloadAutoRetry } from "./autoRetry";

function deps(focused: boolean, route: string) {
  return {
    notify: vi.fn(async () => undefined),
    isMainWindowFocused: vi.fn(async () => focused),
    currentRoute: () => route,
  };
}

describe("download notifications", () => {
  it("is suppressed while the focused window shows the downloads", async () => {
    const d = deps(true, "/downloads");
    await expect(
      notifyDownloadEvent(
        { kind: "download-complete", gameId: 1, gameTitle: "Game" },
        d,
      ),
    ).resolves.toBe(false);
    expect(d.notify).not.toHaveBeenCalled();
  });

  it("is shown on other pages or when the window is not focused", async () => {
    const elsewhere = deps(true, "/library");
    await notifyDownloadEvent(
      {
        kind: "extraction-complete",
        gameId: 1,
        gameTitle: "Game",
        imagePath: "C:/cache/5.png",
      },
      elsewhere,
    );
    expect(elsewhere.notify).toHaveBeenCalledWith({
      title: "Extraction Complete",
      body: "Game",
      imagePath: "C:/cache/5.png",
      tag: "download-1-extraction-complete",
    });

    const minimized = deps(false, "/downloads");
    await notifyDownloadEvent(
      { kind: "download-failed", gameId: 2, gameTitle: "Other" },
      minimized,
    );
    expect(minimized.notify).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Download Failed", body: "Other" }),
    );
  });

  it("matches the downloads route", () => {
    expect(isDownloadsRoute("/downloads")).toBe(true);
    expect(isDownloadsRoute("/downloads/")).toBe(true);
    expect(isDownloadsRoute("/downloads?x=1")).toBe(true);
    expect(isDownloadsRoute("/library/downloads")).toBe(false);
    expect(shouldShowDownloadNotification(true, "/settings")).toBe(true);
    expect(shouldShowDownloadNotification(false, "/downloads")).toBe(true);
  });

  it("never throws", async () => {
    await expect(
      notifyDownloadEvent(
        { kind: "download-failed", gameId: 1, gameTitle: "Game" },
        {
          notify: vi.fn(async () => {
            throw new Error("boom");
          }),
          isMainWindowFocused: async () => false,
          currentRoute: () => "/",
        },
      ),
    ).resolves.toBe(false);
  });

  it("does not repeat the failed notification for auto-retry failures", () => {
    vi.useFakeTimers();
    try {
      const retry = new DownloadAutoRetry(() => undefined);
      // First error: not an auto-retry attempt, so it is announced.
      expect(retry.isAutoRetryAttempt(3)).toBe(false);
      retry.scheduleAfterError(3);
      vi.advanceTimersByTime(10_000);
      // The resumed attempt fails again: no second notification.
      expect(retry.isAutoRetryAttempt(3)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
