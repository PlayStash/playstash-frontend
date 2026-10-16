import assert from "node:assert/strict";
import { createHash } from "node:crypto";

export const repository = "playstash/playstash-frontend";
export const image = `ghcr.io/${repository}`;
export const digestPattern = /^sha256:[a-f0-9]{64}$/;
const mediaTypes = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.v2+json",
].join(", ");

async function boundedBody(response) {
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body ?? []) {
    size += chunk.length;
    if (size > 4 * 1024 * 1024)
      throw new Error("Registry metadata exceeds 4 MiB.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// Injecting fetch permits real local HTTP fixtures without an offline production fallback.
export class Registry {
  constructor({ fetchImpl = fetch, username, password } = {}) {
    this.fetch = fetchImpl;
    this.username = username;
    this.password = password;
  }

  async accessToken() {
    if (this.token) return this.token;
    const headers = {};
    if (this.password) {
      assert.ok(
        this.username,
        "Registry username is required with a password.",
      );
      headers.Authorization = `Basic ${Buffer.from(`${this.username}:${this.password}`).toString("base64")}`;
    }
    const response = await this.fetch(
      `https://ghcr.io/token?service=ghcr.io&scope=repository:${repository}:pull`,
      { headers, redirect: "error", signal: AbortSignal.timeout(30_000) },
    );
    if (!response.ok)
      throw new Error(`GHCR token request failed (${response.status}).`);
    const body = JSON.parse((await boundedBody(response)).toString());
    assert.ok(
      typeof body.token === "string" && body.token.length > 0,
      "GHCR returned no access token.",
    );
    this.token = body.token;
    return this.token;
  }

  async read(kind, reference, allowMissing = false) {
    assert.ok(kind === "manifests" || kind === "blobs");
    assert.match(
      reference,
      /^(?:sha256:[a-f0-9]{64}|[A-Za-z0-9_][A-Za-z0-9_.-]{0,127})$/,
    );
    const token = await this.accessToken();
    let url = `https://ghcr.io/v2/${repository}/${kind}/${reference}`;
    let response;
    for (let redirects = 0; redirects <= 3; redirects++) {
      response = await this.fetch(url, {
        headers: {
          Accept: mediaTypes,
          ...(new URL(url).origin === "https://ghcr.io"
            ? { Authorization: `Bearer ${token}` }
            : {}),
        },
        redirect: "manual",
        signal: AbortSignal.timeout(30_000),
      });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      assert.equal(kind, "blobs", "Registry manifests must not redirect.");
      const location = new URL(response.headers.get("location"), url);
      assert.ok(
        location.protocol === "https:" &&
          !location.username &&
          !location.password,
        "Invalid registry blob redirect.",
      );
      await response.body?.cancel();
      url = location.href;
      if (redirects === 3) throw new Error("Too many registry blob redirects.");
    }
    const bytes = await boundedBody(response);
    const body = JSON.parse(bytes.toString());
    if (
      allowMissing &&
      response.status === 404 &&
      Array.isArray(body.errors) &&
      body.errors.length > 0 &&
      body.errors.every((error) => error.code === "MANIFEST_UNKNOWN")
    )
      return null;
    if (!response.ok)
      throw new Error(`GHCR ${kind} lookup failed (${response.status}).`);
    const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    if (digestPattern.test(reference))
      assert.equal(digest, reference, "Registry content digest mismatch.");
    const declared = response.headers.get("docker-content-digest");
    if (declared)
      assert.equal(declared, digest, "Registry digest header mismatch.");
    if (kind === "manifests")
      assert.equal(body.schemaVersion, 2, "Invalid registry manifest schema.");
    return { digest, body };
  }

  manifest(reference, allowMissing = false) {
    return this.read("manifests", reference, allowMissing);
  }

  async verifyIndex(reference, { version, commit } = {}) {
    const index = await this.manifest(reference);
    assert.ok(
      Array.isArray(index.body.manifests),
      "Expected a multi-platform image index.",
    );
    const runnable = index.body.manifests.filter(
      (item) => item.platform?.os !== "unknown",
    );
    assert.deepEqual(
      runnable
        .map((item) => `${item.platform?.os}/${item.platform?.architecture}`)
        .sort(),
      ["linux/amd64", "linux/arm64"],
      "The image must contain exactly AMD64 and ARM64 Linux images.",
    );
    for (const item of runnable) {
      assert.match(item.digest, digestPattern);
      const manifest = await this.manifest(item.digest);
      assert.match(manifest.body.config?.digest, digestPattern);
      const config = (await this.read("blobs", manifest.body.config.digest))
        .body;
      assert.equal(config.os, "linux");
      assert.equal(config.architecture, item.platform.architecture);
      const labels = config.config?.Labels;
      assert.equal(
        labels?.["org.opencontainers.image.source"],
        "https://github.com/PlayStash/playstash-frontend",
      );
      assert.equal(
        labels?.["org.opencontainers.image.licenses"],
        "CC-BY-NC-SA-4.0",
      );
      assert.match(
        labels?.["org.opencontainers.image.revision"],
        /^[a-f0-9]{40}$/,
      );
      if (commit)
        assert.equal(labels["org.opencontainers.image.revision"], commit);
      if (version)
        assert.equal(labels["org.opencontainers.image.version"], version);
    }
    return index;
  }
}
