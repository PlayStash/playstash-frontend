---
name: PlayStash
description: A calm, artwork-led personal game library in the selected Steam, neu gedacht direction.
colors:
  dark-bg: "#0e1825"
  dark-shell: "#0b121c"
  dark-panel: "#152131"
  dark-panel-strong: "#1e2e40"
  dark-panel-soft: "#182739"
  dark-text: "#edf2f7"
  dark-muted: "#a4b5c8"
  dark-line: "#253344"
  dark-line-strong: "#3c5067"
  dark-accent: "#a3d7fa"
  dark-accent-strong: "#c6e8ff"
  dark-accent-cool: "#a3d7fa"
  dark-on-accent: "#102238"
  dark-accent-hover: "#bce4ff"
  dark-accent-pressed: "#86c6ef"
  dark-accent-disabled: "#5c7c94"
  dark-blur: "rgba(8, 15, 24, 0.7)"
  dark-success: "#72d6ab"
  dark-warning: "#efc678"
  dark-danger: "#f58d91"
  light-bg: "#f1f4f8"
  light-shell: "#e5ebf2"
  light-panel: "#ffffff"
  light-panel-strong: "#e3ebf4"
  light-panel-soft: "#eaf0f6"
  light-text: "#15283c"
  light-muted: "#50647b"
  light-line: "#d3dde8"
  light-line-strong: "#b2c4d5"
  light-accent: "#176da5"
  light-accent-strong: "#125783"
  light-accent-cool: "#176da5"
  light-on-accent: "#ffffff"
  light-accent-hover: "#125783"
  light-accent-pressed: "#0e466a"
  light-accent-disabled: "#aac4d5"
  light-blur: "rgba(23, 39, 58, 0.6)"
  light-success: "#197a54"
  light-warning: "#966715"
  light-danger: "#b23d4c"
typography:
  game-title:
    fontFamily: "Inter, sans-serif"
    fontSize: "clamp(30px, 4cqw, 58px)"
    fontWeight: 650
    lineHeight: 1.08
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "Inter, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 600
    lineHeight: "2.25rem"
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Inter, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Inter, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: "1.5rem"
  body-mobile:
    fontFamily: "Inter, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: "1.75rem"
  field:
    fontFamily: Inter, sans-serif
    fontSize: 1rem
    fontWeight: 400
    lineHeight: 1.5rem
  control:
    fontFamily: "Inter, sans-serif"
    fontSize: "1rem"
    fontWeight: 500
    lineHeight: "1.5rem"
    letterSpacing: "-0.01em"
  control-compact:
    fontFamily: "Inter, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: "1.5rem"
    letterSpacing: "-0.01em"
  label:
    fontFamily: "Inter, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 500
    lineHeight: 1.4
  metadata:
    fontFamily: "Inter, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 400
    lineHeight: 1.4
rounded:
  thumbnail: "2px"
  compact: "4px"
  media: "5px"
  control: "6px"
  panel: "8px"
  toast: "10px"
  large: "12px"
spacing:
  "4": "4px"
  "8": "8px"
  "12": "12px"
  "16": "16px"
  "20": "20px"
  "24": "24px"
  "32": "32px"
  "48": "48px"
components:
  button-primary:
    backgroundColor: "{colors.dark-accent}"
    textColor: "{colors.dark-on-accent}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "9px 13px"
  button-secondary:
    backgroundColor: "{colors.dark-panel-strong}"
    textColor: "{colors.dark-text}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "9px 13px"
  button-plain:
    backgroundColor: "transparent"
    textColor: "{colors.dark-text}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "9px 13px"
  input:
    backgroundColor: "{colors.dark-shell}"
    textColor: "{colors.dark-text}"
    rounded: "{rounded.control}"
    padding: "9px 13px"
    typography: "{typography.field}"
  global-nav:
    backgroundColor: "{colors.dark-shell}"
    textColor: "{colors.dark-muted}"
  category-chip:
    textColor: "{colors.dark-muted}"
    rounded: "{rounded.compact}"
    padding: "8px 12px"
  cover-card:
    backgroundColor: "{colors.dark-panel}"
    textColor: "{colors.dark-text}"
    rounded: "{rounded.media}"
  library-row:
    textColor: "{colors.dark-muted}"
    rounded: "{rounded.compact}"
    padding: "5px 10px"
  dialog:
    backgroundColor: "{colors.dark-shell}"
    textColor: "{colors.dark-text}"
    rounded: "{rounded.control}"
    padding: "32px"
---

# Design System: PlayStash

## Overview

**Creative North Star: "Steam, neu gedacht"**

