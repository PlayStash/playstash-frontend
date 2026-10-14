import { describe, expect, it } from "vitest";
import { communityDownloadUrls, overlayUrlFor } from "./communityThemes";
import { formatCacheSize } from "@/utils/cacheSize";

describe("community themes", () => {
  it("skips entries starting with _ and entries without download_url", () => {
    expect(
      communityDownloadUrls([
        {
          name: "Matcha.xaml",
          download_url: "https://raw.test/v1/Matcha.xaml",
        },
        { name: "_template.xaml", download_url: "https://raw.test/v1/_t.xaml" },
        { name: "_PUT_NEW_THEMES_HERE", download_url: "https://raw.test/x" },
        { name: "folder", download_url: null },
        { download_url: "https://raw.test/noname" },
      ]),
    ).toEqual(["https://raw.test/v1/Matcha.xaml"]);
    expect(communityDownloadUrls({ message: "Not Found" })).toEqual([]);
  });

  it("resolves the overlay relative to the download URL", () => {
    expect(
      overlayUrlFor(
        "https://raw.githubusercontent.com/PlayStash/t/main/v1/Ocean%20(Dark).xaml?token=abc",
        "images/ocean overlay.png",
      ),
    ).toBe(
      "https://raw.githubusercontent.com/PlayStash/t/main/v1/images/ocean%20overlay.png?token=abc",
    );
  });
});

describe("formatCacheSize", () => {
  it("prints base-1024 sizes with two decimals", () => {
    expect(formatCacheSize(0)).toBe("(0.00 B)");
    expect(formatCacheSize(12.34 * 1024 * 1024)).toBe("(12.34 MB)");
    expect(formatCacheSize(1536)).toBe("(1.50 KB)");
    expect(formatCacheSize(null)).toBe("");
  });
});
