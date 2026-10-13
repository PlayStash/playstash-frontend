# PlayStash Frontend Changelog

## 17.2.0

Status: Unreleased. This version marks the fresh PlayStash source baseline.

### Changes

- Added a saved English/German interface-language choice with local catalogs, translated navigation and appearance controls, and English fallback for missing translations. Other pages remain partly English.
- Introduced PlayStash branding, application identifiers and the new logo.
- Clearly identified original authors and removed unrelated provider policy links from About.
- Made the frontend features available without a subscription.
- Bundled the PlayStash API schema for reproducible client generation.
- Preserved current desktop capabilities, including launch logs, streamer mode and protected credential storage.
- Disabled workflow jobs by default until explicitly enabled for this repository.
- Update settings now offer only the published Stable (`main`) and Unstable (`dev`) channels.
- Added Windows, Linux and macOS ARM/Intel installer builds, signed updater artifacts and immutable version releases with changelog notes.
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
