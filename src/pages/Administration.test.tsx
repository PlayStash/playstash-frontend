import { describe, expect, it } from "vitest";
import type { PlaystashUser } from "@/api";
import {
  compareVersions,
  findBackendUpdate,
  formatUptime,
  sortUsers,
} from "@/utils/adminExtras";

const user = (
  id: number,
  username: string,
  role: string,
  activated: boolean,
): PlaystashUser => ({ id, username, role, activated }) as any;

const users = [
  user(1, "charlie", "1", true),
  user(2, "Alice", "3", true),
  user(3, "bob", "0", false),
  user(4, "dave", "2", false),
  user(5, "eve", "3", true),
];
const names = (list: PlaystashUser[]) => list.map((u) => u.username);

describe("user sorting", () => {
  it("sorts by username, case-insensitive", () => {
    expect(names(sortUsers(users, "username"))).toEqual([
      "Alice",
      "bob",
      "charlie",
      "dave",
      "eve",
    ]);
  });

  it("sorts non-activated users first, then by username", () => {
    expect(names(sortUsers(users, "activation"))).toEqual([
      "bob",
      "dave",
      "Alice",
      "charlie",
      "eve",
    ]);
  });

  it("sorts by role descending, then by username", () => {
    expect(names(sortUsers(users, "role"))).toEqual([
      "Alice",
      "eve",
      "dave",
      "charlie",
      "bob",
    ]);
  });
});

describe("backend update detection", () => {
  const releases = [
    {
      tag_name: "v19.0.0-beta.1",
      prerelease: true,
      draft: false,
      html_url: "https://github.com/x/beta",
    },
    {
      tag_name: "v18.1.0",
      prerelease: false,
      draft: true,
      html_url: "https://github.com/x/draft",
    },
    {
      tag_name: "v18.0.2",
      prerelease: false,
      draft: false,
      html_url: "https://github.com/x/18.0.2",
    },
    {
      tag_name: "v17.0.0",
      prerelease: false,
      draft: false,
      html_url: "https://github.com/x/17",
    },
  ];

  it("links the first stable release when it is newer", () => {
    expect(findBackendUpdate(releases, "18.0.1")).toEqual({
      version: "18.0.2",
      url: "https://github.com/x/18.0.2",
    });
    expect(findBackendUpdate(releases, "v9.10.0")).not.toBeNull();
  });

  it("shows nothing when the server is current or newer", () => {
    expect(findBackendUpdate(releases, "18.0.2")).toBeNull();
    expect(findBackendUpdate(releases, "18.0.10")).toBeNull();
    expect(findBackendUpdate(releases, "19.0.0")).toBeNull();
  });

  it("compares semantically, not as text", () => {
    expect(compareVersions("18.0.10", "18.0.9")).toBeGreaterThan(0);
    expect(compareVersions("v2.0.0", "10.0.0")).toBeLessThan(0);
    expect(compareVersions("1.0.0", "1.0.0-rc.1")).toBeGreaterThan(0);
    expect(compareVersions("garbage", "1.0.0")).toBeNull();
  });

  it("rejects non-http links and bad input", () => {
    expect(
      findBackendUpdate(
        [
          {
            tag_name: "v99.0.0",
            prerelease: false,
            draft: false,
            html_url: "javascript:alert(1)",
          },
        ],
        "1.0.0",
      ),
    ).toBeNull();
    expect(findBackendUpdate({}, "1.0.0")).toBeNull();
    expect(findBackendUpdate(releases, undefined)).toBeNull();
  });
});

describe("formatUptime", () => {
  it("formats d days hh:mm:ss", () => {
    expect(formatUptime(90061)).toBe("1 days 01:01:01");
    expect(formatUptime(59)).toBe("0 days 00:00:59");
    expect(formatUptime(undefined)).toBeNull();
    expect(formatUptime("x")).toBeNull();
  });
});
