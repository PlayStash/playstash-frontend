# PlayStash Web Frontend

React 19 + Vite + Tailwind (v4) powered frontend for the PlayStash platform.

## Tech Stack

- PNPM
- React
- TypeScript
- Vite
- Tailwind CSS, Tailwind UI-Kit & Tailwind Components
- Tauri
- React Router

## Setup

`pnpm install`

The generated TypeScript API models come from the bundled `api-spec/playstash.openapi.json` schema. To regenerate against your own PlayStash backend, set `PLAYSTASH_API_SPEC_URL` to its `/api/docs-json` endpoint or `PLAYSTASH_API_SPEC_PATH` to an exported local JSON/YAML schema, then run `pnpm api:generate`. Generation requires Java 11 or newer. Local paths take priority over URLs; the same schema content is used for hashing and generation.

All PlayStash features are available without a subscription. Administrative actions still require the appropriate server role.

This is a fresh PlayStash installation: desktop application data, downloaded games, metadata files, browser settings and caches use PlayStash identifiers.

See `LICENSE` and `NOTICE`; third-party notices are preserved.

## Scripts

- dev/start: Run local development server
- build: Production build
- preview: Preview production build locally
- lint: Run ESLint

## Notes

The project was migrated from a basic Vite template; most custom styling now relies on Tailwind utilities with a small set of extended theme tokens.

## Authentication Integration

The UI has been reconnected to the original authentication and user management logic:

- `AuthProvider` (`src/context/AuthProvider.tsx`) handles login, token refresh, persistence, and exposes `authFetch` for authorized requests.
- `Login` component now performs real login against a PlayStash backend and redirects to `/library` on success.
- Route guards in `src/main.tsx` prevent unauthenticated access to dashboard pages and redirect authenticated users away from the login screen.
- Admin Users page (`src/pages/Administration.tsx`) fetches real users and supports activation toggling, role changes, deletion and recovery through `useAdminUsers` (`src/hooks/useAdminUsers.ts`).

Persistence keys:

- `app_refresh_token` (refresh token)
- `app_server_url` (last used server base URL)

## Dev Autologin

Create `playstash-frontend/.env.local` for dev-only automatic basic login:

```env
VITE_DEV_AUTOLOGIN=true
VITE_DEV_AUTOLOGIN_SERVER=http://localhost:8080
VITE_DEV_AUTOLOGIN_USERNAME=devuser
VITE_DEV_AUTOLOGIN_PASSWORD=devpassword
```

- `.env.local` stays local because `*.local` already ignored.
- Autologin runs only in Vite dev mode and only when no refresh token exists yet.
- Login page reuses stored server URL, so failed refresh or failed dev autologin still lands on right server.
- Restart `pnpm dev` after changing env file.

Uncheck "Remember me" on login if you want the refresh token removed right after authenticating (session-only access token).

If backend endpoints change, update the paths in `AuthContext` and the admin hook.

Analytics is disabled unless both `VITE_PLAYSTASH_ANALYTICS_PROJECT_ID` and `VITE_PLAYSTASH_ANALYTICS_API_URL` are configured for your own installation. Product news is bundled from this repository's changelog; server news continues to come from the connected PlayStash backend.

## GitHub Actions

GitHub-hosted tests, builds, installers and releases run automatically for their configured pull requests, branch pushes, version tags and manual runs. All current jobs use GitHub-hosted runners.

Any future job on a self-hosted runner must require `vars.PLAYSTASH_RUN_SELF_HOSTED == 'true'`, combined with its existing job conditions. Under **Settings → Secrets and variables → Actions → Variables**, leave `PLAYSTASH_RUN_SELF_HOSTED` unset or set it to `false` by default to block those jobs on your own servers. Set it to `true` only when deliberately enabling self-hosted execution. This repository currently defines no self-hosted jobs.

Optional integrations use your own accounts: enable Discord release notices with `PLAYSTASH_DISCORD_NOTIFICATIONS=true` and the `DISCORD_RELEASE_BOT_WEBHOOK` secret. SonarCloud scans run only when `PLAYSTASH_SONAR_PROJECT_KEY`, `PLAYSTASH_SONAR_ORGANIZATION` and the `SONAR_TOKEN` secret are configured.

## Separate frontend runtime

