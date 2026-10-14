import { describe, expect, it } from "vitest";
import type { InstalledGameInfo } from "@/hooks/useInstalledGames";
import {
  installedGameTitle,
  needsPlaystashLaunch,
  newestInstalledVersions,
  resolveLaunchTarget,
  steamShortcutSignature,
  toSteamShortcutGame,
} from "./steamShortcuts";
import { chatLink, chatTargetFromParams } from "./chatLinks";
import { folderTitleFromVersionDirectory } from "./gameTitles";

function info(overrides: Partial<InstalledGameInfo> = {}): InstalledGameInfo {
  return {
    gameId: 1,
    gameTitle: "Folder Title",
    gameMetadata: null,
    cachedMetadata: {
      id: 1,
      title: "server title",
      metadata: {
        title: "Metadata Title",
        cover: { id: 11 },
        background: { id: 12 },
        launch_executable: "bin/meta.exe",
        launch_parameters: "-meta",
      },
    },
    gameType: null,
    versionId: 1,
    versionName: "1.0",
    installationDirectory: "/games/Title/Versions/(1) 1.0/Installation",
    versionDirectory: "/games/Title/Versions/(1) 1.0",
    installedAt: 100,
    lastPlayedAt: 0,
    ...overrides,
  };
}

describe("steam shortcut list", () => {
  it("keeps only the newest version of every game", () => {
    const result = newestInstalledVersions([
      info({ versionId: 1, installedAt: 100 }),
      info({ versionId: 2, installedAt: 200 }),
      info({ gameId: 2, versionId: 5, installedAt: 50 }),
      info({ gameId: 2, versionId: 6, installedAt: 50 }),
    ]);
    expect(result.map((entry) => [entry.gameId, entry.versionId])).toEqual([
      [1, 2],
      [2, 6],
    ]);
  });

  it("prefers the metadata title", () => {
    expect(installedGameTitle(info())).toBe("Metadata Title");
    expect(installedGameTitle(info({ cachedMetadata: null }))).toBe(
      "Folder Title",
    );
  });

  it("resolves emulator > config > server launch executable", () => {
    expect(
      resolveLaunchTarget(
        {
          emulatorexecutable: "/emu/retroarch",
          launchexecutable: "game.exe",
          launchparameters: '-L core "/rom.sfc"',
        },
        info(),
      ),
    ).toEqual({
      kind: "emulator",
      exe: "/emu/retroarch",
      launchOptions: '-L core "/rom.sfc"',
    });
    expect(
      resolveLaunchTarget({ launchexecutable: "game.exe" }, info()),
    ).toEqual({
      kind: "relative",
      relativeExe: "game.exe",
      launchOptions: "-meta",
    });
    expect(resolveLaunchTarget(null, info())).toEqual({
      kind: "relative",
      relativeExe: "bin/meta.exe",
      launchOptions: "-meta",
    });
    expect(resolveLaunchTarget({}, info({ cachedMetadata: null }))).toBeNull();
  });

  it("routes emulator, admin and umu launches through PlayStash", () => {
    const relative = {
      kind: "relative" as const,
      relativeExe: "a",
      launchOptions: "",
    };
    expect(
      needsPlaystashLaunch(null, { ...relative, kind: "relative" }, true),
    ).toBe(false);
    expect(
      needsPlaystashLaunch(
        null,
        { kind: "emulator", exe: "/e", launchOptions: "" },
        true,
      ),
    ).toBe(true);
    expect(needsPlaystashLaunch({ launchasadmin: true }, relative, true)).toBe(
      true,
    );
    expect(needsPlaystashLaunch({ umugameid: "x" }, relative, false)).toBe(
      true,
    );
    expect(needsPlaystashLaunch({ umugameid: "x" }, relative, true)).toBe(
      false,
    );
  });

  it("builds the command payload with artwork ids", () => {
    const target = resolveLaunchTarget({ launchexecutable: "game" }, info())!;
    expect(toSteamShortcutGame(info(), {}, target, "/abs/game", false)).toEqual(
      {
        gameId: 1,
        title: "Metadata Title",
        exe: "/abs/game",
        launchOptions: "-meta",
        coverMediaId: 11,
        heroMediaId: 12,
        viaPlaystash: false,
      },
    );
  });

  it("changes the signature only when relevant fields change", () => {
    const target = resolveLaunchTarget({ launchexecutable: "game" }, info())!;
    const game = toSteamShortcutGame(info(), {}, target, "/abs/game", false)!;
    const other = { ...game, gameId: 2 };
    expect(steamShortcutSignature([game, other])).toBe(
      steamShortcutSignature([other, game]),
    );
    expect(steamShortcutSignature([game])).not.toBe(
      steamShortcutSignature([{ ...game, launchOptions: "-x" }]),
    );
  });
});

describe("chat links", () => {
  it("parses and builds conversation links", () => {
    expect(chatTargetFromParams(new URLSearchParams("room=game:7"))).toEqual({
      room: "game:7",
    });
    expect(chatTargetFromParams(new URLSearchParams("user=3"))).toEqual({
      recipient_user_id: 3,
    });
    expect(chatTargetFromParams(new URLSearchParams("room=evil"))).toEqual({
      room: "lobby",
    });
    expect(chatLink({ room: "game:7" })).toBe("/chat?room=game:7");
    expect(chatLink({ recipient_user_id: 3 })).toBe("/chat?user=3");
  });
});

describe("folder titles", () => {
  it("reads the game folder from a version directory", () => {
    expect(
      folderTitleFromVersionDirectory(
        "D:\\Lib\\PlayStash\\Hollow Knight\\Versions\\(3) 1.5",
      ),
    ).toBe("Hollow Knight");
    expect(
      folderTitleFromVersionDirectory("/lib/PlayStash/Celeste/Versions/(1) v"),
    ).toBe("Celeste");
  });
});
