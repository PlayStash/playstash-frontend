# PlayStash Frontend Changelog

## 17.3.0

Status: Unreleased.

### Changes

- Cloud saves use the same security-patched Ludusavi build as the Windows client, compiled from source with updated dependencies (including the latest Rustls security fixes).
<!-- WP4 -->
- Play now works the same everywhere (game page, library card, fullscreen library): it uses launch profiles and the server's default executable, and picks and saves the first suitable executable automatically when none is configured.
- Added Emulator / ROM launch in Game Settings → Launch Options: start a game's ROM with your own emulator from Play, desktop shortcuts and Steam, with playtime tracked while the emulator runs that ROM. "Use native executable" switches back.
- Launch Options can now apply a server launch profile, copy the executable path relative to the installation and create a desktop icon; changing the executable updates an existing desktop shortcut.
- Uninstalling now honours an install type you forced during installation, accepts uninstallers that ask for a reboot (exit code 3010), keeps the files when an uninstaller fails, finds the configured uninstaller anywhere in the installation and removes the game's desktop shortcut.
- The fullscreen library (Big Picture) opens on your installed games: pick with arrow keys, D-pad or stick, play with Enter or A (or a double-click) and close with Esc or B. A new setting opens it when the client starts.
- Added a Reset button that restores the server's default list of ignored executables. An executable is now ignored when its name contains an ignored entry (e.g. "setup" also hides "GameSetup_x64").
- Installed games remember when you last launched them, so "recently played" ordering also works offline.
- Launch parameters with quoted paths containing spaces now work on Linux and macOS.
- Fixed playtime tracking freezing when a running game was closed, and the exit of games started as administrator on Windows was never noticed.
<!-- /WP4 -->

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

<!-- WP5 -->
- Desktop: the download-location picker preselects the location you used last, shows the free space of every location and checks that the game fits before the download starts.
- Desktop: starting a download of a game that was already downloaded now asks before overwriting it; a game that is already being downloaded is not queued twice.
- Desktop: failed downloads resume automatically after 10 seconds, waiting twice as long after every further failure; downloads rejected by the server wait for a fresh sign-in instead.
- Desktop: a connection that closes early now fails the download and resumes it instead of handing a truncated file to the extractor.
- Desktop: a default extraction password can be saved (encrypted) in Settings → Downloads; encrypted archives try the game's password, then the default password, and finally ask for the password.
- Desktop: new option "Mount ISO instead of extracting" mounts downloaded .iso images as a drive (Windows, macOS, Linux with udisks2) and installs the game from it.
- Desktop: new "Create Shortcut" switch in the install panel creates a desktop shortcut after the installation.
- Desktop: installing over an existing installation of the same version now asks for confirmation, and a forced installation type is remembered for the uninstall.
- Desktop: setups that exit with code 3010 (restart required) count as successful; other failure codes and empty installation folders show clearer messages.
- Desktop: "Delete all Downloads" on the Downloads page removes every finished, failed or cancelled download; running ones are kept.
- Desktop: download cards show the size of their download and extraction folders.
- Desktop: system notifications for finished and failed downloads and extractions while PlayStash is in the background or another page is open.
- Desktop: adding or removing a download location now rescans it for downloads and warns when a game is installed in more than one location.
- Desktop: "Auto-Install Games" is now on by default for new installations; existing installations keep their current setting.
<!-- /WP5 -->

<!-- WP7 -->
- Added a theme system with the seven PlayStash desktop themes (Default, Classic, Phalcode, Halloween, Christmas), a System option and the classic web look; the chosen theme applies instantly and is remembered per profile.
- Added custom theme files (validated XAML) with a theme folder, reload and uninstall on desktop, theme file import on the web, overlay images, community themes from GitHub and a "Create a Theme" generator that exports and applies new themes.
- Added a desktop startup sound (up to 20 MB, played at half volume for at most 10 seconds after login).
- Added "Auto-Load Library from Server on Startup" and "Retain Sorting and Filter preferences after restart" settings.
- Added "I'm Feeling Lucky", a reload button, an age rating filter, "Hide installed games", a cover size slider and a scroll-to-top button to the library.
- Added sorting (last played, title, release date, rating, size, playtime) and early access, release year and type filters to the installed games section, which also remembers whether it is expanded.
- Game pages: click the title to switch between the mapped and the file title, see the release year, open the library filtered by a type, genre, tag, developer or publisher, and copy a playstash:// link when sharing from the desktop app.
- The media slider remembers its volume (muted by default) for videos and trailers.
- Added artwork search providers with custom search URLs and "Copy Image to Clipboard" for covers in the game settings.
- Added a Storage settings page with image and offline cache sizes, clearing the offline cache and opening the app data folder.
- Administration: sort users by name, activation or role, see when a newer backend release is available, view the server health protocol and uptime, and see reindex errors.
- Server news are re-checked every hour, toasts can be copied, the sidebar links to GitHub and the bug report form, and unexpected errors show a crash screen with reload, copy details and log folder actions.
<!-- /WP7 -->

