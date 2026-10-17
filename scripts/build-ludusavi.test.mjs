import assert from "node:assert/strict";
import {
  cpSync,
  appendFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { deflateRawSync, gzipSync } from "node:zlib";
import {
  LICENSE_OUTPUT,
  NOTICES_OUTPUT,
  PROVENANCE_OUTPUT,
  TARGET_SPECS,
  TOOLING_DIR,
  applyPatchContent,
  applyPatches,
  assertExecutableForTarget,
  assertSha256,
  evaluateAudit,
  executableFormat,
  loadVerifiedTooling,
  ludusaviAuditIgnoreArgs,
  mergeProvenance,
  parseArgs,
  parseRustcHost,
  readArchive,
  readTar,
  readZip,
  renderNotices,
  safeJoin,
  sha256,
  shippedPackages,
  sidecarFileName,
  verifyOutputs,
} from "./build-ludusavi.mjs";

const HEX64 = /^[0-9a-f]{64}$/;

function withTempDir(callback) {
  const directory = mkdtempSync(path.join(tmpdir(), "ludusavi-test-"));
  try {
    return callback(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function copyTooling(directory) {
  const copy = path.join(directory, "tooling");
  cpSync(TOOLING_DIR, copy, { recursive: true });
  return copy;
}

test("pins the security-patched source shared with the Windows client", () => {
  const { provenance, patches } = loadVerifiedTooling();
  assert.equal(provenance.version, "0.31.0");
  assert.equal(provenance.variant, "PlayStash-security-2");
  assert.equal(provenance.patch_revision, "playstash-2");
  assert.equal(provenance.rust_toolchain, "1.99.0");
  assert.equal(
    provenance.source.commit,
    "8844d7b67e784909f4ef42f7bfb047b700fe7b15",
  );
  assert.equal(
    provenance.source.archive_sha256,
    "74d6458fe597000d7565722c3ec8d4d291bc3349d6bbf7f47bd528a272b0f1e5",
  );
  assert.equal(
    provenance.lockfile_sha256,
    "3ee22e76d18d3244afe4960090de3c8301753d743f4644e835f35d6406f9297f",
  );
  assert.equal(patches.length, 2);
  assert.deepEqual([...provenance.targets].sort(), [
    "aarch64-apple-darwin",
    "x86_64-apple-darwin",
    "x86_64-pc-windows-msvc",
    "x86_64-unknown-linux-gnu",
  ]);
  for (const target of provenance.targets) {
    assert.ok(TARGET_SPECS[target], target);
    assert.match(provenance.cargo_audit.assets[target].sha256, HEX64);
  }
});

test("rejects a changed lockfile before downloading anything", () => {
  withTempDir((directory) => {
    const tooling = copyTooling(directory);
    appendFileSync(path.join(tooling, "Cargo.lock"), "\n");
    assert.throws(
      () => loadVerifiedTooling(tooling),
      /Integrity verification failed/,
    );
  });
});

test("scopes ZIP audit applicability to the exact reviewed build inputs", () => {
  const { provenance, auditApplicabilityArgs } = loadVerifiedTooling();
  assert.deepEqual(auditApplicabilityArgs, [
    "--ignore",
    "RUSTSEC-2026-0367",
    "--ignore",
    "RUSTSEC-2026-0368",
    "--ignore",
    "RUSTSEC-2026-0369",
  ]);
  const changes = [
    (pins) => (pins.source.archive_sha256 = "a".repeat(64)),
    (pins) => (pins.lockfile_sha256 = "a".repeat(64)),
    (pins) => (pins.patches[0].sha256 = "a".repeat(64)),
    (pins) => (pins.patches[0].path = "patches/new.json"),
    (pins) => pins.patches.pop(),
    (pins) => pins.patches.push({ path: "new.json", sha256: "a".repeat(64) }),
    (pins) => (pins.vendor_sources[0].archive_sha256 = "a".repeat(64)),
  ];
  for (const change of changes) {
    const changed = structuredClone(provenance);
    change(changed);
    assert.throws(
      () => ludusaviAuditIgnoreArgs(changed),
      /applicability no longer matches/,
    );
  }
});

test("does not expand applicability to unrelated advisories or hide findings", () => {
  const { provenance } = loadVerifiedTooling();
  withTempDir((directory) => {
    const tooling = copyTooling(directory);
    const file = path.join(tooling, "audit-applicability.json");
    const review = JSON.parse(readFileSync(file, "utf8"));
    review.advisories.push({
      id: "RUSTSEC-2099-0001",
      reason: "Unreviewed finding",
      evidence: ["none"],
    });
    writeFileSync(file, JSON.stringify(review));
    assert.throws(
      () => ludusaviAuditIgnoreArgs(provenance, tooling),
      /applicability no longer matches/,
    );
  });
  assert.throws(
    () =>
      evaluateAudit({
        vulnerabilities: {
          count: 1,
          list: [{ advisory: { id: "RUSTSEC-2099-0001" } }],
        },
        warnings: {},
      }),
    /unresolved vulnerabilities/,
  );
});

test("rejects a changed patch before downloading anything", () => {
  withTempDir((directory) => {
    const tooling = copyTooling(directory);
    appendFileSync(path.join(tooling, "patches", "root-manifest.json"), " ");
    assert.throws(
      () => loadVerifiedTooling(tooling),
      /Integrity verification failed/,
    );
  });
});

test("rejects patch paths outside the tooling directory", () => {
  withTempDir((directory) => {
    const tooling = copyTooling(directory);
    const file = path.join(tooling, "provenance.json");
    const provenance = JSON.parse(readFileSync(file, "utf8"));
    provenance.patches[0].path = "../escape.json";
    writeFileSync(file, JSON.stringify(provenance));
    assert.throws(() => loadVerifiedTooling(tooling), /within the tooling/);
  });
});

test("applies manifest patches only to the pinned original files", () => {
  const replace = {
    entry: "x",
    operation: "replace",
    before: 'version = "0.16"',
    after: 'version = "0.18.2"',
  };
  assert.equal(
    applyPatchContent('[lru]\nversion = "0.16"\n', replace),
    '[lru]\nversion = "0.18.2"\n',
  );
  assert.throws(() => applyPatchContent("nothing", replace), /exactly once/);
  assert.throws(
    () => applyPatchContent('version = "0.16" version = "0.16"', replace),
    /exactly once/,
  );
  assert.equal(
    applyPatchContent("a", { operation: "append", content: "b" }),
    "ab",
  );
  assert.throws(() => applyPatchContent("a", { operation: "delete" }));

  withTempDir((directory) => {
    const file = path.join(directory, "Cargo.toml");
    writeFileSync(file, "[package]\n");
    const patch = {
      path: "Cargo.toml",
      operation: "append",
      content: "[patch]\n",
      before_sha256: sha256(Buffer.from("[package]\n")),
    };
    applyPatches(directory, [patch]);
    assert.equal(readFileSync(file, "utf8"), "[package]\n[patch]\n");
    // The file changed, so the same patch no longer matches its original.
    assert.throws(() => applyPatches(directory, [patch]), /Integrity/);
    assert.throws(
      () => applyPatches(directory, [{ ...patch, path: "../Cargo.toml" }]),
      /within the source/,
    );
  });
});

test("names sidecars the way Tauri expects", () => {
  assert.equal(
    sidecarFileName("x86_64-pc-windows-msvc"),
    "ludusavi-x86_64-pc-windows-msvc.exe",
  );
  assert.equal(
    sidecarFileName("aarch64-apple-darwin"),
    "ludusavi-aarch64-apple-darwin",
  );
});

test("reads the host triple from rustc", () => {
  assert.equal(
    parseRustcHost(
      "rustc 1.99.0\nbinary: rustc\nhost: x86_64-unknown-linux-gnu\n",
    ),
    "x86_64-unknown-linux-gnu",
  );
  assert.throws(() => parseRustcHost("rustc 1.99.0"));
});

test("parses arguments", () => {
  assert.deepEqual(parseArgs(["--target", ""]).targets, []);
  assert.deepEqual(parseArgs(["--target", "aarch64-apple-darwin"]).targets, [
    "aarch64-apple-darwin",
  ]);
  const options = parseArgs([
    "--upstream-tests",
    "--allow-test-registry-changes",
    "--target-dir",
    "t",
  ]);
  assert.equal(options.upstreamTests, true);
  assert.equal(options.allowTestRegistryChanges, true);
  assert.equal(options.targetDir, path.resolve("t"));
  assert.throws(
    () => parseArgs(["--target", "a", "--target", "b"]),
    /one target/,
  );
  assert.equal(
    parseArgs(["--verify", "--target", "a", "--target", "b"]).targets.length,
    2,
  );
  assert.throws(() => parseArgs(["--all"]));
});

test("rejects checksum mismatches", () => {
  const data = Buffer.from("ludusavi");
  assert.doesNotThrow(() => assertSha256(data, sha256(data), "data"));
  assert.throws(() => assertSha256(data, "0".repeat(64), "data"), /Integrity/);
  assert.throws(
    () => assertSha256(data, "not-a-hash", "data"),
    /Invalid pinned/,
  );
});

function tarEntry(name, data, type = "0") {
  const header = Buffer.alloc(512);
  header.write(name, 0, "utf8");
  header.write("0000755\0", 100);
  header.write(`${data.length.toString(8).padStart(11, "0")}\0`, 124);
  header.write(type, 156);
  const padding = Buffer.alloc((512 - (data.length % 512)) % 512);
  return Buffer.concat([header, data, padding]);
}

test("extracts crate and tar.gz archives", () => {
  const archive = gzipSync(
    Buffer.concat([
      tarEntry("cryoglyph-0.1.0/Cargo.toml", Buffer.from("[package]")),
      tarEntry("ignored", Buffer.from("19 path=long/name.rs\n"), "x"),
      tarEntry("short", Buffer.from("fn main() {}")),
      Buffer.alloc(1024),
    ]),
  );
  const entries = readArchive("cryoglyph.crate", archive);
  assert.deepEqual(
    entries.map((entry) => entry.name),
    ["cryoglyph-0.1.0/Cargo.toml", "long/name.rs"],
  );
  assert.equal(readTar(Buffer.alloc(1024)).length, 0);
});

function zipArchive(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data, deflate } of entries) {
    const body = deflate ? deflateRawSync(data) : data;
    const nameBuffer = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(deflate ? 8 : 0, 10);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuffer, body);
    centrals.push(central, nameBuffer);
    offset += local.length + nameBuffer.length + body.length;
  }
  const centralDirectory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralDirectory, end]);
}

