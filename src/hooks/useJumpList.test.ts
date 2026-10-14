import { describe, expect, it } from "vitest";
import type { InstalledGameInfo } from "@/hooks/useInstalledGames";
import {
  buildJumpListGames,
  installedGameTitle,
  launchIconPath,
  orderJumpListCandidates,
} from "./useJumpList";

function game(partial: Partial<InstalledGameInfo>): InstalledGameInfo {
  return {
    gameId: 1,
    gameTitle: "Folder Title",
    gameMetadata: null,
    cachedMetadata: null,
    gameType: null,
    versionId: 1,
    versionName: "v1",
    installationDirectory:
      "C:\\Games\\PlayStash\\Game\\Versions\\(1) v1\\Installation",
    versionDirectory: "C:\\Games\\PlayStash\\Game\\Versions\\(1) v1",
    installedAt: 0,
    lastPlayedAt: 0,
    ...partial,
  };
}

describe("jump list games", () => {
  it("prefers the metadata title", () => {
    expect(
      installedGameTitle(
        game({
          cachedMetadata: { metadata: { title: "Mapped" }, title: "Raw" },
        }),
      ),
    ).toBe("Mapped");
    expect(installedGameTitle(game({ cachedMetadata: { title: "Raw" } }))).toBe(
      "Raw",
    );
    expect(installedGameTitle(game({}))).toBe("Folder Title");
  });

  it("orders like the installed row and keeps one entry per game", () => {
    const ordered = orderJumpListCandidates([
      game({ gameId: 1, gameTitle: "Old", installedAt: 10 }),
      game({
        gameId: 2,
        gameTitle: "Played",
        installedAt: 5,
        lastPlayedAt: 100,
      }),
      game({ gameId: 3, gameTitle: "New", installedAt: 50 }),
      game({ gameId: 3, gameTitle: "New", installedAt: 20 }),
    ]);
    expect(ordered.map((entry) => entry.gameId)).toEqual([2, 3, 1]);
  });

  it("resolves the launch exe as icon", () => {
    expect(launchIconPath("C:\\Games\\X\\Installation", "bin\\game.exe")).toBe(
      "C:\\Games\\X\\Installation\\bin\\game.exe",
    );
    expect(launchIconPath("/games/x/Installation/", "game.EXE")).toBe(
      "/games/x/Installation/game.EXE",
    );
    expect(launchIconPath("C:\\Games", "D:\\Emu\\emu.exe")).toBe(
      "D:\\Emu\\emu.exe",
    );
    expect(launchIconPath("C:\\Games", "start.sh")).toBeUndefined();
    expect(launchIconPath("C:\\Games", undefined)).toBeUndefined();
  });

  it("builds at most five entries without duplicate titles", async () => {
    const games = [1, 2, 3, 4, 5, 6, 7].map((id) =>
      game({
        gameId: id,
        gameTitle: id === 2 ? "Game 1" : `Game ${id}`,
        installedAt: 100 - id,
      }),
    );
    const entries = await buildJumpListGames(games, async () => "game.exe");
    expect(entries.map((entry) => entry.title)).toEqual([
      "Game 1",
      "Game 3",
      "Game 4",
      "Game 5",
      "Game 6",
    ]);
    expect(entries[0].iconPath).toBe(
      "C:\\Games\\PlayStash\\Game\\Versions\\(1) v1\\Installation\\game.exe",
    );
    const withoutIcon = await buildJumpListGames(
      [game({})],
      async () => undefined,
    );
    expect(withoutIcon[0]).toEqual({ gameId: 1, title: "Folder Title" });
  });
});
