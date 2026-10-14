#!/usr/bin/env node
/**
 * Fetches the pinned Ludusavi save-game tool that powers cloud saves and
 * places it as a Tauri sidecar in `src-tauri/binaries/`.
 *
 * Every download is checked against the SHA-256 pinned below, both the
 * archive and the extracted executable. A changed or truncated download
 * fails the script; nothing unverified is ever written to `binaries/`.
 *
 * Upstream publishes one macOS build (Apple silicon). The Intel macOS sidecar
 * is compiled from the pinned upstream source archive (the same archive and
 * checksum the WPF client's `tooling/ludusavi/provenance.json` pins) with
 * upstream's own lockfile. That needs a macOS host with the
 * `x86_64-apple-darwin` Rust target installed.
 *
 * Usage:
 *   pnpm ludusavi:fetch                       host target
 *   node scripts/fetch-ludusavi.mjs --target x86_64-apple-darwin
 *   node scripts/fetch-ludusavi.mjs --all     every release target (+ source build on macOS)
 *   node scripts/fetch-ludusavi.mjs --all --skip-source
 *   node scripts/fetch-ludusavi.mjs --verify  only check binaries already present
 *
 * Outputs (ignored by git):
 *   src-tauri/binaries/ludusavi-<target-triple>[.exe]
 *   src-tauri/binaries/ludusavi-THIRD-PARTY.txt   (upstream dependency notices)
 * The upstream MIT license is committed as src-tauri/binaries/ludusavi-LICENSE.txt.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gunzipSync, inflateRawSync } from "node:zlib";

export const LUDUSAVI_VERSION = "0.31.0";

const RELEASE_BASE = `https://github.com/mtkennerly/ludusavi/releases/download/v${LUDUSAVI_VERSION}/`;

/** Release assets and the executables inside them, pinned by SHA-256. */
export const RELEASE_TARGETS = {
  "x86_64-pc-windows-msvc": {
    asset: `ludusavi-v${LUDUSAVI_VERSION}-win64.zip`,
    archiveSha256:
      "f47a8ad8c708f01d2eb124704973beffab205e292f5287a10fc4a101f8d68706",
    member: "ludusavi.exe",
    binarySha256:
      "5192fd1ef31b5718cdb787d3f41abdcca8682ba4cbad31812d44ca6630ec2c0c",
  },
  "x86_64-unknown-linux-gnu": {
    asset: `ludusavi-v${LUDUSAVI_VERSION}-linux.tar.gz`,
    archiveSha256:
      "7322ff45d41eae7ae064a80d8c9ecccc5b8fb6fc090a603a66369cd4b054068d",
    member: "ludusavi",
    binarySha256:
      "38098e1aec77d0976fc0644ce00a265392ab58ac00b949ddff437aa9b7606d43",
  },
  "aarch64-apple-darwin": {
    asset: `ludusavi-v${LUDUSAVI_VERSION}-mac.tar.gz`,
    archiveSha256:
      "5787e64d4c795180ab485535cae0b0ef6ee14d4fbe3813797a86913a37cc47f1",
    member: "ludusavi",
    binarySha256:
      "2b0654309bf78f0487acb985d775b498d77540b9f311bee6b3d4bf3bb35ab497",
  },
};

/** Targets without an upstream binary, built from the pinned source archive. */
export const SOURCE_TARGETS = {
  "x86_64-apple-darwin": { hostPlatform: "darwin", machOCpuType: 0x01000007 },
};

export const SOURCE_ARCHIVE = {
  url: `https://github.com/mtkennerly/ludusavi/archive/refs/tags/v${LUDUSAVI_VERSION}.zip`,
  sha256: "74d6458fe597000d7565722c3ec8d4d291bc3349d6bbf7f47bd528a272b0f1e5",
  commit: "8844d7b67e784909f4ef42f7bfb047b700fe7b15",
  rootDirectory: `ludusavi-${LUDUSAVI_VERSION}`,
};