The frontend repository builds and publishes its own image at **`ghcr.io/playstash/playstash-frontend`**. The frontend and backend source repositories and releases are public. The backend consumes this image and does not build or bundle the frontend. Images support Linux AMD64 and ARM64 and contain Nginx and the web assets, without the backend or Node.js.

| Tag                      | Meaning                                                                         |
| ------------------------ | ------------------------------------------------------------------------------- |
| `latest`                 | Checked current `main` source                                                   |
| `dev`                    | Checked current `dev` source                                                    |
| `v17.3.2`                | First successful stable publication of that frontend version; never overwritten |
| `sha-<full Git SHA>`     | Stable source build                                                             |
| `dev-sha-<full Git SHA>` | Development source build, kept separate even when both branches share a commit  |

Use `ghcr.io/playstash/playstash-frontend@sha256:<index digest>` to pin the exact multi-platform content. Source commits and frontend versions are recorded as OCI labels; a container build does not claim that a desktop release has already been published.

The independent **Frontend container** workflow (`.github/workflows/container.yml`) runs automatically on `main`/`dev` pushes, matching `v<package.json version>` tags and manual runs. It checks the committed API schema and frozen dependency graph, dependency advisories, typechecking, ESLint and web tests, then builds the web assets once from that exact checkout. Each native architecture builds a digest-only candidate and tests its real read-only runtime, SPA/assets, credential forwarding, WebSockets, streaming/ranges and trusted-proxy policy. Checksum-verified Trivy scans every severity (`UNKNOWN,LOW,MEDIUM,HIGH,CRITICAL`) without ignore files or ignored unfixed findings. Scanner/network errors stop publication. Reports remain Actions artifacts.

Only after both architectures pass does publication assemble and verify their index, source/version/license labels, anonymous registry access and actual anonymous pulls for both architectures. It then creates missing version tags and promotes `latest`/`dev`. Existing version tags are preserved. Before changing a mutable channel, it verifies the current branch head through GitHub; older tag/manual/queued builds cannot downgrade a channel. Candidate tags named `build-<run>-<attempt>` are not release channels. Installer workflows remain independent and automatic, with their existing desktop/native tests.

**One-time GHCR setup:** GitHub initially creates a new package as private. After the first digest candidates exist, a package administrator must set **Package settings → Change visibility → Public** for `playstash-frontend`, then rerun the container workflow. Until anonymous pulls pass, no release channel is promoted. The source repository can remain private. Publication uses the workflow's `GITHUB_TOKEN` with package-write access; deployment servers receive no token and pull the public image anonymously.

`Dockerfile.runtime` serves an already-built `dist/`. Its prepared context contains `dist/`, `Dockerfile.runtime`, `nginx.runtime.conf`, `start-runtime.sh`, `LICENSE`, `NOTICE.txt` and `provenance.json`. The image preserves the license, the notice from `NOTICE` and commit-based asset-hash provenance under `/opt/playstash/frontend/`; the full third-party license catalog is also preserved as `/usr/share/nginx/html/THIRD-PARTY-LICENSES.json`. OCI build provenance and SBOM attestations are attached to the image.

For a local source build, use a fresh context directory after the normal frozen install and web build:

```sh
pnpm install --frozen-lockfile --strict-peer-dependencies
pnpm build
export GITHUB_SHA="$(git rev-parse HEAD)" GITHUB_REF=refs/heads/dev
node scripts/container-release.mjs context container-context
docker build -f container-context/Dockerfile.runtime \
  --build-arg FRONTEND_VERSION="$(node -p 'JSON.parse(require("fs").readFileSync("package.json")).version')" \
  --build-arg FRONTEND_REVISION="$GITHUB_SHA" \
  --build-arg SECURITY_REFRESH="$(date +%s)" \
  -t playstash-frontend:local container-context
```

The previous default Dockerfile is retired; the prepared runtime recipe is the supported container build path. Local uncommitted source changes are review builds, not proof of a published commit.

The image publisher passes a fresh `SECURITY_REFRESH` build argument on every run so Alpine security updates are not skipped by a cached Docker layer. The frontend CSP blocks remote scripts and unsafe evaluation while permitting its existing Inter stylesheet/fonts at `rsms.me`; browsers contact that font host independently of analytics. API documentation and OAuth responses retain the backend CSP and cache policy.

