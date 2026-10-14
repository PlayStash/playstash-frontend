// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GameVersion } from "@/api/models/GameVersion";
import type { PlaystashGame } from "@/api/models/PlaystashGame";
import type { ActiveDownload } from "@/context/DownloadContext";
import type { RootPathEntry } from "@/utils/rootPaths";

vi.mock("@/utils/tauri", () => ({ isTauriApp: () => true }));

import {
  driveLabel,
  hasEnoughSpace,
  newestVersion,
  pickBackgroundRoot,
  registerDownloadFlowHost,
  requestGameDownload,
  runDownloadFlow,
  type DownloadFlowHost,
} from "./downloadFlow";
import { LAST_ROOT_ID_KEY } from "./downloadPreferences";

const ROOTS_KEY = "tauri_download_paths";

function version(id: number, indexedAt: string, size = "1000"): GameVersion {
  return {
    id,
    version: `v${id}`,
    file_path: `/files/game-${id}.zip`,
    size,
    type: "WINDOWS_PORTABLE",
    indexed_at: indexedAt as unknown as Date,
  } as unknown as GameVersion;
}

function game(versions: GameVersion[]): PlaystashGame {
  return {
    id: 7,
    title: "folder title",
    type: "WINDOWS_PORTABLE",
    metadata: { title: "My Game" },
    versions,
  } as unknown as PlaystashGame;
}

function setRoots(roots: RootPathEntry[]) {
  localStorage.setItem(ROOTS_KEY, JSON.stringify(roots));
}

const rootA: RootPathEntry = { id: "a", path: "C:\\Games", label: "" };
const rootB: RootPathEntry = { id: "b", path: "D:\\Games", label: "" };

function makeHost(overrides: Partial<DownloadFlowHost> = {}) {
  const host: DownloadFlowHost = {
    isReady: () => true,
    fetchGame: vi.fn(async () => game([version(1, "2026-01-01")])),
    getDownloads: () => ({}),
    startDownload: vi.fn(),
    deleteDownloadCard: vi.fn(async () => undefined),
    toast: vi.fn(),
    confirm: vi.fn(async () => true),
    pickRoot: vi.fn(async ({ roots }) => roots[1]),
    pickVersion: vi.fn(async ({ versions }) => versions[0]),
    navigate: vi.fn(),
    pathExists: vi.fn(async () => true),
    freeSpace: vi.fn(async () => 10_000_000),
    ...overrides,
  };
  return host;
}

beforeEach(() => {
  localStorage.clear();
});

describe("download flow roots", () => {
  it("asks to open the settings without a download location", async () => {
    const host = makeHost();
    await expect(runDownloadFlow(host, { gameId: 7 })).resolves.toBe("error");
    expect(host.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: "No download location configured" }),
    );
    expect(host.navigate).toHaveBeenCalledWith("/settings?section=downloads");
    expect(host.startDownload).not.toHaveBeenCalled();
  });

  it("uses the only download location without a picker", async () => {
    setRoots([rootA]);
    const host = makeHost();
    await expect(runDownloadFlow(host, { gameId: 7 })).resolves.toBe("queued");
    expect(host.pickRoot).not.toHaveBeenCalled();
    expect(host.startDownload).toHaveBeenCalledWith(
      expect.objectContaining({
        gameId: 7,
        versionId: 1,
        gameTitle: "My Game",
        filename: "game-1.zip",
        downloadRootPath: "C:\\Games",
        autoInstall: false,
      }),
    );
    expect(host.toast).toHaveBeenCalledWith(
      "'My Game' has been added to the download queue",
    );
  });

  it("shows the picker with the last location preselected and remembers the choice", async () => {
    setRoots([rootA, rootB]);
    localStorage.setItem(LAST_ROOT_ID_KEY, "a");
    const host = makeHost();
    await runDownloadFlow(host, { gameId: 7 });
    expect(host.pickRoot).toHaveBeenCalledWith(
      expect.objectContaining({ preselectId: "a" }),
    );
    expect(localStorage.getItem(LAST_ROOT_ID_KEY)).toBe("b");
    expect(host.startDownload).toHaveBeenCalledWith(
      expect.objectContaining({ downloadRootPath: "D:\\Games" }),
    );
  });

  it("cancels when the picker is closed", async () => {
    setRoots([rootA, rootB]);
    const host = makeHost({ pickRoot: vi.fn(async () => null) });
    await expect(runDownloadFlow(host, { gameId: 7 })).resolves.toBe(
      "cancelled",
    );
    expect(host.startDownload).not.toHaveBeenCalled();
  });

  it("picks the last location without a dialog in the background", async () => {
    setRoots([rootA, rootB]);
    localStorage.setItem(LAST_ROOT_ID_KEY, "b");
    const host = makeHost();
    await runDownloadFlow(host, { gameId: 7, background: true });
    expect(host.pickRoot).not.toHaveBeenCalled();
    expect(host.startDownload).toHaveBeenCalledWith(
      expect.objectContaining({ downloadRootPath: "D:\\Games" }),
    );
  });

  it("reports a location that no longer exists", async () => {
    setRoots([rootA]);
    const host = makeHost({ pathExists: vi.fn(async () => false) });
    await expect(runDownloadFlow(host, { gameId: 7 })).resolves.toBe("error");
    expect(host.toast).toHaveBeenCalledWith(
      "Selected directory does not exist",
    );
  });
});

