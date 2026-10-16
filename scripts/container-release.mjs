import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFile,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Registry, digestPattern, image } from "./container-registry.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = "https://github.com/PlayStash/playstash-frontend";
const runtimeFiles = [
  "Dockerfile.runtime",
  "nginx.runtime.conf",
  "start-runtime.sh",
];
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const docker = (...args) =>
  execFileSync("docker", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 300_000,
  }).trim();

export function planContainer({
  ref,
  version,
  commit,
  repository = "PlayStash/playstash-frontend",
}) {
  assert.equal(repository.toLowerCase(), "playstash/playstash-frontend");
  assert.match(version, /^\d+\.\d+\.\d+$/);
  assert.match(commit, /^[a-f0-9]{40}$/);
  assert.ok(
    ["refs/heads/main", "refs/heads/dev", `refs/tags/v${version}`].includes(
      ref,
    ),
    "Containers publish only main, dev, or a tag matching package.json.",
  );
  const channel = ref === "refs/heads/dev" ? "dev" : "stable";
  return {
    image,
    version,
    commit,
    channel,
    mutable: channel === "dev" ? "dev" : "latest",
    shaTag: `${channel === "dev" ? "dev-" : ""}sha-${commit}`,
    versionTag: channel === "stable" ? `v${version}` : null,
  };
}

async function inventory(directory, relative = "") {
  const entries = [];
  for (const name of (await readdir(path.join(directory, relative))).sort()) {
    const file = path.posix.join(relative, name);
    const filename = path.join(directory, file);
    const info = await lstat(filename);
    assert.ok(
      !info.isSymbolicLink(),
      "Runtime assets must not be symbolic links.",
    );
    if (info.isDirectory()) entries.push(...(await inventory(directory, file)));
    else {
      assert.ok(info.isFile(), "Runtime assets must be regular files.");
      const data = await readFile(filename);
      entries.push({ path: file, size: data.length, sha256: sha256(data) });
    }
  }
  return entries;
}

export async function prepareContext(output, plan, directory = root) {
  await mkdir(output, { recursive: false });
  for (const file of [...runtimeFiles, "LICENSE"])
    await cp(path.join(directory, file), path.join(output, file));
  await cp(path.join(directory, "dist"), path.join(output, "dist"), {
    recursive: true,
    dereference: false,
  });
  const assets = await inventory(path.join(output, "dist"));
  assert.ok(assets.some((item) => item.path === "index.html"));
  assert.ok(
    assets.some(
      (item) => item.path.startsWith("assets/") && item.path.endsWith(".js"),
    ),
  );
  const notices =
    "PlayStash frontend\nOriginal authors: Alkan Alper, Schäfer Philip GbR / Phalcode.\n" +
    "License: CC-BY-NC-SA-4.0; see LICENSE.\n" +
    "Third-party license texts are bundled in the application (Settings > About > Open Source Licenses) and THIRD-PARTY-LICENSES.json.\n";
  await writeFile(path.join(output, "NOTICE.txt"), notices);
  // Preserve the full dependency notices independently of minification/tree shaking.
  const thirdParty = await readFile(
    path.join(directory, "src/generated/third-party-licenses.json"),
  );
  assert.ok(
    JSON.parse(thirdParty).packages?.length > 0,
    "Missing third-party license inventory.",
  );
  await writeFile(
    path.join(output, "dist/THIRD-PARTY-LICENSES.json"),
    thirdParty,
  );
  const provenance = {
    schemaVersion: 1,
    version: plan.version,
    channel: plan.channel,
    repository: source,
    commit: plan.commit,
    source: `${source}/tree/${plan.commit}`,
    license: {
      identifier: "CC-BY-NC-SA-4.0",
      sha256: sha256(await readFile(path.join(output, "LICENSE"))),
    },
    notice: { sha256: sha256(notices) },
    assets: await inventory(path.join(output, "dist")),
    runtimeFiles: await Promise.all(
      runtimeFiles.map(async (file) => ({
        path: file,
        sha256: sha256(await readFile(path.join(output, file))),
      })),
    ),
  };
  await writeFile(
    path.join(output, "provenance.json"),
    `${JSON.stringify(provenance, null, 2)}\n`,
  );
  return provenance;
}

export async function verifyPublishedAssets(
  directory,
  { commit, version } = {},
) {
  const provenance = JSON.parse(
    await readFile(path.join(directory, "provenance.json"), "utf8"),
  );
  assert.equal(provenance.schemaVersion, 1);
  assert.equal(provenance.repository, source);
  assert.match(provenance.commit, /^[a-f0-9]{40}$/);
  assert.match(provenance.version, /^\d+\.\d+\.\d+$/);
  assert.equal(provenance.source, `${source}/tree/${provenance.commit}`);
  if (commit) assert.equal(provenance.commit, commit);
  if (version) assert.equal(provenance.version, version);
  assert.equal(provenance.license.identifier, "CC-BY-NC-SA-4.0");
  assert.equal(
    provenance.license.sha256,
    sha256(await readFile(path.join(directory, "LICENSE"))),
  );
  assert.equal(
    provenance.notice.sha256,
    sha256(await readFile(path.join(directory, "NOTICE.txt"))),
  );
  assert.deepEqual(
    await inventory(path.join(directory, "dist")),
    provenance.assets,
  );
  return provenance;
}

