// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  native: true,
  load: vi.fn(),
  get: vi.fn(),
  insert: vi.fn(),
  save: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("./tauri", () => ({ isTauriApp: () => mocks.native }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue("random-native-secret"),
}));
vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: vi.fn().mockResolvedValue("/app"),
}));
vi.mock("@tauri-apps/plugin-stronghold", () => ({
  Stronghold: { load: mocks.load },
}));
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  localStorage.clear();
  mocks.native = true;
  mocks.get.mockResolvedValue(undefined);
  mocks.insert.mockResolvedValue(undefined);
  mocks.remove.mockResolvedValue(undefined);
  mocks.save.mockResolvedValue(undefined);
  mocks.load.mockResolvedValue({
    loadClient: async () => ({
      getStore: () => ({
        get: mocks.get,
        insert: mocks.insert,
        remove: mocks.remove,
      }),
    }),
    save: mocks.save,
  });
});
describe("native refresh-token storage", () => {
  it("does not restore a plaintext token when the vault is unavailable", async () => {
    localStorage.setItem("app_refresh_token", "plaintext");
    mocks.load.mockRejectedValue(new Error("vault unavailable"));
    const storage = await import("./tokenStorage");
    await storage.initTokenStorage();
    expect(storage.getRefreshToken()).toBeNull();
    expect(localStorage.getItem("app_refresh_token")).toBeNull();
  });
  it("keeps a failed native save in memory without a plaintext fallback", async () => {
    mocks.save.mockRejectedValue(new Error("disk unavailable"));
    const storage = await import("./tokenStorage");
    await storage.setRefreshToken("session-only");
    expect(storage.getRefreshToken()).toBe("session-only");
    expect(localStorage.getItem("app_refresh_token")).toBeNull();
  });
  it("loads the encrypted vault and deletes any plaintext copy", async () => {
    mocks.get.mockResolvedValue(new TextEncoder().encode("vault-token"));
    localStorage.setItem("app_refresh_token", "plaintext");
    const storage = await import("./tokenStorage");
    await Promise.all([storage.initTokenStorage(), storage.initTokenStorage()]);
    expect(storage.getRefreshToken()).toBe("vault-token");
    expect(mocks.load).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("app_refresh_token")).toBeNull();
  });
  it("clears both storage paths on logout", async () => {
    const storage = await import("./tokenStorage");
    await storage.setRefreshToken("token");
    localStorage.setItem("app_refresh_token", "old-copy");
    await storage.removeRefreshToken();
    expect(storage.getRefreshToken()).toBeNull();
    expect(mocks.remove).toHaveBeenCalledWith("app_refresh_token");
    expect(localStorage.getItem("app_refresh_token")).toBeNull();
  });
  it("retains browser persistence without requesting native IPC", async () => {
    mocks.native = false;
    const storage = await import("./tokenStorage");
    await storage.setRefreshToken("web-token");
    expect(localStorage.getItem("app_refresh_token")).toBe("web-token");
    expect(mocks.load).not.toHaveBeenCalled();
  });
  it("does not resurrect a stored session after a failed logout save", async () => {
    const storage = await import("./tokenStorage");
    await storage.setRefreshToken("old-session");
    mocks.save.mockRejectedValue(new Error("disk unavailable"));
    await storage.removeRefreshToken();
    mocks.get.mockResolvedValue(new TextEncoder().encode("old-session"));
    vi.resetModules();
    const restarted = await import("./tokenStorage");
    await restarted.initTokenStorage();
    expect(restarted.getRefreshToken()).toBeNull();
  });
});
