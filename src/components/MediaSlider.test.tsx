// @vitest-environment jsdom
import { render, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MediaSlider } from "./MediaSlider";
vi.mock("@/utils/tauri", () => ({ isTauriApp: () => false }));
vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ serverUrl: "https://library.test" }),
}));
const media = vi.hoisted(() => ({ requested: [] as (number | null)[] }));
vi.mock("@/hooks/useAuthMediaUrl", () => ({
  useAuthMediaUrl: (id: number | null) => {
    media.requested.push(id);
    return { url: id == null ? null : `blob:media-${id}` };
  },
}));
describe("native trailer controls", () => {
  afterEach(cleanup);
  it("can transition from empty media to a trailer without changing hook order", () => {
    const view = render(<MediaSlider trailers={[]} />);
    view.rerender(
      <MediaSlider
        trailers={[
          { video: "https://library.test/trailer.mp4", type: "video/mp4" },
        ]}
      />,
    );
    const video = view.container.querySelector("video");
    expect(video?.controls).toBe(true);
    const fullscreen = view.container.querySelector(
      'button[aria-label*="ullscreen"]',
    );
    expect(fullscreen?.className).toContain("pointer-events-auto");
    expect(fullscreen?.closest(".pointer-events-none")).not.toBeNull();
  });
});

describe("screenshots", () => {
  afterEach(cleanup);
  it("loads screenshots stored on the server with the session", () => {
    const view = render(
      <MediaSlider screenshots={["https://library.test/api/media/42"]} />,
    );
    expect(view.container.querySelector("img")?.getAttribute("src")).toBe(
      "blob:media-42",
    );
  });

  it("shows external screenshots directly", () => {
    const view = render(
      <MediaSlider screenshots={["https://cdn.test/shot.jpg"]} />,
    );
    expect(view.container.querySelector("img")?.getAttribute("src")).toBe(
      "https://cdn.test/shot.jpg",
    );
  });
});
