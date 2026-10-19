// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDiskUsage } from "@/hooks/useDiskUsage";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/utils/tauri", () => ({ isTauriApp: () => true }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));

const usage = (total: number) => ({
  total,
  free: 1,
  currentGameSize: 0,
  otherGamesSize: 0,
  unmanagedData: 0,
});

afterEach(() => {
  cleanup();
  mocks.invoke.mockReset();
});

describe("useDiskUsage", () => {
  it("drops a refetch that resolves after the root changed", async () => {
    let releaseRefetch: ((value: unknown) => void) | undefined;
    mocks.invoke
      // Initial load for root A.
      .mockResolvedValueOnce(usage(100))
      // Slow refetch for root A.
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseRefetch = resolve;
          }),
      )
      // Load for root B.
      .mockResolvedValueOnce(usage(200));

    const { result, rerender } = renderHook(
      ({ root }) => useDiskUsage(root, null),
      { initialProps: { root: "A:/" } },
    );
    await waitFor(() => expect(result.current.data?.total).toBe(100));

    act(() => result.current.refetch());
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(2));
    rerender({ root: "B:/" });
    await waitFor(() => expect(result.current.data?.total).toBe(200));
    expect(result.current.loading).toBe(false);

    await act(async () => {
      releaseRefetch?.(usage(100));
      await Promise.resolve();
    });
    expect(result.current.data?.total).toBe(200);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });
});
