/**
 * Age rating filter options: the distinct `metadata.age_rating` values of
 * the library in ascending order, `null` (shown as "N/A") first.
 */
export function distinctAgeRatings(
  games: { metadata?: { age_rating?: number | null } | null }[],
): (number | null)[] {
  const values = new Set<number | null>();
  for (const game of games) {
    const value = game?.metadata?.age_rating;
    values.add(
      typeof value === "number" && Number.isFinite(value) ? value : null,
    );
  }
  return [...values].sort((a, b) => {
    if (a === null) return b === null ? 0 : -1;
    if (b === null) return 1;
    return a - b;
  });
}

/** Option value of an age rating (`"null"` for N/A). */
export function ageRatingOptionValue(value: number | null): string {
  return value === null ? "null" : String(value);
}

/** Valid `ageRating` URL/filter values. */
export function isAgeRatingValue(value: string | null): value is string {
  return value === "all" || value === "null" || /^-?\d+$/.test(value ?? "");
}