export async function currentBranchHead(channel, token, fetchImpl = fetch) {
  assert.ok(channel === "dev" || channel === "stable");
  const branch = channel === "dev" ? "dev" : "main";
  const response = await fetchImpl(
    `${source.replace("github.com", "api.github.com/repos")}/git/ref/heads/${branch}`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    },
  );
  assert.ok(
    response.ok,
    `Cannot verify current ${branch} head (${response.status}).`,
  );
  const body = await response.json();
  assert.equal(body.object?.type, "commit");
  assert.match(body.object.sha, /^[a-f0-9]{40}$/);
  return body.object.sha;
}

export async function promotionTargets(registry, plan, headCommit) {
  assert.match(headCommit, /^[a-f0-9]{40}$/);
  const tags = [plan.shaTag];
  if (headCommit === plan.commit) tags.push(plan.mutable);
  if (plan.versionTag) {
    const existing = await registry.manifest(plan.versionTag, true);
    if (!existing) tags.unshift(plan.versionTag);
    else await registry.verifyIndex(plan.versionTag, { version: plan.version });
  }
  return tags;
}

export async function anonymousPull(reference) {
  assert.match(
    reference,
    /^ghcr\.io\/playstash\/playstash-frontend@sha256:[a-f0-9]{64}$/,
  );
  // An empty Docker config and an anonymous token request exclude the job's registry credentials.
  const registry = new Registry();
  const temporary = await mkdtemp(
    path.join(tmpdir(), "playstash-public-frontend-"),
  );
  const environment = { ...process.env, DOCKER_CONFIG: temporary };
  delete environment.DOCKER_AUTH_CONFIG;
  delete environment.REGISTRY_AUTH_FILE;
  try {
    await registry.verifyIndex(reference.split("@")[1]);
    for (const platform of ["linux/amd64", "linux/arm64"]) {
      execFileSync("docker", ["pull", "--platform", platform, reference], {
        env: environment,
        stdio: "inherit",
        timeout: 300_000,
      });
    }
  } catch (cause) {
    throw new Error(
      "Anonymous frontend pull failed; latest/dev/version tags remain unchanged. New GHCR packages start private: set the playstash-frontend package visibility to Public once, then rerun this workflow. Network and registry errors also stop publication.",
      { cause },
    );
  } finally {
    assert.equal(path.dirname(temporary), path.resolve(tmpdir()));
    await rm(temporary, { recursive: true, force: true });
  }
}

async function main() {
  const [command, argument] = process.argv.slice(2);
  const version = JSON.parse(
    await readFile(path.join(root, "package.json"), "utf8"),
  ).version;
  const plan = planContainer({
    version,
    commit: process.env.GITHUB_SHA,
    ref: process.env.GITHUB_REF,
    repository: process.env.GITHUB_REPOSITORY,
  });
  assert.equal(
    execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim(),
    plan.commit,
    "The checked-out source must match GITHUB_SHA.",
  );
  const registry = new Registry({
    username: process.env.GITHUB_ACTOR,
    password: process.env.GH_TOKEN,
  });
  if (command === "plan") {
    if (process.env.GITHUB_OUTPUT)
      await appendFile(
        process.env.GITHUB_OUTPUT,
        Object.entries(plan)
          .filter(([, value]) => value !== null)
          .map(([key, value]) => `${key}=${value}`)
          .join("\n") + "\n",
      );
    console.log(JSON.stringify(plan));
  } else if (command === "context") {
    assert.ok(argument, "Provide a new context directory.");
    await prepareContext(argument, plan);
  } else if (command === "publish") {
    assert.match(process.env.GITHUB_RUN_ID, /^\d+$/);
    assert.match(process.env.GITHUB_RUN_ATTEMPT, /^\d+$/);
    const candidates = (await readdir(argument)).sort();
    assert.equal(
      candidates.length,
      2,
      "Both architecture digests are required.",
    );
    const digests = [];
    for (const candidate of candidates) {
      const digest = (
        await readFile(path.join(argument, candidate), "utf8")
      ).trim();
      assert.match(digest, digestPattern);
      digests.push(`${image}@${digest}`);
    }
    assert.equal(new Set(digests).size, 2);
    const candidate = `${image}:build-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`;
    docker("buildx", "imagetools", "create", "--tag", candidate, ...digests);
    const index = await registry.verifyIndex(candidate.split(":").at(-1), plan);
    const reference = `${image}@${index.digest}`;
    console.log(`Both tested architectures assembled at ${reference}.`);
    await anonymousPull(reference);
    // Missing is only a validated MANIFEST_UNKNOWN; authentication/network/invalid metadata fail closed.
    const head = await currentBranchHead(plan.channel, process.env.GH_TOKEN);
    const tags = await promotionTargets(registry, plan, head);
    if (head !== plan.commit)
      console.log(
        "The branch advanced; this older build will not move latest/dev.",
      );
    for (const tag of tags)
      docker(
        "buildx",
        "imagetools",
        "create",
        "--tag",
        `${image}:${tag}`,
        reference,
      );
    console.log(
      `Published ${tags.join(", ")} at ${reference}; existing version tags are never replaced.`,
    );
    if (process.env.GITHUB_STEP_SUMMARY)
      await appendFile(
        process.env.GITHUB_STEP_SUMMARY,
        `Frontend ${plan.version} (${plan.channel})\n\n- Source: ${plan.commit}\n- Image: ${reference}\n- Tags: ${tags.join(", ")}\n`,
      );
  } else
    throw new Error(
      "Use plan, context <directory>, or publish <digest directory>.",
    );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main();
