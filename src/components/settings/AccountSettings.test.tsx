// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useEffect } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/utils/tauri", () => ({
  isTauriApp: () => false,
  isTauriDesktop: () => false,
  openExternalUrl: vi.fn(),
}));
vi.mock("@/utils/authConfig", async (original) => ({
  ...(await original<typeof import("@/utils/authConfig")>()),
  getDevAutologinConfig: () => null,
}));

const SERVER = "https://games.example";

function jwt() {
  const now = Math.floor(Date.now() / 1000);
  return `h.${btoa(JSON.stringify({ iat: now, exp: now + 3600 }))}.s`;
}

let revokeStatus = 200;
let fetchMock: ReturnType<typeof vi.fn>;
let accessToken = "";

async function renderSettings() {
  const { AuthProvider } = await import("@/context/AuthProvider");
  const { useAuth } = await import("@/context/AuthContext");
  const { default: AccountSettings } = await import("./AccountSettings");
  const state: { auth?: ReturnType<typeof useAuth> } = {};
  function Probe() {
    const auth = useAuth();
    useEffect(() => {
      state.auth = auth;
    });
    return null;
  }
  render(
    <MemoryRouter>
      <AuthProvider>
        <Probe />
        <AccountSettings
          rowHighlight={() => ""}
          isTauri={false}
          isDesktopApp={false}
          isLinux={false}
        />
      </AuthProvider>
    </MemoryRouter>,
  );
  await waitFor(() => expect(state.auth?.user?.username).toBe("alice"));
  return state;
}

function revokeCalls() {
  return fetchMock.mock.calls.filter(([url]) =>
    String(url).includes("/api/auth/revoke"),
  );
}

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  revokeStatus = 200;
  accessToken = jwt();
  localStorage.setItem("app_refresh_token", "refresh-1");
  localStorage.setItem("app_server_url", SERVER);
  window.showAlertDialog = vi.fn().mockResolvedValue(true);
  fetchMock = vi.fn(async (url: string) => {
    if (url.endsWith("/api/auth/refresh"))
      return new Response(
        JSON.stringify({
          access_token: accessToken,
          refresh_token: "refresh-2",
        }),
      );
    if (url.endsWith("/api/users/me"))
      return new Response(JSON.stringify({ id: 1, username: "alice" }));
    if (url.includes("/api/auth/revoke"))
      return new Response(revokeStatus === 200 ? "{}" : "boom", {
        status: revokeStatus,
      });
    return new Response("{}");
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete window.showAlertDialog;
});

describe("AccountSettings logout", { timeout: 30_000 }, () => {
  it("revokes this device's refresh token on the server", async () => {
    const state = await renderSettings();
    await act(async () => {
      fireEvent.click(
        screen.getAllByRole("button", { name: "Logout from this Device" })[0],
      );
    });
    await waitFor(() => expect(revokeCalls()).toHaveLength(1));
    const [url, init] = revokeCalls()[0];
    expect(url).toBe(`${SERVER}/api/auth/revoke`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ refresh_token: "refresh-2" });
    expect(new Headers(init.headers).get("Authorization")).toBe(
      `Bearer ${accessToken}`,
    );
    await waitFor(() => expect(state.auth?.auth).toBeNull());
    expect(localStorage.getItem("app_refresh_token")).toBeNull();
    expect(window.showAlertDialog).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Are you sure you want to log out?" }),
    );
  });

  it("revokes every session for all devices", async () => {
    const state = await renderSettings();
    await act(async () => {
      fireEvent.click(
        screen.getAllByRole("button", { name: "Logout from all Devices" })[0],
      );
    });
    await waitFor(() => expect(revokeCalls()).toHaveLength(1));
    expect(revokeCalls()[0][0]).toBe(`${SERVER}/api/auth/revoke/all`);
    await waitFor(() => expect(state.auth?.auth).toBeNull());
  });

  it("logs out locally even when the revoke fails, and reports the error", async () => {
    revokeStatus = 500;
    const state = await renderSettings();
    await act(async () => {
      fireEvent.click(
        screen.getAllByRole("button", { name: "Logout from this Device" })[0],
      );
    });
    await waitFor(() => expect(state.auth?.auth).toBeNull());
    expect(localStorage.getItem("app_refresh_token")).toBeNull();
    expect(window.showAlertDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        tone: "danger",
        title: expect.stringContaining("500"),
      }),
    );
  });

  it("does nothing when the confirmation is declined", async () => {
    window.showAlertDialog = vi.fn().mockResolvedValue(false);
    const state = await renderSettings();
    await act(async () => {
      fireEvent.click(
        screen.getAllByRole("button", { name: "Logout from this Device" })[0],
      );
    });
    expect(revokeCalls()).toHaveLength(0);
    expect(state.auth?.auth).not.toBeNull();
  });
});
