// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addPendingBackup,
  buildCloudSaveRequest,
  cloudSaveMessageKey,
  cloudSaveServerPaths,
  getSaveFolders,
  setSaveFolders,
  cloudSaveSearchTitle,
  createBackupDeduper,
  formatTemplate,
  newestInstalledVersion,
  pendingQueueKey,
  readPendingBackups,
  removePendingBackup,
  restoreWithConflictPrompt,
  type CloudSaveRequest,
} from "./cloudSaves";
import type { InstalledGameInfo } from "@/hooks/useInstalledGames";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));

describe("cloud save messages", () => {
  it("maps HTTP 405 to the server message and keeps 404 silent", () => {
    expect(
      cloudSaveMessageKey({ status: "restoreFailed", httpStatus: 405 }),
    ).toBe("cloudSaves.status.serverDisabled");
    expect(
      cloudSaveMessageKey({ status: "backupUploadFailed", httpStatus: 405 }),
    ).toBe("cloudSaves.status.serverDisabled");
    expect(
      cloudSaveMessageKey({ status: "restoreFailed", httpStatus: 404 }),
    ).toBeNull();
    expect(
      cloudSaveMessageKey({ status: "restoreFailed", httpStatus: 500 }),
    ).toBe("cloudSaves.status.restoreFailed");
    expect(
      cloudSaveMessageKey({ status: "backupUploadFailed", httpStatus: 500 }),
    ).toBe("cloudSaves.status.backupUploadFailed");
  });

  it("maps every status to its WPF message", () => {
    expect(cloudSaveMessageKey({ status: "upToDate" })).toBe(
      "cloudSaves.status.upToDate",
    );
    expect(cloudSaveMessageKey({ status: "settingDisabled" })).toBe(
      "cloudSaves.status.settingDisabled",
    );
    expect(cloudSaveMessageKey({ status: "offline" })).toBe(
      "cloudSaves.status.offline",
    );
    expect(cloudSaveMessageKey({ status: "backupCreationFailed" })).toBe(
      "cloudSaves.status.backupCreationFailed",
    );
  });

  it("fills placeholders and keeps unknown ones", () => {
    expect(
      formatTemplate("Upload Savefiles for {match}", { match: "Celeste" }),
    ).toBe("Upload Savefiles for Celeste");
    expect(formatTemplate("{n} stored versions. {x}", { n: 3 })).toBe(
      "3 stored versions. {x}",
    );
  });

  it("searches by metadata title, falling back to the title", () => {
    expect(
      cloudSaveSearchTitle({
        title: "Folder",
        metadata: { title: " Celeste " },
      }),
    ).toBe("Celeste");
    expect(cloudSaveSearchTitle({ title: "Celeste", metadata: null })).toBe(
      "Celeste",
    );
    expect(cloudSaveSearchTitle(null)).toBe("");
  });
});

describe("offline backup queue", () => {
  beforeEach(() => localStorage.clear());

  it("persists per server and user without duplicates", () => {
    const key = pendingQueueKey("https://library.test/", 7);
    expect(key).toBe("playstash:cloudsave-pending:https://library.test:7");
    addPendingBackup(key, 3);
    addPendingBackup(key, 3);
    addPendingBackup(key, 5);
    expect(readPendingBackups(key)).toEqual([3, 5]);
    expect(
      readPendingBackups(pendingQueueKey("https://other.test", 7)),
    ).toEqual([]);
    removePendingBackup(key, 3);
    expect(readPendingBackups(key)).toEqual([5]);
    removePendingBackup(key, 5);
    expect(localStorage.getItem(key)).toBeNull();
  });

  it("ignores corrupt entries", () => {
    localStorage.setItem("q", '["4", 0, -1, "x", 4, 2.5]');
    expect(readPendingBackups("q")).toEqual([4]);
    localStorage.setItem("q", "{broken");
    expect(readPendingBackups("q")).toEqual([]);
  });
});

describe("backup dedupe", () => {
  it("runs once per game within the window", () => {
    let now = 1_000;
    const deduper = createBackupDeduper(60_000, () => now);
    expect(deduper.shouldRun(1)).toBe(true);
    expect(deduper.shouldRun(1)).toBe(false);
    expect(deduper.shouldRun(2)).toBe(true);
    now += 59_999;
    expect(deduper.shouldRun(1)).toBe(false);
    now += 1;
    expect(deduper.shouldRun(1)).toBe(true);
  });
});

