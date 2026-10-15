import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
const script = path.resolve("scripts/build-tauri-updater-manifest.mjs");

test("the feed lists every signed installer with release notes and a publication date", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "playstash-feed-"));
  try {
    const metadata = path.join(root, "updater-metadata");
    await mkdir(metadata);
    await writeFile(
      path.join(metadata, "windows-x86_64.json"),
      JSON.stringify({
        osKey: "windows",
        arch: "x86_64",
        updaters: [
          {
            installer: "nsis",
            assetName: "PlayStash-windows-x64-17.3.0-setup.exe",
            signature: "nsis-sig",
          },
          {
            installer: "msi",
            assetName: "PlayStash-windows-x64-17.3.0.msi",
            signature: "msi-sig",
          },
        ],
      }),
    );
    await writeFile(
      path.join(root, "notes.md"),
      "### Changes\n- Added updates.\n",
    );
    execFileSync(
      process.execPath,
      [
        script,
        "17.3.0",
        metadata,
        path.join(root, "latest.json"),
        "PlayStash/playstash-frontend",
        "v17.3.0",
      ],
      {
        env: {
          ...process.env,
          PLAYSTASH_UPDATER_NOTES_FILE: path.join(root, "notes.md"),
          PLAYSTASH_BUILD_CHANNEL: "stable",
        },
      },
    );
    const feed = JSON.parse(
      await readFile(path.join(root, "latest.json"), "utf8"),
    );
    assert.equal(feed.version, "17.3.0");
    assert.equal(feed.notes, "### Changes\n- Added updates.");
    assert.ok(!Number.isNaN(Date.parse(feed.pub_date)));
    assert.deepEqual(Object.keys(feed.platforms).sort(), [
      "windows-x86_64",
      "windows-x86_64-msi",
      "windows-x86_64-nsis",
    ]);
    // Installs of unknown type fall back to the primary (NSIS) installer.
    assert.equal(
      feed.platforms["windows-x86_64"].url,
      "https://github.com/PlayStash/playstash-frontend/releases/download/v17.3.0/PlayStash-windows-x64-17.3.0-setup.exe",
    );
    assert.equal(feed.platforms["windows-x86_64-msi"].signature, "msi-sig");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
