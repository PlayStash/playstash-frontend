import { test } from "node:test";
import assert from "node:assert/strict";
import {
  releaseNotes,
  validateVersionTag,
  canPublishStable,
  stagingTag,
  stagedReleaseVersion,
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
test("published versions are immutable and only the same draft commit is resumable", () => {
  assert.equal(canPublishStable(undefined, "new"), true);
  assert.equal(
    canPublishStable({ draft: false, target_commitish: "new" }, "new"),
    false,
  );
  assert.equal(
    canPublishStable({ draft: true, target_commitish: "old" }, "new"),
    false,
  );
  assert.equal(
    canPublishStable({ draft: true, target_commitish: "new" }, "new"),
    true,
  );
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