/** Upstream's bundled third-party license notices. */
export const LEGAL_ASSET = {
  asset: `ludusavi-v${LUDUSAVI_VERSION}-legal.zip`,
  archiveSha256:
    "9fce11fc44942efdd5969928d89b106c229f9a041d7a713c424a6da981660ebf",
  member: `ludusavi-v${LUDUSAVI_VERSION}-legal.txt`,
  sha256: "c126d61d62fe2ad5ec8cf05a8bae6fad7b78354c9a19f14a0179c9af7ed3bc49",
  output: "ludusavi-THIRD-PARTY.txt",
};

export const ALL_TARGETS = [
  ...Object.keys(RELEASE_TARGETS),
  ...Object.keys(SOURCE_TARGETS),
];

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
export const DEFAULT_OUTPUT_DIR = path.join(repoRoot, "src-tauri", "binaries");

export function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

/** Sidecar file name Tauri expects for `externalBin: ["binaries/ludusavi"]`. */
export function sidecarFileName(target) {
  return `ludusavi-${target}${target.includes("windows") ? ".exe" : ""}`;
}

/** Host triple from `rustc -vV` output. */
export function parseRustcHost(output) {
  const match = /^host:\s*(\S+)\s*$/m.exec(output);
  if (!match) throw new Error("Could not read the host triple from rustc -vV.");
  return match[1];
}

function hostTriple() {
  return parseRustcHost(execFileSync("rustc", ["-vV"], { encoding: "utf8" }));
}

export function assertSha256(buffer, expected, label) {
  const actual = sha256(buffer);
  if (actual !== expected) {
    throw new Error(
      `SHA-256 mismatch for ${label}: expected ${expected}, got ${actual}.`,
    );
  }
}

// ── Archive readers (no external tools, so every runner behaves the same) ──

/** Entries `{ name, data }` of a tar archive (ustar/GNU, regular files only). */
export function readTar(buffer) {
  const entries = [];
  let offset = 0;
  let longName = null;
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const field = (start, length) =>
      header
        .subarray(start, start + length)
        .toString("utf8")
        .replace(/\0.*$/s, "");
    const size = parseInt(field(124, 12).trim() || "0", 8);
    const type = field(156, 1) || "0";
    const prefix = field(345, 155);
    let name = field(0, 100);
    if (prefix) name = `${prefix}/${name}`;
    if (longName !== null) {
      name = longName;
      longName = null;
    }
    const dataStart = offset + 512;
    const data = buffer.subarray(dataStart, dataStart + size);
    if (type === "L") {
      longName = data.toString("utf8").replace(/\0.*$/s, "");
    } else if (type === "0" || type === "\0") {
      entries.push({ name, data: Buffer.from(data) });
    }
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  return entries;
}

/** Entries `{ name, data }` of a zip archive (stored or deflated files). */
export function readZip(buffer) {
  const minimumEnd = Math.max(0, buffer.length - 0xffff - 22);
  let end = -1;
  for (let index = buffer.length - 22; index >= minimumEnd; index -= 1) {
    if (buffer.readUInt32LE(index) === 0x06054b50) {
      end = index;
      break;
    }
  }
  if (end < 0) throw new Error("Not a zip archive.");
  const count = buffer.readUInt16LE(end + 10);
  let cursor = buffer.readUInt32LE(end + 16);
  const entries = [];
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error("Corrupt zip central directory.");
    }
    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer
      .subarray(cursor + 46, cursor + 46 + nameLength)
      .toString("utf8");
    cursor += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith("/")) continue;
    if (flags & 1) throw new Error(`Encrypted zip entry: ${name}`);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const raw = buffer.subarray(dataStart, dataStart + compressedSize);
    let data;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = inflateRawSync(raw);
    else throw new Error(`Unsupported zip compression ${method} for ${name}`);
    entries.push({ name, data });
  }
  return entries;
}

export function readArchive(fileName, buffer) {
  if (fileName.endsWith(".zip")) return readZip(buffer);
  if (fileName.endsWith(".tar.gz")) return readTar(gunzipSync(buffer));
  throw new Error(`Unsupported archive type: ${fileName}`);
}

