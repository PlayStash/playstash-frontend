import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mergeExistingChannels,
  readRelease,
} from "./read-updater-channels.mjs";
import { canPublishStable, stableReleasePlan } from "./plan-release.mjs";
const repository = "PlayStash/playstash-frontend";
const release = (draft = true) => ({
  id: 42,
  tag_name: "v17.2.0",
  draft,
  target_commitish: "same-build-commit",
  assets: [{ id: 7, name: "updater-channels.json" }],
});
const lookup = (found) =>
  JSON.stringify({
    data: { repository: { id: "repository-node", release: found } },
  });
const notFound = () =>
  Object.assign(new Error("Not Found"), { stderr: "gh: Not Found (HTTP 404)" });

test("pending draft tags resume through GraphQL and REST by ID when REST tags returns 404", () => {
  const calls = [];
  const existing = readRelease(repository, "tags/v17.2.0", (endpoint, args) => {
    calls.push(endpoint);
    if (endpoint.endsWith("/releases/tags/v17.2.0")) throw notFound();
    if (endpoint === "graphql") {
      assert.match(args[1], /databaseId isDraft/);
      assert.equal(args.includes("owner=PlayStash"), true);
      assert.equal(args.includes("name=playstash-frontend"), true);
      assert.equal(args.includes("tag=v17.2.0"), true);
      return lookup({ databaseId: 42, isDraft: true });
    }
    assert.equal(endpoint, `repos/${repository}/releases/42`);
    return JSON.stringify(release());
  });
  assert.deepEqual(calls, ["graphql", `repos/${repository}/releases/42`]);
  assert.deepEqual(existing, release());
  assert.equal(canPublishStable(existing, "same-build-commit"), true);
  // An unpublished draft of an earlier commit moves to the newest build.
  assert.equal(stableReleasePlan(existing, "same-build-commit"), "resume");
  assert.equal(stableReleasePlan(existing, "another-build-commit"), "retarget");
});

test("published tags use the same full metadata lookup and remain immutable", () => {
  const existing = readRelease(repository, "tags/v17.2.0", (endpoint) =>
    endpoint === "graphql"
      ? lookup({ databaseId: 42, isDraft: false })
      : JSON.stringify(release(false)),
  );
  assert.equal(canPublishStable(existing, "same-build-commit"), false);
});

test("an accessible GraphQL repository with an explicitly absent release returns null", () => {
  let count = 0;
  assert.equal(
    readRelease(repository, "tags/v17.2.0", (endpoint) => {
      count++;
      assert.equal(endpoint, "graphql");
      return lookup(null);
    }),
    null,
  );
  assert.equal(count, 1);
});

test("tag lookup fails closed for inaccessible repositories, API failures and invalid metadata", () => {
  const cases = [
    () =>
      JSON.stringify({
        errors: {},
        data: { repository: { id: "repository-node", release: null } },
      }),
    () => JSON.stringify({ data: { repository: null } }),
    () => JSON.stringify({ data: { repository: { id: "repository-node" } } }),
    () =>
      JSON.stringify({
        errors: [{ message: "Forbidden" }],
        data: { repository: { id: "repository-node", release: null } },
      }),
    () => lookup({ databaseId: 0, isDraft: true }),
    () => lookup({ databaseId: 42 }),
    () => "invalid JSON",
    () => {
      throw notFound();
    },
    () => {
      throw new Error("Network unavailable");
    },
    (endpoint) =>
      endpoint === "graphql" ? lookup({ databaseId: 42, isDraft: true }) : "{}",
    (endpoint) =>
      endpoint === "graphql"
        ? lookup({ databaseId: 42, isDraft: true })
        : JSON.stringify({ ...release(), tag_name: "wrong-tag" }),
    (endpoint) => {
      if (endpoint === "graphql")
        return lookup({ databaseId: 42, isDraft: true });
      throw notFound();
    },
  ];
  for (const request of cases)
    assert.throws(
      () => readRelease(repository, "tags/v17.2.0", request),
      /refusing to replace/,
    );
});

test("latest feeds retain REST lookup and only an accessible repository permits missing latest", () => {
  const calls = [];
  assert.deepEqual(
    readRelease(repository, "latest", (endpoint) => {
      calls.push(endpoint);
      return JSON.stringify(release(false));
    }),
    release(false),
  );
  assert.deepEqual(calls, [`repos/${repository}/releases/latest`]);
  assert.equal(
    readRelease(repository, "latest", (endpoint) => {
      if (endpoint.endsWith("/releases/latest")) throw notFound();
      assert.equal(endpoint, `repos/${repository}`);
      return JSON.stringify({ id: 1, full_name: repository });
    }),
    null,
  );
});

test("missing latest never hides private-repository authentication or malformed responses", () => {
  for (const repoResponse of [
    null,
    {},
    { id: 1, full_name: "another/repository" },
  ])
    assert.throws(
      () =>
        readRelease(repository, "latest", (endpoint) => {
          if (endpoint.endsWith("/releases/latest")) throw notFound();
          return JSON.stringify(repoResponse);
        }),
      /refusing to replace/,
    );
  assert.throws(
    () =>
      readRelease(repository, "latest", () => {
        throw notFound();
      }),
    /refusing to replace/,
  );
  assert.throws(
    () => readRelease(repository, "latest", () => "{}"),
    /refusing to replace/,
  );
});
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
