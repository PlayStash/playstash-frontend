// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildGamesQueryParams } from "@/utils/gamesQuery";
import { libraryFilterLink } from "@/utils/libraryLinks";
import { resetLibraryLoadGate } from "@/utils/libraryPreferences";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  alert: vi.fn(),
  isTauri: false,
  installed: [] as any[],
}));

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
vi.mock("@/context/AlertDialogContext", () => ({
  useAlertDialog: () => ({ showAlert: mocks.alert }),
}));
vi.mock("@/context/OfflineContext", () => ({
  useOnlineStatus: () => ({ isOnline: true }),
}));
vi.mock("@/utils/tauri", () => ({
  isTauriApp: () => mocks.isTauri,
  isTauriDesktop: () => false,
}));
const refetchInstalled = vi.hoisted(() => () => {});
vi.mock("@/hooks/useInstalledGames", () => ({
  useInstalledGames: () => ({
    installedGames: mocks.installed,
    refetch: refetchInstalled,
  }),
}));
vi.mock("@/components/GameCard", () => ({
  default: ({ game }: { game: { id: number; title: string } }) => (
    <div data-testid="game-card">{game.title}</div>
  ),
}));
vi.mock("@/components/LibraryCategories", () => ({
  LibraryCategories: () => null,
}));
vi.mock("@/components/RecentlyAddedGames", () => ({
  RecentlyAddedGames: () => null,
}));
vi.mock("@/components/BigPicture", () => ({ BigPictureButton: () => null }));
vi.mock("@/hooks/useScrollRestoration", () => ({
  useScrollRestoration: () => {},
}));

import Library from "./Library";

function page(data: { id: number; title: string }[]) {
  return {
    ok: true,
    json: async () => ({
      data,
      meta: { totalItems: data.length },
      links: { next: null },
    }),
  };
}

function GameRoute() {
  const location = useLocation();
  return <div data-testid="game-route">{location.pathname}</div>;
}

function renderLibrary(initial = "/library") {
  // The Library reads its filters from the window URL.
  window.history.replaceState({}, "", initial);
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <Routes>
        <Route path="/library" element={<Library />} />
        <Route path="/library/:id" element={<GameRoute />} />
      </Routes>
    </MemoryRouter>,
  );
}

const gamesCalls = () =>
  mocks.fetch.mock.calls
    .map((call) => String(call[0]))
    .filter((url) => url.includes("/api/games?") && !url.includes("limit=-1"));

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  resetLibraryLoadGate();
  mocks.isTauri = false;
  mocks.installed = [];
  (globalThis as any).IntersectionObserver = class {
    observe() {}
    disconnect() {}
  };
  window.history.replaceState({}, "", "/library");
  mocks.fetch.mockImplementation(async (url: string) => {
    if (url.endsWith("/api/games/random")) {
      return { ok: true, json: async () => ({ id: 42, title: "Lucky" }) };
    }
    return page([
      { id: 1, title: "Alpha" },
      { id: 2, title: "Beta" },
    ]);
  });
});
afterEach(cleanup);

describe("Library", { timeout: 20000 }, () => {
  it("I'm Feeling Lucky opens a random game", async () => {
    renderLibrary();
    fireEvent.click(
      await screen.findByRole("button", { name: "I'm Feeling Lucky" }),
    );
    expect(
      await screen.findByTestId("game-route", {}, { timeout: 5000 }),
    ).toHaveTextContent("/library/42");
    expect(mocks.fetch).toHaveBeenCalledWith(
      "https://library.test/api/games/random",
    );
  });

  it("shows the server message when no random game is found", async () => {
    mocks.fetch.mockImplementation(async (url: string) =>
      url.endsWith("/api/games/random")
        ? {
            ok: false,
            statusText: "",
            text: async () => JSON.stringify({ message: "Library is empty" }),
          }
        : page([]),
    );
    renderLibrary();
    fireEvent.click(
      await screen.findByRole("button", { name: "I'm Feeling Lucky" }),
    );
    await waitFor(() =>
      expect(mocks.alert).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Library is empty" }),
      ),
    );
  });

  it("builds the age rating filter", () => {
    expect(
      buildGamesQueryParams({ ageRating: "12" }).get(
        "filter.metadata.age_rating",
      ),
    ).toBe("$eq:12");
    expect(
      buildGamesQueryParams({ ageRating: "null" }).get(
        "filter.metadata.age_rating",
      ),
    ).toBe("$null");
    expect(
      buildGamesQueryParams({ ageRating: "all" }).has(
        "filter.metadata.age_rating",
      ),
    ).toBe(false);
  });

  it("applies the ageRating URL parameter to the request", async () => {
    renderLibrary("/library?ageRating=16");
    await waitFor(() =>
      expect(
        gamesCalls().some((url) =>
          url.includes("filter.metadata.age_rating=%24eq%3A16"),
        ),
      ).toBe(true),
    );
  });

  it("hides installed games client-side without refetching", async () => {
    mocks.isTauri = true;
    mocks.installed = [
      {
        gameId: 2,
        gameTitle: "Beta",
        gameType: "WINDOWS_PORTABLE",
        installationDirectory: "C:/g/Beta",
        versionDirectory: "C:/g/Beta/v1",
        versionId: 1,
        versionName: "v1",
        gameMetadata: null,
        cachedMetadata: null,
        installedAt: 0,
        lastPlayedAt: 0,
      },
    ];
    renderLibrary();
    await waitFor(() => expect(gamesCalls()).toHaveLength(1));
    // Server Games list: only the non-installed game is shown.
    expect(await screen.findByText("Server Games (1 of 2)")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /show filters/i }));
    fireEvent.click(
      await screen.findByRole("checkbox", { name: "Hide installed games" }),
    );
    expect(await screen.findByText("Server Games (2 of 2)")).toBeTruthy();
    expect(gamesCalls()).toHaveLength(1);
  });

  it("GameView pill links carry exactly one filter", async () => {
    expect(libraryFilterLink("genres", "Role Playing, Indie")).toBe(
      "/library?genres=Role+Playing%2C+Indie",
    );
    window.history.replaceState({}, "", libraryFilterLink("tags", "Co-op"));
    renderLibrary(libraryFilterLink("tags", "Co-op"));
    await waitFor(() => expect(gamesCalls().length).toBeGreaterThan(0));
    const calls = gamesCalls();
    const url = new URL(calls[calls.length - 1]);
    expect(url.searchParams.get("filter.metadata.tags.name")).toBe("$in:Co-op");
    expect(url.searchParams.has("filter.metadata.genres.name")).toBe(false);
    expect(url.searchParams.has("filter.type")).toBe(false);
  });

  it("does not load server games with auto-load off until the user asks", async () => {
    localStorage.setItem("playstash_library_autoload", "false");
    renderLibrary();
    expect(
      await screen.findByRole("button", { name: "Load library" }),
    ).toBeTruthy();
    expect(gamesCalls()).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Load library" }));
    await waitFor(() => expect(gamesCalls()).toHaveLength(1));
  });
});
