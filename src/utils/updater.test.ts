// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  channelLabel,
  compareVersions,
  defaultChannelForBuild,
  formatReleaseNotes,
  formatUpdateError,
  githubReleaseVersion,
  isMissingUpdaterFeedError,
  isUpdateSnoozed,
  MAX_RELEASE_NOTES_LENGTH,
  normalizeVersion,
  readUpdateChannel,
  UPDATE_CHECK_INTERVAL_MS,
  writeUpdateChannel,
} from "./updater";

beforeEach(() => {
  localStorage.clear();
});

describe("normalizeVersion", () => {
  it("strips a leading v and trims", () => {
    expect(normalizeVersion("v1.2.3")).toBe("1.2.3");
    expect(normalizeVersion("  1.2.3  ")).toBe("1.2.3");
  });
});

describe("compareVersions", () => {
  it("orders numeric segments", () => {
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
    expect(compareVersions("1.2.4", "1.2.3")).toBe(1);
    expect(compareVersions("1.2.3", "1.2.4")).toBe(-1);
    expect(compareVersions("2.0.0", "1.9.9")).toBe(1);
  });

  it("treats missing segments as zero and ignores build metadata", () => {
    expect(compareVersions("1.2", "1.2.0")).toBe(0);
    expect(compareVersions("v1.2.3", "1.2.3")).toBe(0);
    expect(compareVersions("1.2.3+abc", "1.2.3")).toBe(0);
  });

  it("orders prereleases by SemVer precedence", () => {
    expect(compareVersions("1.2.3-beta", "1.2.3")).toBe(-1);
    expect(compareVersions("17.2.3", "17.2.3-unstable.15.1")).toBe(1);
    expect(compareVersions("17.2.3-unstable.15.1", "17.2.3-unstable.9.1")).toBe(
      1,
    );
    expect(
      compareVersions("17.2.3-unstable.15.2", "17.2.3-unstable.15.1"),
    ).toBe(1);
    expect(compareVersions("17.3.0-unstable.1.1", "17.2.3")).toBe(1);
    expect(compareVersions("17.3.0-unstable.1.1", "17.3.0")).toBe(-1);
  });

  it("never treats an unparseable version as newer", () => {
    expect(compareVersions("nightly", "1.0.0")).toBe(0);
    expect(compareVersions("1.0.0", "")).toBe(0);
  });
});

describe("formatReleaseNotes", () => {
  it("handles empty/null input", () => {
    expect(formatReleaseNotes()).toBe("");
    expect(formatReleaseNotes(null)).toBe("");
    expect(formatReleaseNotes("   ")).toBe("");
  });

  it("keeps Markdown, drops the changelog status and truncates", () => {
    expect(
      formatReleaseNotes("Status: Released.\r\n### Changes\r\n- Added x."),
    ).toBe("### Changes\n- Added x.");
    const result = formatReleaseNotes("x".repeat(MAX_RELEASE_NOTES_LENGTH + 5));
    expect(result).toHaveLength(MAX_RELEASE_NOTES_LENGTH);
    expect(result.endsWith("...")).toBe(true);
  });
});

describe("githubReleaseVersion", () => {
  it("reads stable tags and the unstable build version from the title", () => {
    expect(githubReleaseVersion({ tag_name: "v17.3.0" })).toBe("17.3.0");
    expect(
      githubReleaseVersion({
        tag_name: "unstable",
        name: "PlayStash 17.3.0-unstable.15.1 · Unstable",
      }),
    ).toBe("17.3.0-unstable.15.1");
    expect(githubReleaseVersion({ tag_name: "early-access" })).toBeNull();
  });
});

describe("isUpdateSnoozed", () => {
  it("silences only the same version and channel until it expires", () => {
    const snooze = { channel: "stable" as const, version: "2.0.0", until: 100 };
    expect(isUpdateSnoozed(snooze, "stable", "2.0.0", 50)).toBe(true);
    expect(isUpdateSnoozed(snooze, "stable", "v2.0.0", 50)).toBe(true);
    expect(isUpdateSnoozed(snooze, "stable", "2.0.1", 50)).toBe(false);
    expect(isUpdateSnoozed(snooze, "unstable", "2.0.0", 50)).toBe(false);
    expect(isUpdateSnoozed(snooze, "stable", "2.0.0", 100)).toBe(false);
    expect(isUpdateSnoozed(null, "stable", "2.0.0", 50)).toBe(false);
  });

  it("checks every few hours", () => {
    expect(UPDATE_CHECK_INTERVAL_MS).toBe(4 * 60 * 60 * 1000);
  });
});

describe("formatUpdateError", () => {
  it("unwraps messages or falls back", () => {
    expect(formatUpdateError(new Error("boom"))).toBe("boom");
    expect(formatUpdateError("oops")).toBe("oops");
    expect(formatUpdateError("")).toBe(
      "PlayStash could not complete the update check.",
    );
    expect(formatUpdateError(null)).toBe(
      "PlayStash could not complete the update check.",
    );
  });
});

describe("channelLabel", () => {
  it("is the identity", () => {
    expect(channelLabel("stable")).toBe("stable");
    expect(channelLabel("unstable")).toBe("unstable");
  });
});

describe("update channel persistence", () => {
  it("falls back to the build default when unset or invalid", () => {
    expect(defaultChannelForBuild()).toBe("stable");
    expect(readUpdateChannel()).toBe("stable");
    localStorage.setItem("playstash_update_channel", "bogus");
    expect(readUpdateChannel()).toBe("stable");
  });

  it("persists a valid channel", () => {
    writeUpdateChannel("unstable");
    expect(readUpdateChannel()).toBe("unstable");
  });
});

describe("isMissingUpdaterFeedError", () => {
  it("detects a missing feed or platform entry", () => {
    expect(isMissingUpdaterFeedError(new Error("HTTP 404 Not Found"))).toBe(
      true,
    );
    expect(
      isMissingUpdaterFeedError(
        "Failed to check for updates: Could not fetch a valid release JSON from the remote",
      ),
    ).toBe(true);
    expect(
      isMissingUpdaterFeedError(
        'None of the fallback platforms `["windows-x86_64"]` were found in the response `platforms` object',
      ),
    ).toBe(true);
  });

  it("does not match unrelated errors", () => {
    expect(isMissingUpdaterFeedError(new Error("network down"))).toBe(false);
    expect(isMissingUpdaterFeedError("invalid target directory")).toBe(false);
    expect(isMissingUpdaterFeedError("signature mismatch 4040")).toBe(false);
  });
});
