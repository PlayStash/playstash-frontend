# Library Composition

Use the canonical [DESIGN.md](../../DESIGN.md) and selected [surface contract](../../.impeccable/surfaces/src-layouts-dashboardlayout-tsx.md).

Desktop library routes combine global top navigation with a persistent searchable 264px library rail. The overview leads with collection controls, category tabs, recent additions, and the cover grid. Cards use 2:3 server artwork, small corners, and metadata below; hover does not lift them. Missing media keeps the existing honest placeholder.

Game detail occupies the pane beside the same rail: full-bleed landscape artwork, a distinct action bar, state controls, tabs, and readable content/metadata. Neutral dark scrims and white artwork text remain consistent in light and custom themes.

Below 1024px, navigation and library list are separate accessible drawers. The cover grid is two columns at 640px and below. Detail content stacks when its container is narrow; tabs remain horizontally scrollable. Preserve cover-size settings, filters, selection, installed/server boundaries, local categories, and existing translated state/empty/error UI.
