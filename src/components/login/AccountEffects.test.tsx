// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: null as { id: number } | null,
  tauri: true,
  cancelAllDownloads: vi.fn(),
}));
vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: mocks.user }),
}));
vi.mock("@/context/DownloadContext", () => ({
  useDownloads: () => ({ cancelAllDownloads: mocks.cancelAllDownloads }),
}));
vi.mock("@/utils/tauri", () => ({ isTauriApp: () => mocks.tauri }));

import { SessionEndEffect } from "./AccountEffects";

describe("SessionEndEffect", () => {
  beforeEach(() => {
    mocks.user = null;
    mocks.tauri = true;
    mocks.cancelAllDownloads.mockReset();
  });
  afterEach(cleanup);

  it("cancels the downloads when the user signs out", async () => {
    const view = render(<SessionEndEffect />);
    expect(mocks.cancelAllDownloads).not.toHaveBeenCalled();
    mocks.user = { id: 1 };
    await act(async () => view.rerender(<SessionEndEffect />));
    expect(mocks.cancelAllDownloads).not.toHaveBeenCalled();
    mocks.user = null;
    await act(async () => view.rerender(<SessionEndEffect />));
    expect(mocks.cancelAllDownloads).toHaveBeenCalledTimes(1);
  });

  it("leaves web downloads alone", async () => {
    mocks.tauri = false;
    mocks.user = { id: 1 };
    const view = render(<SessionEndEffect />);
    mocks.user = null;
    await act(async () => view.rerender(<SessionEndEffect />));
    expect(mocks.cancelAllDownloads).not.toHaveBeenCalled();
  });
});
