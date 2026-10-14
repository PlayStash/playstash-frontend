import { afterEach, describe, expect, it, vi } from "vitest";
import {
  compareServerVersions,
  isServerOutdated,
  isServerVersionOutdated,
  parseServerVersion,
} from "./serverVersion";

afterEach(() => vi.unstubAllGlobals());

describe("server version gate", () => {
  it("treats missing and older versions as outdated", () => {
    expect(isServerVersionOutdated("")).toBe(true);
    expect(isServerVersionOutdated(undefined)).toBe(true);
    expect(isServerVersionOutdated("14.9.0")).toBe(true);
    expect(isServerVersionOutdated("15.0.0-beta.1")).toBe(true);
    expect(isServerVersionOutdated("9.99.99")).toBe(true);
  });

  it("accepts the minimum and newer versions (semver, not digit stripping)", () => {
    expect(isServerVersionOutdated("15.0.0")).toBe(false);
    expect(isServerVersionOutdated("v15.0")).toBe(false);
    expect(isServerVersionOutdated("17.1.4")).toBe(false);
    expect(isServerVersionOutdated("100.0.0")).toBe(false);
    // Unparseable but present: not outdated (WPF behavior).
    expect(isServerVersionOutdated("nightly")).toBe(false);
  });

  it("orders prereleases below releases", () => {
    const parse = (value: string) => parseServerVersion(value)!;
    expect(
      compareServerVersions(parse("1.0.0-alpha"), parse("1.0.0")),
    ).toBeLessThan(0);
    expect(
      compareServerVersions(parse("1.0.0-alpha.2"), parse("1.0.0-alpha.10")),
    ).toBeLessThan(0);
    expect(
      compareServerVersions(parse("1.0.0-beta"), parse("1.0.0-alpha")),
    ).toBeGreaterThan(0);
    expect(compareServerVersions(parse("1.2.0+build"), parse("1.2.0"))).toBe(0);
  });

  it("counts a failed status call as compatible", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    expect(await isServerOutdated("https://server")).toBe(false);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("", { status: 500 })),
    );
    expect(await isServerOutdated("https://server")).toBe(false);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ version: "14.0.0" }))),
    );
    expect(await isServerOutdated("https://server")).toBe(true);
  });
});
