#!/usr/bin/env node
/**
 * Builds the security-patched Ludusavi save-game tool that powers cloud saves
 * and places it as a Tauri sidecar in `src-tauri/binaries/`.
 *
 * This is the same build the Windows (WPF) client ships ("PlayStash-security-1"):
 * official Ludusavi v0.31.0 source, the reviewed replacement Cargo.lock and the
 * manifest-only patches in `tooling/ludusavi/`, all pinned by SHA-256 in
 * `tooling/ludusavi/provenance.json`. No upstream release binary is used.
 *
 * Steps (any failure aborts before something is written to `binaries/`):
 *   1. verify the lockfile and patch checksums (before any download)
 *   2. download + verify the pinned source archive and vendored cryoglyph crate
 *   3. apply the patches (each checks the original file's SHA-256) and the lockfile
 *   4. audit the complete lockfile with the checksum-pinned official cargo-audit;
 *      vulnerabilities or unsoundness fail the build
 *   5. optionally run upstream's test suite (`--upstream-tests`, used by CI)
 *   6. `cargo build --locked --release` with the pinned Rust toolchain, reporting
 *      version 0.31.0 and build variant PlayStash-security-1
 *   7. check the executable format, then run a CLI smoke test in a sandbox
 *      (version, option-like titles, ZIP backup, exact restore)
 *   8. generate the third-party notices from the patched dependency graph
 *   9. export the sidecar, notices and `ludusavi-provenance.json` (with the
 *      executable SHA-256)
 *
 * Usage:
 *   pnpm ludusavi:build                                host target
 *   node scripts/build-ludusavi.mjs --target x86_64-apple-darwin
 *   node scripts/build-ludusavi.mjs --upstream-tests   also run upstream tests
 *   node scripts/build-ludusavi.mjs --verify [--target T]  check existing outputs
 *   node scripts/build-ludusavi.mjs --check-pins       check the tooling pins only
 *
 * Upstream's Windows tests import fixture values into HKCU\Software\Ludusavi,
 * so `--upstream-tests` on Windows also needs `--allow-test-registry-changes`
 * outside GitHub Actions (use a disposable account).
 *
 * Outputs (ignored by git):
 *   src-tauri/binaries/ludusavi-<target-triple>[.exe]
 *   src-tauri/binaries/ludusavi-THIRD-PARTY.txt
 *   src-tauri/binaries/ludusavi-provenance.json
 * The upstream MIT license is committed as src-tauri/binaries/ludusavi-LICENSE.txt
 * and checked against the source archive on every build.
 */
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gunzipSync, inflateRawSync } from "node:zlib";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
export const TOOLING_DIR = path.join(repoRoot, "tooling", "ludusavi");
export const DEFAULT_OUTPUT_DIR = path.join(repoRoot, "src-tauri", "binaries");
export const DEFAULT_TARGET_DIR = path.join(
  repoRoot,
  "src-tauri",
  "target",
  "ludusavi-build",
);
export const PROVENANCE_OUTPUT = "ludusavi-provenance.json";
export const NOTICES_OUTPUT = "ludusavi-THIRD-PARTY.txt";
export const LICENSE_OUTPUT = "ludusavi-LICENSE.txt";

const HEX64 = /^[0-9a-f]{64}$/;

