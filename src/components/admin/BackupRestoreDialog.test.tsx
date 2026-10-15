// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BackupRestoreDialog from "./BackupRestoreDialog";

const mocks = vi.hoisted(() => ({
  desktop: false,
  invoke: vi.fn(),
  save: vi.fn(),
  open: vi.fn(),
  showAlert: vi.fn(),
  getAccessToken: vi.fn(async () => "token-1"),
  authFetch: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: mocks.save,
  open: mocks.open,
}));
vi.mock("@/utils/tauri", () => ({
  isTauriDesktop: () => mocks.desktop,
  isTauriApp: () => mocks.desktop,
}));
vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({
    serverUrl: "https://library.test/",
    getAccessToken: mocks.getAccessToken,
    authFetch: mocks.authFetch,
  }),
}));
vi.mock("../../context/AlertDialogContext", () => ({
  useAlertDialog: () => ({ showAlert: mocks.showAlert }),
}));

beforeEach(() => {
  mocks.desktop = false;
  mocks.invoke.mockReset();
  mocks.save.mockReset();
  mocks.open.mockReset();
  mocks.showAlert.mockReset();
  mocks.showAlert.mockResolvedValue(true);
  mocks.authFetch.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function typePassword(value = "db-secret") {
  await userEvent.type(
    screen.getByLabelText("Database Password", { exact: false }),
    value,
  );
}

describe("database backup", () => {
  it("downloads the backup in the browser with a valid file name", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(new Blob(["dump"]), {
          status: 200,
          headers: {
            "Content-Disposition":
              'attachment; filename="playstash_17.1.0_database_backup_2026-10-15T09-05-07-000Z.db"',
          },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const createObjectURL = vi.fn(() => "blob:backup");
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL }));
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    render(<BackupRestoreDialog onClose={() => {}} />);
    await typePassword();
    await userEvent.click(screen.getByRole("button", { name: "Start Backup" }));

    await waitFor(() => expect(click).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://library.test/api/admin/database/backup");
    const headers = new Headers(init.headers);
    expect(headers.get("X-Database-Password")).toBe("db-secret");
    expect(headers.get("Authorization")).toBe("Bearer token-1");
    // A wrong password (401) must not go through authFetch's session logic.
    expect(mocks.authFetch).not.toHaveBeenCalled();
    expect(
      await screen.findByText(
        "Backup downloaded as playstash_17.1.0_database_backup_2026-10-15T09-05-07-000Z.db",
      ),
    ).toBeTruthy();
    click.mockRestore();
  });

  it("reports a wrong database password", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              message:
                "The database password provided in the X-Database-Password Header is incorrect.",
            }),
            { status: 401 },
          ),
      ),
    );
    render(<BackupRestoreDialog onClose={() => {}} />);
    await typePassword("wrong");
    await userEvent.click(screen.getByRole("button", { name: "Start Backup" }));

    await waitFor(() =>
      expect(mocks.showAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Backup failed",
          description: "The database password is incorrect.",
        }),
      ),
    );
  });

  it("streams the backup into the file picked in the desktop app", async () => {
    mocks.desktop = true;
    mocks.save.mockResolvedValue("C:\\Backups\\backup.db");
    mocks.invoke.mockResolvedValue(1024);

    render(<BackupRestoreDialog onClose={() => {}} />);
    await typePassword();
    await userEvent.click(screen.getByRole("button", { name: "Start Backup" }));

    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith("database_backup_download", {
        url: "https://library.test/api/admin/database/backup",
        path: "C:\\Backups\\backup.db",
        authHeader: "Bearer token-1",
        password: "db-secret",
      }),
    );
    const defaultPath = mocks.save.mock.calls[0][0].defaultPath as string;
    expect(defaultPath).toMatch(
      /^playstash_database_backup_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.db$/,
    );
    expect(
      await screen.findByText("Backup saved to C:\\Backups\\backup.db"),
    ).toBeTruthy();
  });

  it("does nothing when the save dialog is cancelled", async () => {
    mocks.desktop = true;
    mocks.save.mockResolvedValue(null);
    render(<BackupRestoreDialog onClose={() => {}} />);
    await typePassword();
    await userEvent.click(screen.getByRole("button", { name: "Start Backup" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalled());
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});

describe("database restore", () => {
  it("asks for confirmation and uploads nothing when cancelled", async () => {
    mocks.showAlert.mockResolvedValue(false);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<BackupRestoreDialog onClose={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Restore" }));
    await userEvent.upload(
      screen.getByLabelText("Backup File"),
      new File(["dump"], "dump.db"),
    );
    await typePassword();
    await userEvent.click(
      screen.getByRole("button", { name: "Start Restore" }),
    );

    await waitFor(() =>
      expect(mocks.showAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Replace the server database?",
          tone: "danger",
        }),
      ),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uploads the file as multipart field 'file' after confirmation", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<BackupRestoreDialog onClose={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Restore" }));
    await userEvent.upload(
      screen.getByLabelText("Backup File"),
      new File(["dump"], "dump.db"),
    );
    await typePassword();
    await userEvent.click(
      screen.getByRole("button", { name: "Start Restore" }),
    );

    await waitFor(() =>
      expect(mocks.showAlert).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Database restored successfully" }),
      ),
    );
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://library.test/api/admin/database/restore");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("X-Database-Password")).toBe(
      "db-secret",
    );
    expect((init.body as FormData).get("file")).toBeInstanceOf(File);
  });

  it("restores a file picked in the desktop app from disk", async () => {
    mocks.desktop = true;
    mocks.open.mockResolvedValue("/home/ada/backups/dump.db");
    mocks.invoke.mockResolvedValue(undefined);
    render(<BackupRestoreDialog onClose={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Restore" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Choose File..." }),
    );
    expect(await screen.findByText("dump.db")).toBeTruthy();
    await typePassword();
    await userEvent.click(
      screen.getByRole("button", { name: "Start Restore" }),
    );

    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith("database_backup_restore", {
        url: "https://library.test/api/admin/database/restore",
        path: "/home/ada/backups/dump.db",
        authHeader: "Bearer token-1",
        password: "db-secret",
      }),
    );
  });

  it("shows the server message of a failed desktop restore", async () => {
    mocks.desktop = true;
    mocks.open.mockResolvedValue("/tmp/dump.db");
    mocks.invoke.mockRejectedValue(
      "HTTP 406: This server can't restore backups as it uses an in-memory database.",
    );
    render(<BackupRestoreDialog onClose={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Restore" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Choose File..." }),
    );
    await typePassword();
    await userEvent.click(
      await screen.findByRole("button", { name: "Start Restore" }),
    );

    await waitFor(() =>
      expect(mocks.showAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Restore failed",
          description:
            "This server can't restore backups as it uses an in-memory database.",
        }),
      ),
    );
  });
});
