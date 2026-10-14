// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDesktopShortcut,
  removeDesktopShortcut,
} from "./desktopShortcut";
import { notify, currentRoute, setCurrentRoute } from "./osNotify";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), tauri: true }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@/utils/tauri", () => ({ isTauriApp: () => mocks.tauri }));

describe("desktop shortcuts", () => {
  const confirm = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tauri = true;
    window.showAlertDialog = confirm;
  });
  afterEach(() => {
    delete window.showAlertDialog;
  });

  it("creates without asking", async () => {
    mocks.invoke.mockResolvedValue("created");
    await expect(
      createDesktopShortcut({ gameId: 5, title: "Game" }),
    ).resolves.toBe("created");
    expect(confirm).not.toHaveBeenCalled();
    expect(mocks.invoke).toHaveBeenCalledWith("create_desktop_shortcut", {
      gameId: 5,
      title: "Game",
      iconPath: null,
      ask: false,
    });
  });

  it("asks first and reports existing shortcuts and declines", async () => {
    mocks.invoke.mockImplementation(async (command: string) =>
      command === "desktop_shortcut_exists" ? true : "created",
    );
    await expect(
      createDesktopShortcut({ gameId: 5, title: "Game", ask: true }),
    ).resolves.toBe("exists");
    expect(confirm).not.toHaveBeenCalled();

    mocks.invoke.mockImplementation(async (command: string) =>
      command === "desktop_shortcut_exists" ? false : "created",
    );
    confirm.mockResolvedValue(false);
    await expect(
      createDesktopShortcut({ gameId: 5, title: "Game", ask: true }),
    ).resolves.toBe("cancelled");
    expect(confirm.mock.calls[0][0].title).toBe(
      "Do you want to create a desktop shortcut for Game?",
    );

    confirm.mockResolvedValue(true);
    await expect(
      createDesktopShortcut({
        gameId: 5,
        title: "Game",
        ask: true,
        iconPath: "C:/game.exe",
      }),
    ).resolves.toBe("created");
  });

  it("never throws when removing", async () => {
    mocks.invoke.mockRejectedValue(new Error("boom"));
    await expect(
      removeDesktopShortcut({ title: "Game" }),
    ).resolves.toBeUndefined();
  });
});

describe("os notifications", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sends notifications through Rust and swallows errors", async () => {
    mocks.invoke.mockRejectedValue(new Error("denied"));
    await expect(
      notify({ title: "Download Complete", body: "Game", imagePath: "/c.png" }),
    ).resolves.toBeUndefined();
    expect(mocks.invoke).toHaveBeenCalledWith("os_notify", {
      title: "Download Complete",
      body: "Game",
      imagePath: "/c.png",
      tag: null,
    });
  });

  it("drops notifications on the web", async () => {
    mocks.tauri = false;
    await notify({ title: "x", body: "y" });
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("reports the tracked route", () => {
    setCurrentRoute("/chat");
    expect(currentRoute()).toBe("/chat");
  });
});
