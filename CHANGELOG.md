# PlayStash Frontend Changelog

## 17.3.0

Status: Unreleased.

### Changes

<!-- WP2 -->

- Community presence and activity now stay connected app-wide instead of only while the chat page is open, reconnect automatically after 5 seconds and show the connection status.
- Your community status (Online, Busy, Invisible) is remembered per account and server.
- Other players now see "PLAYING" with the game while you play in the desktop app, unless you are invisible.
- Added optional desktop notifications for new chat messages and for community activity changes (Settings → Community); messages in the conversation you are viewing are not announced.
- Added "Game Chat" on game pages and "Activity and Chat" on the community pages; chat links open the lobby, a game room or a direct message directly.
- The chat page shows an "Online Activity" list with user names and the titles of the games being played.
- Added Discord Rich Presence for the game you are playing, with your own Discord application ID (Settings → Integrations); it is cleared when the game ends, the option is turned off or you sign out.
- Added Steam non-Steam shortcuts for installed games with cover and hero artwork, kept in sync as games are installed, removed or reconfigured, plus "Restore Backup" for the original Steam shortcuts file.
- Added a link to the Playnite extension under Settings → Integrations.

<!-- /WP2 -->

## 17.2.3

Status: Released on 2026-10-14.

### Changes

- Added a separate frontend runtime container serving the prebuilt web UI and forwarding API requests, uploads, downloads and WebSockets to the backend.
- Published the runtime Dockerfile, Nginx configuration and startup script with each web release; the runtime supports a read-only filesystem and explicitly trusted HTTPS reverse proxies.
- Replaced the backend web-UI restart action with guidance to update the separate frontend container.

### Breaking Changes & Migration

- Web UI updates are deployed through the separate frontend runtime instead of the backend restart endpoint. -> **Update the frontend container through your Compose deployment.**

## 17.2.1

Status: Released on 2026-10-13.

### Changes

- Hardened credential storage: desktop vault failures retain only an in-memory session, offline caches exclude keys and sessions, and logout prevents stale vault restores.
- Restricted authenticated requests to the selected server API and rejected credential-bearing URLs and redirects; SSO accepts only initiated popups or fragment callbacks, removing credentials from the address bar before requests.
- Fixed archive output containment across ISO and single-file formats and prevented writes through existing hard links; capped native image reads and downloads at 32 MiB.
- Updated affected JavaScript dependencies, Quinn and Rustls security fixes, and backported the upstream GLib iterator safety fix without changing the GTK3 ABI.
- Enabled the desktop content security policy to block remote scripts and unsafe evaluation while retaining configured library connections.
- Preserved the Linux desktop launcher format when repository formatting runs, so packaged application shortcuts remain valid.

## 17.2.0

Status: Released on 2026-10-13. This version marks the fresh PlayStash source baseline.

### Changes

- Added a saved English/German interface-language choice with local catalogs, translated navigation and appearance controls, and English fallback for missing translations. Other pages remain partly English.
- Introduced PlayStash branding, application identifiers and the new logo.
- Clearly identified original authors and removed unrelated provider policy links from About.
- Made the frontend features available without a subscription.
- Bundled the PlayStash API schema for reproducible client generation.
- Preserved current desktop capabilities, including launch logs, streamer mode and protected credential storage.
- GitHub-hosted tests, installers and releases run automatically; any future self-hosted runner jobs require explicit activation and are blocked by default.
- Update settings now offer only the published Stable (`main`) and Unstable (`dev`) channels.
- Added Windows, Linux and macOS ARM/Intel installer builds, signed updater artifacts and immutable version releases with changelog notes.
- Release retries resume existing drafts even before their version tags are published; inaccessible release data stops publication.
- Corrected corrupted punctuation on the sign-in and registration screens.
- Added desktop and browser SSO, refreshed download artwork and improved freeze recovery.
- [#21](https://github.com/Phalcode/gamevault-frontend/issues/21) Kept native video controls accessible while browsing trailers.
- [#17](https://github.com/Phalcode/gamevault-frontend/issues/17) Added platform/install-type badges to game covers.
- [#7](https://github.com/Phalcode/gamevault-frontend/issues/7) Added a collapsible list of games added in the last seven days.
- [#24](https://github.com/Phalcode/gamevault-frontend/issues/24) Added saved library categories using tags and server folders.
- [#10](https://github.com/Phalcode/gamevault-frontend/issues/10) Added an optional local post-install script with literal installation-folder arguments and visible failure feedback.
- Show all game website links instead of only the first.
- Added shared archive passwords, Markdown system requirements and multiple launch profiles.
- Added package extras, optional installer recipes and ordered addon installation with explicit overwrite confirmation.
- Added administrator game access controls and account privacy controls for restricted activity and completed game actions.
- Added reliable completed-action reporting and administrator game metrics without counting browser download handoffs.
- Added game requests with anonymous submission, administrator status updates and unread notifications.
- Added community ratings and reviews with explicit consent to publish the library username.
- Added versioned save archive uploads, downloads, individual deletion and desktop restore into a chosen save folder.
- Added a fullscreen Big Picture library shell using the existing controller navigation; Start toggles the mode.
- Added lobby, game-room and direct chat with retry-safe sending and invisible presence.
- [#24](https://github.com/Phalcode/gamevault-frontend/issues/24) Added persistent administrator folder-tag rules that apply to existing games and future library imports.
- Added recent server logs and a confirmed background refresh of provider metadata to Administration.
- [#36](https://github.com/Phalcode/gamevault-frontend/issues/36) Improved UMU setup responsiveness, executable discovery, playtime diagnostics and uninstall folder cleanup.

### Thanks

- @joshuaavalon
- @Techfreakssm
- @JoaGamo
- @hbilbo
- @ozma6464

### Breaking Changes & Migration

- The stable and development branches are now `main` and `dev`. -> **Update local branch tracking and custom CI references to the new names.**

This changelog begins with PlayStash. It does not claim earlier releases or carry issue history from another project.