describe("download flow checks", () => {
  beforeEach(() => setRoots([rootA]));

  it("requires a login and a connection", async () => {
    const host = makeHost({ isReady: () => false });
    await expect(runDownloadFlow(host, { gameId: 7 })).resolves.toBe("error");
    expect(host.toast).toHaveBeenCalledWith("You are not logged in or offline");
    expect(host.fetchGame).not.toHaveBeenCalled();
  });

  it("reports an unknown game", async () => {
    const host = makeHost({ fetchGame: vi.fn(async () => null) });
    await expect(runDownloadFlow(host, { gameId: 7 })).resolves.toBe("error");
    expect(host.toast).toHaveBeenCalledWith("Game with ID 7 not found");
  });

  it("does not queue a game that is already downloading", async () => {
    const host = makeHost({
      getDownloads: () => ({
        7: { gameId: 7, status: "downloading" } as ActiveDownload,
      }),
    });
    await expect(runDownloadFlow(host, { gameId: 7 })).resolves.toBe(
      "cancelled",
    );
    expect(host.toast).toHaveBeenCalledWith(
      "'My Game' is already in the download queue",
    );
    expect(host.startDownload).not.toHaveBeenCalled();
  });

  it("asks before overwriting an existing download", async () => {
    const existing = {
      gameId: 7,
      versionId: 1,
      status: "completed",
      extractionStatus: "completed",
      installationStatus: "idle",
    } as ActiveDownload;
    const declined = makeHost({
      getDownloads: () => ({ 7: existing }),
      confirm: vi.fn(async () => false),
    });
    await expect(runDownloadFlow(declined, { gameId: 7 })).resolves.toBe(
      "cancelled",
    );
    expect(declined.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          "This game was already downloaded. Do you want to overwrite this file?",
      }),
    );
    expect(declined.startDownload).not.toHaveBeenCalled();

    const background = makeHost({ getDownloads: () => ({ 7: existing }) });
    await expect(
      runDownloadFlow(background, { gameId: 7, background: true }),
    ).resolves.toBe("queued");
    expect(background.confirm).not.toHaveBeenCalled();
  });

  it("removes the old card when another version replaces it", async () => {
    const existing = {
      gameId: 7,
      versionId: 99,
      status: "error",
    } as ActiveDownload;
    const host = makeHost({ getDownloads: () => ({ 7: existing }) });
    await runDownloadFlow(host, { gameId: 7 });
    expect(host.deleteDownloadCard).toHaveBeenCalledWith(7);
    expect(host.startDownload).toHaveBeenCalled();
  });

  it("stops when the drive is too full", async () => {
    const host = makeHost({
      fetchGame: vi.fn(async () => game([version(1, "2026-01-01", "5000")])),
      freeSpace: vi.fn(async () => 5500),
    });
    await expect(runDownloadFlow(host, { gameId: 7 })).resolves.toBe("error");
    expect(host.toast).toHaveBeenCalledWith(
      "Not enough space available for drive C:\\",
    );
    expect(host.startDownload).not.toHaveBeenCalled();
  });

  it("passes autoInstall to the download", async () => {
    const host = makeHost();
    await runDownloadFlow(host, { gameId: 7, autoInstall: true });
    expect(host.startDownload).toHaveBeenCalledWith(
      expect.objectContaining({ autoInstall: true }),
    );
  });
});

