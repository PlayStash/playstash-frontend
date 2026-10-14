export type EarlyAccessFilter = "all" | "true" | "false";
export type BookmarkFilter = "all" | "mine" | "others";

export interface BuildGamesQueryParamsOptions {
  search?: string;
  sortBy?: string;
  order?: string;
  limit?: number;
  bookmarkFilter?: BookmarkFilter;
  userId?: unknown;
  gameTypes?: string[];
  tags?: string[];
  genres?: string[];
  developers?: string[];
  publishers?: string[];
  gameState?: string;
  releaseDateFrom?: string;
  releaseDateTo?: string;
  earlyAccess?: EarlyAccessFilter;
  addedSince?: string;
  libraryFolder?: string;
  /** Age rating filter: `"all"`, `"null"` (N/A) or a rating number. */
  ageRating?: string;
}

/** `filter.metadata.age_rating` value for an age rating selection. */
export function ageRatingFilterValue(ageRating?: string): string | null {
  if (!ageRating || ageRating === "all") return null;
  if (ageRating === "null") return "$null";
  return /^-?\d+$/.test(ageRating) ? `$eq:${ageRating}` : null;
}

/**
 * Builds the `/api/games` query string from the library filters. Kept pure so
 * the filter→query mapping can be unit-tested deterministically.
 */
export function buildGamesQueryParams(
  options: BuildGamesQueryParamsOptions,
): URLSearchParams {
  const {
    search,
    sortBy,
    order,
    limit,
    bookmarkFilter = "all",
    userId,
    gameTypes = [],
    tags = [],
    genres = [],
    developers = [],
    publishers = [],
    gameState,
    releaseDateFrom,
    releaseDateTo,
    earlyAccess = "all",
    addedSince,
    libraryFolder,
  } = options;

  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (sortBy) params.set("sortBy", `${sortBy}:${order ?? "ASC"}`);
  if (limit) params.set("limit", String(limit));

  if (bookmarkFilter === "mine" && userId != null) {
    params.set("filter.bookmarked_users.id", `$eq:${userId}`);
  } else if (bookmarkFilter === "others" && userId != null) {
    params.set("filter.bookmarked_users.id", `$not:$eq:${userId}`);
  }

  if (gameTypes.length > 0) {
    params.set("filter.type", `$in:${gameTypes.join(",")}`);
  }
  if (tags.length > 0) {
    params.set("filter.metadata.tags.name", `$in:${tags.join(",")}`);
  }
  if (genres.length > 0) {
    params.set("filter.metadata.genres.name", `$in:${genres.join(",")}`);
  }
  if (developers.length > 0) {
    params.set(
      "filter.metadata.developers.name",
      `$in:${developers.join(",")}`,
    );
  }
  if (publishers.length > 0) {
    params.set(
      "filter.metadata.publishers.name",
      `$in:${publishers.join(",")}`,
    );
  }

  if (gameState && userId != null) {
    params.set("filter.progresses.state", `$eq:${gameState}`);
    params.set("filter.progresses.user.id", `$eq:${userId}`);
  }

  if (releaseDateFrom && releaseDateTo) {
    params.set(
      "filter.metadata.release_date",
      `$btw:${releaseDateFrom},${releaseDateTo}`,
    );
  } else if (releaseDateFrom) {
    params.set("filter.metadata.release_date", `$gte:${releaseDateFrom}`);
  } else if (releaseDateTo) {
    params.set("filter.metadata.release_date", `$lte:${releaseDateTo}`);
  }

  if (earlyAccess === "true") {
    params.set("filter.metadata.early_access", "$eq:true");
  } else if (earlyAccess === "false") {
    params.set("filter.metadata.early_access", "$eq:false");
  }

  const ageRatingFilter = ageRatingFilterValue(options.ageRating);
  if (ageRatingFilter) {
    params.set("filter.metadata.age_rating", ageRatingFilter);
  }

  if (addedSince) params.set("filter.created_at", `$gte:${addedSince}`);
  if (libraryFolder)
    params.set(
      "filter.versions.file_path",
      `$sw:${libraryFolder.replace(/\\/g, "/").replace(/\/+$/, "")}/`,
    );

  return params;
}

export interface BuildCacheKeyOptions {
  search: string;
  sortBy: string;
  order: string;
  limit?: number;
  bookmarkFilter?: BookmarkFilter;
  gameTypes?: string[];
  tags?: string[];
  genres?: string[];
  developers?: string[];
  publishers?: string[];
  gameState?: string;
  releaseDateFrom?: string;
  releaseDateTo?: string;
  earlyAccess?: EarlyAccessFilter;
  addedSince?: string;
  libraryFolder?: string;
  ageRating?: string;
}

/**
 * A stable serialization of all filter/sort/search params + server + user id.
 * Arrays are sorted so the key does not churn when array order (not content)
 * changes. Used to restore infinite-scroll state across remounts.
 */
export function buildCacheKey(
  options: BuildCacheKeyOptions,
  serverUrl: string,
  userId: unknown,
): string {
  return JSON.stringify({
    search: options.search,
    sortBy: options.sortBy,
    order: options.order,
    limit: options.limit,
    bookmarkFilter: options.bookmarkFilter,
    gameTypes: options.gameTypes?.slice().sort(),
    tags: options.tags?.slice().sort(),
    genres: options.genres?.slice().sort(),
    developers: options.developers?.slice().sort(),
    publishers: options.publishers?.slice().sort(),
    gameState: options.gameState,
    releaseDateFrom: options.releaseDateFrom,
    releaseDateTo: options.releaseDateTo,
    earlyAccess: options.earlyAccess,
    addedSince: options.addedSince,
    libraryFolder: options.libraryFolder,
    ...(options.ageRating && options.ageRating !== "all"
      ? { ageRating: options.ageRating }
      : {}),
    serverUrl,
    userId: userId ?? null,
  });
}
