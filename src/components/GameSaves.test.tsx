// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameSaves } from "./GameSaves";
const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  confirm: vi.fn(),
  open: vi.fn(),
  invoke: vi.fn(),
}));
vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    serverUrl: "https://library.test",
    user: { id: 1 },
    authFetch: mocks.fetch,
    getAccessToken: async () => "test-token",
  }),
}));
vi.mock("@/context/AlertDialogContext", () => ({
  useAlertDialog: () => ({ showAlert: mocks.confirm }),
}));
vi.mock("@/utils/tauri", () => ({ isTauriApp: () => true }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mocks.open }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
describe("versioned game saves", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => [
        {
          filename: "save version.zip",
          size: 100,
          created_at: "2026-10-13T12:00:00Z",
        },
      ],
    });
  });
  afterEach(cleanup);
  it("requires overwrite confirmation after the user chooses a local save folder", async () => {
    render(<GameSaves gameId={7} />);
    await screen.findByText("save version.zip");
    mocks.open.mockResolvedValue("C:/games/My Game/Saves");
    mocks.confirm.mockResolvedValue(false);
    fireEvent.click(
      screen.getByRole("button", { name: "Restore to save folder" }),
    );
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalled());
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it("deletes only the explicitly chosen save version", async () => {
    render(<GameSaves gameId={7} />);
    await screen.findByText("save version.zip");
    mocks.confirm.mockResolvedValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Delete version" }));
    await screen.findByText("Save version deleted.");
    expect(mocks.fetch).toHaveBeenCalledWith(
      "https://library.test/api/savefiles/user/1/game/7/versions/save%20version.zip",
      { method: "DELETE" },
    );
  });
});
