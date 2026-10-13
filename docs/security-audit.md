# Frontend security audit — 2026-10-13

Scope: PlayStash frontend 17.2.1, including production and development npm dependencies, the native Cargo lockfile, authentication and SSO, local credential persistence, archive/addon installation, script consent, native image networking, and signed updates. Container operating-system packages and backend authentication are covered separately by the repository owner.

## Dependency findings and repairs

The initial full pnpm audit reported 12 advisory records across nine packages (one critical, five high, five moderate and one low according to the registry). Targeted pnpm overrides select patched releases without broadly replacing the frontend toolchain. The final audit reports zero advisories across 731 dependency entries, including 473 development entries. These findings do not demonstrate that each vulnerable code path was reachable in this application; several belong only to build/API-generation/license tooling.

| Package                   | Selected version    | Primary advisory or upstream source                                                                                                                                                                                                                                                                                                     |
| ------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@dicebear/initials`      | 9.4.3               | [SVG option injection](https://github.com/dicebear/dicebear/security/advisories/GHSA-gcr2-9v8m-gq45)                                                                                                                                                                                                                                    |
| `esbuild`                 | 0.28.2 when present | [Windows development-server file disclosure](https://github.com/evanw/esbuild/security/advisories/GHSA-g7r4-m6w7-qqqr). The fresh lockfile also removes unused optional peer instances.                                                                                                                                                 |
| `ip-address`              | 10.7.4              | [Mixed-family subnet comparison](https://github.com/beaugunderson/ip-address/security/advisories/GHSA-j6r3-76f7-8jcv), [unbounded diagnostic](https://github.com/beaugunderson/ip-address/security/advisories/GHSA-h3mg-xc3c-68pw)                                                                                                      |
| `brace-expansion`         | 5.0.12              | [Quadratic expansion](https://github.com/juliangruber/brace-expansion/security/advisories/GHSA-q2hr-2g5m-vwhr), [nested recursion](https://github.com/juliangruber/brace-expansion/security/advisories/GHSA-qhr7-859c-m2p7), [comma recursion](https://github.com/juliangruber/brace-expansion/security/advisories/GHSA-6j4f-fj2g-mc7p) |
| `basic-ftp`               | 6.2.3               | [Directory-list parser denial of service](https://github.com/patrickjuchli/basic-ftp/security/advisories/GHSA-c475-qrg2-pj4r)                                                                                                                                                                                                           |
| `http-cache-semantics`    | 4.3.0               | [Maintainer response disputing GHSA-ch52-4w7c-c8xp](https://github.com/kornelski/http-cache-semantics/issues/56)                                                                                                                                                                                                                        |
| `source-map-js`           | 1.2.2               | [Upstream security release](https://github.com/7rulnik/source-map-js/releases/tag/v1.2.2)                                                                                                                                                                                                                                               |
| `postcss-selector-parser` | 7.1.6               | [Selector parsing denial of service](https://github.com/postcss/postcss-selector-parser/security/advisories/GHSA-rj75-hqrm-r3gf)                                                                                                                                                                                                        |
| `shell-quote`             | 1.12.0              | [Command-quoting injection](https://github.com/ljharb/shell-quote/security/advisories/GHSA-pqg4-j6r4-53mv)                                                                                                                                                                                                                              |

The `http-cache-semantics` report is disputed by its maintainer. Its affected range excludes the selected 4.3.0 release, so the registry no longer reports it. This audit does not assert an established cross-user disclosure in PlayStash or describe that update as a proven upstream security fix. The dependency is in license-generation tooling.

RustSec initially reported four vulnerabilities: three in `quinn-proto` 0.11.17 and one in `rustls` 0.23.44. The lockfile now selects `quinn-proto` 0.11.18 and `rustls` 0.23.45, covering [RUSTSEC-2026-0343](https://rustsec.org/advisories/RUSTSEC-2026-0343.html), [RUSTSEC-2026-0340](https://rustsec.org/advisories/RUSTSEC-2026-0340.html), [RUSTSEC-2026-0338](https://rustsec.org/advisories/RUSTSEC-2026-0338.html) and [RUSTSEC-2026-0285](https://rustsec.org/advisories/RUSTSEC-2026-0285.html).

GTK3/Tauri requires `glib` 0.18.5, while the upstream fix for [RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429.html) is published in the incompatible 0.20 line. `src-tauri/vendor/glib` preserves the original 0.18.5 crate and licenses, and backports the exact [upstream mutable C-output-pointer fix](https://github.com/gtk-rs/gtk-rs-core/pull/1343) to `VariantStrIter`. The root Cargo patch applies it to every GTK3 consumer. The version remains 0.18.5; it is not presented as a new upstream release. All 11 optimized upstream iterator tests pass. See [backport provenance](../src-tauri/vendor/glib/PLAYSTASH-PATCH.md).

Cargo audit reports zero vulnerabilities after these changes, with eight maintenance warnings below. A lockfile scanner cannot inspect a local path crate or certify the glib source patch: source review and the optimized iterator tests are separate evidence. No advisory IDs are ignored or suppressed. RustSec database: 1,310 entries, commit `6aed84668c23d7f535077a9fe918bf1fa0f6a5bc`.

The hosted security workflow runs the optimized GLib iterator regression separately from the lockfile audit, with GLib development prerequisites and a target directory under the runner's temporary directory. The standalone published crate has no committed lockfile; Cargo generates an ignored `vendor/glib/Cargo.lock` for these development tests without replacing the application's audited native lockfile.

## Application findings and repairs

- Native vault errors previously restored or persisted plaintext refresh tokens. Desktop failures now retain only an in-memory session and remove plaintext copies; a nonsecret blocked marker prevents stale encrypted sessions returning after a failed logout/write. Browser sessions still persist their refresh token in browser storage.
- Offline user caches previously included credentials and session records. Cache serialization strips passwords, API keys, access/refresh tokens and sessions recursively, including existing cached data. An offline session no longer substitutes its refresh token as an API bearer token.
- Authenticated fetching could attach credentials to an arbitrary destination. Requests now require the selected backend's HTTP(S) origin and API base path, reject URL credentials and disable redirects. Basic login, token refresh and native authenticated downloads also refuse redirects.
- The SSO popup listener previously checked only the origin. It now also requires the exact user-opened popup and consumes the handoff once. Redirect callbacks accept only fragment tokens with a same-tab initiator marker. Token-bearing URLs are scrubbed during login initialization before request effects run; query/path token callbacks are scrubbed and rejected.
- The vault-password helper had a predictable fallback when secure randomness failed, permissive creation timing, and unchecked existing secret files. It now fails closed on randomness errors, creates secrets exclusively with Unix owner-only permissions before writing, refuses symlinks/hardlinks or malformed existing secrets, and does not replace a malformed secret.
- Archive output paths for ISO and single-file formats bypassed the shared containment checks. All formats now use path checks; output-root/child symlinks are rejected and existing regular-file directory entries are detached before writing, protecting external hardlink targets. Regressions cover traversal, existing links and unchanged outside data.
- Native image fetching previously read unbounded network/local bodies. It now validates HTTP(S) URLs without embedded credentials, imposes a timeout and a 32 MiB streaming limit, and bounds eligible local image reads. The desktop CSP now blocks remote scripts and evaluation; configurable library HTTP(S)/WebSocket connections remain allowed. Tauri's build applies [script nonces/hashes](https://v2.tauri.app/security/csp/).

The existing addon implementation requires explicit overwrite confirmation, stages extraction, rejects links and special files, validates the complete destination plan, replaces file entries instead of following hardlinks, and never executes addon content. Package recipes and post-install scripts remain explicitly enabled local choices. Script arguments are passed as literal process arguments; archive contents cannot silently enable script execution. No additional confirmed consent or traversal defect was identified in that review.

Signed native updates use the PlayStash public key and Tauri signature verification. The private signing key stays in GitHub repository secrets, outside source/binaries. Release publication stages all matrix outputs before promotion and preserves immutable stable versions. Private GitHub assets remain inaccessible to anonymous installed clients: use authenticated manual downloads or publicly accessible update hosting. No GitHub token is embedded in the application.

## Remaining maintenance warnings and limits

These RustSec warnings remain visible and have no patched release in the currently required dependency lines:

| Dependency                 | Warning                                                                    |
| -------------------------- | -------------------------------------------------------------------------- |
| `bincode` 1.3.3            | [RUSTSEC-2025-0141](https://rustsec.org/advisories/RUSTSEC-2025-0141.html) |
| `paste` 1.0.15             | [RUSTSEC-2024-0436](https://rustsec.org/advisories/RUSTSEC-2024-0436.html) |
| `proc-macro-error` 1.0.4   | [RUSTSEC-2024-0370](https://rustsec.org/advisories/RUSTSEC-2024-0370.html) |
| `unic-char-property` 0.9.0 | [RUSTSEC-2025-0081](https://rustsec.org/advisories/RUSTSEC-2025-0081.html) |
| `unic-char-range` 0.9.0    | [RUSTSEC-2025-0075](https://rustsec.org/advisories/RUSTSEC-2025-0075.html) |
| `unic-common` 0.9.0        | [RUSTSEC-2025-0080](https://rustsec.org/advisories/RUSTSEC-2025-0080.html) |
| `unic-ucd-ident` 0.9.0     | [RUSTSEC-2025-0100](https://rustsec.org/advisories/RUSTSEC-2025-0100.html) |
| `unic-ucd-version` 0.9.0   | [RUSTSEC-2025-0098](https://rustsec.org/advisories/RUSTSEC-2025-0098.html) |

Replacing these requires upstream dependency-stack changes, rather than a fabricated patched version or broad ignore. Their maintenance status does not establish an exploitable vulnerability in this program.

This was a dependency scan and focused source review, not a penetration test or proof that every archive format is safe. In particular, the bundled unrar wrapper does not expose every redirection header; no dedicated malicious RAR fixture was available. Local concurrent filesystem attackers and compromised renderer code are outside the guarantees of the path checks and Stronghold auto-unlock design. The vault password is an owner-protected file, not an OS-keychain-backed secret. Browser storage remains readable by scripts executing in the trusted application origin. Configured HTTP library servers do not provide transport encryption; deploy behind HTTPS when credentials cross an untrusted network.

GitHub Dependabot alert enumeration was unavailable because the repository's alerts were disabled and the account lacked the required administration scope (HTTP 403). The audit therefore makes no claim of zero GitHub alerts. npm and RustSec scans were performed directly against the lockfiles, with network advisory lookup. Installed-platform/WebView/OS vulnerabilities require their own operating-system updates; Linux validation does not substitute for Windows/macOS execution.

## Validation

- Full pnpm 11.25.0 production/development audit: zero advisories.
- cargo-audit 0.22.2: zero vulnerabilities, eight visible maintenance warnings, no ignored IDs.
- Focused authentication, URL confinement, vault failure, SSO and administrator-request regressions: 37 tests passed.
- Vendored glib optimized iterator regression suite: 11 tests passed.
- Complete frontend suite: 344 tests passed in 52 files, plus 21 API-generation/release/desktop-launcher script tests.
- TypeScript, ESLint, production build, Actionlint and Git whitespace checks passed.
- Complete Linux native suite: `cargo test --locked --lib` passed all 57 tests in an isolated 17.2.1 source snapshot, including link containment, secret-file protections and bounded image streams.

The main hosted 17.2.0 workflow completed all four installer targets and publication. The corresponding development run failed on a request-status test that queried a conditionally rendered field too early. That test now waits for the actual field and PATCH request; the final full frontend suite passes. Publication of this 17.2.1 patch and Windows/macOS execution of its native changes still require the subsequent hosted workflow runs.

The repository formatter also treated the Linux Desktop Entry template as HTML and joined required records. The valid template was restored, excluded from formatting, and is covered by a regression that checks its records and the actual Prettier ignore configuration. Pure formatter changes were removed without discarding substantive fixes.

Reproduce the dependency scans with `pnpm audit --audit-level=low` and, from `src-tauri`, `cargo audit`. Verify the glib backport separately with `cargo test --manifest-path vendor/glib/Cargo.toml --release --lib variant_iter::tests`; the main native suite is `cargo test --locked --lib`. Frontend tests use `pnpm test`, followed by `pnpm typecheck`, `pnpm lint` and `pnpm build`.
