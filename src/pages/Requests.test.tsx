// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Requests from "./Requests";
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), confirm: vi.fn(), role: 1 }));
vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    serverUrl: "https://library.test",
    user: { id: 1, role: mocks.role },
    authFetch: mocks.fetch,
  }),
}));
vi.mock("@/context/AlertDialogContext", () => ({
  useAlertDialog: () => ({ showAlert: mocks.confirm }),
}));
const list = {
  requests: [],
  total: 0,
  page: 1,
  limit: 20,
  unread_count: 0,
  open_count: 0,
};
describe("game requests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.role = 1;
    mocks.fetch.mockResolvedValue({ ok: true, json: async () => list });
  });
  afterEach(cleanup);
  it("submits the selected anonymous preference without adding identity fields", async () => {
    render(
      <MemoryRouter>
        <Requests />
      </MemoryRouter>,
    );
    await screen.findByText("No requests yet.");
    fireEvent.change(screen.getByRole("textbox", { name: "Game title" }), {
      target: { value: "New game" },
    });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));
    await screen.findByText("Request sent to your library administrator.");
    expect(mocks.fetch).toHaveBeenCalledWith(
      "https://library.test/api/requests",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ title: "New game", note: "", anonymous: true }),
      }),
    );
  });
  it("lets an administrator fulfil a request with a valid library game ID", async () => {
    mocks.role = 3;
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        ...list,
        requests: [
          {
            id: 4,
            title: "Requested game",
            note: "",
            anonymous: true,
            status: "open",
            mine: false,
            unread: false,
            updated_at: "2026-10-13T12:00:00Z",
          },
        ],
        total: 1,
      }),
    });
    render(
      <MemoryRouter>
        <Requests />
      </MemoryRouter>,
    );
    await screen.findByText("Requested game");
    fireEvent.change(screen.getByRole("combobox", { name: "Status" }), {
      target: { value: "fulfilled" },
    });
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "Added game ID (optional)" }),
      { target: { value: "42" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Save status" }));
    expect(mocks.fetch).toHaveBeenCalledWith(
      "https://library.test/api/requests/4",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ status: "fulfilled", game_id: 42 }),
      }),
    );
  });
});
