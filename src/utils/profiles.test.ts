// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  EMPTY_PROFILES_STATE,
  clearProfileNamespace,
  findDuplicateProfile,
  profileHost,
  profileScopedKey,
  removeProfileFromState,
  sortProfiles,
  upsertProfile,
  type Profile,
} from "./profiles";

const profile = (id: string, patch: Partial<Profile> = {}): Profile => ({
  id,
  serverUrl: "https://games.example",
  username: id,
  sso: false,
  createdAt: 0,
  lastUsedAt: 0,
  ...patch,
});

beforeEach(() => localStorage.clear());

describe("profile helpers", () => {
  it("detects duplicates by username and normalized server", () => {
    const profiles = [profile("alice")];
    expect(findDuplicateProfile(profiles, "games.example/", "ALICE")?.id).toBe(
      "alice",
    );
    expect(
      findDuplicateProfile(profiles, "https://other.example", "alice"),
    ).toBeUndefined();
    expect(
      findDuplicateProfile(profiles, "https://games.example", "alice", "alice"),
    ).toBeUndefined();
    expect(
      findDuplicateProfile(profiles, "https://games.example", ""),
    ).toBeUndefined();
  });

  it("upserts, removes and forgets the last profile", () => {
    let state = upsertProfile(EMPTY_PROFILES_STATE, profile("a"));
    state = upsertProfile(state, profile("a", { username: "renamed" }));
    expect(state.profiles).toEqual([profile("a", { username: "renamed" })]);
    state = removeProfileFromState({ ...state, lastProfileId: "a" }, "a");
    expect(state.profiles).toEqual([]);
    expect(state.lastProfileId).toBeNull();
  });

  it("sorts by last use and shows the host", () => {
    expect(
      sortProfiles([
        profile("old", { lastUsedAt: 1 }),
        profile("new", { lastUsedAt: 2 }),
      ]).map((entry) => entry.id),
    ).toEqual(["new", "old"]);
    expect(profileHost("https://games.example:8443/sub/")).toBe(
      "games.example:8443/sub",
    );
  });

  it("namespaces and clears per-profile keys", () => {
    localStorage.setItem(profileScopedKey("theme", "p1"), "x");
    localStorage.setItem(profileScopedKey("theme", "p2"), "y");
    expect(profileScopedKey("theme", null)).toBe("theme");
    clearProfileNamespace("p1");
    expect(localStorage.getItem(profileScopedKey("theme", "p1"))).toBeNull();
    expect(localStorage.getItem(profileScopedKey("theme", "p2"))).toBe("y");
  });
});
