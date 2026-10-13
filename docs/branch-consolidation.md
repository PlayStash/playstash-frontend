# Branch consolidation — 2026-10-13

`main` and `dev` are synchronized. The latest upstream development changes through
`cd98faf0cdc89fde62fc41e8bf76c36c70560f7b` are merged into the PlayStash source,
with PlayStash names, free features, and the current release workflows retained.

The old `ea` head, `3b065f0fddce37abd38d4fec48b5603b5a758d3e`, has tree
`e9f173f50a49921e117d7132dfa56af241bf90fc`, exactly matching the already included
development ancestor `993db3f`. Its additional commit does not contain additional
source changes. Its history is retained through an `ours` merge; the obsolete
branch and desktop updater channel are removed. Stable builds use `main` and
development builds use `dev`/`unstable`.