test("extracts stored and deflated zip members", () => {
  const archive = zipArchive([
    { name: "notes.txt", data: Buffer.from("stored") },
    {
      name: "bin/cargo-audit.exe",
      data: Buffer.from("x".repeat(500)),
      deflate: true,
    },
  ]);
  const entries = readZip(archive);
  assert.equal(entries.length, 2);
  assert.equal(entries[1].data.toString(), "x".repeat(500));
  assert.throws(() => readArchive("x.rar", archive), /Unsupported/);
});

test("rejects archive traversal when unpacking the source", () => {
  const root = path.resolve("root");
  assert.equal(safeJoin(root, "a/b.rs"), path.join(root, "a", "b.rs"));
  for (const name of ["../evil", "a/../../evil", "/abs", "C:/x", "a\\b"]) {
    assert.throws(() => safeJoin(root, name), /Unsafe/);
  }
});

function peHeader(machine) {
  const buffer = Buffer.alloc(0x100);
  buffer.write("MZ", 0, "latin1");
  buffer.writeUInt32LE(0x80, 0x3c);
  buffer.writeUInt32LE(0x00004550, 0x80);
  buffer.writeUInt16LE(machine, 0x84);
  return buffer;
}

function elfHeader(machine) {
  const buffer = Buffer.alloc(0x40);
  buffer.writeUInt32BE(0x7f454c46, 0);
  buffer.writeUInt16LE(machine, 0x12);
  return buffer;
}

