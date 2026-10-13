import { useSyncExternalStore } from "react";
import { isTauriDesktop } from "./tauri";
const KEY = "playstash:big-picture";
const EVENT = "playstash:big-picture-changed";
export function readBigPicture(): boolean {
  try {
    return localStorage.getItem(KEY) === "true";
  } catch {
    return false;
  }
}
function subscribe(callback: () => void) {
  window.addEventListener(EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}
export function useBigPicture() {
  return useSyncExternalStore(subscribe, readBigPicture, () => false);
}
export async function setBigPicture(enabled: boolean): Promise<void> {
  try {
    localStorage.setItem(KEY, String(enabled));
  } catch {}
  window.dispatchEvent(new Event(EVENT));
  if (isTauriDesktop()) {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().setFullscreen(enabled);
  } else if (enabled && !document.fullscreenElement)
    await document.documentElement.requestFullscreen?.();
  else if (!enabled && document.fullscreenElement)
    await document.exitFullscreen();
}
