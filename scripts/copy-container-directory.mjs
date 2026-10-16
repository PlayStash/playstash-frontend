import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmod, lstat, mkdir, readdir } from "node:fs/promises";
import path from "node:path";

const archiveLimit = 128 * 1024 * 1024;

async function writableFixture(filename) {
  const info = await lstat(filename);
  assert.ok(!info.isSymbolicLink(), "Runtime proof must not contain symlinks.");
  if (info.isDirectory()) {
    await chmod(filename, 0o700);
    for (const name of await readdir(filename))
      await writableFixture(path.join(filename, name));
  } else {
    assert.ok(info.isFile(), "Runtime proof must contain regular files.");
    await chmod(filename, 0o600);
  }
}

export async function extractContainerDirectory(archive, destination) {
  assert.ok(Buffer.isBuffer(archive) && archive.length <= archiveLimit);
  await mkdir(destination, { recursive: true });
  // tar defers directory permissions until contents are extracted. docker cp's
  // direct extraction makes a 0555 source directory unwritable before its files.
  execFileSync(
    "tar",
    ["-xf", "-", "--no-same-owner", "--no-same-permissions", "-C", destination],
    {
      input: archive,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 30_000,
    },
  );
  // Only the temporary host proof becomes writable for verification/cleanup;
  // the tested image and its read-only asset permissions remain unchanged.
  await writableFixture(destination);
}

export async function copyContainerDirectory(container, source, destination) {
  const archive = execFileSync(
    "docker",
    ["cp", `${container}:${source}/.`, "-"],
    {
      maxBuffer: archiveLimit,
      timeout: 30_000,
    },
  );
  await extractContainerDirectory(archive, destination);
}
