// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  vault: new Map<string, number[]>(),
  invoke: vi.fn(),
}));
vi.mock("@/utils/tauri", () => ({
  isTauriApp: () => true,
  // Profiles are persisted in localStorage when Rust is unavailable.
  isTauriDesktop: () => false,
  openExternalUrl: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: vi.fn().mockResolvedValue("/app"),
}));
vi.mock("@tauri-apps/plugin-stronghold", () => ({
  Stronghold: {
    load: async () => ({
      loadClient: async () => ({
        getStore: () => ({
          get: async (key: string) =>
            mocks.vault.has(key)
              ? Uint8Array.from(mocks.vault.get(key)!)
              : null,
          insert: async (key: string, value: number[]) => {
            mocks.vault.set(key, value);
          },
          remove: async (key: string) => {
            mocks.vault.delete(key);
          },
        }),
      }),
      save: async () => {},
    }),
  },
}));
vi.mock("@/utils/authConfig", async (original) => ({
  ...(await original<typeof import("@/utils/authConfig")>()),
  getDevAutologinConfig: () => null,
}));

function vaultText(key: string) {
  const value = mocks.vault.get(key);
  return value ? new TextDecoder().decode(Uint8Array.from(value)) : null;
}

function jwt(lifetimeSeconds = 3600) {
  const now = Math.floor(Date.now() / 1000);
  const payload = btoa(
    JSON.stringify({ iat: now, exp: now + lifetimeSeconds }),
  );
  return `h.${payload}.s`;
}

type Harness = {
  auth: ReturnType<typeof import("@/context/AuthContext").useAuth>;
  profiles: ReturnType<typeof import("@/context/ProfilesContext").useProfiles>;
};

