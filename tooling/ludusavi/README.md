# Patched Ludusavi build

The desktop app's cloud-save sidecar is built from official Ludusavi **v0.31.0**,
commit `8844d7b67e784909f4ef42f7bfb047b700fe7b15`, exactly like the Windows (WPF)
client's `tooling/ludusavi`. `provenance.json` pins the upstream source archive,
the replacement `Cargo.lock`, each manifest patch, the vendored cryoglyph crate,
the Rust toolchain (1.99.0), the supported targets and the official cargo-audit
release used for the audit. The executable reports version `0.31.0`; the build
variant is recorded as `PlayStash-security-2`. No upstream release binary is used
for any platform.

## Dependency patches

The original v0.31.0 lockfile contained 22 known vulnerabilities. The replacement
lockfile (`PlayStash-security-1`, shared with the WPF client) updates compatible
dependencies, including bytes, crossbeam-epoch, URL/IDNA, ring, Rustls/WebPKI,
Quinn, time, Tokio and memmap2. A rust_decimal update removes its obsolete
optional rkyv graph; the Wayland scanner update replaces affected quick-xml. The
only source adaptation is a manifest-only patch allowing cryoglyph 0.1.0 to use
patched lru 0.18.5 (`patches/*.json`); its original crate archive is downloaded
and checksum-verified, no third-party source body is rewritten.

`PlayStash-security-2` (patch revision `playstash-2`) additionally moves rustls
0.23.45 → 0.23.46 (only that package's version and checksum changed) for
RUSTSEC-2026-0346, -0347, -0348 and -0349, published on 2026-10-14. The WPF
client must adopt the same `Cargo.lock` (SHA-256
`3ee22e76d18d3244afe4960090de3c8301753d743f4644e835f35d6406f9297f`) to keep
both clients on an identical build; its own audit gate fails without it.

cargo-audit 0.22.2 checks the full lockfile. Eight maintenance advisories remain visible: instant
(RUSTSEC-2024-0384), number_prefix (2025-0119), paste (2024-0436),
proc-macro-error (2024-0370), rustls-pemfile (2025-0134), rustybuzz (2026-0206),
ttf-parser (2026-0192) and yaml-rust (2024-0320). Every build refreshes the
advisory database and fails on applicable vulnerabilities or unsoundness; future
findings need another reviewed lockfile and provenance update.

## Source-specific ZIP audit applicability

The 2026-10-17 review in `audit-applicability.json` covers only
RUSTSEC-2026-0367, RUSTSEC-2026-0368 and RUSTSEC-2026-0369 for the pinned
Ludusavi source and zip 0.6.6 dependency. The generic `ZipArchive::extract` and
`ZipStreamReader::extract` APIs have permission and symbolic-link findings.
Ludusavi never calls those APIs or restores ZIP permission/link metadata.
`restore_file_from_zip` (`src/scan/layout.rs:1822-1886`) uses `by_name`, opens a
regular destination, copies entry bytes with `std::io::copy`, and applies only
the modification timestamp. Registry entries are copied into memory; backup
validation only checks entry presence. `unix_permissions` is used only by the
backup writer. The destination readonly adjustment reads current filesystem
permissions rather than ZIP metadata.

The sidecar audit passes these three reviewed IDs to cargo-audit with `--ignore`.
Every other vulnerability and unsoundness finding remains fatal. These are
source applicability decisions, not a claim that zip 0.6.6 is fixed. The policy
must exactly match the source archive SHA-256, lockfile SHA-256, complete patch
list and hashes, and vendored source pins. Any change fails before downloading
or building and requires a fresh review. The policy is not shared with the
desktop app's separate native ZIP dependency or its security workflow.

## Building

```sh
pnpm ludusavi:build                                   # host target
node scripts/build-ludusavi.mjs --target x86_64-apple-darwin
node scripts/build-ludusavi.mjs --verify              # check existing outputs
node scripts/build-ludusavi.mjs --check-pins          # check lockfile/patch pins
```

`scripts/build-ludusavi.mjs` verifies the lockfile and patch checksums before
downloading anything, verifies the source and vendor archives, applies the
patches (each checks the original file's SHA-256), audits the complete lockfile,
optionally runs upstream's tests (`--upstream-tests`), builds with
`cargo build --locked --release --target <triple>` (default features, like
upstream and the WPF client), checks the executable format, and smoke-tests the
CLI in a sandbox (version, literal option-like titles, ZIP backup, exact
restore). Only then does it write to `src-tauri/binaries/`:

- `ludusavi-<triple>[.exe]` – the sidecar Tauri bundles (`externalBin`)
- `ludusavi-THIRD-PARTY.txt` – license texts of every crate compiled into
  Ludusavi on any supported platform, generated from the patched graph
- `ludusavi-provenance.json` – this provenance plus each built binary's SHA-256

Requirements: rustup (the script installs the pinned toolchain and target), the
platform C toolchain (Visual Studio C++ build tools on Windows, Xcode command
line tools on macOS), and on Linux `gcc libxcb-composite0-dev libgtk-3-dev`.
Each target is built on its own OS; Intel macOS can be built on Apple silicon
(the smoke test then runs through Rosetta 2). Build output is kept in
`src-tauri/target/ludusavi-build` (override with `--target-dir`).

Upstream's Windows tests import fixture values into `HKCU\Software\Ludusavi`, so
`--upstream-tests` on Windows requires CI or a disposable account with
`--allow-test-registry-changes`. CI (`deploy.yml`, `test.yml`) always runs them.
