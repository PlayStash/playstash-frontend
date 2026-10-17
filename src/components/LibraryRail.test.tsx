// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useGames } from "@/hooks/useGames";
import { resetLibraryLoadGate } from "@/utils/libraryPreferences";
import { LibraryRail } from "./LibraryRail";

const state = vi.hoisted(() => ({
  loadMore: vi.fn(),
  refetch: vi.fn(),
  error: null as string | null,
  hasMore: false,
}));
vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ serverUrl: "https://library.test" }),
}));
vi.mock("@/context/OfflineContext", () => ({
  useOnlineStatus: () => ({ isOnline: true }),
}));
vi.mock("@/hooks/useGames", () => ({
  getGameCoverMediaId: () => null,
  useGames: vi.fn(() => ({
    games: [
      { id: 2, title: "Beta" },
      { id: 1, title: "Alpha" },
    ],
    count: 2,
    loading: false,
    ...state,
  })),
}));

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  resetLibraryLoadGate();
  state.error = null;
  state.hasMore = false;
});
afterEach(cleanup);

it("keeps the startup load gate closed until the user searches", async () => {
  localStorage.setItem("playstash_library_autoload", "false");
  render(
    <MemoryRouter initialEntries={["/library"]}>
      <LibraryRail />
    </MemoryRouter>,
  );
  expect(vi.mocked(useGames)).toHaveBeenLastCalledWith(
    expect.objectContaining({ enabled: false }),
  );
  fireEvent.change(screen.getByRole("searchbox", { name: "Find a game" }), {
    target: { value: "Alpha" },
  });
  await waitFor(() =>
    expect(vi.mocked(useGames)).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: true, search: "Alpha" }),
    ),
  );
});

it("sorts actual games alphabetically and marks the open game", () => {
  render(
    <MemoryRouter initialEntries={["/library/2"]}>
      <LibraryRail />
    </MemoryRouter>,
  );
  const games = screen
    .getAllByRole("link")
    .filter((link) => /^\/library\/\d+$/.test(link.getAttribute("href") || ""));
  expect(games.map((game) => game.getAttribute("title"))).toEqual([
    "Alpha",
    "Beta",
  ]);
  expect(screen.getByRole("link", { name: "Beta" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

it("uses the existing bookmarked URL filter when favorites are selected", async () => {
  const navigate = vi.fn();
  render(
    <MemoryRouter initialEntries={["/library"]}>
      <LibraryRail onNavigate={navigate} />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("link", { name: "Favorites" }));
  await waitFor(() =>
    expect(vi.mocked(useGames)).toHaveBeenLastCalledWith(
      expect.objectContaining({ bookmarkFilter: "mine" }),
    ),
  );
  expect(navigate).toHaveBeenCalledOnce();
  expect(screen.getByRole("link", { name: "Favorites" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  fireEvent.click(screen.getByRole("link", { name: "Alpha" }));
  await waitFor(() =>
    expect(vi.mocked(useGames)).toHaveBeenLastCalledWith(
      expect.objectContaining({ bookmarkFilter: "mine" }),
    ),
  );
});

it("lets users retry an error and load the next page", () => {
  state.error = "The server could not be reached";
  state.hasMore = true;
  render(
    <MemoryRouter>
      <LibraryRail />
    </MemoryRouter>,
  );
  expect(screen.getByRole("alert")).toHaveTextContent(state.error);
  fireEvent.click(
    within(screen.getByRole("alert")).getByRole("button", {
      name: "Reload Library",
    }),
  );
  expect(state.refetch).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Load more games" }));
  expect(state.loadMore).toHaveBeenCalledOnce();
});