async function renderProviders() {
  const { AuthProvider, useAuth } = await import("@/context/AuthContext");
  const { useProfiles } = await import("@/context/ProfilesContext");
  const harness = {} as Harness;
  function Probe() {
    harness.auth = useAuth();
    harness.profiles = useProfiles();
    return null;
  }
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
  await waitFor(() => expect(harness.auth.bootstrapping).toBe(false));
  return harness;
}

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  sessionStorage.clear();
  mocks.vault.clear();
  mocks.invoke.mockReset();
  mocks.invoke.mockImplementation(async (command: string) =>
    command === "get_or_create_vault_password" ? "secret" : undefined,
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ProfilesContext", { timeout: 30_000 }, () => {
  it("adds, edits and deletes profiles; delete removes the vault record", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    const harness = await renderProviders();
    expect(harness.profiles.enabled).toBe(true);

    let id = "";
    await act(async () => {
      id = (
        await harness.profiles.createProfile({
          serverUrl: "a.example",
          username: "alice@example.com",
          sso: false,
        })
      ).id;
    });
    expect(harness.profiles.profiles).toHaveLength(1);
    expect(harness.profiles.profiles[0]).toMatchObject({
      serverUrl: "https://a.example",
      username: "alice@example.com",
    });
    await expect(
      harness.profiles.createProfile({
        serverUrl: "https://a.example/",
        username: "ALICE@example.com",
        sso: false,
      }),
    ).rejects.toThrow("Profile with this name already exists");

    const { storeRefreshTokenFor } = await import("@/utils/tokenStorage");
    await storeRefreshTokenFor(id, "token-a");
    expect(vaultText(`refresh_token:${id}`)).toBe("token-a");

    // A changed server keeps the id but drops the session.
    await act(async () => {
      await harness.profiles.editProfile(id, {
        serverUrl: "https://b.example",
        username: "alice@example.com",
      });
    });
    expect(harness.profiles.profiles[0]).toMatchObject({
      id,
      serverUrl: "https://b.example",
    });
    expect(vaultText(`refresh_token:${id}`)).toBeNull();

    await storeRefreshTokenFor(id, "token-b");
    localStorage.setItem(`playstash:profile:${id}:playstash_theme`, "{}");
    await act(async () => {
      await harness.profiles.deleteProfile(id);
    });
    expect(harness.profiles.profiles).toHaveLength(0);
    expect(vaultText(`refresh_token:${id}`)).toBeNull();
    expect(
      localStorage.getItem(`playstash:profile:${id}:playstash_theme`),
    ).toBeNull();
  });

  it("logs into the last profile at startup when remember me is on", async () => {
    localStorage.setItem(
      "playstash_profiles",
      JSON.stringify({
        profiles: [
          {
            id: "p1",
            serverUrl: "https://one.example",
            username: "a",
            sso: false,
            createdAt: 1,
            lastUsedAt: 1,
          },
          {
            id: "p2",
            serverUrl: "https://two.example",
            username: "b",
            sso: false,
            createdAt: 1,
            lastUsedAt: 2,
          },
        ],
        rememberMe: true,
        lastProfileId: "p2",
        legacySessionMigrated: true,
      }),
    );
    mocks.vault.set(
      "refresh_token:p1",
      Array.from(new TextEncoder().encode("r1")),
    );
    mocks.vault.set(
      "refresh_token:p2",
      Array.from(new TextEncoder().encode("r2")),
    );
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/api/auth/refresh")) {
        expect(new Headers(init?.headers).get("Authorization")).toBe(
          "Bearer r2",
        );
        return new Response(
          JSON.stringify({ access_token: jwt(), refresh_token: "r2-new" }),
        );
      }
      if (url.endsWith("/api/users/me"))
        return new Response(JSON.stringify({ id: 5, username: "bob" }));
      return new Response("{}");
    });
    vi.stubGlobal("fetch", fetchMock);

    const harness = await renderProviders();
    await waitFor(() => expect(harness.auth.user?.username).toBe("bob"));
    expect(harness.auth.serverUrl).toBe("https://two.example");
    expect(harness.auth.currentProfileId).toBe("p2");
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).startsWith("https://one.example"),
      ),
    ).toBe(false);
    expect(vaultText("refresh_token:p2")).toBe("r2-new");
    expect(vaultText("refresh_token:p1")).toBe("r1");
  });

  it("shows the picker without remember me", async () => {
    localStorage.setItem(
      "playstash_profiles",
      JSON.stringify({
        profiles: [
          {
            id: "p1",
            serverUrl: "https://one.example",
            username: "a",
            sso: false,
            createdAt: 1,
            lastUsedAt: 1,
          },
        ],
        rememberMe: false,
        lastProfileId: null,
        legacySessionMigrated: true,
      }),
    );
    mocks.vault.set(
      "refresh_token:p1",
      Array.from(new TextEncoder().encode("r1")),
    );
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const harness = await renderProviders();
    expect(harness.auth.auth).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("changing the profile stops the desktop session but keeps the token", async () => {
    localStorage.setItem(
      "playstash_profiles",
      JSON.stringify({
        profiles: [
          {
            id: "p1",
            serverUrl: "https://one.example",
            username: "a",
            sso: false,
            createdAt: 1,
            lastUsedAt: 1,
          },
        ],
        rememberMe: true,
        lastProfileId: "p1",
        legacySessionMigrated: true,
      }),
    );
    mocks.vault.set(
      "refresh_token:p1",
      Array.from(new TextEncoder().encode("r1")),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/api/auth/refresh"))
          return new Response(
            JSON.stringify({ access_token: jwt(), refresh_token: "r1b" }),
          );
        return new Response(JSON.stringify({ id: 9, username: "alice" }));
      }),
    );
    const changed = vi.fn();
    window.addEventListener("playstash:profile-changed", changed);
    const harness = await renderProviders();
    await waitFor(() => expect(harness.auth.user).not.toBeNull());

    await act(async () => {
      await harness.profiles.changeProfile();
    });
    const commands = mocks.invoke.mock.calls.map(([command]) => command);
    expect(commands).toContain("desktop_commands_not_ready");
    expect(commands).toContain("reset_jump_list_games");
    expect(commands).toContain("stop_game_time_tracker");
    expect(commands).toContain("kill_child_processes");
    expect(commands).toContain("discord_clear_presence");
    expect(harness.auth.auth).toBeNull();
    expect(harness.auth.currentProfileId).toBeNull();
    expect(harness.profiles.lastProfileId).toBeNull();
    expect(vaultText("refresh_token:p1")).toBe("r1b");
    expect(changed).toHaveBeenCalled();
    window.removeEventListener("playstash:profile-changed", changed);
  });

  it("migrates the single pre-profile session into a remembered profile", async () => {
    mocks.vault.set(
      "app_refresh_token",
      Array.from(new TextEncoder().encode("legacy")),
    );
    localStorage.setItem("app_server_url", "https://old.example");
    localStorage.setItem(
      "app_cached_user",
      JSON.stringify({ id: 3, username: "carol" }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/api/auth/refresh"))
          return new Response(
            JSON.stringify({ access_token: jwt(), refresh_token: "fresh" }),
          );
        return new Response(JSON.stringify({ id: 3, username: "carol" }));
      }),
    );
    const harness = await renderProviders();
    await waitFor(() => expect(harness.auth.user?.username).toBe("carol"));
    expect(harness.profiles.profiles).toHaveLength(1);
    expect(harness.profiles.profiles[0]).toMatchObject({
      serverUrl: "https://old.example",
      username: "carol",
    });
    expect(harness.profiles.rememberMe).toBe(true);
    expect(mocks.vault.has("app_refresh_token")).toBe(false);
    expect(vaultText(`refresh_token:${harness.profiles.profiles[0].id}`)).toBe(
      "fresh",
    );
  });
});
