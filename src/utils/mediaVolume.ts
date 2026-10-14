/**
 * Media slider volume (WPF `MediaSliderVolume`), 0-1, default 0 (muted).
 * Independent of the app's sound-effect volume.
 */
export const MEDIA_VOLUME_KEY = "playstash_media_volume";

export function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function getMediaVolume(): number {
  try {
    const raw = localStorage.getItem(MEDIA_VOLUME_KEY);
    if (raw !== null && raw.trim() !== "") return clampVolume(Number(raw));
  } catch {
    // storage unavailable
  }
  return 0;
}

export function setMediaVolume(value: number): void {
  try {
    localStorage.setItem(MEDIA_VOLUME_KEY, String(clampVolume(value)));
  } catch {
    // storage unavailable
  }
}

/** YouTube IFrame API command messages for a volume (0-1). */
export function youtubeVolumeCommands(volume: number): string[] {
  const percent = Math.round(clampVolume(volume) * 100);
  return [
    JSON.stringify({ event: "command", func: "setVolume", args: [percent] }),
    JSON.stringify({
      event: "command",
      func: percent > 0 ? "unMute" : "mute",
      args: [],
    }),
  ];
}