<!-- WP1 -->
- Desktop: added the `playstash://` link scheme and command line actions (`show`, `install`, `uninstall`, `start`, `--gameid`, `--minimized`, `--autoinstall`, `--confirm`, `--jumplistcommand`). Browser links always ask before uninstalling.
- Desktop: starting PlayStash again, opening a `playstash://` link or using the command line while PlayStash runs hands the action to the running app instead of opening a second window; actions wait until you are signed in.
- Desktop: added the local query interface used by the Playnite extension (installed state, install folder, game name, app version, server URL, login state and the game list), compatible with the extension and the previous Windows client.
- Desktop: the tray menu now offers Library, Downloads, Community, Settings and Exit in your language; on Windows a double click on the tray icon shows or hides PlayStash.
- Desktop: exiting while downloads are running asks first and cancels the downloads when you confirm.
- Desktop: the first time the window is closed to the tray, a notification explains that PlayStash keeps running in the background.
- Windows: the taskbar jump list offers Library, Downloads, Community, Settings and Exit, plus your five most recently played or installed games to start directly.
- Desktop: "Minimize PlayStash to System Tray on Startup" now only applies when PlayStash is started with your computer; starting it yourself always shows the window.
- Desktop: added OS notifications and desktop shortcuts that start a game through PlayStash (Windows `.url`, Linux `.desktop`, macOS `.webloc`).
- Desktop: "Download in desktop app" links from the web interface now open the download in the desktop app.
<!-- /WP1 -->

<!-- WP6 -->
- Added login profiles to the desktop app: save several accounts across servers, pick one from "Choose Your Profile", edit or delete profiles, and switch with "Change Profile" in Settings → Account without entering passwords again. Your current login is kept as the first profile.
- Added "Remember Me" to the profile list: the desktop app logs into the last used profile automatically at startup.
- Added "Logout from this Device" and "Logout from all Devices" in Settings → Account; logging out (also from the user menu) now ends the session on the server, and a failed server logout is reported while you are still logged out locally.
- Added additional request headers ("Client Settings") to the desktop app for servers behind Cloudflare Access or similar proxies; they are sent with every server request, including downloads, playtime and add-ons, and never to other hosts.
- Added "Export Server Connection" (Settings → Account) and "Import Server Connection" (login screen) to share the server URL and installation preferences; the archive password is only included on request.
- The login now refuses servers older than 15.0.0 with a "CLIENT-SERVER-INCOMPATIBILITY DETECTED" dialog that links to the server releases.
- Accounts awaiting admin approval now show a waiting screen that signs in automatically once the account is activated; registration signs you in right away.
- The desktop app now shows a notice when it starts in offline mode and when the server is reachable again, and switches back to online mode reliably.
- Added "Copy API Key" to the user editor when the server provides the key.
- Added an import from the previous PlayStash client for Windows (profiles, settings, request headers, saved sessions and themes), plus adoption of games it installed so they show as installed without a new download.
<!-- /WP6 -->

### Breaking Changes & Migration

<!-- WP6 -->
- The client no longer logs in to PlayStash servers older than 15.0.0. -> **Update the server to 15.0.0 or newer.**
<!-- /WP6 -->

<!-- WP3 -->
- Added cloud saves to the desktop app: with "Sync cloud saves" enabled under Settings → Integrations, PlayStash restores your latest cloud save before a game starts and uploads your saves after the game exits, using the bundled Ludusavi save tool.
- Cloud save backups made while offline are queued and uploaded automatically once you are back online.
- Before overwriting a local save that is newer than the cloud save, the desktop app asks whether to keep the local save or use the cloud save; launches started in the background keep the local save.
- Added a Cloud Saves row on installed games to restore or back up saves manually, and an offer to back up the cloud save before uninstalling a game.
- Added custom Ludusavi manifests (file paths or URLs) and a "Use Primary Manifest" option to the cloud save settings.
- Cloud saves of Proton/umu games on Linux are backed up from and restored into the game's Wine prefix, and archives move between Windows and Linux installations.
- Archives created by the previous Windows client restore in the new desktop app and vice versa.
- Reworked the Saves tab into a cloud save version list with created date, size and installation, marking archives uploaded from this device; administrators can browse the saves of every user.
- Desktop downloads of save archives now stream straight to the chosen file, and manual uploads from the desktop app record this installation.
- Fixed the Saves tab requesting save archives for an unknown user before the account had loaded.
<!-- /WP3 -->

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
