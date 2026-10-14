import { serverFetch } from "@/utils/serverFetch";

/** Oldest backend this client works with (WPF "CLIENT-SERVER-INCOMPATIBILITY"). */
export const MIN_SERVER_VERSION = "15.0.0";
export const SERVER_RELEASES_URL =
  "https://github.com/PlayStash/playstash-backend/releases";

interface ParsedVersion {
  parts: [number, number, number];
  prerelease: string[];
}

/** Parses `1.2.3`, `v1.2`, `17.0.0-beta.1+build` (missing parts are 0). */
export function parseServerVersion(raw: string): ParsedVersion | null {
  const match =
    /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:\.\d+)?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
      raw.trim(),
    );
  if (!match) return null;
  return {
    parts: [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)],
    prerelease: match[4] ? match[4].split(".") : [],
  };
}

function comparePrerelease(a: string[], b: string[]): number {
  // A release ranks above its prereleases (semver §11).
  if (!a.length || !b.length) return b.length - a.length;
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const left = a[index];
    const right = b[index];
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    const leftNumeric = /^\d+$/.test(left);
    const rightNumeric = /^\d+$/.test(right);
    if (leftNumeric && rightNumeric) {
      const diff = Number(left) - Number(right);
      if (diff) return diff;
    } else if (leftNumeric !== rightNumeric) {
      return leftNumeric ? -1 : 1;
    } else if (left !== right) {
      return left < right ? -1 : 1;
    }
  }
  return 0;
}

/** Semver comparison; returns <0, 0 or >0. */
export function compareServerVersions(
  a: ParsedVersion,
  b: ParsedVersion,
): number {
  for (let index = 0; index < 3; index++) {
    const diff = a.parts[index] - b.parts[index];
    if (diff) return diff;
  }
  return comparePrerelease(a.prerelease, b.prerelease);
}

/**
 * True when the server reports no version or one below `MIN_SERVER_VERSION`.
 * An unparseable version is not treated as outdated (WPF behavior).
 */
export function isServerVersionOutdated(version: unknown): boolean {
  if (typeof version !== "string" || !version.trim()) return true;
  const parsed = parseServerVersion(version);
  if (!parsed) return false;
  return (
    compareServerVersions(parsed, parseServerVersion(MIN_SERVER_VERSION)!) < 0
  );
}

/**
 * Checks `/api/status` before a login. A failed or unreachable status call
 * counts as compatible (the login itself reports connection problems).
 */
export async function isServerOutdated(server: string): Promise<boolean> {
  try {
    const response = await serverFetch(
      `${server}/api/status`,
      {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      },
      server,
    );
    if (!response.ok) return false;
    const status = (await response.json()) as { version?: unknown };
    return isServerVersionOutdated(status?.version);
  } catch {
    return false;
  }
}
