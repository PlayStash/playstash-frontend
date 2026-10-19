# Auth Composition

Use the canonical [DESIGN.md](../../DESIGN.md) and the existing auth primitives.

Desktop auth has a split identity/form layout: a panel-backed identity area and a form region with a 448px content maximum. Below 768px, identity becomes a 72px brand header; the larger identity copy and version line are hidden, and the form starts below with 20px side padding. The existing PlayStash logo is unchanged.

Keep procedural copy, visible labels, validation, local/SSO flows, saved server/profile behavior, localization, and theme handling. Inputs use shell fill and strong lines; the primary action uses active-theme accent and on-accent text.
