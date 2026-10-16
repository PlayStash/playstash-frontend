// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invalidateGamesCache, useGames } from "@/hooks/useGames";

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));

const auth = vi.hoisted(() => ({
  value: null as null | Record<string, unknown>,
}));
vi.mock("@/context/AuthContext", () => ({
  useAuth: () => {
    // A stable value, like the real provider between renders.
    auth.value ??= {
      serverUrl: "https://library.test",
      user: { id: 1, role: 1 },
      authFetch: mocks.fetch,
    };
    return auth.value;
  },
}));
vi.mock("@/context/OfflineContext", () => ({
  useOnlineStatus: () => ({ isOnline: true }),
}));
vi.mock("@/utils/tauri", () => ({ isTauriApp: () => false }));

const TOTAL = 53;
const allGames = Array.from({ length: TOTAL }, (_, i) => ({
  id: i + 1,
  title: `Game ${i + 1}`,
}));

/** Answers like the server: `page`/`limit` slices, an absolute next link. */
function serveGames(url: string) {
  const params = new URL(url).searchParams;
  const limit = Number(params.get("limit"));
  const page = Number(params.get("page") ?? "1");
  const data = allGames.slice((page - 1) * limit, page * limit);
  return Promise.resolve(
    new Response(
      JSON.stringify({
        data,
        meta: { totalItems: TOTAL },
        // An address the client cannot reach, e.g. behind a proxy.
        links: { next: `http://backend:8080/api/games?page=${page + 1}` },
      }),
    ),
  );
}

const options = { search: "", sortBy: "sort_title", order: "ASC" as const };

beforeEach(() => {
  invalidateGamesCache();
  mocks.fetch.mockReset();
  mocks.fetch.mockImplementation(serveGames);
});

afterEach(() => cleanup());

describe("useGames", () => {
  it("loads the next page from the selected server, not the server's link", async () => {
    const { result } = renderHook(() => useGames(options));
    await waitFor(() => expect(result.current.games).toHaveLength(50));
    expect(result.current.count).toBe(TOTAL);
    expect(result.current.hasMore).toBe(true);

    await act(() => result.current.loadMore());

    expect(result.current.games).toHaveLength(TOTAL);
    expect(result.current.hasMore).toBe(false);
    const nextUrl = new URL(mocks.fetch.mock.calls[1][0]);
    expect(nextUrl.origin).toBe("https://library.test");
    expect(nextUrl.searchParams.get("page")).toBe("2");
    expect(nextUrl.searchParams.get("limit")).toBe("50");
    expect(nextUrl.searchParams.get("sortBy")).toBe("sort_title:ASC");
  });

  it("keeps every loaded page when the list is shown again", async () => {
    const first = renderHook(() => useGames(options));
    await waitFor(() => expect(first.result.current.games).toHaveLength(50));
    await act(() => first.result.current.loadMore());
    expect(first.result.current.games).toHaveLength(TOTAL);
    first.unmount();

    // Back from a game page: the cached list stays complete while it is
    // refreshed with every loaded page instead of only the first one.
    mocks.fetch.mockClear();
    const second = renderHook(() => useGames(options));
    expect(second.result.current.games).toHaveLength(TOTAL);
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1));
    const refreshUrl = new URL(mocks.fetch.mock.calls[0][0]);
    expect(refreshUrl.searchParams.get("limit")).toBe("100");
    expect(refreshUrl.searchParams.get("page")).toBe("1");
    await waitFor(() =>
      expect(second.result.current.games).toHaveLength(TOTAL),
    );
    expect(second.result.current.hasMore).toBe(false);
  });

  it("starts over at the first page for other filters", async () => {
    const { result, rerender } = renderHook((props) => useGames(props), {
      initialProps: options,
    });
    await waitFor(() => expect(result.current.games).toHaveLength(50));
    await act(() => result.current.loadMore());
    expect(result.current.games).toHaveLength(TOTAL);

    mocks.fetch.mockClear();
    rerender({ ...options, search: "game" });
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1));
    const url = new URL(mocks.fetch.mock.calls[0][0]);
    expect(url.searchParams.get("limit")).toBe("50");
    expect(url.searchParams.get("search")).toBe("game");
    await waitFor(() => expect(result.current.games).toHaveLength(50));
  });
});
