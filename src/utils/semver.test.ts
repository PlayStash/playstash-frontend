import { describe, expect, it } from "vitest";
import { compareVersionStrings, parseVersion } from "./semver";

describe("semver", () => {
  it("parses releases, prereleases and build metadata", () => {
    expect(parseVersion("17.2.3-unstable.15.1")).toEqual({
      parts: [17, 2, 3],
      prerelease: ["unstable", "15", "1"],
    });
    expect(parseVersion("v15")).toEqual({ parts: [15, 0, 0], prerelease: [] });
    expect(parseVersion("1.0.0+build.7")?.prerelease).toEqual([]);
    expect(parseVersion("not a version")).toBeNull();
  });

  it("orders versions by SemVer precedence", () => {
    const ordered = [
      "1.0.0-alpha",
      "1.0.0-alpha.1",
      "1.0.0-alpha.beta",
      "1.0.0-beta",
      "1.0.0-beta.2",
      "1.0.0-beta.11",
      "1.0.0-rc.1",
      "1.0.0",
      "17.2.3-unstable.9.1",
      "17.2.3-unstable.15.1",
      "17.2.3",
      "17.3.0-unstable.1.1",
      "17.3.0",
      "17.10.0",
    ];
    for (let index = 1; index < ordered.length; index++) {
      expect(compareVersionStrings(ordered[index - 1], ordered[index])).toBe(
        -1,
      );
      expect(compareVersionStrings(ordered[index], ordered[index - 1])).toBe(1);
    }
    expect(compareVersionStrings("17.3.0", "17.3.0+abc")).toBe(0);
  });
});
