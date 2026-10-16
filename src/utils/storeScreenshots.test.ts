// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  ScreenshotStoreError,
  storeScreenshots,
} from "@/utils/storeScreenshots";

// Like a server, the image type comes from the Content-Type header.
const image = () =>
  new Response("png", { headers: { "Content-Type": "image/png" } });

describe("storeScreenshots", () => {
  it("uploads external links and keeps images already on the server", async () => {
    const upload = vi.fn().mockResolvedValueOnce(7);
    const fetchImage = vi.fn().mockResolvedValue(image());
    const stored = await storeScreenshots(
      ["https://games.test/api/media/3", "https://cdn.test/shot.png"],
      { serverUrl: "https://games.test/", upload, fetchImage },
    );
    expect(stored).toEqual([
      "https://games.test/api/media/3",
      "https://games.test/api/media/7",
    ]);
    expect(fetchImage).toHaveBeenCalledWith("https://cdn.test/shot.png");
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload.mock.calls[0][0].type).toBe("image/png");
  });

  it("refuses to keep a link that cannot be stored", async () => {
    const upload = vi.fn();
    for (const response of [
      new Response("missing", { status: 404 }),
      new Response("<html>", { headers: { "Content-Type": "text/html" } }),
    ]) {
      await expect(
        storeScreenshots(["https://cdn.test/gone.png"], {
          serverUrl: "https://games.test",
          upload,
          fetchImage: async () => response,
        }),
      ).rejects.toBeInstanceOf(ScreenshotStoreError);
    }
    expect(upload).not.toHaveBeenCalled();
  });
});
