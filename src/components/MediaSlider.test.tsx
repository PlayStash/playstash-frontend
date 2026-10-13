// @vitest-environment jsdom
import { render, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MediaSlider } from "./MediaSlider";
vi.mock("@/utils/tauri", () => ({ isTauriApp: () => false }));
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