Run it as UID/GID `101:101`, with a read-only filesystem and writable `/tmp` tmpfs (mode `1777`). It listens on `8080`; `/healthz` checks Nginx. The backend must be reachable as `playstash-backend:8080` on the same private container network. `/api/` and `/socket.io/` retain their paths and query strings; uploads and downloads stream without proxy disk buffering, including range downloads and WebSockets. Docker DNS is refreshed when the backend container is replaced. `pnpm test:runtime` builds and checks this runtime against an isolated fixture after `pnpm build`.

For an outer HTTPS reverse proxy, set `PLAYSTASH_TRUSTED_PROXY_CIDRS` to its explicit peer IP addresses/CIDRs, separated by spaces. The proxy must overwrite `Host`, `X-Forwarded-Proto` and `X-Forwarded-For` with the public authority, scheme and actual client address. The default trusts no forwarded client IPs or schemes. Do not use `0.0.0.0/0` or `::/0`: untrusted clients could then forge these headers. Request logs omit query strings and credentials; TLS certificates and HTTPS redirect/HSTS policy belong to the outer proxy.

## Desktop Auto-Updates

The desktop app (Tauri) updates itself from GitHub Releases.

**Channels** – switchable in **Settings → Desktop → Update channel**:

| Channel    | Branch | Feed                                       |
| ---------- | ------ | ------------------------------------------ |
| `stable`   | `main` | `releases/latest/download/latest.json`     |
| `unstable` | `dev`  | `releases/download/unstable/unstable.json` |

The choice is persisted in `localStorage` (`playstash_update_channel`).

**How it works** – on startup or via `Check for updates`, the frontend calls the Tauri updater through Rust commands in `src-tauri/src/lib.rs`. The app confirms with the user, downloads, verifies the signature, and installs. If the feed is not published yet, it falls back to the GitHub release page.

**Versioning** – stable uses the plain `package.json`/`Cargo.toml` version. Unstable builds get a CI-generated unique version `17.2.3-unstable.<run>.<attempt>` (same semver core, only the `unstable` suffix bumps), injected into both the web and Rust builds and into the feed.

The [17.2.1 security audit](docs/security-audit.md) records dependency repairs, credential and installation hardening, the GLib source backport, and remaining maintenance warnings.

**CI** – pushes to `main` and matching `v*` version tags build Windows x64, Linux x64, and macOS ARM64/Intel installers with the official Tauri action. Every build uploads its installers as Actions artifacts. A new package version prepares a draft release; the complete platform matrix and updater feeds must succeed before publication. Published version assets are immutable: subsequent pushes with the same version produce Actions artifacts, without replacing the release. Bump `package.json` and Cargo versions for the next stable publication. A pushed tag must match `v<package version>`. Signed updater artifacts (`.exe`+`.sig`, `.app.tar.gz`+`.sig`, `.AppImage`+`.sig`) are merged into `updater-channels.json` and `latest.json` / `unstable.json`. Linux `.deb` packages are also published for manual installation; Debian packages do not use the AppImage updater. Dev builds upload to a unique draft first. The complete matrix publishes that immutable build and then promotes the `unstable` channel, replacing its feed last. Existing channel data is read with authenticated GitHub API calls, preserving each channel from its published release. Stale `unstable` shortcut assets are cleaned up only after successful publication.

**Private repositories** – workflow installers and releases can be downloaded by signed-in GitHub users with repository access. The desktop updater requests GitHub feeds anonymously, so automatic updates require publicly accessible release hosting. Private release URLs return an unavailable feed; install downloaded releases manually while the repository remains private. No GitHub access token is embedded in the app, its updater configuration or its distributable files.

**Required GitHub config** – under **Settings → Secrets and variables → Actions**:

