import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Registry } from "./container-registry.mjs";
import { extractContainerDirectory } from "./copy-container-directory.mjs";
import {
  currentBranchHead,
  planContainer,
  prepareContext,
  promotionTargets,
  verifyPublishedAssets,
} from "./container-release.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const commit = "a".repeat(40);
const version = "17.3.2";
const stable = () => planContainer({ ref: "refs/heads/main", version, commit });
const digest = (body) =>
  `sha256:${createHash("sha256")
    .update(typeof body === "string" ? body : JSON.stringify(body))
    .digest("hex")}`;

test("read-only container directories extract and clean up for an ordinary user", async () => {
  const temporary = await mkdtemp(
    path.join(tmpdir(), "playstash-readonly-proof-"),
  );
  const source = path.join(temporary, "source");
  const nested = path.join(source, "assets");
  try {
    await mkdir(nested, { recursive: true });
    await writeFile(
      path.join(source, "THIRD-PARTY-LICENSES.json"),
      '{"fixture":true}',
    );
    await writeFile(
      path.join(nested, "application.js"),
      'console.log("fixture");',
    );
    await chmod(path.join(source, "THIRD-PARTY-LICENSES.json"), 0o444);
    await chmod(path.join(nested, "application.js"), 0o444);
    await chmod(nested, 0o555);
    await chmod(source, 0o555);
    const archive = execFileSync("tar", ["-cf", "-", "-C", source, "."]);
    const destination = path.join(temporary, "proof");
    await extractContainerDirectory(archive, destination);
    assert.equal(
      await readFile(
        path.join(destination, "THIRD-PARTY-LICENSES.json"),
        "utf8",
      ),
      '{"fixture":true}',
    );
    assert.equal(
      await readFile(path.join(destination, "assets/application.js"), "utf8"),
      'console.log("fixture");',
    );
    await rm(destination, { recursive: true });
  } finally {
    await chmod(source, 0o700);
    await chmod(nested, 0o700);
    assert.equal(path.dirname(temporary), path.resolve(tmpdir()));
    await rm(temporary, { recursive: true, force: true });
  }
});

