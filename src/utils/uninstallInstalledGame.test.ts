// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  open: vi.fn(),
  alert: vi.fn(),
  files: new Map<string, string>(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/path", () => ({
  join: async (...parts: string[]) => parts.join("/"),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mocks.open }));

import { setGameEventReporter } from "@/utils/gameEventReporter";
import {
  effectiveInstallType,
  exitCodeFromError,
  isUninstallSuccessCode,
  registerPreUninstallHook,
  uninstallInstalledGame,
} from "./uninstallInstalledGame";

const installed = {
  gameId: 9,
  gameTitle: "Folder Title",
  gameType: "WINDOWS_PORTABLE",
  versionId: 2,
  versionDirectory: "/lib/Game/Versions/(2) v2",
  installationDirectory: "/lib/Game/Versions/(2) v2/Installation",
};
const configPath = `${installed.versionDirectory}/.playstash.game.config.json`;
const game = {
  id: 9,
  title: "Game",
  type: "WINDOWS_PORTABLE",
  metadata: { title: "My Game", uninstaller_executable: "unins000.exe" },
} as any;

function route(command: string, args: any): unknown {
  switch (command) {
    case "fs_path_exists":
      return (
        args.path === installed.installationDirectory ||
        mocks.files.has(args.path)
      );
    case "fs_read_text_file":
      return mocks.files.get(args.path);
    case "fs_write_text_file":
      mocks.files.set(args.path, args.content);
      return undefined;
    case "fs_has_leftover_content":
      return false;
    case "resolve_game_wine_prefix":
      return { path: null, exists: false, isPrefix: false, managed: false };
    case "find_uninstaller_executable":
      return `${installed.installationDirectory}/unins000.exe`;
    case "launch_uninstall_executable":
      return 0;
    default:
      return undefined;
  }
}

const commands = () => mocks.invoke.mock.calls.map(([command]) => command);

describe("uninstall helpers", () => {
  it("lets a forced install type override the recorded and server type", () => {
    expect(
      effectiveInstallType(
        { forcedgametype: "WINDOWS_SETUP" },
        "WINDOWS_PORTABLE",
        "LINUX_PORTABLE",
      ),
    ).toBe("WINDOWS_SETUP");
    expect(effectiveInstallType({}, "WINDOWS_PORTABLE", "WINDOWS_SETUP")).toBe(
      "WINDOWS_PORTABLE",
    );
    expect(effectiveInstallType({}, null, "WINDOWS_SETUP")).toBe(
      "WINDOWS_SETUP",
    );
  });

  it("treats 0 and 3010 as success", () => {
    expect(isUninstallSuccessCode(0)).toBe(true);
    expect(isUninstallSuccessCode(3010)).toBe(true);
    expect(isUninstallSuccessCode(null)).toBe(true);
    expect(isUninstallSuccessCode(1)).toBe(false);
    expect(
      exitCodeFromError("Uninstall executable exited with code 1603."),
    ).toBe(1603);
    expect(exitCodeFromError("other")).toBeNull();
  });
});

