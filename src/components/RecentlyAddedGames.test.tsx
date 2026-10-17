// @vitest-environment jsdom
import { render, cleanup, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useGames } from "@/hooks/useGames";
import { RecentlyAddedGames } from "./RecentlyAddedGames";

vi.mock("@/hooks/useGames", () => ({
  useGames: vi.fn(() => ({
    games: [],
    count: 0,
    loading: false,
    error: null,
    loadMore: vi.fn(),
    hasMore: false,
  })),
}));
vi.mock("./GameCard", () => ({ default: () => null }));

afterEach(cleanup);

it("narrows the recently added games by the library search", () => {
  render(<RecentlyAddedGames search="witch" />);
  expect(vi.mocked(useGames)).toHaveBeenLastCalledWith(
    expect.objectContaining({ search: "witch", sortBy: "created_at" }),
  );
  expect(
    screen.getByText("No recently added games match the search."),
  ).toBeTruthy();
});

it("lists all recently added games without a search", () => {
  render(<RecentlyAddedGames />);
  expect(vi.mocked(useGames)).toHaveBeenLastCalledWith(
    expect.objectContaining({ search: "" }),
  );
  expect(screen.getByText("No games added in the last week.")).toBeTruthy();
});
