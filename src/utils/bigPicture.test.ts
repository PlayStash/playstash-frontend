// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { readBigPicture, setBigPicture } from "./bigPicture";
const mocks = vi.hoisted(() => ({ desktop: false, fullscreen: vi.fn() }));
vi.mock("./tauri", () => ({ isTauriDesktop: () => mocks.desktop }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ setFullscreen: mocks.fullscreen }),
}));
afterEach(() => {
  localStorage.clear();
  mocks.desktop = false;
  vi.clearAllMocks();
});
describe("Big Picture mode", () => {
  it("keeps the selected layout and notifies subscribers if browser fullscreen is denied", async () => {
    const notify = vi.fn();
    window.addEventListener("playstash:big-picture-changed", notify);
    document.documentElement.requestFullscreen = vi
      .fn()
      .mockRejectedValue(new Error("Denied"));
    await expect(setBigPicture(true)).rejects.toThrow("Denied");
    expect(readBigPicture()).toBe(true);
    expect(notify).toHaveBeenCalledOnce();
    window.removeEventListener("playstash:big-picture-changed", notify);
  });
  it("enters and exits native fullscreen", async () => {
    mocks.desktop = true;
    await setBigPicture(true);
    await setBigPicture(false);
    expect(mocks.fullscreen.mock.calls).toEqual([[true], [false]]);
    expect(readBigPicture()).toBe(false);
  });
});