export function extractMember(fileName, buffer, member) {
  const entry = readArchive(fileName, buffer).find(
    (candidate) => candidate.name.replace(/^\.\//, "") === member,
  );
  if (!entry) throw new Error(`${member} is missing from ${fileName}.`);
  return entry.data;
}

/** Joins an archive entry name below `root`, rejecting traversal. */
export function safeJoin(root, name) {
  if (
    name.includes("\\") ||
    name.includes(":") ||
    name.startsWith("/") ||
    name.split("/").some((part) => part === "..")
  ) {
    throw new Error(`Unsafe archive entry: ${name}`);
  }
  return path.join(root, ...name.split("/").filter(Boolean));
}

/** CPU type of a thin 64-bit Mach-O executable, or null. */
export function machOCpuType(buffer) {
  if (buffer.length < 8 || buffer.readUInt32LE(0) !== 0xfeedfacf) return null;
  return buffer.readUInt32LE(4);
}

// ── Download and install ────────────────────────────────────────────────────

async function download(url) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`Download failed (${response.status}): ${url}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

function writeExecutable(target, data) {
  mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.partial`;
  writeFileSync(temporary, data);
  chmodSync(temporary, 0o755);
  renameSync(temporary, target);
}

function fileMatches(file, expected) {
  return existsSync(file) && sha256(readFileSync(file)) === expected;
}

async function fetchReleaseTarget(target, outputDir, force) {
  const pin = RELEASE_TARGETS[target];
  const output = path.join(outputDir, sidecarFileName(target));
  if (!force && fileMatches(output, pin.binarySha256)) {
    console.log(`ludusavi ${LUDUSAVI_VERSION} for ${target} is up to date.`);
    return;
  }
  console.log(`Downloading ${pin.asset} …`);
  const archive = await download(RELEASE_BASE + pin.asset);
  assertSha256(archive, pin.archiveSha256, pin.asset);
  const binary = extractMember(pin.asset, archive, pin.member);
  assertSha256(binary, pin.binarySha256, `${pin.asset}:${pin.member}`);
  writeExecutable(output, binary);
  console.log(`Wrote ${path.relative(repoRoot, output)} (verified).`);
}

async function fetchLegalNotices(outputDir, force) {
  const output = path.join(outputDir, LEGAL_ASSET.output);
  if (!force && fileMatches(output, LEGAL_ASSET.sha256)) return;
  const archive = await download(RELEASE_BASE + LEGAL_ASSET.asset);
  assertSha256(archive, LEGAL_ASSET.archiveSha256, LEGAL_ASSET.asset);
  const text = extractMember(LEGAL_ASSET.asset, archive, LEGAL_ASSET.member);
  assertSha256(text, LEGAL_ASSET.sha256, LEGAL_ASSET.member);
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(output, text);
  console.log(`Wrote ${path.relative(repoRoot, output)} (verified).`);
}

