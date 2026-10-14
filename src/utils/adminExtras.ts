/**
 * Administration extras (WPF AdminConsole / ServerStatus): user sorting,
 * backend update detection and the uptime text.
 */
import type { PlaystashUser } from "@/api";
import { translate } from "@/i18n";
import { formatMessage } from "@/utils/formatMessage";

export type UserSort = "username" | "activation" | "role";

function compareNames(a: PlaystashUser, b: PlaystashUser): number {
  const x = (a.username ?? "").toLowerCase();
  const y = (b.username ?? "").toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
}

/**
 * - username: case-insensitive ascending
 * - activation: non-activated first, then username
 * - role: role descending (ADMIN > EDITOR > USER > GUEST), then username
 */
export function sortUsers(
  users: PlaystashUser[],
  sort: UserSort,
): PlaystashUser[] {
  const list = [...users];
  switch (sort) {
    case "activation":
      return list.sort(
        (a, b) =>
          Number(!!a.activated) - Number(!!b.activated) || compareNames(a, b),
      );
    case "role":
      return list.sort(
        (a, b) =>
          (Number(b.role) || 0) - (Number(a.role) || 0) || compareNames(a, b),
      );
    default:
      return list.sort(compareNames);
  }
}

/** Parses `major.minor.patch[-pre]`, tolerating a leading `v`. */
export function parseVersion(
  value: string | null | undefined,
): { parts: number[]; pre: string } | null {
  if (!value) return null;
  const match = value
    .trim()
    .replace(/^v/i, "")
    .match(
      /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/,
    );
  if (!match) return null;
  return {
    parts: [match[1], match[2], match[3], match[4]].map((part) =>
      Number(part ?? 0),
    ),
    pre: match[5] ?? "",
  };
}

/** Semver comparison: >0 when `a` is newer. Null when unparseable. */
export function compareVersions(a: string, b: string): number | null {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return null;
  for (let i = 0; i < 4; i++) {
    if (x.parts[i] !== y.parts[i]) return x.parts[i] - y.parts[i];
  }
  // A release is newer than its pre-release.
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return x.pre < y.pre ? -1 : 1;
}

export interface GithubRelease {
  tag_name?: string;
  html_url?: string;
  prerelease?: boolean;
  draft?: boolean;
}

export const BACKEND_RELEASES_API =
  "https://api.github.com/repos/PlayStash/playstash-backend/releases";

/**
 * The update link: the first non-draft, non-prerelease release when it is
 * newer than `currentVersion` and its URL is http(s). Otherwise `null`.
 */
export function findBackendUpdate(
  releases: unknown,
  currentVersion: string | null | undefined,
): { version: string; url: string } | null {
  if (!Array.isArray(releases) || !currentVersion) return null;
  const release = (releases as GithubRelease[]).find(
    (entry) => entry && entry.prerelease === false && entry.draft === false,
  );
  if (!release?.tag_name || !release.html_url) return null;
  const version = release.tag_name.replace(/^v/i, "");
  const comparison = compareVersions(version, currentVersion);
  if (comparison === null || comparison <= 0) return null;
  try {
    const url = new URL(release.html_url);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
  } catch {
    return null;
  }
  return { version, url: release.html_url };
}

/** `d days hh:mm:ss` (.NET `d' days 'hh:mm:ss`), or null. */
export function formatUptime(seconds: unknown): string | null {
  const value = Number(seconds);
  if (seconds === null || seconds === undefined || !Number.isFinite(value)) {
    return null;
  }
  const total = Math.max(0, Math.floor(value));
  const days = Math.floor(total / 86400);
  const pad = (n: number) => String(n).padStart(2, "0");
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return formatMessage(translate("admin.health.uptime"), {
    days,
    time: `${pad(hours)}:${pad(minutes)}:${pad(secs)}`,
  });
}
