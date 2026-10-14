// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  open: vi.fn(),
  files: new Map<string, string>(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/path", () => ({
  join: async (...parts: string[]) => parts.join("/"),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mocks.open }));

import {
  buildEmulatorParameters,
  EmulatorLaunchDialog,
} from "./EmulatorLaunchDialog";

const installationDirectory = "/lib/Game/Installation";
const versionDirectory = "/lib/Game";
const configPath = `${versionDirectory}/.playstash.game.config.json`;

// Dialog transitions plus a busy CI machine can exceed the 5 s default.
vi.setConfig({ testTimeout: 20_000 });

describe("EmulatorLaunchDialog", () => {
  let emulatorExists = true;
  let romInside = true;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.files.clear();
    mocks.files.set(
      configPath,
      JSON.stringify({ launchexecutable: "game.exe" }),
    );
    emulatorExists = true;
    romInside = true;
    mocks.invoke.mockImplementation(async (command: string, args: any) => {
      switch (command) {
        case "resolve_emulator_executable":
          return emulatorExists ? args.path : null;
        case "resolve_path_inside":
          return romInside
            ? {
                relative: "roms/Super Game.sfc",
                absolute: `${installationDirectory}/roms/Super Game.sfc`,
              }
            : null;
        case "fs_path_exists":
          return mocks.files.has(args.path);
        case "fs_read_text_file":
          return mocks.files.get(args.path);
        case "fs_write_text_file":
          mocks.files.set(args.path, args.content);
          return undefined;
        default:
          return undefined;
      }
    });
  });
  afterEach(cleanup);

  const renderDialog = (onSaved = vi.fn()) => {
    render(
      <EmulatorLaunchDialog
        open
        onClose={vi.fn()}
        installationDirectory={installationDirectory}
        versionDirectory={versionDirectory}
        config={{}}
        onSaved={onSaved}
      />,
    );
    return onSaved;
  };

  const pick = async (path: string, buttonIndex: number) => {
    mocks.open.mockResolvedValueOnce(path);
    fireEvent.click(
      screen.getAllByRole("button", { name: "Browse" })[buttonIndex],
    );
    await screen.findByDisplayValue(path);
  };

  const save = () =>
    fireEvent.click(
      screen.getByRole("button", { name: "Save Launch Configuration" }),
    );

  it("requires an existing emulator", async () => {
    renderDialog();
    save();
    expect(
      await screen.findByText("Choose an existing emulator executable."),
    ).toBeTruthy();

    emulatorExists = false;
    await pick("/missing/emu.exe", 0);
    save();
    expect(
      await screen.findByText("Choose an existing emulator executable."),
    ).toBeTruthy();
  });

  it("requires a ROM inside the installation", async () => {
    renderDialog();
    await pick("/emu/retroarch.exe", 0);
    save();
    expect(
      await screen.findByText(
        "Choose an existing ROM inside this game's installation.",
      ),
    ).toBeTruthy();

    romInside = false;
    await pick("/elsewhere/rom.sfc", 1);
    save();
    expect(
      await screen.findByText(
        "Choose an existing ROM inside this game's installation.",
      ),
    ).toBeTruthy();
  });

  it("requires $ROM in the arguments", async () => {
    renderDialog();
    await pick("/emu/retroarch.exe", 0);
    await pick(`${installationDirectory}/roms/Super Game.sfc`, 1);
    fireEvent.change(screen.getByDisplayValue("$ROM"), {
      target: { value: "-L core.dll" },
    });
    save();
    expect(
      await screen.findByText("The arguments must contain $ROM."),
    ).toBeTruthy();
  });

  it("saves the emulator with the quoted absolute ROM path", async () => {
    const onSaved = renderDialog();
    await pick("/emu/retroarch.exe", 0);
    await pick(`${installationDirectory}/roms/Super Game.sfc`, 1);
    fireEvent.change(screen.getByDisplayValue("$ROM"), {
      target: { value: "-L core.dll $ROM" },
    });
    save();
    expect(await screen.findByText("Emulator launch saved.")).toBeTruthy();

    const config = JSON.parse(mocks.files.get(configPath)!);
    expect(config).toEqual({
      launchexecutable: "game.exe",
      emulatorexecutable: "/emu/retroarch.exe",
      emulatorrom: "roms/Super Game.sfc",
      emulatorarguments: "-L core.dll $ROM",
      launchparameters: `-L core.dll "${installationDirectory}/roms/Super Game.sfc"`,
    });
    expect(onSaved).toHaveBeenCalledWith(config);
  });

  it("replaces every $ROM placeholder", () => {
    expect(buildEmulatorParameters("$ROM --again $ROM", "/r.bin")).toBe(
      '"/r.bin" --again "/r.bin"',
    );
  });
});
