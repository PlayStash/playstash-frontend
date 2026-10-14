/**
 * Artwork search providers (WPF ArtworkSearchUserControl): named search URLs
 * containing `$GAME`, opened in the browser with the game title.
 */
import { profileScopedKey } from "./profileScope";

export interface ArtworkProvider {
  name: string;
  url: string;
}

export const ARTWORK_PROVIDERS_KEY = "playstash_artwork_search_providers";
export const ARTWORK_PROVIDER_NAME_MAX = 80;
export const ARTWORK_PROVIDER_URL_MAX = 2000;

export const DEFAULT_ARTWORK_PROVIDERS: ArtworkProvider[] = [
  {
    name: "SteamGridDB",
    url: "https://www.steamgriddb.com/search/grids?term=$GAME",
  },
  {
    name: "Google Images",
    url: "https://www.google.com/search?tbm=isch&q=$GAME",
  },
];

/** Error keys (translated by the dialog). */
export type ArtworkProviderError =
  "artwork.error.name" | "artwork.error.placeholder" | "artwork.error.url";

function isProvider(value: unknown): value is ArtworkProvider {
  return (
    !!value &&
    typeof (value as ArtworkProvider).name === "string" &&
    typeof (value as ArtworkProvider).url === "string"
  );
}

/** Stored providers; missing or unparseable → defaults, `[]` stays empty. */
export function loadArtworkProviders(): ArtworkProvider[] {
  try {
    const raw = localStorage.getItem(profileScopedKey(ARTWORK_PROVIDERS_KEY));
    if (raw === null) return DEFAULT_ARTWORK_PROVIDERS.map((p) => ({ ...p }));
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("invalid");
    return parsed.filter(isProvider).map(({ name, url }) => ({ name, url }));
  } catch {
    return DEFAULT_ARTWORK_PROVIDERS.map((p) => ({ ...p }));
  }
}

export function saveArtworkProviders(providers: ArtworkProvider[]): void {
  try {
    localStorage.setItem(
      profileScopedKey(ARTWORK_PROVIDERS_KEY),
      JSON.stringify(providers),
    );
  } catch {
    // storage unavailable
  }
}

/** Replaces `$GAME` with the URL-encoded title. */
export function buildArtworkSearchUrl(template: string, title: string): string {
  return template.split("$GAME").join(encodeURIComponent(title));
}

/** Absolute http(s) URL without user info. */
export function isSafeSearchUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

/**
 * Validates a new provider. Returns the trimmed provider or the error key.
 * The URL is checked after substituting the URL-encoded `title`.
 */
export function validateArtworkProvider(
  name: string,
  url: string,
  title = "Game",
): { provider: ArtworkProvider } | { error: ArtworkProviderError } {
  const trimmedName = name.trim();
  const trimmedUrl = url.trim();
  if (!trimmedName) return { error: "artwork.error.name" };
  if (!trimmedUrl.includes("$GAME"))
    return { error: "artwork.error.placeholder" };
  if (!isSafeSearchUrl(buildArtworkSearchUrl(trimmedUrl, title))) {
    return { error: "artwork.error.url" };
  }
  return {
    provider: {
      name: trimmedName.slice(0, ARTWORK_PROVIDER_NAME_MAX),
      url: trimmedUrl.slice(0, ARTWORK_PROVIDER_URL_MAX),
    },
  };
}
