import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyPublishedAssets } from "./container-release.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const project = `playstash-runtime-${randomUUID()}`;
const label = `com.playstash.runtime-test=${project}`;
const externalImage = process.argv[2];
if (externalImage)
  assert.match(
    externalImage,
    /^(?:ghcr\.io\/playstash\/playstash-frontend@)?sha256:[a-f0-9]{64}$/,
  );
const image = externalImage || `${project}:test`;
const frontend = `${project}-frontend`;
const backend = `${project}-backend`;
const temporary = await mkdtemp(path.join(tmpdir(), `${project}-`));
const definitions = [
  "Dockerfile.runtime",
  "nginx.runtime.conf",
  "start-runtime.sh",
];
const docker = (...args) =>
  execFileSync("docker", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let port;
let networkCreated = false;

function inspectContainer(name) {
  return JSON.parse(docker("inspect", name))[0];
}
function removeContainer(name) {
  try {
    const info = inspectContainer(name);
    assert.equal(info.Config.Labels["com.playstash.runtime-test"], project);
    docker("rm", "--force", name);
  } catch (cause) {
    if (!/no such (object|container)/i.test(String(cause.stderr))) throw cause;
  }
}
async function startFrontend(trusted = "") {
  docker(
    "run",
    "--detach",
    "--name",
    frontend,
    "--label",
    label,
    "--network",
    project,
    "--read-only",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges:true",
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,size=32m,mode=1777",
    "--publish",
    "127.0.0.1::8080",
    "--env",
    `PLAYSTASH_TRUSTED_PROXY_CIDRS=${trusted}`,
    image,
  );
  const info = inspectContainer(frontend);
  assert.equal(info.Config.User, "101:101");
  assert.equal(info.HostConfig.ReadonlyRootfs, true);
  assert.deepEqual(info.HostConfig.CapDrop, ["ALL"]);
  port = Number(info.NetworkSettings.Ports["8080/tcp"][0].HostPort);
  for (let i = 0; i < 80; i++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/healthz`, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok && (await response.text()) === "ok\n") return;
    } catch {}
    await pause(100);
  }
  throw new Error(
    `Runtime did not become healthy: ${docker("logs", frontend)}`,
  );
}
async function request(url, options = {}) {
  // Node fetch intentionally replaces Host; use HTTP to exercise public authority.
  return new Promise((resolve, reject) => {
    const outgoing = http.request({
      hostname: "127.0.0.1",
      port,
      path: url,
      ...options,
    });
    outgoing.setTimeout(5000, () =>
      outgoing.destroy(new Error("HTTP request timed out")),
    );
    outgoing.on("error", reject);
    outgoing.on("response", (response) => {
      const chunks = [];
      response.on("error", reject);
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () =>
        resolve(
          new Response(Buffer.concat(chunks), {
            status: response.statusCode,
            headers: Object.fromEntries(
              Object.entries(response.headers).map(([name, value]) => [
                name,
                String(value),
              ]),
            ),
          }),
        ),
      );
    });
    outgoing.end(options.body);
  });
}
async function websocket() {
  const key = randomBytes(16).toString("base64");
  const expectedAccept = createHash("sha1")
    .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
    .digest("base64");
  await new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1");
    let data = Buffer.alloc(0);
    socket.setTimeout(5000, () =>
      socket.destroy(new Error("WebSocket upgrade timed out")),
    );
    socket.on("connect", () =>
      socket.write(
        "GET /socket.io/?EIO=4&transport=websocket HTTP/1.1\r\n" +
          "Host: playstash.example\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
          `Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${key}\r\n` +
          "Authorization: Bearer isolated-ws-fixture\r\nCookie: ws-session=isolated\r\n\r\n",
      ),
    );
    socket.on("error", reject);
    socket.on("data", (chunk) => {
      data = Buffer.concat([data, chunk]);
      const boundary = data.indexOf("\r\n\r\n");
      if (boundary < 0 || data.length < boundary + 8) return;
      const header = data.subarray(0, boundary).toString();
      if (!header.startsWith("HTTP/1.1 101"))
        return reject(new Error("WebSocket was not upgraded"));
      const frame = data.subarray(boundary + 4);
      if (frame.length < 4 || frame.length < 4 + frame.readUInt16BE(2)) return;
      try {
        assert.equal(
          /Sec-WebSocket-Accept:\s*([^\r\n]+)/i.exec(header)?.[1].trim(),
          expectedAccept,
        );
        assert.equal(
          JSON.parse(frame.subarray(4).toString()).url,
          "/socket.io/?EIO=4&transport=websocket",
        );
        const upstream = JSON.parse(frame.subarray(4).toString());
        assert.equal(upstream.authorization, "Bearer isolated-ws-fixture");
        assert.equal(upstream.cookie, "ws-session=isolated");
        socket.destroy();
        resolve();
      } catch (cause) {
        socket.destroy();
        reject(cause);
      }
    });
  });
}
async function streamedUpload() {
  const initial = Buffer.alloc(64 * 1024, 65);
  const remaining = Buffer.alloc(1536 * 1024, 66);
  const result = await new Promise((resolve, reject) => {
    const outgoing = http.request({
      hostname: "127.0.0.1",
      port,
      path: "/api/upload",
      method: "POST",
    });
    outgoing.setTimeout(5000, () =>
      outgoing.destroy(new Error("Streaming upload buffered or timed out")),
    );
    outgoing.on("error", reject);
    outgoing.on("response", (response) => {
      let body = "";
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => resolve({ status: response.statusCode, body }));
    });
    outgoing.write(initial);
    void (async () => {
      for (let attempt = 0; attempt < 30; attempt++) {
        const progress = Number(
          await (await request("/api/upload-progress")).text(),
        );
        if (progress > 0) {
          outgoing.end(remaining);
          return;
        }
        await pause(50);
      }
      throw new Error("Upstream did not receive bytes before the upload ended");
    })().catch((cause) => outgoing.destroy(cause));
  });
  assert.equal(result.status, 200);
  assert.equal(result.body, String(initial.length + remaining.length));
}
async function streamedResponse() {
  const body = await new Promise((resolve, reject) => {
    const outgoing = http.get({
      hostname: "127.0.0.1",
      port,
      path: "/api/stream",
    });
    outgoing.setTimeout(5000, () =>
      outgoing.destroy(new Error("Response was buffered until completion")),
    );
    outgoing.on("error", reject);
    outgoing.on("response", (response) => {
      let received = "";
      let released = false;
      response.on("error", reject);
      response.on("data", (chunk) => {
        received += chunk;
        if (!released) {
          released = true;
          void request("/api/stream-release").catch(reject);
        }
      });
      response.on("end", () => resolve(received));
    });
  });
  assert.equal(body, "first\ndone");
}

try {
  for (const filename of definitions)
    await cp(path.join(root, filename), path.join(temporary, filename));
  await cp(path.join(root, "LICENSE"), path.join(temporary, "LICENSE"));
  await writeFile(
    path.join(temporary, "NOTICE.txt"),
    "Integration fixture; original project authors credited by LICENSE.\n",
  );
  await writeFile(
    path.join(temporary, "provenance.json"),
    JSON.stringify({ fixture: true }),
  );
  if (!externalImage)
    await cp(path.join(root, "dist"), path.join(temporary, "dist"), {
      recursive: true,
    });
  const fixture = path.join(temporary, "fixture");
  await mkdir(fixture);
  await cp(
    path.join(root, "scripts/runtime-proxy-fixture.mjs"),
    path.join(fixture, "server.mjs"),
  );
  await writeFile(
    path.join(fixture, "Dockerfile"),
    'FROM node:lts-alpine\nCOPY server.mjs /server.mjs\nUSER node\nCMD ["node","/server.mjs"]\n',
  );
  if (!externalImage)
    docker(
      "build",
      "--label",
      label,
      "--tag",
      image,
      "--file",
      path.join(temporary, "Dockerfile.runtime"),
      temporary,
    );
  docker("build", "--label", label, "--tag", `${project}:fixture`, fixture);
  docker("network", "create", "--label", label, project);
  networkCreated = true;
  docker(
    "run",
    "--detach",
    "--label",
    label,
    "--name",
    backend,
    "--network",
    project,
    "--network-alias",
    "playstash-backend",
    `${project}:fixture`,
  );
  await startFrontend();
  if (externalImage) {
    const information = JSON.parse(docker("image", "inspect", image))[0];
    assert.equal(
      information.Config.Labels["org.opencontainers.image.revision"],
      process.env.PLAYSTASH_EXPECTED_FRONTEND_COMMIT,
    );
    assert.equal(
      information.Config.Labels["org.opencontainers.image.version"],
      process.env.PLAYSTASH_EXPECTED_FRONTEND_VERSION,
    );
    const proof = path.join(temporary, "published");
    await mkdir(proof);
    docker("cp", `${frontend}:/opt/playstash/frontend/.`, proof);
    docker("cp", `${frontend}:/usr/share/nginx/html`, path.join(proof, "dist"));
    await verifyPublishedAssets(proof, {
      commit: process.env.PLAYSTASH_EXPECTED_FRONTEND_COMMIT,
      version: process.env.PLAYSTASH_EXPECTED_FRONTEND_VERSION,
    });
  }
  const indexResponse = await request("/");
  const index = await indexResponse.text();
  assert.match(
    indexResponse.headers.get("content-security-policy"),
    /script-src 'self'/,
  );
  assert.doesNotMatch(
    indexResponse.headers.get("content-security-policy"),
    /unsafe-eval/,
  );
  assert.match(index, /<title>PlayStash<\/title>/);
  assert.equal(await (await request("/library/123")).text(), index);
  const scripts = [
    ...index.matchAll(/(?:src|href)="(\/assets\/[^\"]+\.(?:js|css))"/g),
  ].map((match) => match[1]);
  assert.ok(scripts.length > 1);
  for (const asset of scripts) {
    const response = await request(asset);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control"), /immutable/);
    assert.match(response.headers.get("content-type"), /javascript|text\/css/);
    await response.arrayBuffer();
  }
  const missing = await request("/assets/missing.js");
  assert.equal(missing.status, 404);
  assert.doesNotMatch(missing.headers.get("cache-control"), /immutable/);
  assert.equal((await request("/.env")).status, 403);
  const response = await request("/api/inspect?value=%2F&keep=1", {
    headers: {
      Host: "playstash.example:8443",
      "X-Forwarded-Proto": "https",
      "X-Forwarded-For": "203.0.113.99",
      Forwarded: "for=203.0.113.99;proto=https",
      "X-Forwarded-Port": "443",
      Authorization: "Bearer isolated-runtime-fixture",
      Cookie: "fixture-session=isolated",
    },
  });
  const untrusted = await response.json();
  assert.equal(untrusted.url, "/api/inspect?value=%2F&keep=1");
  assert.equal(untrusted.host, "playstash.example:8443");
  assert.equal(untrusted.proto, "http");
  assert.notEqual(untrusted.client, "203.0.113.99");
  assert.equal(untrusted.client, untrusted.realIp);
  assert.equal(untrusted.forwarded, undefined);
  assert.equal(untrusted.forwardedPort, undefined);
  assert.equal(untrusted.authorization, "Bearer isolated-runtime-fixture");
  assert.equal(untrusted.cookie, "fixture-session=isolated");
  assert.equal(response.headers.get("content-security-policy"), null);
  const docs = await request("/api/docs");
  assert.equal(
    docs.headers.get("content-security-policy"),
    "script-src 'self' 'unsafe-inline'",
  );
  assert.equal(docs.headers.get("cache-control"), "private, no-store");
  assert.equal((await request("/api/missing")).status, 404);
  const range = await request("/api/download", {
    headers: { Range: "bytes=5-8" },
  });
  assert.equal(range.status, 206);
  assert.equal(range.headers.get("content-range"), "bytes 5-8/26");
  assert.equal(await range.text(), "fghi");
  await streamedUpload();
  await streamedResponse();
  await websocket();
  assert.equal(docker("exec", frontend, "id", "-u"), "101");
  docker(
    "exec",
    frontend,
    "sh",
    "-c",
    "test ! -w /usr/share/nginx/html && ! command -v node && test -s /opt/playstash/frontend/LICENSE",
  );
  removeContainer(frontend);
  await startFrontend(untrusted.client);
  const trusted = await (
    await request("/api/inspect", {
      headers: {
        "X-Forwarded-Proto": "https",
        "X-Forwarded-For": "203.0.113.7",
      },
    })
  ).json();
  assert.equal(trusted.proto, "https");
  assert.equal(trusted.client, "203.0.113.7");
  const spoofedScheme = await (
    await request("/api/inspect", {
      headers: {
        "X-Forwarded-Proto": "https, http",
      },
    })
  ).json();
  assert.equal(spoofedScheme.proto, "http");
  removeContainer(frontend);
  assert.throws(
    () =>
      docker(
        "run",
        "--rm",
        "--label",
        label,
        "--read-only",
        "--tmpfs",
        "/tmp:mode=1777",
        "--env",
        "PLAYSTASH_TRUSTED_PROXY_CIDRS=127.0.0.1;include",
        image,
      ),
    (cause) => String(cause.stderr).includes("Invalid trusted proxy CIDR"),
    "Config injection must fail closed",
  );
} finally {
  for (const container of [frontend, backend]) removeContainer(container);
  if (networkCreated) {
    const network = JSON.parse(docker("network", "inspect", project))[0];
    assert.equal(network.Labels["com.playstash.runtime-test"], project);
    docker("network", "rm", project);
  }
  for (const tag of [...(externalImage ? [] : [image]), `${project}:fixture`]) {
    try {
      const info = JSON.parse(docker("image", "inspect", tag))[0];
      assert.equal(info.Config.Labels["com.playstash.runtime-test"], project);
      docker("image", "rm", tag);
    } catch (cause) {
      if (!/no such image/i.test(String(cause.stderr))) throw cause;
    }
  }
  assert.equal(path.dirname(temporary), path.resolve(tmpdir()));
  assert.ok(path.basename(temporary).startsWith(`${project}-`));
  await rm(temporary, { recursive: true, force: true });
}
console.log(
  "Frontend runtime PASS: nonroot/read-only, SPA/assets/security headers, unchanged API paths, streaming upload/response, range download, WebSocket, trusted HTTPS/IP, rejected spoofing/config injection and owned-resource cleanup.",
);
