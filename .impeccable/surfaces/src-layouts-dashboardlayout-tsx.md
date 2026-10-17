---
version: 1
slug: "src-layouts-dashboardlayout-tsx"
primary_target: "src/layouts/DashboardLayout.tsx"
related_targets:
  [
    "src/pages/Library.tsx",
    "src/pages/GameView.tsx",
    "src/pages/Downloads.tsx",
    "src/pages/Settings.tsx",
  ]
---

# Frontend redesign

Mode: operate. The user explicitly selected “Steam, neu gedacht” and requested immediate implementation on redesign/steam-inspired-ui based on the current dev branch. Discovery prioritizes big covers, categories, and new games. Every existing web/desktop feature remains in scope.

## Direction contract

THESIS: A personal game library with Steam's familiar master-detail arrangement, made calmer and more legible. The selected library list remains beside the game; avoid a Cinema discovery hero on the overview.

OWN-WORLD: Midnight navy shell, blue-grey work surfaces, ivory text, ice-blue action and selection. Flat tone steps, small 4–8px control corners, consistent Inter typography; custom themes and light mode retain the same geometry. Artwork carries the emotion.

STORY: Find a game in the persistent searchable library rail, inspect its artwork and actual metadata, then play, install, or download it. Collection filters, settings, community, chat, and administration remain findable.

FIRST VIEWPORT: Global navigation across the top, a 264px library rail at left, edge-to-edge landscape artwork in the right detail pane with the title near its lower edge, and a distinct action/state bar followed by tabs. Library overview uses real covers and compact filters. On mobile both navigation and library list are accessible drawers and content becomes one column. Reference: .impeccable/mocks/decision/steam.html; user-selected static proposal, not an image comp.

FORM: User-selected canon, Steam-inspired library client. seed: none (unavailable). Code-led implementation. The user's direct selection overrides the earlier Cinema assumption.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
