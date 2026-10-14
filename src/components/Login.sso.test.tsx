// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Login } from "./Login";
const mocks = vi.hoisted(() => ({ login: vi.fn() }));
vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    loginWithTokens: mocks.login,
    loginBasic: vi.fn(),
    loading: false,
    error: null,
  }),
}));
vi.mock("@/utils/tauri", () => ({ isTauriApp: () => false }));
vi.mock("@/utils/authConfig", async (original) => ({
  ...(await original<typeof import("@/utils/authConfig")>()),
  detectBackendServedWebUi: async () => false,
  getDevAutologinConfig: () => null,
}));
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState({}, "", "/login");
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  );
  localStorage.setItem("app_server_url", window.location.origin);
  mocks.login.mockResolvedValue({});
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async () => {
      expect(window.location.href).not.toMatch(/access_token|refresh_token/);
      return {
        ok: true,
        json: async () => ({
          version: "17.0.0",
          available_authentication_methods: ["sso"],
        }),
      };
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/login");
});
describe("SSO popup trust", { timeout: 30_000 }, () => {
  it("scrubs an initiated fragment before a failed login and consumes the marker", async () => {
    sessionStorage.setItem("app_sso_pending_server", "https://library.test");
    window.history.replaceState(
      {},
      "",
      "/login#access_token=access&refresh_token=refresh",
    );
    mocks.login.mockImplementation(async () => {
      expect(window.location.href).not.toMatch(/access_token|refresh_token/);
      throw new Error("Rejected session");
    });
    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(mocks.login).toHaveBeenCalledWith("https://library.test", {
        access_token: "access",
        refresh_token: "refresh",
      }),
    );
    expect(sessionStorage.getItem("app_sso_pending_server")).toBeNull();
  });
  it.each([
    "/login#access_token=injected",
    "/login?access_token=injected",
    "/access_token=injected",
  ])(
    "rejects unsolicited or legacy token URL %s and immediately scrubs it",
    async (url) => {
      window.history.replaceState({}, "", url);
      render(
        <MemoryRouter>
          <Login />
        </MemoryRouter>,
      );
      expect(mocks.login).not.toHaveBeenCalled();
      expect(window.location.href).not.toContain("injected");
    },
  );
  it("accepts tokens only once from the user-opened popup at the configured server origin", async () => {
    const popup = {} as Window;
    const open = vi.spyOn(window, "open").mockReturnValue(popup);
    await act(async () => {
      render(
        <MemoryRouter>
          <Login />
        </MemoryRouter>,
      );
    });
    const button = screen.getByRole("button", { name: "Continue with SSO" });
    const dispatch = async (
      origin: string,
      source: Window | null,
      data: unknown = {
        type: "playstash:sso",
        access_token: "access",
        refresh_token: "refresh",
      },
    ) => {
      await act(async () =>
        window.dispatchEvent(
          new MessageEvent("message", { origin, source, data }),
        ),
      );
    };
    await dispatch(window.location.origin, popup);
    expect(mocks.login).not.toHaveBeenCalled();
    fireEvent.click(button);
    await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    await dispatch("https://attacker.test", popup);
    await dispatch(window.location.origin, {} as Window);
    await dispatch(window.location.origin, null);
    await dispatch(window.location.origin, popup, {
      type: "playstash:sso",
      access_token: { malicious: true },
    });
    expect(mocks.login).not.toHaveBeenCalled();
    await dispatch(window.location.origin, popup);
    expect(mocks.login).toHaveBeenCalledWith(window.location.origin, {
      access_token: "access",
      refresh_token: "refresh",
    });
    await dispatch(window.location.origin, popup);
    expect(mocks.login).toHaveBeenCalledTimes(1);
  });
});