async function registryFixture(run, overrides = {}) {
  const blobs = new Map();
  const manifests = new Map();
  const entries = [];
  for (const architecture of ["amd64", "arm64"]) {
    const config = {
      os: "linux",
      architecture,
      config: {
        Labels: {
          "org.opencontainers.image.version": version,
          "org.opencontainers.image.revision": commit,
          "org.opencontainers.image.source":
            "https://github.com/PlayStash/playstash-frontend",
          "org.opencontainers.image.licenses": "CC-BY-NC-SA-4.0",
        },
      },
    };
    const configDigest = digest(config);
    blobs.set(configDigest, config);
    const manifest = {
      schemaVersion: 2,
      config: { digest: configDigest },
      layers: [],
    };
    const manifestDigest = digest(manifest);
    manifests.set(manifestDigest, manifest);
    entries.push({
      platform: { os: "linux", architecture },
      digest: manifestDigest,
    });
  }
  manifests.set("candidate", { schemaVersion: 2, manifests: entries });
  const requests = [];
  const server = createServer(async (request, response) => {
    requests.push({
      url: request.url,
      authorization: request.headers.authorization,
    });
    if (overrides.handle?.(request, response, { blobs, manifests })) return;
    const url = new URL(request.url, "http://fixture.invalid");
    if (url.pathname === "/token") {
      response.writeHead(overrides.tokenStatus ?? 200, {
        "Content-Type": "application/json",
      });
      response.end(
        JSON.stringify(
          overrides.tokenBody ?? { token: "fixture-access-token" },
        ),
      );
      return;
    }
    const match = url.pathname.match(
      /^\/v2\/playstash\/playstash-frontend\/(manifests|blobs)\/(.+)$/,
    );
    if (!match) {
      response.writeHead(500);
      response.end("Unexpected route");
      return;
    }
    assert.equal(request.headers.authorization, "Bearer fixture-access-token");
    const body = (match[1] === "manifests" ? manifests : blobs).get(match[2]);
    if (!body) {
      response.writeHead(404, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ errors: [{ code: "MANIFEST_UNKNOWN" }] }));
      return;
    }
    response.writeHead(200, {
      "Content-Type": "application/json",
      "Docker-Content-Digest": digest(body),
    });
    response.end(JSON.stringify(body));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const fetchImpl = (url, options) => {
    const original = new URL(url);
    return fetch(
      `http://127.0.0.1:${server.address().port}${original.pathname}${original.search}`,
      options,
    );
  };
  try {
    await run({
      registry: new Registry({ fetchImpl }),
      fetchImpl,
      blobs,
      manifests,
      requests,
    });
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

test("main/dev SHA tags cannot collide when branches share one commit", () => {
  assert.equal(stable().mutable, "latest");
  const dev = planContainer({ ref: "refs/heads/dev", version, commit });
  assert.equal(dev.mutable, "dev");
  assert.equal(dev.versionTag, null);
  assert.notEqual(dev.shaTag, stable().shaTag);
  assert.equal(
    planContainer({ ref: `refs/tags/v${version}`, version, commit }).versionTag,
    `v${version}`,
  );
});

test("unsupported branches, mismatched version tags and invalid source IDs fail closed", () => {
  for (const ref of [
    "refs/heads/feature",
    "refs/tags/v17.3.1",
    "refs/tags/unstable",
  ]) {
    assert.throws(() => planContainer({ ref, version, commit }));
  }
  assert.throws(() =>
    planContainer({ ref: "refs/heads/main", version, commit: "unknown" }),
  );
  assert.throws(() =>
    planContainer({
      ref: "refs/heads/main",
      version,
      commit,
      repository: "other/repository",
    }),
  );
});

test("real registry responses verify both platform configs and source/version/license labels", () =>
  registryFixture(async ({ registry }) => {
    const result = await registry.verifyIndex("candidate", { version, commit });
    assert.match(result.digest, /^sha256:[a-f0-9]{64}$/);
  }));

test("only typed MANIFEST_UNKNOWN is treated as an absent immutable version", () =>
  registryFixture(async ({ registry }) => {
    assert.deepEqual(await promotionTargets(registry, stable(), commit), [
      `v${version}`,
      stable().shaTag,
      "latest",
    ]);
  }));

test("published immutable versions are left untouched while current mutable channels update", () =>
  registryFixture(async ({ registry, manifests }) => {
    manifests.set(`v${version}`, manifests.get("candidate"));
    assert.deepEqual(await promotionTargets(registry, stable(), commit), [
      stable().shaTag,
      "latest",
    ]);
  }));

test("an older tag, dispatch or queued branch run cannot downgrade latest/dev", () =>
  registryFixture(async ({ registry }) => {
    assert.deepEqual(
      await promotionTargets(registry, stable(), "b".repeat(40)),
      [`v${version}`, stable().shaTag],
    );
    const dev = planContainer({ ref: "refs/heads/dev", version, commit });
    assert.deepEqual(await promotionTargets(registry, dev, "b".repeat(40)), [
      dev.shaTag,
    ]);
  }));

for (const [status, body] of [
  [401, { errors: [{ code: "UNAUTHORIZED" }] }],
  [500, {}],
  [404, { errors: [{ code: "NAME_UNKNOWN" }] }],
  [404, {}],
  [200, { errors: [] }],
  [200, { schemaVersion: 2 }],
]) {
  test(`registry ${status}/${JSON.stringify(body)} cannot authorize tag creation`, () =>
    registryFixture(
      async ({ registry }) => {
        await assert.rejects(() =>
          promotionTargets(registry, stable(), commit),
        );
      },
      {
        handle(request, response) {
          if (!request.url.includes(`/manifests/v${version}`)) return false;
          response.writeHead(status, { "Content-Type": "application/json" });
          response.end(JSON.stringify(body));
          return true;
        },
      },
    ));
}

test("malformed registry JSON fails without treating it as a missing tag", () =>
  registryFixture(
    async ({ registry }) => {
      await assert.rejects(() => promotionTargets(registry, stable(), commit));
    },
    {
      handle(request, response) {
        if (!request.url.includes(`/manifests/v${version}`)) return false;
        response.writeHead(404);
        response.end("not JSON");
        return true;
      },
    },
  ));

test("registry token auth failures and missing tokens fail closed", async () => {
  for (const options of [{ tokenStatus: 401 }, { tokenBody: {} }]) {
    await registryFixture(
      async ({ registry }) =>
        assert.rejects(() => registry.manifest("candidate")),
      options,
    );
  }
  await assert.rejects(() =>
    new Registry({
      fetchImpl: async () => {
        throw new Error("network unavailable");
      },
    }).manifest("candidate", true),
  );
});

test("missing/duplicate ARM64 or incorrect revision cannot pass multiarch verification", async () => {
  for (const mutate of [
    (index) => {
      index.manifests.pop();
    },
    (index) => {
      index.manifests[1] = index.manifests[0];
    },
  ])
    await registryFixture(async ({ registry, manifests }) => {
      mutate(manifests.get("candidate"));
      await assert.rejects(() =>
        registry.verifyIndex("candidate", { version, commit }),
      );
    });
  await registryFixture(async ({ registry }) =>
    assert.rejects(() =>
      registry.verifyIndex("candidate", { version, commit: "b".repeat(40) }),
    ),
  );
});

test("wrong registry digest headers and content hashes are rejected", () =>
  registryFixture(
    async ({ registry }) => {
      await assert.rejects(
        () => registry.manifest("candidate"),
        /digest header mismatch/,
      );
    },
    {
      handle(request, response) {
        if (!request.url.endsWith("/manifests/candidate")) return false;
        response.writeHead(200, {
          "Docker-Content-Digest": `sha256:${"0".repeat(64)}`,
        });
        response.end(JSON.stringify({ schemaVersion: 2, manifests: [] }));
        return true;
      },
    },
  ));

test("a public registry lookup has no username/password and redirects never receive its bearer token", () =>
  registryFixture(
    async ({ registry, requests }) => {
      await registry.read("blobs", `sha256:${"0".repeat(64)}`).catch(() => {});
      assert.equal(requests[0].authorization, undefined);
      const redirected = requests.find(
        (request) => request.url === "/redirected-blob",
      );
      assert.equal(redirected.authorization, undefined);
    },
    {
      handle(request, response) {
        if (request.url.includes("/blobs/")) {
          response.writeHead(307, {
            Location: "https://storage.example/redirected-blob",
          });
          response.end();
          return true;
        }
        if (request.url === "/redirected-blob") {
          response.end("{}");
          return true;
        }
        return false;
      },
    },
  ));

test("GitHub branch-head lookup checks the real response and rejects unavailable/invalid state", () =>
  registryFixture(
    async ({ fetchImpl }) => {
      assert.equal(
        await currentBranchHead("stable", "test-token", fetchImpl),
        commit,
      );
      await assert.rejects(() =>
        currentBranchHead("dev", "test-token", fetchImpl),
      );
    },
    {
      handle(request, response) {
        if (!request.url.includes("/git/ref/heads/")) return false;
        assert.equal(request.headers.authorization, "Bearer test-token");
        response.writeHead(request.url.endsWith("/main") ? 200 : 503);
        response.end(
          JSON.stringify({ object: { type: "commit", sha: commit } }),
        );
        return true;
      },
    },
  ));

test("prepared runtime preserves licenses and detects changed/extra web assets", async () => {
  const temporary = await mkdtemp(
    path.join(tmpdir(), "playstash-container-context-test-"),
  );
  try {
    const fixture = path.join(temporary, "source");
    await mkdir(path.join(fixture, "dist/assets"), { recursive: true });
    await mkdir(path.join(fixture, "src/generated"), { recursive: true });
    for (const filename of [
      "Dockerfile.runtime",
      "nginx.runtime.conf",
      "start-runtime.sh",
      "LICENSE",
    ])
      await cp(path.join(root, filename), path.join(fixture, filename));
    await writeFile(
      path.join(fixture, "dist/index.html"),
      '<script src="/assets/app.js"></script>',
    );
    await writeFile(
      path.join(fixture, "dist/assets/app.js"),
      'console.log("fixture");',
    );
    await writeFile(
      path.join(fixture, "src/generated/third-party-licenses.json"),
      JSON.stringify({
        packages: [{ name: "fixture", licenseText: "MIT fixture text" }],
      }),
    );
    const output = path.join(temporary, "context");
    await prepareContext(output, stable(), fixture);
    const record = await verifyPublishedAssets(output, { commit, version });
    assert.equal(record.assets.length, 3);
    assert.match(
      await readFile(path.join(output, "NOTICE.txt"), "utf8"),
      /Phalcode/,
    );
    await writeFile(path.join(output, "dist/unexpected.js"), "tampered");
    await assert.rejects(() => verifyPublishedAssets(output));
    await rm(path.join(output, "dist/unexpected.js"));
    await writeFile(path.join(output, "dist/assets/app.js"), "tampered");
    await assert.rejects(() => verifyPublishedAssets(output));
    await assert.rejects(() =>
      verifyPublishedAssets(output, { commit: "b".repeat(40) }),
    );
  } finally {
    assert.equal(path.dirname(temporary), path.resolve(tmpdir()));
    await rm(temporary, { recursive: true, force: true });
  }
});
