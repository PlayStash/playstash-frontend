// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  alert: vi.fn(),
  writeText: vi.fn(),
  files: new Map<string, string>(),
  umu: {
    checkUmuStatus: async () => ({ installed: true }),
    installUmu: async () => true,
  },
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/path", () => ({
  join: async (...parts: string[]) => parts.join("/"),
}));
vi.mock("@/context/AlertDialogContext", () => ({
  useAlertDialog: () => ({ showAlert: mocks.alert }),
}));
vi.mock("@/context/UmuContext", () => ({
  useUmu: () => mocks.umu,
}));
vi.mock("@/utils/tauri", () => ({ isTauriApp: () => true }));

import {
  joinInstallPath,
  LaunchOptionsTab,
  mergeExecutableList,
  relativePathForCopy,
} from "./LaunchOptionsTab";

vi.setConfig({ testTimeout: 30_000 });
// Headless UI measures anchored popovers.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const installedGame = {
  gameId: 4,
  gameTitle: "Game",
  versionId: 1,
  versionName: "v1",
  versionDirectory: "/lib/Game",
  installationDirectory: "/lib/Game/Installation",
};
const configPath = "/lib/Game/.playstash.game.config.json";
const game = {
  id: 4,
  title: "Game",
  metadata: {
    title: "Game",
    launch_profiles: [
      { name: "Outside", executable: "../other/evil.exe" },
      { name: "Editor", executable: "tools/editor.exe", parameters: "-edit" },
    ],
  },
} as any;

describe("LaunchOptionsTab helpers", () => {
  it("copies relative paths with the platform separator", () => {
    expect(relativePathForCopy("bin/Game.exe", false)).toBe("bin/Game.exe");
    expect(relativePathForCopy("bin/Game.exe", true)).toBe("bin\\Game.exe");
    expect(relativePathForCopy("\\bin\\Game.exe", false)).toBe("bin/Game.exe");
  });

  it("joins installation paths and keeps the selection in rescans", () => {
    expect(joinInstallPath("/lib/Game/Installation/", "tools/x.exe")).toBe(
      "/lib/Game/Installation/tools/x.exe",
    );
    expect(joinInstallPath("C:\\Games\\X", "tools/x.exe")).toBe(
      "C:\\Games\\X\\tools\\x.exe",
    );
    expect(mergeExecutableList(["a.exe"], "b.exe")).toEqual(["b.exe", "a.exe"]);
    expect(mergeExecutableList(["a.exe"], "a.exe")).toEqual(["a.exe"]);
  });
});

describe("LaunchOptionsTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.files.clear();
    mocks.files.set(
      configPath,
      JSON.stringify({ launchexecutable: "bin/Game.exe" }),
    );
    Object.assign(navigator, { clipboard: { writeText: mocks.writeText } });
    mocks.writeText.mockResolvedValue(undefined);
    mocks.alert.mockResolvedValue(true);
    mocks.invoke.mockImplementation(async (command: string, args: any) => {
      switch (command) {
        case "list_launch_executables":
          return {
            executables: ["bin/Game.exe"],
            nonExecutableScripts: [],
            truncated: false,
          };
        case "fs_path_exists":
          return mocks.files.has(args.path);
        case "fs_read_text_file":
          return mocks.files.get(args.path);
        case "fs_write_text_file":
          mocks.files.set(args.path, args.content);
          return undefined;
        case "resolve_path_inside":
          return args.path.includes("..")
            ? null
            : { relative: "tools/editor.exe", absolute: args.path };
        case "list_proton_builds":
          return [];
        case "resolve_game_wine_prefix":
          return { path: null };
        default:
          return undefined;
      }
    });
  });
  afterEach(cleanup);

  it("copies the executable path relative to the installation", async () => {
    render(<LaunchOptionsTab installedGame={installedGame} game={game} />);
    const button = await screen.findByRole(
      "button",
      { name: "Copy Executable Path" },
      { timeout: 10_000 },
    );
    await waitFor(
      () => expect((button as HTMLButtonElement).disabled).toBe(false),
      { timeout: 10_000 },
    );
    fireEvent.click(button);
    await waitFor(() =>
      expect(mocks.writeText).toHaveBeenCalledWith("bin/Game.exe"),
    );
    expect(mocks.alert).toHaveBeenCalledWith({
      title: "Copied executable path relative to the installation directory.",
    });
  });

  it("rejects a server profile outside the installation", async () => {
    render(<LaunchOptionsTab installedGame={installedGame} game={game} />);
    const select = await screen.findByRole(
      "button",
      { name: "Server Launch Profile" },
      { timeout: 10_000 },
    );
    await act(async () => {
      fireEvent.click(select);
    });
    fireEvent.click(await screen.findByRole("option", { name: "Outside" }));
    await waitFor(() =>
      expect(mocks.alert).toHaveBeenCalledWith({
        title:
          "The launch profile executable was not found inside this installation.",
      }),
    );
  });

  it("applies a server profile inside the installation", async () => {
    render(<LaunchOptionsTab installedGame={installedGame} game={game} />);
    const select = await screen.findByRole(
      "button",
      { name: "Server Launch Profile" },
      { timeout: 10_000 },
    );
    await act(async () => {
      fireEvent.click(select);
    });
    fireEvent.click(await screen.findByRole("option", { name: "Editor" }));
    expect(await screen.findByDisplayValue("-edit")).toBeTruthy();
    await waitFor(
      () => {
        const config = JSON.parse(mocks.files.get(configPath)!);
        expect(config.launchexecutable).toBe("tools/editor.exe");
        expect(config.launchparameters).toBe("-edit");
      },
      { timeout: 10_000 },
    );
  });
});
