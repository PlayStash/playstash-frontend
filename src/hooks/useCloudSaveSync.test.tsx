// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPreLaunchHooks } from "@/utils/launchInstalledGame";
import type { GameSessionEvent } from "@/utils/gameSessions";
import { useCloudSaveSync } from "./useCloudSaveSync";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  showAlert: vi.fn(),
  online: true,
  enabled: true,
  sessionListeners: [] as ((event: GameSessionEvent) => void)[],
}));
vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    serverUrl: "https://library.test",
    user: { id: 1, username: "ada", role: 1 },
    getAccessToken: async () => "test-token",
  }),
}));
vi.mock("@/context/OfflineContext", () => ({
  useOnlineStatus: () => ({ isOnline: mocks.online }),
}));
vi.mock("@/context/AlertDialogContext", () => ({
  useAlertDialog: () => ({ showAlert: mocks.showAlert }),
}));
vi.mock("@/utils/tauri", () => ({ isTauriApp: () => true }));
vi.mock("@/utils/osNotify", () => ({
  isMainWindowFocused: async () => true,
  notify: vi.fn(),
}));
vi.mock("@/utils/gameSessions", () => ({
  onGameSession: async (callback: (event: GameSessionEvent) => void) => {
    mocks.sessionListeners.push(callback);
    return () => undefined;
  },
  onGameExited: async () => () => undefined,
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ isVisible: async () => true }),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));

const installed = {
  gameId: 7,
  gameTitle: "Celeste",
  gameMetadata: null,
  cachedMetadata: { title: "Celeste", metadata: { title: "Celeste" } },
  versionId: 1,
  versionName: "1.0",
  installationDirectory: "C:/Games/PlayStash/Celeste/Versions/1/Installation",
  versionDirectory: "C:/Games/PlayStash/Celeste/Versions/1",
  installedAt: 1,
};

const context = {
  gameId: 7,
  versionId: 1,
  versionDirectory: installed.versionDirectory,
  installationPath: installed.installationDirectory,
  game: { id: 7, title: "Celeste" } as never,
};

function commandCalls(name: string) {
  return mocks.invoke.mock.calls.filter((call) => call[0] === name);
}

async function mountHook() {
  const hook = renderHook(() => useCloudSaveSync());
  await waitFor(() =>
    expect(commandCalls("get_cloud_save_settings")).toHaveLength(1),
  );
  await act(async () => {
    await Promise.resolve();
  });
  return hook;
}

describe("useCloudSaveSync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem(
      "tauri_download_paths",
      JSON.stringify([{ id: "r", path: "C:/Games", label: "" }]),
    );
    mocks.online = true;
    mocks.enabled = true;
    mocks.sessionListeners = [];
    mocks.showAlert.mockResolvedValue(true);
    mocks.invoke.mockImplementation(async (command: string) => {
      switch (command) {
        case "get_cloud_save_settings":
          return {
            enabled: mocks.enabled,
            usePrimaryManifest: true,
            customManifests: [],
          };
        case "cloud_save_restore":
          return { status: "upToDate" };
        case "cloud_save_backup":
          return { status: "backupSuccess" };
        case "list_installed_games":
          return [installed];
        case "get_tracker_status":
          return { trackerRunning: true };
        default:
          return null;
      }
    });
  });
  afterEach(cleanup);

  const preLaunchHook = () =>
    getPreLaunchHooks().find(([name]) => name === "cloud-saves")?.[1];

  it("restores before launch when enabled and online", async () => {
    await mountHook();
    await preLaunchHook()!(context);
    const restores = commandCalls("cloud_save_restore");
    expect(restores).toHaveLength(1);
    expect(restores[0][1]).toMatchObject({
      policy: "ask",
      request: {
        gameId: 7,
        title: "Celeste",
        userId: 1,
        accessToken: "test-token",
        serverUrl: "https://library.test",
        installationPath: installed.installationDirectory,
        roots: ["C:/Games"],
      },
    });
    expect(mocks.showAlert).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Your Savegame is up to date" }),
    );
  });

  it("skips the restore when the setting is off", async () => {
    mocks.enabled = false;
    await mountHook();
    await expect(preLaunchHook()!(context)).resolves.toBeUndefined();
    expect(commandCalls("cloud_save_restore")).toHaveLength(0);
  });

  it("skips the restore while offline", async () => {
    mocks.online = false;
    await mountHook();
    await preLaunchHook()!(context);
    expect(commandCalls("cloud_save_restore")).toHaveLength(0);
  });

  it("never blocks the launch when the restore fails", async () => {
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "get_cloud_save_settings")
        return { enabled: true, usePrimaryManifest: true, customManifests: [] };
      if (command === "cloud_save_restore") throw new Error("boom");
      return null;
    });
    await mountHook();
    await expect(preLaunchHook()!(context)).resolves.toBeUndefined();
  });

  it("backs up once when a session ends", async () => {
    await mountHook();
    await waitFor(() => expect(mocks.sessionListeners).toHaveLength(1));
    const ended: GameSessionEvent = {
      gameId: 7,
      versionDirectory: installed.versionDirectory,
      state: "ended",
      minutes: 30,
    };
    act(() => {
      mocks.sessionListeners[0]({ ...ended, state: "started" });
      mocks.sessionListeners[0](ended);
      mocks.sessionListeners[0](ended);
    });
    await waitFor(() =>
      expect(commandCalls("cloud_save_backup")).toHaveLength(1),
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(commandCalls("cloud_save_backup")).toHaveLength(1);
    expect(commandCalls("cloud_save_backup")[0][1]).toMatchObject({
      request: {
        gameId: 7,
        title: "Celeste",
        versionDirectory: installed.versionDirectory,
      },
    });
  });

  it("queues the backup while offline", async () => {
    mocks.online = false;
    await mountHook();
    await waitFor(() => expect(mocks.sessionListeners).toHaveLength(1));
    act(() => {
      mocks.sessionListeners[0]({
        gameId: 7,
        versionDirectory: installed.versionDirectory,
        state: "ended",
      });
    });
    await waitFor(() =>
      expect(
        localStorage.getItem(
          "playstash:cloudsave-pending:https://library.test:1",
        ),
      ).toBe("[7]"),
    );
    expect(commandCalls("cloud_save_backup")).toHaveLength(0);
  });
});
