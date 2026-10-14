// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  ARTWORK_PROVIDERS_KEY,
  buildArtworkSearchUrl,
  DEFAULT_ARTWORK_PROVIDERS,
  loadArtworkProviders,
  saveArtworkProviders,
  validateArtworkProvider,
} from "./artworkProviders";
import { setActiveProfileId } from "./profileScope";

beforeEach(() => {
  localStorage.clear();
  setActiveProfileId(null);
});

describe("loadArtworkProviders", () => {
  it("returns the defaults when nothing or garbage is stored", () => {
    expect(loadArtworkProviders()).toEqual(DEFAULT_ARTWORK_PROVIDERS);
    localStorage.setItem(ARTWORK_PROVIDERS_KEY, "{not json");
    expect(loadArtworkProviders()).toEqual(DEFAULT_ARTWORK_PROVIDERS);
    localStorage.setItem(ARTWORK_PROVIDERS_KEY, '{"a":1}');
    expect(loadArtworkProviders()).toEqual(DEFAULT_ARTWORK_PROVIDERS);
  });

  it("keeps a stored empty list empty", () => {
    saveArtworkProviders([]);
    expect(loadArtworkProviders()).toEqual([]);
  });

  it("is namespaced per profile", () => {
    setActiveProfileId("p1");
    saveArtworkProviders([{ name: "X", url: "https://x.test/?q=$GAME" }]);
    expect(localStorage.getItem(`${ARTWORK_PROVIDERS_KEY}:p1`)).not.toBeNull();
    setActiveProfileId(null);
    expect(loadArtworkProviders()).toEqual(DEFAULT_ARTWORK_PROVIDERS);
  });
});

describe("validateArtworkProvider", () => {
  it("requires a name", () => {
    expect(validateArtworkProvider("  ", "https://x/?q=$GAME")).toEqual({
      error: "artwork.error.name",
    });
  });

  it("requires $GAME", () => {
    expect(validateArtworkProvider("X", "https://x/?q=")).toEqual({
      error: "artwork.error.placeholder",
    });
  });

  it("requires an absolute http(s) URL without credentials", () => {
    for (const url of [
      "ftp://x/$GAME",
      "javascript:alert($GAME)",
      "/relative/$GAME",
      "https://user:pw@x/$GAME",
      "https://user@x/$GAME",
    ]) {
      expect(validateArtworkProvider("X", url)).toEqual({
        error: "artwork.error.url",
      });
    }
  });

  it("returns trimmed values", () => {
    expect(
      validateArtworkProvider("  My  ", "  https://x.test/s?q=$GAME  "),
    ).toEqual({ provider: { name: "My", url: "https://x.test/s?q=$GAME" } });
  });
});

describe("buildArtworkSearchUrl", () => {
  it("URL-encodes the title for every $GAME", () => {
    expect(
      buildArtworkSearchUrl(
        "https://www.google.com/search?tbm=isch&q=$GAME&x=$GAME",
        "Half-Life 2: Episode One & Co",
      ),
    ).toBe(
      "https://www.google.com/search?tbm=isch&q=Half-Life%202%3A%20Episode%20One%20%26%20Co&x=Half-Life%202%3A%20Episode%20One%20%26%20Co",
    );
  });
});
