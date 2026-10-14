/**
 * Library links from GameView pills (type, genre, tag, developer,
 * publisher). The link carries exactly one filter, so opening it replaces
 * all other filters (WPF `ClearAllFilters` + set one).
 */
export type LibraryFilterParam =
  "types" | "genres" | "tags" | "developers" | "publishers";

export function libraryFilterLink(
  param: LibraryFilterParam,
  value: string,
): string {
  const params = new URLSearchParams();
  params.set(param, value);
  return `/library?${params.toString()}`;
}