function machOHeader(cpu) {
  const buffer = Buffer.alloc(8);
  buffer.writeUInt32LE(0xfeedfacf, 0);
  buffer.writeUInt32LE(cpu, 4);
  return buffer;
}

test("checks the executable format of each target", () => {
  assert.deepEqual(executableFormat(peHeader(0x8664)), {
    format: "pe",
    machine: 0x8664,
  });
  assertExecutableForTarget(peHeader(0x8664), "x86_64-pc-windows-msvc");
  assertExecutableForTarget(elfHeader(0x3e), "x86_64-unknown-linux-gnu");
  assertExecutableForTarget(machOHeader(0x0100000c), "aarch64-apple-darwin");
  assertExecutableForTarget(machOHeader(0x01000007), "x86_64-apple-darwin");
  assert.throws(() =>
    assertExecutableForTarget(peHeader(0xaa64), "x86_64-pc-windows-msvc"),
  );
  assert.throws(() =>
    assertExecutableForTarget(machOHeader(0x01000007), "aarch64-apple-darwin"),
  );
  assert.throws(() =>
    assertExecutableForTarget(
      Buffer.from("#!/bin/sh"),
      "x86_64-unknown-linux-gnu",
    ),
  );
  assert.equal(executableFormat(Buffer.from("nothing")), null);
});

