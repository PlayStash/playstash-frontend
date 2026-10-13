import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlaystashUser } from "@/api";
import {
  authenticatedRequestUrl,
  fetchAuthenticated,
  parseCachedUser,
  serializeCachedUser,
} from "./authSecurity";

afterEach(() => vi.unstubAllGlobals());
describe("credential boundaries", () => {
  it.each([
    "https://other.test/api/users",
    "http://library.test/api/users",
    "https://library.test:8443/api/users",
    "https://user:pass@library.test/api/users",
    "https://library.test/elsewhere",
    "https://library.test/apiary/users",
    "//other.test/api/users",
    "file:///api/users",
  ])(
    "rejects an unauthorised credential destination %s before fetching",
    async (url) => {
      const fetch = vi.fn();
      vi.stubGlobal("fetch", fetch);
      expect(() =>
        fetchAuthenticated(url, "https://library.test", "secret"),
      ).toThrow();
      expect(fetch).not.toHaveBeenCalled();
    },
  );
  it("supports API paths below a server base path and blocks redirects", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response());
    vi.stubGlobal("fetch", fetch);
    await fetchAuthenticated(
      "https://library.test/stash/api/users/me",
      "https://library.test/stash",
      "secret",
      { redirect: "follow", method: "GET" },
    );
    const init = fetch.mock.calls[0][1] as RequestInit;
    expect(init.redirect).toBe("error");
    expect(new Headers(init.headers).get("Authorization")).toBe(
      "Bearer secret",
    );
    expect(() =>
      authenticatedRequestUrl(
        "https://library.test/api/users",
        "https://library.test/stash",
      ),
    ).toThrow();
  });
  it("never serializes credentials or nested authentication sessions", () => {
    const user = {
      id: 1,
      username: "player",
      api_key: "key",
      password: "hash",
      sessions: [{ refresh_token: "session" }],
      progresses: [{ user: { api_key: "nested" }, minutes_played: 12 }],
    } as unknown as PlaystashUser;
    const raw = serializeCachedUser(user);
    expect(raw).not.toMatch(/key|hash|session|nested/);
    expect(JSON.parse(raw).progresses[0].minutes_played).toBe(12);
    expect(user.api_key).toBe("key");
    expect(parseCachedUser(JSON.stringify(user))).toEqual(JSON.parse(raw));
  });
  it.each(["null", "{}", '{"id":0,"username":"player"}'])(
    "rejects invalid offline identity %s",
    (raw) => {
      expect(() => parseCachedUser(raw)).toThrow();
    },
  );
});
