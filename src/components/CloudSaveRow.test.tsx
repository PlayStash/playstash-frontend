// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CloudSaveRow } from "./CloudSaveRow";

const mocks = vi.hoisted(() => ({
  getSaveFolders: vi.fn(),
  setSaveFolders: vi.fn(),
  matchCloudSaveTitle: vi.fn(),
  open: vi.fn(),
  sessionListener: null as null | ((event: any) => void),
}));

vi.mock("@/utils/tauri", () => ({ isTauriApp: () => true }));
vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    serverUrl: "https://games.test",
    user: { id: 1 },
    getAccessToken: async () => "token",
  }),
}));
vi.mock("@/context/OfflineContext", () => ({
  useOnlineStatus: () => ({ isOnline: true }),
}));
vi.mock("@/context/AlertDialogContext", () => ({
  useAlertDialog: () => ({ showAlert: vi.fn() }),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mocks.open }));
vi.mock("@/utils/gameSessions", () => ({
  onGameSession: async (callback: (event: any) => void) => {
    mocks.sessionListener = callback;
    return () => undefined;
  },
}));
vi.mock("@/utils/cloudSaves", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/cloudSaves")>()),
  getSaveFolders: mocks.getSaveFolders,
  setSaveFolders: mocks.setSaveFolders,
  matchCloudSaveTitle: mocks.matchCloudSaveTitle,
}));

const game = { id: 46, title: "Exquisite Fishing", metadata: {} } as any;
const installed = {
  gameId: 46,
  installationDirectory: "D:/Games/Fishing/Installation",
  versionDirectory: "D:/Games/Fishing/Versions/1",
} as any;

beforeEach(() => {
  mocks.matchCloudSaveTitle.mockResolvedValue("");
  mocks.setSaveFolders.mockResolvedValue({ source: "local", paths: [] });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("shows the row for games Ludusavi does not know and lets the user choose a folder", async () => {
  mocks.getSaveFolders.mockResolvedValue({ source: "none", paths: [] });
  mocks.open.mockResolvedValue(
    "C:/Users/N/AppData/LocalLow/PinkySoul/ExquisiteFishing",
  );
  render(<CloudSaveRow game={game} installed={installed} />);
  expect(await screen.findByText(/No save folder known yet/)).toBeTruthy();
  expect(
    (screen.getByText("Backup").closest("button") as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  fireEvent.click(screen.getByText("Choose save folder"));
  await vi.waitFor(() =>
    expect(mocks.setSaveFolders).toHaveBeenCalledWith({
      installationPath: installed.installationDirectory,
      versionDirectory: installed.versionDirectory,
      folders: ["C:/Users/N/AppData/LocalLow/PinkySoul/ExquisiteFishing"],
    }),
  );
});

it("lists detected folders and enables sync for the custom save definition", async () => {
  mocks.getSaveFolders.mockResolvedValue({
    source: "detected",
    paths: [
      {
        path: "%LOCALAPPDATALOW%/PinkySoul/ExquisiteFishing",
        resolved: "C:/Users/N/AppData/LocalLow/PinkySoul/ExquisiteFishing",
        exists: false,
      },
    ],
  });
  mocks.matchCloudSaveTitle.mockResolvedValue(
    "PlayStash #46 Exquisite Fishing",
  );
  render(<CloudSaveRow game={game} installed={installed} />);
  expect(
    await screen.findByText("%LOCALAPPDATALOW%/PinkySoul/ExquisiteFishing"),
  ).toBeTruthy();
  expect(screen.getByText("(not created yet)")).toBeTruthy();
  await vi.waitFor(() =>
    expect(
      (screen.getByText("Backup").closest("button") as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByText("Detect"));
  await vi.waitFor(() =>
    expect(mocks.getSaveFolders).toHaveBeenCalledWith(
      expect.objectContaining({ detect: true }),
    ),
  );
});

it("uses the server's folders and hides local folder controls", async () => {
  const serverGame = {
    ...game,
    metadata: { save_paths: ["%APPDATA%/Studio/Game"] },
  };
  mocks.getSaveFolders.mockResolvedValue({
    source: "server",
    paths: [{ path: "%APPDATA%/Studio/Game", resolved: "x", exists: true }],
  });
  render(<CloudSaveRow game={serverGame} installed={installed} />);
  expect(
    await screen.findByText("Save folders set on the server:"),
  ).toBeTruthy();
  expect(mocks.getSaveFolders).toHaveBeenCalledWith(
    expect.objectContaining({ serverPaths: ["%APPDATA%/Studio/Game"] }),
  );
  expect(screen.queryByText("Choose save folder")).toBeNull();
});

it("checks the folders again on focus and after the game's session ends", async () => {
  mocks.getSaveFolders.mockResolvedValue({
    source: "server",
    paths: [{ path: "%INSTALLDIR%/game/saves", resolved: "x", exists: false }],
  });
  render(<CloudSaveRow game={game} installed={installed} />);
  expect(await screen.findByText("(not created yet)")).toBeTruthy();
  const calls = mocks.getSaveFolders.mock.calls.length;
  mocks.getSaveFolders.mockResolvedValue({
    source: "server",
    paths: [{ path: "%INSTALLDIR%/game/saves", resolved: "x", exists: true }],
  });
  window.dispatchEvent(new Event("focus"));
  await vi.waitFor(() =>
    expect(screen.queryByText("(not created yet)")).toBeNull(),
  );
  expect(mocks.getSaveFolders.mock.calls.length).toBeGreaterThan(calls);
  const afterFocus = mocks.getSaveFolders.mock.calls.length;
  mocks.sessionListener?.({ gameId: 46, state: "ended", versionDirectory: "" });
  await vi.waitFor(() =>
    expect(mocks.getSaveFolders.mock.calls.length).toBeGreaterThan(afterFocus),
  );
});
