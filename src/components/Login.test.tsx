// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  tauri: false,
  loginBasic: vi.fn(),
  loginStoredSession: vi.fn(),
  profiles: null as null | Record<string, unknown>,
  statusVersion: "17.0.0" as string | null,
  statusFails: false,
}));
vi.mock("@/utils/tauri", () => ({
  isTauriApp: () => mocks.tauri,
  isTauriDesktop: () => false,
  openExternalUrl: vi.fn(),
}));
vi.mock("@/context/AuthContext", async (original) => ({
  ...(await original<typeof import("@/context/AuthContext")>()),
  useAuth: () => ({
    loginBasic: mocks.loginBasic,
    loginWithTokens: vi.fn(),
    loginStoredSession: mocks.loginStoredSession,
    loading: false,
    error: null,
  }),
}));
vi.mock("@/context/ProfilesContext", () => ({
  useProfiles: () =>
    mocks.profiles ?? {
      enabled: false,
      loaded: true,
      profiles: [],
      rememberMe: false,
    },
}));
vi.mock("@/utils/authConfig", async (original) => ({
  ...(await original<typeof import("@/utils/authConfig")>()),
  detectBackendServedWebUi: async () => false,
  getDevAutologinConfig: () => null,
}));

import { Login } from "./Login";
import {
  AuthRequestError,
  CredentialsRequiredError,
} from "@/context/AuthContext";

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/library" element={<p>Library page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function fillAndSubmit(username: string) {
  const user = await screen.findByLabelText("Username or Email");
  fireEvent.change(user, { target: { value: username } });
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: "secret-password" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Login" }));
}

beforeEach(() => {
  mocks.tauri = false;
  mocks.profiles = null;
  mocks.statusVersion = "17.0.0";
  mocks.statusFails = false;
  mocks.loginBasic.mockReset();
  mocks.loginStoredSession.mockReset();
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem("app_server_url", "https://games.example");
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      if (mocks.statusFails) throw new TypeError("unreachable");
      return new Response(
        JSON.stringify({
          ...(mocks.statusVersion !== null
            ? { version: mocks.statusVersion }
            : {}),
          available_authentication_methods: ["basic"],
        }),
      );
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("server version gate", { timeout: 30_000 }, () => {
  it("shows the incompatibility dialog for 14.9.0 and does not log in", async () => {
    mocks.statusVersion = "14.9.0";
    renderLogin();
    await fillAndSubmit("alice");
    expect(
      await screen.findByText("CLIENT-SERVER-INCOMPATIBILITY DETECTED"),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Update the server" }),
    ).toBeTruthy();
    expect(mocks.loginBasic).not.toHaveBeenCalled();
  });

  it("proceeds for 15.0.0 and accepts an email as username", async () => {
    mocks.statusVersion = "15.0.0";
    mocks.loginBasic.mockResolvedValue({});
    renderLogin();
    await fillAndSubmit("alice@example.com");
    await waitFor(() =>
      expect(mocks.loginBasic).toHaveBeenCalledWith({
        server: "https://games.example",
        username: "alice@example.com",
        password: "secret-password",
      }),
    );
    expect(await screen.findByText("Library page")).toBeTruthy();
  });

  it("proceeds when the status call of a stored profile fails", async () => {
    mocks.tauri = true;
    mocks.statusFails = true;
    mocks.loginStoredSession.mockResolvedValue({});
    const profile = {
      id: "p1",
      serverUrl: "https://games.example",
      username: "alice",
      sso: false,
      createdAt: 1,
      lastUsedAt: 1,
    };
    mocks.profiles = {
      enabled: true,
      loaded: true,
      profiles: [profile],
      rememberMe: false,
      setRememberMe: vi.fn(),
    };
    renderLogin();
    fireEvent.click(await screen.findByRole("button", { name: /^alice/ }));
    await waitFor(() =>
      expect(mocks.loginStoredSession).toHaveBeenCalledWith("p1"),
    );
    expect(await screen.findByText("Library page")).toBeTruthy();
  });
});

describe("pending activation", { timeout: 30_000 }, () => {
  it("shows the pending screen on 406 and retries the login every 5 seconds", async () => {
    mocks.loginBasic
      .mockRejectedValueOnce(new AuthRequestError("Login failed (406)", 406))
      .mockRejectedValueOnce(new AuthRequestError("Login failed (406)", 406))
      .mockResolvedValueOnce({});
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
    });
    const flush = () =>
      act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
    renderLogin();
    await flush();
    await flush();
    fireEvent.change(screen.getByLabelText("Username or Email"), {
      target: { value: "alice" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "secret-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Login" }));
    await flush();
    expect(
      screen.getByText("Your Account is pending Admin Approval"),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "You can wait or close this screen and check again later.",
      ),
    ).toBeTruthy();
    expect(mocks.loginBasic).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_999);
    });
    expect(mocks.loginBasic).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(mocks.loginBasic).toHaveBeenCalledTimes(2);
    expect(
      screen.getByText("Your Account is pending Admin Approval"),
    ).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(mocks.loginBasic).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
    expect(await screen.findByText("Library page")).toBeTruthy();
  });
});

describe("server status check", { timeout: 30_000 }, () => {
  it("stops loading when the server changes to an invalid one mid-check", async () => {
    mocks.tauri = true;
    // The sign-in form's status check for the first server never answers;
    // the version probe before it (and any other request) does.
    let gamesStatusCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string, init?: RequestInit) => {
        if (String(input).startsWith("https://games.example")) {
          gamesStatusCalls += 1;
          if (gamesStatusCalls > 1) {
            return new Promise<Response>((_resolve, reject) => {
              init?.signal?.addEventListener("abort", () =>
                reject(new DOMException("aborted", "AbortError")),
              );
            });
          }
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              version: "17.0.0",
              available_authentication_methods: ["basic"],
            }),
          ),
        );
      }),
    );
    mocks.loginStoredSession.mockRejectedValue(new CredentialsRequiredError());
    const profile = (id: string, username: string, serverUrl: string) => ({
      id,
      serverUrl,
      username,
      sso: false,
      createdAt: 1,
      lastUsedAt: 1,
    });
    mocks.profiles = {
      enabled: true,
      loaded: true,
      profiles: [
        profile("p1", "alice", "https://games.example"),
        profile("p2", "bob", "ftp://broken.example"),
      ],
      rememberMe: false,
      setRememberMe: vi.fn(),
    };
    renderLogin();

    fireEvent.click(await screen.findByRole("button", { name: /^alice/ }));
    expect(await screen.findByText("Connecting to server...")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Back to profiles" }));
    fireEvent.click(await screen.findByRole("button", { name: /^bob/ }));
    expect(
      await screen.findByDisplayValue("ftp://broken.example"),
    ).toBeTruthy();
    await waitFor(() =>
      expect(screen.queryByText("Connecting to server...")).toBeNull(),
    );
  });
});