describe("uninstallInstalledGame", () => {
  const cleanup: (() => void)[] = [];
  const reported: unknown[][] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.files.clear();
    reported.length = 0;
    mocks.invoke.mockImplementation(async (command: string, args: any) =>
      route(command, args),
    );
    mocks.alert.mockResolvedValue(true);
    window.showAlertDialog = mocks.alert;
    cleanup.push(setGameEventReporter((...args) => reported.push(args)));
  });
  afterEach(() => {
    cleanup.splice(0).forEach((fn) => fn());
    delete window.showAlertDialog;
  });

  it("removes a portable game, runs hooks and removes the shortcut", async () => {
    mocks.files.set(configPath, JSON.stringify({ installationfinished: true }));
    const hook = vi.fn(async () => {});
    cleanup.push(registerPreUninstallHook(hook));

    const result = await uninstallInstalledGame({
      gameId: 9,
      confirm: true,
      installed,
      game,
    });

    expect(result).toBe(true);
    expect(hook).toHaveBeenCalledWith({
      gameId: 9,
      versionId: 2,
      versionDirectory: installed.versionDirectory,
      installationPath: installed.installationDirectory,
    });
    expect(mocks.invoke).toHaveBeenCalledWith("fs_remove", {
      path: installed.installationDirectory,
      recursive: true,
    });
    expect(mocks.invoke).toHaveBeenCalledWith("remove_desktop_shortcut", {
      title: "My Game",
    });
    expect(JSON.parse(mocks.files.get(configPath)!).installationfinished).toBe(
      false,
    );
    expect(reported).toEqual([[9, "uninstalled", 2]]);
  });

  it("runs the pre-uninstall hooks before any file or prefix is deleted", async () => {
    mocks.files.set(configPath, JSON.stringify({ installationfinished: true }));
    mocks.invoke.mockImplementation(async (command: string, args: any) =>
      command === "resolve_game_wine_prefix"
        ? {
            path: "/prefixes/9",
            exists: true,
            isPrefix: true,
            managed: true,
            sizeBytes: null,
          }
        : route(command, args),
    );
    // Answer "Delete prefix" to the prefix question, yes to everything else.
    mocks.alert.mockImplementation(
      async (options: { title: string }) =>
        !options.title.startsWith("Delete the Wine/Proton prefix"),
    );
    let commandsAtHook: string[] = [];
    cleanup.push(
      registerPreUninstallHook(async () => {
        commandsAtHook = commands();
      }),
    );

    await uninstallInstalledGame({ gameId: 9, confirm: true, installed, game });

    expect(commands()).toContain("fs_remove");
    expect(commands()).toContain("delete_game_wine_prefix");
    expect(commandsAtHook).not.toContain("fs_remove");
    expect(commandsAtHook).not.toContain("delete_game_wine_prefix");
    expect(commands().indexOf("fs_remove")).toBeGreaterThanOrEqual(
      commandsAtHook.length,
    );
  });

  it("does nothing when the confirmation is declined", async () => {
    mocks.alert.mockResolvedValue(false);
    const hook = vi.fn(async () => {});
    cleanup.push(registerPreUninstallHook(hook));
    expect(
      await uninstallInstalledGame({
        gameId: 9,
        confirm: true,
        installed,
        game,
      }),
    ).toBe(false);
    expect(hook).not.toHaveBeenCalled();
    expect(commands()).not.toContain("fs_remove");
  });

  it("follows the forced setup type and accepts exit code 3010", async () => {
    mocks.files.set(
      configPath,
      JSON.stringify({ forcedgametype: "WINDOWS_SETUP" }),
    );
    mocks.invoke.mockImplementation(async (command: string, args: any) =>
      command === "launch_uninstall_executable" ? 3010 : route(command, args),
    );

    const result = await uninstallInstalledGame({
      gameId: 9,
      confirm: false,
      installed,
      game,
    });

    expect(result).toBe(true);
    expect(mocks.alert).not.toHaveBeenCalledWith(
      expect.objectContaining({ negativeText: "No" }),
    );
    expect(mocks.invoke).toHaveBeenCalledWith("find_uninstaller_executable", {
      installationPath: installed.installationDirectory,
      needle: "unins000.exe",
    });
    expect(mocks.invoke).toHaveBeenCalledWith(
      "launch_uninstall_executable",
      expect.objectContaining({
        executablePath: `${installed.installationDirectory}/unins000.exe`,
      }),
    );
    expect(commands()).not.toContain("fs_remove");
    expect(mocks.invoke).toHaveBeenCalledWith("remove_desktop_shortcut", {
      title: "My Game",
    });
  });

  it("keeps the files when the uninstaller fails", async () => {
    mocks.files.set(
      configPath,
      JSON.stringify({ forcedgametype: "WINDOWS_SETUP" }),
    );
    mocks.invoke.mockImplementation(async (command: string, args: any) => {
      if (command === "launch_uninstall_executable")
        throw "Uninstall executable exited with code 1603.";
      return route(command, args);
    });

    expect(
      await uninstallInstalledGame({
        gameId: 9,
        confirm: false,
        installed,
        game,
      }),
    ).toBe(false);
    expect(mocks.alert).toHaveBeenCalledWith(
      expect.objectContaining({
        description:
          "The uninstaller exited with code 1603. Installation files were preserved.",
      }),
    );
    expect(commands()).not.toContain("remove_desktop_shortcut");
    expect(reported).toEqual([]);
  });
});
