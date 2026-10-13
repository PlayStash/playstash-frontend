// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { GameReviews } from "./GameReviews";
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), confirm: vi.fn() }));
vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    serverUrl: "https://library.test",
    user: { id: 1, username: "My user" },
    authFetch: mocks.fetch,
  }),
}));
vi.mock("@/context/AlertDialogContext", () => ({
  useAlertDialog: () => ({ showAlert: mocks.confirm }),
}));
afterEach(cleanup);
it("requires explicit username publication consent before submitting a review", async () => {
  mocks.fetch.mockResolvedValue({
    ok: true,
    json: async () => ({
      reviews: [],
      my_review: null,
      average_rating: null,
      total: 0,
      page: 1,
      limit: 10,
    }),
  });
  render(<GameReviews gameId={7} />);
  await waitFor(() =>
    expect(screen.queryByText("Loading reviews…")).toBeNull(),
  );
  const publish = screen.getByRole("button", { name: "Publish review" });
  expect((publish as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByRole("combobox", { name: "Rating" }), {
    target: { value: "4" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "Review (optional)" }), {
    target: { value: "My review" },
  });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(publish);
  await screen.findByText("Review published.");
  expect(mocks.fetch).toHaveBeenCalledWith(
    "https://library.test/api/games/7/reviews/me",
    expect.objectContaining({
      method: "PUT",
      body: JSON.stringify({ rating: 4, comment: "My review" }),
    }),
  );
  expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(
    false,
  );
});