async function buildSourceTarget(target, outputDir, force) {
  const spec = SOURCE_TARGETS[target];
  const output = path.join(outputDir, sidecarFileName(target));
  const marker = `${output}.source-sha256`;
  if (
    !force &&
    existsSync(output) &&
    existsSync(marker) &&
    readFileSync(marker, "utf8").trim() === SOURCE_ARCHIVE.sha256 &&
    machOCpuType(readFileSync(output)) === spec.machOCpuType
  ) {
    console.log(`ludusavi ${LUDUSAVI_VERSION} for ${target} is up to date.`);
    return;
  }
  if (process.platform !== spec.hostPlatform) {
    throw new Error(
      `ludusavi has no upstream ${target} binary; building it needs a ${spec.hostPlatform} host.`,
    );
  }
  const work = mkdtempSync(path.join(tmpdir(), "playstash-ludusavi-"));
  try {
    console.log(
      `Downloading pinned ludusavi source (${SOURCE_ARCHIVE.commit}) …`,
    );
    const archive = await download(SOURCE_ARCHIVE.url);
    assertSha256(archive, SOURCE_ARCHIVE.sha256, "ludusavi source archive");
    const sourceRoot = path.join(work, "source");
    for (const entry of readZip(archive)) {
      const destination = safeJoin(sourceRoot, entry.name);
      mkdirSync(path.dirname(destination), { recursive: true });
      writeFileSync(destination, entry.data);
    }
    const crate = path.join(sourceRoot, SOURCE_ARCHIVE.rootDirectory);
    const targetDir = path.join(work, "target");
    console.log(`Building ludusavi ${LUDUSAVI_VERSION} for ${target} …`);
    execFileSync(
      "cargo",
      ["build", "--release", "--locked", "--target", target],
      {
        cwd: crate,
        stdio: "inherit",
        env: { ...process.env, CARGO_TARGET_DIR: targetDir },
      },
    );
    const binary = readFileSync(
      path.join(targetDir, target, "release", "ludusavi"),
    );
    if (machOCpuType(binary) !== spec.machOCpuType) {
      throw new Error(`The ${target} build has an unexpected architecture.`);
    }
    writeExecutable(output, binary);
    writeFileSync(marker, `${SOURCE_ARCHIVE.sha256}\n`);
    console.log(
      `Wrote ${path.relative(repoRoot, output)} (built from verified source, sha256 ${sha256(binary)}).`,
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Checks the sidecars already in `outputDir`; returns the list of problems. */
export function verifyOutputs(outputDir, targets) {
  const problems = [];
  for (const target of targets) {
    const file = path.join(outputDir, sidecarFileName(target));
    if (!existsSync(file)) {
      problems.push(`${sidecarFileName(target)} is missing`);
    } else if (RELEASE_TARGETS[target]) {
      if (!fileMatches(file, RELEASE_TARGETS[target].binarySha256)) {
        problems.push(`${sidecarFileName(target)} has an unexpected SHA-256`);
      }
    } else if (
      machOCpuType(readFileSync(file)) !== SOURCE_TARGETS[target].machOCpuType
    ) {
      problems.push(
        `${sidecarFileName(target)} has an unexpected architecture`,
      );
    }
  }
  if (
    !fileMatches(path.join(outputDir, LEGAL_ASSET.output), LEGAL_ASSET.sha256)
  ) {
    problems.push(`${LEGAL_ASSET.output} is missing or modified`);
  }
  return problems;
}

export function parseArgs(argv) {
  const options = {
    targets: [],
    all: false,
    force: false,
    verify: false,
    skipSource: false,
    outputDir: DEFAULT_OUTPUT_DIR,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--all") options.all = true;
    else if (arg === "--force") options.force = true;
    else if (arg === "--verify") options.verify = true;
    else if (arg === "--skip-source") options.skipSource = true;
    else if (arg === "--target" || arg === "--out") {
      const value = argv[index + 1] ?? "";
      index += 1;
      if (arg === "--out") options.outputDir = path.resolve(value);
      // An empty `--target ""` (CI matrix without a cross target) means the host.
      else if (value.trim()) options.targets.push(value.trim());
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  let targets = options.all ? [...ALL_TARGETS] : options.targets;
  if (!targets.length) targets = [hostTriple()];
  if (options.skipSource) {
    targets = targets.filter((target) => !SOURCE_TARGETS[target]);
  } else if (options.all) {
    targets = targets.filter((target) => {
      const source = SOURCE_TARGETS[target];
      if (!source || process.platform === source.hostPlatform) return true;
      console.log(
        `Skipping ${target}: it is built from source on ${source.hostPlatform}.`,
      );
      return false;
    });
  }
  for (const target of targets) {
    if (!RELEASE_TARGETS[target] && !SOURCE_TARGETS[target]) {
      throw new Error(
        `No pinned ludusavi build for ${target}. Supported: ${ALL_TARGETS.join(", ")}.`,
      );
    }
  }

  if (options.verify) {
    const problems = verifyOutputs(options.outputDir, targets);
    if (problems.length) throw new Error(problems.join("\n"));
    console.log(
      `Verified ludusavi ${LUDUSAVI_VERSION} for ${targets.join(", ")}.`,
    );
    return;
  }

  await fetchLegalNotices(options.outputDir, options.force);
  for (const target of targets) {
    if (RELEASE_TARGETS[target]) {
      await fetchReleaseTarget(target, options.outputDir, options.force);
    } else {
      await buildSourceTarget(target, options.outputDir, options.force);
    }
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
