/**
 * Installed games section: sort options and filters (WPF InstallUserControl).
 */
import type { PlaystashGame } from "@/api/models/PlaystashGame";

export type InstalledSort =
  "last-played" | "title" | "release-date" | "rating" | "size" | "playtime";

export const INSTALLED_SORTS: InstalledSort[] = [
  "last-played",
  "title",
  "release-date",
  "rating",
  "size",
  "playtime",
];

export type InstalledEarlyAccess = "all" | "only" | "exclude";

export type InstalledTypeFilter =
  | "all"
  | "WINDOWS_PORTABLE"
  | "WINDOWS_SETUP"
  | "LINUX_PORTABLE"
  | "UNDETECTABLE";

export const INSTALLED_TYPE_FILTERS: InstalledTypeFilter[] = [
  "all",
  "WINDOWS_PORTABLE",
  "WINDOWS_SETUP",
  "LINUX_PORTABLE",
  "UNDETECTABLE",
];

export interface InstalledFilters {
  earlyAccess: InstalledEarlyAccess;
  /** Free text; filters only when it parses as an integer year. */
  releaseYear: string;
  type: InstalledTypeFilter;
}

export const DEFAULT_INSTALLED_FILTERS: InstalledFilters = {
  earlyAccess: "all",
  releaseYear: "",
  type: "all",
};

type AnyGame = PlaystashGame & Record<string, any>;

function releaseDate(game: AnyGame): Date | null {
  const value = game.metadata?.release_date ?? game.release_date;
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function earlyAccessOf(game: AnyGame): boolean | null {
  const value = (game.metadata as any)?.early_access ?? game.early_access;
  return typeof value === "boolean" ? value : null;
}

/** `size` as a number (bytes string on the API), 0 when unparseable. */
function sizeOf(game: AnyGame): number {
  const value = Number(game.size);
  return Number.isFinite(value) ? value : 0;
}

function playtimeOf(game: AnyGame, userId: unknown): number {
  if (userId == null || !Array.isArray(game.progresses)) return 0;
  const progress = game.progresses.find(
    (p: any) => (p?.user?.id ?? p?.user?.ID) === userId,
  );
  return Number(progress?.minutes_played) || 0;
}

/** Applies the early access, release year and type filters. */
export function filterInstalledGames<T extends PlaystashGame>(
  games: T[],
  filters: InstalledFilters,
): T[] {
  const yearText = filters.releaseYear.trim();
  const year = /^[+-]?\d+$/.test(yearText) ? Number(yearText) : null;
  return games.filter((raw) => {
    const game = raw as AnyGame;
    if (filters.earlyAccess !== "all") {
      // Games with no early-access value match neither "only" nor "exclude".
      const value = earlyAccessOf(game);
      if (value === null || value !== (filters.earlyAccess === "only")) {
        return false;
      }
    }
    if (year !== null && releaseDate(game)?.getUTCFullYear() !== year) {
      return false;
    }
    if (filters.type !== "all" && game.type !== filters.type) return false;
    return true;
  });
}

/**
 * Sorts installed games. `last-played` keeps the given order (last played /
 * installed first). All sorts are stable.
 */
export function sortInstalledGames<T extends PlaystashGame>(
  games: T[],
  sort: InstalledSort,
  userId?: unknown,
): T[] {
  if (sort === "last-played") return [...games];
  const list = [...games] as AnyGame[];
  switch (sort) {
    case "title": {
      const collator = new Intl.Collator(undefined, { sensitivity: "base" });
      list.sort((a, b) =>
        collator.compare(
          String(a.sort_title ?? a.title ?? ""),
          String(b.sort_title ?? b.title ?? ""),
        ),
      );
      break;
    }
    case "release-date":
      list.sort((a, b) => {
        const da = releaseDate(a);
        const db = releaseDate(b);
        if (!da && !db) return 0;
        if (!da) return 1;
        if (!db) return -1;
        return db.getTime() - da.getTime();
      });
      break;
    case "rating":
      list.sort(
        (a, b) =>
          (Number(b.metadata?.rating) || 0) - (Number(a.metadata?.rating) || 0),
      );
      break;
    case "size":
      list.sort((a, b) => sizeOf(b) - sizeOf(a));
      break;
    case "playtime":
      list.sort((a, b) => playtimeOf(b, userId) - playtimeOf(a, userId));
      break;
  }
  return list as T[];
}
