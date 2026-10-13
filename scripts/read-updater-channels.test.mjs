import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeExistingChannels } from "./read-updater-channels.mjs";
test("keeps the newest stable and unstable feed from both private release sources", () => {
  const manifest = (version, date) => ({
    version,
    pub_date: date,
    platforms: {
      "linux-x86_64": { url: "signed-installer", signature: "signature" },
    },
  });
  const stable = manifest("17.2.0", "2026-10-13T10:00:00Z"),
    oldDev = manifest("17.1.0-dev", "2026-10-12T10:00:00Z"),
    newDev = manifest("17.3.0-dev", "2026-10-14T10:00:00Z");
  assert.deepEqual(
    mergeExistingChannels([
      { stable, unstable: oldDev },
      { stable, unstable: newDev },
    ]),
    { stable, unstable: newDev },
  );
});
test("rejects an existing malformed feed instead of silently losing a channel", () => {
  assert.throws(
    () => mergeExistingChannels([{ stable: { version: "17.2.0" } }]),
    /Invalid existing/,
  );
  assert.deepEqual(mergeExistingChannels([]), {});
});
test("authoritative channel sources win when aggregates have no publication date", () => {
  const feed = (version) => ({ version, platforms: {} });
  assert.deepEqual(
    mergeExistingChannels([
      { stable: feed("17.2.0"), unstable: feed("17.1.0-dev") },
      { stable: feed("17.1.0"), unstable: feed("17.3.0-dev") },
    ]),
    { stable: feed("17.2.0"), unstable: feed("17.3.0-dev") },
  );
  assert.deepEqual(
    mergeExistingChannels([
      {},
      { stable: feed("17.2.0"), unstable: feed("17.3.0-dev") },
    ]),
    { stable: feed("17.2.0"), unstable: feed("17.3.0-dev") },
  );
});
