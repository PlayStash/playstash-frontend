import { translate } from "@/i18n";
import { compareVersionStrings, parseVersion } from "@/utils/semver";

export type UpdateChannel = "stable" | "unstable";

export const UPDATE_CHANNEL_KEY = "playstash_update_channel";

export function channelLabel(channel: UpdateChannel): string {
  return channel;
}

export function defaultChannelForBuild(): UpdateChannel {
  const buildChannel = __BUILD_CHANNEL__;
  return buildChannel === "unstable" ? buildChannel : "stable";
}

export function readUpdateChannel(): UpdateChannel {
  const buildDefault = defaultChannelForBuild();
  try {
    const value = localStorage.getItem(UPDATE_CHANNEL_KEY);
    if (value === "stable" || value === "unstable") {
      return value;
    }
    return buildDefault;
  } catch {
    return buildDefault;
  }
}

export function writeUpdateChannel(channel: UpdateChannel): void {
  try {
    localStorage.setItem(UPDATE_CHANNEL_KEY, channel);
  } catch {
    // localStorage unavailable
  }
}

/** Longest release notes shown in the update dialog. */
export const MAX_RELEASE_NOTES_LENGTH = 20_000;

/**
 * Release notes as shown in the update dialog: Markdown kept intact, the
 * changelog "Status:" line removed and very long notes cut off.
 */
export function formatReleaseNotes(notes?: string | null): string {
  if (!notes) return "";
  const cleaned = notes
    .replace(/\r\n/g, "\n")
    .replace(/^Status:.*$/gm, "")
    .trim();
  if (cleaned.length <= MAX_RELEASE_NOTES_LENGTH) return cleaned;
  return `${cleaned.slice(0, MAX_RELEASE_NOTES_LENGTH - 3).trimEnd()}...`;
}

export function formatUpdateError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }

  return translate("updater.error.generic");
}

export function normalizeVersion(version: string): string {
  return version.replace(/^v/i, "").trim();
}

/**
 * SemVer precedence of two versions (-1, 0 or 1), including prerelease
 * suffixes: 17.2.3-unstable.9.1 < 17.2.3-unstable.15.1 < 17.2.3 < 17.3.0.
 */
export function compareVersions(left: string, right: string): number {
  return compareVersionStrings(normalizeVersion(left), normalizeVersion(right));
}

/**
 * True when the updater could not use the signed feed: it is missing (HTTP
 * 404, "Could not fetch a valid release JSON") or has no entry for this
 * platform. The update can still be offered through the GitHub release page.
 */
export function isMissingUpdaterFeedError(error: unknown): boolean {
  const message = formatUpdateError(error).toLowerCase();
  return (
    /\b404\b/.test(message) ||
    message.includes("could not fetch a valid release json") ||
    message.includes("in the response `platforms` object")
  );
}

/** How long "Later" silences the automatic prompt for the same version. */
export const UPDATE_SNOOZE_MS = 24 * 60 * 60 * 1000;
/** Interval of the automatic background update check. */
export const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

export interface UpdateSnooze {
  channel: UpdateChannel;
  version: string;
  until: number;
}

/** Whether an automatic check should stay quiet about `version`. */
export function isUpdateSnoozed(
  snooze: UpdateSnooze | null,
  channel: UpdateChannel,
  version: string,
  now: number = Date.now(),
): boolean {
  return (
    !!snooze &&
    snooze.channel === channel &&
    normalizeVersion(snooze.version) === normalizeVersion(version) &&
    now < snooze.until
  );
}

export interface GithubReleaseInfo {
  tag_name?: string | null;
  name?: string | null;
  html_url?: string | null;
  body?: string | null;
}

/**
 * Version of a GitHub release: the stable tag (`v17.3.0`), or for the
 * moving `unstable` tag the build version in the release title
 * ("PlayStash 17.3.0-unstable.15.1 · Unstable"). Null when none is found.
 */
export function githubReleaseVersion(
  release: GithubReleaseInfo,
): string | null {
  for (const candidate of [release.tag_name, release.name]) {
    const match = /v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]*[0-9A-Za-z])?)/.exec(
      candidate ?? "",
    );
    if (match && parseVersion(match[1])) return match[1];
  }
  return null;
}
