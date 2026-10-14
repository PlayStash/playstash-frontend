import { translate } from "@/i18n";
import { fillTemplate } from "@/utils/downloadPipeline";

export type UpdateChannel = "stable" | "unstable";

export const SKIPPED_UPDATE_KEY = "playstash_skipped_update_version";
export const UPDATE_CHANNEL_KEY = "playstash_update_channel";

export function channelLabel(channel: UpdateChannel): string {
  return channel;
}

export function readSkippedVersion(channel: UpdateChannel): string | null {
  try {
    return localStorage.getItem(`${SKIPPED_UPDATE_KEY}:${channel}`);
  } catch {
    return null;
  }
}

export function writeSkippedVersion(
  channel: UpdateChannel,
  version: string,
): void {
  try {
    localStorage.setItem(`${SKIPPED_UPDATE_KEY}:${channel}`, version);
  } catch {
    // localStorage unavailable
  }
}

export function clearSkippedVersion(channel: UpdateChannel): void {
  try {
    localStorage.removeItem(`${SKIPPED_UPDATE_KEY}:${channel}`);
  } catch {
    // localStorage unavailable
  }
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

export function formatReleaseNotes(notes?: string | null): string {
  if (!notes) return "";

  const collapsed = notes.replace(/\s+/g, " ").trim();
  if (!collapsed) return "";
  if (collapsed.length <= 240) return collapsed;
  return `${collapsed.slice(0, 237)}...`;
}

export function formatUpdatePrompt(
  version: string,
  channel: UpdateChannel,
  notes?: string | null,
): string {
  const releaseNotes = formatReleaseNotes(notes);
  const parts = [
    fillTemplate(translate("updater.prompt.running"), {
      version: __APP_VERSION__,
    }),
    fillTemplate(translate("updater.prompt.available"), {
      version,
      channel: channelLabel(channel),
    }),
  ];

  if (releaseNotes) {
    parts.push(
      fillTemplate(translate("updater.prompt.releaseNotes"), {
        notes: releaseNotes,
      }),
    );
  }

  parts.push(translate("updater.prompt.question"));
  return parts.join(" ");
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

export function compareVersions(left: string, right: string): number {
  const leftParts = normalizeVersion(left)
    .split("-")[0]
    .split(".")
    .map((part) => Number.parseInt(part, 10));
  const rightParts = normalizeVersion(right)
    .split("-")[0]
    .split(".")
    .map((part) => Number.parseInt(part, 10));

  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const leftValue = Number.isFinite(leftParts[index]) ? leftParts[index] : 0;
    const rightValue = Number.isFinite(rightParts[index])
      ? rightParts[index]
      : 0;

    if (leftValue > rightValue) return 1;
    if (leftValue < rightValue) return -1;
  }

  return 0;
}

export function isMissingUpdaterFeedError(error: unknown): boolean {
  const message = formatUpdateError(error).toLowerCase();
  return (
    message.includes("404") ||
    message.includes("not found") ||
    message.includes("target")
  );
}
