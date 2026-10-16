import { describe, expect, it } from "vitest";
import { serverMediaId } from "@/utils/serverMediaUrl";

describe("serverMediaId", () => {
  it("recognizes media of the connected server", () => {
    expect(
      serverMediaId("https://games.test/api/media/42", "https://games.test"),
    ).toBe(42);
    expect(
      serverMediaId("https://games.test/api/media/42", "https://games.test/"),
    ).toBe(42);
    expect(
      serverMediaId(
        "https://host.test/playstash/api/media/7",
        "https://host.test/playstash",
      ),
    ).toBe(7);
  });

  it("leaves external and other URLs alone", () => {
    expect(
      serverMediaId("https://cdn.test/api/media/42", "https://games.test"),
    ).toBeNull();
    expect(
      serverMediaId("http://games.test/api/media/42", "https://games.test"),
    ).toBeNull();
    expect(
      serverMediaId("https://games.test/api/media/abc", "https://games.test"),
    ).toBeNull();
    expect(
      serverMediaId(
        "https://games.test/api/media/42/extra",
        "https://games.test",
      ),
    ).toBeNull();
    expect(serverMediaId("https://games.test/api/media/42", null)).toBeNull();
    expect(serverMediaId("not a url", "https://games.test")).toBeNull();
  });
});