A personal game library with Steam’s familiar master-detail arrangement, made calmer and more legible. Midnight navy chrome, blue-grey work surfaces, ivory text, and ice-blue actions let game artwork carry the atmosphere. The selected direction is “Steam, neu gedacht”.

The same compact geometry serves light, dark, and custom themes. Inter, small corners, flat tonal steps, and clear control states keep discovery and everyday tasks coherent across web and desktop.

**Key Characteristics:**

- Artwork supplies expression; the interface supplies orientation.
- Compact controls, modest corners, and tonal separation.
- Immediate navigation with brief, purposeful state feedback.
- Theme-aware chrome and readable artwork overlays.

This file is the canonical visual guide. Its frontmatter records the implemented CSS palettes; the `dark-` and `light-` prefixes distinguish the two variants of the same `--color-ps-*` roles. Component frontmatter shows the dark variant; runtime components resolve the active theme. `.impeccable/design.json` extends these tokens with state examples, motion, depth, and breakpoints.

Visual sources are `src/index.css`, `src/styles/`, and the existing Tailwind components. Page composition follows the surface contract in `.impeccable/surfaces/src-layouts-dashboardlayout-tsx.md`. The existing logo assets remain unchanged. Game media is supplied by the connected backend. No new shipping raster artwork was produced; ignored proposal and review assets are QA evidence only.

## Colors

### Primary

Ice Blue is the dark interface action/selection color; its light counterpart is a deeper Library Blue. Use the corresponding on-accent foreground for solid actions. Strong and cool accent roles support links, focus, and active states. Hover, pressed, and disabled tokens remain available to theme-aware controls; the shared Button also uses its existing white hover overlay and reduced opacity when disabled.

### Neutral

Midnight Shell frames the dark canvas; blue-grey panel, soft-panel, and strong-panel steps organize content. Ivory Text and Slate Muted Text provide the hierarchy. Light mode uses a pale blue-grey shell and canvas, white panels, dark navy text, and blue-grey secondary text. Default and strong lines separate regions and controls.

Success, warning, and danger tokens communicate ready, caution, and failure states. Pair semantic color with an icon or text. Existing destructive Button variants retain their red treatment.

**The Semantic Chrome Rule.** Use the existing --color-ps-* properties for interface surfaces, text, lines, and accents so inline custom-theme tokens continue to work.

**The Artwork Legibility Rule.** White artwork text and neutral dark scrims remain readable independently of the active interface theme; they are the deliberate media exception.

Custom themes set the same color properties inline on the document root; those values take precedence over the CSS light/dark defaults. The `dark` class continues to select component variants. Keep geometry, type, and layout consistent across themes. The compatibility `blur` token remains available without making the main shell translucent.

## Typography

Inter is the display and body face, loaded by `index.html`, with sans-serif fallback and the `cv11` feature. JetBrains Mono / Fira Code / monospace remains the code stack. Use the observed role scale in the frontmatter rather than a second display family.

- Game titles use the container-responsive title role, with a mobile size of 34px and tight tracking.
- Shared page headings use 28px/36px on wider screens and 24px/32px on small screens. The library heading uses its own 28–36px clamp and weight 550.
- Section titles are typically 16–18px and weight 600; shared body copy is 14px/24px, increasing to 16px/28px on mobile.
- Navigation and compact control labels are 13–14px. Secondary game metadata is 10–12px; it must remain distinct from primary instructions.
- Use tabular numerals for counts, transfer data, and playtime. Description prose is bounded to 72ch; settings descriptions use 70ch.

## Layout

The app fills the available viewport. A global top bar is 72px high on desktop and 60px below 1024px; the Tauri window title bar is additional when present. The content region owns scrolling. Standard pages have a 1480px maximum content width and 32px side padding, reducing to 16px on smaller screens.

Library routes add a persistent 264px searchable library rail at desktop widths. Game detail is full bleed beside it: landscape art, a separate command bar, a state bar, tabs, then content and metadata. The overview starts with collection controls, category tabs, recent covers, and the library grid. It does not use the game-detail artwork composition.

Below 1024px, global navigation and the game list use separate accessible drawers (up to 320px wide, bounded by 88vw). They close after route selection and keep focus behavior supplied by Headless UI. Main content becomes one column. The library grid becomes two columns at 640px and below; detail metadata becomes one column when its container is 640px or narrower. Tabs scroll horizontally when needed.

Settings use a local left navigation on desktop and a horizontal navigation strip below 768px; form rows stack. Other workspaces use the same dividers, spacing, and responsive stacking. Auth uses a split identity/form composition on desktop, with a form bounded to 448px. Below 768px its identity area becomes a 72px brand header and the form begins below it.

