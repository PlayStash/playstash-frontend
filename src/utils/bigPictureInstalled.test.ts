import { describe, expect, it } from "vitest";
import { parseIgnoreFile } from "@/components/settings/GamesLaunchSettings";
import {
  bigPictureGames,
  displayTitle,
  moveGridIndex,
} from "./bigPictureInstalled";
import { mergeGameConfig } from "./gameConfig";
import { pickNewestInstalledVersion } from "./installedGameLookup";

const entry = (gameId: number, versionId: number, extra: object = {}) =>
  ({
    gameId,
    versionId,
    gameTitle: `Game ${gameId}`,
    gameMetadata: null,
    cachedMetadata: null,
    gameType: null,
    versionName: "",
    installationDirectory: "",
    versionDirectory: `/v/${gameId}/${versionId}`,
    installedAt: 0,
    lastPlayedAt: 0,
    ...extra,
  }) as any;

describe("big picture installed list", () => {
  it("keeps the newest version per game, most recently played first", () => {
    const games = bigPictureGames([
      entry(1, 1, { lastPlayedAt: 5 }),
      entry(1, 2, { lastPlayedAt: 5 }),
      entry(2, 1, { installedAt: 50 }),
      entry(3, 1, { lastLaunchedAt: 30 }),
    ]);
    expect(games.map((game) => [game.gameId, game.versionId])).toEqual([
      [2, 1],
      [3, 1],
      [1, 2],
    ]);
  });

  it("prefers the metadata title", () => {
    expect(
      displayTitle(
        entry(1, 1, {
          cachedMetadata: { title: "Raw", metadata: { title: "Mapped" } },
        }),
      ),
    ).toBe("Mapped");
    expect(
      displayTitle(
        entry(1, 1, {
          cachedMetadata: { title: "Raw", metadata: { title: "Mapped" } },
        }),
        false,
      ),
    ).toBe("Raw");
    expect(displayTitle(entry(1, 1))).toBe("Game 1");
  });

  it("moves through the grid and clamps at the edges", () => {
    expect(moveGridIndex(0, "ArrowRight", 4, 10)).toBe(1);
    expect(moveGridIndex(0, "ArrowLeft", 4, 10)).toBe(0);
    expect(moveGridIndex(1, "ArrowDown", 4, 10)).toBe(5);
    expect(moveGridIndex(8, "ArrowDown", 4, 10)).toBe(9);
    expect(moveGridIndex(5, "ArrowUp", 4, 10)).toBe(1);
    expect(moveGridIndex(0, "ArrowDown", 4, 0)).toBe(0);
  });
});

describe("small WP4 helpers", () => {
  it("parses the server ignore file and drops empty entries", () => {
    expect(parseIgnoreFile(["setup", " ", "", 3, " unins "])).toEqual([
      "setup",
      "unins",
    ]);
    expect(parseIgnoreFile({})).toEqual([]);
  });

  it("merges config patches and removes cleared keys", () => {
    expect(
      mergeGameConfig(
        { launchexecutable: "a.exe", umustore: "gog", gameid: 1 },
        { launchexecutable: "b.exe", umustore: undefined, emulatorrom: "" },
      ),
    ).toEqual({ launchexecutable: "b.exe", gameid: 1 });
  });

  it("picks the newest installed version", () => {
    expect(
      pickNewestInstalledVersion([entry(1, 1), entry(1, 3), entry(2, 9)], 1)
        ?.versionId,
    ).toBe(3);
    expect(pickNewestInstalledVersion([entry(2, 9)], 1)).toBeNull();
  });
});
