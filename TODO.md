# TODO

Planned work that is not scheduled for a release yet.

## Library categories: sync and full filters

Library categories (`src/components/LibraryCategories.tsx`) are saved in
`localStorage` per server and user, so they exist only on the device and in
the browser where they were created. They store only the selected tags and
the library folder.

- Store categories on the server so they follow the account to every device
  and client (desktop and web).
- Save the complete filter state in a category: game state (e.g. "Playing"),
  type, genres, developers, publishers, release date range, early access, age
  rating, bookmarks, sorting and order — not only tags and folder.
- Keep existing local categories by migrating them on first use.
