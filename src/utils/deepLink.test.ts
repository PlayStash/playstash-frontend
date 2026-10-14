import { describe, expect, it, vi } from "vitest";
import {
  buildDeepLink,
  jumpListRoute,
  runDesktopCommand,
  type DesktopCommandDeps,
} from "./deepLink";
import type { DesktopCommand } from "./desktopCommands";

function deps(overrides: Partial<DesktopCommandDeps> = {}): DesktopCommandDeps {
  return {
    navigate: vi.fn(),
    userRole: () => 1,
    gameExists: vi.fn(async () => true),
    alert: vi.fn(),
    gameNotFoundMessage: (id) => `Game with ID ${id} not found`,
    requestGameDownload: vi.fn(async () => "queued" as const),
    uninstallInstalledGame: vi.fn(async () => true),
    launchInstalledGame: vi.fn(async () => ({ ok: true })),
    ...overrides,
  };
}

function command(partial: Partial<DesktopCommand>): DesktopCommand {
  return { id: "cmd-1", action: "show", ...partial };
}

describe("jump list routes", () => {
  it("maps page commands and guards the admin page", () => {
    expect(jumpListRoute(0, 1)).toBe("/library");
    expect(jumpListRoute(1, 1)).toBe("/downloads");
    expect(jumpListRoute(2, 1)).toBe("/community");
    expect(jumpListRoute(3, 1)).toBe("/settings");
    expect(jumpListRoute(4, 1)).toBeNull();
    expect(jumpListRoute(4, 3)).toBe("/admin");
    expect(jumpListRoute(15, 3)).toBeNull();
    expect(jumpListRoute(9, 3)).toBeNull();
  });

  it("builds deep links like the WPF client", () => {
    expect(buildDeepLink("show", { gameid: 5 })).toBe(
      "playstash://show?gameid=5",
    );
    expect(buildDeepLink("start", { gameid: 5, minimized: true })).toBe(
      "playstash://start?gameid=5&minimized=True",
    );
    expect(buildDeepLink("show")).toBe("playstash://show");
  });
});

describe("runDesktopCommand", () => {
  it("starts an installed game without navigating", async () => {
    const d = deps();
    const result = await runDesktopCommand(
      command({ action: "start", gameId: 5, installed: true }),
      d,
    );
    expect(result.ok).toBe(true);
    expect(d.launchInstalledGame).toHaveBeenCalledWith({
      gameId: 5,
      source: "cli",
    });
    expect(d.navigate).not.toHaveBeenCalled();
  });

  it("installs a missing game on start with autoInstall, else shows it", async () => {
    const d = deps();
    await runDesktopCommand(
      command({
        action: "start",
        gameId: 5,
        installed: false,
        autoInstall: true,
      }),
      d,
    );
    expect(d.requestGameDownload).toHaveBeenCalledWith({
      gameId: 5,
      background: false,
      autoInstall: true,
    });
    expect(d.navigate).toHaveBeenCalledWith("/downloads");

    const show = deps();
    await runDesktopCommand(
      command({ action: "start", gameId: 6, installed: false }),
      show,
    );
    expect(show.requestGameDownload).not.toHaveBeenCalled();
    expect(show.navigate).toHaveBeenCalledWith("/library/6");
  });

  it("queues installs in the background and opens downloads", async () => {
    const d = deps();
    await runDesktopCommand(
      command({
        action: "install",
        gameId: 7,
        installed: false,
        minimized: true,
        autoInstall: true,
        versionId: 12,
      }),
      d,
    );
    expect(d.requestGameDownload).toHaveBeenCalledWith({
      gameId: 7,
      background: true,
      autoInstall: true,
      versionId: 12,
    });
    expect(d.navigate).toHaveBeenCalledWith("/downloads");
  });

  it("opens the game page when install targets an installed game", async () => {
    const d = deps();
    await runDesktopCommand(
      command({ action: "install", gameId: 7, installed: true }),
      d,
    );
    expect(d.requestGameDownload).not.toHaveBeenCalled();
    expect(d.navigate).toHaveBeenCalledWith("/library/7");
  });

  it("does not open downloads when the download flow fails", async () => {
    const d = deps({
      requestGameDownload: vi.fn(async () => "error" as const),
    });
    const result = await runDesktopCommand(
      command({ action: "install", gameId: 7, installed: false }),
      d,
    );
    expect(result.ok).toBe(false);
    expect(d.navigate).not.toHaveBeenCalled();
  });

  it("uninstalls with confirmation unless confirm is false", async () => {
    const d = deps();
    await runDesktopCommand(
      command({ action: "uninstall", gameId: 8, installed: true }),
      d,
    );
    expect(d.uninstallInstalledGame).toHaveBeenCalledWith({
      gameId: 8,
      confirm: true,
    });

    const silent = deps();
    await runDesktopCommand(
      command({
        action: "uninstall",
        gameId: 8,
        installed: true,
        confirm: false,
      }),
      silent,
    );
    expect(silent.uninstallInstalledGame).toHaveBeenCalledWith({
      gameId: 8,
      confirm: false,
    });
    expect(silent.navigate).not.toHaveBeenCalled();

    const missing = deps();
    await runDesktopCommand(
      command({ action: "uninstall", gameId: 8, installed: false }),
      missing,
    );
    expect(missing.uninstallInstalledGame).not.toHaveBeenCalled();
    expect(missing.navigate).toHaveBeenCalledWith("/library/8");
  });

  it("navigates jump-list pages and ignores the admin page for non-admins", async () => {
    const d = deps();
    await runDesktopCommand(command({ jumpListCommand: 2 }), d);
    expect(d.navigate).toHaveBeenCalledWith("/community");

    const user = deps({ userRole: () => 1 });
    const result = await runDesktopCommand(
      command({ jumpListCommand: 4 }),
      user,
    );
    expect(result.ok).toBe(false);
    expect(user.navigate).not.toHaveBeenCalled();

    const admin = deps({ userRole: () => 3 });
    await runDesktopCommand(command({ jumpListCommand: 4 }), admin);
    expect(admin.navigate).toHaveBeenCalledWith("/admin");
  });

  it("alerts when a game is unknown on the server and in the cache", async () => {
    const d = deps({ gameExists: vi.fn(async () => false) });
    const result = await runDesktopCommand(command({ gameId: 99 }), d);
    expect(result.ok).toBe(false);
    expect(d.alert).toHaveBeenCalledWith("Game with ID 99 not found");
    expect(d.navigate).not.toHaveBeenCalled();
  });
});
