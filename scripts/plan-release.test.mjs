import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
  releaseNotes,
  validateVersionTag,
  canPublishStable,
  stableReleasePlan,
  stagingTag,
  stagedReleaseVersion,
  readVersions,
  validateVersions,
} from "./plan-release.mjs";
test("a published retry promotes and keeps the version of its immutable signed feed", () => {
  assert.equal(
    stagedReleaseVersion(
      { version: "17.2.0-unstable.1234.1" },
      "17.2.0-unstable.1234.2",
    ),
    "17.2.0-unstable.1234.1",
  );
  assert.throws(() =>
    stagedReleaseVersion(
      { version: "17.1.0-unstable.1234.1" },
      "17.2.0-unstable.1234.2",
    ),
  );
  assert.throws(() => stagedReleaseVersion({}, "17.2.0-unstable.1234.2"));
});
test("unstable staging is unique per workflow run and stable across retries", () => {
  const commit = "a".repeat(40);
  assert.equal(stagingTag(commit, "1234"), "unstable-aaaaaaaaaaaa-1234");
  assert.notEqual(stagingTag(commit, "1234"), stagingTag(commit, "1235"));
  assert.throws(() => stagingTag("bad", "1234"));
});
test("published versions are immutable; unpublished drafts move to the newest commit", () => {
  assert.equal(stableReleasePlan(undefined, "new"), "create");
  assert.equal(
    stableReleasePlan({ draft: false, target_commitish: "new" }, "new"),
    "skip",
  );
  assert.equal(
    stableReleasePlan({ draft: true, target_commitish: "old" }, "new"),
    "retarget",
  );
  assert.equal(
    stableReleasePlan({ draft: true, target_commitish: "new" }, "new"),
    "resume",
  );
  assert.equal(canPublishStable(undefined, "new"), true);
  assert.equal(
    canPublishStable({ draft: false, target_commitish: "old" }, "new"),
    false,
  );
  assert.equal(
    canPublishStable({ draft: true, target_commitish: "old" }, "new"),
    true,
  );
});
test("the release version is consistent across package.json, Cargo.toml and tauri.conf.json", async () => {
  const versions = await readVersions(
    fileURLToPath(new URL("..", import.meta.url)),
  );
  assert.doesNotThrow(() => validateVersions(versions));
  assert.doesNotThrow(() =>
    validateVersions({ pkg: "17.3.0", tauri: undefined, cargo: "17.3.0" }),
  );
  assert.throws(() =>
    validateVersions({ pkg: "17.3.0", tauri: undefined, cargo: "17.2.3" }),
  );
  assert.throws(() =>
    validateVersions({ pkg: "17.3.0", tauri: "17.2.3", cargo: "17.3.0" }),
  );
  assert.throws(() =>
    validateVersions({
      pkg: "17.3.0-beta",
      tauri: undefined,
      cargo: "17.3.0-beta",
    }),
  );
});
test("the current changelog section is released with a date", async () => {
  const { readFile } = await import("node:fs/promises");
  const root = new URL("..", import.meta.url);
  const version = JSON.parse(
    await readFile(new URL("package.json", root), "utf8"),
  ).version;
  const changelog = await readFile(new URL("CHANGELOG.md", root), "utf8");
  assert.match(releaseNotes(changelog, version), /### Changes/);
  const section = changelog
    .split(/^## /m)
    .find((part) => part.split(/\r?\n/)[0].trim() === version);
  const status = /^Status: (.*)$/m.exec(section ?? "")?.[1];
  assert.match(status ?? "", /^(Unreleased\.|Released on \d{4}-\d{2}-\d{2}\.)/);
});
test("release notes contain only the current PlayStash version", () => {
  assert.equal(
    releaseNotes(
      "# Releases\n\n## 17.2.0\n\nStatus: Unreleased.\n\n### Changes\n- Added extras.\n\n## 17.1.0\n- Old entry.\n",
      "17.2.0",
    ),
    "### Changes\n- Added extras.\n",
  );
  assert.throws(() => releaseNotes("## 17.1.0\nOld", "17.2.0"));
});
test("a pushed version tag must match package.json", () => {
  assert.doesNotThrow(() => validateVersionTag("refs/heads/main", "17.2.0"));
  assert.doesNotThrow(() => validateVersionTag("refs/tags/v17.2.0", "17.2.0"));
  assert.throws(() => validateVersionTag("refs/tags/v17.1.0", "17.2.0"));
});
