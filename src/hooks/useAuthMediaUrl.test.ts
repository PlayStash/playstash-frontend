// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthMediaUrl } from "@/hooks/useAuthMediaUrl";

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  auth: null as null | Record<string, unknown>,
}));
vi.mock("@/context/AuthContext", () => ({
  useAuth: () => {
    mocks.auth ??= { serverUrl: "https://library.test", authFetch: vi.fn() };
    return mocks.auth;
  },
}));
vi.mock("@/context/OfflineContext", () => ({
  useOnlineStatus: () => ({ isOnline: true }),
}));
vi.mock("@/utils/mediaCache", () => ({
  resolveApiMediaBlob: mocks.resolve,
  invalidateMedia: vi.fn(async () => undefined),
}));

const abortError = () => new DOMException("aborted", "AbortError");
let urlCounter = 0;

beforeEach(() => {
  urlCounter = 0;
  mocks.resolve.mockReset();
  // jsdom has no object URLs.
  URL.createObjectURL = vi.fn(() => `blob:test/${++urlCounter}`);
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => cleanup());

describe("useAuthMediaUrl", () => {
  it("retries once after an abort it did not cause", async () => {
    mocks.resolve
      .mockRejectedValueOnce(abortError())
      .mockResolvedValueOnce(new Blob(["cover"]));
    const { result } = renderHook(() => useAuthMediaUrl(7));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.url).toBe("blob:test/1");
    expect(result.current.error).toBeNull();
    expect(mocks.resolve).toHaveBeenCalledTimes(2);
  });

  it("settles as an error when foreign aborts persist", async () => {
    mocks.resolve.mockRejectedValue(abortError());
    const { result } = renderHook(() => useAuthMediaUrl(7));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.url).toBeNull();
    expect(result.current.error).toBe("Failed to load image");
    expect(mocks.resolve).toHaveBeenCalledTimes(2);
  });

  it("reloads a media after switching back from one that failed", async () => {
    mocks.resolve.mockImplementation(async ({ mediaId }) => {
      if (mediaId === 2) throw new Error("Media fetch failed (500)");
      return new Blob([`media-${mediaId}`]);
    });
    const { result, rerender } = renderHook(({ id }) => useAuthMediaUrl(id), {
      initialProps: { id: 1 },
    });
    await waitFor(() => expect(result.current.url).toBe("blob:test/1"));

    rerender({ id: 2 });
    await waitFor(() =>
      expect(result.current.error).toBe("Media fetch failed (500)"),
    );
    expect(result.current.url).toBeNull();

    rerender({ id: 1 });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.url).toBe("blob:test/2");
    expect(result.current.error).toBeNull();
    expect(mocks.resolve).toHaveBeenCalledTimes(3);
  });
});