describe("download flow versions", () => {
  beforeEach(() => setRoots([rootA]));
  const versions = [
    version(1, "2026-01-01"),
    version(2, "2026-03-01"),
    version(3, "2026-02-01"),
  ];

  it("asks for the version when there are several", async () => {
    const host = makeHost({ fetchGame: vi.fn(async () => game(versions)) });
    await runDownloadFlow(host, { gameId: 7 });
    expect(host.pickVersion).toHaveBeenCalled();
    expect(host.startDownload).toHaveBeenCalledWith(
      expect.objectContaining({ versionId: 1 }),
    );
  });

  it("takes the newest version in the background", async () => {
    const host = makeHost({ fetchGame: vi.fn(async () => game(versions)) });
    await runDownloadFlow(host, { gameId: 7, background: true });
    expect(host.pickVersion).not.toHaveBeenCalled();
    expect(host.startDownload).toHaveBeenCalledWith(
      expect.objectContaining({ versionId: 2 }),
    );
  });

  it("honors a requested version", async () => {
    const host = makeHost({ fetchGame: vi.fn(async () => game(versions)) });
    await runDownloadFlow(host, { gameId: 7, versionId: 3 });
    expect(host.pickVersion).not.toHaveBeenCalled();
    expect(host.startDownload).toHaveBeenCalledWith(
      expect.objectContaining({ versionId: 3 }),
    );
  });
});

describe("requestGameDownload", () => {
  it("ignores a second request for the same game while one is pending", async () => {
    setRoots([rootA]);
    let release: (value: PlaystashGame | null) => void = () => undefined;
    const host = makeHost({
      fetchGame: vi.fn(
        () =>
          new Promise<PlaystashGame | null>((resolve) => {
            release = resolve;
          }),
      ),
    });
    const unregister = registerDownloadFlowHost(host);
    const first = requestGameDownload({ gameId: 7 });
    await expect(requestGameDownload({ gameId: 7 })).resolves.toBe("cancelled");
    release(game([version(1, "2026-01-01")]));
    await expect(first).resolves.toBe("queued");
    expect(host.startDownload).toHaveBeenCalledTimes(1);
    unregister();
    await expect(requestGameDownload({ gameId: 7 })).resolves.toBe("error");
  });
});

describe("download flow helpers", () => {
  it("keeps 1000 bytes of headroom", () => {
    expect(hasEnoughSpace(2001, 1000)).toBe(true);
    expect(hasEnoughSpace(2000, 1000)).toBe(false);
  });

  it("labels Windows drives", () => {
    expect(driveLabel("d:\\Games")).toBe("D:\\");
    expect(driveLabel("/mnt/games")).toBe("/mnt/games");
  });

  it("falls back to the first root", () => {
    expect(pickBackgroundRoot([rootA, rootB], "gone")).toBe(rootA);
    expect(pickBackgroundRoot([], "a")).toBeNull();
  });

  it("finds the newest version", () => {
    expect(newestVersion([])).toBeNull();
    expect(
      newestVersion([version(1, "2026-01-01"), version(2, "2025-01-01")])?.id,
    ).toBe(1);
  });
});
