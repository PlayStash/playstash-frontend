import { describe, expect, it } from "vitest";
import { moveSelectedAddon, validateLaunchProfiles } from "./launchProfiles";

describe("launch profiles", () => {
  it("rejects empty names and paths outside the installation", () => {
    for (const executable of [
      "../outside.exe",
      "bin/../../outside.exe",
      "C:\\outside.exe",
      "/outside.exe",
    ]) {
      expect(
        validateLaunchProfiles([{ name: "Play", executable }]),
      ).not.toBeNull();
    }
    expect(
      validateLaunchProfiles([{ name: "", executable: "game.exe" }]),
    ).not.toBeNull();
    expect(
      validateLaunchProfiles([
        {
          name: "Play",
          executable: "bin\\game.exe",
          parameters: "--path='My Game'",
        },
      ]),
    ).toBeNull();
    expect(validateLaunchProfiles([])).toBeNull();
  });
});
describe("addon ordering", () => {
  it("preserves all selected ids while moving one item", () => {
    expect(moveSelectedAddon(["patch", "dlc", "mod"], "mod", -1)).toEqual([
      "patch",
      "mod",
      "dlc",
    ]);
    expect(moveSelectedAddon(["patch", "dlc", "mod"], "patch", 1)).toEqual([
      "dlc",
      "patch",
      "mod",
    ]);
    expect(moveSelectedAddon(["patch", "dlc"], "patch", -1)).toEqual([
      "patch",
      "dlc",
    ]);
    expect(moveSelectedAddon(["patch", "dlc"], "missing", 1)).toEqual([
      "patch",
      "dlc",
    ]);
  });
});
