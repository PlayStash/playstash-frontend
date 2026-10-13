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

The original authors remain credited in the package metadata and license notices. The existing software license and third-party notices are preserved.

## Scripts

- dev/start: Run local development server
- build: Production build
- preview: Preview production build locally
- lint: Run ESLint

## Notes

The project was migrated from a basic Vite template; most custom styling now relies on Tailwind utilities with a small set of extended theme tokens.

## Authentication Integration

The UI has been reconnected to the original authentication and user management logic:

- `AuthProvider` (`src/context/AuthContext.tsx`) handles login, token refresh, persistence, and exposes `authFetch` for authorized requests.
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

All workflow jobs are disabled by default, including manual runs. Under **Settings → Secrets and variables → Actions → Variables**, the repository variable `PLAYSTASH_RUN_WORKFLOWS` must equal `true` to enable them. Leave it unset or set it to `false` to keep jobs disabled. Set it to `true` deliberately only after reviewing the build, release, signing and notification configuration; set it to `false` to disable future jobs again.

Optional integrations use your own accounts: enable Discord release notices with `PLAYSTASH_DISCORD_NOTIFICATIONS=true` and the `DISCORD_RELEASE_BOT_WEBHOOK` secret. SonarCloud scans run only when `PLAYSTASH_SONAR_PROJECT_KEY`, `PLAYSTASH_SONAR_ORGANIZATION` and the `SONAR_TOKEN` secret are configured.

## Desktop Auto-Updates

The desktop app (Tauri) updates itself from GitHub Releases.

**Channels** – switchable in **Settings → Desktop → Update channel**:

| Channel    | Branch    | Feed                                       |
| ---------- | --------- | ------------------------------------------ |
| `stable`   | `main`    | `releases/latest/download/latest.json`     |
| `unstable` | `dev`     | `releases/download/unstable/unstable.json` |

The choice is persisted in `localStorage` (`playstash_update_channel`).

**How it works** – on startup or via `Check for updates`, the frontend calls the Tauri updater through Rust commands in `src-tauri/src/lib.rs`. The app confirms with the user, downloads, verifies the signature, and installs. If the feed is not published yet, it falls back to the GitHub release page.

**Versioning** – stable uses the plain `package.json`/`Cargo.toml` version. Unstable builds get a CI-generated unique version `17.1.0-unstable.<run>.<attempt>` (same semver core, only the `unstable` suffix bumps), injected into both the web and Rust builds and into the feed.

**CI** – `.github/workflows/deploy.yml` builds signed updater artifacts per OS (`.exe`+`.sig`, `.app.tar.gz`+`.sig`, `.AppImage`+`.sig`), merges them into `updater-channels.json`, and derives `latest.json` / `unstable.json`. Stale `unstable` assets are cleaned up automatically.

**Required GitHub config** – under **Settings → Secrets and variables → Actions**:

- Variable `PLAYSTASH_TAURI_UPDATER_PUBKEY` (public key content)
- Secret `TAURI_SIGNING_PRIVATE_KEY` (private key content)
- Secret `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (optional)

For Debian release packages, set `PLAYSTASH_DEBIAN_MAINTAINER` to `Name <email>` when generating a new changelog entry. Its default `PlayStash Maintainers <maintainers@playstash.invalid>` is a reserved placeholder, not a contact address.

Generate the keys once with `cargo tauri signer generate -w ~/.tauri/playstash-updater.key`. Keep the private key and password safe — losing them breaks updates for existing installs.

**Local builds** – a normal `tauri build` produces no updater artifacts. To create them locally, build with the release config and signing env (`pnpm tauri build --config src-tauri/tauri.release.conf.json`). CI uses `src-tauri/tauri.release.generated.json` with the pubkey injected, since the Tauri bundler requires `plugins.updater.pubkey` in the parsed config.

**Linux AppImage media support** – `bundle.linux.appimage.bundleMediaFramework` is enabled, which makes the bundler copy the GStreamer plugins installed on the _build machine_ into the AppImage (they end up in `usr/lib/gstreamer-1.0`). A local AppImage build therefore needs `gstreamer1.0-plugins-base`, `gstreamer1.0-plugins-good` and `gstreamer1.0-plugins-bad` installed (the same packages CI installs); without them the AppImage ships without audio/video support and WebKitGTK logs `GStreamer element ... not found`.