export function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export function assertSha256(buffer, expected, label) {
  if (!HEX64.test(expected ?? "")) {
    throw new Error(`Invalid pinned SHA-256 for ${label}.`);
  }
  const actual = sha256(buffer);
  if (actual !== expected) {
    throw new Error(
      `Integrity verification failed for ${label}: expected ${expected}, got ${actual}.`,
    );
  }
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

function isSafeRelative(relative) {
  return (
    typeof relative === "string" &&
    relative.length > 0 &&
    !path.isAbsolute(relative) &&
    !/^[a-zA-Z]:/.test(relative) &&
    !relative.split(/[\\/]/).includes("..")
  );
}

// ── Pinned tooling ──────────────────────────────────────────────────────────

/**
 * Loads `provenance.json` and verifies the lockfile and every patch against
 * it. Runs before anything is downloaded, so a changed pin fails early.
 */
export function loadVerifiedTooling(toolingDir = TOOLING_DIR) {
  const provenance = JSON.parse(
    readFileSync(path.join(toolingDir, "provenance.json"), "utf8"),
  );
  if (
    provenance.schema_version !== 1 ||
    !/^[0-9a-f]{40}$/.test(provenance.source?.commit ?? "") ||
    !HEX64.test(provenance.source?.archive_sha256 ?? "") ||
    !provenance.source?.archive_url?.startsWith("https://") ||
    !/^\d+\.\d+\.\d+$/.test(provenance.version ?? "") ||
    !/^\d+\.\d+\.\d+$/.test(provenance.rust_toolchain ?? "") ||
    !provenance.variant ||
    !Array.isArray(provenance.targets) ||
    !provenance.targets.length
  ) {
    throw new Error("Invalid pinned Ludusavi source provenance.");
  }
  const lockfile = readFileSync(path.join(toolingDir, "Cargo.lock"));
  assertSha256(lockfile, provenance.lockfile_sha256, "tooling Cargo.lock");
  const patches = provenance.patches.map((entry) => {
    if (!isSafeRelative(entry.path)) {
      throw new Error("Patch path must stay within the tooling directory.");
    }
    const raw = readFileSync(path.join(toolingDir, entry.path));
    assertSha256(raw, entry.sha256, entry.path);
    return { entry: entry.path, ...JSON.parse(raw.toString("utf8")) };
  });
  for (const vendor of provenance.vendor_sources ?? []) {
    if (
      !/^[a-z0-9_-]+$/.test(vendor.name) ||
      !/^\d+\.\d+\.\d+$/.test(vendor.version) ||
      !vendor.archive_url?.startsWith("https://") ||
      !HEX64.test(vendor.archive_sha256 ?? "")
    ) {
      throw new Error("Invalid vendored source provenance.");
    }
  }
  return { provenance, lockfile, patches };
}

/**
 * Applies one manifest patch to `content` (a string). The caller has already
 * verified the original file's SHA-256 (`before_sha256`).
 */
export function applyPatchContent(content, patch) {
  if (patch.operation === "append") return content + patch.content;
  if (patch.operation === "replace") {
    if (!patch.before || content.split(patch.before).length !== 2) {
      throw new Error(`Source patch must match exactly once: ${patch.entry}`);
    }
    return content.replace(patch.before, () => patch.after);
  }
  throw new Error(`Unsupported source patch operation: ${patch.operation}`);
}

export function applyPatches(sourceDir, patches) {
  for (const patch of patches) {
    if (!isSafeRelative(patch.path)) {
      throw new Error(
        "Source patch path must stay within the source directory.",
      );
    }
    const file = path.join(sourceDir, patch.path);
    const original = readFileSync(file);
    assertSha256(original, patch.before_sha256, `${patch.path} (before patch)`);
    writeFileSync(file, applyPatchContent(original.toString("utf8"), patch));
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
    } else if (type === "x") {
      const paxPath = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(data.toString("utf8"));
      if (paxPath) longName = paxPath[1];
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
  if (/\.(tar\.gz|tgz|crate)$/.test(fileName)) {
    return readTar(gunzipSync(buffer));
  }
  throw new Error(`Unsupported archive type: ${fileName}`);
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

function extractAll(fileName, buffer, destination) {
  for (const entry of readArchive(fileName, buffer)) {
    const file = safeJoin(destination, entry.name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, entry.data);
  }
}

// ── Executable checks ───────────────────────────────────────────────────────

/** `{ format, machine }` of a PE, ELF or thin 64-bit Mach-O executable. */
export function executableFormat(buffer) {
  if (buffer.length >= 0x40 && buffer.toString("latin1", 0, 2) === "MZ") {
    const pe = buffer.readUInt32LE(0x3c);
    if (pe + 6 <= buffer.length && buffer.readUInt32LE(pe) === 0x00004550) {
      return { format: "pe", machine: buffer.readUInt16LE(pe + 4) };
    }
  }
  if (buffer.length >= 0x14 && buffer.readUInt32BE(0) === 0x7f454c46) {
    return { format: "elf", machine: buffer.readUInt16LE(0x12) };
  }
  if (buffer.length >= 8 && buffer.readUInt32LE(0) === 0xfeedfacf) {
    return { format: "macho", machine: buffer.readUInt32LE(4) };
  }
  return null;
}

/** Expected executable format and host requirements per supported target. */
export const TARGET_SPECS = {
  "x86_64-pc-windows-msvc": {
    format: "pe",
    machine: 0x8664,
    hosts: ["win32"],
    runsOn: ["win32-x64", "win32-arm64"],
  },
  "x86_64-unknown-linux-gnu": {
    format: "elf",
    machine: 0x3e,
    hosts: ["linux"],
    runsOn: ["linux-x64"],
  },
  "aarch64-apple-darwin": {
    format: "macho",
    machine: 0x0100000c,
    hosts: ["darwin"],
    runsOn: ["darwin-arm64"],
  },
  "x86_64-apple-darwin": {
    format: "macho",
    machine: 0x01000007,
    // Apple silicon runs the Intel build through Rosetta 2.
    hosts: ["darwin"],
    runsOn: ["darwin-x64", "darwin-arm64"],
  },
};

export function assertExecutableForTarget(buffer, target) {
  const spec = TARGET_SPECS[target];
  const actual = executableFormat(buffer);
  if (
    !spec ||
    actual?.format !== spec.format ||
    actual.machine !== spec.machine
  ) {
    throw new Error(`The ${target} build has an unexpected executable format.`);
  }
}

// ── Third-party notices ─────────────────────────────────────────────────────

const LICENSE_FILE =
  /^(licen[cs]e|copying|notice|copyright|unlicense|authors)/i;

/**
 * Packages compiled into the binary for any target: everything reachable
 * from the root through normal and build dependencies (dev-only edges are
 * skipped). `metadata` is `cargo metadata --format-version 1` output.
 */
export function shippedPackages(metadata) {
  const nodes = new Map(metadata.resolve.nodes.map((node) => [node.id, node]));
  const packages = new Map(metadata.packages.map((pkg) => [pkg.id, pkg]));
  const seen = new Set();
  const queue = [metadata.resolve.root];
  while (queue.length) {
    const id = queue.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    for (const dep of nodes.get(id)?.deps ?? []) {
      const kinds = dep.dep_kinds ?? [{ kind: null }];
      if (kinds.some((kind) => kind.kind !== "dev")) queue.push(dep.pkg);
    }
  }
  seen.delete(metadata.resolve.root);
  return [...seen]
    .map((id) => packages.get(id))
    .filter(Boolean)
    .sort(
      (a, b) =>
        a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
    );
}

/** Deterministic notice text with each package's license files. */
export function renderNotices(packages, readLicenseFiles, header) {
  const rule = "=".repeat(80);
  const parts = [header.trimEnd(), ""];
  for (const pkg of packages) {
    parts.push(rule, `${pkg.name} ${pkg.version}`);
    parts.push(`License: ${pkg.license ?? "see license file"}`);
    if (pkg.repository) parts.push(`Repository: ${pkg.repository}`);
    const files = readLicenseFiles(pkg);
    if (!files.length) {
      parts.push(
        "",
        "(No license file is distributed with this crate; the license expression above applies.)",
      );
    }
    for (const file of files) {
      parts.push(
        "",
        `--- ${file.name} ---`,
        file.text.replace(/\r\n?/g, "\n").trimEnd(),
      );
    }
    parts.push("");
  }
  return `${parts.join("\n")}\n`;
}

function readCrateLicenseFiles(pkg) {
  const dir = path.dirname(pkg.manifest_path);
  const names = new Set(
    readdirSync(dir).filter(
      (name) =>
        LICENSE_FILE.test(name) && statSync(path.join(dir, name)).isFile(),
    ),
  );
  if (pkg.license_file) {
    const relative = path.relative(dir, path.resolve(dir, pkg.license_file));
    if (isSafeRelative(relative) && existsSync(path.join(dir, relative))) {
      names.add(relative.split(path.sep).join("/"));
    }
  }
  return [...names].sort().map((name) => ({
    name,
    text: readFileSync(path.join(dir, name), "utf8"),
  }));
}

// ── Audit ───────────────────────────────────────────────────────────────────

/** Fails on vulnerabilities or unsoundness; returns maintenance warnings. */
export function evaluateAudit(report) {
  const vulnerabilities = report?.vulnerabilities?.count;
  const unsound = report?.warnings?.unsound ?? [];
  if (vulnerabilities !== 0 || unsound.length) {
    throw new Error(
      "The patched Ludusavi lockfile has unresolved vulnerabilities or unsoundness advisories.",
    );
  }
  return (report.warnings?.unmaintained ?? []).map(
    (warning) =>
      `${warning.advisory?.id}: ${warning.package?.name} ${warning.package?.version} is unmaintained.`,
  );
}

// ── Provenance output ───────────────────────────────────────────────────────

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Merges one built binary into the generated provenance document. */
export function mergeProvenance(existing, provenance, target, binarySha256) {
  const sameSource =
    existing &&
    stableJson({ ...existing, binaries: undefined }) ===
      stableJson({ ...provenance, binaries: undefined });
  return {
    ...provenance,
    binaries: {
      ...(sameSource ? existing.binaries : {}),
      [target]: {
        file: sidecarFileName(target),
        sha256: binarySha256,
        version: provenance.version,
        variant: provenance.variant,
      },
    },
  };
}

/** Checks existing outputs against the pinned provenance; returns problems. */
export function verifyOutputs(outputDir, targets, provenance) {
  const problems = [];
  let generated = null;
  try {
    generated = JSON.parse(
      readFileSync(path.join(outputDir, PROVENANCE_OUTPUT), "utf8"),
    );
  } catch {
    problems.push(`${PROVENANCE_OUTPUT} is missing or unreadable`);
  }
  if (
    generated &&
    stableJson({ ...generated, binaries: undefined }) !==
      stableJson({ ...provenance, binaries: undefined })
  ) {
    problems.push(
      `${PROVENANCE_OUTPUT} does not match tooling/ludusavi/provenance.json`,
    );
    generated = null;
  }
  for (const target of targets) {
    const name = sidecarFileName(target);
    const file = path.join(outputDir, name);
    const entry = generated?.binaries?.[target];
    if (!existsSync(file)) {
      problems.push(`${name} is missing`);
    } else if (!entry || entry.file !== name || !HEX64.test(entry.sha256)) {
      problems.push(`${name} has no generated provenance entry`);
    } else if (sha256(readFileSync(file)) !== entry.sha256) {
      problems.push(`${name} does not match its generated provenance`);
    }
  }
  for (const name of [NOTICES_OUTPUT, LICENSE_OUTPUT]) {
    const file = path.join(outputDir, name);
    if (!existsSync(file) || statSync(file).size === 0) {
      problems.push(`${name} is missing`);
    }
  }
  return problems;
}

// ── Arguments ───────────────────────────────────────────────────────────────

export function parseArgs(argv) {
  const options = {
    targets: [],
    force: false,
    verify: false,
    checkPins: false,
    upstreamTests: false,
    allowTestRegistryChanges: false,
    outputDir: DEFAULT_OUTPUT_DIR,
    targetDir: DEFAULT_TARGET_DIR,
  };
  const flags = {
    "--force": "force",
    "--verify": "verify",
    "--check-pins": "checkPins",
    "--upstream-tests": "upstreamTests",
    "--allow-test-registry-changes": "allowTestRegistryChanges",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (flags[arg]) options[flags[arg]] = true;
    else if (arg === "--target" || arg === "--out" || arg === "--target-dir") {
      const value = (argv[index + 1] ?? "").trim();
      index += 1;
      if (arg === "--out") options.outputDir = path.resolve(value);
      else if (arg === "--target-dir") options.targetDir = path.resolve(value);
      // An empty `--target ""` (CI matrix without a cross target) means the host.
      else if (value) options.targets.push(value);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (options.targets.length > 1 && !options.verify) {
    throw new Error("Build one target per invocation.");
  }
  return options;
}

// ── Build steps ─────────────────────────────────────────────────────────────

async function download(url) {
  if (!url.startsWith("https://"))
    throw new Error(`HTTPS URL required: ${url}`);
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`Download failed (${response.status}): ${url}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

function run(command, args, options = {}) {
  console.log(`> ${command} ${args.join(" ")}`);
  execFileSync(command, args, { stdio: "inherit", ...options });
}

export async function prepareSource(work, provenance, lockfile, patches) {
  console.log(
    `Downloading pinned Ludusavi source (${provenance.source.commit}) …`,
  );
  const archive = await download(provenance.source.archive_url);
  assertSha256(
    archive,
    provenance.source.archive_sha256,
    "Ludusavi source archive",
  );
  extractAll("source.zip", archive, path.join(work, "source"));
  const sourceDir = path.join(work, "source", `ludusavi-${provenance.version}`);
  if (!existsSync(path.join(sourceDir, "Cargo.toml"))) {
    throw new Error("Unexpected source archive layout.");
  }
  for (const vendor of provenance.vendor_sources ?? []) {
    const crate = await download(vendor.archive_url);
    assertSha256(
      crate,
      vendor.archive_sha256,
      `${vendor.name} ${vendor.version} crate`,
    );
    extractAll(`${vendor.name}.crate`, crate, path.join(sourceDir, "vendor"));
  }
  applyPatches(sourceDir, patches);
  writeFileSync(path.join(sourceDir, "Cargo.lock"), lockfile);
  return sourceDir;
}

async function auditLockfile(work, provenance, lockfilePath) {
  const host = `${process.platform}-${process.arch}`;
  const hostTargets = {
    "win32-x64": "x86_64-pc-windows-msvc",
    "linux-x64": "x86_64-unknown-linux-gnu",
    "darwin-arm64": "aarch64-apple-darwin",
    "darwin-x64": "x86_64-apple-darwin",
  };
  const asset = provenance.cargo_audit?.assets?.[hostTargets[host]];
  if (!asset) throw new Error(`No pinned cargo-audit build for ${host}.`);
  console.log(`Downloading cargo-audit ${provenance.cargo_audit.version} …`);
  const archive = await download(
    provenance.cargo_audit.release_url + asset.file,
  );
  assertSha256(archive, asset.sha256, asset.file);
  const executableName =
    process.platform === "win32" ? "cargo-audit.exe" : "cargo-audit";
  const entry = readArchive(asset.file, archive).filter(
    (candidate) => path.posix.basename(candidate.name) === executableName,
  );
  if (entry.length !== 1)
    throw new Error("Unexpected cargo-audit archive layout.");
  const auditor = path.join(work, "audit-tool", executableName);
  mkdirSync(path.dirname(auditor), { recursive: true });
  writeFileSync(auditor, entry[0].data);
  chmodSync(auditor, 0o755);
  const result = spawnSync(
    auditor,
    ["audit", "--file", lockfilePath, "--deny", "unsound", "--json"],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    throw new Error(
      `cargo-audit failed (exit ${result.status}): ${result.stderr}`,
    );
  }
  for (const warning of evaluateAudit(report))
    console.warn(`warning: ${warning}`);
  if (result.status !== 0) {
    throw new Error(
      `cargo-audit failed (exit ${result.status}): ${result.stderr}`,
    );
  }
  console.log(
    "Full lockfile security audit passed (no vulnerabilities, no unsoundness).",
  );
}

function prepareTestFixtures(sourceDir) {
  // The exact fixture preparation steps of upstream's CI.
  const fixture = path.join(sourceDir, "tests", "root3", "game5");
  if (process.platform === "win32") {
    run("reg", ["import", path.join(sourceDir, "tests", "ludusavi.reg")]);
    symlinkSync(
      path.join(fixture, "data"),
      path.join(fixture, "data-symlink"),
      "junction",
    );
  } else {
    symlinkSync("data", path.join(fixture, "data-symlink"));
  }
}

/** Runs the CLI like the app does, in an isolated sandbox. */
function smokeTest(binary, work, version) {
  const sandbox = path.join(work, "smoke");
  const configDir = path.join(sandbox, "config");
  const backup = path.join(sandbox, "backups");
  mkdirSync(configDir, { recursive: true });
  const titles = [
    "PlayStash security smoke",
    "--help",
    "--config=untrusted-title",
  ];
  const saves = titles.map((_, index) =>
    path.join(sandbox, `save-${index}.txt`),
  );
  saves.forEach((save, index) =>
    writeFileSync(save, `original sandbox save ${index}`),
  );
  const config = {
    release: { check: false },
    manifest: { enable: false, secondary: [] },
    roots: [],
    backup: { path: backup },
    restore: { path: backup },
    cloud: { synchronize: false },
    customGames: titles.map((name, index) => ({
      name,
      integration: "override",
      files: [saves[index]],
      registry: [],
    })),
  };
  // JSON is valid YAML, so paths stay correctly escaped on every platform.
  writeFileSync(
    path.join(configDir, "config.yaml"),
    JSON.stringify(config, null, 2),
  );
  writeFileSync(path.join(configDir, "manifest.yaml"), "{}");
  const cli = (args) =>
    execFileSync(binary, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });

  const reported = cli(["--version"]).trim();
  if (reported !== `ludusavi ${version}`) {
    throw new Error(`Unexpected CLI version: ${reported}`);
  }
  const base = ["--config", configDir, "--no-manifest-update"];
  titles.forEach((title, index) => {
    const found = JSON.parse(
      cli([...base, "find", "--fuzzy", "--api", "--", title]),
    );
    if (!Object.hasOwn(found.games ?? {}, title)) {
      throw new Error(
        "The literal sandbox title was not found in API results.",
      );
    }
    JSON.parse(
      cli([
        ...base,
        "backup",
        "--force",
        "--format",
        "zip",
        "--path",
        backup,
        "--api",
        "--no-cloud-sync",
        "--",
        title,
      ]),
    );
    const zips = readdirSync(backup, { recursive: true }).filter((name) =>
      String(name).endsWith(".zip"),
    );
    if (!zips.length) throw new Error("No sandbox ZIP backup was produced.");
    writeFileSync(saves[index], "changed sandbox save");
    JSON.parse(
      cli([
        ...base,
        "restore",
        "--force",
        "--path",
        backup,
        "--api",
        "--no-cloud-sync",
        "--",
        title,
      ]),
    );
    if (
      readFileSync(saves[index], "utf8") !== `original sandbox save ${index}`
    ) {
      throw new Error(
        "The backup/restore roundtrip changed the original save.",
      );
    }
  });
  console.log(
    "CLI smoke passed: version, literal option-like titles, custom lookup, ZIP backup, exact restore.",
  );
}

function generateNotices(sourceDir, cargo, env, provenance) {
  const metadata = JSON.parse(
    execFileSync(
      cargo[0],
      [...cargo.slice(1), "metadata", "--locked", "--format-version", "1"],
      {
        cwd: sourceDir,
        env,
        encoding: "utf8",
        maxBuffer: 256 * 1024 * 1024,
      },
    ),
  );
  const header = [
    `Third-party notices for Ludusavi ${provenance.version} (${provenance.variant})`,
    "",
    `Built by PlayStash from ${provenance.source.repository} ${provenance.source.tag}`,
    `(commit ${provenance.source.commit}) with the security-patched dependency`,
    `lockfile ${provenance.lockfile_sha256}.`,
    "Ludusavi itself is MIT licensed; see LICENSE.txt next to this file.",
    "",
    "The following crates are compiled into Ludusavi for at least one supported",
    "platform. Each entry lists the crate's license expression and the license",
    "files distributed with it.",
  ].join("\n");
  return renderNotices(
    shippedPackages(metadata),
    readCrateLicenseFiles,
    header,
  );
}

function writeAtomically(file, data, mode) {
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.partial`;
  writeFileSync(temporary, data);
  if (mode) chmodSync(temporary, mode);
  renameSync(temporary, file);
}

function readJsonOrNull(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

async function build(target, options, tooling) {
  const { provenance, lockfile, patches } = tooling;
  const spec = TARGET_SPECS[target];
  const host = `${process.platform}-${process.arch}`;
  if (!spec.hosts.includes(process.platform)) {
    throw new Error(
      `Building Ludusavi for ${target} needs a ${spec.hosts.join("/")} host.`,
    );
  }
  if (!spec.runsOn.includes(host)) {
    throw new Error(`The ${target} build cannot be smoke-tested on ${host}.`);
  }
  if (
    options.upstreamTests &&
    process.platform === "win32" &&
    process.env.GITHUB_ACTIONS !== "true" &&
    !options.allowTestRegistryChanges
  ) {
    throw new Error(
      "Upstream tests write HKCU\\Software\\Ludusavi fixtures. Use CI, or a disposable Windows account with --allow-test-registry-changes.",
    );
  }

  const output = path.join(options.outputDir, sidecarFileName(target));
  if (
    !options.force &&
    verifyOutputs(options.outputDir, [target], provenance).length === 0
  ) {
    console.log(
      `Ludusavi ${provenance.version} (${provenance.variant}) for ${target} is up to date.`,
    );
    return;
  }
  const committedLicense = path.join(DEFAULT_OUTPUT_DIR, LICENSE_OUTPUT);
  if (!existsSync(committedLicense)) {
    throw new Error(`${LICENSE_OUTPUT} is missing from ${DEFAULT_OUTPUT_DIR}.`);
  }

  const toolchain = provenance.rust_toolchain;
  run("rustup", [
    "toolchain",
    "install",
    toolchain,
    "--profile",
    "minimal",
    "--target",
    target,
  ]);
  const rustc = execFileSync("rustc", [`+${toolchain}`, "--version"], {
    encoding: "utf8",
  });
  if (!rustc.startsWith(`rustc ${toolchain} `)) {
    throw new Error(`Unexpected Rust compiler version: ${rustc.trim()}`);
  }

  const work = mkdtempSync(path.join(tmpdir(), "playstash-ludusavi-"));
  try {
    const sourceDir = await prepareSource(work, provenance, lockfile, patches);
    const upstreamLicense = readFileSync(
      path.join(sourceDir, "LICENSE"),
      "utf8",
    );
    const normalize = (text) => text.replace(/\r\n?/g, "\n").trimEnd();
    if (
      normalize(readFileSync(committedLicense, "utf8")) !==
      normalize(upstreamLicense)
    ) {
      throw new Error(
        `${LICENSE_OUTPUT} differs from the pinned upstream LICENSE.`,
      );
    }
    await auditLockfile(work, provenance, path.join(sourceDir, "Cargo.lock"));

    const cargo = ["cargo", `+${toolchain}`];
    const env = {
      ...process.env,
      CARGO_TARGET_DIR: options.targetDir,
      LUDUSAVI_VERSION: provenance.version,
      LUDUSAVI_VARIANT: provenance.variant,
    };
    // Make sure no toolchain file or override of the caller leaks in.
    delete env.RUSTUP_TOOLCHAIN;
    if (options.upstreamTests) {
      prepareTestFixtures(sourceDir);
      run(
        cargo[0],
        [...cargo.slice(1), "test", "--locked", "--target", target],
        {
          cwd: sourceDir,
          env,
        },
      );
    }
    run(
      cargo[0],
      [...cargo.slice(1), "build", "--locked", "--release", "--target", target],
      {
        cwd: sourceDir,
        env,
      },
    );
    const built = path.join(
      options.targetDir,
      target,
      "release",
      process.platform === "win32" ? "ludusavi.exe" : "ludusavi",
    );
    const binary = readFileSync(built);
    assertExecutableForTarget(binary, target);
    smokeTest(built, work, provenance.version);
    const notices = generateNotices(sourceDir, cargo, env, provenance);

    // Export only after audit, (tests,) build, format check and smoke succeed.
    const binarySha256 = sha256(binary);
    writeAtomically(output, binary, 0o755);
    writeAtomically(path.join(options.outputDir, NOTICES_OUTPUT), notices);
    const license = path.join(options.outputDir, LICENSE_OUTPUT);
    if (path.resolve(license) !== path.resolve(committedLicense)) {
      writeAtomically(license, readFileSync(committedLicense));
    }
    const provenanceFile = path.join(options.outputDir, PROVENANCE_OUTPUT);
    const merged = mergeProvenance(
      readJsonOrNull(provenanceFile),
      provenance,
      target,
      binarySha256,
    );
    writeAtomically(provenanceFile, `${JSON.stringify(merged, null, 2)}\n`);
    console.log(
      `Wrote ${path.relative(repoRoot, output)}: Ludusavi ${provenance.version} (${provenance.variant}), sha256 ${binarySha256}.`,
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const tooling = loadVerifiedTooling();
  const { provenance } = tooling;
  if (options.checkPins) {
    console.log(
      `Ludusavi tooling pins verified (lockfile ${provenance.lockfile_sha256}, ${provenance.patches.length} patches).`,
    );
    return;
  }
  let targets = options.targets;
  if (!targets.length) {
    targets = [
      parseRustcHost(execFileSync("rustc", ["-vV"], { encoding: "utf8" })),
    ];
  }
  for (const target of targets) {
    if (!provenance.targets.includes(target) || !TARGET_SPECS[target]) {
      throw new Error(
        `No pinned Ludusavi build for ${target}. Supported: ${provenance.targets.join(", ")}.`,
      );
    }
  }
  if (options.verify) {
    const problems = verifyOutputs(options.outputDir, targets, provenance);
    if (problems.length) throw new Error(problems.join("\n"));
    console.log(
      `Verified Ludusavi ${provenance.version} (${provenance.variant}) for ${targets.join(", ")}.`,
    );
    return;
  }
  await build(targets[0], options, tooling);
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