Use the repeated 4/8px spacing rhythm, with 16–32px region padding. Preserve content wrapping and the established small-screen controls instead of shrinking whole desktop screens.

## Elevation & Depth

**The Flat By Default Rule.** Separate app regions with tone and one-pixel lines. Reserve the shell shadow for floating menus and dialogs.

The card shadow is transparent. Floating menus and dialogs use `--shadow-shell`: a wider, darker shadow in dark mode and a lighter blue-black shadow in light mode, recorded in the sidecar. Main cards and workspaces do not lift on hover. Artwork uses neutral legibility gradients and small dark utility controls; this does not establish a decorative gradient or glass treatment for the shell.

## Shapes

Controls predominantly use 4–6px corners; simple panels use 6–8px. Covers use 5px corners, thumbnails use 2px, and small metadata tags use 3–4px. Toast and existing larger utility shapes may use the 10–12px scale. Keep artwork clipped cleanly, lines thin, and component radii internally consistent. Circular avatars, status dots, and the existing scroll-to-top action retain their functional shape.

## Components

### Buttons

Primary actions use accent fill and on-accent text. Secondary actions use the strong panel and a visible line; plain actions use transparent backgrounds. Shared controls have at least 44px height on small screens, with the existing 40px compact variant from 640px and a touch-target expansion. The game play action is 46px high. Hover changes fill/border or applies the existing light overlay; press may scale to 0.98. Disabled controls use reduced opacity and an unavailable cursor.

### Inputs / Fields

Fields use shell fill, a strong one-pixel line, modest corners, and visible labels. Focus adds the accent ring; the compact rail search changes its line on focus-within. Invalid fields use their existing red line and error text. Disabled fields use a softer panel and reduced opacity. Keep existing server/profile/auth field behavior and translated copy.

### Navigation / Chips

Global navigation uses muted text, brighter hover, and an accent active underline. The library rail combines a thumbnail, title, and quiet count/status text; the current row receives an accent-tinted fill. Category chips use modest corners, a stronger selected surface, and `aria-pressed`. Settings navigation uses the same tonal selection language. Keyboard/gamepad focus uses a two-pixel accent outline, separate from selection.

### Cards / Containers

Game cards keep 2:3 art edge-to-edge with title and secondary metadata below. Hover reveals existing actions and changes the title color; touch devices keep those actions available. Missing media uses the existing initial/text placeholder. Queue items, community rows, settings groups, chat, and administration use tonal regions and dividers rather than large floating cards.

### Dialogs / Menus

Use the existing accessible primitives, shell/panel fill, one-pixel edge, and floating shadow. Keep escape, outside-click, focus, and disabled behavior. Dialogs fit the viewport and scroll internally. Menus highlight focus with the accent and on-accent text.

### Motion

Routes update immediately and the library rail persists across detail navigation. Artwork fades over 280ms after its pixels decode, with stable title geometry while media loads. Game tabs and settings start visibly and settle over 220–240ms; settings exits take 100ms and immediately leave keyboard navigation and the accessibility tree. Menus use 180ms entry and 120ms exit, dialogs 220/150ms, and mobile drawers 240/180ms. Library filters expand over 240ms and absorb the responsive 20/24px gap before unmounting. Preserve mounted overlay content through its exit and allow rapid reversal. Transform/opacity animation uses the shared ease-out curve; color and border changes remain local control feedback. Respect reduced motion and `MotionConfig`.

The one authored brand moment is the existing logo's card stack settling during a longer page load. The 1.1-second alpha WebP plays once, appears only after 160ms, and never holds navigation. A static companion serves reduced motion and hidden documents; the small activity spinner pauses when hidden. These are rendered runtime files, not an AE dependency. Source and export provenance is in `public/motion/provenance.json`; `design-system/motion/README.md` describes their use.

## Do's and Don'ts

### Do:

- Do reuse semantic theme tokens, Inter, existing controls, and the current PlayStash logo.
- Do preserve visible focus, labels, selected states, localization, and existing web/desktop capability boundaries.
- Do use real server artwork and honest missing-art placeholders.
- Do keep navigation immediate and honor reduced-motion preferences.

### Don't:

- Don’t restore the former purple/glass shell, oversized rounded cards, or Fredoka/Nunito typography.
- Don’t use a Cinema discovery hero for the library overview; follow the selected surface contract.
- Don’t bake dark palette literals into themeable application chrome.
- Don’t ship proposal artwork, browser fixtures, or sample account/catalog data as product content.
