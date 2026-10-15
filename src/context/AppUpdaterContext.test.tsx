// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppUpdaterProvider, useAppUpdater } from "./AppUpdaterContext";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  showAlert: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async () => () => {},
}));
vi.mock("@/utils/tauri", () => ({ isTauriApp: () => true }));
vi.mock("@/context/AlertDialogContext", () => ({
  useAlertDialog: () => ({ showAlert: mocks.showAlert }),
}));

function CheckButton() {
  const { checkForUpdates, updaterReady, availableVersion } = useAppUpdater();
  return (
    <>
      <button
        disabled={!updaterReady}
        onClick={() => void checkForUpdates({ manual: true })}
      >
        check
      </button>
      <span data-testid="available">{availableVersion ?? ""}</span>
    </>
  );
}

function renderUpdater() {
  return render(
    <AppUpdaterProvider>
      <CheckButton />
    </AppUpdaterProvider>,
  );
}

const update = {
  version: "99.0.0",
  body: "### Changes\n- Faster downloads.",
  currentVersion: "17.3.0",
  channel: "stable",
};

function mockCommands(check: () => Promise<unknown>) {
  mocks.invoke.mockImplementation(async (command: string) => {
    switch (command) {
      case "is_updater_enabled":
        return true;
      case "get_background_states":
        return {};
      case "check_for_app_update":
        return check();
      case "download_and_install_app_update":
        return "99.0.0";
      default:
        return null;
    }
  });
}

beforeEach(() => {
  mocks.invoke.mockReset();
  mocks.showAlert.mockReset();
  mocks.showAlert.mockResolvedValue(false);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("AppUpdaterProvider", () => {
  it("proposes a newer version with its release notes and installs on approval", async () => {
    mockCommands(async () => update);
    renderUpdater();

    // The automatic startup check proposes the update.
    expect(
      await screen.findByText("Update v99.0.0 available", undefined, {
        timeout: 4000,
      }),
    ).toBeTruthy();
    expect(screen.getByText("Faster downloads.")).toBeTruthy();
    expect(
      screen.getByText(
        /PlayStash v99\.0\.0 is available on the stable channel/,
      ),
    ).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Update now" }));
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith(
        "download_and_install_app_update",
        { channel: "stable" },
      ),
    );
    // After the install the app offers a restart.
    await waitFor(() =>
      expect(mocks.showAlert).toHaveBeenCalledWith(
        expect.objectContaining({ affirmativeText: "Restart now" }),
      ),
    );
  });

  it("does not install when the user picks Later", async () => {
    mockCommands(async () => update);
    renderUpdater();

    await userEvent.click(
      await screen.findByRole("button", { name: "Later" }, { timeout: 4000 }),
    );
    await waitFor(() =>
      expect(screen.queryByText("Update v99.0.0 available")).toBeNull(),
    );
    expect(screen.getByTestId("available").textContent).toBe("99.0.0");
    expect(mocks.invoke).not.toHaveBeenCalledWith(
      "download_and_install_app_update",
      expect.anything(),
    );

    // A manual check still asks again.
    await userEvent.click(screen.getByRole("button", { name: "check" }));
    expect(await screen.findByText("Update v99.0.0 available")).toBeTruthy();
  });

  it("offers the release page when the signed feed is unavailable", async () => {
    mockCommands(async () => {
      throw "Failed to check for updates: Could not fetch a valid release JSON from the remote";
    });
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        tag_name: "v99.1.0",
        html_url:
          "https://github.com/PlayStash/playstash-frontend/releases/tag/v99.1.0",
        body: "- Manual install notes.",
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    renderUpdater();

    expect(
      await screen.findByText("Update v99.1.0 available", undefined, {
        timeout: 4000,
      }),
    ).toBeTruthy();
    expect(screen.getByText("Manual install notes.")).toBeTruthy();
    await userEvent.click(
      screen.getByRole("button", { name: "Open download page" }),
    );
    expect(open).toHaveBeenCalledWith(
      "https://github.com/PlayStash/playstash-frontend/releases/tag/v99.1.0",
      "_blank",
      "noopener,noreferrer",
    );
    open.mockRestore();
  });

  it("reports an up-to-date client on a manual check", async () => {
    mockCommands(async () => null);
    renderUpdater();

    const button = await screen.findByRole("button", { name: "check" });
    await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false));
    await userEvent.click(button);
    await waitFor(() =>
      expect(mocks.showAlert).toHaveBeenCalledWith(
        expect.objectContaining({ title: "PlayStash is up to date" }),
      ),
    );
  });
});
