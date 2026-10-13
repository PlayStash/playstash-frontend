// @vitest-environment jsdom
import {
  render,
  screen,
  waitFor,
  fireEvent,
  cleanup,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PackageContents } from "./PackageContents";
const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  confirm: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    serverUrl: "https://library.test",
    authFetch: mocks.fetch,
    getAccessToken: async () => "test-token",
  }),
}));
vi.mock("@/context/OfflineContext", () => ({
  useOnlineStatus: () => ({ isOnline: true }),
}));
vi.mock("@/context/AlertDialogContext", () => ({
  useAlertDialog: () => ({ showAlert: mocks.confirm }),
}));
vi.mock("@/utils/tauri", () => ({ isTauriApp: () => true }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
const descriptor = {
  extras: [],
  addons: [
    {
      id: "patch",
      title: "Patch 1",
      kind: "patch",
      path: "Addons/patch.zip",
      size: "100",
    },
    {
      id: "mod",
      title: "Mod 1",
      kind: "mod",
      path: "Addons/mod.7z",
      size: "100",
    },
  ],
};
describe("package addon installation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetch.mockResolvedValue({ ok: true, json: async () => descriptor });
    mocks.invoke.mockResolvedValue(1);
  });
  afterEach(cleanup);
  const mount = async () => {
    render(
      <PackageContents
        gameId={7}
        installationPath="/games/My Game"
        archivePassword=" secret "
        onLaunch={vi.fn()}
        onRecipe={vi.fn()}
      />,
    );
    await screen.findByText("Patch 1");
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    fireEvent.click(screen.getAllByRole("checkbox")[1]);
  };
  it("doesn't modify the installation when overwrite confirmation is declined", async () => {
    await mount();
    mocks.confirm.mockResolvedValue(false);
    fireEvent.click(
      screen.getByRole("button", { name: "Apply selected addons" }),
    );
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalled());
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it("awaits addons in chosen order and preserves password whitespace", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Move addon 2 up" }));
    mocks.confirm.mockResolvedValue(true);
    fireEvent.click(
      screen.getByRole("button", { name: "Apply selected addons" }),
    );
    await screen.findByText("Applied 2 addons.");
    expect(mocks.invoke.mock.calls.map((call) => call[1].archiveName)).toEqual([
      "mod.7z",
      "patch.zip",
    ]);
    expect(mocks.invoke.mock.calls[0][1]).toMatchObject({
      overwriteConfirmed: true,
      installationPath: "/games/My Game",
      password: " secret ",
    });
  });
  it("stops the sequence after an error", async () => {
    await mount();
    mocks.confirm.mockResolvedValue(true);
    mocks.invoke.mockRejectedValue(new Error("Wrong password"));
    fireEvent.click(
      screen.getByRole("button", { name: "Apply selected addons" }),
    );
    await screen.findByText(/Wrong password/);
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Stopped after 0 completed addons.")).toBeTruthy();
  });
});
