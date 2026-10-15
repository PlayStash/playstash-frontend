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
test("Windows publishes the signed MSI next to NSIS when it was built (stable)", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "playstash-assets-"));
  try {
    const bundle = path.join(root, "src-tauri/target/release/bundle");
    await mkdir(path.join(bundle, "nsis"), { recursive: true });
    await writeFile(
      path.join(root, "src-tauri/tauri.conf.json"),
      '{"productName":"PlayStash"}',
    );
    await writeFile(
      path.join(bundle, "nsis/PlayStash_17.3.0_x64-setup.exe"),
      "setup",
    );
    await writeFile(
      path.join(bundle, "nsis/PlayStash_17.3.0_x64-setup.exe.sig"),
      "nsis-signature",
    );
    const run = () =>
      execFileSync(process.execPath, [script, "windows", "17.3.0"], {
        cwd: root,
        env: {
          ...process.env,
          PLAYSTASH_TARGET_ARCH: "x64",
          PLAYSTASH_TARGET_TRIPLE: "",
        },
        stdio: "pipe",
      });
    const metadata = async () =>
      JSON.parse(
        await readFile(
          path.join(root, "updater-metadata/windows-x86_64.json"),
          "utf8",
        ),
      );

    // Unstable builds have no MSI: NSIS alone is enough.
    run();
    assert.deepEqual(
      (await metadata()).updaters.map((entry) => entry.installer),
      ["nsis"],
    );

    await mkdir(path.join(bundle, "msi"));
    await writeFile(
      path.join(bundle, "msi/PlayStash_17.3.0_x64_en-US.msi"),
      "msi",
    );
    await writeFile(
      path.join(bundle, "msi/PlayStash_17.3.0_x64_en-US.msi.sig"),
      "msi-signature",
    );
    run();
    const stable = await metadata();
    assert.deepEqual(
      stable.updaters.map((entry) => [entry.installer, entry.assetName]),
      [
        ["nsis", "PlayStash-windows-x64-17.3.0-setup.exe"],
        ["msi", "PlayStash-windows-x64-17.3.0.msi"],
      ],
    );
    assert.deepEqual(
      (await readdir(path.join(root, "release-assets/windows"))).sort(),
      [
        "PlayStash-windows-x64-17.3.0-setup.exe",
        "PlayStash-windows-x64-17.3.0-setup.exe.sig",
        "PlayStash-windows-x64-17.3.0.msi",
        "PlayStash-windows-x64-17.3.0.msi.sig",
      ],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("Linux publishes the RPM package with a structured name", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "playstash-assets-"));
  try {
    const bundle = path.join(root, "src-tauri/target/release/bundle");
    await mkdir(path.join(bundle, "appimage"), { recursive: true });
    await mkdir(path.join(bundle, "rpm"));
    await writeFile(
      path.join(root, "src-tauri/tauri.conf.json"),
      '{"productName":"PlayStash"}',
    );
    await writeFile(
      path.join(bundle, "appimage/playstash_17.3.0_amd64.AppImage"),
      "bundle",
    );
    await writeFile(
      path.join(bundle, "appimage/playstash_17.3.0_amd64.AppImage.sig"),
      "signature",
    );
    await writeFile(
      path.join(bundle, "rpm/playstash-17.3.0-1.x86_64.rpm"),
      "package",
    );
    execFileSync(process.execPath, [script, "linux", "17.3.0"], {
      cwd: root,
      env: {
        ...process.env,
        PLAYSTASH_TARGET_ARCH: "x64",
        PLAYSTASH_TARGET_TRIPLE: "",
      },
      stdio: "pipe",
    });
    assert.ok(
      (await readdir(path.join(root, "release-assets/linux"))).includes(
        "PlayStash-linux-x64-17.3.0.rpm",
      ),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
