# PlayStash loading motion

The two cards of the existing PlayStash logo settle into their familiar stack.
This one-shot identity animation is used only while a page is still loading
after 160 ms; it never holds navigation until playback finishes. The card artwork
and layout come from `public/playstash-logo.png`.

`public/motion/playstash-load.webp` is an existing After Effects render, encoded
at 192 × 192 pixels and 60 fps with alpha. Its playback count is one and its
duration is 1.1 seconds. The static companion is used for reduced motion or a
hidden document. The small loading spinner pauses while the document is hidden.

The files are runtime assets. Opening After Effects, creating compositions,
launching an AE instance, or running an authoring script is never part of a
PlayStash build. No AE project or temporary AE item is included here. Asset
hashes and source information are recorded in `public/motion/provenance.json`.

Routine UI motion preserves continuity: images fade only after decoding, hero
geometry depends on known media rather than network arrival, and dialogs stay
mounted long enough to leave. Settings panels and filters keep exiting content
out of keyboard navigation and the accessibility tree. There are no per-cover
layout animations across large game collections.