test("fails the audit on vulnerabilities and unsoundness only", () => {
  const clean = {
    vulnerabilities: { count: 0, list: [] },
    warnings: {
      unmaintained: [
        {
          advisory: { id: "RUSTSEC-2024-0384" },
          package: { name: "instant", version: "0.1.13" },
        },
      ],
    },
  };
  assert.deepEqual(evaluateAudit(clean), [
    "RUSTSEC-2024-0384: instant 0.1.13 is unmaintained.",
  ]);
  assert.throws(
    () => evaluateAudit({ ...clean, vulnerabilities: { count: 1 } }),
    /vulnerabilities/,
  );
  assert.throws(
    () => evaluateAudit({ ...clean, warnings: { unsound: [{}] } }),
    /unsoundness/,
  );
  assert.throws(() => evaluateAudit({}), /vulnerabilities/);
});

test("lists shipped crates for the notices, skipping dev-only dependencies", () => {
  const pkg = (name) => ({
    id: name,
    name,
    version: "1.0.0",
    license: "MIT",
    manifest_path: `/${name}/Cargo.toml`,
  });
  const metadata = {
    packages: ["root", "zeta", "alpha", "dev-only", "build-dep"].map(pkg),
    resolve: {
      root: "root",
      nodes: [
        {
          id: "root",
          deps: [
            { pkg: "zeta", dep_kinds: [{ kind: null }] },
            { pkg: "dev-only", dep_kinds: [{ kind: "dev" }] },
            { pkg: "build-dep", dep_kinds: [{ kind: "build" }] },
          ],
        },
        {
          id: "zeta",
          deps: [
            {
              pkg: "alpha",
              dep_kinds: [{ kind: null, target: "cfg(windows)" }],
            },
          ],
        },
      ],
    },
  };
  const shipped = shippedPackages(metadata);
  assert.deepEqual(
    shipped.map((entry) => entry.name),
    ["alpha", "build-dep", "zeta"],
  );
  const text = renderNotices(
    shipped,
    (entry) =>
      entry.name === "alpha" ? [{ name: "LICENSE", text: "MIT text\r\n" }] : [],
    "Header",
  );
  assert.match(text, /^Header\n/);
  assert.match(
    text,
    /alpha 1\.0\.0\nLicense: MIT\n\n--- LICENSE ---\nMIT text\n/,
  );
  assert.match(text, /zeta 1\.0\.0\nLicense: MIT\n\n\(No license file/);
  assert.ok(!text.includes("\r"));
});

test("records and verifies the built binaries against the pinned provenance", () => {
  const { provenance } = loadVerifiedTooling();
  withTempDir((directory) => {
    const target = "x86_64-unknown-linux-gnu";
    assert.equal(verifyOutputs(directory, [target], provenance).length, 4);

    const binary = elfHeader(0x3e);
    writeFileSync(path.join(directory, sidecarFileName(target)), binary);
    writeFileSync(path.join(directory, NOTICES_OUTPUT), "notices");
    writeFileSync(path.join(directory, LICENSE_OUTPUT), "license");
    let merged = mergeProvenance(null, provenance, target, sha256(binary));
    merged = mergeProvenance(
      merged,
      provenance,
      "aarch64-apple-darwin",
      "a".repeat(64),
    );
    assert.deepEqual(Object.keys(merged.binaries).sort(), [
      "aarch64-apple-darwin",
      target,
    ]);
    assert.equal(merged.binaries[target].variant, "PlayStash-security-2");
    writeFileSync(
      path.join(directory, PROVENANCE_OUTPUT),
      JSON.stringify(merged),
    );
    assert.deepEqual(verifyOutputs(directory, [target], provenance), []);

    // A replaced binary no longer matches its recorded SHA-256.
    writeFileSync(
      path.join(directory, sidecarFileName(target)),
      elfHeader(0x3e).fill(1, 0x20),
    );
    assert.match(
      verifyOutputs(directory, [target], provenance)[0],
      /does not match/,
    );

    // Provenance from a different source build is rejected and not merged.
    const other = { ...provenance, lockfile_sha256: "b".repeat(64) };
    assert.match(
      verifyOutputs(directory, [target], other)[0],
      /does not match tooling/,
    );
    assert.deepEqual(
      Object.keys(
        mergeProvenance(merged, other, target, "c".repeat(64)).binaries,
      ),
      [target],
    );
  });
});

test("keeps the committed upstream license next to the sidecars", () => {
  const license = readFileSync(
    path.join(TOOLING_DIR, "..", "..", "src-tauri", "binaries", LICENSE_OUTPUT),
    "utf8",
  );
  assert.match(license, /MIT License/);
  assert.match(license, /Matthew T\. Kennerly/);
});
