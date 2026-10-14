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
  save: vi.fn(),
  invoke: vi.fn(),
  desktop: false,
  user: { id: 1, username: "ada", role: 1 } as {
    id?: number;
    username: string;
    role: number;
  },
}));
vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    serverUrl: "https://library.test",
    user: mocks.user,
    authFetch: mocks.fetch,
    getAccessToken: async () => "test-token",
  }),
}));
vi.mock("@/context/AlertDialogContext", () => ({
  useAlertDialog: () => ({ showAlert: mocks.confirm }),
}));
vi.mock("@/utils/tauri", () => ({ isTauriApp: () => mocks.desktop }));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: mocks.open,
  save: mocks.save,
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));

const versions = [
  {
    filename: "save version.zip",
    size: 100,
    created_at: "2026-10-13T12:00:00Z",
    installation_id: "abc",
  },
];

function respond(url: string) {
  if (url.endsWith("/api/users")) {
    return {
      ok: true,
      json: async () => [
        { id: 1, username: "ada", role: 3 },
        { id: 2, username: "bob", role: 1 },
      ],
    };
  }
  if (url.endsWith("/versions"))
    return { ok: true, json: async () => versions };
  return { ok: true, json: async () => ({}) };
}

describe("cloud save versions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.desktop = false;
    mocks.user = { id: 1, username: "ada", role: 1 };
    mocks.fetch.mockImplementation(async (url: string) => respond(url));
  });
  afterEach(cleanup);

  const calledUrls = () =>
    mocks.fetch.mock.calls.map((call) => String(call[0]));

  it("lets admins pick any user and reloads for the chosen user", async () => {
    mocks.user = { id: 1, username: "ada", role: 3 };
    render(<GameSaves gameId={7} gameTitle="Celeste" />);
    expect(screen.getByText("Cloud Saves — Celeste")).toBeTruthy();
    await screen.findByText("save version.zip");
    expect(calledUrls()).toContain("https://library.test/api/users");
    const select = (await screen.findByRole("combobox")) as HTMLSelectElement;
    await screen.findByRole("option", { name: "bob" });
    expect(select.disabled).toBe(false);
    fireEvent.change(select, { target: { value: "2" } });
    await waitFor(() =>
      expect(calledUrls()).toContain(
        "https://library.test/api/savefiles/user/2/game/7/versions",
      ),
    );
  });

  it("limits other users to themselves", async () => {
    render(<GameSaves gameId={7} />);
    await screen.findByText("save version.zip");
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.disabled).toBe(true);
    expect(
      screen.getAllByRole("option").map((option) => option.textContent),
    ).toEqual(["ada"]);
    expect(calledUrls()).not.toContain("https://library.test/api/users");
    expect(calledUrls()).toEqual([
      "https://library.test/api/savefiles/user/1/game/7/versions",
    ]);
    expect(screen.getByText("1 stored versions.")).toBeTruthy();
  });

  it("never requests a URL without a user id", async () => {
    mocks.user = { username: "ghost", role: 1 };
    render(<GameSaves gameId={7} />);
    await screen.findByText(
      "No cloud save archives are stored for this user and game.",
    );
    expect(calledUrls().some((url) => url.includes("undefined"))).toBe(false);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("confirms before deleting the selected archive", async () => {
    render(<GameSaves gameId={7} />);
    await screen.findByText("save version.zip");
    fireEvent.click(screen.getByRole("button", { name: "Delete selected" }));
    expect(
      await screen.findByText("Select a save archive first."),
    ).toBeTruthy();
    expect(mocks.confirm).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("radio", { name: "save version.zip" }));
    mocks.confirm.mockResolvedValueOnce(false);
    fireEvent.click(screen.getByRole("button", { name: "Delete selected" }));
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1));
    expect(mocks.confirm.mock.calls[0][0]).toMatchObject({
      title: "Delete Cloud Save",
      description:
        "Delete save archive 'save version.zip'? This cannot be undone.",
    });
    expect(
      mocks.fetch.mock.calls.some((call) => call[1]?.method === "DELETE"),
    ).toBe(false);

    mocks.confirm.mockResolvedValueOnce(true);
    fireEvent.click(screen.getByRole("button", { name: "Delete selected" }));
    await waitFor(() =>
      expect(mocks.fetch).toHaveBeenCalledWith(
        "https://library.test/api/savefiles/user/1/game/7/versions/save%20version.zip",
        { method: "DELETE" },
      ),
    );
    await waitFor(() =>
      expect(
        calledUrls().filter((url) => url.endsWith("/versions")).length,
      ).toBe(2),
    );
  });

  it("streams desktop downloads to the chosen file", async () => {
    mocks.desktop = true;
    mocks.invoke.mockImplementation(async (command: string) =>
      command === "get_cloud_save_installation_ids" ? [] : undefined,
    );
    mocks.save.mockResolvedValue("C:/saves/save version.zip");
    render(<GameSaves gameId={7} />);
    await screen.findByText("save version.zip");
    fireEvent.click(screen.getByRole("radio", { name: "save version.zip" }));
    fireEvent.click(screen.getByRole("button", { name: "Download selected" }));
    await screen.findByText("Save archive downloaded.");
    expect(mocks.save).toHaveBeenCalledWith({
      defaultPath: "save version.zip",
      filters: [{ name: "Save archives", extensions: ["zip"] }],
    });
    expect(mocks.invoke).toHaveBeenCalledWith("download_to_file", {
      url: "https://library.test/api/savefiles/user/1/game/7/versions/save%20version.zip",
      path: "C:/saves/save version.zip",
      authHeader: "Bearer test-token",
    });
  });

  it("requires overwrite confirmation before restoring into a folder", async () => {
    mocks.desktop = true;
    mocks.invoke.mockResolvedValue([]);
    render(<GameSaves gameId={7} />);
    await screen.findByText("save version.zip");
    fireEvent.click(screen.getByRole("radio", { name: "save version.zip" }));
    mocks.open.mockResolvedValue("C:/games/My Game/Saves");
    mocks.confirm.mockResolvedValue(false);
    fireEvent.click(screen.getByRole("button", { name: "Restore to folder" }));
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalled());
    expect(mocks.invoke).not.toHaveBeenCalledWith(
      "install_game_addon",
      expect.anything(),
    );
  });
});