- Variable `PLAYSTASH_TAURI_UPDATER_PUBKEY` (public key content)
- Secret `TAURI_SIGNING_PRIVATE_KEY` (private key content)
- Secret `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (optional)

For Debian release packages, set `PLAYSTASH_DEBIAN_MAINTAINER` to `Name <email>` when generating a new changelog entry. Its default `PlayStash Maintainers <maintainers@playstash.invalid>` is a reserved placeholder, not a contact address.

Generate the keys once with `cargo tauri signer generate -w ~/.tauri/playstash-updater.key`. Keep the private key and password safe — losing them breaks updates for existing installs.

**Local builds** – a normal `tauri build` produces no updater artifacts. To create them locally, build with the release config and signing env (`pnpm tauri build --config src-tauri/tauri.release.conf.json`). CI uses `src-tauri/tauri.release.generated.json` with the pubkey injected, since the Tauri bundler requires `plugins.updater.pubkey` in the parsed config.

**Cloud saves (Ludusavi)** – the desktop app bundles [Ludusavi](https://github.com/mtkennerly/ludusavi) v0.31.0 as a sidecar, built from source with the security-patched dependency lockfile shared with the Windows client (`tooling/ludusavi/`, see its README). No upstream release binary is used. Run `pnpm ludusavi:build` once (needs rustup, network access and the platform's C toolchain; on Linux also `libxcb-composite0-dev` and `libgtk-3-dev`) to verify the pins, audit the lockfile, compile the sidecar for the host target, smoke-test it and write it to `src-tauri/binaries/`. Pass `--target x86_64-apple-darwin` for the Intel macOS build on a Mac. Debug builds find the sidecar there; the release config (`src-tauri/tauri.release.conf.json`) bundles it with its MIT license, third-party notices generated from the patched dependency graph, and build provenance (`licenses/ludusavi/`), so release builds need the build step first. CI builds it per target with upstream's tests enabled.

Enable `SAVEFILES_ENABLED=true` on the backend and **Settings → Integrations → Cloud Saves → Sync cloud saves** in the desktop app. PlayStash restores before launch and backs up after the game exits while the app is running. Known save and configuration paths come from Ludusavi's primary manifest or your custom manifests.

Starting with 17.3.1, PlayStash also loads an existing `.ludusavi.yaml` directly from the selected game's actual installation folder, including `<Title>/Versions/<Version>/Installation/`. A manifest bundled with the game archive must end up in that installation folder. Its game name must match the title used by PlayStash; the normal confident title matching still applies. For example:

```yaml
My Game:
  files:
    <base>/saves:
      tags: [save]
    <base>/settings.json:
      tags: [config]
```

`<base>` refers to that game's installation folder. Only existing files are backed up. Automatically loaded game manifests must be regular files of at most 1 MiB; invalid definitions report a sync error. Local game manifests work alongside configured manifest paths/URLs, including when the primary manifest is disabled. This reads declared backup rules; PlayStash does not monitor arbitrary game file accesses or infer backup paths from executables. The browser does not scan local game folders.

**Linux AppImage media support** – `bundle.linux.appimage.bundleMediaFramework` is enabled, which makes the bundler copy the GStreamer plugins installed on the _build machine_ into the AppImage (they end up in `usr/lib/gstreamer-1.0`). A local AppImage build therefore needs `gstreamer1.0-plugins-base`, `gstreamer1.0-plugins-good` and `gstreamer1.0-plugins-bad` installed (the same packages CI installs); without them the AppImage ships without audio/video support and WebKitGTK logs `GStreamer element ... not found`.

Version 17.2 adds game packages/extras and optional ordered addons, shared archive passwords, system requirements and launch profiles, restricted-game controls, versioned saves, game requests/reviews and completed-action metrics. These features use the bundled PlayStash backend 17.1 API contract. Package recipes and local post-install scripts require explicit local selection; addons and save restores require overwrite confirmation.

**Library organization** – save local categories from tag and folder filters. Administrators can also define persistent automatic folder-tag rules in Administration; saving applies them to existing games, and later imports/reindexes reuse them.

**Controllers and chat** – Big Picture is available from the library heading or controller Start button, using the existing D-pad/stick navigation. Chat supports the lobby, game rooms and direct messages. Presence is published while the chat page is connected, with an Invisible option. Chat history is temporary (up to 24 hours and lost on server restart), and the server can disable the activity/chat gateway.

**Interface language** – Appearance settings provide device-default, English and German choices. See [language coverage and catalog maintenance](docs/languages.md); navigation and appearance controls are translated, while other pages and server content currently retain their source language.

See the [upstream issue implementation and validation record](docs/upstream-issue-status.md) for the six reviewed frontend reports and shared library features.
