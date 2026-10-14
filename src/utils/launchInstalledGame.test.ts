import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  emit: vi.fn(),
  files: new Map<string, string>(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/path", () => ({
  join: async (...parts: string[]) => parts.join("/"),
}));
vi.mock("@tauri-apps/api/event", () => ({ emit: mocks.emit }));

import { setGameEventReporter } from "@/utils/gameEventReporter";
import {
  getPreLaunchHooks,
  launchInstalledGame,
  registerPreLaunchHook,
  resolveLaunchCommand,
} from "./launchInstalledGame";

const installed = {
  gameId: 7,
  versionId: 3,
  versionDirectory: "/lib/Game/Versions/(3) v1",
  installationDirectory: "/lib/Game/Versions/(3) v1/Installation",
  gameTitle: "Game",
};
const configPath = `${installed.versionDirectory}/.playstash.game.config.json`;

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
    case "list_launch_executables":
      return {
        executables: ["bin/Game.exe", "bin/Other.exe"],
        nonExecutableScripts: [],
        truncated: false,
      };
    default:
      return undefined;
  }
}

describe("resolveLaunchCommand", () => {
  const metadata = {
    launch_executable: "meta.exe",
    launch_parameters: "-meta",
  };
  const config = {
    launchexecutable: "configured.exe",
    launchparameters: "-configured",
    emulatorexecutable: "C:/Emu/emu.exe",
  };

  it("prefers profile > emulator > configured > metadata", () => {
    expect(
      resolveLaunchCommand(
        { name: "P", executable: "profile.exe", parameters: "-p" },
        config,
        metadata,
      ),
    ).toEqual({ executable: "profile.exe", parameters: "-p" });
    expect(resolveLaunchCommand(undefined, config, metadata)).toEqual({
      absoluteExecutable: "C:/Emu/emu.exe",
      parameters: "-configured",
    });
    expect(
      resolveLaunchCommand(
        undefined,
        { launchexecutable: "configured.exe" },
        metadata,
      ),
    ).toEqual({ executable: "configured.exe", parameters: "-meta" });
    expect(resolveLaunchCommand(undefined, {}, metadata)).toEqual({
      executable: "meta.exe",
      parameters: "-meta",
    });
  });

  it("uses only the profile's parameters when a profile is chosen", () => {
    expect(
      resolveLaunchCommand(
        { name: "P", executable: "p.exe" },
        config,
        metadata,
      ),
    ).toEqual({ executable: "p.exe" });
  });
});

