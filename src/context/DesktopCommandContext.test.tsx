// @vitest-environment jsdom
import {
  act,
  cleanup,
  configure,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DesktopCommandProvider } from "./DesktopCommandContext";
import type { DesktopCommand } from "@/utils/desktopCommands";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
  auth: {
    user: null as null | { id: number; role: number },
    bootstrapping: true,
    serverUrl: "https://library.test",
    auth: null as null | { access_token: string },
    authFetch: vi.fn(),
  },
  showAlert: vi.fn(),
  launchInstalledGame: vi.fn(),
  requestGameDownload: vi.fn(),
  uninstallInstalledGame: vi.fn(),
  cancelDownload: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (
    name: string,
    handler: (event: { payload: unknown }) => void,
  ) => {
    mocks.listeners.set(name, handler);
    return () => mocks.listeners.delete(name);
  },
}));
vi.mock("@/utils/tauri", () => ({ isTauriApp: () => true }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => mocks.auth }));
vi.mock("@/context/OfflineContext", () => ({
  useOnlineStatus: () => ({ isOnline: true }),
}));
vi.mock("@/context/AlertDialogContext", () => ({
  useAlertDialog: () => ({ showAlert: mocks.showAlert }),
}));
vi.mock("@/context/DownloadContext", () => ({
  useDownloads: () => ({
    downloads: { 3: { status: "downloading" }, 4: { status: "completed" } },
    cancelDownload: mocks.cancelDownload,
  }),
}));
vi.mock("@/hooks/useJumpList", () => ({ useJumpList: () => undefined }));
vi.mock("@/utils/launchInstalledGame", () => ({
  launchInstalledGame: mocks.launchInstalledGame,
}));
vi.mock("@/utils/downloadFlow", () => ({
  requestGameDownload: mocks.requestGameDownload,
}));
vi.mock("@/utils/uninstallInstalledGame", () => ({
  uninstallInstalledGame: mocks.uninstallInstalledGame,
}));

// Dynamic imports are slow when the whole suite runs in parallel.
configure({ asyncUtilTimeout: 5000 });

function Location() {
  return <span data-testid="location">{useLocation().pathname}</span>;
}

function renderProvider() {
  return render(
    <MemoryRouter initialEntries={["/start"]}>
      <DesktopCommandProvider>
        <Location />
      </DesktopCommandProvider>
    </MemoryRouter>,
  );
}

function signIn(role = 1) {
  mocks.auth.user = { id: 1, role };
  mocks.auth.bootstrapping = false;
  mocks.auth.auth = { access_token: "token" };
}

async function emit(command: Partial<DesktopCommand>) {
  await waitFor(() =>
    expect(mocks.listeners.has("desktop-command")).toBe(true),
  );
  await act(async () => {
    mocks.listeners.get("desktop-command")!({
      payload: { id: "cmd-1", action: "show", ...command },
    });
  });
}

function invoked(command: string) {
  return mocks.invoke.mock.calls.filter(([name]) => name === command);
}

describe("DesktopCommandProvider", () => {
  beforeEach(() => {
    // Concurrent dynamic imports can still reach the real module; route its
    // IPC into the same mock.
    (window as any).__TAURI_INTERNALS__ = {
      invoke: (command: string, args: unknown) => mocks.invoke(command, args),
    };
    vi.clearAllMocks();
    mocks.listeners.clear();
    mocks.auth.user = null;
    mocks.auth.bootstrapping = true;
    mocks.auth.auth = null;
    mocks.invoke.mockResolvedValue(undefined);
    mocks.launchInstalledGame.mockResolvedValue({ ok: true });
    mocks.requestGameDownload.mockResolvedValue("queued");
    mocks.uninstallInstalledGame.mockResolvedValue(true);
    mocks.auth.authFetch.mockResolvedValue({ ok: true });
    mocks.showAlert.mockResolvedValue(true);
  });
  afterEach(cleanup);

  it("opens the ready gate only after the auth bootstrap", async () => {
    const view = renderProvider();
    await waitFor(() =>
      expect(invoked("desktop_frontend_attached")).toHaveLength(1),
    );
    expect(invoked("desktop_commands_ready")).toHaveLength(0);

    signIn();
    view.rerender(
      <MemoryRouter initialEntries={["/start"]}>
        <DesktopCommandProvider>
          <Location />
        </DesktopCommandProvider>
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(invoked("desktop_commands_ready")).toHaveLength(1),
    );
  });

  it("starts an installed game without navigating", async () => {
    signIn();
    renderProvider();
    await emit({ action: "start", gameId: 5, installed: true });
    await waitFor(() =>
      expect(mocks.launchInstalledGame).toHaveBeenCalledWith({
        gameId: 5,
        source: "cli",
      }),
    );
    expect(screen.getByTestId("location").textContent).toBe("/start");
    await waitFor(() =>
      expect(invoked("desktop_command_done")[0]?.[1]).toMatchObject({
        id: "cmd-1",
        ok: true,
      }),
    );
  });

  it("queues installs with background/autoInstall and opens downloads", async () => {
    signIn();
    renderProvider();
    await emit({
      action: "install",
      gameId: 7,
      installed: false,
      minimized: true,
      autoInstall: true,
    });
    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe("/downloads"),
    );
    expect(mocks.requestGameDownload).toHaveBeenCalledWith({
      gameId: 7,
      background: true,
      autoInstall: true,
    });
  });

  it("opens the community page for jump-list command 2", async () => {
    signIn();
    renderProvider();
    await emit({ jumpListCommand: 2 });
    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe("/community"),
    );
  });

  it("ignores the admin page for non-admins", async () => {
    signIn(1);
    renderProvider();
    await emit({ jumpListCommand: 4 });
    await waitFor(() =>
      expect(invoked("desktop_command_done")).toHaveLength(1),
    );
    expect(screen.getByTestId("location").textContent).toBe("/start");
  });

  it("cancels running downloads and exits after confirmation", async () => {
    signIn();
    renderProvider();
    await waitFor(() =>
      expect(mocks.listeners.has("desktop-exit-requested")).toBe(true),
    );
    await act(async () => {
      mocks.listeners.get("desktop-exit-requested")!({ payload: null });
    });
    await waitFor(() => expect(invoked("exit_app")).toHaveLength(1));
    expect(mocks.cancelDownload).toHaveBeenCalledWith(3);
    expect(mocks.cancelDownload).not.toHaveBeenCalledWith(4);
  });

  it("keeps running when the exit is declined", async () => {
    signIn();
    mocks.showAlert.mockResolvedValue(false);
    renderProvider();
    await waitFor(() =>
      expect(mocks.listeners.has("desktop-exit-requested")).toBe(true),
    );
    await act(async () => {
      mocks.listeners.get("desktop-exit-requested")!({ payload: null });
    });
    await waitFor(() => expect(mocks.showAlert).toHaveBeenCalled());
    expect(invoked("exit_app")).toHaveLength(0);
    expect(mocks.cancelDownload).not.toHaveBeenCalled();
  });

  it("pushes the session context and shows the window for a login", async () => {
    // Bootstrap finished without a session: the login page needs the window.
    mocks.auth.bootstrapping = false;
    renderProvider();
    await waitFor(() => expect(invoked("show_main_window")).toHaveLength(1));
    expect(invoked("desktop_commands_ready")).toHaveLength(0);
    await waitFor(() =>
      expect(invoked("set_desktop_context").length).toBeGreaterThan(0),
    );
    const contexts = invoked("set_desktop_context");
    expect(contexts[0][1]).toMatchObject({
      context: { loggedIn: false, serverUrl: "" },
    });
  });
});
