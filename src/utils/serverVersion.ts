import { serverFetch } from "@/utils/serverFetch";
import { compareParsedVersions, parseVersion } from "@/utils/semver";

/** Oldest backend this client works with (WPF "CLIENT-SERVER-INCOMPATIBILITY"). */
export const MIN_SERVER_VERSION = "15.0.0";
export const SERVER_RELEASES_URL =
  "https://github.com/PlayStash/playstash-backend/releases";

/** Parses `1.2.3`, `v1.2`, `17.0.0-beta.1+build` (missing parts are 0). */
export const parseServerVersion = parseVersion;

/** Semver comparison; returns <0, 0 or >0. */
export const compareServerVersions = compareParsedVersions;

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