describe("launchInstalledGame", () => {
  const unregister: (() => void)[] = [];
  const reported: unknown[][] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.files.clear();
    reported.length = 0;
    mocks.invoke.mockImplementation(async (command: string, args: any) =>
      route(command, args),
    );
    unregister.push(setGameEventReporter((...args) => reported.push(args)));
  });
  afterEach(() => {
    unregister.splice(0).forEach((fn) => fn());
  });

  const launchArgs = () =>
    mocks.invoke.mock.calls.find(([command]) => command === "launch_game")?.[1];

  it("launches the configured executable and reports the play", async () => {
    mocks.files.set(
      configPath,
      JSON.stringify({
        launchexecutable: "bin/Game.exe",
        launchparameters: "-x",
      }),
    );
    const result = await launchInstalledGame({
      gameId: 7,
      source: "game-view",
      installed,
      showErrors: false,
    });
    expect(result).toEqual({ ok: true });
    expect(launchArgs()).toMatchObject({
      gameId: 7,
      executableRelativePath: "bin/Game.exe",
      launchParameters: "-x",
      absoluteExecutable: null,
    });
    expect(reported).toEqual([[7, "played", 3]]);
    expect(mocks.emit).toHaveBeenCalledWith("game-session", {
      gameId: 7,
      versionDirectory: installed.versionDirectory,
      state: "started",
    });
    expect(mocks.invoke).toHaveBeenCalledWith(
      "set_last_played",
      expect.objectContaining({ versionDirectory: installed.versionDirectory }),
    );
  });

  it("passes an emulator as absolute executable", async () => {
    mocks.files.set(
      configPath,
      JSON.stringify({
        launchexecutable: "bin/Game.exe",
        emulatorexecutable: "/emu/emu",
        launchparameters: '"/rom.bin"',
      }),
    );
    await launchInstalledGame({
      gameId: 7,
      source: "cli",
      installed,
      showErrors: false,
    });
    expect(launchArgs()).toMatchObject({
      absoluteExecutable: "/emu/emu",
      launchParameters: '"/rom.bin"',
    });
  });

  it("auto-detects and persists the executable when none is configured", async () => {
    mocks.files.set(configPath, JSON.stringify({ gameid: 7 }));
    const result = await launchInstalledGame({
      gameId: 7,
      source: "game-card",
      installed,
      showErrors: false,
    });
    expect(result.ok).toBe(true);
    expect(launchArgs()).toMatchObject({
      executableRelativePath: "bin/Game.exe",
    });
    expect(JSON.parse(mocks.files.get(configPath)!)).toEqual({
      gameid: 7,
      launchexecutable: "bin/Game.exe",
    });
  });

  it("reports when no executable can be found", async () => {
    mocks.invoke.mockImplementation(async (command: string, args: any) =>
      command === "list_launch_executables"
        ? { executables: [] }
        : route(command, args),
    );
    const result = await launchInstalledGame({
      gameId: 7,
      source: "cli",
      installed,
      showErrors: false,
    });
    expect(result).toEqual({ ok: false, message: "No valid Executable found" });
    expect(launchArgs()).toBeUndefined();
  });

  it("refuses games that are not installed", async () => {
    const result = await launchInstalledGame({
      gameId: 7,
      source: "cli",
      installed: { ...installed, installationDirectory: "/missing" },
      showErrors: false,
    });
    expect(result).toEqual({ ok: false, message: "Install this game first." });
  });

  it("runs hooks in order, survives a throwing hook and stops on abort", async () => {
    mocks.files.set(
      configPath,
      JSON.stringify({ launchexecutable: "bin/Game.exe" }),
    );
    const order: string[] = [];
    unregister.push(
      registerPreLaunchHook("first", async (context) => {
        order.push(`first:${context.versionId}`);
        throw new Error("boom");
      }),
      registerPreLaunchHook("second", async () => {
        order.push("second");
      }),
    );
    expect(getPreLaunchHooks().map(([name]) => name)).toEqual([
      "first",
      "second",
    ]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ok = await launchInstalledGame({
      gameId: 7,
      source: "game-view",
      installed,
      showErrors: false,
    });
    expect(ok.ok).toBe(true);
    expect(order).toEqual(["first:3", "second"]);

    unregister.push(
      registerPreLaunchHook("abort", async () => ({
        abort: true,
        message: "Cloud save conflict",
      })),
    );
    mocks.invoke.mockClear();
    const aborted = await launchInstalledGame({
      gameId: 7,
      source: "game-view",
      installed,
      showErrors: false,
    });
    expect(aborted).toEqual({ ok: false, message: "Cloud save conflict" });
    expect(launchArgs()).toBeUndefined();
    warn.mockRestore();
  });

  it("joins a launch that is already starting", async () => {
    mocks.files.set(
      configPath,
      JSON.stringify({ launchexecutable: "bin/Game.exe" }),
    );
    const [a, b] = await Promise.all([
      launchInstalledGame({
        gameId: 7,
        source: "big-picture",
        installed,
        showErrors: false,
      }),
      launchInstalledGame({
        gameId: 7,
        source: "big-picture",
        installed,
        showErrors: false,
      }),
    ]);
    expect(a).toEqual(b);
    expect(
      mocks.invoke.mock.calls.filter(([command]) => command === "launch_game"),
    ).toHaveLength(1);
  });

  it("returns the launch error", async () => {
    mocks.files.set(
      configPath,
      JSON.stringify({ launchexecutable: "bin/Game.exe" }),
    );
    mocks.invoke.mockImplementation(async (command: string, args: any) => {
      if (command === "launch_game") throw "Selected executable does not exist";
      return route(command, args);
    });
    const result = await launchInstalledGame({
      gameId: 7,
      source: "game-view",
      installed,
      showErrors: false,
    });
    expect(result).toEqual({
      ok: false,
      message: "Selected executable does not exist",
    });
    expect(reported).toEqual([]);
  });
});
