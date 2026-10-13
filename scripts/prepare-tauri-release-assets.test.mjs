import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
const script = path.resolve("scripts/prepare-tauri-release-assets.mjs");
test("Linux publishes Debian files without requiring nonexistent Debian updater signatures", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "playstash-assets-"));
  try {
    const bundle = path.join(root, "src-tauri/target/release/bundle");
    await mkdir(path.join(bundle, "appimage"), { recursive: true });
    await mkdir(path.join(bundle, "deb"));
    await writeFile(
      path.join(root, "src-tauri/tauri.conf.json"),
      '{"productName":"PlayStash"}',
    );
    await writeFile(
      path.join(bundle, "appimage/PlayStash_17.2.0_amd64.AppImage"),
      "bundle",
    );
    await writeFile(
      path.join(bundle, "appimage/PlayStash_17.2.0_amd64.AppImage.sig"),
      "signature",
    );
    await writeFile(
      path.join(bundle, "deb/PlayStash_17.2.0_amd64.deb"),
      "package",
    );
    execFileSync(process.execPath, [script, "linux", "17.2.0"], {
      cwd: root,
      env: {
        ...process.env,
        PLAYSTASH_TARGET_ARCH: "x64",
        PLAYSTASH_TARGET_TRIPLE: "",
      },
    });
    const metadata = JSON.parse(
      await readFile(
        path.join(root, "updater-metadata/linux-x86_64.json"),
        "utf8",
      ),
    );
    assert.equal(metadata.updaters.length, 1);
    assert.equal(metadata.updaters[0].installer, "appimage");
    assert.ok(
      (await readdir(path.join(root, "release-assets/linux"))).includes(
        "PlayStash-linux-x64-17.2.0.deb",
      ),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("macOS cross-target paths and metadata keep ARM and Intel distinct", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "playstash-assets-"));
  try {
    await mkdir(path.join(root, "src-tauri"));
    await writeFile(
      path.join(root, "src-tauri/tauri.conf.json"),
      '{"productName":"PlayStash"}',
    );
    for (const [arch, triple, key] of [
      ["arm64", "aarch64-apple-darwin", "aarch64"],
      ["x64", "x86_64-apple-darwin", "x86_64"],
    ]) {
      const bundle = path.join(
        root,
        "src-tauri/target",
        triple,
        "release/bundle",
      );
      await mkdir(path.join(bundle, "macos"), { recursive: true });
      await mkdir(path.join(bundle, "dmg"));
      await writeFile(
        path.join(bundle, "macos/PlayStash.app.tar.gz"),
        "bundle",
      );
      await writeFile(
        path.join(bundle, "macos/PlayStash.app.tar.gz.sig"),
        "signature",
      );
      await writeFile(
        path.join(bundle, `dmg/PlayStash_17.2.0_${arch}.dmg`),
        "package",
      );
      execFileSync(process.execPath, [script, "macos", "17.2.0"], {
        cwd: root,
        env: {
          ...process.env,
          PLAYSTASH_TARGET_ARCH: arch,
          PLAYSTASH_TARGET_TRIPLE: triple,
        },
      });
      const metadata = JSON.parse(
        await readFile(
          path.join(root, `updater-metadata/macos-${key}.json`),
          "utf8",
        ),
      );
      assert.equal(metadata.arch, key);
      assert.ok(metadata.updaters[0].assetName.includes(`macos-${arch}`));
    }
    assert.equal(
      (await readdir(path.join(root, "updater-metadata"))).length,
      2,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