describe("restore conflicts", () => {
  const request = { gameId: 1 } as CloudSaveRequest;
  beforeEach(() => mocks.invoke.mockReset());

  it("asks before overwriting a newer local save", async () => {
    mocks.invoke
      .mockResolvedValueOnce({ status: "localNewer", localModifiedAt: 2 })
      .mockResolvedValueOnce({ status: "restoreSuccess" });
    const confirm = vi.fn().mockResolvedValue(true);
    const outcome = await restoreWithConflictPrompt(request, {
      interactive: true,
      confirmUseCloud: confirm,
    });
    expect(confirm).toHaveBeenCalled();
    expect(mocks.invoke).toHaveBeenNthCalledWith(1, "cloud_save_restore", {
      request,
      policy: "ask",
    });
    expect(mocks.invoke).toHaveBeenNthCalledWith(2, "cloud_save_restore", {
      request,
      policy: "overwrite",
    });
    expect(outcome.status).toBe("restoreSuccess");
  });

  it("keeps the local save when declined or not interactive", async () => {
    mocks.invoke.mockResolvedValueOnce({ status: "localNewer" });
    const declined = await restoreWithConflictPrompt(request, {
      interactive: true,
      confirmUseCloud: async () => false,
    });
    expect(declined.status).toBe("keptLocal");
    mocks.invoke.mockResolvedValueOnce({ status: "keptLocal" });
    const confirm = vi.fn();
    await restoreWithConflictPrompt(request, {
      interactive: false,
      confirmUseCloud: confirm,
    });
    expect(mocks.invoke).toHaveBeenLastCalledWith("cloud_save_restore", {
      request,
      policy: "keepLocal",
    });
    expect(confirm).not.toHaveBeenCalled();
  });
});

describe("installed versions", () => {
  it("picks the newest installed version of a game", () => {
    const version = (gameId: number, dir: string, installedAt: number) =>
      ({ gameId, versionDirectory: dir, installedAt }) as InstalledGameInfo;
    expect(
      newestInstalledVersion(
        [version(1, "a", 5), version(1, "b", 9), version(2, "c", 99)],
        1,
      )?.versionDirectory,
    ).toBe("b");
    expect(newestInstalledVersion([], 1)).toBeUndefined();
  });
});

describe("save folders", () => {
  beforeEach(() => mocks.invoke.mockReset());

  it("reads the server's save folders from game metadata", () => {
    expect(
      cloudSaveServerPaths({
        metadata: { save_paths: ["%APPDATA%/Game", " ", 3 as any] },
      }),
    ).toEqual(["%APPDATA%/Game"]);
    expect(cloudSaveServerPaths({ metadata: null })).toEqual([]);
    expect(cloudSaveServerPaths(undefined)).toEqual([]);
  });

  it("sends save folders and the session start with a request", () => {
    const request = buildCloudSaveRequest({
      gameId: 46,
      versionDirectory: "v",
      installationPath: "i",
      title: "Exquisite Fishing",
      serverUrl: "https://games.test/",
      userId: 1,
      accessToken: "t",
      roots: [],
      profileKey: null,
      savePaths: ["%LOCALAPPDATALOW%/PinkySoul/ExquisiteFishing"],
      sessionStartedAt: 1234,
    });
    expect(request.savePaths).toEqual([
      "%LOCALAPPDATALOW%/PinkySoul/ExquisiteFishing",
    ]);
    expect(request.sessionStartedAt).toBe(1234);
    expect(request.serverUrl).toBe("https://games.test");
    expect(
      buildCloudSaveRequest({ ...request, roots: [], profileKey: null })
        .sessionStartedAt,
    ).toBe(1234);
  });

  it("asks Rust for and stores the folders of an installation", async () => {
    mocks.invoke.mockResolvedValue({ source: "none", paths: [] });
    await getSaveFolders({
      installationPath: "C:/Games/Fishing",
      versionDirectory: "C:/Games/v1",
      detect: true,
    });
    expect(mocks.invoke).toHaveBeenLastCalledWith("cloud_save_folders", {
      installationPath: "C:/Games/Fishing",
      versionDirectory: "C:/Games/v1",
      serverPaths: [],
      detect: true,
    });
    await setSaveFolders({
      installationPath: "C:/Games/Fishing",
      versionDirectory: "C:/Games/v1",
      folders: ["C:/Users/N/AppData/LocalLow/PinkySoul/ExquisiteFishing"],
    });
    expect(mocks.invoke).toHaveBeenLastCalledWith("cloud_save_set_folders", {
      installationPath: "C:/Games/Fishing",
      versionDirectory: "C:/Games/v1",
      folders: ["C:/Users/N/AppData/LocalLow/PinkySoul/ExquisiteFishing"],
    });
  });
});
