# PlayStash

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

People using their self-hosted game collection in a browser or the Tauri desktop client. The user confirmed that discovering the collection, with large covers, categories, and new games, is the opening experience's priority.

## Product Purpose

Browse, organize, download, install, and play a personal DRM-free game library. A complete frontend redesign must retain the existing product's functionality.

## Operating Context

One React frontend serves web and desktop. The desktop client additionally supports local installations, launching games, offline play, cloud saves, and controller-oriented Big Picture. Users connect to their own server through saved profiles. Game images and metadata come from that server.

## Capabilities and Constraints

Repository evidence: library browsing, search and filters, local categories, recently added and installed games, game detail and versions, bookmarks, progress, downloads, community, requests, chat, profiles, settings, and role-gated administration. Preserve authentication, permissions, internationalization, accessibility, media caching, theme selection, and the web/desktop capability boundaries. Category server sync is planned work in TODO.md, not an existing capability.

## Brand Commitments

The name remains PlayStash. The user requests a completely new frontend visual world inspired by Steam, with a higher level of visual craft, and design proposals before implementation. Use Taste, Emil Kowalski's design engineering principles, and Impeccable. Existing logo assets are available; no replacement logo was requested.

## Evidence on Hand

- Existing implementation: src/main.tsx, src/pages, src/components, src/themes, and src/index.css.
- Brand: public/playstash-logo.png and public/logo-text-light.svg / logo-text-dark.svg.
- Real cover art is supplied by the connected server; no local game-art catalog or authenticated preview server is provided.
- Prototype content must be identified as examples and must not imply actual account, catalog, social, or download data.

## Product Principles

- Let the game collection lead; navigation and utilities support discovery.
- Keep frequent tasks fast and clear across web and desktop.
- Redesign the entire frontend coherently while preserving existing behavior.
- Present concrete design choices before changing the production interface.

## Open Decisions

The user explicitly selected “Steam, neu gedacht”: global top navigation, a persistent searchable game list at left, and a generous game detail pane at right. The later instruction to begin work is authorization to implement that selected direction. No change to backend behavior, deployment, release channels, or data model is authorized by the visual redesign request.
