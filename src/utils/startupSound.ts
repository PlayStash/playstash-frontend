/**
 * Startup sound (desktop): plays the chosen file once after login at volume
 * 0.5 (independent of the app volume) and stops it after 10 seconds.
 * Native playback (Rust/rodio) is preferred because it is not subject to the
 * webview's autoplay policy; otherwise an `<audio>` element is used.
 */
import { isTauriApp } from "@/utils/tauri";

export const STARTUP_SOUND_EXTENSIONS = [
  "mp3",
  "wav",
  "wma",
  "m4a",
  "ogg",
  "flac",
] as const;
export const STARTUP_SOUND_MAX_BYTES = 20 * 1024 * 1024;
export const STARTUP_SOUND_VOLUME = 0.5;
export const STARTUP_SOUND_LIMIT_MS = 10_000;

const MIME_TYPES: Record<string, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  wma: "audio/x-ms-wma",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
  flac: "audio/flac",
};

async function invoke<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
  return tauriInvoke<T>(command, args);
}

export function getStartupSound(): Promise<string | null> {
  return invoke<string | null>("startup_sound_get");
}

/** Stores the sound. Rejects with "Choose an audio file smaller than 20 MB." */
export function setStartupSound(path: string): Promise<void> {
  return invoke("startup_sound_set", { path });
}

export function clearStartupSound(): Promise<void> {
  return invoke("startup_sound_clear");
}

let fallbackAudio: HTMLAudioElement | null = null;
let fallbackTimer: number | null = null;
let fallbackUrl: string | null = null;

function stopFallback(): void {
  if (fallbackTimer !== null) window.clearTimeout(fallbackTimer);
  fallbackTimer = null;
  if (fallbackAudio) {
    fallbackAudio.pause();
    fallbackAudio.removeAttribute("src");
    fallbackAudio = null;
  }
  if (fallbackUrl) URL.revokeObjectURL(fallbackUrl);
  fallbackUrl = null;
}

async function playFallback(): Promise<void> {
  const [path, base64] = await Promise.all([
    getStartupSound(),
    invoke<string | null>("startup_sound_bytes"),
  ]);
  if (!path || !base64) return;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  stopFallback();
  fallbackUrl = URL.createObjectURL(
    new Blob([bytes as BlobPart], { type: MIME_TYPES[ext] ?? "audio/*" }),
  );
  const audio = new Audio(fallbackUrl);
  audio.volume = STARTUP_SOUND_VOLUME;
  fallbackAudio = audio;
  fallbackTimer = window.setTimeout(stopFallback, STARTUP_SOUND_LIMIT_MS);
  audio.addEventListener("ended", stopFallback, { once: true });
  await audio.play();
}

/** Plays the configured startup sound (no-op without one / on the web). */
export async function playStartupSound(): Promise<void> {
  if (!isTauriApp()) return;
  try {
    const result = await invoke<string>("startup_sound_play");
    if (result === "fallback") await playFallback();
  } catch (error) {
    console.warn("Startup sound could not be played:", error);
  }
}

export async function stopStartupSound(): Promise<void> {
  stopFallback();
  if (!isTauriApp()) return;
  try {
    await invoke("startup_sound_stop");
  } catch {
    // nothing playing / simulated desktop mode
  }
}
