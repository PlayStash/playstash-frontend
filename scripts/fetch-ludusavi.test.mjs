import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { deflateRawSync, gzipSync } from "node:zlib";
import {
  ALL_TARGETS,
  LEGAL_ASSET,
  RELEASE_TARGETS,
  SOURCE_ARCHIVE,
  assertSha256,
  extractMember,
  machOCpuType,
  parseArgs,
  parseRustcHost,
  readTar,
  readZip,
  safeJoin,
  sha256,
  sidecarFileName,
  verifyOutputs,
} from "./fetch-ludusavi.mjs";

const HEX64 = /^[0-9a-f]{64}$/;

test("pins every bundled target with SHA-256 checksums", () => {
  assert.deepEqual([...ALL_TARGETS].sort(), [
    "aarch64-apple-darwin",
    "x86_64-apple-darwin",
    "x86_64-pc-windows-msvc",
    "x86_64-unknown-linux-gnu",
  ]);
  for (const pin of Object.values(RELEASE_TARGETS)) {
    assert.match(pin.archiveSha256, HEX64);
    assert.match(pin.binarySha256, HEX64);
    assert.match(pin.asset, /^ludusavi-v0\.31\.0-/);
  }
  assert.match(LEGAL_ASSET.archiveSha256, HEX64);
  assert.match(LEGAL_ASSET.sha256, HEX64);
  assert.match(SOURCE_ARCHIVE.sha256, HEX64);
  assert.match(SOURCE_ARCHIVE.commit, /^[0-9a-f]{40}$/);
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

test("treats an empty --target as the host", () => {
  assert.deepEqual(parseArgs(["--target", ""]).targets, []);
  assert.deepEqual(parseArgs(["--target", "aarch64-apple-darwin"]).targets, [
    "aarch64-apple-darwin",
  ]);
  assert.equal(parseArgs(["--all", "--skip-source"]).skipSource, true);
  assert.throws(() => parseArgs(["--bogus"]));
});

test("rejects checksum mismatches", () => {
  const data = Buffer.from("ludusavi");
  assert.doesNotThrow(() => assertSha256(data, sha256(data), "data"));
  assert.throws(() => assertSha256(data, "0".repeat(64), "data"), /mismatch/);
});

function tarEntry(name, data) {
  const header = Buffer.alloc(512);
  header.write(name, 0, "utf8");
  header.write("0000755\0", 100);
  header.write(`${data.length.toString(8).padStart(11, "0")}\0`, 124);
  header.write("0", 156);
  const padding = Buffer.alloc((512 - (data.length % 512)) % 512);
  return Buffer.concat([header, data, padding]);
}

test("extracts a member from a tar.gz archive", () => {
  const archive = gzipSync(
    Buffer.concat([
      tarEntry("README", Buffer.from("readme")),
      tarEntry("ludusavi", Buffer.from("binary")),
      Buffer.alloc(1024),
    ]),
  );
  assert.equal(
    extractMember("x.tar.gz", archive, "ludusavi").toString(),
    "binary",
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
    { name: "ludusavi.exe", data: Buffer.from("x".repeat(500)), deflate: true },
  ]);
  assert.equal(readZip(archive).length, 2);
  assert.equal(
    extractMember("x.zip", archive, "ludusavi.exe").toString(),
    "x".repeat(500),
  );
  assert.throws(() => extractMember("x.zip", archive, "missing"), /missing/);
});

test("rejects archive traversal when unpacking the source", () => {
  const root = path.resolve("root");
  assert.equal(safeJoin(root, "a/b.rs"), path.join(root, "a", "b.rs"));
  for (const name of ["../evil", "a/../../evil", "/abs", "C:/x", "a\\b"]) {
    assert.throws(() => safeJoin(root, name), /Unsafe/);
  }
});

test("recognizes Intel macOS executables", () => {
  const header = Buffer.alloc(8);
  header.writeUInt32LE(0xfeedfacf, 0);
  header.writeUInt32LE(0x01000007, 4);
  assert.equal(machOCpuType(header), 0x01000007);
  assert.equal(machOCpuType(Buffer.from("MZ......")), null);
});

test("verify reports missing sidecars", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "ludusavi-verify-"));
  try {
    const problems = verifyOutputs(directory, ["x86_64-pc-windows-msvc"]);
    assert.equal(problems.length, 2);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
